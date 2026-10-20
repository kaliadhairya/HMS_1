-- A2: a ward machine authenticates before any facility context exists, so the
-- restricted runtime identity (subject to the facility row policy) could never see its
-- own station record. These two narrow functions run with the owner's rights and touch
-- only the one station the caller already holds a token for; the table stays protected.
CREATE OR REPLACE FUNCTION hms_authenticate_station(p_token_sha256 text)
RETURNS TABLE (id uuid, name text, location text, revoked_at timestamptz, facility_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.name, s.location, s.revoked_at, s.facility_id
    FROM hms_downtime_stations s
   WHERE s.token_sha256 = p_token_sha256 AND s.revoked_at IS NULL
$$;

CREATE OR REPLACE FUNCTION hms_touch_station(p_station_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE hms_downtime_stations SET last_pull_at = now() WHERE id = p_station_id
$$;

REVOKE ALL ON FUNCTION hms_authenticate_station(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION hms_touch_station(uuid) FROM PUBLIC;
