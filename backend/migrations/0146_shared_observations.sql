-- Normalize OPD and IPD measurements into one facility-scoped, append-only
-- observation model. Legacy tables remain readable during the transition.
CREATE TABLE hms_observation_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  patient_id integer NOT NULL REFERENCES hms_patients(id),
  encounter_id integer,
  admission_id integer,
  context_kind text NOT NULL CHECK(context_kind IN ('patient','encounter','admission')),
  observed_at timestamptz NOT NULL,
  recorded_by integer REFERENCES hms_users(id),
  facility_id uuid NOT NULL REFERENCES hms_facilities(id),
  source_kind text NOT NULL CHECK(source_kind IN ('native','legacy_opd_vitals','legacy_ipd_vitals','device')),
  source_legacy_id integer,
  correction_of uuid REFERENCES hms_observation_sets(id),
  correction_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_observation_set_context CHECK (
    (context_kind='patient' AND encounter_id IS NULL AND admission_id IS NULL) OR
    (context_kind='encounter' AND encounter_id IS NOT NULL AND admission_id IS NULL) OR
    (context_kind='admission' AND admission_id IS NOT NULL AND encounter_id IS NULL)
  ),
  CONSTRAINT ck_observation_set_correction CHECK (
    (correction_of IS NULL AND correction_reason IS NULL) OR
    (correction_of IS NOT NULL AND length(btrim(correction_reason)) BETWEEN 10 AND 500)
  ),
  CONSTRAINT ux_observation_set_identity UNIQUE(id,patient_id,facility_id),
  CONSTRAINT ux_observation_set_facility UNIQUE(id,facility_id),
  CONSTRAINT ux_observation_set_correction UNIQUE(correction_of)
);
CREATE UNIQUE INDEX ux_observation_legacy_source
  ON hms_observation_sets(source_kind,source_legacy_id)
  WHERE source_legacy_id IS NOT NULL;
CREATE INDEX ix_observation_patient_time ON hms_observation_sets(facility_id,patient_id,observed_at DESC,id);
CREATE INDEX ix_observation_encounter_time ON hms_observation_sets(facility_id,encounter_id,observed_at DESC) WHERE encounter_id IS NOT NULL;
CREATE INDEX ix_observation_admission_time ON hms_observation_sets(facility_id,admission_id,observed_at DESC) WHERE admission_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_encounter_patient_facility_observation
  ON hms_encounters(id,patient_id,facility_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_admission_patient_facility_observation
  ON hms_admissions(id,patient_id,facility_id);
ALTER TABLE hms_observation_sets ADD CONSTRAINT fk_observation_encounter_context
  FOREIGN KEY(encounter_id,patient_id,facility_id)
  REFERENCES hms_encounters(id,patient_id,facility_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hms_observation_sets ADD CONSTRAINT fk_observation_admission_context
  FOREIGN KEY(admission_id,patient_id,facility_id)
  REFERENCES hms_admissions(id,patient_id,facility_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE hms_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  set_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  code text NOT NULL CHECK(code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  code_system text NOT NULL CHECK(length(code_system) BETWEEN 1 AND 200),
  value_numeric numeric(18,6),
  value_text text,
  value_boolean boolean,
  unit_code text,
  unit_display text,
  method text,
  source_device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_observation_one_value CHECK (
    num_nonnulls(value_numeric,value_text,value_boolean)=1
  ),
  CONSTRAINT ck_observation_unit CHECK (
    value_numeric IS NOT NULL OR (unit_code IS NULL AND unit_display IS NULL)
  ),
  CONSTRAINT ux_observation_set_code UNIQUE(set_id,code),
  CONSTRAINT fk_observation_set_facility FOREIGN KEY(set_id,facility_id)
    REFERENCES hms_observation_sets(id,facility_id) ON DELETE RESTRICT
);
CREATE INDEX ix_observations_facility_set ON hms_observations(facility_id,set_id,code);

CREATE TRIGGER trg_audit_hms_observation_sets AFTER INSERT OR UPDATE OR DELETE ON hms_observation_sets
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_observations AFTER INSERT OR UPDATE OR DELETE ON hms_observations
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

CREATE FUNCTION hms_observation_set_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Observation sets are retained; record a linked correction' USING ERRCODE='insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW)-'patient_id') IS DISTINCT FROM (to_jsonb(OLD)-'patient_id') THEN
    RAISE EXCEPTION 'Observation context is immutable; record a linked correction' USING ERRCODE='insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_observation_set_guard BEFORE UPDATE OR DELETE ON hms_observation_sets
  FOR EACH ROW EXECUTE FUNCTION hms_observation_set_guard();
CREATE FUNCTION hms_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Observations are immutable; record a linked correction' USING ERRCODE='insufficient_privilege';
END $$;
CREATE TRIGGER trg_observation_guard BEFORE UPDATE OR DELETE ON hms_observations
  FOR EACH ROW EXECUTE FUNCTION hms_observation_guard();

-- Existing legacy measurements are assigned only from their recorded patient,
-- admission, encounter and facility keys. No demographic matching is used.
WITH source AS (
 SELECT v.*, f.timezone,
        CASE WHEN e.id IS NOT NULL THEN 'encounter' ELSE 'patient' END context_kind,
        CASE WHEN e.id IS NOT NULL THEN e.id END encounter_id
 FROM hms_vitals v JOIN hms_facilities f ON f.id=v.facility_id
 LEFT JOIN hms_encounters e ON e.id=v.reference_id AND e.patient_id=v.patient_id AND e.facility_id=v.facility_id
 WHERE v.bp_systolic IS NOT NULL OR v.bp_diastolic IS NOT NULL OR v.temperature IS NOT NULL OR
       v.weight_kg IS NOT NULL OR v.height_cm IS NOT NULL OR v.spo2 IS NOT NULL OR v.pulse IS NOT NULL OR v.respiratory_rate IS NOT NULL
), inserted AS (
 INSERT INTO hms_observation_sets(patient_id,encounter_id,context_kind,observed_at,recorded_by,facility_id,source_kind,source_legacy_id)
 SELECT patient_id,encounter_id,context_kind,recorded_at AT TIME ZONE timezone,recorded_by,facility_id,'legacy_opd_vitals',id FROM source
 ON CONFLICT(source_kind,source_legacy_id) WHERE source_legacy_id IS NOT NULL DO NOTHING
 RETURNING id,source_legacy_id,facility_id
)
INSERT INTO hms_observations(set_id,facility_id,code,code_system,value_numeric,unit_code,unit_display)
SELECT i.id,i.facility_id,x.code,'urn:hms:observation',x.value,x.unit_code,x.unit_display
FROM inserted i JOIN source s ON s.id=i.source_legacy_id
CROSS JOIN LATERAL (VALUES
 ('blood-pressure-systolic',s.bp_systolic::numeric,'mm[Hg]','mmHg'),
 ('blood-pressure-diastolic',s.bp_diastolic::numeric,'mm[Hg]','mmHg'),
 ('body-temperature',s.temperature::numeric,CASE WHEN s.temp_unit='C' THEN 'Cel' ELSE '[degF]' END,CASE WHEN s.temp_unit='C' THEN '°C' ELSE '°F' END),
 ('body-weight',s.weight_kg::numeric,'kg','kg'),
 ('body-height',s.height_cm::numeric,'cm','cm'),
 ('oxygen-saturation',s.spo2::numeric,'%','%'),
 ('heart-rate',s.pulse::numeric,'/min','/min'),
 ('respiratory-rate',s.respiratory_rate::numeric,'/min','/min'),
 ('body-mass-index',s.bmi::numeric,'kg/m2','kg/m²')
) x(code,value,unit_code,unit_display)
WHERE x.value IS NOT NULL;

WITH source AS (
 SELECT v.*, f.timezone FROM hms_ipd_vitals v
 JOIN hms_facilities f ON f.id=v.facility_id
 JOIN hms_admissions a ON a.id=v.admission_id AND a.patient_id=v.patient_id AND a.facility_id=v.facility_id
 WHERE v.bp_systolic IS NOT NULL OR v.bp_diastolic IS NOT NULL OR v.temperature IS NOT NULL OR v.spo2 IS NOT NULL OR v.pulse IS NOT NULL OR
       v.respiratory_rate IS NOT NULL OR v.pain_score IS NOT NULL OR v.intake_oral_ml<>0 OR v.intake_iv_ml<>0 OR v.output_urine_ml<>0 OR v.output_drain_ml<>0
), inserted AS (
 INSERT INTO hms_observation_sets(patient_id,admission_id,context_kind,observed_at,recorded_by,facility_id,source_kind,source_legacy_id)
 SELECT patient_id,admission_id,'admission',recorded_at AT TIME ZONE timezone,recorded_by,facility_id,'legacy_ipd_vitals',id FROM source
 ON CONFLICT(source_kind,source_legacy_id) WHERE source_legacy_id IS NOT NULL DO NOTHING
 RETURNING id,source_legacy_id,facility_id
)
INSERT INTO hms_observations(set_id,facility_id,code,code_system,value_numeric,unit_code,unit_display)
SELECT i.id,i.facility_id,x.code,'urn:hms:observation',x.value,x.unit_code,x.unit_display
FROM inserted i JOIN source s ON s.id=i.source_legacy_id
CROSS JOIN LATERAL (VALUES
 ('blood-pressure-systolic',s.bp_systolic::numeric,'mm[Hg]','mmHg'),
 ('blood-pressure-diastolic',s.bp_diastolic::numeric,'mm[Hg]','mmHg'),
 ('body-temperature',s.temperature::numeric,'[degF]','°F'),
 ('oxygen-saturation',s.spo2::numeric,'%','%'),
 ('heart-rate',s.pulse::numeric,'/min','/min'),
 ('respiratory-rate',s.respiratory_rate::numeric,'/min','/min'),
 ('pain-score',s.pain_score::numeric,'{score}','score'),
 ('intake-oral',s.intake_oral_ml::numeric,'mL','mL'),
 ('intake-intravenous',s.intake_iv_ml::numeric,'mL','mL'),
 ('output-urine',s.output_urine_ml::numeric,'mL','mL'),
 ('output-drain',s.output_drain_ml::numeric,'mL','mL')
) x(code,value,unit_code,unit_display)
WHERE x.value IS NOT NULL AND (x.code NOT IN ('intake-oral','intake-intravenous','output-urine','output-drain') OR x.value<>0);

CREATE FUNCTION hms_project_opd_vitals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE encounter integer; kind text; set_id uuid; facility uuid; tz text;
BEGIN
  SELECT f.id,f.timezone INTO facility,tz FROM hms_facilities f WHERE f.id=NEW.facility_id;
  SELECT e.id INTO encounter FROM hms_encounters e WHERE e.id=NEW.reference_id AND e.patient_id=NEW.patient_id AND e.facility_id=NEW.facility_id;
  kind:=CASE WHEN encounter IS NULL THEN 'patient' ELSE 'encounter' END;
  INSERT INTO hms_observation_sets(patient_id,encounter_id,context_kind,observed_at,recorded_by,facility_id,source_kind,source_legacy_id)
  VALUES(NEW.patient_id,encounter,kind,NEW.recorded_at AT TIME ZONE tz,NEW.recorded_by,facility,'legacy_opd_vitals',NEW.id)
  ON CONFLICT(source_kind,source_legacy_id) WHERE source_legacy_id IS NOT NULL DO NOTHING RETURNING id INTO set_id;
  IF set_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO hms_observations(set_id,facility_id,code,code_system,value_numeric,unit_code,unit_display)
  SELECT set_id,facility,code,'urn:hms:observation',value,unit_code,unit_display FROM (VALUES
   ('blood-pressure-systolic',NEW.bp_systolic::numeric,'mm[Hg]','mmHg'),('blood-pressure-diastolic',NEW.bp_diastolic::numeric,'mm[Hg]','mmHg'),
   ('body-temperature',NEW.temperature::numeric,CASE WHEN NEW.temp_unit='C' THEN 'Cel' ELSE '[degF]' END,CASE WHEN NEW.temp_unit='C' THEN '°C' ELSE '°F' END),
   ('body-weight',NEW.weight_kg::numeric,'kg','kg'),('body-height',NEW.height_cm::numeric,'cm','cm'),('oxygen-saturation',NEW.spo2::numeric,'%','%'),
   ('heart-rate',NEW.pulse::numeric,'/min','/min'),('respiratory-rate',NEW.respiratory_rate::numeric,'/min','/min'),('body-mass-index',NEW.bmi::numeric,'kg/m2','kg/m²')
  ) v(code,value,unit_code,unit_display) WHERE value IS NOT NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_project_opd_vitals AFTER INSERT ON hms_vitals FOR EACH ROW EXECUTE FUNCTION hms_project_opd_vitals();

CREATE FUNCTION hms_project_ipd_vitals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE set_id uuid; facility uuid; tz text;
BEGIN
  SELECT f.id,f.timezone INTO facility,tz FROM hms_facilities f WHERE f.id=NEW.facility_id;
  INSERT INTO hms_observation_sets(patient_id,admission_id,context_kind,observed_at,recorded_by,facility_id,source_kind,source_legacy_id)
  VALUES(NEW.patient_id,NEW.admission_id,'admission',NEW.recorded_at AT TIME ZONE tz,NEW.recorded_by,facility,'legacy_ipd_vitals',NEW.id)
  ON CONFLICT(source_kind,source_legacy_id) WHERE source_legacy_id IS NOT NULL DO NOTHING RETURNING id INTO set_id;
  IF set_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO hms_observations(set_id,facility_id,code,code_system,value_numeric,unit_code,unit_display)
  SELECT set_id,facility,code,'urn:hms:observation',value,unit_code,unit_display FROM (VALUES
   ('blood-pressure-systolic',NEW.bp_systolic::numeric,'mm[Hg]','mmHg'),('blood-pressure-diastolic',NEW.bp_diastolic::numeric,'mm[Hg]','mmHg'),
   ('body-temperature',NEW.temperature::numeric,'[degF]','°F'),('oxygen-saturation',NEW.spo2::numeric,'%','%'),('heart-rate',NEW.pulse::numeric,'/min','/min'),
   ('respiratory-rate',NEW.respiratory_rate::numeric,'/min','/min'),('pain-score',NEW.pain_score::numeric,'{score}','score'),
   ('intake-oral',NEW.intake_oral_ml::numeric,'mL','mL'),('intake-intravenous',NEW.intake_iv_ml::numeric,'mL','mL'),
   ('output-urine',NEW.output_urine_ml::numeric,'mL','mL'),('output-drain',NEW.output_drain_ml::numeric,'mL','mL')
  ) v(code,value,unit_code,unit_display)
  WHERE value IS NOT NULL AND (code NOT IN ('intake-oral','intake-intravenous','output-urine','output-drain') OR value<>0);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_project_ipd_vitals AFTER INSERT ON hms_ipd_vitals FOR EACH ROW EXECUTE FUNCTION hms_project_ipd_vitals();

CREATE VIEW hms_observation_legacy_vitals AS
SELECT s.id,s.public_id,s.patient_id,s.encounter_id,s.admission_id,s.facility_id,s.recorded_by,
       s.observed_at AT TIME ZONE f.timezone AS recorded_at,s.source_kind,s.source_legacy_id,
       max(o.value_numeric) FILTER(WHERE o.code='blood-pressure-systolic') AS bp_systolic,
       max(o.value_numeric) FILTER(WHERE o.code='blood-pressure-diastolic') AS bp_diastolic,
       max(o.value_numeric) FILTER(WHERE o.code='body-temperature') AS temperature,
       CASE max(o.unit_code) FILTER(WHERE o.code='body-temperature')
         WHEN 'Cel' THEN 'C' ELSE 'F' END AS temp_unit,
       max(o.value_numeric) FILTER(WHERE o.code='body-weight') AS weight_kg,
       max(o.value_numeric) FILTER(WHERE o.code='body-height') AS height_cm,
       max(o.value_numeric) FILTER(WHERE o.code='body-mass-index') AS bmi,
       max(o.value_numeric) FILTER(WHERE o.code='oxygen-saturation') AS spo2,
       max(o.value_numeric) FILTER(WHERE o.code='heart-rate') AS pulse,
       max(o.value_numeric) FILTER(WHERE o.code='respiratory-rate') AS respiratory_rate,
       max(o.value_numeric) FILTER(WHERE o.code='pain-score') AS pain_score,
       max(o.value_numeric) FILTER(WHERE o.code='intake-oral') AS intake_oral_ml,
       max(o.value_numeric) FILTER(WHERE o.code='intake-intravenous') AS intake_iv_ml,
       max(o.value_numeric) FILTER(WHERE o.code='output-urine') AS output_urine_ml,
       max(o.value_numeric) FILTER(WHERE o.code='output-drain') AS output_drain_ml
FROM hms_observation_sets s JOIN hms_facilities f ON f.id=s.facility_id
JOIN hms_observations o ON o.set_id=s.id AND o.facility_id=s.facility_id
GROUP BY s.id,f.timezone;
