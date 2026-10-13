-- 0070: billing accounts, versioned charge master and charge events
-- (blueprint 3.6 "Billing": billing account, charge event, charge-master
-- version; "Every charge has a unique clinical/operational source and explicit
-- episode; no inferred admission based merely on the patient"; 3.7 revenue ERD).
--
-- One billing account per episode: an OPD encounter or an admission.
-- A charge event is recorded when the service happens, once per source
-- (source_type, source_key). Charge events are never changed or deleted; a
-- mistaken charge is cancelled by a linked reversal event.

CREATE FUNCTION billing_no_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Financial history is append-only (%)', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;

-- ── Billing accounts ────────────────────────────────────────
CREATE SEQUENCE hms_billing_account_seq;
CREATE TABLE hms_billing_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_number TEXT NOT NULL UNIQUE,
  patient_id     INTEGER NOT NULL REFERENCES hms_patients (id),
  episode_type   TEXT NOT NULL CHECK (episode_type IN ('encounter', 'admission')),
  encounter_id   INTEGER REFERENCES hms_encounters (id),
  admission_id   INTEGER REFERENCES hms_admissions (id),
  -- The bill raised for this episode before Phase 5, if any (shown for
  -- reference). Charges it covered are not recorded again (see 0071 backfill).
  legacy_bill_id INTEGER REFERENCES hms_bills (id),
  status         TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at      TIMESTAMPTZ,
  closed_by      INTEGER REFERENCES hms_users (id),
  CONSTRAINT ck_account_episode CHECK (
       (episode_type = 'encounter' AND encounter_id IS NOT NULL AND admission_id IS NULL)
    OR (episode_type = 'admission' AND admission_id IS NOT NULL AND encounter_id IS NULL)),
  CONSTRAINT ck_account_closed CHECK ((status = 'Closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CONSTRAINT ux_account_encounter UNIQUE (encounter_id),
  CONSTRAINT ux_account_admission UNIQUE (admission_id)
);
CREATE INDEX ix_billing_accounts_patient ON hms_billing_accounts (patient_id);

-- The account's patient is the episode's patient.
CREATE FUNCTION billing_account_patient_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_patient INTEGER;
BEGIN
  IF NEW.episode_type = 'encounter' THEN
    SELECT patient_id INTO episode_patient FROM hms_encounters WHERE id = NEW.encounter_id;
  ELSE
    SELECT patient_id INTO episode_patient FROM hms_admissions WHERE id = NEW.admission_id;
  END IF;
  IF episode_patient IS DISTINCT FROM NEW.patient_id THEN
    RAISE EXCEPTION 'Billing account patient % does not match the episode patient %', NEW.patient_id, episode_patient
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.patient_id, NEW.episode_type, NEW.encounter_id, NEW.admission_id, NEW.account_number)
       IS DISTINCT FROM (OLD.patient_id, OLD.episode_type, OLD.encounter_id, OLD.admission_id, OLD.account_number) THEN
    RAISE EXCEPTION 'A billing account keeps its patient and episode' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_billing_account_patient BEFORE INSERT OR UPDATE ON hms_billing_accounts
  FOR EACH ROW EXECUTE FUNCTION billing_account_patient_check();
CREATE TRIGGER trg_billing_account_no_delete BEFORE DELETE ON hms_billing_accounts
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- The account of an explicit episode, opened on first use. An admission wins
-- over an encounter only when the source names the admission.
CREATE FUNCTION billing_account_for(p_encounter_id INTEGER, p_admission_id INTEGER) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  acc UUID;
  pid INTEGER;
  legacy INTEGER;
BEGIN
  IF p_admission_id IS NOT NULL THEN
    SELECT id INTO acc FROM hms_billing_accounts WHERE admission_id = p_admission_id;
    IF acc IS NOT NULL THEN RETURN acc; END IF;
    SELECT patient_id INTO pid FROM hms_admissions WHERE id = p_admission_id;
    IF pid IS NULL THEN RAISE EXCEPTION 'Admission % not found', p_admission_id USING ERRCODE = 'foreign_key_violation'; END IF;
    SELECT id INTO legacy FROM hms_bills WHERE admission_id = p_admission_id AND bill_type = 'IPD'
       AND COALESCE(status, '') <> 'Cancelled' ORDER BY id LIMIT 1;
    INSERT INTO hms_billing_accounts (account_number, patient_id, episode_type, admission_id, legacy_bill_id)
    VALUES ('ACC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('hms_billing_account_seq')::text, 6, '0'),
            pid, 'admission', p_admission_id, legacy)
    ON CONFLICT (admission_id) DO NOTHING;
    SELECT id INTO acc FROM hms_billing_accounts WHERE admission_id = p_admission_id;
    RETURN acc;
  END IF;
  IF p_encounter_id IS NULL THEN
    RAISE EXCEPTION 'A charge needs an explicit encounter or admission' USING ERRCODE = 'not_null_violation';
  END IF;
  SELECT id INTO acc FROM hms_billing_accounts WHERE encounter_id = p_encounter_id;
  IF acc IS NOT NULL THEN RETURN acc; END IF;
  SELECT patient_id INTO pid FROM hms_encounters WHERE id = p_encounter_id;
  IF pid IS NULL THEN RAISE EXCEPTION 'Encounter % not found', p_encounter_id USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT id INTO legacy FROM hms_bills WHERE encounter_id = p_encounter_id
     AND COALESCE(status, '') <> 'Cancelled' ORDER BY id LIMIT 1;
  INSERT INTO hms_billing_accounts (account_number, patient_id, episode_type, encounter_id, legacy_bill_id)
  VALUES ('ACC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('hms_billing_account_seq')::text, 6, '0'),
          pid, 'encounter', p_encounter_id, legacy)
  ON CONFLICT (encounter_id) DO NOTHING;
  SELECT id INTO acc FROM hms_billing_accounts WHERE encounter_id = p_encounter_id;
  RETURN acc;
END $$;

-- ── Charge master (price list), versioned ───────────────────
-- A version is edited while Draft, then activated by an administrator; an
-- active or retired version never changes. Exactly one version is active.
CREATE TABLE hms_charge_master_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version        INTEGER NOT NULL UNIQUE CHECK (version > 0),
  status         TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Retired')),
  provenance     TEXT NOT NULL CHECK (length(btrim(provenance)) > 0),
  created_by     INTEGER REFERENCES hms_users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by   INTEGER REFERENCES hms_users (id),
  activated_at   TIMESTAMPTZ,
  retired_at     TIMESTAMPTZ,
  CONSTRAINT ck_cm_activation CHECK (status = 'Draft' OR activated_at IS NOT NULL),
  CONSTRAINT ck_cm_retired CHECK ((status = 'Retired') = (retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_charge_master_one_active ON hms_charge_master_versions ((true)) WHERE status = 'Active';

CREATE TABLE hms_charge_master_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  UUID NOT NULL REFERENCES hms_charge_master_versions (id),
  code        TEXT NOT NULL CHECK (code ~ '^[A-Za-z0-9:_.-]{1,60}$'),
  name        TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  category    TEXT NOT NULL CHECK (category IN ('Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service')),
  unit_price  NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  gst_rate    NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  -- Optional selectors: a doctor's own consultation fee, a ward type's daily
  -- rate, and the text a lab test name is matched against.
  doctor_id   INTEGER REFERENCES hms_users (id),
  ward_type   TEXT,
  match_name  TEXT,
  CONSTRAINT ux_cm_item_code UNIQUE (version_id, code)
);
CREATE INDEX ix_cm_items_category ON hms_charge_master_items (version_id, category);

CREATE FUNCTION billing_cm_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Charge master versions are kept' USING ERRCODE = 'restrict_violation'; END IF;
  IF OLD.status <> 'Draft' AND (NEW.version, NEW.provenance, NEW.created_by, NEW.created_at, NEW.activated_by, NEW.activated_at)
       IS DISTINCT FROM (OLD.version, OLD.provenance, OLD.created_by, OLD.created_at, OLD.activated_by, OLD.activated_at) THEN
    RAISE EXCEPTION 'An active or retired charge master version cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.status = NEW.status) OR (OLD.status = 'Draft' AND NEW.status = 'Active') OR (OLD.status = 'Active' AND NEW.status = 'Retired')) THEN
    RAISE EXCEPTION 'Charge master version cannot go from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cm_version_guard BEFORE UPDATE OR DELETE ON hms_charge_master_versions
  FOR EACH ROW EXECUTE FUNCTION billing_cm_version_guard();

CREATE FUNCTION billing_cm_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st TEXT;
BEGIN
  SELECT status INTO st FROM hms_charge_master_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF st <> 'Draft' THEN
    RAISE EXCEPTION 'Items of an active or retired charge master version cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    RAISE EXCEPTION 'An item stays in its version' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_cm_item_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_charge_master_items
  FOR EACH ROW EXECUTE FUNCTION billing_cm_item_guard();

-- Version 1: today's prices, taken from hms_tariffs and from the fallbacks that
-- were written in the code (routes/billing.js: consultation 200 and lab test
-- 100 when no tariff matched; routes/ipd.js WARD_RATES and its 400 default).
INSERT INTO hms_charge_master_versions (version, status, provenance)
VALUES (1, 'Draft', 'Migrated 0070: active rows of hms_tariffs, plus the price fallbacks in routes/billing.js (consultation 200, lab test 100) and routes/ipd.js (WARD_RATES: General 400, Private 800, Critical Care 400, Maternity 400, other wards 400).');
INSERT INTO hms_charge_master_items (version_id, code, name, category, unit_price, gst_rate, doctor_id, ward_type, match_name)
SELECT v.id, 'TARIFF-' || t.id, t.name,
       CASE WHEN t.category IN ('Consultation', 'Lab', 'Procedure', 'Ward') THEN t.category ELSE 'Service' END,
       t.rate, COALESCE(t.gst_rate, 0), t.doctor_id, t.ward_type,
       CASE WHEN t.category = 'Lab' THEN t.name END
  FROM hms_tariffs t CROSS JOIN hms_charge_master_versions v
 WHERE v.version = 1 AND COALESCE(t.is_active, 1) = 1;
INSERT INTO hms_charge_master_items (version_id, code, name, category, unit_price, ward_type)
SELECT v.id, x.code, x.name, x.category, x.price, x.ward_type
  FROM hms_charge_master_versions v CROSS JOIN (VALUES
    ('CONSULT-DEFAULT', 'Doctor consultation', 'Consultation', 200.00, NULL),
    ('LAB-DEFAULT', 'Laboratory test', 'Lab', 100.00, NULL),
    ('WARD-General', 'General ward bed day', 'Ward', 400.00, 'General'),
    ('WARD-Private', 'Private ward bed day', 'Ward', 800.00, 'Private'),
    ('WARD-Critical-Care', 'Critical care bed day', 'Ward', 400.00, 'Critical Care'),
    ('WARD-Maternity', 'Maternity ward bed day', 'Ward', 400.00, 'Maternity'),
    ('WARD-DEFAULT', 'Ward bed day', 'Ward', 400.00, NULL)
  ) AS x(code, name, category, price, ward_type)
 WHERE v.version = 1;
UPDATE hms_charge_master_versions SET status = 'Active', activated_at = now() WHERE version = 1;

-- ── Charge events ───────────────────────────────────────────
CREATE TABLE hms_charge_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            UUID NOT NULL REFERENCES hms_billing_accounts (id),
  source_type           TEXT NOT NULL CHECK (source_type IN
                          ('consultation', 'lab_order_item', 'medicine_dispense_line', 'medicine_return', 'ward_day', 'manual', 'ipd_draft', 'package', 'reversal')),
  source_key            TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  category              TEXT NOT NULL CHECK (category IN ('Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service', 'Package')),
  code                  TEXT,
  description           TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  charge_master_item_id UUID REFERENCES hms_charge_master_items (id),
  -- charge_master: priced from the active charge master; source: the source
  -- carries its price (a dispensed batch's MRP, tax inclusive, or a package
  -- version's price); manual: priced
  -- by an authorised user with a reason.
  price_basis           TEXT NOT NULL CHECK (price_basis IN ('charge_master', 'source', 'manual')),
  quantity              NUMERIC(18,6) NOT NULL CHECK (quantity <> 0),
  unit_price            NUMERIC(18,6) NOT NULL CHECK (unit_price >= 0),
  gst_rate              NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (gst_rate >= 0 AND gst_rate <= 100),
  amount                NUMERIC(14,2) NOT NULL,
  gst_amount            NUMERIC(14,2) NOT NULL,
  service_at            TIMESTAMPTZ NOT NULL,
  reverses_id           UUID UNIQUE REFERENCES hms_charge_events (id),
  reason                TEXT,
  posted_by             INTEGER REFERENCES hms_users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_charge_source UNIQUE (source_type, source_key),
  CONSTRAINT ck_charge_amount CHECK (amount = round(quantity * unit_price, 2)),
  CONSTRAINT ck_charge_gst CHECK (gst_amount = round(amount * gst_rate / 100, 2)),
  CONSTRAINT ck_charge_basis CHECK ((price_basis = 'charge_master') = (charge_master_item_id IS NOT NULL)),
  -- Negative quantities only for a reversal (mirrors one charge) or an
  -- authorised credit for returned medicine.
  CONSTRAINT ck_charge_reversal CHECK (
       (source_type = 'reversal' AND reverses_id IS NOT NULL AND quantity < 0 AND reason IS NOT NULL)
    OR (source_type = 'medicine_return' AND reverses_id IS NULL AND quantity < 0 AND reason IS NOT NULL AND posted_by IS NOT NULL)
    OR (source_type NOT IN ('reversal', 'medicine_return') AND reverses_id IS NULL AND quantity > 0)),
  CONSTRAINT ck_charge_manual CHECK (price_basis <> 'manual' OR (reason IS NOT NULL AND posted_by IS NOT NULL))
);
CREATE INDEX ix_charge_events_account ON hms_charge_events (account_id, service_at);
CREATE TRIGGER trg_charge_events_immutable BEFORE UPDATE OR DELETE ON hms_charge_events
  FOR EACH ROW EXECUTE FUNCTION billing_no_rewrite();

-- A reversal mirrors its charge exactly, on the same account.
CREATE FUNCTION billing_reversal_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE orig hms_charge_events;
BEGIN
  IF NEW.reverses_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO orig FROM hms_charge_events WHERE id = NEW.reverses_id;
  IF orig.source_type = 'reversal' THEN
    RAISE EXCEPTION 'A reversal cannot be reversed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.account_id <> orig.account_id OR NEW.quantity <> -orig.quantity OR NEW.unit_price <> orig.unit_price
     OR NEW.gst_rate <> orig.gst_rate OR NEW.category <> orig.category OR NEW.source_key <> orig.id::text THEN
    RAISE EXCEPTION 'A reversal must mirror the charge it reverses' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_charge_reversal_check BEFORE INSERT ON hms_charge_events
  FOR EACH ROW EXECUTE FUNCTION billing_reversal_check();

-- Record one charge for a source; a second call for the same source returns the
-- first charge (source uniqueness, blueprint 3.8).
CREATE FUNCTION billing_capture_charge(
  p_account UUID, p_source_type TEXT, p_source_key TEXT, p_category TEXT, p_code TEXT, p_description TEXT,
  p_item UUID, p_basis TEXT, p_quantity NUMERIC, p_unit_price NUMERIC, p_gst_rate NUMERIC,
  p_service_at TIMESTAMPTZ, p_user INTEGER, p_reason TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE
  cid UUID;
  amt NUMERIC := round(p_quantity * p_unit_price, 2);
BEGIN
  INSERT INTO hms_charge_events (account_id, source_type, source_key, category, code, description, charge_master_item_id,
                                 price_basis, quantity, unit_price, gst_rate, amount, gst_amount, service_at, posted_by, reason)
  VALUES (p_account, p_source_type, p_source_key, p_category, p_code, p_description, p_item,
          p_basis, p_quantity, p_unit_price, COALESCE(p_gst_rate, 0), amt, round(amt * COALESCE(p_gst_rate, 0) / 100, 2),
          COALESCE(p_service_at, now()), p_user, p_reason)
  ON CONFLICT (source_type, source_key) DO NOTHING
  RETURNING id INTO cid;
  IF cid IS NULL THEN
    SELECT id INTO cid FROM hms_charge_events WHERE source_type = p_source_type AND source_key = p_source_key;
  END IF;
  RETURN cid;
END $$;

-- Reverse a charge once; returns the reversal (the existing one on a repeat).
CREATE FUNCTION billing_reverse_charge(p_charge UUID, p_reason TEXT, p_user INTEGER) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  c hms_charge_events;
  rid UUID;
BEGIN
  SELECT * INTO c FROM hms_charge_events WHERE id = p_charge;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO rid FROM hms_charge_events WHERE reverses_id = p_charge;
  IF rid IS NOT NULL THEN RETURN rid; END IF;
  INSERT INTO hms_charge_events (account_id, source_type, source_key, category, code, description, charge_master_item_id,
                                 price_basis, quantity, unit_price, gst_rate, amount, gst_amount, service_at,
                                 reverses_id, reason, posted_by)
  VALUES (c.account_id, 'reversal', c.id::text, c.category, c.code, 'Reversal: ' || c.description, c.charge_master_item_id,
          c.price_basis, -c.quantity, c.unit_price, c.gst_rate, -c.amount, -c.gst_amount, now(),
          c.id, p_reason, p_user)
  ON CONFLICT (source_type, source_key) DO NOTHING
  RETURNING id INTO rid;
  IF rid IS NULL THEN SELECT id INTO rid FROM hms_charge_events WHERE reverses_id = p_charge; END IF;
  RETURN rid;
END $$;

-- Active charge master lookups.
CREATE FUNCTION billing_active_item(p_category TEXT, p_code TEXT) RETURNS hms_charge_master_items
LANGUAGE sql STABLE AS $$
  SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
   WHERE v.status = 'Active' AND i.category = p_category AND i.code = p_code
$$;

CREATE TRIGGER trg_audit_hms_billing_accounts AFTER INSERT OR UPDATE OR DELETE ON hms_billing_accounts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_charge_master_versions AFTER INSERT OR UPDATE OR DELETE ON hms_charge_master_versions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_charge_master_items AFTER INSERT OR UPDATE OR DELETE ON hms_charge_master_items FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_charge_events AFTER INSERT OR UPDATE OR DELETE ON hms_charge_events FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
