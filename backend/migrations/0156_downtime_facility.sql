-- Completion C6 with Codex's A2 facility contract: a downtime kit holds the
-- admitted patients of one facility, and a ward machine belongs to one
-- facility and receives only that facility's kit. Existing machines and
-- kits belong to the initial facility (explicit backfill, as in 0116).
ALTER TABLE hms_downtime_snapshots ADD COLUMN facility_id UUID REFERENCES hms_facilities (id);
UPDATE hms_downtime_snapshots SET facility_id = hms_initial_facility();
ALTER TABLE hms_downtime_snapshots ALTER COLUMN facility_id SET NOT NULL;
CREATE INDEX ix_downtime_snapshots_facility ON hms_downtime_snapshots (facility_id, generated_at DESC);

ALTER TABLE hms_downtime_stations ADD COLUMN facility_id UUID REFERENCES hms_facilities (id);
UPDATE hms_downtime_stations SET facility_id = hms_initial_facility();
ALTER TABLE hms_downtime_stations ALTER COLUMN facility_id SET NOT NULL;
DROP INDEX ux_downtime_station_name;
CREATE UNIQUE INDEX ux_downtime_station_name ON hms_downtime_stations (facility_id, lower(btrim(name))) WHERE revoked_at IS NULL;
