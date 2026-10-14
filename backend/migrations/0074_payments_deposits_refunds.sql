-- 0074: payment intents, receipts, deposits and credits, allocations, refunds
-- (blueprint 3.6 "Receipts and deposits: Provider/cash references
-- deduplicated; deposits cannot be overallocated; refunds reference real credit
-- and approval"; fixed interpretation: a deposit is a liability until
-- allocated or refunded; a payment reduces the receivable and does not rewrite
-- the invoice; 4.4 "Payment intent: Initiated -> Pending -> Confirmed/Failed/
-- Unknown", "Refund: Requested -> Approved -> Submitted -> Confirmed/Failed",
-- "Unknown provider outcomes go to reconciliation. A retry must not become a
-- second collection").

-- ── Payment intents and receipts ────────────────────────────
CREATE SEQUENCE hms_receipt_seq;
CREATE TABLE hms_payment_intents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  account_id         UUID REFERENCES hms_billing_accounts (id),
  purpose            TEXT NOT NULL CHECK (purpose IN ('deposit', 'invoice')),
  invoice_id         UUID REFERENCES hms_invoices (id),
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method             TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'UPI', 'BankTransfer', 'Cheque')),
  state              TEXT NOT NULL DEFAULT 'Initiated' CHECK (state IN ('Initiated', 'Pending', 'Confirmed', 'Failed', 'Unknown')),
  provider_reference TEXT CHECK (provider_reference IS NULL OR length(btrim(provider_reference)) BETWEEN 1 AND 100),
  failure_reason     TEXT,
  notes              TEXT,
  created_by         INTEGER NOT NULL REFERENCES hms_users (id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by        INTEGER REFERENCES hms_users (id),
  resolved_at        TIMESTAMPTZ,
  CONSTRAINT ck_intent_purpose CHECK ((purpose = 'invoice') = (invoice_id IS NOT NULL)),
  CONSTRAINT ck_intent_resolved CHECK ((state IN ('Confirmed', 'Failed')) = (resolved_at IS NOT NULL)),
  CONSTRAINT ck_intent_failed CHECK (state <> 'Failed' OR length(btrim(failure_reason)) > 0),
  -- Card, UPI and bank payments are confirmed against the provider's reference.
  CONSTRAINT ck_intent_reference CHECK (state <> 'Confirmed' OR method IN ('Cash', 'Cheque') OR provider_reference IS NOT NULL)
);
-- A provider reference is used once.
CREATE UNIQUE INDEX ux_intent_provider_ref ON hms_payment_intents (method, provider_reference) WHERE provider_reference IS NOT NULL AND state <> 'Failed';
-- While a payment's outcome is open or unknown, no second collection starts
-- for the same invoice (or the same account's deposit).
CREATE UNIQUE INDEX ux_intent_open_invoice ON hms_payment_intents (invoice_id) WHERE invoice_id IS NOT NULL AND state IN ('Initiated', 'Pending', 'Unknown');
CREATE UNIQUE INDEX ux_intent_open_deposit ON hms_payment_intents (patient_id, COALESCE(account_id::text, '-')) WHERE purpose = 'deposit' AND state IN ('Initiated', 'Pending', 'Unknown');
CREATE INDEX ix_intents_state ON hms_payment_intents (state);

CREATE FUNCTION billing_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payment intents are kept' USING ERRCODE = 'restrict_violation'; END IF;
  IF (NEW.patient_id, NEW.account_id, NEW.purpose, NEW.invoice_id, NEW.amount, NEW.method, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.patient_id, OLD.account_id, OLD.purpose, OLD.invoice_id, OLD.amount, OLD.method, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'A payment intent keeps its amount, method and target' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.provider_reference IS NOT NULL AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'A provider reference is set once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.state = OLD.state
          OR (OLD.state = 'Initiated' AND NEW.state IN ('Pending', 'Confirmed', 'Failed', 'Unknown'))
          OR (OLD.state = 'Pending' AND NEW.state IN ('Confirmed', 'Failed', 'Unknown'))
          OR (OLD.state = 'Unknown' AND NEW.state IN ('Confirmed', 'Failed'))) THEN
    RAISE EXCEPTION 'Payment cannot go from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('Confirmed', 'Failed') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'A settled payment intent cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_intent_guard BEFORE UPDATE OR DELETE ON hms_payment_intents
  FOR EACH ROW EXECUTE FUNCTION billing_intent_guard();

-- Money actually received: one receipt per confirmed intent.
CREATE TABLE hms_receipts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number     TEXT NOT NULL UNIQUE,
  intent_id          UUID NOT NULL UNIQUE REFERENCES hms_payment_intents (id),
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method             TEXT NOT NULL,
  provider_reference TEXT,
  received_by        INTEGER NOT NULL REFERENCES hms_users (id),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The row written to hms_payments for older screens and reports.
  legacy_payment_id  INTEGER UNIQUE REFERENCES hms_payments (id)
);
CREATE INDEX ix_receipts_patient ON hms_receipts (patient_id);
CREATE INDEX ix_receipts_received_at ON hms_receipts (received_at);
CREATE FUNCTION billing_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'legacy_payment_id') <> (to_jsonb(OLD) - 'legacy_payment_id')
     OR (OLD.legacy_payment_id IS NOT NULL AND NEW.legacy_payment_id IS DISTINCT FROM OLD.legacy_payment_id) THEN
    RAISE EXCEPTION 'Receipts are immutable' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_receipt_guard BEFORE UPDATE OR DELETE ON hms_receipts
  FOR EACH ROW EXECUTE FUNCTION billing_receipt_guard();

-- ── Funds owed to the patient ───────────────────────────────
-- A deposit (money taken in advance) or a credit (a credit note beyond what
-- was still owed, or an overpayment). Each is a liability until allocated to
-- an invoice or refunded, and can never be used beyond its amount.
CREATE TABLE hms_patient_funds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        INTEGER NOT NULL REFERENCES hms_patients (id),
  account_id        UUID REFERENCES hms_billing_accounts (id),
  kind              TEXT NOT NULL CHECK (kind IN ('deposit', 'credit')),
  amount            NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  receipt_id        UUID UNIQUE REFERENCES hms_receipts (id),
  note_id           UUID UNIQUE REFERENCES hms_invoice_notes (id),
  legacy_advance_id INTEGER UNIQUE REFERENCES hms_patient_advances (id),
  created_by        INTEGER REFERENCES hms_users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_fund_origin CHECK (
       (kind = 'deposit' AND note_id IS NULL AND ((receipt_id IS NULL) <> (legacy_advance_id IS NULL)))
    OR (kind = 'credit' AND legacy_advance_id IS NULL AND ((note_id IS NULL) <> (receipt_id IS NULL))))
);
CREATE INDEX ix_funds_patient ON hms_patient_funds (patient_id);
CREATE TRIGGER trg_funds_immutable BEFORE UPDATE OR DELETE ON hms_patient_funds
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- ── Allocations ─────────────────────────────────────────────
-- Settles part of an invoice's patient share from a receipt or a fund.
CREATE TABLE hms_allocations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID NOT NULL REFERENCES hms_invoices (id),
  receipt_id   UUID REFERENCES hms_receipts (id),
  fund_id      UUID REFERENCES hms_patient_funds (id),
  amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  allocated_by INTEGER NOT NULL REFERENCES hms_users (id),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_allocation_source CHECK ((receipt_id IS NULL) <> (fund_id IS NULL))
);
CREATE INDEX ix_allocations_invoice ON hms_allocations (invoice_id);
CREATE INDEX ix_allocations_fund ON hms_allocations (fund_id);
CREATE INDEX ix_allocations_receipt ON hms_allocations (receipt_id);
CREATE TRIGGER trg_allocations_immutable BEFORE UPDATE OR DELETE ON hms_allocations
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- ── Refunds ─────────────────────────────────────────────────
CREATE SEQUENCE hms_refund_seq;
CREATE TABLE hms_refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number      TEXT NOT NULL UNIQUE,
  fund_id            UUID NOT NULL REFERENCES hms_patient_funds (id),
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method             TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'UPI', 'BankTransfer', 'Cheque')),
  reason             TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  state              TEXT NOT NULL DEFAULT 'Requested' CHECK (state IN ('Requested', 'Approved', 'Rejected', 'Submitted', 'Confirmed', 'Failed')),
  requested_by       INTEGER NOT NULL REFERENCES hms_users (id),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by        INTEGER REFERENCES hms_users (id),
  approved_at        TIMESTAMPTZ,
  decision_note      TEXT,
  submitted_by       INTEGER REFERENCES hms_users (id),
  submitted_at       TIMESTAMPTZ,
  provider_reference TEXT,
  completed_by       INTEGER REFERENCES hms_users (id),
  completed_at       TIMESTAMPTZ,
  failure_reason     TEXT,
  -- Approval is a second person.
  CONSTRAINT ck_refund_separation CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT ck_refund_approved CHECK (state IN ('Requested') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT ck_refund_rejected CHECK (state <> 'Rejected' OR length(btrim(decision_note)) > 0),
  CONSTRAINT ck_refund_submitted CHECK (state NOT IN ('Submitted', 'Confirmed', 'Failed') OR submitted_at IS NOT NULL),
  CONSTRAINT ck_refund_completed CHECK ((state IN ('Confirmed', 'Failed')) = (completed_at IS NOT NULL)),
  CONSTRAINT ck_refund_failed CHECK (state <> 'Failed' OR length(btrim(failure_reason)) > 0)
);
CREATE INDEX ix_refunds_fund ON hms_refunds (fund_id);
CREATE FUNCTION billing_refund_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Refunds are kept' USING ERRCODE = 'restrict_violation'; END IF;
  IF (NEW.refund_number, NEW.fund_id, NEW.patient_id, NEW.amount, NEW.method, NEW.reason, NEW.requested_by, NEW.requested_at)
     IS DISTINCT FROM (OLD.refund_number, OLD.fund_id, OLD.patient_id, OLD.amount, OLD.method, OLD.reason, OLD.requested_by, OLD.requested_at) THEN
    RAISE EXCEPTION 'A refund keeps its amount, fund and reason' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.state = OLD.state
          OR (OLD.state = 'Requested' AND NEW.state IN ('Approved', 'Rejected'))
          OR (OLD.state = 'Approved' AND NEW.state = 'Submitted')
          OR (OLD.state = 'Submitted' AND NEW.state IN ('Confirmed', 'Failed'))) THEN
    RAISE EXCEPTION 'Refund cannot go from % to %', OLD.state, NEW.state USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state IN ('Rejected', 'Confirmed', 'Failed') AND to_jsonb(NEW) <> to_jsonb(OLD) THEN
    RAISE EXCEPTION 'A finished refund cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_refund_guard BEFORE UPDATE OR DELETE ON hms_refunds
  FOR EACH ROW EXECUTE FUNCTION billing_refund_guard();

-- ── Over-use protection (checked at commit) ─────────────────
-- A fund's allocations plus its live refunds never exceed it; an invoice's
-- allocations never exceed its patient share after notes.
CREATE FUNCTION billing_fund_balance(p_fund UUID) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT f.amount
         - COALESCE((SELECT sum(a.amount) FROM hms_allocations a WHERE a.fund_id = f.id), 0)
         - COALESCE((SELECT sum(r.amount) FROM hms_refunds r WHERE r.fund_id = f.id AND r.state NOT IN ('Rejected', 'Failed')), 0)
    FROM hms_patient_funds f WHERE f.id = p_fund
$$;
-- What the patient still owes on an invoice.
CREATE FUNCTION billing_invoice_patient_due(p_invoice UUID) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN i.status IN ('Draft', 'Void') THEN 0 ELSE
         i.patient_amount
         - COALESCE((SELECT sum(n.patient_amount) FROM hms_invoice_notes n WHERE n.invoice_id = i.id AND n.kind = 'credit'), 0)
         + COALESCE((SELECT sum(n.patient_amount) FROM hms_invoice_notes n WHERE n.invoice_id = i.id AND n.kind = 'debit'), 0)
         - COALESCE((SELECT sum(a.amount) FROM hms_allocations a WHERE a.invoice_id = i.id), 0) END
    FROM hms_invoices i WHERE i.id = p_invoice
$$;
-- A receipt's unallocated remainder.
CREATE FUNCTION billing_receipt_unallocated(p_receipt UUID) RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT r.amount
         - COALESCE((SELECT sum(a.amount) FROM hms_allocations a WHERE a.receipt_id = r.id), 0)
         - COALESCE((SELECT sum(f.amount) FROM hms_patient_funds f WHERE f.receipt_id = r.id), 0)
    FROM hms_receipts r WHERE r.id = p_receipt
$$;

CREATE FUNCTION billing_allocation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv hms_invoices;
  fund hms_patient_funds;
  rec hms_receipts;
BEGIN
  IF TG_TABLE_NAME = 'hms_refunds' THEN
    IF billing_fund_balance(NEW.fund_id) < 0 THEN
      RAISE EXCEPTION 'The refund is more than the credit available' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'hms_patient_funds' THEN
    IF NEW.receipt_id IS NOT NULL AND billing_receipt_unallocated(NEW.receipt_id) < 0 THEN
      RAISE EXCEPTION 'The receipt is already used' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END IF;
  SELECT * INTO inv FROM hms_invoices WHERE id = NEW.invoice_id;
  IF inv.status NOT IN ('Issued', 'PartiallyCredited', 'Credited') THEN
    RAISE EXCEPTION 'Payments are applied only to an issued invoice' USING ERRCODE = 'check_violation';
  END IF;
  IF billing_invoice_patient_due(NEW.invoice_id) < 0 THEN
    RAISE EXCEPTION 'The payment is more than the amount due' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.fund_id IS NOT NULL THEN
    SELECT * INTO fund FROM hms_patient_funds WHERE id = NEW.fund_id;
    IF fund.patient_id <> inv.patient_id THEN
      RAISE EXCEPTION 'A deposit is used only for the same patient' USING ERRCODE = 'check_violation';
    END IF;
    IF billing_fund_balance(NEW.fund_id) < 0 THEN
      RAISE EXCEPTION 'The deposit does not have that much left' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO rec FROM hms_receipts WHERE id = NEW.receipt_id;
    IF rec.patient_id <> inv.patient_id THEN
      RAISE EXCEPTION 'A receipt is applied only to the same patient' USING ERRCODE = 'check_violation';
    END IF;
    IF billing_receipt_unallocated(NEW.receipt_id) < 0 THEN
      RAISE EXCEPTION 'The receipt does not have that much left' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_allocation_check AFTER INSERT ON hms_allocations
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_allocation_check();
CREATE CONSTRAINT TRIGGER trg_refund_check AFTER INSERT OR UPDATE ON hms_refunds
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_allocation_check();
CREATE CONSTRAINT TRIGGER trg_fund_receipt_check AFTER INSERT ON hms_patient_funds
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_allocation_check();

-- ── Legacy advances ─────────────────────────────────────────
-- Unused advances become deposits on their admission's account, with an
-- opening-balance journal entry (the cash was received before the journal).
INSERT INTO hms_patient_funds (patient_id, account_id, kind, amount, legacy_advance_id, created_by, created_at)
SELECT a.patient_id, CASE WHEN a.admission_id IS NOT NULL THEN billing_account_for(NULL, a.admission_id) END,
       'deposit', a.amount, a.id, a.received_by, COALESCE(a.received_at, now())
  FROM hms_patient_advances a
 WHERE a.adjusted_bill_id IS NULL AND COALESCE(a.is_refunded, 0) = 0 AND a.amount > 0;
INSERT INTO hms_journal_entries (source_type, source_key, account_id, patient_id, memo)
SELECT 'legacy_advance', f.legacy_advance_id::text, f.account_id, f.patient_id, 'Opening balance: advance taken before Phase 5'
  FROM hms_patient_funds f WHERE f.legacy_advance_id IS NOT NULL;
INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit)
SELECT e.id, x.gl, x.d, x.c
  FROM hms_journal_entries e
  JOIN hms_patient_funds f ON e.source_type = 'legacy_advance' AND e.source_key = f.legacy_advance_id::text
  CROSS JOIN LATERAL (VALUES ('3900', f.amount, 0::numeric), ('2000', 0::numeric, f.amount)) AS x(gl, d, c);

CREATE TRIGGER trg_audit_hms_payment_intents AFTER INSERT OR UPDATE OR DELETE ON hms_payment_intents FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_receipts AFTER INSERT OR UPDATE OR DELETE ON hms_receipts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_patient_funds AFTER INSERT OR UPDATE OR DELETE ON hms_patient_funds FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_allocations AFTER INSERT OR UPDATE OR DELETE ON hms_allocations FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_refunds AFTER INSERT OR UPDATE OR DELETE ON hms_refunds FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
