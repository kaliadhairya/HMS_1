-- 0012: practitioners and their credentials (blueprint 3.3: Practitioner,
-- PractitionerRole, Credential). A practitioner is a clinician, distinct from
-- the login account: a login is hms_users.id, a practitioner is
-- hms_practitioners.id, and the two are never interchangeable.
--
-- A practitioner with credentials that have ALL expired may not start or
-- sign clinical work (enforced by utils/practitioners.js). A practitioner
-- with no credentials recorded yet is not blocked: nothing invented, and
-- existing clinicians keep working until the owner records their registrations.

CREATE TABLE hms_practitioners (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES hms_users (id),
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE hms_practitioner_credentials (
  id             BIGSERIAL PRIMARY KEY,
  practitioner_id BIGINT NOT NULL REFERENCES hms_practitioners (id),
  kind           TEXT NOT NULL CHECK (kind IN ('medical_registration', 'specialist_registration', 'other')),
  identifier     TEXT NOT NULL CHECK (length(btrim(identifier)) > 0),
  issuing_body   TEXT NOT NULL CHECK (length(btrim(issuing_body)) > 0),
  valid_from     DATE NOT NULL,
  valid_to       DATE,
  verified_by    INTEGER REFERENCES hms_users (id),
  verified_at    TIMESTAMPTZ,
  ended_by       INTEGER REFERENCES hms_users (id),
  ended_reason   TEXT,
  created_by     INTEGER REFERENCES hms_users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_credential_validity CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT ck_credential_verified CHECK ((verified_at IS NULL) = (verified_by IS NULL)),
  -- A registration that was ended after recording says who ended it and why.
  CONSTRAINT ck_credential_ended CHECK ((ended_reason IS NULL) = (ended_by IS NULL))
);
CREATE INDEX ix_credentials_practitioner ON hms_practitioner_credentials (practitioner_id);
-- A verified registration number belongs to one practitioner per body.
CREATE UNIQUE INDEX ux_credentials_verified_identifier ON hms_practitioner_credentials (kind, issuing_body, identifier)
  WHERE verified_at IS NOT NULL;

CREATE TRIGGER trg_audit_hms_practitioners AFTER INSERT OR UPDATE OR DELETE ON hms_practitioners
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_practitioner_credentials AFTER INSERT OR UPDATE OR DELETE ON hms_practitioner_credentials
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- True when the practitioner has credentials and none is current today.
-- A credential is current when it has started and has not ended.
CREATE FUNCTION practitioner_credentials_expired(login_user_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM hms_practitioners p WHERE p.user_id = login_user_id)
     AND EXISTS (SELECT 1 FROM hms_practitioners p JOIN hms_practitioner_credentials c ON c.practitioner_id = p.id WHERE p.user_id = login_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM hms_practitioners p JOIN hms_practitioner_credentials c ON c.practitioner_id = p.id
        WHERE p.user_id = login_user_id
          AND c.valid_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date
          AND (c.valid_to IS NULL OR c.valid_to >= (now() AT TIME ZONE 'Asia/Kolkata')::date))
$$;

-- Backfill: every doctor login becomes a practitioner; the registration number
-- on each doctor profile becomes an UNVERIFIED medical registration, since
-- nobody has checked it against the council register yet.
INSERT INTO hms_practitioners (user_id, display_name)
SELECT u.id, COALESCE(NULLIF(btrim(u.name), ''), u.username)
  FROM hms_users u WHERE u.role = 'doctor'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO hms_practitioner_credentials (practitioner_id, kind, identifier, issuing_body, valid_from)
SELECT p.id, 'medical_registration', btrim(d.registration_number), 'not verified (migrated from doctor profile)', (now() AT TIME ZONE 'Asia/Kolkata')::date
  FROM hms_doctors d
  JOIN hms_practitioners p ON p.user_id = d.user_id
 WHERE d.registration_number IS NOT NULL AND btrim(d.registration_number) <> '';
