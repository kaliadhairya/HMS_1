-- Phase 5 open items 2 and 3: counter (OTC) sales and bills raised before
-- Phase 5 enter the financial journal, so it describes all of the money.
--
-- - Counter sales: one balanced entry per sale when the sale commits (cash,
--   card/UPI or bank against pharmacy revenue and GST), and every earlier sale
--   now. Written by the database, so the pharmacy code is unchanged.
-- - Bills from before Phase 5 (no invoice): what was still owed becomes an
--   opening patient receivable; payments and discounts on them through the old
--   path post as they happen. The receivables check counts them too.

CREATE FUNCTION billing_cash_gl(p_mode TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_mode IS NULL OR upper(p_mode) = 'CASH' THEN '1000'
              WHEN upper(p_mode) IN ('CARD', 'UPI') THEN '1010' ELSE '1020' END
$$;

-- ── Counter sales ───────────────────────────────────────────
CREATE FUNCTION billing_post_counter_sale(p_sale INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  s RECORD; total NUMERIC; gst NUMERIC; e UUID;
BEGIN
  SELECT * INTO s FROM hms_otc_sales WHERE id = p_sale;
  SELECT COALESCE(sum(amount), 0), COALESCE(sum(gst_amount), 0) INTO total, gst FROM hms_otc_items WHERE otc_sale_id = p_sale;
  IF s.id IS NULL OR total <= 0 OR EXISTS (SELECT 1 FROM hms_journal_entries WHERE source_type = 'counter_sale' AND source_key = p_sale::text) THEN RETURN; END IF;
  INSERT INTO hms_journal_entries (source_type, source_key, patient_id, memo, posted_by)
  VALUES ('counter_sale', p_sale::text, s.patient_id, 'Counter sale ' || COALESCE(s.bill_number, p_sale::text), s.sold_by) RETURNING id INTO e;
  INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit) VALUES (e, billing_cash_gl(s.payment_mode), total, 0);
  IF total - gst > 0 THEN INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit) VALUES (e, '4020', 0, total - gst); END IF;
  IF gst > 0 THEN INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit) VALUES (e, '2100', 0, gst); END IF;
END $$;

-- At commit, when the sale's lines are all written.
CREATE FUNCTION billing_capture_counter_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM billing_post_counter_sale(NEW.id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_billing_counter_sale AFTER INSERT ON hms_otc_sales
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_capture_counter_sale();

SELECT billing_post_counter_sale(id) FROM hms_otc_sales ORDER BY id;

-- ── Bills raised before Phase 5 ─────────────────────────────
CREATE FUNCTION billing_is_legacy_bill(p_bill INTEGER) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM hms_invoices WHERE legacy_bill_id = p_bill)
$$;
CREATE FUNCTION billing_legacy_due(p_bill INTEGER) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT GREATEST(0, COALESCE(b.net_payable, 0) - COALESCE((SELECT sum(p.amount) FROM hms_payments p WHERE p.bill_id = b.id), 0))
    FROM hms_bills b WHERE b.id = p_bill
$$;

CREATE FUNCTION billing_post_legacy(p_type TEXT, p_key TEXT, p_patient INTEGER, p_memo TEXT, p_debit TEXT, p_credit TEXT, p_amount NUMERIC, p_user INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE e UUID;
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;
  INSERT INTO hms_journal_entries (source_type, source_key, patient_id, memo, posted_by)
  VALUES (p_type, p_key, p_patient, p_memo, p_user) RETURNING id INTO e;
  INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit) VALUES (e, p_debit, round(p_amount, 2), 0), (e, p_credit, 0, round(p_amount, 2));
END $$;

-- What was owed on old bills at the cutover.
SELECT billing_post_legacy('legacy_opening', b.id::text, b.patient_id, 'Owed on bill ' || COALESCE(b.bill_number, b.id::text) || ' raised before Phase 5',
       '1100', '3900', billing_legacy_due(b.id), NULL)
  FROM hms_bills b WHERE billing_is_legacy_bill(b.id) AND COALESCE(b.status, '') <> 'Cancelled' ORDER BY b.id;

-- A bill written without an invoice after the cutover (an import, a test
-- fixture) is an old-style bill too: at commit, if still not linked to an
-- invoice, what it asked for when written becomes a receivable. Invoice
-- bills are linked before commit and skipped; payments and discounts in the
-- same transaction post through the triggers below.
CREATE FUNCTION billing_capture_legacy_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF billing_is_legacy_bill(NEW.id) AND COALESCE(NEW.status, '') <> 'Cancelled'
     AND NOT EXISTS (SELECT 1 FROM hms_journal_entries WHERE source_type = 'legacy_opening' AND source_key = NEW.id::text) THEN
    PERFORM billing_post_legacy('legacy_opening', NEW.id::text, NEW.patient_id, 'Owed on bill ' || COALESCE(NEW.bill_number, NEW.id::text) || ' (written without an invoice)',
      '1100', '3900', COALESCE(NEW.net_payable, 0), NULLIF(current_setting('hms.actor_user_id', true), '')::integer);
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_billing_legacy_bill AFTER INSERT ON hms_bills
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_capture_legacy_bill();

-- A payment through the old path on an old bill.
CREATE FUNCTION billing_capture_legacy_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b RECORD;
BEGIN
  SELECT * INTO b FROM hms_bills WHERE id = NEW.bill_id;
  IF b.id IS NULL OR NOT billing_is_legacy_bill(b.id) THEN RETURN NULL; END IF;
  PERFORM billing_post_legacy('legacy_payment', NEW.id::text, b.patient_id, 'Payment ' || COALESCE(NEW.receipt_number, NEW.id::text) || ' on bill ' || COALESCE(b.bill_number, b.id::text),
    billing_cash_gl(NEW.payment_mode), '1100', NEW.amount, NEW.received_by);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_legacy_payment AFTER INSERT ON hms_payments FOR EACH ROW EXECUTE FUNCTION billing_capture_legacy_payment();

-- A discount (or its correction) on an old bill changes what is owed.
CREATE FUNCTION billing_capture_legacy_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE diff NUMERIC := COALESCE(OLD.net_payable, 0) - COALESCE(NEW.net_payable, 0);
        key TEXT := NEW.id::text || ':' || txid_current() || ':' || clock_timestamp();
BEGIN
  IF diff = 0 OR NOT billing_is_legacy_bill(NEW.id) THEN RETURN NULL; END IF;
  IF diff > 0 THEN
    PERFORM billing_post_legacy('legacy_adjustment', key, NEW.patient_id, 'Discount on bill ' || COALESCE(NEW.bill_number, NEW.id::text), '4900', '1100', diff,
      NULLIF(current_setting('hms.actor_user_id', true), '')::integer);
  ELSE
    PERFORM billing_post_legacy('legacy_adjustment', key, NEW.patient_id, 'Discount reduced on bill ' || COALESCE(NEW.bill_number, NEW.id::text), '1100', '4900', -diff,
      NULLIF(current_setting('hms.actor_user_id', true), '')::integer);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_legacy_adjustment AFTER UPDATE OF net_payable ON hms_bills FOR EACH ROW EXECUTE FUNCTION billing_capture_legacy_adjustment();
