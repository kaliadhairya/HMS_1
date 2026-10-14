-- Permit an authorized identity merge to update matching parent/child patient
-- references in one transaction, while preserving the final FK invariants.
ALTER TABLE hms_clinical_documents ALTER CONSTRAINT fk_document_encounter_patient DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hms_clinical_documents ALTER CONSTRAINT fk_document_admission_patient DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION hms_finalized_encounter_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND OLD.status='Finalized' THEN
  RAISE EXCEPTION 'A finalized encounter is retained, not deleted' USING ERRCODE='insufficient_privilege';
 END IF;
 IF TG_OP='UPDATE' AND OLD.status='Finalized' AND
   (NEW.status,NEW.chief_complaint,NEW.hopi,NEW.past_medical_history,NEW.surgical_history,NEW.family_history,NEW.social_history,
    NEW.current_medications,NEW.general_examination,NEW.cvs_findings,NEW.rs_findings,NEW.abdomen_findings,NEW.cns_findings)
   IS DISTINCT FROM
   (OLD.status,OLD.chief_complaint,OLD.hopi,OLD.past_medical_history,OLD.surgical_history,OLD.family_history,OLD.social_history,
    OLD.current_medications,OLD.general_examination,OLD.cvs_findings,OLD.rs_findings,OLD.abdomen_findings,OLD.cns_findings) THEN
  RAISE EXCEPTION 'Finalized clinical content is immutable; create a linked signed amendment' USING ERRCODE='insufficient_privilege';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_finalized_encounter_guard BEFORE UPDATE OR DELETE ON hms_encounters
 FOR EACH ROW EXECUTE FUNCTION hms_finalized_encounter_guard();
