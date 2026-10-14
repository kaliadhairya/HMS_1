-- Coded lab tests are priced by their catalogue identity, not by name
-- (Phase 5 open item; Phase 4 catalogue). For an order item with a
-- catalogue test version, in the active price list:
--   1. a Lab price tied to that catalogue test (lab_test_id), else
--   2. the price of the tariff the catalogue names for that version
--      (hms_lab_test_versions.tariff_id -> price list item TARIFF-<id>), else
--   3. the default lab price.
-- The name is never used to guess a coded test's price. Orders made before
-- the catalogue (no test version) keep the old name rule (migration 0071).

ALTER TABLE hms_charge_master_items ADD COLUMN lab_test_id UUID REFERENCES hms_lab_tests (id);
ALTER TABLE hms_charge_master_items ADD CONSTRAINT ck_cm_item_lab_test CHECK (lab_test_id IS NULL OR category = 'Lab');
CREATE UNIQUE INDEX ux_cm_items_lab_test ON hms_charge_master_items (version_id, lab_test_id) WHERE lab_test_id IS NOT NULL;

CREATE FUNCTION billing_lab_item_coded(p_test_version UUID) RETURNS hms_charge_master_items
LANGUAGE sql STABLE AS $$
  SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
    LEFT JOIN hms_lab_test_versions tv ON tv.id = p_test_version
   WHERE v.status = 'Active' AND i.category = 'Lab'
     AND (i.lab_test_id = tv.test_id OR i.code = 'TARIFF-' || tv.tariff_id OR i.code = 'LAB-DEFAULT')
   ORDER BY (i.lab_test_id IS NOT DISTINCT FROM tv.test_id) DESC, (i.code = 'TARIFF-' || tv.tariff_id) DESC NULLS LAST, i.code
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION billing_capture_lab_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ord RECORD;
  item hms_charge_master_items;
  charge UUID;
  actor INTEGER := NULLIF(current_setting('hms.actor_user_id', true), '')::integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
      SELECT id INTO charge FROM hms_charge_events WHERE source_type = 'lab_order_item' AND source_key = NEW.id::text;
      IF charge IS NOT NULL THEN PERFORM billing_reverse_charge(charge, 'Lab test cancelled', actor); END IF;
    END IF;
    RETURN NULL;
  END IF;
  IF COALESCE(NEW.status, '') = 'Cancelled' THEN RETURN NULL; END IF;
  SELECT encounter_id, status INTO ord FROM hms_investigation_orders WHERE id = NEW.order_id;
  -- An order outside an encounter has no explicit episode to charge.
  IF ord.encounter_id IS NULL OR COALESCE(ord.status, '') = 'Cancelled' THEN RETURN NULL; END IF;
  IF NEW.lab_test_version_id IS NOT NULL THEN
    item := billing_lab_item_coded(NEW.lab_test_version_id);
  ELSE
    item := billing_lab_item(NEW.item_name);
  END IF;
  IF item.id IS NULL THEN RETURN NULL; END IF;
  PERFORM billing_capture_charge(billing_account_for(ord.encounter_id, NULL), 'lab_order_item', NEW.id::text, 'Lab',
    item.code, NEW.item_name, item.id, 'charge_master', 1, item.unit_price, item.gst_rate,
    COALESCE(NEW.created_at, now()), actor);
  RETURN NULL;
END $$;
