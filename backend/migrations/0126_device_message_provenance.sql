-- Historical messages retain unknown provenance rather than guessing the
-- account/contract that accepted them. New device intake records both inside
-- the same transaction as custody, reconciliation and any provisional result.
ALTER TABLE hms_interface_messages ADD COLUMN accepted_by_user_id integer REFERENCES hms_users(id);
ALTER TABLE hms_interface_messages ADD COLUMN device_contract_id uuid REFERENCES hms_device_contracts(id);
CREATE INDEX ix_interface_accepting_user ON hms_interface_messages(accepted_by_user_id);
CREATE INDEX ix_interface_device_contract ON hms_interface_messages(device_contract_id,facility_id);
CREATE UNIQUE INDEX ux_device_contract_facility ON hms_device_contracts(id,facility_id);
ALTER TABLE hms_interface_messages ADD CONSTRAINT fk_interface_contract_facility
 FOREIGN KEY(device_contract_id,facility_id) REFERENCES hms_device_contracts(id,facility_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION hms_guard_interface_provenance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW.accepted_by_user_id,NEW.device_contract_id) IS DISTINCT FROM (OLD.accepted_by_user_id,OLD.device_contract_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Interface intake provenance is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_interface_provenance BEFORE UPDATE ON hms_interface_messages
 FOR EACH ROW EXECUTE FUNCTION hms_guard_interface_provenance();
