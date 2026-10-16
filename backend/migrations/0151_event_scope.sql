-- Completion A8: live events say which patient they concern, so delivery and
-- replay apply the same patient scope as the API (a doctor receives a
-- patient's events only while the patient is in their care). Events also
-- carry a schema version and the record they are about. Events written
-- before this migration have no patient and keep their audience-only scope.

ALTER TABLE hms_outbox
  ADD COLUMN patient_id INTEGER,
  ADD COLUMN schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  ADD COLUMN aggregate_type TEXT CHECK (aggregate_type ~ '^[a-z][a-z0-9_.]{0,62}$'),
  ADD COLUMN aggregate_id TEXT CHECK (length(aggregate_id) BETWEEN 1 AND 100),
  ADD CONSTRAINT hms_outbox_aggregate_pair CHECK ((aggregate_type IS NULL) = (aggregate_id IS NULL));

-- The replay query filters by delivery sequence first; this serves the
-- per-patient lookups that support and audits ask for.
CREATE INDEX ix_outbox_patient ON hms_outbox (patient_id, delivery_sequence) WHERE patient_id IS NOT NULL;
