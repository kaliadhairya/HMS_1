-- 0005: server-side sessions, so signing out, a password change, a forced
-- logout or deactivation ends a login immediately instead of leaving its
-- token valid until it expires.
CREATE TABLE hms_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        INTEGER NOT NULL REFERENCES hms_users (id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  revoked_reason TEXT,
  ip             TEXT,
  user_agent     TEXT,
  CONSTRAINT ck_sessions_revocation CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX ix_sessions_user_active ON hms_sessions (user_id) WHERE revoked_at IS NULL;
