-- Completion A7: approval separation for prices and packages, and the stock
-- and money checks that were missing.
--
-- - A price list or package version is activated by someone other than the
--   person who drafted it or changed its prices (two-person rule). Versions
--   migrated before this rule (no author) are unaffected.
-- - Reconciliation can now report: a returned medicine whose credit is
--   overdue, a dispensed coded medicine with no charge, a medicine charge whose
--   dispense line does not exist, and stock whose balance differs from its
--   movement journal.

ALTER TABLE hms_charge_master_items ADD COLUMN edited_by INTEGER REFERENCES hms_users (id);
ALTER TABLE hms_package_versions ADD COLUMN edited_by INTEGER REFERENCES hms_users (id);

CREATE FUNCTION billing_activation_separated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Active' AND OLD.status = 'Draft' AND NEW.activated_by IS NOT NULL THEN
    IF NEW.activated_by = NEW.created_by THEN
      RAISE EXCEPTION 'Prices are activated by someone other than the person who drafted them' USING ERRCODE = 'check_violation';
    END IF;
    -- Nested IFs: PL/pgSQL does not short-circuit a field reference.
    IF TG_TABLE_NAME = 'hms_charge_master_versions' THEN
      IF EXISTS (SELECT 1 FROM hms_charge_master_items WHERE version_id = NEW.id AND edited_by = NEW.activated_by) THEN
        RAISE EXCEPTION 'Prices are activated by someone other than the person who changed them' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF to_jsonb(NEW) ->> 'edited_by' = NEW.activated_by::text THEN
        RAISE EXCEPTION 'A package is activated by someone other than the person who changed it' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cm_activation_separated BEFORE UPDATE OF status ON hms_charge_master_versions
  FOR EACH ROW EXECUTE FUNCTION billing_activation_separated();
CREATE TRIGGER trg_package_activation_separated BEFORE UPDATE OF status ON hms_package_versions
  FOR EACH ROW EXECUTE FUNCTION billing_activation_separated();

ALTER TABLE hms_recon_exceptions DROP CONSTRAINT hms_recon_exceptions_kind_check;
ALTER TABLE hms_recon_exceptions ADD CONSTRAINT hms_recon_exceptions_kind_check CHECK (kind IN (
  'unknown_payment', 'stale_pending_payment', 'cash_variance', 'unmatched_settlement',
  'unsettled_receipt', 'settlement_amount_mismatch', 'journal_imbalance', 'fund_overused',
  'invoice_overpaid', 'uninvoiced_charges', 'uncredited_reversal', 'receipt_unposted',
  'refund_unconfirmed', 'claim_unpaid',
  'return_uncredited', 'dispense_uncharged', 'charge_without_dispense', 'stock_mismatch'));
