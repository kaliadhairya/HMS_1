-- The hospital's calendar day in SQL (blueprint 3.2). Timestamps without a
-- time zone in this schema hold UTC (the server and database run in UTC), so
-- "today" comparisons must convert them to the facility's day instead of
-- using CURRENT_DATE or TRUNC(), which give the UTC day: between 00:00 and
-- 05:30 IST that is still yesterday. The zone comes from the hms.facility_tz
-- setting when present, otherwise Asia/Kolkata.

CREATE FUNCTION hms_facility_tz() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('hms.facility_tz', true), ''), 'Asia/Kolkata')
$$;

-- Today in the facility.
CREATE FUNCTION hms_service_today() RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE hms_facility_tz())::date
$$;

-- The facility day of a stored UTC timestamp (without time zone).
CREATE FUNCTION hms_service_date(ts timestamp) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT ((ts AT TIME ZONE 'UTC') AT TIME ZONE hms_facility_tz())::date
$$;

-- The facility day of an instant.
CREATE FUNCTION hms_service_date(ts timestamptz) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (ts AT TIME ZONE hms_facility_tz())::date
$$;

-- Start of today in the facility, as a stored UTC timestamp, for range
-- conditions that can use an index (column >= hms_service_day_start()).
CREATE FUNCTION hms_service_day_start() RETURNS timestamp LANGUAGE sql STABLE AS $$
  SELECT ((date_trunc('day', now() AT TIME ZONE hms_facility_tz())) AT TIME ZONE hms_facility_tz()) AT TIME ZONE 'UTC'
$$;
