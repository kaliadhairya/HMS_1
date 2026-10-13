-- A recalled lot cannot become pickable through an intermediate disposition.
CREATE FUNCTION med_preserve_recall() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.lot_status='RECALLED' AND NEW.lot_status<>'RECALLED' THEN
   RAISE EXCEPTION 'A recalled lot cannot be released or relabelled';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_med_preserve_recall BEFORE UPDATE OF lot_status ON hms_medicine_batches
 FOR EACH ROW EXECUTE FUNCTION med_preserve_recall();
