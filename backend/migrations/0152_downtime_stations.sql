-- Completion C6: downtime kit distribution. Ward machines are registered
-- with their own token (only its SHA-256 is kept), pull the newest kit with
-- it, and confirm each kit they stored. The Downtime screen shows which
-- machines hold a current kit; a machine that falls behind goes to the
-- worklist. Revoking a machine stops its token at once.

CREATE TABLE hms_downtime_stations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  location         TEXT NOT NULL CHECK (length(btrim(location)) BETWEEN 1 AND 80),
  token_sha256     TEXT NOT NULL UNIQUE CHECK (token_sha256 ~ '^[0-9a-f]{64}$'),
  registered_by    INTEGER NOT NULL REFERENCES hms_users (id),
  registered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       INTEGER REFERENCES hms_users (id),
  revoked_reason   TEXT,
  last_pull_at     TIMESTAMPTZ,
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CHECK (revoked_at IS NULL OR length(btrim(revoked_reason)) >= 5)
);
CREATE UNIQUE INDEX ux_downtime_station_name ON hms_downtime_stations (lower(btrim(name))) WHERE revoked_at IS NULL;

-- One row per kit a machine confirmed it stored (append-only evidence).
CREATE TABLE hms_downtime_station_receipts (
  id           BIGSERIAL PRIMARY KEY,
  station_id   UUID NOT NULL REFERENCES hms_downtime_stations (id),
  snapshot_id  UUID NOT NULL REFERENCES hms_downtime_snapshots (id),
  sha256       TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  opened       BOOLEAN NOT NULL,
  stored_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, snapshot_id)
);
CREATE INDEX ix_downtime_station_receipts_latest ON hms_downtime_station_receipts (station_id, stored_at DESC);

CREATE FUNCTION downtime_receipts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Kit receipts are evidence and are never changed or deleted' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER trg_downtime_receipts_append_only BEFORE UPDATE OR DELETE ON hms_downtime_station_receipts
  FOR EACH ROW EXECUTE FUNCTION downtime_receipts_append_only();
