CREATE OR REPLACE FUNCTION hms_guard_public_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.id,NEW.public_id) IS DISTINCT FROM (OLD.id,OLD.public_id) THEN
  RAISE EXCEPTION 'Legacy and public clinical identities are immutable' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE UNIQUE INDEX ux_token_patient_doctor_facility ON hms_tokens(id,patient_id,doctor_id,facility_id);
CREATE UNIQUE INDEX ux_appointment_patient_doctor_facility ON hms_appointments(id,patient_id,doctor_id,facility_id);
ALTER TABLE hms_encounters ADD CONSTRAINT fk_encounter_token_identity
 FOREIGN KEY(token_id,patient_id,doctor_id,facility_id) REFERENCES hms_tokens(id,patient_id,doctor_id,facility_id)
 DEFERRABLE INITIALLY DEFERRED NOT VALID;
ALTER TABLE hms_encounters ADD CONSTRAINT fk_encounter_appointment_identity
 FOREIGN KEY(appointment_id,patient_id,doctor_id,facility_id) REFERENCES hms_appointments(id,patient_id,doctor_id,facility_id)
 DEFERRABLE INITIALLY DEFERRED NOT VALID;
-- Historical contradictions are retained and queued, never relabelled as
-- another patient's visit. Invalid constraints keep recovery/release gates
-- blocked until an authorized reconciliation supplies its evidence.
DO $$ DECLARE relation text; mismatch_count bigint; BEGIN
 FOREACH relation IN ARRAY ARRAY['token','appointment'] LOOP
  EXECUTE format('SELECT count(*) FROM hms_encounters e JOIN %I v ON v.id=e.%I WHERE (e.patient_id,e.doctor_id,e.facility_id) IS DISTINCT FROM(v.patient_id,v.doctor_id,v.facility_id)',
   CASE relation WHEN 'token' THEN 'hms_tokens' ELSE 'hms_appointments' END,relation||'_id') INTO mismatch_count;
  IF mismatch_count=0 THEN
   EXECUTE format('ALTER TABLE hms_encounters VALIDATE CONSTRAINT %I','fk_encounter_'||relation||'_identity');
  ELSE
   EXECUTE format('INSERT INTO hms_worklist_items(kind,dedupe_key,title,detail,owner_role,patient_id,facility_id)
    SELECT %L,%L||e.public_id::text,%L,jsonb_build_object(''encounter_id'',e.id,''relationship'',%L),''admin'',e.patient_id,e.facility_id
    FROM hms_encounters e JOIN %I v ON v.id=e.%I WHERE (e.patient_id,e.doctor_id,e.facility_id) IS DISTINCT FROM(v.patient_id,v.doctor_id,v.facility_id)',
    'identity.visit_mismatch',relation||':','Historical visit binding requires reviewed reconciliation',relation,
    CASE relation WHEN 'token' THEN 'hms_tokens' ELSE 'hms_appointments' END,relation||'_id');
  END IF;
 END LOOP;
END $$;
