-- 0015: emergency arrivals and triage (blueprint 3.3: TriageAssessment; 3.1 and
-- 2.2: "Add a versioned triage protocol and board ... treat Manchester as a
-- separate protocol"; 3.13: missing approval keeps the feature disabled).
--
-- The protocols table ships with ESI and Manchester listed as pending clinical
-- approval and NO triage content. Assessments are refused until a clinician
-- approves a protocol version. Assessments are append-only: a change in acuity
-- is a new assessment, never an edit.

CREATE TABLE hms_triage_protocols (
  protocol_key TEXT NOT NULL CHECK (length(btrim(protocol_key)) > 0),
  version      INTEGER NOT NULL CHECK (version > 0),
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'retired')),
  approved_by  INTEGER REFERENCES hms_users (id),
  approved_at  TIMESTAMPTZ,
  PRIMARY KEY (protocol_key, version),
  CONSTRAINT ck_protocol_approval CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

INSERT INTO hms_triage_protocols (protocol_key, version, title, status) VALUES
  ('esi', 5, 'ESI fifth edition (pending clinical approval)', 'pending_approval'),
  ('manchester', 1, 'Manchester triage (pending clinical approval)', 'pending_approval');

CREATE TABLE hms_emergency_arrivals (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      INTEGER NOT NULL REFERENCES hms_patients (id),
  arrived_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  arrival_mode    TEXT NOT NULL CHECK (arrival_mode IN ('walk_in', 'ambulance', 'referral', 'other')),
  chief_complaint TEXT CHECK (chief_complaint IS NULL OR length(chief_complaint) <= 500),
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_treatment', 'admitted', 'discharged', 'transferred', 'left')),
  created_by      INTEGER REFERENCES hms_users (id),
  closed_at       TIMESTAMPTZ,
  closed_by       INTEGER REFERENCES hms_users (id),
  disposition_reason TEXT,
  CONSTRAINT ck_arrival_closed CHECK ((status IN ('waiting', 'in_treatment')) = (closed_at IS NULL)),
  CONSTRAINT ck_arrival_disposition CHECK (closed_at IS NULL OR (closed_by IS NOT NULL AND disposition_reason IS NOT NULL))
);
-- One open arrival per patient.
CREATE UNIQUE INDEX ux_arrival_open_patient ON hms_emergency_arrivals (patient_id) WHERE status IN ('waiting', 'in_treatment');
CREATE INDEX ix_arrival_open_board ON hms_emergency_arrivals (arrived_at) WHERE status IN ('waiting', 'in_treatment');

CREATE TABLE hms_triage_assessments (
  id                BIGSERIAL PRIMARY KEY,
  arrival_id        BIGINT NOT NULL REFERENCES hms_emergency_arrivals (id),
  protocol_key      TEXT NOT NULL,
  protocol_version  INTEGER NOT NULL,
  acuity_level      SMALLINT NOT NULL CHECK (acuity_level BETWEEN 1 AND 5),
  inputs            JSONB NOT NULL DEFAULT '{}'::jsonb,
  assessed_by       INTEGER NOT NULL REFERENCES hms_users (id),
  assessed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reassess_due_at   TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (protocol_key, protocol_version) REFERENCES hms_triage_protocols (protocol_key, version),
  CONSTRAINT ck_assessment_reassess CHECK (reassess_due_at > assessed_at)
);
CREATE INDEX ix_triage_arrival ON hms_triage_assessments (arrival_id, assessed_at DESC);

CREATE TABLE hms_triage_escalations (
  id                BIGSERIAL PRIMARY KEY,
  arrival_id        BIGINT NOT NULL REFERENCES hms_emergency_arrivals (id),
  reason            TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  to_role           TEXT NOT NULL CHECK (to_role IN ('doctor', 'nurse', 'admin')),
  raised_by         INTEGER NOT NULL REFERENCES hms_users (id),
  raised_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by   INTEGER REFERENCES hms_users (id),
  acknowledged_at   TIMESTAMPTZ,
  CONSTRAINT ck_escalation_ack CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL))
);
CREATE INDEX ix_escalations_open ON hms_triage_escalations (arrival_id) WHERE acknowledged_at IS NULL;

-- Assessments are append-only: a change is a new assessment.
CREATE FUNCTION triage_assessments_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Triage assessments are append-only; record a new assessment instead' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_triage_assessments_append_only BEFORE UPDATE OR DELETE ON hms_triage_assessments
  FOR EACH ROW EXECUTE FUNCTION triage_assessments_append_only();

CREATE TRIGGER trg_audit_hms_triage_protocols AFTER INSERT OR UPDATE OR DELETE ON hms_triage_protocols
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_emergency_arrivals AFTER INSERT OR UPDATE OR DELETE ON hms_emergency_arrivals
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_triage_assessments AFTER INSERT OR UPDATE OR DELETE ON hms_triage_assessments
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_triage_escalations AFTER INSERT OR UPDATE OR DELETE ON hms_triage_escalations
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
