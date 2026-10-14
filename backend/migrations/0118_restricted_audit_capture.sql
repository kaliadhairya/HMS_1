-- The application must not be able to forge row-change entries or mutate
-- audit history. A fixed-path trigger captures changes with its owner's
-- limited authority inside the clinical transaction.
ALTER FUNCTION audit.capture_change() SECURITY DEFINER;
ALTER FUNCTION audit.capture_change() SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION audit.capture_change() FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
