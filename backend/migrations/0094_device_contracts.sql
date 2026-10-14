-- Phase 6F: departmental devices (analyzers, PACS, blood bank, theatre,
-- bedside devices) connect only under an approved, versioned contract.
--
-- - A contract names the device, its protocol (HL7 v2 or ASTM), the interface
--   manual it follows (provenance) and how its test codes map to this
--   hospital's coded tests. Nothing is mapped by name.
-- - One person drafts it, another approves it; an approved contract never
--   changes: a new version replaces it. The device key is stored as a hash.
-- - Analyzer results go to the Phase 4 analyzer contract (provisional until
--   technical review). Other device kinds are received and kept for a person
--   to act on: a basic interface does not replace the safety functions of a
--   PACS, blood bank or theatre system (blueprint 3.11).

CREATE TABLE hms_device_contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system           TEXT NOT NULL CHECK (system ~ '^(analyzer|pacs|bloodbank|theatre|bedside):[a-z0-9._-]{2,60}$'),
  version          INTEGER NOT NULL CHECK (version > 0),
  kind             TEXT NOT NULL CHECK (kind IN ('analyzer', 'pacs', 'bloodbank', 'theatre', 'bedside')),
  protocol         TEXT NOT NULL CHECK (protocol IN ('hl7v2', 'astm')),
  description      TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  provenance       TEXT NOT NULL CHECK (length(btrim(provenance)) >= 5),
  code_map         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(code_map) = 'object'),
  service_user_id  INTEGER REFERENCES hms_users (id),
  owner_role       TEXT NOT NULL CHECK (owner_role IN ('super_admin', 'admin', 'doctor', 'nurse', 'lab_technician', 'pharmacist', 'receptionist')),
  mllp_port        INTEGER CHECK (mllp_port BETWEEN 1024 AND 65535),
  allowed_hosts    TEXT[] NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Active', 'Retired')),
  api_key_hash     TEXT,
  created_by       INTEGER NOT NULL REFERENCES hms_users (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by      INTEGER REFERENCES hms_users (id),
  approved_at      TIMESTAMPTZ,
  retired_by       INTEGER REFERENCES hms_users (id),
  retired_at       TIMESTAMPTZ,
  UNIQUE (system, version),
  CHECK (kind = split_part(system, ':', 1)),
  CHECK (kind <> 'analyzer' OR service_user_id IS NOT NULL),
  CHECK ((status = 'Draft') = (approved_at IS NULL)),
  CHECK ((approved_at IS NULL) = (approved_by IS NULL)),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (status = 'Draft' OR api_key_hash IS NOT NULL),
  CHECK ((status = 'Retired') = (retired_at IS NOT NULL)),
  CHECK ((retired_at IS NULL) = (retired_by IS NULL))
);
CREATE UNIQUE INDEX hms_device_contracts_one_active ON hms_device_contracts (system) WHERE status = 'Active';
CREATE UNIQUE INDEX hms_device_contracts_port ON hms_device_contracts (mllp_port) WHERE status = 'Active' AND mllp_port IS NOT NULL;

CREATE FUNCTION device_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Device contracts are retired, not deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status <> 'Draft' AND (NEW.system, NEW.version, NEW.kind, NEW.protocol, NEW.description, NEW.provenance, NEW.code_map, NEW.service_user_id, NEW.owner_role, NEW.mllp_port, NEW.allowed_hosts, NEW.api_key_hash, NEW.created_by, NEW.approved_by, NEW.approved_at)
     IS DISTINCT FROM (OLD.system, OLD.version, OLD.kind, OLD.protocol, OLD.description, OLD.provenance, OLD.code_map, OLD.service_user_id, OLD.owner_role, OLD.mllp_port, OLD.allowed_hosts, OLD.api_key_hash, OLD.created_by, OLD.approved_by, OLD.approved_at) THEN
    RAISE EXCEPTION 'An approved device contract cannot change; draft a new version' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'Draft' AND NEW.status = 'Active') OR (OLD.status = 'Active' AND NEW.status = 'Retired')) THEN
    RAISE EXCEPTION 'A device contract goes Draft -> Active -> Retired (not % -> %)', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_device_contract_guard BEFORE UPDATE OR DELETE ON hms_device_contracts FOR EACH ROW EXECUTE FUNCTION device_contract_guard();
CREATE TRIGGER trg_audit_hms_device_contracts AFTER INSERT OR UPDATE OR DELETE ON hms_device_contracts FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
