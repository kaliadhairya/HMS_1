-- Completion A5: signed discharge and handover continuity.
--
-- 1. An admission becomes Discharged only together with its signed discharge document. The
--    discharge command writes the summary after closing the admission in the same transaction,
--    so the check runs at commit (deferred). Any other writer, including direct SQL, is refused.
-- 2. The shared observations on the chart when the discharge is signed, or when a nurse hands a
--    patient over, are linked to that document or handover. The links are immutable: they
--    record what the signer and the receiving nurse had in front of them.

CREATE FUNCTION hms_require_signed_discharge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status = 'Discharged' AND NOT EXISTS (
   SELECT 1 FROM hms_discharge_summaries s
   JOIN hms_clinical_documents d ON d.id = s.clinical_document_id
   WHERE s.admission_id = NEW.id AND d.admission_id = NEW.id
     AND d.doc_type = 'discharge_summary' AND d.state = 'signed') THEN
  RAISE EXCEPTION USING ERRCODE = '23514',
   MESSAGE = 'An admission is discharged only with its signed discharge document';
 END IF;
 RETURN NULL;
END $$;

-- Only the change to Discharged is checked; admissions discharged before this rule keep their history.
CREATE CONSTRAINT TRIGGER trg_signed_discharge
 AFTER UPDATE OF status ON hms_admissions
 DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW.status = 'Discharged' AND OLD.status IS DISTINCT FROM 'Discharged')
 EXECUTE FUNCTION hms_require_signed_discharge();

CREATE TABLE hms_observation_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 observation_set_id uuid NOT NULL REFERENCES hms_observation_sets (id),
 clinical_document_id bigint REFERENCES hms_clinical_documents (id),
 handover_id uuid REFERENCES hms_med_handovers (id),
 facility_id uuid NOT NULL REFERENCES hms_facilities (id),
 linked_by integer NOT NULL REFERENCES hms_users (id),
 linked_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT ck_observation_link_subject CHECK (num_nonnulls(clinical_document_id, handover_id) = 1)
);
CREATE UNIQUE INDEX ux_observation_link_document ON hms_observation_links (clinical_document_id, observation_set_id) WHERE clinical_document_id IS NOT NULL;
CREATE UNIQUE INDEX ux_observation_link_handover ON hms_observation_links (handover_id, observation_set_id) WHERE handover_id IS NOT NULL;
CREATE INDEX ix_observation_link_set ON hms_observation_links (observation_set_id);

-- A link names a set of the same patient and facility as its document or handover.
CREATE FUNCTION hms_check_observation_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE set_patient integer; set_facility uuid; subject_patient integer; subject_facility uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Observation links are immutable';
 END IF;
 SELECT patient_id, facility_id INTO set_patient, set_facility FROM hms_observation_sets WHERE id = NEW.observation_set_id;
 IF NEW.clinical_document_id IS NOT NULL THEN
  SELECT patient_id, facility_id INTO subject_patient, subject_facility FROM hms_clinical_documents WHERE id = NEW.clinical_document_id;
 ELSE
  SELECT patient_id, facility_id INTO subject_patient, subject_facility FROM hms_med_handovers WHERE id = NEW.handover_id;
 END IF;
 IF set_patient IS DISTINCT FROM subject_patient OR set_facility IS DISTINCT FROM subject_facility OR NEW.facility_id IS DISTINCT FROM subject_facility THEN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'An observation link names the same patient and facility as its record';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_observation_link_check BEFORE INSERT OR UPDATE OR DELETE ON hms_observation_links
 FOR EACH ROW EXECUTE FUNCTION hms_check_observation_link();

ALTER TABLE hms_observation_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON hms_observation_links
 USING (hms_authorized_facility(facility_id)) WITH CHECK (hms_authorized_facility(facility_id));
