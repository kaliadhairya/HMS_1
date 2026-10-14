CREATE FUNCTION lab_reconciliation_provenance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Laboratory reconciliation evidence cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (NEW.item_id,NEW.source,NEW.message_id,NEW.payload,NEW.reason,NEW.created_at) IS DISTINCT FROM
    (OLD.item_id,OLD.source,OLD.message_id,OLD.payload,OLD.reason,OLD.created_at)
 THEN RAISE EXCEPTION 'Original laboratory message and reconciliation evidence are immutable' USING ERRCODE='23514'; END IF;
 IF OLD.state='RESOLVED' THEN RAISE EXCEPTION 'Resolved evidence cannot be silently rewritten' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_lab_reconciliation_provenance BEFORE UPDATE OR DELETE ON hms_lab_reconciliation FOR EACH ROW EXECUTE FUNCTION lab_reconciliation_provenance_guard();
