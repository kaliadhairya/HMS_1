-- Durable replay order and versioned settings. Prior migration files remain immutable.
ALTER TABLE hms_app_settings ADD COLUMN revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE hms_outbox ADD COLUMN delivery_sequence BIGINT UNIQUE;
CREATE SEQUENCE hms_outbox_delivery_seq;
CREATE INDEX ix_outbox_delivery_sequence ON hms_outbox (delivery_sequence) WHERE delivery_sequence IS NOT NULL;
-- One allocator at a time assigns sequences to committed events. Sequence gaps
-- are harmless; assignment and row visibility are serialized by advisory lock.
