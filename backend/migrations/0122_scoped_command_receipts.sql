-- Preserve old receipts and their original hashes. Their version identifies
-- which request semantics can actually be proven during a retry.
ALTER TABLE hms_idempotency_keys ADD COLUMN facility_id uuid NOT NULL DEFAULT hms_initial_facility() REFERENCES hms_facilities(id);
ALTER TABLE hms_idempotency_keys ADD COLUMN hash_version integer NOT NULL DEFAULT 1 CHECK(hash_version IN (1,2));
INSERT INTO hms_facility_backfills(facility_id,table_name,row_count,basis)
 SELECT hms_initial_facility(),'hms_idempotency_keys',count(*),'Explicit initial-facility ownership of receipts from the single-hospital conversion' FROM hms_idempotency_keys;
ALTER TABLE hms_idempotency_keys ALTER COLUMN facility_id SET DEFAULT hms_current_facility();
ALTER TABLE hms_idempotency_keys ALTER COLUMN hash_version SET DEFAULT 2;
CREATE INDEX ix_receipt_facility_user ON hms_idempotency_keys(facility_id,user_id);
ALTER TABLE hms_idempotency_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON hms_idempotency_keys
 USING(hms_authorized_facility(facility_id) AND user_id=nullif(current_setting('hms.actor_user_id',true),'')::integer)
 WITH CHECK(hms_authorized_facility(facility_id) AND user_id=nullif(current_setting('hms.actor_user_id',true),'')::integer);
CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON hms_idempotency_keys
 FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write();
