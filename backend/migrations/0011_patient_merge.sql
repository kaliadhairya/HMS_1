-- 0011: duplicate patient review and reversible merge (blueprint 3.3:
-- IdentityLink/MergeCase; "no automatic clinical-record union based on
-- matching names or phone numbers").
--
-- Candidates are only proposed; a person dismisses or merges them. A merge
-- moves every row that references the duplicate onto the surviving patient,
-- records each move, and keeps the duplicate as 'merged' with a pointer to the
-- survivor. Unmerge reverses exactly the recorded moves. Tables are found
-- from their foreign keys, so tables added later are covered too.

ALTER TABLE hms_patients ADD COLUMN merged_into_patient_id INTEGER REFERENCES hms_patients (id);
ALTER TABLE hms_patients ADD CONSTRAINT ck_patients_merged_pointer
  CHECK ((identity_status = 'merged') = (merged_into_patient_id IS NOT NULL) AND merged_into_patient_id IS DISTINCT FROM id);
CREATE INDEX ix_patients_merged_into ON hms_patients (merged_into_patient_id) WHERE merged_into_patient_id IS NOT NULL;

CREATE TABLE hms_patient_merge_cases (
  id               BIGSERIAL PRIMARY KEY,
  patient_a_id     INTEGER NOT NULL REFERENCES hms_patients (id),
  patient_b_id     INTEGER NOT NULL REFERENCES hms_patients (id),
  evidence         JSONB NOT NULL,
  score            INTEGER NOT NULL CHECK (score BETWEEN 1 AND 100),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'merged', 'unmerged')),
  detected_by      INTEGER REFERENCES hms_users (id),  -- NULL: found by the system
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by       INTEGER REFERENCES hms_users (id),
  decided_at       TIMESTAMPTZ,
  decision_reason  TEXT,
  survivor_id      INTEGER REFERENCES hms_patients (id),
  merged_id        INTEGER REFERENCES hms_patients (id),
  merged_previous_status TEXT CHECK (merged_previous_status IN ('registered', 'temporary')),
  unmerged_by      INTEGER REFERENCES hms_users (id),
  unmerged_at      TIMESTAMPTZ,
  unmerge_reason   TEXT,
  CONSTRAINT ck_merge_pair_order CHECK (patient_a_id < patient_b_id),
  CONSTRAINT ck_merge_decision CHECK (status = 'open' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_reason IS NOT NULL)),
  CONSTRAINT ck_merge_parties CHECK (
    (status IN ('merged', 'unmerged')) = (survivor_id IS NOT NULL AND merged_id IS NOT NULL)
    AND (survivor_id IS NULL OR (survivor_id IN (patient_a_id, patient_b_id) AND merged_id IN (patient_a_id, patient_b_id) AND survivor_id <> merged_id))),
  CONSTRAINT ck_merge_unmerge CHECK ((status = 'unmerged') = (unmerged_at IS NOT NULL))
);
-- One open case per pair.
CREATE UNIQUE INDEX ux_merge_cases_open_pair ON hms_patient_merge_cases (patient_a_id, patient_b_id) WHERE status = 'open';
CREATE INDEX ix_merge_cases_status ON hms_patient_merge_cases (status, detected_at);

-- Every row a merge changed, so unmerge can reverse exactly those.
CREATE TABLE hms_patient_merge_moves (
  id          BIGSERIAL PRIMARY KEY,
  case_id     BIGINT NOT NULL REFERENCES hms_patient_merge_cases (id),
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL,
  row_id      TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('moved', 'retired', 'ended')),
  reversed_at TIMESTAMPTZ
);
CREATE INDEX ix_merge_moves_case ON hms_patient_merge_moves (case_id);

CREATE TRIGGER trg_audit_hms_patient_merge_cases AFTER INSERT OR UPDATE OR DELETE ON hms_patient_merge_cases
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_patient_merge_moves AFTER INSERT OR UPDATE OR DELETE ON hms_patient_merge_moves
  FOR EACH ROW EXECUTE FUNCTION audit.capture_change();

-- Likely duplicate pairs, with the evidence for each. For one patient (after
-- registration) or, with NULL, for everyone. A shared phone alone is never
-- enough: families share phones.
CREATE FUNCTION find_duplicate_candidates(only_patient INTEGER)
RETURNS TABLE (patient_a_id INTEGER, patient_b_id INTEGER, reasons TEXT[], score INTEGER)
LANGUAGE sql STABLE AS $$
  WITH live AS (
    SELECT id, name, lower(regexp_replace(name, '\s+', ' ', 'g')) AS norm_name, gender, age, dob,
           right(regexp_replace(COALESCE(phonenumber, ''), '\D', '', 'g'), 10) AS phone
      FROM hms_patients WHERE identity_status <> 'merged'
  ),
  shared_identifier AS (
    SELECT DISTINCT LEAST(a.patient_id, b.patient_id) AS pa, GREATEST(a.patient_id, b.patient_id) AS pb,
           'same ' || replace(lower(a.system), '_', ' ') || ' ' || a.value AS reason, 60 AS points
      FROM hms_patient_identifiers a
      JOIN hms_patient_identifiers b ON b.system = a.system AND b.value = a.value AND b.issuer = a.issuer AND b.patient_id <> a.patient_id
     WHERE a.system NOT IN ('UHID', 'TEMPORARY') AND a.valid_to IS NULL AND b.valid_to IS NULL
       AND (only_patient IS NULL OR only_patient IN (a.patient_id, b.patient_id))
  ),
  pairs AS (
    SELECT LEAST(a.id, b.id) AS pa, GREATEST(a.id, b.id) AS pb, a, b, similarity(a.norm_name, b.norm_name) AS sim
      FROM live a JOIN live b ON a.id < b.id AND a.norm_name % b.norm_name
     WHERE only_patient IS NULL OR only_patient IN (a.id, b.id)
  ),
  demographic AS (
    SELECT pa, pb, 'same phone, similar name' AS reason, 35 AS points FROM pairs
     WHERE (a).phone <> '' AND (a).phone = (b).phone AND sim >= 0.6
    UNION ALL
    SELECT pa, pb, 'same date of birth, similar name', 35 FROM pairs
     WHERE (a).dob IS NOT NULL AND (a).dob = (b).dob AND sim >= 0.7
    UNION ALL
    SELECT pa, pb, 'nearly identical name, same sex and age', 25 FROM pairs
     WHERE sim >= 0.9 AND (a).gender = (b).gender AND (a).gender <> 'Unknown' AND abs((a).age - (b).age) <= 1
  ),
  all_reasons AS (
    SELECT pa, pb, reason, points FROM shared_identifier
    UNION ALL SELECT pa, pb, reason, points FROM demographic
  )
  SELECT r.pa, r.pb, array_agg(r.reason ORDER BY r.points DESC), LEAST(100, sum(r.points))::integer
    FROM all_reasons r
    JOIN hms_patients pa ON pa.id = r.pa AND pa.identity_status <> 'merged'
    JOIN hms_patients pb ON pb.id = r.pb AND pb.identity_status <> 'merged'
   GROUP BY r.pa, r.pb
$$;

-- Records open cases for new candidate pairs; a pair already open or
-- dismissed is not proposed again. Returns the number of new cases.
CREATE FUNCTION propose_duplicate_cases(only_patient INTEGER, by_user INTEGER)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  created INTEGER;
BEGIN
  INSERT INTO hms_patient_merge_cases (patient_a_id, patient_b_id, evidence, score, detected_by)
  SELECT c.patient_a_id, c.patient_b_id, to_jsonb(c.reasons), c.score, by_user
    FROM find_duplicate_candidates(only_patient) c
   WHERE NOT EXISTS (
     SELECT 1 FROM hms_patient_merge_cases m
      WHERE m.patient_a_id = c.patient_a_id AND m.patient_b_id = c.patient_b_id AND m.status IN ('open', 'dismissed'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS created = ROW_COUNT;
  RETURN created;
END $$;

-- Merges an open case: every reference to the duplicate moves to the survivor.
CREATE FUNCTION merge_patients(merge_case BIGINT, survivor INTEGER, by_user INTEGER, reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  c hms_patient_merge_cases;
  duplicate INTEGER;
  ref RECORD;
  moved INTEGER := 0;
  n INTEGER;
BEGIN
  SELECT * INTO c FROM hms_patient_merge_cases WHERE id = merge_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge case % not found', merge_case USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'open' THEN RAISE EXCEPTION 'merge case % is %', merge_case, c.status USING ERRCODE = 'P0001'; END IF;
  IF survivor NOT IN (c.patient_a_id, c.patient_b_id) THEN RAISE EXCEPTION 'survivor must be one of the two patients' USING ERRCODE = 'P0001'; END IF;
  duplicate := CASE WHEN survivor = c.patient_a_id THEN c.patient_b_id ELSE c.patient_a_id END;
  -- Lock both patients in id order.
  PERFORM 1 FROM hms_patients WHERE id IN (survivor, duplicate) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM hms_patients WHERE id IN (survivor, duplicate) AND identity_status = 'merged') THEN
    RAISE EXCEPTION 'one of these patients is already merged' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT patient_id) FROM hms_admissions WHERE patient_id IN (survivor, duplicate) AND status = 'Active') = 2 THEN
    RAISE EXCEPTION 'both patients have an active admission; discharge one first' USING ERRCODE = 'P0001';
  END IF;

  -- Identifiers the survivor already holds are retired on the duplicate, not moved.
  WITH retired AS (
    UPDATE hms_patient_identifiers d SET valid_to = now()
     WHERE d.patient_id = duplicate AND d.valid_to IS NULL
       AND EXISTS (SELECT 1 FROM hms_patient_identifiers s WHERE s.patient_id = survivor AND s.valid_to IS NULL
                     AND s.system = d.system AND s.issuer = d.issuer AND s.value = d.value)
    RETURNING d.id)
  INSERT INTO hms_patient_merge_moves (case_id, table_name, column_name, row_id, action)
  SELECT merge_case, 'hms_patient_identifiers', 'patient_id', id::text, 'retired' FROM retired;

  -- A relationship between the two patients would point at itself: end it.
  WITH ended AS (
    UPDATE hms_related_persons SET valid_to = now()
     WHERE valid_to IS NULL AND ((patient_id = duplicate AND related_patient_id = survivor) OR (patient_id = survivor AND related_patient_id = duplicate))
    RETURNING id)
  INSERT INTO hms_patient_merge_moves (case_id, table_name, column_name, row_id, action)
  SELECT merge_case, 'hms_related_persons', 'patient_id', id::text, 'ended' FROM ended;

  FOR ref IN
    SELECT cl.relname AS tbl, a.attname AS col
      FROM pg_constraint k
      JOIN pg_class cl ON cl.oid = k.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND k.confrelid = 'hms_patients'::regclass AND ns.nspname = 'public'
       AND array_length(k.conkey, 1) = 1
       AND cl.relname NOT IN ('hms_patients', 'hms_patient_merge_cases', 'hms_patient_merge_moves')
     ORDER BY cl.relname, a.attname
  LOOP
    EXECUTE format(
      'WITH moved AS (UPDATE public.%1$I SET %2$I = $1 WHERE %2$I = $2 %3$s RETURNING id)
       INSERT INTO hms_patient_merge_moves (case_id, table_name, column_name, row_id, action)
       SELECT $3, %1$L, %2$L, id::text, ''moved'' FROM moved',
      ref.tbl, ref.col,
      CASE WHEN ref.tbl IN ('hms_patient_identifiers', 'hms_related_persons') THEN 'AND valid_to IS NULL' ELSE '' END)
      USING survivor, duplicate, merge_case;
    GET DIAGNOSTICS n = ROW_COUNT;
    moved := moved + n;
  END LOOP;

  UPDATE hms_patient_merge_cases
     SET merged_previous_status = (SELECT identity_status FROM hms_patients WHERE id = duplicate)
   WHERE id = merge_case;
  UPDATE hms_patients SET identity_status = 'merged', merged_into_patient_id = survivor, updated_at = now() WHERE id = duplicate;
  UPDATE hms_patient_merge_cases
     SET status = 'merged', survivor_id = survivor, merged_id = duplicate,
         decided_by = by_user, decided_at = now(), decision_reason = reason
   WHERE id = merge_case;
  RETURN moved;
END $$;

-- Reverses a merge: every recorded move goes back; rows added to the
-- survivor after the merge stay with the survivor.
CREATE FUNCTION unmerge_patients(merge_case BIGINT, by_user INTEGER, reason TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  c hms_patient_merge_cases;
  m RECORD;
  restored INTEGER := 0;
  n INTEGER;
BEGIN
  SELECT * INTO c FROM hms_patient_merge_cases WHERE id = merge_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge case % not found', merge_case USING ERRCODE = 'P0002'; END IF;
  IF c.status <> 'merged' THEN RAISE EXCEPTION 'merge case % is %', merge_case, c.status USING ERRCODE = 'P0001'; END IF;
  PERFORM 1 FROM hms_patients WHERE id IN (c.survivor_id, c.merged_id) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM hms_patients WHERE id = c.merged_id AND merged_into_patient_id <> c.survivor_id) THEN
    RAISE EXCEPTION 'the merged record has changed since; review by hand' USING ERRCODE = 'P0001';
  END IF;
  -- The duplicate stops being 'merged' first, so moved rows may point at it again.
  UPDATE hms_patients SET identity_status = COALESCE(c.merged_previous_status, 'registered'), merged_into_patient_id = NULL, updated_at = now()
   WHERE id = c.merged_id;
  FOR m IN SELECT * FROM hms_patient_merge_moves WHERE case_id = merge_case AND reversed_at IS NULL ORDER BY id DESC LOOP
    IF m.action = 'moved' THEN
      EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id::text = $2 AND %I = $3', m.table_name, m.column_name, m.column_name)
        USING c.merged_id, m.row_id, c.survivor_id;
    ELSE
      EXECUTE format('UPDATE public.%I SET valid_to = NULL WHERE id::text = $1', m.table_name) USING m.row_id;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    restored := restored + n;
    UPDATE hms_patient_merge_moves SET reversed_at = now() WHERE id = m.id;
  END LOOP;
  UPDATE hms_patient_merge_cases SET status = 'unmerged', unmerged_by = by_user, unmerged_at = now(), unmerge_reason = reason WHERE id = merge_case;
  RETURN restored;
END $$;
