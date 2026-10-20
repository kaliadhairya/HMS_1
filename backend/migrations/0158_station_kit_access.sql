-- A2: a ward machine reads its kit, records that it stored and opened it, and clears its
-- "behind" alert with no user session, so the facility row policies (which need a signed-in
-- member) would hide every row from it. These functions run with the owner's rights and act
-- only for one registered, unrevoked station, and only within that station's facility.
CREATE OR REPLACE FUNCTION hms_station_latest_snapshot(p_station uuid)
RETURNS TABLE (id uuid, file_name text, sha256 text, generated_at timestamptz, stale_after timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sn.id, sn.file_name, sn.sha256, sn.generated_at, sn.stale_after
    FROM hms_downtime_stations st
    JOIN hms_downtime_snapshots sn ON sn.facility_id = st.facility_id
   WHERE st.id = p_station AND st.revoked_at IS NULL
   ORDER BY sn.generated_at DESC
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION hms_station_snapshot(p_station uuid, p_snapshot uuid)
RETURNS TABLE (id uuid, sha256 text, stale_after timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sn.id, sn.sha256, sn.stale_after
    FROM hms_downtime_stations st
    JOIN hms_downtime_snapshots sn ON sn.facility_id = st.facility_id
   WHERE st.id = p_station AND st.revoked_at IS NULL AND sn.id = p_snapshot
$$;

CREATE OR REPLACE FUNCTION hms_station_record_receipt(p_station uuid, p_snapshot uuid, p_sha256 text, p_opened boolean)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO hms_downtime_station_receipts (station_id, snapshot_id, sha256, opened)
  SELECT st.id, sn.id, sn.sha256, p_opened
    FROM hms_downtime_stations st
    JOIN hms_downtime_snapshots sn ON sn.facility_id = st.facility_id
   WHERE st.id = p_station AND st.revoked_at IS NULL AND sn.id = p_snapshot AND sn.sha256 = p_sha256
  ON CONFLICT (station_id, snapshot_id) DO NOTHING
$$;

CREATE OR REPLACE FUNCTION hms_station_caught_up(p_station uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE hms_worklist_items w
     SET detail = w.detail || jsonb_build_object('caught_up_at', now()), last_seen_at = now()
   WHERE w.kind = 'downtime.station_behind' AND w.dedupe_key = p_station::text
     AND w.status = 'Open' AND w.detail->>'caught_up_at' IS NULL
     AND EXISTS (SELECT 1 FROM hms_downtime_stations st
                  WHERE st.id = p_station AND st.facility_id = w.facility_id AND st.revoked_at IS NULL)
$$;

REVOKE ALL ON FUNCTION hms_station_latest_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hms_station_snapshot(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hms_station_record_receipt(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION hms_station_caught_up(uuid) FROM PUBLIC;
