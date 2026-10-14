-- Stable names make fresh/upgrade and PostgreSQL 16/18 schema comparisons
-- independent of the catalog OIDs allocated during migration 0116.
DO $$ DECLARE r record; stable_name text; BEGIN
 FOR r IN SELECT c.oid,c.conrelid::regclass child,c.confrelid::regclass parent,c.conname,
   (SELECT string_agg(a.attname,',' ORDER BY k.position) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) keys
 FROM pg_constraint c WHERE c.contype='f' AND c.conname ~ '^fk_fac_[0-9]+$'
 LOOP
  stable_name:='fk_fac_'||substr(md5(r.child::text||':'||r.parent::text||':'||r.keys),1,24);
  EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',r.child,r.conname,stable_name);
 END LOOP;
END $$;

-- No default facility is accepted by runtime read policies. The initial
-- facility fallback remains available only to explicit migration/bootstrap
-- identities, which must never be the production application identity.
CREATE FUNCTION hms_authorized_facility(the_facility uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT the_facility=nullif(current_setting('hms.facility_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM hms_facility_memberships m JOIN hms_facilities f ON f.id=m.facility_id
  JOIN hms_users u ON u.id=m.user_id
  WHERE m.facility_id=the_facility AND m.user_id=nullif(current_setting('hms.actor_user_id',true),'')::integer
  AND u.is_active=1 AND f.status='ACTIVE' AND m.revoked_at IS NULL
  AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()))
$$;
CREATE FUNCTION hms_guard_facility_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW.facility_id IS DISTINCT FROM OLD.facility_id THEN
  RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Facility ownership is immutable; use a reviewed transfer command';
 END IF;
 -- This extra guard also protects authenticated requests in development
 -- checkouts that use the migration owner. Production uses a non-owner
 -- identity and the row policies below protect reads and all writes.
 IF nullif(current_setting('hms.actor_user_id',true),'') IS NOT NULL
  AND NOT coalesce(hms_authorized_facility(CASE WHEN TG_OP='DELETE' THEN OLD.facility_id ELSE NEW.facility_id END),false) THEN
  RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Clinical operation requires current facility membership and matching ownership';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT table_name FROM hms_facility_backfills ORDER BY table_name LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',r.table_name);
  EXECUTE format('CREATE POLICY facility_scope ON %I USING(hms_authorized_facility(facility_id)) WITH CHECK(hms_authorized_facility(facility_id))',r.table_name);
  EXECUTE format('CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write()',r.table_name);
 END LOOP;
END $$;

-- A lot belongs to one facility and its opening balance must use that
-- facility's pharmacy, regardless of how many other MAIN locations exist.
CREATE OR REPLACE FUNCTION med_sync_main_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE loc uuid; change numeric; actor integer;
BEGIN
 SELECT id INTO loc FROM hms_med_locations WHERE code='MAIN' AND facility_id=NEW.facility_id;
 IF loc IS NULL THEN RAISE EXCEPTION 'Configure the facility main pharmacy before receiving stock'; END IF;
 change:=NEW.quantity-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantity END;
 INSERT INTO hms_med_balances(batch_id,location_id,quantity,facility_id) VALUES(NEW.id,loc,NEW.quantity,NEW.facility_id)
 ON CONFLICT(batch_id,location_id) DO UPDATE SET quantity=EXCLUDED.quantity;
 IF change<>0 THEN
  actor:=NULLIF(current_setting('hms.actor_user_id',true),'')::integer;
  INSERT INTO hms_med_movements(batch_id,location_id,delta,source_type,source_id,actor_user_id,reason,balance_after,facility_id)
  VALUES(NEW.id,loc,change,coalesce(nullif(current_setting('med.source_type',true),''),'LEGACY_STOCK_COMMAND'),
   coalesce(nullif(current_setting('med.source_id',true),''),NEW.id::text),actor,
   coalesce(nullif(current_setting('med.reason',true),''),'Main stock quantity change'),NEW.quantity,NEW.facility_id);
 END IF;
 RETURN NULL;
END $$;
