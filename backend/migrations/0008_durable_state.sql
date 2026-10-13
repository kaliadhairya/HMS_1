-- 0008: state that lived only in process memory, and durable notifications.
--
-- Security settings (maintenance mode, IP rules, session timeouts, 2FA
-- roles, announcements, API keys and the configuration lists on the Security
-- screen) and IPD draft charges were held in variables: a restart lost them
-- and a second server instance never saw them. Real-time notifications were
-- emitted after the transaction committed, so a crash in between lost them.

-- Settings, one JSON value per key; changes are audited like any other row.
CREATE TABLE hms_app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by INTEGER REFERENCES hms_users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Medicines added to an admission's bill before the bill is generated.
CREATE TABLE hms_ipd_draft_charges (
  id            BIGSERIAL PRIMARY KEY,
  admission_id  INTEGER NOT NULL REFERENCES hms_admissions (id),
  medicine_id   INTEGER NOT NULL REFERENCES hms_medicines (id),
  medicine_name TEXT NOT NULL,
  formulation   TEXT,
  strength      TEXT,
  quantity      INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price    NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  added_by      INTEGER REFERENCES hms_users (id),
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ipd_draft_charges_admission ON hms_ipd_draft_charges (admission_id);

CREATE TRIGGER trg_audit_hms_app_settings AFTER INSERT OR UPDATE OR DELETE ON hms_app_settings
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_ipd_draft_charges AFTER INSERT OR UPDATE OR DELETE ON hms_ipd_draft_charges
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- Settings rows are identified by key, not id.
CREATE OR REPLACE FUNCTION audit.capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  redacted CONSTANT TEXT[] := ARRAY['password', 'otp_code', 'otp_expires'];
  old_row JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  identity TEXT := COALESCE(new_row ->> 'id', old_row ->> 'id', new_row ->> 'key', old_row ->> 'key');
  changed_old JSONB;
  changed_new JSONB;
  k TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(key, old_row -> key), jsonb_object_agg(key, new_row -> key)
      INTO changed_old, changed_new
      FROM jsonb_object_keys(new_row) AS key
     WHERE (old_row -> key) IS DISTINCT FROM (new_row -> key);
    IF changed_new IS NULL THEN
      RETURN NULL; -- nothing changed
    END IF;
    old_row := changed_old;
    new_row := changed_new;
  END IF;
  FOREACH k IN ARRAY redacted LOOP
    IF old_row ? k THEN old_row := jsonb_set(old_row, ARRAY[k], '"[redacted]"'); END IF;
    IF new_row ? k THEN new_row := jsonb_set(new_row, ARRAY[k], '"[redacted]"'); END IF;
  END LOOP;
  INSERT INTO audit.row_changes (table_name, operation, row_id, old_values, new_values, actor_user_id, session_id, request_id)
  VALUES (
    TG_TABLE_NAME, TG_OP, identity, old_row, new_row,
    NULLIF(current_setting('hms.actor_user_id', true), '')::integer,
    NULLIF(current_setting('hms.session_id', true), ''),
    NULLIF(current_setting('hms.request_id', true), '')
  );
  RETURN NULL;
END $$;

-- Outbox: an event is inserted in the same transaction as the change it
-- announces. Every server instance reads committed events in transaction
-- order and emits them to its own connected clients, so a client receives an
-- event whichever instance it is connected to, and an event committed by an
-- instance that then died is still delivered. delivered_at records the first
-- delivery. Not audited: delivery bookkeeping is not a clinical event, and the
-- change itself already is.
CREATE TABLE hms_outbox (
  id           BIGSERIAL PRIMARY KEY,
  txid         XID8 NOT NULL DEFAULT pg_current_xact_id(),
  event_type   TEXT NOT NULL,
  audience     TEXT NOT NULL,  -- a Socket.IO room: a role, user:<id>, or 'all'
  payload      JSONB NOT NULL,
  request_id   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX ix_outbox_txid ON hms_outbox (txid, id);
CREATE INDEX ix_outbox_undelivered ON hms_outbox (txid) WHERE delivered_at IS NULL;
CREATE INDEX ix_outbox_audience ON hms_outbox (audience, id);

-- The outbox dispatcher and the audit sealer only pass a transaction once it
-- has finished, so a session left idle inside a transaction would hold both
-- up. End such sessions after a minute.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET idle_in_transaction_session_timeout = %L', current_database(), '60s');
END $$;

-- Inbox: consumers of external messages (analyzers, payment callbacks) record
-- each (source, message_id) once, so a redelivered message is not processed
-- twice.
CREATE TABLE hms_inbox (
  source      TEXT NOT NULL,
  message_id  TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, message_id)
);
