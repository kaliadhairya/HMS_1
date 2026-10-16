-- Completion B7: one writer at a time after a recovery.
--
-- Every HMS database carries a writer fence: its cluster identity, a writer
-- epoch and whether it is the primary or fenced. Promotion of a recovered
-- or standby database raises the epoch there and fences the old primary
-- (read-only, connections ended), or records the external isolation that
-- stands in for that when the old primary cannot be reached. HMS refuses to
-- start, and reports not ready, on a fenced database. Each promotion is an
-- append-only recovery event with what it revoked, held and measured.

CREATE TABLE hms_writer_fence (
  singleton   BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  cluster_id  UUID NOT NULL DEFAULT gen_random_uuid(),
  epoch       INTEGER NOT NULL DEFAULT 1 CHECK (epoch > 0),
  role        TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'fenced')),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason      TEXT NOT NULL DEFAULT 'Initial primary' CHECK (length(btrim(reason)) >= 5)
);
INSERT INTO hms_writer_fence DEFAULT VALUES;

CREATE FUNCTION writer_fence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The writer fence is never removed' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF NEW.epoch < OLD.epoch THEN RAISE EXCEPTION 'The writer epoch never goes back' USING ERRCODE = 'check_violation'; END IF;
  -- A fenced database becomes primary again only through a new promotion (a higher epoch).
  IF OLD.role = 'fenced' AND NEW.role = 'primary' AND NEW.epoch <= OLD.epoch THEN
    RAISE EXCEPTION 'A fenced database returns only by promotion to a higher epoch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_writer_fence_guard BEFORE UPDATE OR DELETE ON hms_writer_fence FOR EACH ROW EXECUTE FUNCTION writer_fence_guard();

CREATE TABLE hms_recovery_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epoch                INTEGER NOT NULL CHECK (epoch > 0),
  previous_cluster_id  UUID,
  reason               TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  old_primary          TEXT NOT NULL CHECK (old_primary IN ('fenced', 'isolated')),
  isolation_reference  TEXT CHECK (isolation_reference IS NULL OR length(btrim(isolation_reference)) >= 5),
  last_recorded_change TIMESTAMPTZ,
  started_at           TIMESTAMPTZ NOT NULL,
  completed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sessions_revoked     INTEGER NOT NULL CHECK (sessions_revoked >= 0),
  messages_held        INTEGER NOT NULL CHECK (messages_held >= 0),
  payments_unknown     INTEGER NOT NULL CHECK (payments_unknown >= 0),
  evidence             JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  CHECK ((old_primary = 'isolated') = (isolation_reference IS NOT NULL))
);

CREATE FUNCTION recovery_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Recovery events are evidence and are never changed or deleted' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_recovery_events_append_only BEFORE UPDATE OR DELETE ON hms_recovery_events
  FOR EACH ROW EXECUTE FUNCTION recovery_events_append_only();

-- Every table is audited (Codex's schema check): the fence and recovery
-- events here, and the ward-machine tables from 0152.
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['hms_writer_fence', 'hms_recovery_events', 'hms_downtime_stations', 'hms_downtime_station_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()', tab, tab);
  END LOOP;
END $$;
