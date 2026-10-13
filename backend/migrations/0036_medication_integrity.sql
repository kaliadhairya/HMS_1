ALTER TABLE hms_med_allergy_reviews ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_med_nursing_responsibility ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_med_handover_tasks ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE hms_med_assessments ADD CONSTRAINT ux_med_assessment_version UNIQUE(id,version_id);
ALTER TABLE hms_med_verifications ADD CONSTRAINT fk_med_verification_assessment_version
 FOREIGN KEY(assessment_id,version_id) REFERENCES hms_med_assessments(id,version_id);
CREATE TABLE hms_med_product_retirements (
 product_id UUID PRIMARY KEY REFERENCES hms_med_products(id), id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), retired_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 retired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_med_retirement_user ON hms_med_product_retirements(retired_by_user_id);
CREATE TRIGGER trg_audit_hms_med_product_retirements AFTER INSERT OR UPDATE OR DELETE ON hms_med_product_retirements FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_med_retirement_immutable BEFORE UPDATE OR DELETE ON hms_med_product_retirements FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE TRIGGER trg_med_transition_immutable BEFORE UPDATE OR DELETE ON hms_med_transitions FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE FUNCTION med_catalogue_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM hms_med_products WHERE legacy_medicine_id=OLD.id AND status='APPROVED') AND
 (OLD.generic_name,OLD.formulation,OLD.strength,OLD.strength_unit,OLD.unit_of_sale,OLD.is_controlled)
 IS DISTINCT FROM (NEW.generic_name,NEW.formulation,NEW.strength,NEW.strength_unit,NEW.unit_of_sale,NEW.is_controlled) THEN
 RAISE EXCEPTION 'Coded medication identity is immutable; publish a replacement product'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_med_legacy_identity BEFORE UPDATE ON hms_medicines FOR EACH ROW EXECUTE FUNCTION med_catalogue_identity_guard();
CREATE FUNCTION med_schedule_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM hms_med_order_versions v JOIN hms_med_orders o ON o.id=v.order_id
 JOIN hms_med_verifications z ON z.version_id=v.id WHERE v.id=NEW.version_id AND o.patient_id=NEW.patient_id
 AND o.current_version=v.version AND o.state='SIGNED' AND z.state='VERIFIED'
 AND NEW.scheduled_at>=v.starts_at AND NEW.scheduled_at<v.ends_at AND NEW.prn=v.prn) THEN
 RAISE EXCEPTION 'Schedule requires the current verified patient order'; END IF;
 IF TG_OP='UPDATE' AND (OLD.version_id,OLD.patient_id,OLD.scheduled_at,OLD.prn)
 IS DISTINCT FROM(NEW.version_id,NEW.patient_id,NEW.scheduled_at,NEW.prn) THEN
 RAISE EXCEPTION 'Scheduled occurrence identity cannot be overwritten'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_med_schedule_context BEFORE INSERT OR UPDATE ON hms_med_schedules FOR EACH ROW EXECUTE FUNCTION med_schedule_context_guard();
CREATE FUNCTION med_administration_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_med_schedules s JOIN hms_med_order_versions v ON v.id=s.version_id JOIN hms_med_orders o ON o.id=v.order_id
 JOIN hms_med_verifications z ON z.version_id=v.id JOIN hms_users u ON u.id=NEW.performer_user_id
 WHERE s.id=NEW.schedule_id AND s.version_id=NEW.version_id AND s.patient_id=NEW.patient_id AND s.state='PENDING'
 AND o.current_version=v.version AND o.state='SIGNED' AND z.state='VERIFIED' AND u.role='nurse' AND u.is_active=1
 AND NEW.dose=v.dose AND NEW.dose_unit=v.dose_unit AND NEW.route=v.route AND NEW.actual_at>=v.starts_at AND NEW.actual_at<v.ends_at
 AND (v.product_id=NEW.product_id OR EXISTS(SELECT 1 FROM hms_med_substitutions WHERE version_id=v.id AND product_id=NEW.product_id))) THEN
 RAISE EXCEPTION 'Administration requires the current authorized verified occurrence'; END IF;
 IF NEW.outcome='GIVEN' AND NOT EXISTS(SELECT 1 FROM hms_med_dispense_lines l JOIN hms_med_dispenses d ON d.id=l.dispense_id
 JOIN hms_med_documentation_intents i ON i.schedule_id=NEW.schedule_id
 WHERE l.id=NEW.dispense_line_id AND l.version_id=NEW.version_id AND l.product_id=NEW.product_id AND d.patient_id=NEW.patient_id
 AND i.state='PENDING_DOCUMENTATION' AND i.performer_user_id=NEW.performer_user_id AND NEW.base_quantity>0) THEN
 RAISE EXCEPTION 'Given dose requires supplied product and the performer documentation claim'; END IF;
 IF EXISTS(SELECT 1 FROM hms_med_products WHERE id=NEW.product_id AND controlled=true) AND NEW.outcome='GIVEN' AND NEW.witness_id IS NULL THEN
 RAISE EXCEPTION 'Controlled administration requires independent witness'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_med_admin_context BEFORE INSERT ON hms_med_administrations FOR EACH ROW EXECUTE FUNCTION med_administration_context_guard();
