-- Only the migration/table owner can extend the registry or write mappings.
-- Runtime inserts are captured through the fixed-path resource trigger.
CREATE FUNCTION hms_guard_identity_insert_authority() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user IS DISTINCT FROM (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Identity registry writes require the migration authority';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_identity_insert_authority BEFORE INSERT ON hms_identity_resources
 FOR EACH ROW EXECUTE FUNCTION hms_guard_identity_insert_authority();
CREATE TRIGGER trg_identity_insert_authority BEFORE INSERT ON hms_legacy_identity_map
 FOR EACH ROW EXECUTE FUNCTION hms_guard_identity_insert_authority();
-- Business immutability guards inspect the original fields first; the
-- transport counter is updated last, so it cannot invalidate allowed changes
-- merely by introducing a new metadata column.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tgrelid::regclass tab FROM pg_trigger WHERE tgname='trg_api_version' AND NOT tgisinternal LOOP
  EXECUTE format('ALTER TRIGGER trg_api_version ON %s RENAME TO trg_zz_api_version',r.tab);
 END LOOP;
END $$;
