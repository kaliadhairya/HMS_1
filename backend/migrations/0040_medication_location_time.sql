-- Manufacturer expiry dates use the stock location's business date.
ALTER TABLE hms_med_locations ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata' CHECK(length(trim(timezone))>0);
CREATE FUNCTION med_location_timezone_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'Unknown location timezone'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_med_location_timezone BEFORE INSERT OR UPDATE ON hms_med_locations FOR EACH ROW EXECUTE FUNCTION med_location_timezone_guard();
