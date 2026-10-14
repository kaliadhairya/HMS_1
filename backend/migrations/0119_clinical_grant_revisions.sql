ALTER TABLE hms_facility_memberships ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE hms_practitioner_roles ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE hms_clinical_privileges ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
CREATE FUNCTION hms_role_permits_action(clinical_role text,action_name text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE clinical_role
 WHEN 'doctor' THEN action_name IN ('CHART_READ','PRESCRIBE','CLINICAL_SIGN','LAB_PROCESS','LAB_RELEASE')
 WHEN 'nurse' THEN action_name IN ('CHART_READ','NURSING_DOCUMENT')
 WHEN 'pharmacist' THEN action_name IN ('CHART_READ','DISPENSE')
 WHEN 'lab_technician' THEN action_name IN ('CHART_READ','LAB_PROCESS') ELSE false END
$$;
CREATE FUNCTION hms_guard_privilege_grant() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent hms_practitioner_roles; BEGIN
 SELECT * INTO parent FROM hms_practitioner_roles WHERE id=NEW.practitioner_role_id FOR SHARE;
 IF NOT hms_role_permits_action(parent.role,NEW.action) OR NEW.valid_from<parent.valid_from OR NEW.valid_until>parent.valid_until THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Clinical privilege must match the professional role and remain inside its validity window';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_clinical_privilege_validity BEFORE INSERT OR UPDATE ON hms_clinical_privileges
 FOR EACH ROW EXECUTE FUNCTION hms_guard_privilege_grant();
