-- A non-idempotent delivery receives one further attempt only after a known
-- pre-send failure or a recorded provider reconciliation.
ALTER TABLE hms_interface_messages DISABLE TRIGGER trg_interface_message_guard;
ALTER TABLE hms_interface_messages ADD COLUMN authorized_retry_generation bigint NOT NULL DEFAULT 1 CHECK(authorized_retry_generation>=1);
ALTER TABLE hms_interface_messages ENABLE TRIGGER trg_interface_message_guard;
