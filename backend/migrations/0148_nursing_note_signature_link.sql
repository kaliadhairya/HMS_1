-- Newly submitted legacy nursing-note commands are compatibility projections
-- of signed nursing_assessment documents. Historical notes stay unlinked.
ALTER TABLE hms_nursing_notes ADD COLUMN clinical_document_id bigint;
ALTER TABLE hms_nursing_notes ADD CONSTRAINT ux_nursing_note_document UNIQUE(clinical_document_id);
ALTER TABLE hms_nursing_notes ADD CONSTRAINT fk_nursing_note_signed_document
  FOREIGN KEY(clinical_document_id) REFERENCES hms_clinical_documents(id) DEFERRABLE INITIALLY DEFERRED;
