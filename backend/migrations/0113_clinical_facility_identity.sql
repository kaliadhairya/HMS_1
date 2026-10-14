-- Clinical facility ownership. This is not customer/SaaS provisioning.
CREATE FUNCTION hms_valid_facility_timezone(value text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=value)
$$;
CREATE TABLE hms_facilities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK(length(btrim(code))>0),
 name text NOT NULL CHECK(length(btrim(name))>0), timezone text NOT NULL CHECK(hms_valid_facility_timezone(timezone)),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 configuration_review_required boolean NOT NULL DEFAULT true,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO hms_facilities(code,name,timezone) VALUES('INITIAL','Initial hospital facility (configuration review required)','Asia/Kolkata');
CREATE TABLE hms_facility_binding (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),initial_facility_id uuid NOT NULL REFERENCES hms_facilities(id)
);
INSERT INTO hms_facility_binding(initial_facility_id) SELECT id FROM hms_facilities WHERE code='INITIAL';
CREATE INDEX ix_facility_binding_initial ON hms_facility_binding(initial_facility_id);
CREATE FUNCTION hms_initial_facility() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT initial_facility_id FROM hms_facility_binding WHERE singleton
$$;
CREATE TABLE hms_facility_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),facility_id uuid NOT NULL REFERENCES hms_facilities(id),
 user_id integer NOT NULL REFERENCES hms_users(id),valid_from timestamptz NOT NULL DEFAULT now(),valid_until timestamptz,
 granted_by_user_id integer REFERENCES hms_users(id),reason text NOT NULL CHECK(length(btrim(reason))>=10),
 revoked_at timestamptz,revoked_by_user_id integer REFERENCES hms_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(valid_until IS NULL OR valid_until>valid_from),CHECK((revoked_at IS NULL)=(revoked_by_user_id IS NULL))
);
CREATE UNIQUE INDEX ux_facility_current_membership ON hms_facility_memberships(facility_id,user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_facility_membership_user ON hms_facility_memberships(user_id,facility_id);
CREATE INDEX ix_facility_membership_granter ON hms_facility_memberships(granted_by_user_id);
CREATE INDEX ix_facility_membership_revoker ON hms_facility_memberships(revoked_by_user_id);
INSERT INTO hms_facility_memberships(facility_id,user_id,reason)
 SELECT hms_initial_facility(),id,'Explicit initial-facility backfill from the existing single-hospital active staff accounts'
 FROM hms_users WHERE is_active=1;
CREATE TABLE hms_practitioner_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),practitioner_id bigint NOT NULL REFERENCES hms_practitioners(id),
 facility_id uuid NOT NULL REFERENCES hms_facilities(id),role text NOT NULL CHECK(role IN ('doctor','nurse','pharmacist','lab_technician')),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,granted_by_user_id integer NOT NULL REFERENCES hms_users(id),
 reason text NOT NULL CHECK(length(btrim(reason))>=10),revoked_at timestamptz,
 CHECK(valid_until>valid_from),CHECK(revoked_at IS NULL OR revoked_at>=valid_from)
);
CREATE INDEX ix_practitioner_role_facility ON hms_practitioner_roles(facility_id,practitioner_id);
CREATE INDEX ix_practitioner_role_practitioner ON hms_practitioner_roles(practitioner_id);
CREATE INDEX ix_practitioner_role_granter ON hms_practitioner_roles(granted_by_user_id);
CREATE TABLE hms_clinical_privileges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),practitioner_role_id uuid NOT NULL REFERENCES hms_practitioner_roles(id),
 action text NOT NULL CHECK(action IN ('CHART_READ','PRESCRIBE','CLINICAL_SIGN','NURSING_DOCUMENT','DISPENSE','LAB_PROCESS','LAB_RELEASE')),
 valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,granted_by_user_id integer NOT NULL REFERENCES hms_users(id),
 reason text NOT NULL CHECK(length(btrim(reason))>=10),revoked_at timestamptz,CHECK(valid_until>valid_from)
);
CREATE INDEX ix_clinical_privilege_role ON hms_clinical_privileges(practitioner_role_id,action);
CREATE INDEX ix_clinical_privilege_granter ON hms_clinical_privileges(granted_by_user_id);
-- Identity backfill maps explicit login IDs. It grants no clinical privileges
-- and guesses no registration, qualification, patient or practitioner match.
INSERT INTO hms_practitioners(user_id,display_name)
 SELECT id,coalesce(nullif(btrim(name),''),username) FROM hms_users WHERE role IN ('doctor','nurse','pharmacist','lab_technician')
 ON CONFLICT(user_id) DO NOTHING;
ALTER TABLE hms_patients ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_encounters ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_admissions ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_practitioners ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_sessions ADD COLUMN facility_id uuid NOT NULL DEFAULT hms_initial_facility() REFERENCES hms_facilities(id);
CREATE INDEX ix_session_facility ON hms_sessions(facility_id,user_id);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['hms_facilities','hms_facility_binding','hms_facility_memberships','hms_practitioner_roles','hms_clinical_privileges'] LOOP
  EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',tab,tab);
 END LOOP;
END $$;
