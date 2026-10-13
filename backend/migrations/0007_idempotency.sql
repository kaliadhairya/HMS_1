-- 0007: idempotency keys for retried commands (blueprint 3.9).
--
-- A client sends an Idempotency-Key header with a payment, dispense,
-- admission, lab result and similar commands. The first request with a key
-- runs; a repeat with the same request gets the stored response, a repeat with
-- a different request is refused, and a repeat whose original outcome is
-- unknown is resolved from audit.row_changes (did the original request commit
-- anything?). This table is deliberately not audited: a claimed key must not
-- look like a committed change.
CREATE TABLE hms_idempotency_keys (
  user_id         INTEGER NOT NULL REFERENCES hms_users (id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  method          TEXT NOT NULL,
  path            TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('in_progress', 'completed', 'failed')),
  response_status INTEGER,
  response_body   JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX ix_idempotency_request ON hms_idempotency_keys (request_id);
