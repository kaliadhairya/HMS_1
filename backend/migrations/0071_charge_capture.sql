-- 0071: charge capture at the point of service (blueprint 3.6 "Billable events
-- are persisted when services occur; billing must not depend on an in-memory
-- page draft"; "Ward charges follow versioned occupancy intervals and tariff
-- rules, including transfers"; 4.4 "Consultation, test, dispense, procedure or
-- occupancy event -> Unique charge event").
--
-- Sources, each captured once:
--   consultation            an encounter becomes Finalized (any path)
--   lab_order_item          a lab test is ordered; cancelling it reverses the charge
--   medicine_dispense_line  a coded dispense line (Phase 3 hms_med_charges row)
--   ward_day                one charge per bed day, priced by the ward the
--                           patient was in at the start of that day
-- Triggers are used so that the Phase 3 and Phase 4 code paths are not edited.

-- ── Consultation ────────────────────────────────────────────
CREATE FUNCTION billing_consultation_item(p_doctor INTEGER) RETURNS hms_charge_master_items
LANGUAGE sql STABLE AS $$
  -- The doctor's own fee, else a general consultation fee, else the default.
  SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
   WHERE v.status = 'Active' AND i.category = 'Consultation' AND (i.doctor_id = p_doctor OR i.doctor_id IS NULL)
   ORDER BY i.doctor_id NULLS LAST, (i.code = 'CONSULT-DEFAULT'), i.code
   LIMIT 1
$$;

CREATE FUNCTION billing_capture_consultation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item hms_charge_master_items;
BEGIN
  IF NEW.status IS DISTINCT FROM 'Finalized' OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'Finalized') THEN
    RETURN NULL;
  END IF;
  item := billing_consultation_item(NEW.doctor_id);
  IF item.id IS NULL THEN RETURN NULL; END IF;
  PERFORM billing_capture_charge(billing_account_for(NEW.id, NULL), 'consultation', NEW.id::text, 'Consultation',
    item.code, item.name, item.id, 'charge_master', 1, item.unit_price, item.gst_rate,
    COALESCE(NEW.encounter_date, now()), NULLIF(current_setting('hms.actor_user_id', true), '')::integer);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_consultation AFTER INSERT OR UPDATE OF status ON hms_encounters
  FOR EACH ROW EXECUTE FUNCTION billing_capture_consultation();

-- ── Lab tests ───────────────────────────────────────────────
CREATE FUNCTION billing_lab_item(p_test TEXT) RETURNS hms_charge_master_items
LANGUAGE sql STABLE AS $$
  -- Same rule as the old OPD bill: a lab tariff whose name contains the test
  -- name, else the default lab price.
  SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
   WHERE v.status = 'Active' AND i.category = 'Lab'
     AND (upper(i.match_name) LIKE '%' || upper(p_test) || '%' OR i.code = 'LAB-DEFAULT')
   ORDER BY (i.code = 'LAB-DEFAULT'), i.code
   LIMIT 1
$$;

CREATE FUNCTION billing_capture_lab_item() RETURNS trigger LANGUAGE plpgsql AS $$
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
  item := billing_lab_item(NEW.item_name);
  IF item.id IS NULL THEN RETURN NULL; END IF;
  PERFORM billing_capture_charge(billing_account_for(ord.encounter_id, NULL), 'lab_order_item', NEW.id::text, 'Lab',
    item.code, NEW.item_name, item.id, 'charge_master', 1, item.unit_price, item.gst_rate,
    COALESCE(NEW.created_at, now()), actor);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_lab_item AFTER INSERT OR UPDATE OF status ON hms_investigation_order_items
  FOR EACH ROW EXECUTE FUNCTION billing_capture_lab_item();

-- A whole order cancelled reverses every test on it.
CREATE FUNCTION billing_cancel_lab_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
  IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
    FOR c IN SELECT ce.id FROM hms_charge_events ce JOIN hms_investigation_order_items i ON ce.source_key = i.id::text
              WHERE ce.source_type = 'lab_order_item' AND i.order_id = NEW.id LOOP
      PERFORM billing_reverse_charge(c.id, 'Lab order cancelled', NULLIF(current_setting('hms.actor_user_id', true), '')::integer);
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_lab_order_cancel AFTER UPDATE OF status ON hms_investigation_orders
  FOR EACH ROW EXECUTE FUNCTION billing_cancel_lab_order();

-- ── Coded dispensing (Phase 3) ──────────────────────────────
-- Priced at the dispensed batch's MRP, which is tax inclusive (no GST added).
CREATE FUNCTION billing_product_label(p_name TEXT, p_strength NUMERIC, p_unit TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name || COALESCE(' ' || (p_strength::float8)::text || COALESCE(p_unit, ''), '')
$$;

CREATE FUNCTION billing_capture_dispense() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l RECORD;
BEGIN
  SELECT dl.quantity, dl.rate, p.name, p.code, p.strength, p.strength_unit, d.created_at
    INTO l
    FROM hms_med_dispense_lines dl
    JOIN hms_med_products p ON p.id = dl.product_id
    JOIN hms_med_dispenses d ON d.id = dl.dispense_id
   WHERE dl.id = NEW.dispense_line_id;
  PERFORM billing_capture_charge(billing_account_for(NEW.encounter_id, NEW.admission_id), 'medicine_dispense_line',
    NEW.dispense_line_id::text, 'Medicine', l.code, billing_product_label(l.name, l.strength, l.strength_unit),
    NULL, 'source', l.quantity, l.rate, 0, COALESCE(l.created_at, NEW.created_at), NEW.posted_by_user_id);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_dispense AFTER INSERT ON hms_med_charges
  FOR EACH ROW EXECUTE FUNCTION billing_capture_dispense();

-- ── Bed days ────────────────────────────────────────────────
-- Days are counted as before (whole days since admission, at least one); day i
-- is priced by the ward of the bed occupied at admission + i days, so a
-- transfer changes the rate from the next day on. An active admission is
-- charged for the days completed so far; discharge charges the rest, and a
-- discharge dated earlier reverses days that no longer fall in the stay.
CREATE FUNCTION billing_ward_item(p_ward_type TEXT) RETURNS hms_charge_master_items
LANGUAGE sql STABLE AS $$
  SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
   WHERE v.status = 'Active' AND i.category = 'Ward' AND (i.ward_type = p_ward_type OR i.code = 'WARD-DEFAULT')
   ORDER BY (i.code = 'WARD-DEFAULT'), i.code
   LIMIT 1
$$;

CREATE FUNCTION billing_accrue_ward_days(p_admission INTEGER) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE
  adm RECORD;
  days INTEGER;
  i INTEGER;
  day_start TIMESTAMP;
  wtype TEXT;
  wname TEXT;
  item hms_charge_master_items;
  acc UUID;
  c RECORD;
  actor INTEGER := NULLIF(current_setting('hms.actor_user_id', true), '')::integer;
BEGIN
  SELECT id, admission_date, discharge_date, status, bed_id INTO adm FROM hms_admissions WHERE id = p_admission;
  IF adm.id IS NULL OR adm.admission_date IS NULL THEN RETURN 0; END IF;
  days := GREATEST(1, EXTRACT(DAY FROM (COALESCE(adm.discharge_date, CURRENT_TIMESTAMP::timestamp) - adm.admission_date))::integer);
  acc := billing_account_for(NULL, p_admission);
  FOR i IN 0 .. days - 1 LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM hms_charge_events WHERE source_type = 'ward_day' AND source_key = p_admission || ':' || i);
    day_start := adm.admission_date + make_interval(days => i);
    SELECT w.type, w.name INTO wtype, wname
      FROM hms_bed_occupancies o JOIN hms_beds b ON b.id = o.bed_id JOIN hms_wards w ON w.id = b.ward_id
     WHERE o.admission_id = p_admission AND o.starts_at <= day_start::timestamptz
     ORDER BY o.starts_at DESC LIMIT 1;
    IF wtype IS NULL THEN
      SELECT w.type, w.name INTO wtype, wname FROM hms_beds b JOIN hms_wards w ON w.id = b.ward_id WHERE b.id = adm.bed_id;
    END IF;
    item := billing_ward_item(wtype);
    CONTINUE WHEN item.id IS NULL;
    PERFORM billing_capture_charge(acc, 'ward_day', p_admission || ':' || i, 'Ward', item.code,
      COALESCE(wname, COALESCE(wtype, 'Ward')) || ' bed day ' || (i + 1), item.id, 'charge_master', 1, item.unit_price, item.gst_rate,
      day_start::timestamptz, actor);
    wtype := NULL; wname := NULL;
  END LOOP;
  -- A stay shortened by an earlier discharge date.
  IF adm.discharge_date IS NOT NULL THEN
    FOR c IN SELECT ce.id FROM hms_charge_events ce
              WHERE ce.source_type = 'ward_day' AND ce.account_id = acc
                AND split_part(ce.source_key, ':', 2)::integer >= days
                AND NOT EXISTS (SELECT 1 FROM hms_charge_events r WHERE r.reverses_id = ce.id) LOOP
      PERFORM billing_reverse_charge(c.id, 'Bed day after the discharge date', actor);
    END LOOP;
  END IF;
  RETURN days;
END $$;

CREATE FUNCTION billing_capture_discharge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Discharged' AND (OLD.status IS DISTINCT FROM 'Discharged' OR OLD.discharge_date IS DISTINCT FROM NEW.discharge_date) THEN
    PERFORM billing_accrue_ward_days(NEW.id);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_billing_discharge AFTER UPDATE OF status, discharge_date ON hms_admissions
  FOR EACH ROW EXECUTE FUNCTION billing_capture_discharge();

-- ── Backfill for charges no bill covers yet ─────────────────
-- What an earlier bill already charged is not recorded again: a visit whose
-- bill has a consultation line keeps it, and so on. The rest (for example a
-- consultation on a visit the pharmacy billed first) is recorded so it can be
-- invoiced the new way.
SELECT billing_capture_charge(billing_account_for(e.id, NULL), 'consultation', e.id::text, 'Consultation',
       item.code, item.name, item.id, 'charge_master', 1, item.unit_price, item.gst_rate, COALESCE(e.encounter_date, now()), NULL)
  FROM hms_encounters e CROSS JOIN LATERAL billing_consultation_item(e.doctor_id) item
 WHERE e.status = 'Finalized' AND item.id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM hms_bills b JOIN hms_bill_items bi ON bi.bill_id = b.id
                    WHERE b.encounter_id = e.id AND COALESCE(b.status, '') <> 'Cancelled' AND bi.item_type = 'Consultation');

SELECT billing_capture_charge(billing_account_for(o.encounter_id, NULL), 'lab_order_item', i.id::text, 'Lab',
       item.code, i.item_name, item.id, 'charge_master', 1, item.unit_price, item.gst_rate, COALESCE(i.created_at, now()), NULL)
  FROM hms_investigation_order_items i
  JOIN hms_investigation_orders o ON o.id = i.order_id
  CROSS JOIN LATERAL billing_lab_item(i.item_name) item
 WHERE o.encounter_id IS NOT NULL AND COALESCE(o.status, '') <> 'Cancelled' AND COALESCE(i.status, '') <> 'Cancelled'
   AND item.id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM hms_bills b JOIN hms_bill_items bi ON bi.bill_id = b.id
                    WHERE b.encounter_id = o.encounter_id AND COALESCE(b.status, '') <> 'Cancelled' AND bi.item_type = 'Lab');

-- Coded dispenses recorded before this migration.
SELECT billing_capture_charge(billing_account_for(mc.encounter_id, mc.admission_id), 'medicine_dispense_line',
       mc.dispense_line_id::text, 'Medicine', p.code, billing_product_label(p.name, p.strength, p.strength_unit), NULL, 'source', dl.quantity, dl.rate, 0, mc.created_at, mc.posted_by_user_id)
  FROM hms_med_charges mc
  JOIN hms_med_dispense_lines dl ON dl.id = mc.dispense_line_id
  JOIN hms_med_products p ON p.id = dl.product_id;

-- IPD medicine lines saved on the old billing page (migration 0008) become
-- charges; the old table takes no new rows.
SELECT billing_capture_charge(billing_account_for(NULL, d.admission_id), 'ipd_draft', d.id::text, 'Medicine', NULL,
       d.medicine_name || COALESCE(NULLIF(' ' || btrim(d.strength), ' '), ''), NULL, 'source', d.quantity, d.unit_price, 0,
       COALESCE(d.added_at, now()), d.added_by)
  FROM hms_ipd_draft_charges d
 WHERE NOT EXISTS (SELECT 1 FROM hms_bills b WHERE b.admission_id = d.admission_id AND b.bill_type = 'IPD' AND COALESCE(b.status, '') <> 'Cancelled');
CREATE FUNCTION billing_draft_charges_retired() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IPD draft charges are retired; charges are recorded as billing charge events' USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER trg_ipd_draft_charges_retired BEFORE INSERT OR UPDATE ON hms_ipd_draft_charges
  FOR EACH ROW EXECUTE FUNCTION billing_draft_charges_retired();

-- Bed days for admissions that are not billed yet.
SELECT billing_accrue_ward_days(a.id)
  FROM hms_admissions a
 WHERE a.admission_date IS NOT NULL AND a.status IN ('Active', 'Discharged')
   AND NOT EXISTS (SELECT 1 FROM hms_bills b WHERE b.admission_id = a.id AND b.bill_type = 'IPD' AND COALESCE(b.status, '') <> 'Cancelled');
