-- 0014: care teams and patient scope (blueprint 3.3: CareTeamAssignment;
-- section 1.4 F02: "enforce action, facility, patient, care-team and purpose
-- authorization").
--
-- A doctor may read a patient's record when the patient is in their care:
--   - a current care-team assignment (the consulting or primary clinician), or
--   - an active admission they are the admitting doctor of, or
--   - a break-glass access granted for the last hour, with a reason, reviewed later.
-- Everything else is refused for doctors. Desk staff and administrators are
-- not limited by care teams (they register and bill patients).

CREATE TABLE hms_care_team_assignments (
  id                 BIGSERIAL PRIMARY KEY,
  patient_id         INTEGER NOT NULL REFERENCES hms_patients (id),
  practitioner_user_id INTEGER NOT NULL REFERENCES hms_users (id),
  role               TEXT NOT NULL CHECK (role IN ('primary', 'consulting', 'covering')),
  valid_from         TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to           TIMESTAMPTZ,
  assigned_by        INTEGER REFERENCES hms_users (id),
  ended_by           INTEGER REFERENCES hms_users (id),
  ended_reason       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_care_validity CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_care_ended_by CHECK ((ended_reason IS NULL) = (ended_by IS NULL)),
  CONSTRAINT ck_care_ended_reason CHECK (valid_to IS NULL OR ended_reason IS NOT NULL)
);
-- One current assignment per patient and clinician.
CREATE UNIQUE INDEX ux_care_current ON hms_care_team_assignments (patient_id, practitioner_user_id) WHERE valid_to IS NULL;
CREATE INDEX ix_care_by_practitioner ON hms_care_team_assignments (practitioner_user_id) WHERE valid_to IS NULL;

CREATE TABLE hms_break_glass_access (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES hms_users (id),
  patient_id   INTEGER NOT NULL REFERENCES hms_patients (id),
  reason       TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  reviewed_by  INTEGER REFERENCES hms_users (id),
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  CONSTRAINT ck_break_glass_window CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '1 hour'),
  CONSTRAINT ck_break_glass_review CHECK ((reviewed_at IS NULL) = (reviewed_by IS NULL))
);
CREATE INDEX ix_break_glass_active ON hms_break_glass_access (user_id, patient_id, expires_at);

CREATE TRIGGER trg_audit_hms_care_team_assignments AFTER INSERT OR UPDATE OR DELETE ON hms_care_team_assignments
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_break_glass_access AFTER INSERT OR UPDATE OR DELETE ON hms_break_glass_access
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- True when the clinician may read this patient's record.
CREATE FUNCTION patient_in_care(login_user_id INTEGER, the_patient_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM hms_care_team_assignments c
                  WHERE c.practitioner_user_id = login_user_id AND c.patient_id = the_patient_id AND c.valid_to IS NULL)
      OR EXISTS (SELECT 1 FROM hms_admissions a
                  WHERE a.patient_id = the_patient_id AND a.admitting_doctor_id = login_user_id AND a.status = 'Active')
      OR EXISTS (SELECT 1 FROM hms_break_glass_access b
                  WHERE b.user_id = login_user_id AND b.patient_id = the_patient_id AND b.expires_at > now())
$$;

-- Backfill from what actually happened: a doctor who has treated, booked or
-- queued a patient in the last year is on that patient's care team.
INSERT INTO hms_care_team_assignments (patient_id, practitioner_user_id, role, valid_from)
SELECT pairs.patient_id, pairs.doctor_id, 'consulting', pairs.first_seen
  FROM (
    SELECT patient_id, doctor_id, min(seen) AS first_seen FROM (
      SELECT e.patient_id, e.doctor_id, e.encounter_date::timestamptz AS seen FROM hms_encounters e
       WHERE e.encounter_date >= now() - interval '365 days'
      UNION ALL
      SELECT t.patient_id, t.doctor_id, t.token_date::timestamptz FROM hms_tokens t
       WHERE t.token_date >= (now() - interval '365 days')::date
      UNION ALL
      SELECT a.patient_id, a.doctor_id, a.appointment_date::timestamptz FROM hms_appointments a
       WHERE a.appointment_date >= (now() - interval '365 days')::date
    ) seen_pairs
    GROUP BY patient_id, doctor_id
  ) pairs
  JOIN hms_users u ON u.id = pairs.doctor_id AND u.role = 'doctor'
ON CONFLICT DO NOTHING;
