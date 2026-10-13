-- Phase 3: coded identities and immutable medication order versions.
CREATE TABLE hms_med_ingredients (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code_system TEXT NOT NULL, code TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(trim(name))>0), provenance TEXT NOT NULL CHECK(length(trim(provenance))>0),
 effective_at TIMESTAMPTZ NOT NULL, created_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 UNIQUE(code_system,code)
);
CREATE TABLE hms_med_products (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), legacy_medicine_id INTEGER UNIQUE REFERENCES hms_medicines(id),
 code TEXT NOT NULL UNIQUE, name TEXT NOT NULL CHECK(length(trim(name))>0), strength NUMERIC(18,6) CHECK(strength>0),
 strength_unit TEXT, concentration_denominator NUMERIC(18,6) CHECK(concentration_denominator>0),
 concentration_unit TEXT, dose_form TEXT NOT NULL, route TEXT, base_unit TEXT,
 pack_unit TEXT, pack_conversion NUMERIC(18,6) CHECK(pack_conversion>0),
 quantity_precision SMALLINT NOT NULL DEFAULT 0 CHECK(quantity_precision BETWEEN 0 AND 6), barcode TEXT UNIQUE,
 controlled BOOLEAN NOT NULL DEFAULT false, status TEXT NOT NULL CHECK(status IN ('DRAFT','APPROVED','RETIRED')),
 provenance TEXT NOT NULL, effective_at TIMESTAMPTZ NOT NULL, created_by_user_id INTEGER REFERENCES hms_users(id),
 CHECK(status<>'APPROVED' OR (strength IS NOT NULL AND strength_unit IS NOT NULL AND route IS NOT NULL
   AND base_unit IS NOT NULL AND pack_conversion IS NOT NULL AND length(trim(provenance))>0))
);
CREATE TABLE hms_med_product_ingredients (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 ingredient_id UUID NOT NULL REFERENCES hms_med_ingredients(id), amount NUMERIC(18,6) NOT NULL CHECK(amount>0),
 unit TEXT NOT NULL CHECK(length(trim(unit))>0), UNIQUE(product_id,ingredient_id)
);
CREATE TABLE hms_med_formulary (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), product_id UUID NOT NULL REFERENCES hms_med_products(id),
 revision INTEGER NOT NULL CHECK(revision>0), restrictions JSONB NOT NULL DEFAULT '{}',
 provenance TEXT NOT NULL CHECK(length(trim(provenance))>0), effective_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ, approved_by_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 CHECK(expires_at IS NULL OR expires_at>effective_at), UNIQUE(product_id,revision)
);
CREATE TABLE hms_med_reconciliation (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), legacy_medicine_id INTEGER REFERENCES hms_medicines(id),
 legacy_item_id INTEGER UNIQUE REFERENCES hms_prescription_items(id), product_id UUID REFERENCES hms_med_products(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RESOLVED')),
 resolved_by_user_id INTEGER REFERENCES hms_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Missing route, conversion or clinical approval cannot be inferred from display names.
INSERT INTO hms_med_products(legacy_medicine_id,code,name,strength,strength_unit,dose_form,pack_unit,controlled,status,provenance,effective_at)
 SELECT id,'legacy:'||id,generic_name,
 CASE WHEN strength ~ '^[0-9]+(\.[0-9]+)?$' THEN CASE WHEN strength::numeric>0 THEN strength::numeric END ELSE NULL END,
 strength_unit,coalesce(nullif(formulation,''),'UNKNOWN'),unit_of_sale,is_controlled=1,'DRAFT',
 'Legacy catalogue snapshot; route, units and composition require review',now() FROM hms_medicines;
INSERT INTO hms_med_reconciliation(legacy_medicine_id,product_id,reason)
 SELECT legacy_medicine_id,id,'Legacy identity requires approved composition, route and base-unit conversion' FROM hms_med_products;
INSERT INTO hms_med_reconciliation(legacy_item_id,reason)
 SELECT id,'Free-text legacy prescription: no certain coded product identity' FROM hms_prescription_items;
CREATE TABLE hms_med_allergy_reviews (
 patient_id INTEGER PRIMARY KEY REFERENCES hms_patients(id), state TEXT NOT NULL
 CHECK(state IN ('UNKNOWN','NOT_REVIEWED','NONE_KNOWN','ALLERGIES_RECORDED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), reviewer_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(), reason TEXT NOT NULL CHECK(length(trim(reason))>0)
);
CREATE TABLE hms_med_allergies (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 ingredient_id UUID REFERENCES hms_med_ingredients(id), clinical_text TEXT NOT NULL CHECK(length(trim(clinical_text))>0),
 reaction TEXT NOT NULL, clinical_status TEXT NOT NULL CHECK(clinical_status IN ('ACTIVE','INACTIVE','RESOLVED')),
 verification_status TEXT NOT NULL CHECK(verification_status IN ('UNCONFIRMED','CONFIRMED','REFUTED','ENTERED_IN_ERROR')),
 author_user_id INTEGER NOT NULL REFERENCES hms_users(id), recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_med_rule_packs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), code TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 content JSONB NOT NULL CHECK(jsonb_typeof(content)='object'), coverage JSONB NOT NULL CHECK(jsonb_typeof(coverage)='object'),
 provenance TEXT NOT NULL CHECK(length(trim(provenance))>0), effective_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ,
 approved_by_user_id INTEGER NOT NULL REFERENCES hms_users(id), UNIQUE(code,revision), CHECK(expires_at IS NULL OR expires_at>effective_at)
);
-- No invented clinical knowledge is seeded.
CREATE TABLE hms_med_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_id INTEGER NOT NULL REFERENCES hms_patients(id),
 encounter_id INTEGER NOT NULL REFERENCES hms_encounters(id), admission_id INTEGER REFERENCES hms_admissions(id),
 prescriber_user_id INTEGER NOT NULL REFERENCES hms_users(id), current_version INTEGER NOT NULL DEFAULT 1 CHECK(current_version>0),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), state TEXT NOT NULL DEFAULT 'DRAFT'
 CHECK(state IN ('DRAFT','SIGNED','HELD','DISCONTINUED')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(id,patient_id)
);
CREATE TABLE hms_med_order_versions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES hms_med_orders(id),
 version INTEGER NOT NULL CHECK(version>0), product_id UUID REFERENCES hms_med_products(id), ingredient_id UUID REFERENCES hms_med_ingredients(id),
 product_snapshot JSONB NOT NULL, dose NUMERIC(18,6) NOT NULL CHECK(dose>0), dose_unit TEXT NOT NULL CHECK(length(trim(dose_unit))>0),
 route TEXT NOT NULL CHECK(length(trim(route))>0), frequency JSONB NOT NULL CHECK(jsonb_typeof(frequency)='object'),
 starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL CHECK(ends_at>starts_at),
 prn BOOLEAN NOT NULL DEFAULT false, indication TEXT, max_dose NUMERIC(18,6) CHECK(max_dose>0),
 max_period_hours NUMERIC(10,4) CHECK(max_period_hours>0), min_interval_minutes INTEGER CHECK(min_interval_minutes>0),
 supply_quantity NUMERIC(18,6) NOT NULL CHECK(supply_quantity>0), supply_unit TEXT NOT NULL,
 author_user_id INTEGER NOT NULL REFERENCES hms_users(id), amendment_reason TEXT,
 signed_at TIMESTAMPTZ, UNIQUE(order_id,version), UNIQUE(id,order_id),
 CHECK((product_id IS NOT NULL)::integer+(ingredient_id IS NOT NULL)::integer=1),
 CHECK(NOT prn OR (indication IS NOT NULL AND length(trim(indication))>0 AND max_dose IS NOT NULL AND max_period_hours IS NOT NULL AND min_interval_minutes IS NOT NULL))
);
ALTER TABLE hms_med_orders ADD CONSTRAINT fk_med_current_version FOREIGN KEY(id,current_version)
 REFERENCES hms_med_order_versions(order_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE hms_med_assessments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version_id UUID NOT NULL REFERENCES hms_med_order_versions(id),
 rule_pack_id UUID REFERENCES hms_med_rule_packs(id), input_snapshot JSONB NOT NULL, findings JSONB NOT NULL,
 coverage JSONB NOT NULL, requires_review BOOLEAN NOT NULL, author_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE hms_med_verifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), version_id UUID NOT NULL UNIQUE REFERENCES hms_med_order_versions(id),
 assessment_id UUID NOT NULL REFERENCES hms_med_assessments(id), state TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(state IN ('PENDING','VERIFIED','CLARIFICATION')), reviewer_user_id INTEGER REFERENCES hms_users(id),
 reason TEXT, reviewed_at TIMESTAMPTZ,
 CHECK(state='PENDING' OR (reviewer_user_id IS NOT NULL AND reason IS NOT NULL AND length(trim(reason))>0 AND reviewed_at IS NOT NULL))
);
CREATE TABLE hms_med_overrides (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), assessment_id UUID NOT NULL REFERENCES hms_med_assessments(id),
 finding_code TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 requester_user_id INTEGER NOT NULL REFERENCES hms_users(id), reviewer_user_id INTEGER NOT NULL REFERENCES hms_users(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(assessment_id,finding_code)
);
CREATE TABLE hms_med_transitions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), order_id UUID NOT NULL REFERENCES hms_med_orders(id),
 version_id UUID NOT NULL REFERENCES hms_med_order_versions(id), action TEXT NOT NULL
 CHECK(action IN ('SIGN','HOLD','RESUME','DISCONTINUE','AMEND')),
 actor_user_id INTEGER NOT NULL REFERENCES hms_users(id), reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Signed content is retained; lifecycle state belongs to the order aggregate.
CREATE FUNCTION med_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.signed_at IS NOT NULL THEN RAISE EXCEPTION 'Medication versions are immutable after signing'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER trg_med_version_immutable BEFORE UPDATE OR DELETE ON hms_med_order_versions FOR EACH ROW EXECUTE FUNCTION med_immutable_version();
CREATE TRIGGER trg_audit_hms_med_ingredients AFTER INSERT OR UPDATE OR DELETE ON hms_med_ingredients FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_products AFTER INSERT OR UPDATE OR DELETE ON hms_med_products FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_product_ingredients AFTER INSERT OR UPDATE OR DELETE ON hms_med_product_ingredients FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_formulary AFTER INSERT OR UPDATE OR DELETE ON hms_med_formulary FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_reconciliation AFTER INSERT OR UPDATE OR DELETE ON hms_med_reconciliation FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_allergy_reviews AFTER INSERT OR UPDATE OR DELETE ON hms_med_allergy_reviews FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_allergies AFTER INSERT OR UPDATE OR DELETE ON hms_med_allergies FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_rule_packs AFTER INSERT OR UPDATE OR DELETE ON hms_med_rule_packs FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_orders AFTER INSERT OR UPDATE OR DELETE ON hms_med_orders FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_order_versions AFTER INSERT OR UPDATE OR DELETE ON hms_med_order_versions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_assessments AFTER INSERT OR UPDATE OR DELETE ON hms_med_assessments FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_verifications AFTER INSERT OR UPDATE OR DELETE ON hms_med_verifications FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_overrides AFTER INSERT OR UPDATE OR DELETE ON hms_med_overrides FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_med_transitions AFTER INSERT OR UPDATE OR DELETE ON hms_med_transitions FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conrelid::regclass AS tab, conname, pg_get_constraintdef(oid) AS def, conkey FROM pg_constraint
 WHERE contype='f' AND conrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'hms_med_%') LOOP
 EXECUTE format('CREATE INDEX %I ON %s (%s)', 'ix_med_'||substr(md5(r.tab::text||r.conname),1,24), r.tab,
 (SELECT string_agg(quote_ident(attname),',') FROM pg_attribute WHERE attrelid=r.tab AND attnum=ANY(r.conkey)));
 END LOOP; END $$;
