-- 0073: financial journal (blueprint 3.6 "Financial journal: Balanced
-- debits/credits; immutable postings; one posting per business source").
--
-- Every financial event (invoice issued or voided, note, receipt, deposit
-- allocation, refund, remittance, denial write-off) posts one journal entry,
-- keyed by its source. An entry balances, has at least two lines, and is never
-- changed; a correction is a new entry.

CREATE TABLE hms_gl_accounts (
  code TEXT PRIMARY KEY CHECK (code ~ '^[0-9]{4}$'),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'expense'))
);
INSERT INTO hms_gl_accounts (code, name, kind) VALUES
  ('1000', 'Cash on hand', 'asset'),
  ('1010', 'Card and UPI clearing', 'asset'),
  ('1020', 'Bank', 'asset'),
  ('1100', 'Patient receivables', 'asset'),
  ('1110', 'Payer receivables', 'asset'),
  ('2000', 'Patient deposits', 'liability'),
  ('2100', 'GST payable', 'liability'),
  ('2300', 'Patient credit balances', 'liability'),
  ('3900', 'Opening balances (Phase 5 migration)', 'equity'),
  ('4000', 'Consultation revenue', 'revenue'),
  ('4010', 'Laboratory revenue', 'revenue'),
  ('4020', 'Pharmacy revenue', 'revenue'),
  ('4030', 'Ward revenue', 'revenue'),
  ('4040', 'Procedure and service revenue', 'revenue'),
  ('4050', 'Package revenue', 'revenue'),
  ('4900', 'Discounts and credit notes', 'contra_revenue'),
  ('5900', 'Payer denials written off', 'expense');
CREATE TRIGGER trg_gl_accounts_immutable BEFORE UPDATE OR DELETE ON hms_gl_accounts
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

CREATE TABLE hms_journal_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no    BIGSERIAL NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type ~ '^[a-z_]{3,40}$'),
  source_key  TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  account_id  UUID REFERENCES hms_billing_accounts (id),
  patient_id  INTEGER REFERENCES hms_patients (id),
  memo        TEXT NOT NULL CHECK (length(btrim(memo)) > 0),
  posted_by   INTEGER REFERENCES hms_users (id),
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_journal_source UNIQUE (source_type, source_key)
);
CREATE INDEX ix_journal_entries_account ON hms_journal_entries (account_id);

CREATE TABLE hms_journal_lines (
  id       BIGSERIAL PRIMARY KEY,
  entry_id UUID NOT NULL REFERENCES hms_journal_entries (id),
  gl_code  TEXT NOT NULL REFERENCES hms_gl_accounts (code),
  debit    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit   NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CONSTRAINT ck_journal_one_side CHECK ((debit > 0) <> (credit > 0))
);
CREATE INDEX ix_journal_lines_entry ON hms_journal_lines (entry_id);
CREATE INDEX ix_journal_lines_gl ON hms_journal_lines (gl_code);

CREATE TRIGGER trg_journal_entries_immutable BEFORE UPDATE OR DELETE ON hms_journal_entries
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();
CREATE TRIGGER trg_journal_lines_immutable BEFORE UPDATE OR DELETE ON hms_journal_lines
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- Checked at commit, once all of an entry's lines are written.
CREATE FUNCTION billing_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  eid UUID;
  d NUMERIC; c NUMERIC; n INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'hms_journal_entries' THEN eid := NEW.id; ELSE eid := NEW.entry_id; END IF;
  SELECT COALESCE(sum(debit), 0), COALESCE(sum(credit), 0), count(*) INTO d, c, n FROM hms_journal_lines WHERE entry_id = eid;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'Journal entry % does not balance (% lines, debit %, credit %)', eid, n, d, c USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_journal_entry_balanced AFTER INSERT ON hms_journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_journal_balanced();
CREATE CONSTRAINT TRIGGER trg_journal_line_balanced AFTER INSERT ON hms_journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION billing_journal_balanced();

-- GL account for a revenue category.
CREATE FUNCTION billing_revenue_gl(p_category TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_category
    WHEN 'Consultation' THEN '4000' WHEN 'Lab' THEN '4010' WHEN 'Medicine' THEN '4020'
    WHEN 'Ward' THEN '4030' WHEN 'Package' THEN '4050' ELSE '4040' END
$$;

CREATE TRIGGER trg_audit_hms_gl_accounts AFTER INSERT OR UPDATE OR DELETE ON hms_gl_accounts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_journal_entries AFTER INSERT OR UPDATE OR DELETE ON hms_journal_entries FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_journal_lines AFTER INSERT OR UPDATE OR DELETE ON hms_journal_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
