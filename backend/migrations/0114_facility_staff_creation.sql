-- A new hospital login receives membership in the approved acting facility
-- (initial deployment facility during explicit seeding). This confers no
-- prescribing, signing, nursing, dispensing or laboratory privilege.
CREATE FUNCTION hms_new_staff_facility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE facility uuid; actor integer;
BEGIN
 facility:=coalesce(nullif(current_setting('hms.facility_id',true),'')::uuid,hms_initial_facility());
 actor:=nullif(current_setting('hms.actor_user_id',true),'')::integer;
 INSERT INTO hms_facility_memberships(facility_id,user_id,granted_by_user_id,reason)
 VALUES(facility,NEW.id,actor,'Membership from explicit hospital staff-account creation; no clinical privileges are granted');
 RETURN NEW;
END $$;
CREATE TRIGGER trg_new_staff_facility AFTER INSERT ON hms_users FOR EACH ROW EXECUTE FUNCTION hms_new_staff_facility();
