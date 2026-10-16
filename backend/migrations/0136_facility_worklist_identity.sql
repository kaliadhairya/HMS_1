-- The same operational failure may affect several hospital facilities.
-- Deduplication must never collide with another facility's protected row.
DROP INDEX hms_worklist_items_one_open;
CREATE UNIQUE INDEX hms_worklist_items_one_open
 ON hms_worklist_items(facility_id,kind,dedupe_key) WHERE status='Open';
