-- Phase 6: an accountable worklist for anything the system could not finish
-- on its own (an audit checkpoint not shipped, a gap in the remote record, an
-- interface message that failed), and the shipping queue for audit
-- checkpoints to write-once storage (6H).
--
-- - A worklist item has a kind, an owner (a role, optionally a named person)
--   and stays open until someone resolves it with a note. The same problem
--   is not opened twice while it is open (dedupe_key).
-- - Each signed checkpoint file is queued here and shipped to object-locked
--   storage; it counts as shipped only when the store confirms the object
--   and its lock. The remote copy, not this table, is the evidence: a
--   database administrator can change this table but not the locked objects.
--   Like the outbox, this queue is delivery bookkeeping and has no row audit
--   (it changes every few seconds); the remote check compares it with the
--   store and reports any disagreement.

CREATE TABLE hms_worklist_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 TEXT NOT NULL CHECK (kind ~ '^[a-z][a-z0-9_.-]{2,60}$'),
  dedupe_key           TEXT NOT NULL CHECK (length(btrim(dedupe_key)) > 0),
  title                TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  detail               JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  owner_role           TEXT NOT NULL CHECK (owner_role IN ('super_admin', 'admin', 'doctor', 'nurse', 'lab_technician', 'pharmacist', 'receptionist')),
  assigned_user_id     INTEGER REFERENCES hms_users (id),
  patient_id           INTEGER REFERENCES hms_patients (id),
  status               TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved')),
  occurrences          INTEGER NOT NULL DEFAULT 1 CHECK (occurrences > 0),
  opened_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_by_user_id  INTEGER REFERENCES hms_users (id),
  resolved_at          TIMESTAMPTZ,
  resolution           TEXT,
  CHECK ((status = 'Resolved') = (resolved_at IS NOT NULL)),
  CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL)),
  CHECK (resolved_at IS NULL OR length(btrim(resolution)) >= 5)
);
CREATE UNIQUE INDEX hms_worklist_items_one_open ON hms_worklist_items (kind, dedupe_key) WHERE status = 'Open';
CREATE INDEX hms_worklist_items_queue ON hms_worklist_items (status, owner_role, opened_at);

-- A resolved item stays resolved; what it was about never changes.
CREATE FUNCTION worklist_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Worklist items are resolved, not deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.kind, NEW.dedupe_key, NEW.title, NEW.opened_at) IS DISTINCT FROM (OLD.id, OLD.kind, OLD.dedupe_key, OLD.title, OLD.opened_at) THEN
    RAISE EXCEPTION 'A worklist item cannot be rewritten' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status = 'Resolved' THEN
    RAISE EXCEPTION 'A resolved worklist item is closed; open a new one' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_worklist_guard BEFORE UPDATE OR DELETE ON hms_worklist_items
  FOR EACH ROW EXECUTE FUNCTION worklist_guard();

CREATE TABLE hms_audit_checkpoint_shipments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name        TEXT NOT NULL UNIQUE CHECK (file_name ~ '^audit-checkpoint-[A-Za-z0-9-]+\.json$'),
  checkpoint_at    TIMESTAMPTZ NOT NULL,
  sha256           TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  queued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       TEXT,
  shipped_at       TIMESTAMPTZ,
  remote_key       TEXT,
  remote_version   TEXT,
  lock_mode        TEXT CHECK (lock_mode IN ('COMPLIANCE', 'GOVERNANCE')),
  retain_until     TIMESTAMPTZ,
  CHECK ((shipped_at IS NULL) = (remote_key IS NULL)),
  CHECK (shipped_at IS NULL OR (lock_mode IS NOT NULL AND retain_until IS NOT NULL))
);
CREATE INDEX hms_audit_checkpoint_shipments_pending ON hms_audit_checkpoint_shipments (queued_at) WHERE shipped_at IS NULL;

CREATE TRIGGER trg_audit_hms_worklist_items AFTER INSERT OR UPDATE OR DELETE ON hms_worklist_items FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
