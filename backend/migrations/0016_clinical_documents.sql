-- 0016: clinical documents with expected versions, signing and amendments
-- (blueprint 3.4: ClinicalDocument, DocumentVersion, Signature; 3.8: "Save/sign
-- note: compare expected version; signing locks the aggregate and freezes the
-- submitted version"; 3.9: "Bind clinical signatures to the exact document version").
--
-- A document has one draft, saved with an expected version (If-Match). Signing
-- freezes the draft into an immutable signature row with a digest. Later
-- changes are amendments: a new signed version that links to the one it
-- amends and states the reason. Signature rows are append-only.

CREATE TABLE hms_clinical_documents (
  id               BIGSERIAL PRIMARY KEY,
  patient_id       INTEGER NOT NULL REFERENCES hms_patients (id),
  encounter_id     INTEGER REFERENCES hms_encounters (id),
  doc_type         TEXT NOT NULL CHECK (doc_type IN ('clinical_note')),
  author_user_id   INTEGER NOT NULL REFERENCES hms_users (id),
  state            TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'signed')),
  draft_content    JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_version    INTEGER NOT NULL DEFAULT 1 CHECK (draft_version >= 1),
  signed_version   INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A signed note always records its signed version. An amendment in progress keeps
  -- the version it amends, so signed_version is set once the first signature exists.
  CONSTRAINT ck_document_signed_version CHECK (state <> 'signed' OR signed_version IS NOT NULL)
);
CREATE INDEX ix_documents_patient ON hms_clinical_documents (patient_id, created_at DESC);

CREATE TABLE hms_document_signatures (
  id               BIGSERIAL PRIMARY KEY,
  document_id      BIGINT NOT NULL REFERENCES hms_clinical_documents (id),
  version          INTEGER NOT NULL CHECK (version >= 1),
  content          JSONB NOT NULL,
  digest           TEXT NOT NULL CHECK (length(digest) = 64),
  signed_by        INTEGER NOT NULL REFERENCES hms_users (id),
  signed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  meaning          TEXT NOT NULL CHECK (meaning IN ('authored and signed', 'amended and signed')),
  amends_version   INTEGER,
  amendment_reason TEXT,
  UNIQUE (document_id, version),
  CONSTRAINT ck_signature_amendment CHECK (
    (amends_version IS NULL AND amendment_reason IS NULL AND meaning = 'authored and signed')
    OR (amends_version IS NOT NULL AND amendment_reason IS NOT NULL AND meaning = 'amended and signed'))
);

CREATE FUNCTION document_signatures_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Signed clinical content is immutable; amend the document instead' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_document_signatures_append_only BEFORE UPDATE OR DELETE ON hms_document_signatures
  FOR EACH ROW EXECUTE FUNCTION document_signatures_append_only();

CREATE TRIGGER trg_audit_hms_clinical_documents AFTER INSERT OR UPDATE OR DELETE ON hms_clinical_documents
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_document_signatures AFTER INSERT OR UPDATE OR DELETE ON hms_document_signatures
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
