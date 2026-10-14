-- Phase 6I: the local downtime kit and reconciliation afterwards
-- (blueprint 3.13, SAFER contingency planning).
--
-- - Emergency summaries of admitted patients are written on a schedule as an
--   encrypted, printable bundle for wards to keep locally. Each bundle shows
--   when it was made and is marked stale when old. It is read-only: it is not
--   a second database to write in.
-- - A downtime episode is declared and ended by name. Everything done on
--   paper meanwhile (orders, doses given, specimens, receipts, temporary
--   identities) is logged with its actual time, entered into the system
--   afterwards, and checked by a second person. An episode cannot be closed
--   while anything from it is unreconciled.

CREATE TABLE hms_downtime_snapshots (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stale_after   TIMESTAMPTZ NOT NULL,
  patient_count INTEGER NOT NULL CHECK (patient_count >= 0),
  file_name     TEXT NOT NULL UNIQUE,
  sha256        TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  key_id        TEXT NOT NULL,
  requested_by  INTEGER REFERENCES hms_users (id),
  CHECK (stale_after > generated_at)
);

CREATE TABLE hms_downtime_episodes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at   TIMESTAMPTZ NOT NULL,
  declared_by  INTEGER NOT NULL REFERENCES hms_users (id),
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  ended_at     TIMESTAMPTZ,
  ended_by     INTEGER REFERENCES hms_users (id),
  closed_at    TIMESTAMPTZ,
  closed_by    INTEGER REFERENCES hms_users (id),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL)),
  CHECK ((closed_at IS NULL) = (closed_by IS NULL)),
  CHECK (closed_at IS NULL OR ended_at IS NOT NULL),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX hms_downtime_one_open ON hms_downtime_episodes ((true)) WHERE ended_at IS NULL;

CREATE TABLE hms_downtime_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id       UUID NOT NULL REFERENCES hms_downtime_episodes (id),
  kind             TEXT NOT NULL CHECK (kind IN ('order', 'administration', 'specimen', 'receipt', 'temporary_identity', 'other')),
  patient_id       INTEGER REFERENCES hms_patients (id),
  paper_reference  TEXT NOT NULL CHECK (length(btrim(paper_reference)) > 0),
  occurred_at      TIMESTAMPTZ NOT NULL,
  summary          TEXT NOT NULL CHECK (length(btrim(summary)) > 0),
  logged_by        INTEGER NOT NULL REFERENCES hms_users (id),
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'Logged' CHECK (status IN ('Logged', 'Entered', 'Reconciled', 'Void')),
  entered_as       TEXT,
  entered_by       INTEGER REFERENCES hms_users (id),
  entered_at       TIMESTAMPTZ,
  reconciled_by    INTEGER REFERENCES hms_users (id),
  reconciled_at    TIMESTAMPTZ,
  note             TEXT,
  UNIQUE (episode_id, kind, paper_reference),
  CHECK ((entered_at IS NULL) = (entered_by IS NULL)),
  CHECK (status NOT IN ('Entered', 'Reconciled') OR (entered_as IS NOT NULL AND entered_at IS NOT NULL)),
  CHECK ((status = 'Reconciled') = (reconciled_at IS NOT NULL)),
  CHECK ((reconciled_at IS NULL) = (reconciled_by IS NULL)),
  CHECK (reconciled_by IS NULL OR (reconciled_by <> logged_by AND reconciled_by <> entered_by)),
  CHECK (status <> 'Void' OR length(btrim(note)) >= 5)
);

-- Nothing about a paper record changes after it is logged except its
-- progress; finished entries stay finished.
CREATE FUNCTION downtime_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Downtime entries are voided with a reason, not deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW.episode_id, NEW.kind, NEW.patient_id, NEW.paper_reference, NEW.occurred_at, NEW.summary, NEW.logged_by, NEW.logged_at)
     IS DISTINCT FROM (OLD.episode_id, OLD.kind, OLD.patient_id, OLD.paper_reference, OLD.occurred_at, OLD.summary, OLD.logged_by, OLD.logged_at) THEN
    RAISE EXCEPTION 'A logged paper record cannot be rewritten; void it and log it again' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.status IN ('Reconciled', 'Void') THEN
    RAISE EXCEPTION 'A % downtime entry is closed', lower(OLD.status) USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_downtime_entry_guard BEFORE UPDATE OR DELETE ON hms_downtime_entries FOR EACH ROW EXECUTE FUNCTION downtime_entry_guard();

CREATE TRIGGER trg_audit_hms_downtime_snapshots AFTER INSERT OR UPDATE OR DELETE ON hms_downtime_snapshots FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_downtime_episodes AFTER INSERT OR UPDATE OR DELETE ON hms_downtime_episodes FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_downtime_entries AFTER INSERT OR UPDATE OR DELETE ON hms_downtime_entries FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
