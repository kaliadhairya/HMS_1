ALTER TABLE hms_facility_memberships ADD COLUMN revocation_reason text CHECK(revocation_reason IS NULL OR length(btrim(revocation_reason))>=10);
CREATE FUNCTION hms_membership_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  -- Account administration may remove only an unused creation-time scaffold;
  -- actual membership approvals, sessions and professional history remain.
  IF OLD.reason='Membership from explicit hospital staff-account creation; no clinical privileges are granted'
   AND NOT EXISTS(SELECT 1 FROM hms_sessions WHERE user_id=OLD.user_id)
   AND NOT EXISTS(SELECT 1 FROM hms_practitioners p JOIN hms_practitioner_roles r ON r.practitioner_id=p.id WHERE p.user_id=OLD.user_id)
   AND NOT EXISTS(SELECT 1 FROM hms_practitioners p JOIN hms_practitioner_credentials c ON c.practitioner_id=p.id WHERE p.user_id=OLD.user_id)
  THEN RETURN OLD; END IF;
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Facility membership history is retained; revoke the grant instead';
 END IF;
 IF (to_jsonb(NEW)-'revoked_at'-'revoked_by_user_id'-'revocation_reason'-'revision') IS DISTINCT FROM
    (to_jsonb(OLD)-'revoked_at'-'revoked_by_user_id'-'revocation_reason'-'revision') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Facility membership identity and grant evidence are immutable';
 END IF;
 IF OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='A revoked membership is never restored or rewritten';
 END IF;
 IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND (NEW.revocation_reason IS NULL OR length(btrim(NEW.revocation_reason))<10) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Membership revocation needs an attributable reason';
 END IF;
 NEW.revision:=CASE WHEN NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN OLD.revision+1 ELSE OLD.revision END;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_membership_history_guard BEFORE UPDATE OR DELETE ON hms_facility_memberships FOR EACH ROW EXECUTE FUNCTION hms_membership_history_guard();
CREATE FUNCTION hms_facility_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Facility identity is immutable';
 END IF;
 NEW.revision:=CASE WHEN (to_jsonb(NEW)-'revision') IS DISTINCT FROM (to_jsonb(OLD)-'revision') THEN OLD.revision+1 ELSE OLD.revision END;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_facility_revision_guard BEFORE UPDATE ON hms_facilities FOR EACH ROW EXECUTE FUNCTION hms_facility_revision_guard();
