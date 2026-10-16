-- Upgrade an installation that had already applied original 0156 before A2
-- was integrated. Fresh installs apply the same policy via its pinned compat
-- artifact after 0152 creates the table. Existing ownership is preserved.
DO $$ BEGIN
 IF to_regclass('public.hms_downtime_stations') IS NOT NULL AND EXISTS(
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='hms_downtime_stations' AND column_name='facility_id'
 ) THEN
  ALTER TABLE hms_downtime_stations ALTER COLUMN facility_id SET DEFAULT hms_current_facility();
  ALTER TABLE hms_downtime_stations ENABLE ROW LEVEL SECURITY;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='hms_downtime_stations' AND policyname='facility_scope') THEN
   CREATE POLICY facility_scope ON hms_downtime_stations USING(hms_authorized_facility(facility_id)) WITH CHECK(hms_authorized_facility(facility_id));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='hms_downtime_stations'::regclass AND tgname='trg_facility_guard') THEN
   CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_downtime_stations FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write();
  END IF;
 END IF;
END $$;
