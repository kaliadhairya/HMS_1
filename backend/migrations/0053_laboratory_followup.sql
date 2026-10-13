CREATE TABLE hms_lab_escalation_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL CHECK(length(btrim(code))>0), version integer NOT NULL CHECK(version>0),
 provenance text NOT NULL CHECK(length(btrim(provenance))>0), effective_at timestamptz NOT NULL, expires_at timestamptz,
 approved_by_user_id integer NOT NULL REFERENCES hms_users(id), UNIQUE(code,version), CHECK(expires_at IS NULL OR expires_at>effective_at)
);
CREATE TABLE hms_lab_escalation_steps (
 policy_id uuid NOT NULL REFERENCES hms_lab_escalation_policies(id), level integer NOT NULL CHECK(level>=0),
 after_seconds integer NOT NULL CHECK(after_seconds>=0), recipient_user_id integer NOT NULL REFERENCES hms_users(id),
 PRIMARY KEY(policy_id,level), UNIQUE(policy_id,after_seconds)
);
CREATE TABLE hms_lab_critical_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id), version integer NOT NULL CHECK(version>0),
 method text NOT NULL CHECK(length(btrim(method))>0), unit text NOT NULL CHECK(length(btrim(unit))>0),
 sex text CHECK(sex IN ('Male','Female','Other','Unknown')), min_age_years numeric CHECK(min_age_years>=0), max_age_years numeric CHECK(max_age_years>=0),
 lower_bound numeric, upper_bound numeric, escalation_policy_id uuid REFERENCES hms_lab_escalation_policies(id),
 provenance text NOT NULL CHECK(length(btrim(provenance))>0), effective_at timestamptz NOT NULL, expires_at timestamptz,
 approved_by_user_id integer NOT NULL REFERENCES hms_users(id),
 CHECK(lower_bound IS NOT NULL OR upper_bound IS NOT NULL), CHECK(lower_bound IS NULL OR upper_bound IS NULL OR lower_bound<=upper_bound),
 CHECK(min_age_years IS NULL OR max_age_years IS NULL OR min_age_years<=max_age_years), CHECK(expires_at IS NULL OR expires_at>effective_at)
);
CREATE TABLE hms_lab_critical_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), result_version_id uuid NOT NULL UNIQUE REFERENCES hms_lab_result_versions(id),
 policy_id uuid NOT NULL REFERENCES hms_lab_critical_policies(id), patient_id integer NOT NULL REFERENCES hms_patients(id),
 assigned_user_id integer REFERENCES hms_users(id), state text NOT NULL CHECK(state IN ('OPEN','ACKNOWLEDGED','CLOSED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), escalation_level integer NOT NULL DEFAULT -1 CHECK(escalation_level>=-1),
 schedule_snapshot jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(schedule_snapshot)='array'), next_due_at timestamptz,
 acknowledged_by_user_id integer REFERENCES hms_users(id), acknowledged_at timestamptz,
 closed_by_user_id integer REFERENCES hms_users(id), clinical_action text, closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK((acknowledged_at IS NULL)=(acknowledged_by_user_id IS NULL)),
 CHECK(state='OPEN' OR acknowledged_at IS NOT NULL), CHECK((state='CLOSED')=(closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL AND clinical_action IS NOT NULL)),
 CHECK(clinical_action IS NULL OR length(btrim(clinical_action))>0)
);
CREATE TABLE hms_lab_delivery_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES hms_lab_critical_tasks(id),
 recipient_user_id integer REFERENCES hms_users(id), actor_user_id integer NOT NULL REFERENCES hms_users(id),
 level integer NOT NULL CHECK(level>=-1), outcome text NOT NULL CHECK(outcome IN ('QUEUED','CONTACTED','UNAVAILABLE','FAILED')),
 channel text NOT NULL CHECK(length(btrim(channel))>0), evidence text NOT NULL CHECK(length(btrim(evidence))>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms_lab_review_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_version_id uuid NOT NULL REFERENCES hms_lab_report_versions(id),
 patient_id integer NOT NULL REFERENCES hms_patients(id), assigned_user_id integer REFERENCES hms_users(id),
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED')), revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 clinical_action text, closed_by_user_id integer REFERENCES hms_users(id), closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='CLOSED')=(closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL AND clinical_action IS NOT NULL)), UNIQUE(report_version_id)
);
CREATE INDEX ix_lab_critical_due ON hms_lab_critical_tasks(next_due_at) WHERE state='OPEN';
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name IN ('hms_lab_escalation_policies','hms_lab_escalation_steps','hms_lab_critical_policies','hms_lab_critical_tasks','hms_lab_delivery_attempts','hms_lab_review_tasks')
 AND (c.column_name LIKE '%user_id' OR c.column_name IN ('policy_id','test_version_id','escalation_policy_id','result_version_id','patient_id','task_id','report_version_id'))
 LOOP EXECUTE format('CREATE INDEX ON %I (%I)',r.table_name,r.column_name); END LOOP;
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('hms_lab_escalation_policies','hms_lab_escalation_steps','hms_lab_critical_policies','hms_lab_critical_tasks','hms_lab_delivery_attempts','hms_lab_review_tasks')
 LOOP EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',r.tablename,r.tablename); END LOOP;
END $$;
