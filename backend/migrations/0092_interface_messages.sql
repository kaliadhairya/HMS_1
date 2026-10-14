-- Phase 6: one durable log for messages exchanged with outside systems (the
-- ABDM gateway now, departmental devices in 6F).
--
-- - Outgoing: written in the same transaction as the change that causes it,
--   then delivered by a worker with retries and growing waits. After the last
--   attempt it is Failed and goes on the accountable worklist; it is never
--   silently dropped.
-- - Incoming: kept exactly as received (raw), accepted once per sender and
--   message ID, then processed. A message that cannot be matched to a patient,
--   specimen or order is Unmatched and waits for a person; nothing is guessed.
-- - Contract versions are recorded on every message.
-- - Like hms_inbox/hms_outbox this log is its own record (rows are never
--   rewritten or deleted) and is not copied into audit.row_changes: messages
--   carry whole health records, which the audit log must not duplicate
--   (blueprint 3.12). Who acted on a message is audited where they act.

CREATE TABLE hms_interface_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction        TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  system           TEXT NOT NULL CHECK (system ~ '^[a-z][a-z0-9:._-]{1,80}$'),
  message_type     TEXT NOT NULL CHECK (length(btrim(message_type)) > 0),
  contract_version TEXT NOT NULL CHECK (length(btrim(contract_version)) > 0),
  external_id      TEXT NOT NULL CHECK (length(btrim(external_id)) > 0),
  correlation_id   TEXT,
  endpoint         TEXT,
  payload          JSONB,
  raw              TEXT,
  status           TEXT NOT NULL CHECK (status IN ('Pending', 'Delivered', 'Failed', 'Received', 'Processed', 'Rejected', 'Unmatched')),
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts     INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error       TEXT,
  response         JSONB,
  patient_id       INTEGER REFERENCES hms_patients (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  UNIQUE (system, direction, external_id),
  CHECK ((direction = 'out') = (status IN ('Pending', 'Delivered', 'Failed'))),
  CHECK (direction = 'out' OR raw IS NOT NULL),
  CHECK ((status IN ('Pending', 'Received', 'Unmatched')) = (finished_at IS NULL))
);
CREATE INDEX hms_interface_messages_due ON hms_interface_messages (next_attempt_at) WHERE status = 'Pending';
CREATE INDEX hms_interface_messages_correlation ON hms_interface_messages (system, correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX hms_interface_messages_open ON hms_interface_messages (system, status) WHERE status IN ('Failed', 'Unmatched', 'Rejected');

-- What was received is never changed; only processing state moves on, and a
-- finished message stays finished.
CREATE FUNCTION interface_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Interface messages are kept for the record' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.id, NEW.direction, NEW.system, NEW.message_type, NEW.contract_version, NEW.external_id, NEW.raw, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.direction, OLD.system, OLD.message_type, OLD.contract_version, OLD.external_id, OLD.raw, OLD.created_at)
     OR (OLD.direction = 'out' AND NEW.payload IS DISTINCT FROM OLD.payload) THEN
    RAISE EXCEPTION 'An interface message cannot be rewritten' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.finished_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A finished interface message is closed' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_interface_message_guard BEFORE UPDATE OR DELETE ON hms_interface_messages
  FOR EACH ROW EXECUTE FUNCTION interface_message_guard();
