-- Completion A4: private patient documents.
--
-- hms_patient_documents existed from the baseline (name, URL, type) but
-- nothing ever stored a file. It now records how each document is kept:
--   - where its encrypted file is, its SHA-256 and size;
--   - its type as recognised from the content;
--   - its state: Quarantined until checked, then Available or Rejected, or
--     Withdrawn with a reason;
--   - the scan result and the data key that encrypted it;
--   - a legal hold and a retention date.
-- Documents are never deleted while held or inside retention, and what a
-- document is never changes once stored.

ALTER TABLE hms_patient_documents
  ADD COLUMN storage_key TEXT CHECK (storage_key ~ '^[0-9]{4}/[0-9a-f-]{36}\.hmsdoc$'),
  ADD COLUMN sha256 TEXT CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN size_bytes BIGINT CHECK (size_bytes > 0),
  ADD COLUMN media_type TEXT CHECK (media_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  ADD COLUMN state TEXT CHECK (state IN ('Quarantined', 'Available', 'Rejected', 'Withdrawn')),
  ADD COLUMN scan JSONB CHECK (scan IS NULL OR jsonb_typeof(scan) = 'object'),
  ADD COLUMN key_id TEXT,
  ADD COLUMN legal_hold BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN legal_hold_reason TEXT,
  ADD COLUMN legal_hold_by INTEGER REFERENCES hms_users (id),
  ADD COLUMN legal_hold_at TIMESTAMPTZ,
  ADD COLUMN retain_until DATE,
  ADD COLUMN withdrawn_at TIMESTAMPTZ,
  ADD COLUMN withdrawn_by INTEGER REFERENCES hms_users (id),
  ADD COLUMN withdrawn_reason TEXT,
  ADD CONSTRAINT hms_patient_documents_hold_reason CHECK (NOT legal_hold OR length(btrim(legal_hold_reason)) >= 5),
  ADD CONSTRAINT hms_patient_documents_withdrawn CHECK ((state = 'Withdrawn') = (withdrawn_at IS NOT NULL)
    AND (withdrawn_at IS NULL OR (withdrawn_by IS NOT NULL AND length(btrim(withdrawn_reason)) >= 5))),
  ADD CONSTRAINT hms_patient_documents_stored CHECK (state IS NULL OR (sha256 IS NOT NULL AND size_bytes IS NOT NULL AND media_type IS NOT NULL));

CREATE FUNCTION patient_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.legal_hold OR OLD.retain_until >= current_date THEN
      RAISE EXCEPTION 'Patient document % is under legal hold or inside its retention period', OLD.id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  -- What was stored is fixed: the file, its fingerprint, its type and its patient.
  IF OLD.sha256 IS NOT NULL AND (NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
      OR NEW.media_type IS DISTINCT FROM OLD.media_type OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
      OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by) THEN
    RAISE EXCEPTION 'A stored patient document does not change; withdraw it and upload a new one' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.storage_key IS NOT NULL AND NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
    RAISE EXCEPTION 'A stored document file is not moved' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'Withdrawn' AND OLD.state IS DISTINCT FROM 'Withdrawn' AND NEW.legal_hold THEN
    RAISE EXCEPTION 'A document under legal hold cannot be withdrawn' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'Withdrawn' AND NEW.state IS DISTINCT FROM 'Withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn document is not restored; upload it again' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state IN ('Available', 'Rejected') AND NEW.state = 'Quarantined' THEN
    RAISE EXCEPTION 'A checked document does not return to quarantine' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_patient_documents_guard BEFORE UPDATE OR DELETE ON hms_patient_documents
  FOR EACH ROW EXECUTE FUNCTION patient_documents_guard();

CREATE INDEX ix_patient_documents_patient ON hms_patient_documents (patient_id, uploaded_at DESC);
