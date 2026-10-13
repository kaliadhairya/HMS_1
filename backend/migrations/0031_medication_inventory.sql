-- Physical lots retain the existing manufacturer lot and expiry. Locations and
-- an append-only journal are the authority for movements after this migration.
ALTER TABLE hms_medicine_batches ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_stock_ledger ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_purchase_items ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_dispensing_items ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_otc_items ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_bill_items ALTER COLUMN quantity TYPE NUMERIC(18,6);
ALTER TABLE hms_medicine_batches ADD COLUMN lot_status TEXT NOT NULL DEFAULT 'AVAILABLE'
 CHECK(lot_status IN ('AVAILABLE','QUARANTINED','RECALLED','EXPIRED'));
ALTER TABLE hms_medicine_batches ADD COLUMN provenance JSONB NOT NULL DEFAULT '{"source":"legacy manufacturer lot and expiry"}';
CREATE TABLE hms_med_locations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL CHECK(length(trim(name))>0), kind TEXT NOT NULL CHECK(kind IN ('STORE','WARD','TRANSIT','QUARANTINE')),
 ward_id INTEGER REFERENCES hms_wards(id), created_by_user_id INTEGER REFERENCES hms_users(id)
);
INSERT INTO hms_med_locations(code,name,kind) VALUES
 ('MAIN','Main pharmacy','STORE'),('TRANSIT','In transit','TRANSIT'),('QUARANTINE','Returned stock quarantine','QUARANTINE');
CREATE TABLE hms_med_balances (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id),
 location_id UUID NOT NULL REFERENCES hms_med_locations(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>=0),
 UNIQUE(batch_id,location_id)
);
CREATE TABLE hms_med_movements (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id),
 location_id UUID NOT NULL REFERENCES hms_med_locations(id), delta NUMERIC(18,6) NOT NULL CHECK(delta<>0),
 source_type TEXT NOT NULL CHECK(length(trim(source_type))>0), source_id TEXT NOT NULL,
 actor_user_id INTEGER REFERENCES hms_users(id), reason TEXT NOT NULL,
 occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(), balance_after NUMERIC(18,6) NOT NULL CHECK(balance_after>=0)
);
CREATE FUNCTION med_no_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Clinical and stock history is append-only'; END $$;
CREATE TRIGGER trg_med_movement_immutable BEFORE UPDATE OR DELETE ON hms_med_movements FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
INSERT INTO hms_med_balances(batch_id,location_id,quantity)
 SELECT b.id,l.id,b.quantity FROM hms_medicine_batches b CROSS JOIN hms_med_locations l WHERE l.code='MAIN';
INSERT INTO hms_med_movements(batch_id,location_id,delta,source_type,source_id,reason,balance_after)
 SELECT batch_id,location_id,quantity,'MIGRATION_BASELINE',batch_id::text,
 'Recorded opening balance at Phase 3 cutover; legacy ledger retained separately',quantity FROM hms_med_balances WHERE quantity>0;
-- Main-location quantities are changed through the same locked batch as older
-- receipt/counter-sale routes; the trigger prevents two competing projections.
CREATE FUNCTION med_sync_main_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE loc uuid; change numeric; actor integer;
BEGIN
 SELECT id INTO loc FROM hms_med_locations WHERE code='MAIN';
 change:=NEW.quantity-CASE WHEN TG_OP='INSERT' THEN 0 ELSE OLD.quantity END;
 INSERT INTO hms_med_balances(batch_id,location_id,quantity) VALUES(NEW.id,loc,NEW.quantity)
 ON CONFLICT(batch_id,location_id) DO UPDATE SET quantity=EXCLUDED.quantity;
 IF change<>0 THEN
 actor:=NULLIF(current_setting('hms.actor_user_id',true),'')::integer;
 INSERT INTO hms_med_movements(batch_id,location_id,delta,source_type,source_id,actor_user_id,reason,balance_after)
 VALUES(NEW.id,loc,change,coalesce(nullif(current_setting('med.source_type',true),''),'LEGACY_STOCK_COMMAND'),
 coalesce(nullif(current_setting('med.source_id',true),''),NEW.id::text),actor,
 coalesce(nullif(current_setting('med.reason',true),''),'Main stock quantity change'),NEW.quantity);
 END IF; RETURN NULL;
END $$;
CREATE TRIGGER trg_med_sync_main AFTER INSERT OR UPDATE OF quantity ON hms_medicine_batches FOR EACH ROW EXECUTE FUNCTION med_sync_main_balance();
CREATE TABLE hms_med_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), supplier_id INTEGER NOT NULL REFERENCES hms_suppliers(id),
 invoice_ref TEXT NOT NULL CHECK(length(trim(invoice_ref))>0), request_hash TEXT NOT NULL,
 received_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(supplier_id,invoice_ref)
);
CREATE TABLE hms_med_receipt_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id UUID NOT NULL REFERENCES hms_med_receipts(id),
 batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 purchase_rate NUMERIC(18,6) NOT NULL CHECK(purchase_rate>=0), provenance JSONB NOT NULL
);
CREATE TABLE hms_med_substitutions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version_id UUID NOT NULL REFERENCES hms_med_order_versions(id),
 product_id UUID NOT NULL REFERENCES hms_med_products(id), authorized_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), authorized_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(version_id,product_id)
);
CREATE TABLE hms_med_dispenses (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version_id UUID NOT NULL REFERENCES hms_med_order_versions(id),
 patient_id INTEGER NOT NULL REFERENCES hms_patients(id), dispenser_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_med_dispense_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispense_id UUID NOT NULL REFERENCES hms_med_dispenses(id),
 version_id UUID NOT NULL REFERENCES hms_med_order_versions(id), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id), location_id UUID NOT NULL REFERENCES hms_med_locations(id),
 substitution_id UUID REFERENCES hms_med_substitutions(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 unit TEXT NOT NULL, rate NUMERIC(18,6) NOT NULL CHECK(rate>=0), amount NUMERIC(18,2) NOT NULL CHECK(amount>=0)
);
CREATE TABLE hms_med_charges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispense_line_id UUID NOT NULL UNIQUE REFERENCES hms_med_dispense_lines(id),
 encounter_id INTEGER NOT NULL REFERENCES hms_encounters(id), admission_id INTEGER REFERENCES hms_admissions(id),
 amount NUMERIC(18,2) NOT NULL CHECK(amount>=0), currency TEXT NOT NULL DEFAULT 'INR' CHECK(currency='INR'),
 posted_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_med_charge_immutable BEFORE UPDATE OR DELETE ON hms_med_charges FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TABLE hms_med_returns (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispense_line_id UUID NOT NULL REFERENCES hms_med_dispense_lines(id),
 quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 received_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), financial_credit_status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(financial_credit_status IN ('PENDING','REFERRED')), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_med_requisitions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 destination_id UUID NOT NULL REFERENCES hms_med_locations(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 state TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','APPROVED','PICKED','RECEIVED')),
 requested_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), approved_by_user_id INTEGER REFERENCES hms_users(id),
 received_by_user_id INTEGER REFERENCES hms_users(id), reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_med_transfer_lines (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), requisition_id UUID NOT NULL REFERENCES hms_med_requisitions(id),
 batch_id INTEGER NOT NULL REFERENCES hms_medicine_batches(id), quantity NUMERIC(18,6) NOT NULL CHECK(quantity>0),
 picked_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), received_at TIMESTAMPTZ,
 UNIQUE(requisition_id,batch_id)
);
CREATE TRIGGER trg_audit_hms_med_locations AFTER INSERT OR UPDATE OR DELETE ON hms_med_locations FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_balances AFTER INSERT OR UPDATE OR DELETE ON hms_med_balances FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_movements AFTER INSERT OR UPDATE OR DELETE ON hms_med_movements FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_receipts AFTER INSERT OR UPDATE OR DELETE ON hms_med_receipts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_receipt_lines AFTER INSERT OR UPDATE OR DELETE ON hms_med_receipt_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_substitutions AFTER INSERT OR UPDATE OR DELETE ON hms_med_substitutions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_dispenses AFTER INSERT OR UPDATE OR DELETE ON hms_med_dispenses FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_dispense_lines AFTER INSERT OR UPDATE OR DELETE ON hms_med_dispense_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_charges AFTER INSERT OR UPDATE OR DELETE ON hms_med_charges FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_returns AFTER INSERT OR UPDATE OR DELETE ON hms_med_returns FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_requisitions AFTER INSERT OR UPDATE OR DELETE ON hms_med_requisitions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_transfer_lines AFTER INSERT OR UPDATE OR DELETE ON hms_med_transfer_lines FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conrelid::regclass AS tab, conname, conkey FROM pg_constraint WHERE contype='f'
 AND conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'hms_med_%') LOOP
 EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', 'ix_med_'||substr(md5(r.tab::text||r.conname),1,24),r.tab,
 (SELECT string_agg(quote_ident(attname),',') FROM pg_attribute WHERE attrelid=r.tab AND attnum=ANY(r.conkey)));
 END LOOP; END $$;
