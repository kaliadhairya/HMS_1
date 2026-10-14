-- Phase 6C-6E: ABDM. M1 (ABHA verification and creation, profile share),
-- M2 (the hospital as HIP: care contexts, linking, consent, sending records)
-- and M3 (the hospital as HIU: consent requests, receiving records).
--
-- - An ABHA becomes a verified identifier only through ABDM verification,
--   and only when ABDM's demographics agree with the chart; otherwise the
--   difference waits for a person. A match never merges charts.
-- - A consent is checked when it is used, not only when it arrives: status,
--   validity, purpose, record types, care contexts and date range.
-- - What was sent, to whom and under which consent is recorded per document.
-- - Records received from other facilities are outside information until a
--   clinician reviews them; they never become local orders or allergies by
--   themselves. A revoked or expired consent withdraws them.
-- OTPs and Aadhaar numbers are never stored.

-- How an identifier was verified: by staff (a card seen at the counter) or
-- by ABDM. Only ABDM-verified ABHA identifiers are used for ABDM and FHIR.
ALTER TABLE hms_patient_identifiers ADD COLUMN verified_via TEXT CHECK (verified_via IN ('staff', 'abdm'));
UPDATE hms_patient_identifiers SET verified_via = 'staff' WHERE verification_status = 'verified';
-- Existing writers that verify an identifier (registration, staff checks)
-- mean the hospital verified it; only the ABDM flow says 'abdm'.
CREATE FUNCTION identifier_verified_via_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verification_status = 'verified' AND NEW.verified_via IS NULL THEN NEW.verified_via := 'staff'; END IF;
  IF NEW.verification_status <> 'verified' THEN NEW.verified_via := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_identifier_verified_via BEFORE INSERT OR UPDATE ON hms_patient_identifiers
  FOR EACH ROW EXECUTE FUNCTION identifier_verified_via_default();
ALTER TABLE hms_patient_identifiers ADD CONSTRAINT ck_identifier_verified_via CHECK ((verification_status = 'verified') = (verified_via IS NOT NULL));

CREATE TABLE hms_abha_verifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  purpose            TEXT NOT NULL CHECK (purpose IN ('verify', 'enrol')),
  method             TEXT NOT NULL CHECK (method IN ('mobile_otp', 'aadhaar_otp', 'abha_otp')),
  login_hint         TEXT,
  gateway_txn_id     TEXT,
  status             TEXT NOT NULL DEFAULT 'OtpSent' CHECK (status IN ('OtpSent', 'Verified', 'Mismatch', 'Conflict', 'Failed', 'Expired')),
  abha_number        TEXT CHECK (abha_number IS NULL OR abha_number ~ '^\d{14}$'),
  abha_address       TEXT,
  profile            JSONB,
  differences        JSONB,
  requested_by       INTEGER NOT NULL REFERENCES hms_users (id),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at       TIMESTAMPTZ,
  CHECK ((status = 'OtpSent') = (completed_at IS NULL)),
  CHECK (status <> 'Verified' OR abha_number IS NOT NULL)
);
CREATE INDEX hms_abha_verifications_patient ON hms_abha_verifications (patient_id, requested_at DESC);

-- A patient shares their ABHA profile at the counter (scan and share). Staff
-- choose the chart, or register a new patient; it is never matched by itself.
CREATE TABLE hms_abdm_profile_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      TEXT NOT NULL UNIQUE,
  hip_counter     TEXT,
  token_number    INTEGER NOT NULL,
  abha_number     TEXT,
  abha_address    TEXT NOT NULL,
  profile         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'Waiting' CHECK (status IN ('Waiting', 'Linked', 'Dismissed')),
  patient_id      INTEGER REFERENCES hms_patients (id),
  handled_by      INTEGER REFERENCES hms_users (id),
  handled_at      TIMESTAMPTZ,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'Waiting') = (handled_at IS NULL)),
  CHECK (status <> 'Linked' OR patient_id IS NOT NULL)
);
CREATE SEQUENCE hms_abdm_share_token_seq;

-- A visit or admission made available to the patient's ABHA.
CREATE TABLE hms_abdm_care_contexts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     INTEGER NOT NULL REFERENCES hms_patients (id),
  encounter_id   INTEGER REFERENCES hms_encounters (id),
  admission_id   INTEGER REFERENCES hms_admissions (id),
  reference      TEXT NOT NULL UNIQUE,
  display        TEXT NOT NULL,
  hi_types       TEXT[] NOT NULL CHECK (hi_types <@ ARRAY['OPConsultation', 'DiagnosticReport', 'Prescription', 'DischargeSummary', 'ImmunizationRecord', 'HealthDocumentRecord', 'WellnessRecord']::text[] AND cardinality(hi_types) > 0),
  abha_address   TEXT,
  link_status    TEXT NOT NULL DEFAULT 'NotLinked' CHECK (link_status IN ('NotLinked', 'Linking', 'Linked', 'Failed')),
  linked_via     TEXT CHECK (linked_via IN ('hip', 'patient')),
  linked_at      TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((encounter_id IS NULL) <> (admission_id IS NULL)),
  CHECK ((link_status = 'Linked') = (linked_at IS NOT NULL)),
  UNIQUE (encounter_id), UNIQUE (admission_id)
);

-- Patient-initiated linking: the OTP the hospital sent (hash only).
CREATE TABLE hms_abdm_link_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   TEXT NOT NULL,
  link_ref         TEXT NOT NULL UNIQUE,
  patient_id       INTEGER NOT NULL REFERENCES hms_patients (id),
  abha_address     TEXT NOT NULL,
  care_context_ids UUID[] NOT NULL CHECK (cardinality(care_context_ids) > 0),
  otp_hash         TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at       TIMESTAMPTZ NOT NULL,
  status           TEXT NOT NULL DEFAULT 'OtpSent' CHECK (status IN ('OtpSent', 'Linked', 'Failed', 'Expired')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consent artefacts, as HIP (we send) or HIU (we receive).
CREATE TABLE hms_abdm_consents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role              TEXT NOT NULL CHECK (role IN ('HIP', 'HIU')),
  consent_id        TEXT NOT NULL,
  consent_request_id TEXT,
  patient_id        INTEGER REFERENCES hms_patients (id),
  abha_address      TEXT NOT NULL,
  purpose           TEXT NOT NULL CHECK (length(btrim(purpose)) > 0),
  hi_types          TEXT[] NOT NULL CHECK (cardinality(hi_types) > 0),
  care_contexts     JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(care_contexts) = 'array'),
  date_from         TIMESTAMPTZ NOT NULL,
  date_to           TIMESTAMPTZ NOT NULL,
  data_erase_at     TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('GRANTED', 'REVOKED', 'EXPIRED', 'DENIED')),
  artefact          JSONB NOT NULL,
  requester         JSONB,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (role, consent_id),
  CHECK (date_to >= date_from)
);
-- A consent can only lose its force: GRANTED -> REVOKED/EXPIRED. The terms
-- themselves never change.
CREATE FUNCTION abdm_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Consents are kept for the record' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.role, NEW.consent_id, NEW.purpose, NEW.hi_types, NEW.care_contexts, NEW.date_from, NEW.date_to, NEW.data_erase_at, NEW.artefact, NEW.abha_address)
     IS DISTINCT FROM (OLD.role, OLD.consent_id, OLD.purpose, OLD.hi_types, OLD.care_contexts, OLD.date_from, OLD.date_to, OLD.data_erase_at, OLD.artefact, OLD.abha_address) THEN
    RAISE EXCEPTION 'The terms of a consent cannot change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'GRANTED' AND NEW.status IN ('REVOKED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'A consent goes GRANTED -> REVOKED/EXPIRED (not % -> %)', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_abdm_consent_guard BEFORE UPDATE OR DELETE ON hms_abdm_consents FOR EACH ROW EXECUTE FUNCTION abdm_consent_guard();

-- HIP: a request for records under a consent, and what was sent.
CREATE TABLE hms_abdm_hi_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  TEXT NOT NULL UNIQUE,
  consent_id      TEXT NOT NULL,
  date_from       TIMESTAMPTZ NOT NULL,
  date_to         TIMESTAMPTZ NOT NULL,
  data_push_url   TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('Refused', 'Queued', 'Sent', 'Failed')),
  refusal         TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  CHECK ((status = 'Refused') = (refusal IS NOT NULL))
);
CREATE TABLE hms_abdm_hi_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id      UUID NOT NULL REFERENCES hms_abdm_hi_transfers (id),
  care_context_ref TEXT NOT NULL,
  hi_type          TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, document_id)
);

-- HIU: our consent requests and what came back.
CREATE TABLE hms_abdm_consent_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         TEXT NOT NULL UNIQUE,
  consent_request_id TEXT UNIQUE,
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  abha_address       TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  hi_types           TEXT[] NOT NULL CHECK (cardinality(hi_types) > 0),
  date_from          TIMESTAMPTZ NOT NULL,
  date_to            TIMESTAMPTZ NOT NULL,
  expires_at         TIMESTAMPTZ NOT NULL,
  status             TEXT NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Pending', 'Granted', 'Denied', 'Expired', 'Revoked', 'Failed')),
  requested_by       INTEGER NOT NULL REFERENCES hms_users (id),
  requested_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from AND expires_at > requested_at)
);
CREATE TABLE hms_abdm_hiu_keys (
  transaction_id  TEXT PRIMARY KEY,
  consent_id      TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  nonce           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at         TIMESTAMPTZ
);
CREATE TABLE hms_abdm_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id       TEXT NOT NULL,
  transaction_id   TEXT NOT NULL,
  patient_id       INTEGER NOT NULL REFERENCES hms_patients (id),
  source_hip       TEXT,
  care_context_ref TEXT NOT NULL,
  document         JSONB NOT NULL,
  sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status           TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Withdrawn')),
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at     TIMESTAMPTZ,
  UNIQUE (transaction_id, sha256)
);
CREATE TABLE hms_abdm_import_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id      UUID NOT NULL REFERENCES hms_abdm_imports (id),
  resource_type  TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  summary        TEXT NOT NULL,
  needs_review   BOOLEAN NOT NULL,
  decision       TEXT CHECK (decision IN ('Accepted', 'Rejected', 'Seen')),
  decided_by     INTEGER REFERENCES hms_users (id),
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  UNIQUE (import_id, resource_type, resource_id),
  CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL))
);

CREATE TRIGGER trg_audit_hms_abha_verifications AFTER INSERT OR UPDATE OR DELETE ON hms_abha_verifications FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_profile_shares AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_profile_shares FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_care_contexts AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_care_contexts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_link_requests AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_link_requests FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_consents AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_consents FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_hi_transfers AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_hi_transfers FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_hi_documents AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_hi_documents FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_consent_requests AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_consent_requests FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_hiu_keys AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_hiu_keys FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_abdm_import_items AFTER INSERT OR UPDATE OR DELETE ON hms_abdm_import_items FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
-- Imported documents are whole health records from another facility; their
-- arrival is audited through hms_abdm_import_items and the interface log, so
-- the documents themselves are not copied into the audit log (blueprint 3.12).
