CREATE TABLE hms_lab_specimens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), accession text NOT NULL UNIQUE CHECK(length(btrim(accession))>0),
 patient_id integer NOT NULL REFERENCES hms_patients(id), parent_id uuid REFERENCES hms_lab_specimens(id),
 specimen_type text NOT NULL CHECK(length(btrim(specimen_type))>0), container text NOT NULL CHECK(length(btrim(container))>0),
 location text NOT NULL CHECK(length(btrim(location))>0), state text NOT NULL DEFAULT 'PLANNED'
 CHECK(state IN ('PLANNED','COLLECTED','SENT','RECEIVED','STORED','REJECTED')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), collector_user_id integer REFERENCES hms_users(id),
 collected_at timestamptz, received_at timestamptz, created_by_user_id integer NOT NULL REFERENCES hms_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(parent_id IS NULL OR parent_id<>id),
 CHECK((collected_at IS NULL)=(collector_user_id IS NULL)), CHECK(received_at IS NULL OR received_at>=collected_at),
 CHECK(state IN ('PLANNED','REJECTED') OR collected_at IS NOT NULL),
 CHECK(state NOT IN ('RECEIVED','STORED') OR received_at IS NOT NULL)
);
CREATE TABLE hms_lab_specimen_links (
 specimen_id uuid NOT NULL REFERENCES hms_lab_specimens(id), item_id integer NOT NULL REFERENCES hms_investigation_order_items(id),
 requirement_id uuid NOT NULL REFERENCES hms_lab_requirements(id), linked_by_user_id integer NOT NULL REFERENCES hms_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(specimen_id,item_id,requirement_id), CHECK(item_id>0)
);
CREATE TABLE hms_lab_custody (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), specimen_id uuid NOT NULL REFERENCES hms_lab_specimens(id),
 event text NOT NULL CHECK(event IN ('PLANNED','COLLECTED','SENT','RECEIVED','STORED','REJECTED','ALIQUOT')),
 actor_user_id integer NOT NULL REFERENCES hms_users(id), occurred_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 location text NOT NULL CHECK(length(btrim(location))>0), reason text NOT NULL CHECK(length(btrim(reason))>0)
);
CREATE TABLE hms_lab_recollections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rejected_specimen_id uuid NOT NULL REFERENCES hms_lab_specimens(id),
 item_id integer NOT NULL REFERENCES hms_investigation_order_items(id), reason text NOT NULL CHECK(length(btrim(reason))>0),
 requested_by_user_id integer NOT NULL REFERENCES hms_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 replacement_specimen_id uuid REFERENCES hms_lab_specimens(id), completed_at timestamptz,
 CHECK((replacement_specimen_id IS NULL)=(completed_at IS NULL)), UNIQUE(rejected_specimen_id,item_id)
);
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.table_name IN ('hms_lab_specimens','hms_lab_specimen_links','hms_lab_custody','hms_lab_recollections')
 AND (c.column_name LIKE '%user_id' OR c.column_name IN ('patient_id','parent_id','specimen_id','item_id','requirement_id','rejected_specimen_id','replacement_specimen_id'))
 LOOP EXECUTE format('CREATE INDEX ON %I (%I)',r.table_name,r.column_name); END LOOP;
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('hms_lab_specimens','hms_lab_specimen_links','hms_lab_custody','hms_lab_recollections')
 LOOP EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',r.tablename,r.tablename); END LOOP;
END $$;
