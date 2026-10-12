-- 0004: uniqueness and value rules the application already assumes, now
-- enforced by the database so a race or a bypassing code path cannot break
-- them (blueprint F03, F17).

-- One active admission per patient, and one active admission per bed.
CREATE UNIQUE INDEX ux_admissions_active_patient ON hms_admissions (patient_id) WHERE status = 'Active';
CREATE UNIQUE INDEX ux_admissions_active_bed ON hms_admissions (bed_id) WHERE status = 'Active';
ALTER TABLE hms_admissions ADD CONSTRAINT ck_admissions_status CHECK (status IN ('Active', 'Discharged'));
ALTER TABLE hms_beds ADD CONSTRAINT ck_beds_status CHECK (status IN ('Available', 'Occupied'));

-- Identity of operational records.
CREATE UNIQUE INDEX ux_beds_ward_bed_number ON hms_beds (ward_id, bed_number);
CREATE UNIQUE INDEX ux_tokens_doctor_day_number ON hms_tokens (doctor_id, token_date, token_number);
CREATE UNIQUE INDEX ux_permissions_role_module ON hms_permissions (role, module);
CREATE UNIQUE INDEX ux_doctors_user ON hms_doctors (user_id);
CREATE UNIQUE INDEX ux_departments_short_code ON hms_departments (short_code) WHERE short_code IS NOT NULL;
CREATE UNIQUE INDEX ux_otc_sales_bill_number ON hms_otc_sales (bill_number) WHERE bill_number IS NOT NULL;
-- One row per manufacturer lot of a medicine: concurrent first receipts of
-- the same lot can no longer create two batches.
CREATE UNIQUE INDEX ux_medicine_batches_lot ON hms_medicine_batches (medicine_id, batch_number);

-- Stock and money.
ALTER TABLE hms_medicine_batches
  ADD CONSTRAINT ck_batches_quantity_nonnegative CHECK (quantity >= 0),
  ADD CONSTRAINT ck_batches_prices_nonnegative CHECK (coalesce(mrp, 0) >= 0 AND coalesce(purchase_rate, 0) >= 0);
ALTER TABLE hms_stock_ledger ADD CONSTRAINT ck_stock_ledger_quantity_nonzero CHECK (quantity <> 0);
ALTER TABLE hms_dispensing_items ADD CONSTRAINT ck_dispensing_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE hms_otc_items ADD CONSTRAINT ck_otc_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE hms_purchase_items ADD CONSTRAINT ck_purchase_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE hms_bill_items
  ADD CONSTRAINT ck_bill_items_quantity_positive CHECK (coalesce(quantity, 1) > 0),
  ADD CONSTRAINT ck_bill_items_amount_nonnegative CHECK (coalesce(amount, 0) >= 0);
ALTER TABLE hms_bills
  ADD CONSTRAINT ck_bills_amounts_nonnegative CHECK (coalesce(total_amount, 0) >= 0 AND coalesce(discount_amount, 0) >= 0);
ALTER TABLE hms_payments ADD CONSTRAINT ck_payments_amount_positive CHECK (amount > 0);
ALTER TABLE hms_patient_advances ADD CONSTRAINT ck_advances_amount_positive CHECK (amount > 0);
