-- Completion C6 with Codex's A2 facility contract: a downtime kit holds the
-- admitted patients of one facility, and a ward machine belongs to one
-- facility and receives only that facility's kit. Existing machines and
-- kits belong to the initial facility (explicit backfill, as in 0116).
ALTER TABLE hms_downtime_snapshots ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES hms_facilities (id);
UPDATE hms_downtime_snapshots SET facility_id = hms_initial_facility() WHERE facility_id IS NULL;
ALTER TABLE hms_downtime_snapshots ALTER COLUMN facility_id SET NOT NULL;
CREATE INDEX ix_downtime_snapshots_facility ON hms_downtime_snapshots (facility_id, generated_at DESC);

ALTER TABLE hms_downtime_stations ADD COLUMN IF NOT EXISTS facility_id UUID REFERENCES hms_facilities (id);
UPDATE hms_downtime_stations SET facility_id = hms_initial_facility() WHERE facility_id IS NULL;
ALTER TABLE hms_downtime_stations ALTER COLUMN facility_id SET NOT NULL;
DROP INDEX ux_downtime_station_name;
CREATE UNIQUE INDEX ux_downtime_station_name ON hms_downtime_stations (facility_id, lower(btrim(name))) WHERE revoked_at IS NULL;

-- Apply the same clinical facility policy as the established A2-owned tables.
ALTER TABLE hms_downtime_stations ALTER COLUMN facility_id SET DEFAULT hms_current_facility();
ALTER TABLE hms_downtime_stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON hms_downtime_stations USING(hms_authorized_facility(facility_id)) WITH CHECK(hms_authorized_facility(facility_id));
CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_downtime_stations FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write();
