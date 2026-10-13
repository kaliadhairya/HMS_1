-- 0018: referrals with acknowledged handoffs (blueprint 3.3: Referral,
-- HandoffTask: "A referral is complete only after a recorded receiving action or
-- documented closure"; 4.1: "A referral or transfer creates a receiving task
-- with acknowledgment").
--
-- Lifecycle, enforced by the database:
--   Pending       raised by the sending doctor, awaiting the receiving side
--   Acknowledged  the receiving clinician accepted it (they join the care team)
--   Completed     the receiving clinician recorded the outcome (needs acknowledgement)
--   Closed        documented closure without the receiving action (needs a reason)
-- Existing referrals are all Pending and keep working.

ALTER TABLE hms_referrals
  ADD COLUMN to_user_id       INTEGER REFERENCES hms_users (id),
  ADD COLUMN urgency          TEXT NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'urgent', 'emergency')),
  ADD COLUMN due_at           TIMESTAMPTZ,
  ADD COLUMN acknowledged_by  INTEGER REFERENCES hms_users (id),
  ADD COLUMN acknowledged_at  TIMESTAMPTZ,
  ADD COLUMN outcome          TEXT,
  ADD COLUMN completed_by     INTEGER REFERENCES hms_users (id),
  ADD COLUMN completed_at     TIMESTAMPTZ,
  ADD COLUMN closed_reason    TEXT,
  ADD COLUMN closed_by        INTEGER REFERENCES hms_users (id),
  ADD COLUMN closed_at        TIMESTAMPTZ;

ALTER TABLE hms_referrals ADD CONSTRAINT ck_referral_status CHECK (status IN ('Pending', 'Acknowledged', 'Completed', 'Closed'));
ALTER TABLE hms_referrals ADD CONSTRAINT ck_referral_ack CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL));
ALTER TABLE hms_referrals ADD CONSTRAINT ck_referral_lifecycle CHECK (
     (status = 'Pending'      AND acknowledged_at IS NULL AND completed_at IS NULL AND closed_at IS NULL)
  OR (status = 'Acknowledged' AND acknowledged_at IS NOT NULL AND completed_at IS NULL AND closed_at IS NULL)
  OR (status = 'Completed'    AND acknowledged_at IS NOT NULL AND completed_at IS NOT NULL AND outcome IS NOT NULL AND closed_at IS NULL)
  OR (status = 'Closed'       AND closed_at IS NOT NULL AND closed_reason IS NOT NULL AND completed_at IS NULL));
