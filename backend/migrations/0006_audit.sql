-- 0006: transactional, tamper-evident audit (blueprint F12).
--
-- 1. audit.row_changes is written by triggers on every clinical, financial,
--    inventory and security table, inside the transaction that makes the
--    change: if the change commits, its audit entry commits with it, and no
--    code path can skip it. The acting user, session and request come from
--    connection settings the application sets (hms.actor_user_id etc.).
-- 2. audit.access_events records chart reads and refused requests; the
--    application writes it.
-- 3. Audit tables are append-only. A sealer (audit.seal) links committed
--    entries into a SHA-256 hash chain per table; audit.verify recomputes it.
--    Checkpoints of each chain head are signed and exported outside the
--    database by the application, so even a rewrite by a database superuser
--    is detectable.

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE audit.row_changes (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  txid          XID8 NOT NULL DEFAULT pg_current_xact_id(),
  table_name    TEXT NOT NULL,
  operation     TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  row_id        TEXT,
  old_values    JSONB,
  new_values    JSONB,
  actor_user_id INTEGER,
  session_id    TEXT,
  request_id    TEXT,
  chain_seq     BIGINT UNIQUE,
  prev_hash     BYTEA,
  row_hash      BYTEA
);
CREATE INDEX ix_row_changes_table_row ON audit.row_changes (table_name, row_id);
CREATE INDEX ix_row_changes_unsealed ON audit.row_changes (id) WHERE row_hash IS NULL;

CREATE TABLE audit.access_events (
  id            BIGSERIAL PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  txid          XID8 NOT NULL DEFAULT pg_current_xact_id(),
  user_id       INTEGER,
  session_id    TEXT,
  request_id    TEXT,
  method        TEXT NOT NULL,
  path          TEXT NOT NULL,
  status        INTEGER NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('read', 'denied', 'unauthenticated')),
  patient_id    INTEGER,
  ip            TEXT,
  detail        TEXT,
  chain_seq     BIGINT UNIQUE,
  prev_hash     BYTEA,
  row_hash      BYTEA
);
CREATE INDEX ix_access_events_patient ON audit.access_events (patient_id, occurred_at) WHERE patient_id IS NOT NULL;
CREATE INDEX ix_access_events_user ON audit.access_events (user_id, occurred_at);
CREATE INDEX ix_access_events_unsealed ON audit.access_events (id) WHERE row_hash IS NULL;

-- The human-readable activity log joins the chain too.
ALTER TABLE hms_audit_logs
  ADD COLUMN txid XID8 NOT NULL DEFAULT pg_current_xact_id(),
  ADD COLUMN chain_seq BIGINT UNIQUE,
  ADD COLUMN prev_hash BYTEA,
  ADD COLUMN row_hash BYTEA;
CREATE INDEX ix_hms_audit_logs_unsealed ON hms_audit_logs (id) WHERE row_hash IS NULL;

CREATE TABLE audit.chain_heads (
  chain     TEXT PRIMARY KEY,
  seq       BIGINT NOT NULL DEFAULT 0,
  head_hash BYTEA NOT NULL DEFAULT '\x'::bytea
);
INSERT INTO audit.chain_heads (chain) VALUES ('audit.row_changes'), ('audit.access_events'), ('public.hms_audit_logs');

-- Entries are never changed or removed. The only update allowed is the
-- sealer filling the chain columns of an entry that has not been sealed.
CREATE FUNCTION audit.forbid_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.row_hash IS NULL
     AND (to_jsonb(NEW) - 'chain_seq' - 'prev_hash' - 'row_hash') = (to_jsonb(OLD) - 'chain_seq' - 'prev_hash' - 'row_hash') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit records are append-only (% on %)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE FUNCTION audit.forbid_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only (TRUNCATE on %)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER trg_row_changes_append_only BEFORE UPDATE OR DELETE ON audit.row_changes FOR EACH ROW EXECUTE FUNCTION audit.forbid_rewrite();
CREATE TRIGGER trg_access_events_append_only BEFORE UPDATE OR DELETE ON audit.access_events FOR EACH ROW EXECUTE FUNCTION audit.forbid_rewrite();
CREATE TRIGGER trg_hms_audit_logs_append_only BEFORE UPDATE OR DELETE ON hms_audit_logs FOR EACH ROW EXECUTE FUNCTION audit.forbid_rewrite();
CREATE TRIGGER trg_row_changes_no_truncate BEFORE TRUNCATE ON audit.row_changes FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_truncate();
CREATE TRIGGER trg_access_events_no_truncate BEFORE TRUNCATE ON audit.access_events FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_truncate();
CREATE TRIGGER trg_hms_audit_logs_no_truncate BEFORE TRUNCATE ON hms_audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit.forbid_truncate();

-- Change capture. INSERT keeps the new row, DELETE the old row, UPDATE only
-- the columns that changed. Credentials are never copied.
CREATE FUNCTION audit.capture_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  redacted CONSTANT TEXT[] := ARRAY['password', 'otp_code', 'otp_expires'];
  old_row JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
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
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(to_jsonb(NEW) ->> 'id', to_jsonb(OLD) ->> 'id'),
    old_row,
    new_row,
    NULLIF(current_setting('hms.actor_user_id', true), '')::integer,
    NULLIF(current_setting('hms.session_id', true), ''),
    NULLIF(current_setting('hms.request_id', true), '')
  );
  RETURN NULL;
END $$;

-- Every application table except the activity log (chained itself) and
-- sessions (last-seen updates every minute are not clinical events).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'hms\_%'
       AND c.relname NOT IN ('hms_audit_logs', 'hms_sessions')
     ORDER BY c.relname
  LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()', t);
  END LOOP;
END $$;

-- The bytes a chain entry's hash covers: the entry (without its own hash
-- columns) plus its chain position, rendered in UTC so the result does not
-- depend on the session time zone.
CREATE FUNCTION audit.entry_bytes(entry JSONB, seq BIGINT) RETURNS BYTEA
LANGUAGE sql IMMUTABLE SET timezone = 'UTC' AS $$
  SELECT convert_to(((entry - 'chain_seq' - 'prev_hash' - 'row_hash') || jsonb_build_object('chain_seq', seq))::text, 'UTF8')
$$;

-- Seals committed, unsealed entries of one table in id order. Entries of a
-- transaction that is still open are left for a later run, so the chain only
-- ever covers rows that can no longer roll back. Returns the number sealed.
CREATE FUNCTION audit.seal(target REGCLASS, max_rows INTEGER DEFAULT 5000) RETURNS INTEGER
LANGUAGE plpgsql SET timezone = 'UTC' AS $$
DECLARE
  chain_name TEXT := target::text;
  horizon XID8 := pg_snapshot_xmin(pg_current_snapshot());
  head audit.chain_heads;
  r RECORD;
  next_seq BIGINT;
  next_hash BYTEA;
  sealed INTEGER := 0;
BEGIN
  IF chain_name NOT LIKE '%.%' THEN chain_name := 'public.' || chain_name; END IF;
  SELECT * INTO head FROM audit.chain_heads WHERE chain = chain_name FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No audit chain named %', chain_name; END IF;
  next_seq := head.seq;
  next_hash := head.head_hash;
  -- id is cast to BIGINT: chains differ in id type, and PL/pgSQL caches the
  -- UPDATE's parameter types across calls on the same connection.
  FOR r IN EXECUTE format('SELECT id::bigint AS id, to_jsonb(t) AS entry FROM %s t WHERE row_hash IS NULL AND txid < $1 ORDER BY id LIMIT $2', target)
    USING horizon, max_rows
  LOOP
    next_seq := next_seq + 1;
    EXECUTE format('UPDATE %s SET chain_seq = $1, prev_hash = $2, row_hash = $3 WHERE id = $4', target)
      USING next_seq, next_hash, sha256(next_hash || audit.entry_bytes(r.entry, next_seq)), r.id;
    next_hash := sha256(next_hash || audit.entry_bytes(r.entry, next_seq));
    sealed := sealed + 1;
  END LOOP;
  UPDATE audit.chain_heads SET seq = next_seq, head_hash = next_hash WHERE chain = chain_name;
  RETURN sealed;
END $$;

-- Recomputes a chain from its first entry. Returns one row per problem:
-- a missing position, a broken link or an entry whose content changed.
CREATE FUNCTION audit.verify(target REGCLASS)
RETURNS TABLE (chain_seq BIGINT, problem TEXT)
LANGUAGE plpgsql SET timezone = 'UTC' AS $$
DECLARE
  expected_seq BIGINT := 0;
  expected_prev BYTEA := '\x'::bytea;
  r RECORD;
BEGIN
  FOR r IN EXECUTE format('SELECT t.chain_seq AS seq, t.prev_hash, t.row_hash, to_jsonb(t) AS entry FROM %s t WHERE t.chain_seq IS NOT NULL ORDER BY t.chain_seq', target)
  LOOP
    expected_seq := expected_seq + 1;
    IF r.seq <> expected_seq THEN
      chain_seq := expected_seq; problem := format('entries %s to %s are missing', expected_seq, r.seq - 1); RETURN NEXT;
      expected_seq := r.seq;
    END IF;
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN
      chain_seq := r.seq; problem := 'link to the previous entry is broken'; RETURN NEXT;
    END IF;
    IF r.row_hash IS DISTINCT FROM sha256(r.prev_hash || audit.entry_bytes(r.entry, r.seq)) THEN
      chain_seq := r.seq; problem := 'entry content does not match its hash'; RETURN NEXT;
    END IF;
    expected_prev := r.row_hash;
  END LOOP;
END $$;
