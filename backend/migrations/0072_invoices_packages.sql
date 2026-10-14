-- 0072: packages, invoices, credit and debit notes (blueprint 3.6 "Packages",
-- "Invoices: Issued documents are immutable; corrections are linked
-- documents"; fixed interpretation: "Discounts agreed before issuance affect
-- pricing. Later reductions require a credit note"; 4.4 invoice state machine
-- "Draft -> Issued -> PartiallyCredited/Credited, with controlled voiding").

-- ── Packages ────────────────────────────────────────────────
CREATE TABLE hms_packages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Za-z0-9:_.-]{1,60}$'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  created_by INTEGER REFERENCES hms_users (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_package_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   UUID NOT NULL REFERENCES hms_packages (id),
  version      INTEGER NOT NULL CHECK (version > 0),
  price        NUMERIC(14,2) NOT NULL CHECK (price >= 0),
  gst_rate     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  status       TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Retired')),
  provenance   TEXT NOT NULL CHECK (length(btrim(provenance)) > 0),
  created_by   INTEGER REFERENCES hms_users (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by INTEGER REFERENCES hms_users (id),
  activated_at TIMESTAMPTZ,
  CONSTRAINT ux_package_version UNIQUE (package_id, version),
  CONSTRAINT ck_package_activation CHECK (status = 'Draft' OR (activated_at IS NOT NULL AND activated_by IS NOT NULL))
);
CREATE UNIQUE INDEX ux_package_one_active ON hms_package_versions (package_id) WHERE status = 'Active';
-- What a package covers. An exclusion wins over an inclusion; an allowance
-- caps the quantity or the list value covered, beyond which charges are billed.
CREATE TABLE hms_package_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         UUID NOT NULL REFERENCES hms_package_versions (id),
  rule               TEXT NOT NULL CHECK (rule IN ('include', 'exclude')),
  category           TEXT NOT NULL CHECK (category IN ('Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service')),
  code               TEXT,
  allowance_quantity NUMERIC(18,6) CHECK (allowance_quantity > 0),
  allowance_amount   NUMERIC(14,2) CHECK (allowance_amount > 0),
  CONSTRAINT ck_package_rule_allowance CHECK (rule = 'include' OR (allowance_quantity IS NULL AND allowance_amount IS NULL)),
  CONSTRAINT ck_package_rule_one_allowance CHECK (allowance_quantity IS NULL OR allowance_amount IS NULL)
);
CREATE INDEX ix_package_rules_version ON hms_package_rules (version_id);

CREATE FUNCTION billing_package_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  IF TG_TABLE_NAME = 'hms_package_versions' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Package versions are kept' USING ERRCODE = 'restrict_violation'; END IF;
    IF OLD.status <> 'Draft' AND (NEW.price, NEW.gst_rate, NEW.version, NEW.package_id, NEW.provenance)
         IS DISTINCT FROM (OLD.price, OLD.gst_rate, OLD.version, OLD.package_id, OLD.provenance) THEN
      RAISE EXCEPTION 'An active or retired package version cannot change' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'Draft' AND NEW.status = 'Active') OR (OLD.status = 'Active' AND NEW.status = 'Retired')) THEN
      RAISE EXCEPTION 'Package version cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT status INTO st FROM hms_package_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF st <> 'Draft' THEN
    RAISE EXCEPTION 'Rules of an active or retired package version cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_package_version_guard BEFORE UPDATE OR DELETE ON hms_package_versions
  FOR EACH ROW EXECUTE FUNCTION billing_package_guard();
CREATE TRIGGER trg_package_rule_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_package_rules
  FOR EACH ROW EXECUTE FUNCTION billing_package_guard();

-- A package applied to an episode's account. Its price becomes one charge
-- event (source 'package'); the charges it covers stay on the account, so
-- stock usage remains traceable, and are invoiced at no extra cost.
CREATE TABLE hms_account_packages (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES hms_billing_accounts (id),
  package_version_id UUID NOT NULL REFERENCES hms_package_versions (id),
  applied_by         INTEGER NOT NULL REFERENCES hms_users (id),
  applied_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_account_package UNIQUE (account_id, package_version_id)
);
CREATE TRIGGER trg_account_packages_immutable BEFORE UPDATE OR DELETE ON hms_account_packages
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- ── Invoices ────────────────────────────────────────────────
CREATE SEQUENCE hms_invoice_seq;
CREATE SEQUENCE hms_credit_note_seq;
CREATE TABLE hms_invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number       TEXT UNIQUE,
  account_id           UUID NOT NULL REFERENCES hms_billing_accounts (id),
  patient_id           INTEGER NOT NULL REFERENCES hms_patients (id),
  kind                 TEXT NOT NULL DEFAULT 'final' CHECK (kind IN ('interim', 'final')),
  status               TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Issued', 'PartiallyCredited', 'Credited', 'Void')),
  subtotal             NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_amount           NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason      TEXT,
  discount_approved_by INTEGER REFERENCES hms_users (id),
  total                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- Who owes the total: an explicit allocation, never inferred from a "Paid" flag.
  payer_amount         NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (payer_amount >= 0),
  patient_amount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (patient_amount >= 0),
  revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by           INTEGER NOT NULL REFERENCES hms_users (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by            INTEGER REFERENCES hms_users (id),
  issued_at            TIMESTAMPTZ,
  voided_by            INTEGER REFERENCES hms_users (id),
  voided_at            TIMESTAMPTZ,
  void_reason          TEXT,
  -- The row written to hms_bills so older screens and reports see the invoice.
  legacy_bill_id       INTEGER UNIQUE REFERENCES hms_bills (id),
  CONSTRAINT ck_invoice_total CHECK (total = subtotal + gst_amount - discount_amount),
  CONSTRAINT ck_invoice_split CHECK (payer_amount + patient_amount = total),
  CONSTRAINT ck_invoice_discount CHECK (discount_amount = 0 OR (discount_approved_by IS NOT NULL AND length(btrim(discount_reason)) > 0)),
  CONSTRAINT ck_invoice_issued CHECK (status = 'Draft' OR (invoice_number IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL)),
  CONSTRAINT ck_invoice_void CHECK ((status = 'Void') = (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) > 0))
);
CREATE INDEX ix_invoices_account ON hms_invoices (account_id);
CREATE INDEX ix_invoices_patient ON hms_invoices (patient_id);
-- One draft at a time per account.
CREATE UNIQUE INDEX ux_invoice_one_draft ON hms_invoices (account_id) WHERE status = 'Draft';

CREATE TABLE hms_invoice_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id      UUID NOT NULL REFERENCES hms_invoices (id),
  line_no         INTEGER NOT NULL CHECK (line_no > 0),
  charge_event_id UUID NOT NULL REFERENCES hms_charge_events (id),
  category        TEXT NOT NULL,
  code            TEXT,
  description     TEXT NOT NULL,
  service_at      TIMESTAMPTZ NOT NULL,
  quantity        NUMERIC(18,6) NOT NULL,
  unit_price      NUMERIC(18,6) NOT NULL,
  -- list_amount is the charge's own price; amount is what this invoice bills
  -- (0 when a package covers the charge).
  list_amount     NUMERIC(14,2) NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  gst_rate        NUMERIC(5,2) NOT NULL,
  gst_amount      NUMERIC(14,2) NOT NULL,
  account_package_id UUID REFERENCES hms_account_packages (id),
  -- Set only when the invoice is voided, which frees the charge for a new invoice.
  released        BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT ux_invoice_line_no UNIQUE (invoice_id, line_no),
  CONSTRAINT ck_invoice_line_package CHECK ((account_package_id IS NULL AND amount = list_amount) OR (account_package_id IS NOT NULL AND amount = 0)),
  CONSTRAINT ck_invoice_line_gst CHECK (gst_amount = round(amount * gst_rate / 100, 2))
);
-- A charge is billed on one live invoice only.
CREATE UNIQUE INDEX ux_invoice_line_charge ON hms_invoice_lines (charge_event_id) WHERE NOT released;
CREATE INDEX ix_invoice_lines_invoice ON hms_invoice_lines (invoice_id);

-- Issued invoices are immutable: only the status moves along its machine, the
-- void fields are set once, and the legacy projection link is set once.
CREATE FUNCTION billing_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN RAISE EXCEPTION 'An issued invoice cannot be deleted' USING ERRCODE = 'restrict_violation'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.account_id <> OLD.account_id OR NEW.patient_id <> OLD.patient_id THEN
    RAISE EXCEPTION 'An invoice keeps its account' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'Draft' THEN
    IF NEW.status NOT IN ('Draft', 'Issued') THEN
      RAISE EXCEPTION 'A draft invoice can only be issued' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.invoice_number, NEW.kind, NEW.subtotal, NEW.gst_amount, NEW.discount_amount, NEW.discount_reason, NEW.discount_approved_by,
      NEW.total, NEW.payer_amount, NEW.patient_amount, NEW.revision, NEW.created_by, NEW.created_at, NEW.issued_by, NEW.issued_at)
     IS DISTINCT FROM
     (OLD.invoice_number, OLD.kind, OLD.subtotal, OLD.gst_amount, OLD.discount_amount, OLD.discount_reason, OLD.discount_approved_by,
      OLD.total, OLD.payer_amount, OLD.patient_amount, OLD.revision, OLD.created_by, OLD.created_at, OLD.issued_by, OLD.issued_at) THEN
    RAISE EXCEPTION 'An issued invoice cannot change; use a credit or debit note' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.legacy_bill_id IS NOT NULL AND NEW.legacy_bill_id IS DISTINCT FROM OLD.legacy_bill_id THEN
    RAISE EXCEPTION 'The legacy bill link is set once' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'Void' AND (NEW.status <> 'Void' OR (NEW.voided_by, NEW.voided_at, NEW.void_reason) IS DISTINCT FROM (OLD.voided_by, OLD.voided_at, OLD.void_reason)) THEN
    RAISE EXCEPTION 'A void invoice stays void' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT (NEW.status = OLD.status
          OR (OLD.status = 'Issued' AND NEW.status IN ('PartiallyCredited', 'Credited', 'Void'))
          OR (OLD.status = 'PartiallyCredited' AND NEW.status = 'Credited')) THEN
    RAISE EXCEPTION 'Invoice cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_invoice_guard BEFORE UPDATE OR DELETE ON hms_invoices
  FOR EACH ROW EXECUTE FUNCTION billing_invoice_guard();

CREATE FUNCTION billing_invoice_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM hms_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st = 'Draft' THEN RETURN COALESCE(NEW, OLD); END IF;
  -- Voiding releases the lines of an issued invoice; nothing else changes.
  IF TG_OP = 'UPDATE' AND st = 'Void' AND NOT OLD.released AND NEW.released
     AND (to_jsonb(NEW) - 'released') = (to_jsonb(OLD) - 'released') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Lines of an issued invoice cannot change' USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER trg_invoice_line_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION billing_invoice_line_guard();

-- ── Credit and debit notes ──────────────────────────────────
-- Authorised corrections to an issued invoice. A credit note reduces what is
-- owed; a debit note adds to it. Both are immutable once written.
CREATE TABLE hms_invoice_notes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_number    TEXT NOT NULL UNIQUE,
  invoice_id     UUID NOT NULL REFERENCES hms_invoices (id),
  kind           TEXT NOT NULL CHECK (kind IN ('credit', 'debit')),
  reason         TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  gst_amount     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gst_amount >= 0 AND gst_amount <= amount),
  payer_amount   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (payer_amount >= 0),
  patient_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (patient_amount >= 0),
  -- Returned medicine or another source the correction answers, once each.
  source_type    TEXT,
  source_key     TEXT,
  requested_by   INTEGER NOT NULL REFERENCES hms_users (id),
  approved_by    INTEGER NOT NULL REFERENCES hms_users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_note_split CHECK (payer_amount + patient_amount = amount),
  CONSTRAINT ck_note_source CHECK ((source_type IS NULL) = (source_key IS NULL)),
  CONSTRAINT ux_note_source UNIQUE (source_type, source_key)
);
CREATE INDEX ix_invoice_notes_invoice ON hms_invoice_notes (invoice_id);
CREATE TABLE hms_invoice_note_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         UUID NOT NULL REFERENCES hms_invoice_notes (id),
  invoice_line_id UUID REFERENCES hms_invoice_lines (id),
  category        TEXT NOT NULL CHECK (category IN ('Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service', 'Package')),
  description     TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  gst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gst_amount >= 0)
);
CREATE INDEX ix_invoice_note_lines_note ON hms_invoice_note_lines (note_id);
CREATE TRIGGER trg_invoice_notes_immutable BEFORE UPDATE OR DELETE ON hms_invoice_notes
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();
CREATE TRIGGER trg_invoice_note_lines_immutable BEFORE UPDATE OR DELETE ON hms_invoice_note_lines
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- Notes only on issued (not void) invoices; credits never exceed what was
-- billed plus debits, in total and per line, for the patient and the payer.
CREATE FUNCTION billing_note_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv hms_invoices;
  credits NUMERIC; debits NUMERIC; pcred NUMERIC; pdeb NUMERIC; ycred NUMERIC; ydeb NUMERIC;
BEGIN
  SELECT * INTO inv FROM hms_invoices WHERE id = NEW.invoice_id;
  IF inv.status NOT IN ('Issued', 'PartiallyCredited') THEN
    RAISE EXCEPTION 'Notes are raised only against an issued invoice that is not fully credited or void' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'credit'), 0), COALESCE(sum(amount) FILTER (WHERE kind = 'debit'), 0),
         COALESCE(sum(patient_amount) FILTER (WHERE kind = 'credit'), 0), COALESCE(sum(patient_amount) FILTER (WHERE kind = 'debit'), 0),
         COALESCE(sum(payer_amount) FILTER (WHERE kind = 'credit'), 0), COALESCE(sum(payer_amount) FILTER (WHERE kind = 'debit'), 0)
    INTO credits, debits, pcred, pdeb, ycred, ydeb
    FROM hms_invoice_notes WHERE invoice_id = NEW.invoice_id;
  IF credits > inv.total + debits OR pcred > inv.patient_amount + pdeb OR ycred > inv.payer_amount + ydeb THEN
    RAISE EXCEPTION 'Credit notes would exceed the amount billed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_invoice_note_check AFTER INSERT ON hms_invoice_notes
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_note_check();

CREATE FUNCTION billing_note_line_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_amount NUMERIC;
  credited NUMERIC;
BEGIN
  IF NEW.invoice_line_id IS NULL THEN RETURN NULL; END IF;
  SELECT l.amount + l.gst_amount INTO line_amount FROM hms_invoice_lines l
    JOIN hms_invoice_notes n ON n.invoice_id = l.invoice_id
   WHERE l.id = NEW.invoice_line_id AND n.id = NEW.note_id;
  IF line_amount IS NULL THEN
    RAISE EXCEPTION 'A note line must refer to a line of the same invoice' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(nl.amount + nl.gst_amount), 0) INTO credited FROM hms_invoice_note_lines nl
    JOIN hms_invoice_notes n ON n.id = nl.note_id
   WHERE nl.invoice_line_id = NEW.invoice_line_id AND n.kind = 'credit';
  IF credited > line_amount THEN
    RAISE EXCEPTION 'Credits on a line cannot exceed what the line billed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_invoice_note_line_check AFTER INSERT ON hms_invoice_note_lines
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION billing_note_line_check();

CREATE TRIGGER trg_audit_hms_packages AFTER INSERT OR UPDATE OR DELETE ON hms_packages FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_package_versions AFTER INSERT OR UPDATE OR DELETE ON hms_package_versions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_package_rules AFTER INSERT OR UPDATE OR DELETE ON hms_package_rules FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_account_packages AFTER INSERT OR UPDATE OR DELETE ON hms_account_packages FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_invoices AFTER INSERT OR UPDATE OR DELETE ON hms_invoices FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_invoice_lines AFTER INSERT OR UPDATE OR DELETE ON hms_invoice_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_invoice_notes AFTER INSERT OR UPDATE OR DELETE ON hms_invoice_notes FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_invoice_note_lines AFTER INSERT OR UPDATE OR DELETE ON hms_invoice_note_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
