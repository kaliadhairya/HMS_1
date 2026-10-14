-- Phase 4. No terminology, specimen requirements, reference intervals or
-- clinical policies are guessed from names or seeded as approved content.
CREATE TABLE hms_lab_tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_system text NOT NULL CHECK(length(btrim(code_system))>0),
 code text NOT NULL CHECK(length(btrim(code))>0), kind text NOT NULL CHECK(kind IN ('TEST','PANEL')),
 created_by_user_id integer NOT NULL REFERENCES hms_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(code_system,code)
);
CREATE TABLE hms_lab_test_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_id uuid NOT NULL REFERENCES hms_lab_tests(id),
 version integer NOT NULL CHECK(version>0), name text NOT NULL CHECK(length(btrim(name))>0),
 section text NOT NULL CHECK(length(btrim(section))>0), unit text, method text,
 tariff_id integer REFERENCES hms_tariffs(id), provenance text NOT NULL CHECK(length(btrim(provenance))>0),
 effective_at timestamptz NOT NULL, expires_at timestamptz,
 approved_by_user_id integer NOT NULL REFERENCES hms_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at IS NULL OR expires_at>effective_at), UNIQUE(test_id,version)
);
CREATE TABLE hms_lab_requirements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id),
 specimen_type text NOT NULL CHECK(length(btrim(specimen_type))>0), container text NOT NULL CHECK(length(btrim(container))>0),
 UNIQUE(test_version_id,specimen_type,container)
);
CREATE TABLE hms_lab_panel_members (
 panel_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id), test_version_id uuid NOT NULL REFERENCES hms_lab_test_versions(id),
 position integer NOT NULL CHECK(position>=0), PRIMARY KEY(panel_version_id,test_version_id),
 CHECK(panel_version_id<>test_version_id), UNIQUE(panel_version_id,position)
);
ALTER TABLE hms_investigation_order_items
 ADD COLUMN lab_test_version_id uuid REFERENCES hms_lab_test_versions(id),
 ADD COLUMN lab_revision integer NOT NULL DEFAULT 0 CHECK(lab_revision>=0),
 ADD COLUMN lab_state text NOT NULL DEFAULT 'UNMAPPED' CHECK(lab_state IN ('UNMAPPED','ORDERED','PROCESSING','ENTERED','VERIFIED','RELEASED','REPEAT','CANCELLED'));
CREATE INDEX ix_lab_item_test_version ON hms_investigation_order_items(lab_test_version_id);
ALTER TABLE hms_investigation_orders ADD COLUMN lab_revision integer NOT NULL DEFAULT 0 CHECK(lab_revision>=0);
CREATE TABLE hms_lab_reconciliation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id integer UNIQUE REFERENCES hms_investigation_order_items(id),
 source text NOT NULL CHECK(length(btrim(source))>0), message_id text, payload jsonb,
 reason text NOT NULL CHECK(length(btrim(reason))>0), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RESOLVED')),
 resolved_by_user_id integer REFERENCES hms_users(id), resolution text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='RESOLVED')=(resolved_by_user_id IS NOT NULL AND resolution IS NOT NULL))
);
INSERT INTO hms_lab_reconciliation(item_id,source,reason)
 SELECT id,'LEGACY_ORDER','No verified catalogue identity; name matching cannot establish specimen, method or unit requirements'
 FROM hms_investigation_order_items;
CREATE TABLE hms_lab_privileges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id integer NOT NULL REFERENCES hms_users(id),
 privilege text NOT NULL CHECK(privilege IN ('CONTENT','TECHNICAL_REVIEW','RELEASE','ANALYZER')),
 granted_by_user_id integer NOT NULL REFERENCES hms_users(id), reason text NOT NULL CHECK(length(btrim(reason))>0),
 valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL, revoked_at timestamptz,
 CHECK(valid_until>valid_from), CHECK(revoked_at IS NULL OR revoked_at>=valid_from)
);
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
  WHERE c.table_schema='public' AND c.table_name IN ('hms_lab_tests','hms_lab_test_versions','hms_lab_requirements','hms_lab_panel_members','hms_lab_reconciliation','hms_lab_privileges')
  AND (c.column_name LIKE '%user_id' OR c.column_name IN ('test_id','test_version_id','panel_version_id','tariff_id','item_id'))
 LOOP EXECUTE format('CREATE INDEX ON %I (%I)',r.table_name,r.column_name); END LOOP;
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('hms_lab_tests','hms_lab_test_versions','hms_lab_requirements','hms_lab_panel_members','hms_lab_reconciliation','hms_lab_privileges')
 LOOP EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',r.tablename,r.tablename); END LOOP;
END $$;
