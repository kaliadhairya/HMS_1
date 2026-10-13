CREATE TABLE hms_lab_qc_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id),
 version integer NOT NULL CHECK(version>0), method text NOT NULL CHECK(length(btrim(method))>0),
 criteria jsonb NOT NULL CHECK(jsonb_typeof(criteria)='object'), provenance text NOT NULL CHECK(length(btrim(provenance))>0),
 effective_at timestamptz NOT NULL, expires_at timestamptz,
 approved_by_user_id integer NOT NULL REFERENCES hms_users(id), UNIQUE(test_version_id,method,version),
 CHECK(expires_at IS NULL OR expires_at>effective_at)
);
CREATE TABLE hms_lab_analyzer_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), instrument text NOT NULL CHECK(length(btrim(instrument))>0),
 external_run_id text NOT NULL CHECK(length(btrim(external_run_id))>0), method text NOT NULL CHECK(length(btrim(method))>0),
 source text NOT NULL CHECK(length(btrim(source))>0), created_by_user_id integer NOT NULL REFERENCES hms_users(id),
 recorded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,instrument,external_run_id)
);
CREATE TABLE hms_lab_qc_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid REFERENCES hms_lab_analyzer_runs(id),
 rule_id uuid NOT NULL REFERENCES hms_lab_qc_rules(id), status text NOT NULL CHECK(status IN ('PASS','FAIL','REPEAT')),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND evidence<>'{}'::jsonb),
 recorded_by_user_id integer NOT NULL REFERENCES hms_users(id), recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms_lab_reference_intervals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id),
 version integer NOT NULL CHECK(version>0), method text NOT NULL CHECK(length(btrim(method))>0), unit text NOT NULL CHECK(length(btrim(unit))>0),
 sex text CHECK(sex IN ('Male','Female','Other','Unknown')), min_age_years numeric CHECK(min_age_years>=0), max_age_years numeric CHECK(max_age_years>=0),
 lower_bound numeric, upper_bound numeric, provenance text NOT NULL CHECK(length(btrim(provenance))>0), effective_at timestamptz NOT NULL,
 expires_at timestamptz, approved_by_user_id integer NOT NULL REFERENCES hms_users(id),
 CHECK(lower_bound IS NOT NULL OR upper_bound IS NOT NULL), CHECK(lower_bound IS NULL OR upper_bound IS NULL OR lower_bound<=upper_bound),
 CHECK(min_age_years IS NULL OR max_age_years IS NULL OR min_age_years<=max_age_years), CHECK(expires_at IS NULL OR expires_at>effective_at)
);
CREATE TABLE hms_lab_conversions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id),
 method text NOT NULL CHECK(length(btrim(method))>0), from_unit text NOT NULL CHECK(length(btrim(from_unit))>0), to_unit text NOT NULL CHECK(length(btrim(to_unit))>0),
 multiplier numeric NOT NULL CHECK(multiplier>0), offset_value numeric NOT NULL,
 provenance text NOT NULL CHECK(length(btrim(provenance))>0), effective_at timestamptz NOT NULL, expires_at timestamptz,
 approved_by_user_id integer NOT NULL REFERENCES hms_users(id), CHECK(from_unit<>to_unit), CHECK(expires_at IS NULL OR expires_at>effective_at)
);
CREATE TABLE hms_lab_result_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id integer NOT NULL REFERENCES hms_investigation_order_items(id),
 version integer NOT NULL CHECK(version>0), specimen_id uuid NOT NULL REFERENCES hms_lab_specimens(id),
 raw_value text NOT NULL CHECK(length(btrim(raw_value)) BETWEEN 1 AND 500), raw_unit text NOT NULL CHECK(length(btrim(raw_unit))>0),
 normalized_value text NOT NULL CHECK(length(btrim(normalized_value))>0), normalized_unit text NOT NULL CHECK(length(btrim(normalized_unit))>0),
 method text NOT NULL CHECK(length(btrim(method))>0), author_user_id integer NOT NULL REFERENCES hms_users(id),
 analyzer_run_id uuid REFERENCES hms_lab_analyzer_runs(id), qc_record_id uuid REFERENCES hms_lab_qc_records(id),
 conversion_id uuid REFERENCES hms_lab_conversions(id), reference_interval_id uuid REFERENCES hms_lab_reference_intervals(id),
 abnormal_flag text NOT NULL CHECK(abnormal_flag IN ('LOW','HIGH','IN_RANGE','NO_REFERENCE_INTERVAL','NOT_ASSESSABLE')),
 context_snapshot jsonb NOT NULL CHECK(jsonb_typeof(context_snapshot)='object'),
 correction_of_id uuid REFERENCES hms_lab_result_versions(id), correction_reason text,
 remarks text, source text NOT NULL CHECK(source IN ('MANUAL','ANALYZER')), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(item_id,version), CHECK((correction_of_id IS NULL)=(correction_reason IS NULL)),
 CHECK(correction_of_id IS NULL OR length(btrim(correction_reason))>0)
);
CREATE TABLE hms_lab_technical_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), result_version_id uuid NOT NULL REFERENCES hms_lab_result_versions(id),
 reviewer_user_id integer NOT NULL REFERENCES hms_users(id), qc_record_id uuid NOT NULL REFERENCES hms_lab_qc_records(id),
 decision text NOT NULL CHECK(decision IN ('VERIFIED','REPEAT')), reason text NOT NULL CHECK(length(btrim(reason))>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(result_version_id)
);
CREATE TABLE hms_lab_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id integer NOT NULL UNIQUE REFERENCES hms_investigation_orders(id),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms_lab_report_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), report_id uuid NOT NULL REFERENCES hms_lab_reports(id),
 version integer NOT NULL CHECK(version>0), status text NOT NULL CHECK(status IN ('PRELIMINARY','FINAL','AMENDED')),
 previous_version_id uuid REFERENCES hms_lab_report_versions(id), reason text NOT NULL CHECK(length(btrim(reason))>0),
 released_by_user_id integer NOT NULL REFERENCES hms_users(id), released_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(report_id,version), CHECK(status<>'AMENDED' OR previous_version_id IS NOT NULL)
);
CREATE TABLE hms_lab_report_results (
 report_version_id uuid NOT NULL REFERENCES hms_lab_report_versions(id), result_version_id uuid NOT NULL REFERENCES hms_lab_result_versions(id),
 position integer NOT NULL CHECK(position>=0), PRIMARY KEY(report_version_id,result_version_id), UNIQUE(report_version_id,position)
);
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name IN ('hms_lab_qc_rules','hms_lab_analyzer_runs','hms_lab_qc_records','hms_lab_reference_intervals','hms_lab_conversions','hms_lab_result_versions','hms_lab_technical_reviews','hms_lab_reports','hms_lab_report_versions','hms_lab_report_results')
 AND (c.column_name LIKE '%user_id' OR c.column_name IN ('test_version_id','run_id','rule_id','item_id','specimen_id','analyzer_run_id','qc_record_id','conversion_id','reference_interval_id','correction_of_id','result_version_id','order_id','report_id','previous_version_id','report_version_id'))
 LOOP EXECUTE format('CREATE INDEX ON %I (%I)',r.table_name,r.column_name); END LOOP;
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('hms_lab_qc_rules','hms_lab_analyzer_runs','hms_lab_qc_records','hms_lab_reference_intervals','hms_lab_conversions','hms_lab_result_versions','hms_lab_technical_reviews','hms_lab_reports','hms_lab_report_versions','hms_lab_report_results')
 LOOP EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',r.tablename,r.tablename); END LOOP;
END $$;
