-- Completion A8 with Codex's A2 facility contract: a live event records the
-- facility it belongs to (the publisher's verified session facility), so
-- delivery and catch-up go only to sessions in that facility. Events from
-- before this, or from processes without a facility, keep audience-only scope.
ALTER TABLE hms_outbox ADD COLUMN facility_id UUID REFERENCES hms_facilities (id);
CREATE INDEX ix_outbox_facility ON hms_outbox (facility_id, delivery_sequence) WHERE facility_id IS NOT NULL;
