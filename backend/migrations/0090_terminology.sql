-- Phase 6A: terminology releases, concepts, reviewed mappings, and coded
-- diagnoses that keep the release they were coded with.
--
-- - A code system (ICD-10, SNOMED CT, LOINC, UCUM) is only an identifier.
--   No codes are seeded: each release is loaded from the licensed file by
--   scripts/terminology-load.js, with its source, licence acceptance and file
--   checksum, and is never changed afterwards.
-- - At most one release per system is Active; older releases stay, so old
--   records keep their meaning.
-- - A local code (a lab test, a unit, a product) maps to a standard concept
--   only after a second person approves it.
-- - Diagnoses recorded before this migration have no known edition; they are
--   marked LEGACY_UNVERSIONED, never guessed.

CREATE TABLE hms_term_systems (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,30}$'),
  uri        TEXT NOT NULL UNIQUE CHECK (uri ~ '^(https?|urn):'),
  name       TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  licence    TEXT NOT NULL CHECK (length(btrim(licence)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The systems' public identifiers (FHIR system URIs). Not clinical content.
INSERT INTO hms_term_systems (code, uri, name, licence) VALUES
  ('ICD10', 'http://hl7.org/fhir/sid/icd-10', 'ICD-10', 'WHO ICD-10 terms of use; the edition is chosen by the hospital'),
  ('SNOMEDCT', 'http://snomed.info/sct', 'SNOMED CT', 'SNOMED CT affiliate licence (in India through NRCeS)'),
  ('LOINC', 'http://loinc.org', 'LOINC', 'LOINC licence, accepted by a named person'),
  ('UCUM', 'http://unitsofmeasure.org', 'UCUM units', 'UCUM terms of use');

CREATE TABLE hms_term_releases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id            UUID NOT NULL REFERENCES hms_term_systems (id),
  version              TEXT NOT NULL CHECK (length(btrim(version)) > 0),
  released_on          DATE,
  source               TEXT NOT NULL CHECK (length(btrim(source)) >= 5),
  licence_ack          TEXT NOT NULL CHECK (length(btrim(licence_ack)) >= 5),
  file_name            TEXT NOT NULL CHECK (length(btrim(file_name)) > 0),
  file_sha256          TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  format               TEXT NOT NULL CHECK (format IN ('tsv', 'loinc-csv', 'snomed-rf2')),
  concept_count        INTEGER CHECK (concept_count > 0),
  status               TEXT NOT NULL DEFAULT 'Loaded' CHECK (status IN ('Loaded', 'Active', 'Retired')),
  loaded_by_user_id    INTEGER NOT NULL REFERENCES hms_users (id),
  loaded_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by_user_id INTEGER REFERENCES hms_users (id),
  activated_at         TIMESTAMPTZ,
  retired_by_user_id   INTEGER REFERENCES hms_users (id),
  retired_at           TIMESTAMPTZ,
  UNIQUE (system_id, version),
  UNIQUE (system_id, file_sha256),
  UNIQUE (id, system_id),
  CHECK ((status = 'Loaded') = (activated_at IS NULL)),
  CHECK ((activated_at IS NULL) = (activated_by_user_id IS NULL)),
  CHECK ((status = 'Retired') = (retired_at IS NOT NULL)),
  CHECK ((retired_at IS NULL) = (retired_by_user_id IS NULL)),
  CHECK (status = 'Loaded' OR concept_count IS NOT NULL)
);
CREATE UNIQUE INDEX hms_term_releases_one_active ON hms_term_releases (system_id) WHERE status = 'Active';

-- A release's identity never changes. Allowed: concept_count set once by the
-- loader, Loaded -> Active -> Retired (a Retired release was Active once).
CREATE FUNCTION term_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Terminology releases are kept for the record' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.system_id, NEW.version, NEW.released_on, NEW.source, NEW.licence_ack, NEW.file_name, NEW.file_sha256, NEW.format, NEW.loaded_by_user_id, NEW.loaded_at)
     IS DISTINCT FROM
     (OLD.id, OLD.system_id, OLD.version, OLD.released_on, OLD.source, OLD.licence_ack, OLD.file_name, OLD.file_sha256, OLD.format, OLD.loaded_by_user_id, OLD.loaded_at) THEN
    RAISE EXCEPTION 'A terminology release cannot be changed; load a new release' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.concept_count IS NOT NULL AND NEW.concept_count IS DISTINCT FROM OLD.concept_count THEN
    RAISE EXCEPTION 'The concept count of a loaded release is fixed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'Loaded' AND NEW.status = 'Active') OR (OLD.status = 'Active' AND NEW.status = 'Retired')) THEN
    RAISE EXCEPTION 'A release goes Loaded -> Active -> Retired (not % -> %)', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.activated_at IS NOT NULL AND (NEW.activated_at, NEW.activated_by_user_id) IS DISTINCT FROM (OLD.activated_at, OLD.activated_by_user_id))
     OR (OLD.retired_at IS NOT NULL AND (NEW.retired_at, NEW.retired_by_user_id) IS DISTINCT FROM (OLD.retired_at, OLD.retired_by_user_id)) THEN
    RAISE EXCEPTION 'Activation and retirement records are fixed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_term_release_guard BEFORE UPDATE OR DELETE ON hms_term_releases
  FOR EACH ROW EXECUTE FUNCTION term_release_guard();

-- Concepts of a release, exactly as in the loaded file. Reference content:
-- the audited release row records who loaded which file (checksum and count),
-- so the rows themselves are not copied into the audit log (SNOMED CT has
-- several hundred thousand). They can only be added while the release is
-- being loaded and are never changed or removed.
CREATE TABLE hms_term_concepts (
  release_id UUID NOT NULL REFERENCES hms_term_releases (id),
  code       TEXT NOT NULL CHECK (length(btrim(code)) > 0 AND length(code) <= 64),
  display    TEXT NOT NULL CHECK (length(btrim(display)) > 0),
  active     BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (release_id, code)
);
CREATE INDEX hms_term_concepts_display_trgm ON hms_term_concepts USING gin (display gin_trgm_ops);
CREATE INDEX hms_term_concepts_code ON hms_term_concepts (release_id, code text_pattern_ops);

CREATE FUNCTION term_concept_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Concepts of a terminology release never change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hms_term_releases WHERE id = NEW.release_id AND status = 'Loaded' AND concept_count IS NULL) THEN
    RAISE EXCEPTION 'Concepts can only be added while their release is being loaded' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_term_concept_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_term_concepts
  FOR EACH ROW EXECUTE FUNCTION term_concept_guard();
CREATE TRIGGER trg_term_concept_no_truncate BEFORE TRUNCATE ON hms_term_concepts
  FOR EACH STATEMENT EXECUTE FUNCTION term_concept_guard();

-- Local code -> standard concept, proposed by one person and approved by
-- another. Only Approved mappings are used for exchange.
CREATE TABLE hms_term_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system       TEXT NOT NULL CHECK (source_system ~ '^LOCAL-[A-Z0-9-]{2,40}$'),
  source_code         TEXT NOT NULL CHECK (length(btrim(source_code)) > 0),
  source_display      TEXT NOT NULL CHECK (length(btrim(source_display)) > 0),
  target_system_id    UUID NOT NULL,
  target_release_id   UUID NOT NULL,
  target_code         TEXT NOT NULL,
  relationship        TEXT NOT NULL CHECK (relationship IN ('equivalent', 'source-is-broader-than-target', 'source-is-narrower-than-target', 'related-to')),
  provenance          TEXT NOT NULL CHECK (length(btrim(provenance)) >= 5),
  status              TEXT NOT NULL DEFAULT 'Proposed' CHECK (status IN ('Proposed', 'Approved', 'Rejected', 'Retired')),
  proposed_by_user_id INTEGER NOT NULL REFERENCES hms_users (id),
  proposed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id INTEGER REFERENCES hms_users (id),
  reviewed_at         TIMESTAMPTZ,
  review_reason       TEXT,
  retired_by_user_id  INTEGER REFERENCES hms_users (id),
  retired_at          TIMESTAMPTZ,
  FOREIGN KEY (target_release_id, target_system_id) REFERENCES hms_term_releases (id, system_id),
  FOREIGN KEY (target_release_id, target_code) REFERENCES hms_term_concepts (release_id, code),
  CHECK ((status = 'Proposed') = (reviewed_at IS NULL)),
  CHECK ((reviewed_at IS NULL) = (reviewed_by_user_id IS NULL)),
  CHECK (reviewed_at IS NULL OR length(btrim(review_reason)) >= 3),
  CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id <> proposed_by_user_id),
  CHECK ((status = 'Retired') = (retired_at IS NOT NULL)),
  CHECK ((retired_at IS NULL) = (retired_by_user_id IS NULL))
);
CREATE UNIQUE INDEX hms_term_mappings_one_approved ON hms_term_mappings (source_system, source_code, target_system_id) WHERE status = 'Approved';
CREATE UNIQUE INDEX hms_term_mappings_one_open ON hms_term_mappings (source_system, source_code, target_system_id, target_code) WHERE status = 'Proposed';
CREATE INDEX hms_term_mappings_status ON hms_term_mappings (status, proposed_at);

CREATE FUNCTION term_mapping_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Mappings are retired, not deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.source_system, NEW.source_code, NEW.source_display, NEW.target_system_id, NEW.target_release_id, NEW.target_code, NEW.relationship, NEW.provenance, NEW.proposed_by_user_id, NEW.proposed_at)
     IS DISTINCT FROM
     (OLD.id, OLD.source_system, OLD.source_code, OLD.source_display, OLD.target_system_id, OLD.target_release_id, OLD.target_code, OLD.relationship, OLD.provenance, OLD.proposed_by_user_id, OLD.proposed_at) THEN
    RAISE EXCEPTION 'A proposed mapping cannot be edited; propose a new one' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'Proposed' AND NEW.status IN ('Approved', 'Rejected')) OR (OLD.status = 'Approved' AND NEW.status = 'Retired')) THEN
    RAISE EXCEPTION 'A mapping goes Proposed -> Approved/Rejected, Approved -> Retired (not % -> %)', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.reviewed_at IS NOT NULL AND (NEW.reviewed_at, NEW.reviewed_by_user_id, NEW.review_reason) IS DISTINCT FROM (OLD.reviewed_at, OLD.reviewed_by_user_id, OLD.review_reason) THEN
    RAISE EXCEPTION 'A mapping review is fixed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_term_mapping_guard BEFORE UPDATE OR DELETE ON hms_term_mappings
  FOR EACH ROW EXECUTE FUNCTION term_mapping_guard();

-- Diagnoses keep the release they were coded against.
ALTER TABLE hms_diagnoses
  ADD COLUMN coding_status   TEXT NOT NULL DEFAULT 'LEGACY_UNVERSIONED' CHECK (coding_status IN ('LEGACY_UNVERSIONED', 'CODED')),
  ADD COLUMN term_release_id UUID REFERENCES hms_term_releases (id),
  ADD COLUMN original_text   TEXT;
ALTER TABLE hms_diagnoses
  ADD CONSTRAINT hms_diagnoses_coded_release CHECK ((coding_status = 'CODED') = (term_release_id IS NOT NULL)),
  ADD CONSTRAINT hms_diagnoses_coded_concept FOREIGN KEY (term_release_id, icd10_code) REFERENCES hms_term_concepts (release_id, code);

CREATE TRIGGER trg_audit_hms_term_systems AFTER INSERT OR UPDATE OR DELETE ON hms_term_systems FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_term_releases AFTER INSERT OR UPDATE OR DELETE ON hms_term_releases FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_term_mappings AFTER INSERT OR UPDATE OR DELETE ON hms_term_mappings FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
