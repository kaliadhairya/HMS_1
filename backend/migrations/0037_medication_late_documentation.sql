-- Serialize allergy review changes with active medication commands.
CREATE FUNCTION med_allergy_patient_barrier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM id FROM hms_patients WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.patient_id ELSE NEW.patient_id END FOR UPDATE;
RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
CREATE TRIGGER trg_med_legacy_allergy_barrier BEFORE INSERT OR UPDATE OR DELETE ON hms_allergies FOR EACH ROW EXECUTE FUNCTION med_allergy_patient_barrier();
CREATE TRIGGER trg_med_allergy_barrier BEFORE INSERT OR UPDATE OR DELETE ON hms_med_allergies FOR EACH ROW EXECUTE FUNCTION med_allergy_patient_barrier();
CREATE TRIGGER trg_med_allergy_review_barrier BEFORE INSERT OR UPDATE OR DELETE ON hms_med_allergy_reviews FOR EACH ROW EXECUTE FUNCTION med_allergy_patient_barrier();
CREATE TABLE hms_med_late_documentation_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), schedule_id UUID NOT NULL UNIQUE REFERENCES hms_med_schedules(id),
 version_id UUID NOT NULL REFERENCES hms_med_order_versions(id), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 performer_user_id INTEGER NOT NULL REFERENCES hms_users(id), approved_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 actual_at TIMESTAMPTZ NOT NULL, request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE hms_med_administrations ADD COLUMN late_review_id UUID UNIQUE REFERENCES hms_med_late_documentation_reviews(id);
CREATE INDEX ix_med_late_review_version ON hms_med_late_documentation_reviews(version_id);
CREATE INDEX ix_med_late_review_patient ON hms_med_late_documentation_reviews(patient_id);
CREATE INDEX ix_med_late_review_performer ON hms_med_late_documentation_reviews(performer_user_id);
CREATE INDEX ix_med_late_review_approver ON hms_med_late_documentation_reviews(approved_by_user_id);
CREATE TRIGGER trg_audit_hms_med_late_documentation_reviews AFTER INSERT OR UPDATE OR DELETE ON hms_med_late_documentation_reviews FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_med_late_review_immutable BEFORE UPDATE OR DELETE ON hms_med_late_documentation_reviews FOR EACH ROW EXECUTE FUNCTION med_no_rewrite();
CREATE OR REPLACE FUNCTION med_administration_context_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM hms_med_schedules s JOIN hms_med_order_versions v ON v.id=s.version_id JOIN hms_med_orders o ON o.id=v.order_id
 JOIN hms_med_verifications z ON z.version_id=v.id JOIN hms_users u ON u.id=NEW.performer_user_id
 WHERE s.id=NEW.schedule_id AND s.version_id=NEW.version_id AND s.patient_id=NEW.patient_id
 AND (s.state='PENDING' OR (s.state='CANCELLED' AND NEW.late_review_id IS NOT NULL))
 AND ((o.current_version=v.version AND o.state='SIGNED') OR EXISTS(SELECT 1 FROM hms_med_late_documentation_reviews r
 WHERE r.id=NEW.late_review_id AND r.schedule_id=s.id AND r.version_id=v.id AND r.patient_id=NEW.patient_id
 AND r.performer_user_id=NEW.performer_user_id AND r.actual_at=NEW.actual_at AND r.approved_by_user_id=o.prescriber_user_id))
 AND z.state='VERIFIED' AND u.role='nurse' AND u.is_active=1 AND NEW.dose=v.dose AND NEW.dose_unit=v.dose_unit AND NEW.route=v.route
 AND NEW.actual_at>=v.starts_at AND NEW.actual_at<v.ends_at
 AND (NEW.outcome<>'GIVEN' OR (NEW.actual_at>=v.signed_at AND NEW.actual_at>=z.reviewed_at))
 AND (v.product_id=NEW.product_id OR EXISTS(SELECT 1 FROM hms_med_substitutions WHERE version_id=v.id AND product_id=NEW.product_id))) THEN
 RAISE EXCEPTION 'Administration requires the authorized verified occurrence or reviewed prior documentation'; END IF;
 IF NEW.outcome='GIVEN' AND NOT EXISTS(SELECT 1 FROM hms_med_dispense_lines l JOIN hms_med_dispenses d ON d.id=l.dispense_id
 JOIN hms_med_documentation_intents i ON i.schedule_id=NEW.schedule_id
 WHERE l.id=NEW.dispense_line_id AND l.version_id=NEW.version_id AND l.product_id=NEW.product_id AND d.patient_id=NEW.patient_id
 AND i.state='PENDING_DOCUMENTATION' AND i.performer_user_id=NEW.performer_user_id AND NEW.base_quantity>0) THEN
 RAISE EXCEPTION 'Given dose requires supplied product and performer documentation claim'; END IF;
 IF EXISTS(SELECT 1 FROM hms_med_products WHERE id=NEW.product_id AND controlled=true) AND NEW.outcome='GIVEN' AND NEW.witness_id IS NULL THEN
 RAISE EXCEPTION 'Controlled administration requires independent witness'; END IF; RETURN NEW; END $$;
