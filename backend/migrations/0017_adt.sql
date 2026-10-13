-- 0017: bed occupancy history, transfers, bed lifecycle and discharge planning
-- (blueprint 3.3: Admission, BedReservation, BedOccupancy, Transfer,
-- DischargePlan; 4.1: "Ready -> Reserved -> Occupied -> Dirty -> Cleaning -> Ready",
-- OutOfService as an explicit exclusion; "Transfers create occupancy history
-- rather than overwriting a bed ID").
--
-- Occupancy is a time range per bed; an exclusion constraint forbids two
-- occupancies of one bed at once. History starts with this migration: the
-- bed history of earlier discharged admissions is not reconstructed (no
-- reliable source), only current occupancies are backfilled.

-- Bed lifecycle. 'Available' is the blueprint's Ready state.
ALTER TABLE hms_beds DROP CONSTRAINT ck_beds_status;
ALTER TABLE hms_beds ADD CONSTRAINT ck_beds_status
  CHECK (status IN ('Available', 'Reserved', 'Occupied', 'Dirty', 'Cleaning', 'OutOfService'));

CREATE TABLE hms_bed_occupancies (
  id           BIGSERIAL PRIMARY KEY,
  bed_id       INTEGER NOT NULL REFERENCES hms_beds (id),
  admission_id INTEGER NOT NULL REFERENCES hms_admissions (id),
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ,
  period       TSTZRANGE GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  reason       TEXT,
  created_by   INTEGER REFERENCES hms_users (id),
  CONSTRAINT ck_occupancy_order CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT ex_bed_no_overlap EXCLUDE USING gist (bed_id WITH =, period WITH &&)
);
-- An admission occupies one bed at a time.
CREATE UNIQUE INDEX ux_occupancy_open_admission ON hms_bed_occupancies (admission_id) WHERE ends_at IS NULL;
CREATE INDEX ix_occupancy_bed ON hms_bed_occupancies (bed_id, starts_at);

-- Backfill current occupancy: each active admission in a bed starts occupying
-- it from its admission date.
INSERT INTO hms_bed_occupancies (bed_id, admission_id, starts_at, reason)
SELECT a.bed_id, a.id, COALESCE(a.admission_date, now()), 'admission (migrated)'
  FROM hms_admissions a
 WHERE a.status = 'Active' AND a.bed_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Discharge planning: clinical readiness and financial clearance are separate.
CREATE TABLE hms_discharge_plans (
  id                     BIGSERIAL PRIMARY KEY,
  admission_id           INTEGER NOT NULL UNIQUE REFERENCES hms_admissions (id),
  destination            TEXT,
  instructions           TEXT,
  pending_results        TEXT,
  results_owner_user_id  INTEGER REFERENCES hms_users (id),
  follow_up_owner_user_id INTEGER REFERENCES hms_users (id),
  clinical_ready_at      TIMESTAMPTZ,
  clinical_ready_by      INTEGER REFERENCES hms_users (id),
  financial_clearance    TEXT NOT NULL DEFAULT 'pending' CHECK (financial_clearance IN ('pending', 'cleared')),
  cleared_at             TIMESTAMPTZ,
  cleared_by             INTEGER REFERENCES hms_users (id),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_clearance CHECK ((financial_clearance = 'cleared') = (cleared_at IS NOT NULL AND cleared_by IS NOT NULL)),
  CONSTRAINT ck_plan_ready CHECK (clinical_ready_at IS NULL OR clinical_ready_by IS NOT NULL),
  -- Results still pending after discharge always have a named owner.
  CONSTRAINT ck_plan_results_owner CHECK (coalesce(btrim(pending_results), '') = '' OR results_owner_user_id IS NOT NULL)
);

CREATE TRIGGER trg_audit_hms_bed_occupancies AFTER INSERT OR UPDATE OR DELETE ON hms_bed_occupancies
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_discharge_plans AFTER INSERT OR UPDATE OR DELETE ON hms_discharge_plans
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
