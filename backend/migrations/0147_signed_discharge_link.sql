-- Keep the historical discharge projection while binding every new discharge
-- transaction to its signed source document. Existing free-text summaries are
-- intentionally left unlinked and retain their historical status.
CREATE UNIQUE INDEX ux_clinical_document_admission_facility
  ON hms_clinical_documents(id,admission_id,facility_id);
ALTER TABLE hms_discharge_summaries ADD COLUMN clinical_document_id bigint;
ALTER TABLE hms_discharge_summaries ADD CONSTRAINT ux_discharge_summary_document UNIQUE(clinical_document_id);
ALTER TABLE hms_discharge_summaries ADD CONSTRAINT fk_discharge_summary_signed_document
  FOREIGN KEY(clinical_document_id,admission_id,facility_id)
  REFERENCES hms_clinical_documents(id,admission_id,facility_id) DEFERRABLE INITIALLY DEFERRED;
