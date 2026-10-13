-- 0075: insurance (blueprint 3.6 "Insurance: Coverage, eligibility check,
-- preauthorization, authorization revision, claim, claim line, remittance,
-- denial"; "Insurer authorization is distinct from payment; approved limit,
-- patient share and final adjudication are separately tracked"; 4.4 "Claim:
-- Prepared -> Submitted -> Acknowledged -> Adjudicated -> Settled/Denied/Appealed").
--
-- No payer rules or contract prices are invented: payers, coverages and the
-- co-pay share are entered by staff from the payer's documents.

CREATE TABLE hms_payers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9:_.-]{1,40}$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  kind       TEXT NOT NULL CHECK (kind IN ('insurer', 'tpa', 'government', 'corporate')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER REFERENCES hms_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hms_coverages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    INTEGER NOT NULL REFERENCES hms_patients (id),
  payer_id      UUID NOT NULL REFERENCES hms_payers (id),
  policy_number TEXT NOT NULL CHECK (length(btrim(policy_number)) BETWEEN 1 AND 60),
  member_id     TEXT NOT NULL CHECK (length(btrim(member_id)) BETWEEN 1 AND 60),
  plan_name     TEXT,
  valid_from    DATE NOT NULL,
  valid_to      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_by    INTEGER REFERENCES hms_users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_coverage_dates CHECK (valid_to >= valid_from),
  CONSTRAINT ux_coverage_member UNIQUE (payer_id, policy_number, member_id)
);
CREATE INDEX ix_coverages_patient ON hms_coverages (patient_id);

CREATE TABLE hms_eligibility_checks (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id        UUID NOT NULL REFERENCES hms_coverages (id),
  account_id         UUID REFERENCES hms_billing_accounts (id),
  outcome            TEXT NOT NULL CHECK (outcome IN ('Eligible', 'NotEligible', 'Unknown')),
  response_reference TEXT,
  notes              TEXT,
  checked_by         INTEGER NOT NULL REFERENCES hms_users (id),
  checked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_eligibility_coverage ON hms_eligibility_checks (coverage_id);
CREATE TRIGGER trg_eligibility_immutable BEFORE UPDATE OR DELETE ON hms_eligibility_checks
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- Pre-authorisation for an episode. Each decision or enhancement is a revision;
-- the row shows the latest.
CREATE TABLE hms_preauthorizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES hms_billing_accounts (id),
  coverage_id      UUID NOT NULL REFERENCES hms_coverages (id),
  requested_amount NUMERIC(14,2) NOT NULL CHECK (requested_amount > 0),
  status           TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Approved', 'PartiallyApproved', 'Denied', 'Cancelled')),
  approved_amount  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  payer_reference  TEXT,
  valid_until      DATE,
  revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  requested_by     INTEGER NOT NULL REFERENCES hms_users (id),
  requested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_preauth_amount CHECK (
       (status IN ('Requested', 'Denied', 'Cancelled') AND approved_amount = 0)
    OR (status = 'Approved' AND approved_amount > 0)
    OR (status = 'PartiallyApproved' AND approved_amount > 0 AND approved_amount < requested_amount))
);
CREATE INDEX ix_preauth_account ON hms_preauthorizations (account_id);
CREATE TABLE hms_preauth_revisions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preauth_id       UUID NOT NULL REFERENCES hms_preauthorizations (id),
  revision         INTEGER NOT NULL CHECK (revision > 0),
  status           TEXT NOT NULL,
  requested_amount NUMERIC(14,2) NOT NULL,
  approved_amount  NUMERIC(14,2) NOT NULL,
  payer_reference  TEXT,
  note             TEXT,
  recorded_by      INTEGER NOT NULL REFERENCES hms_users (id),
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_preauth_revision UNIQUE (preauth_id, revision)
);
CREATE TRIGGER trg_preauth_revisions_immutable BEFORE UPDATE OR DELETE ON hms_preauth_revisions
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- The payer responsible for part of an episode's bills. The co-pay percentage
-- is what the patient pays; the payer's share is capped by the approved
-- pre-authorisation still unused.
CREATE TABLE hms_account_payers (
  account_id    UUID PRIMARY KEY REFERENCES hms_billing_accounts (id),
  coverage_id   UUID NOT NULL REFERENCES hms_coverages (id),
  preauth_id    UUID NOT NULL REFERENCES hms_preauthorizations (id),
  copay_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (copay_percent >= 0 AND copay_percent <= 100),
  set_by        INTEGER NOT NULL REFERENCES hms_users (id),
  set_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Claims ──────────────────────────────────────────────────
CREATE SEQUENCE hms_claim_seq;
CREATE TABLE hms_claims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_number    TEXT NOT NULL UNIQUE,
  invoice_id      UUID NOT NULL UNIQUE REFERENCES hms_invoices (id),
  coverage_id     UUID NOT NULL REFERENCES hms_coverages (id),
  preauth_id      UUID REFERENCES hms_preauthorizations (id),
  claimed_amount  NUMERIC(14,2) NOT NULL CHECK (claimed_amount > 0),
  status          TEXT NOT NULL DEFAULT 'Prepared' CHECK (status IN ('Prepared', 'Submitted', 'Acknowledged', 'Adjudicated', 'Settled', 'Denied', 'Appealed')),
  approved_amount NUMERIC(14,2) CHECK (approved_amount >= 0),
  denied_amount   NUMERIC(14,2) CHECK (denied_amount >= 0),
  payer_reference TEXT,
  created_by      INTEGER NOT NULL REFERENCES hms_users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at    TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  adjudicated_at  TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  CONSTRAINT ck_claim_adjudication CHECK (
    (status IN ('Prepared', 'Submitted', 'Acknowledged')) = (approved_amount IS NULL AND denied_amount IS NULL)),
  CONSTRAINT ck_claim_adjudicated_sum CHECK (approved_amount IS NULL OR approved_amount + denied_amount = claimed_amount)
);
CREATE TABLE hms_claim_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES hms_claims (id),
  invoice_line_id UUID NOT NULL REFERENCES hms_invoice_lines (id),
  claimed_amount  NUMERIC(14,2) NOT NULL CHECK (claimed_amount >= 0),
  approved_amount NUMERIC(14,2) CHECK (approved_amount >= 0),
  denied_amount   NUMERIC(14,2) CHECK (denied_amount >= 0),
  denial_code     TEXT,
  denial_reason   TEXT,
  CONSTRAINT ux_claim_line UNIQUE (claim_id, invoice_line_id),
  CONSTRAINT ck_claim_line_sum CHECK (approved_amount IS NULL OR approved_amount + denied_amount = claimed_amount),
  CONSTRAINT ck_claim_line_denial CHECK (COALESCE(denied_amount, 0) = 0 OR length(btrim(denial_reason)) > 0)
);
CREATE FUNCTION billing_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Claims are kept' USING ERRCODE = 'restrict_violation'; END IF;
  IF (NEW.claim_number, NEW.invoice_id, NEW.coverage_id, NEW.claimed_amount, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.claim_number, OLD.invoice_id, OLD.coverage_id, OLD.claimed_amount, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'A claim keeps its invoice and amount' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status NOT IN ('Prepared', 'Submitted', 'Acknowledged') AND (NEW.approved_amount, NEW.denied_amount)
       IS DISTINCT FROM (OLD.approved_amount, OLD.denied_amount) THEN
    RAISE EXCEPTION 'An adjudication is recorded once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'Prepared' AND NEW.status = 'Submitted')
          OR (OLD.status = 'Submitted' AND NEW.status IN ('Acknowledged', 'Adjudicated'))
          OR (OLD.status = 'Acknowledged' AND NEW.status = 'Adjudicated')
          OR (OLD.status = 'Adjudicated' AND NEW.status IN ('Settled', 'Denied', 'Appealed'))
          OR (OLD.status = 'Appealed' AND NEW.status IN ('Settled', 'Denied'))) THEN
    RAISE EXCEPTION 'Claim cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_claim_guard BEFORE UPDATE OR DELETE ON hms_claims
  FOR EACH ROW EXECUTE FUNCTION billing_claim_guard();
CREATE FUNCTION billing_claim_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM hms_claims WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND (NEW.claim_id, NEW.invoice_line_id, NEW.claimed_amount) IS DISTINCT FROM (OLD.claim_id, OLD.invoice_line_id, OLD.claimed_amount)) THEN
    RAISE EXCEPTION 'Claim lines keep what was claimed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approved_amount IS NOT NULL THEN
    RAISE EXCEPTION 'A line adjudication is recorded once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'INSERT' AND st <> 'Prepared' THEN
    RAISE EXCEPTION 'Lines are added only while the claim is prepared' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_claim_line_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_claim_lines
  FOR EACH ROW EXECUTE FUNCTION billing_claim_line_guard();

-- Money from the payer. A remittance reference is recorded once per payer.
CREATE TABLE hms_remittances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id             UUID NOT NULL REFERENCES hms_claims (id),
  payer_id             UUID NOT NULL REFERENCES hms_payers (id),
  remittance_reference TEXT NOT NULL CHECK (length(btrim(remittance_reference)) BETWEEN 1 AND 100),
  amount               NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  received_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by          INTEGER NOT NULL REFERENCES hms_users (id),
  CONSTRAINT ux_remittance_reference UNIQUE (payer_id, remittance_reference)
);
CREATE TRIGGER trg_remittances_immutable BEFORE UPDATE OR DELETE ON hms_remittances
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();
-- The payer never pays more than it approved (plus denials it accepted on appeal).
CREATE FUNCTION billing_remittance_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved NUMERIC; paid NUMERIC; recovered NUMERIC;
BEGIN
  SELECT approved_amount INTO approved FROM hms_claims WHERE id = NEW.claim_id;
  SELECT COALESCE(sum(amount), 0) INTO paid FROM hms_remittances WHERE claim_id = NEW.claim_id;
  SELECT COALESCE(sum(amount), 0) INTO recovered FROM hms_denials WHERE claim_id = NEW.claim_id AND status = 'Recovered';
  IF approved IS NULL OR paid > approved + recovered THEN
    RAISE EXCEPTION 'A remittance needs an adjudicated claim and cannot exceed the approved amount' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_remittance_check AFTER INSERT ON hms_remittances
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_remittance_check();

-- Denied amounts form a worklist; each is resolved by an appeal, a write-off,
-- or by passing it to the patient (who then owes it on a debit note).
CREATE TABLE hms_denials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id        UUID NOT NULL REFERENCES hms_claims (id),
  claim_line_id   UUID REFERENCES hms_claim_lines (id),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  code            TEXT,
  reason          TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  status          TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Appealed', 'Recovered', 'WrittenOff', 'TransferredToPatient')),
  owner_user_id   INTEGER REFERENCES hms_users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by     INTEGER REFERENCES hms_users (id),
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  CONSTRAINT ck_denial_resolved CHECK ((status IN ('Recovered', 'WrittenOff', 'TransferredToPatient')) = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(btrim(resolution_note)) > 0))
);
CREATE INDEX ix_denials_status ON hms_denials (status);
CREATE FUNCTION billing_denial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Denials are kept' USING ERRCODE = 'restrict_violation'; END IF;
  IF (NEW.claim_id, NEW.claim_line_id, NEW.amount, NEW.code, NEW.reason, NEW.created_at)
     IS DISTINCT FROM (OLD.claim_id, OLD.claim_line_id, OLD.amount, OLD.code, OLD.reason, OLD.created_at) THEN
    RAISE EXCEPTION 'A denial keeps its amount and reason' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'Open' AND NEW.status IN ('Appealed', 'WrittenOff', 'TransferredToPatient'))
          OR (OLD.status = 'Appealed' AND NEW.status IN ('Recovered', 'WrittenOff', 'TransferredToPatient'))) THEN
    RAISE EXCEPTION 'Denial cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_denial_guard BEFORE UPDATE OR DELETE ON hms_denials
  FOR EACH ROW EXECUTE FUNCTION billing_denial_guard();

CREATE TRIGGER trg_audit_hms_payers AFTER INSERT OR UPDATE OR DELETE ON hms_payers FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_coverages AFTER INSERT OR UPDATE OR DELETE ON hms_coverages FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_eligibility_checks AFTER INSERT OR UPDATE OR DELETE ON hms_eligibility_checks FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_preauthorizations AFTER INSERT OR UPDATE OR DELETE ON hms_preauthorizations FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_preauth_revisions AFTER INSERT OR UPDATE OR DELETE ON hms_preauth_revisions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_account_payers AFTER INSERT OR UPDATE OR DELETE ON hms_account_payers FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_claims AFTER INSERT OR UPDATE OR DELETE ON hms_claims FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_claim_lines AFTER INSERT OR UPDATE OR DELETE ON hms_claim_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_remittances AFTER INSERT OR UPDATE OR DELETE ON hms_remittances FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_denials AFTER INSERT OR UPDATE OR DELETE ON hms_denials FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
