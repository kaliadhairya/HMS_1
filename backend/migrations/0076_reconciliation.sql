-- 0076: reconciliation (blueprint 3.6 "Reconciliation: Cash session,
-- bank/provider reconciliation, exception — Recorded receipts, bank
-- settlements, refunds and journal balances must reconcile"; 3.8 "Run
-- reconciliation continuously"; 4.4 "Cash, bank and payer reconciliation ->
-- Account closure or owned exception").

-- A cashier's drawer from opening to count. Cash receipts and cash refunds
-- belong to the session open at the time; the count is compared with them.
CREATE TABLE hms_cash_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashier_user_id INTEGER NOT NULL REFERENCES hms_users (id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_float   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  closed_at       TIMESTAMPTZ,
  expected_cash   NUMERIC(14,2),
  counted_cash    NUMERIC(14,2) CHECK (counted_cash >= 0),
  variance        NUMERIC(14,2),
  close_note      TEXT,
  CONSTRAINT ck_session_closed CHECK ((status = 'Closed') = (closed_at IS NOT NULL AND expected_cash IS NOT NULL AND counted_cash IS NOT NULL AND variance IS NOT NULL)),
  CONSTRAINT ck_session_variance CHECK (variance IS NULL OR variance = counted_cash - expected_cash),
  CONSTRAINT ck_session_variance_note CHECK (COALESCE(variance, 0) = 0 OR length(btrim(close_note)) > 0)
);
CREATE UNIQUE INDEX ux_cash_session_open ON hms_cash_sessions (cashier_user_id) WHERE status = 'Open';
CREATE FUNCTION billing_cash_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'Closed' OR (NEW.cashier_user_id, NEW.opened_at, NEW.opening_float) IS DISTINCT FROM (OLD.cashier_user_id, OLD.opened_at, OLD.opening_float) THEN
    RAISE EXCEPTION 'A cash session is closed once and then kept' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cash_session_guard BEFORE UPDATE OR DELETE ON hms_cash_sessions
  FOR EACH ROW EXECUTE FUNCTION billing_cash_session_guard();

ALTER TABLE hms_receipts ADD COLUMN cash_session_id UUID REFERENCES hms_cash_sessions (id);
ALTER TABLE hms_receipts ADD CONSTRAINT ck_receipt_cash_session CHECK ((method = 'Cash') = (cash_session_id IS NOT NULL));
ALTER TABLE hms_refunds ADD COLUMN cash_session_id UUID REFERENCES hms_cash_sessions (id);
ALTER TABLE hms_refunds ADD CONSTRAINT ck_refund_cash_session CHECK (method <> 'Cash' OR state NOT IN ('Confirmed') OR cash_session_id IS NOT NULL);
CREATE INDEX ix_receipts_cash_session ON hms_receipts (cash_session_id);

-- Settlement lines from the bank, card/UPI provider or payer statement,
-- entered or imported, matched to the receipts and remittances they pay out.
CREATE TABLE hms_settlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source              TEXT NOT NULL CHECK (source IN ('bank', 'card', 'upi', 'payer')),
  statement_reference TEXT NOT NULL CHECK (length(btrim(statement_reference)) BETWEEN 1 AND 100),
  provider_reference  TEXT,
  amount              NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  settled_on          DATE NOT NULL,
  receipt_id          UUID UNIQUE REFERENCES hms_receipts (id),
  remittance_id       UUID UNIQUE REFERENCES hms_remittances (id),
  recorded_by         INTEGER NOT NULL REFERENCES hms_users (id),
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  matched_by          INTEGER REFERENCES hms_users (id),
  matched_at          TIMESTAMPTZ,
  CONSTRAINT ux_settlement_reference UNIQUE (source, statement_reference),
  CONSTRAINT ck_settlement_one_match CHECK (receipt_id IS NULL OR remittance_id IS NULL),
  CONSTRAINT ck_settlement_matched CHECK ((receipt_id IS NULL AND remittance_id IS NULL) = (matched_at IS NULL))
);
CREATE FUNCTION billing_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - ARRAY['receipt_id', 'remittance_id', 'matched_by', 'matched_at'])
                         <> (to_jsonb(OLD) - ARRAY['receipt_id', 'remittance_id', 'matched_by', 'matched_at'])
     OR OLD.matched_at IS NOT NULL THEN
    RAISE EXCEPTION 'A settlement line is matched once and otherwise kept as recorded' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_settlement_guard BEFORE UPDATE OR DELETE ON hms_settlements
  FOR EACH ROW EXECUTE FUNCTION billing_settlement_guard();

-- Everything that does not reconcile, with an owner until resolved. One open
-- exception per problem; the checks re-open nothing that is already open.
CREATE TABLE hms_recon_exceptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL CHECK (kind IN (
                    'unknown_payment', 'stale_pending_payment', 'cash_variance', 'unmatched_settlement',
                    'unsettled_receipt', 'settlement_amount_mismatch', 'journal_imbalance', 'fund_overused',
                    'invoice_overpaid', 'uninvoiced_charges', 'uncredited_reversal', 'receipt_unposted',
                    'refund_unconfirmed', 'claim_unpaid')),
  subject_key     TEXT NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
  owner_user_id   INTEGER REFERENCES hms_users (id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     INTEGER REFERENCES hms_users (id),
  resolved_at     TIMESTAMPTZ,
  resolution      TEXT,
  CONSTRAINT ck_exception_resolved CHECK ((status = 'Resolved') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(btrim(resolution)) > 0))
);
CREATE UNIQUE INDEX ux_recon_exception_open ON hms_recon_exceptions (kind, subject_key) WHERE status = 'Open';
CREATE INDEX ix_recon_exception_status ON hms_recon_exceptions (status, opened_at);
CREATE FUNCTION billing_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'Resolved'
     OR (NEW.kind, NEW.subject_key, NEW.details, NEW.opened_at) IS DISTINCT FROM (OLD.kind, OLD.subject_key, OLD.details, OLD.opened_at) THEN
    RAISE EXCEPTION 'A reconciliation exception keeps what was found; it is resolved once' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_exception_guard BEFORE UPDATE OR DELETE ON hms_recon_exceptions
  FOR EACH ROW EXECUTE FUNCTION billing_exception_guard();

CREATE TRIGGER trg_audit_hms_cash_sessions AFTER INSERT OR UPDATE OR DELETE ON hms_cash_sessions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_settlements AFTER INSERT OR UPDATE OR DELETE ON hms_settlements FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_recon_exceptions AFTER INSERT OR UPDATE OR DELETE ON hms_recon_exceptions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
