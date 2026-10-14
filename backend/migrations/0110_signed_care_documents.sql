-- Add signed continuity records without promoting legacy free text into a
-- signature. Historical discharge summaries remain historical records.
ALTER TABLE hms_clinical_documents DROP CONSTRAINT hms_clinical_documents_doc_type_check;
ALTER TABLE hms_clinical_documents ADD CONSTRAINT ck_clinical_document_type
 CHECK(doc_type IN ('clinical_note','discharge_summary','nursing_assessment','care_plan'));
ALTER TABLE hms_clinical_documents ADD COLUMN admission_id integer REFERENCES hms_admissions(id);
ALTER TABLE hms_clinical_documents ADD COLUMN amendment_reason text;
CREATE INDEX ix_clinical_document_admission ON hms_clinical_documents(admission_id);
ALTER TABLE hms_clinical_documents ADD CONSTRAINT ck_discharge_document_admission
 CHECK(doc_type<>'discharge_summary' OR admission_id IS NOT NULL);
ALTER TABLE hms_encounters ADD CONSTRAINT ux_encounter_patient UNIQUE(id,patient_id);
ALTER TABLE hms_admissions ADD CONSTRAINT ux_admission_patient UNIQUE(id,patient_id);
ALTER TABLE hms_clinical_documents ADD CONSTRAINT fk_document_encounter_patient
 FOREIGN KEY(encounter_id,patient_id) REFERENCES hms_encounters(id,patient_id);
ALTER TABLE hms_clinical_documents ADD CONSTRAINT fk_document_admission_patient
 FOREIGN KEY(admission_id,patient_id) REFERENCES hms_admissions(id,patient_id);
ALTER TABLE hms_document_signatures ADD CONSTRAINT fk_signature_amended_version
 FOREIGN KEY(document_id,amends_version) REFERENCES hms_document_signatures(document_id,version);
ALTER TABLE hms_document_signatures ADD CONSTRAINT ck_signature_amends_prior
 CHECK(amends_version IS NULL OR amends_version<version);
