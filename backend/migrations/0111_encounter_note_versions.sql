-- Historical finalized encounters remain historical. Only a new, deliberate
-- signature creates a signed consultation record; backfill never invents one.
ALTER TABLE hms_encounters ADD COLUMN record_revision integer NOT NULL DEFAULT 1 CHECK(record_revision>0);
ALTER TABLE hms_encounters ADD COLUMN notes_document_id bigint REFERENCES hms_clinical_documents(id);
CREATE UNIQUE INDEX ux_encounter_notes_document ON hms_encounters(notes_document_id) WHERE notes_document_id IS NOT NULL;
ALTER TABLE hms_clinical_documents DROP CONSTRAINT ck_clinical_document_type;
ALTER TABLE hms_clinical_documents ADD CONSTRAINT ck_clinical_document_type
 CHECK(doc_type IN ('clinical_note','discharge_summary','nursing_assessment','care_plan','encounter_note'));
CREATE UNIQUE INDEX ux_clinical_encounter_note ON hms_clinical_documents(encounter_id) WHERE doc_type='encounter_note';
