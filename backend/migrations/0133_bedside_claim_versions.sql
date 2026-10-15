-- A bedside claim is observable occurrence state even before dose documentation.
-- Advance the schedule's public review version for both legacy and v2 callers.
ALTER TABLE hms_med_schedules ADD COLUMN bedside_revision bigint NOT NULL DEFAULT 0 CHECK(bedside_revision>=0);
UPDATE hms_med_schedules s SET bedside_revision=1
 WHERE EXISTS(SELECT 1 FROM hms_med_documentation_intents i WHERE i.schedule_id=s.id);
CREATE FUNCTION hms_med_claim_schedule_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.schedule_id IS DISTINCT FROM OLD.schedule_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Bedside claims cannot be moved to another occurrence';
 END IF;
 UPDATE hms_med_schedules SET bedside_revision=bedside_revision+1 WHERE id=NEW.schedule_id;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_med_claim_schedule_version AFTER INSERT OR UPDATE ON hms_med_documentation_intents
 FOR EACH ROW EXECUTE FUNCTION hms_med_claim_schedule_version();
