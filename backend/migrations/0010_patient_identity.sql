-- 0010: patient identity (blueprint 3.3, Phase 2 part 1). Expand only:
-- existing columns stay and keep working.
--
-- - identity_status: a registered patient, a temporary identity for an
--   unknown or unconscious arrival, or (later) a merged record.
-- - Identifiers (UHID, ABHA, external numbers) are their own rows with an
--   issuer and verification state. A verified identifier is unique in its
--   issuer's scope; the same patient may hold several.
-- - Related persons (guardians, emergency contacts, a newborn's mother) are
--   their own rows instead of three fixed columns.
-- - Age 0 (newborns) and estimated birth dates are allowed; "Unknown" is a
--   valid gender for an unidentified patient.

ALTER TABLE hms_patients
  ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'registered'
    CHECK (identity_status IN ('registered', 'temporary', 'merged')),
  ADD COLUMN birth_date_estimated BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT ck_patients_age_range CHECK (age BETWEEN 0 AND 130),
  ADD CONSTRAINT ck_patients_gender CHECK (gender IN ('Male', 'Female', 'Other', 'Unknown'));

CREATE TABLE hms_patient_identifiers (
  id                  BIGSERIAL PRIMARY KEY,
  patient_id          INTEGER NOT NULL REFERENCES hms_patients (id),
  system              TEXT NOT NULL CHECK (system IN ('UHID', 'ABHA_NUMBER', 'ABHA_ADDRESS', 'TEMPORARY', 'EXTERNAL_MRN', 'EMPLOYEE', 'PASSPORT')),
  value               TEXT NOT NULL CHECK (length(btrim(value)) > 0),
  issuer              TEXT NOT NULL DEFAULT 'this-hospital' CHECK (length(btrim(issuer)) > 0),
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'rejected')),
  verified_by         INTEGER REFERENCES hms_users (id),
  verified_at         TIMESTAMPTZ,
  valid_from          TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to            TIMESTAMPTZ,
  created_by          INTEGER REFERENCES hms_users (id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_identifier_verified_at CHECK ((verification_status = 'verified') = (verified_at IS NOT NULL)),
  CONSTRAINT ck_identifier_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- A verified, current identifier belongs to one patient within its issuer.
CREATE UNIQUE INDEX ux_identifiers_verified ON hms_patient_identifiers (system, issuer, value)
  WHERE verification_status = 'verified' AND valid_to IS NULL;
-- The same current identifier is not recorded twice for one patient.
CREATE UNIQUE INDEX ux_identifiers_per_patient ON hms_patient_identifiers (patient_id, system, issuer, value)
  WHERE valid_to IS NULL;
CREATE INDEX ix_identifiers_lookup ON hms_patient_identifiers (system, value) WHERE valid_to IS NULL;

CREATE TABLE hms_related_persons (
  id                   BIGSERIAL PRIMARY KEY,
  patient_id           INTEGER NOT NULL REFERENCES hms_patients (id),
  related_patient_id   INTEGER REFERENCES hms_patients (id),  -- e.g. a newborn's mother, when she is a patient
  name                 TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  relationship         TEXT NOT NULL CHECK (length(btrim(relationship)) > 0),
  phone                TEXT,
  is_guardian          BOOLEAN NOT NULL DEFAULT false,
  is_emergency_contact BOOLEAN NOT NULL DEFAULT false,
  valid_from           TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to             TIMESTAMPTZ,
  created_by           INTEGER REFERENCES hms_users (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_related_not_self CHECK (related_patient_id IS NULL OR related_patient_id <> patient_id),
  CONSTRAINT ck_related_validity CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX ix_related_persons_patient ON hms_related_persons (patient_id) WHERE valid_to IS NULL;
CREATE INDEX ix_related_persons_related ON hms_related_persons (related_patient_id) WHERE related_patient_id IS NOT NULL;

CREATE TRIGGER trg_audit_hms_patient_identifiers AFTER INSERT OR UPDATE OR DELETE ON hms_patient_identifiers
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_related_persons AFTER INSERT OR UPDATE OR DELETE ON hms_related_persons
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- Every patient's UHID is recorded as a verified identifier, whichever code
-- path registers the patient.
CREATE FUNCTION record_patient_uhid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.uhid IS NOT NULL AND btrim(NEW.uhid) <> '' THEN
    INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_at, verified_by, created_by)
    VALUES (NEW.id, 'UHID', NEW.uhid, 'this-hospital', 'verified', now(),
            (SELECT u.id FROM hms_users u WHERE u.id = NEW.registeredby),
            (SELECT u.id FROM hms_users u WHERE u.id = NEW.registeredby));
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_patient_uhid_identifier AFTER INSERT ON hms_patients
  FOR EACH ROW EXECUTE FUNCTION record_patient_uhid();

-- Backfill. Every UHID is a hospital-issued, verified identifier as of the
-- patient's registration; employee numbers are recorded unverified; existing
-- emergency contacts become related persons.
INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_at, valid_from, created_by, created_at)
SELECT p.id, 'UHID', p.uhid, 'this-hospital', 'verified', p.created_at, p.created_at,
       (SELECT u.id FROM hms_users u WHERE u.id = p.registeredby), p.created_at
FROM hms_patients p WHERE p.uhid IS NOT NULL AND btrim(p.uhid) <> '';

INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, created_by, created_at, valid_from)
SELECT p.id, 'EMPLOYEE', btrim(p.empnumber), 'employer', (SELECT u.id FROM hms_users u WHERE u.id = p.registeredby), p.created_at, p.created_at
FROM hms_patients p WHERE p.empnumber IS NOT NULL AND btrim(p.empnumber) <> '';

INSERT INTO hms_related_persons (patient_id, name, relationship, phone, is_emergency_contact, created_by, created_at, valid_from)
SELECT p.id, btrim(p.emergency_contact_name), COALESCE(NULLIF(btrim(p.emergency_contact_relation), ''), 'Unspecified'),
       NULLIF(btrim(p.emergency_contact_phone), ''), true, (SELECT u.id FROM hms_users u WHERE u.id = p.registeredby), p.created_at, p.created_at
FROM hms_patients p WHERE p.emergency_contact_name IS NOT NULL AND btrim(p.emergency_contact_name) <> '';
