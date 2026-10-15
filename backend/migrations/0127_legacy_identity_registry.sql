-- The compatibility registry preserves exact numeric identities. UUIDs are
-- never inferred from demographics, names, medicine labels or chart content.
CREATE TABLE hms_identity_resources (
 resource_key text PRIMARY KEY CHECK(resource_key ~ '^[a-z][a-z0-9_]+$'),
 resource_table regclass NOT NULL UNIQUE,facility_owned boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE hms_legacy_identity_map (
 resource_key text NOT NULL REFERENCES hms_identity_resources(resource_key),
 legacy_id bigint NOT NULL CHECK(legacy_id>0),public_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(resource_key,legacy_id),
 UNIQUE(public_id),UNIQUE(resource_key,public_id)
);
CREATE FUNCTION hms_identity_no_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Legacy identity mappings and their registry are immutable';
END $$;
CREATE TRIGGER trg_identity_registry_immutable BEFORE UPDATE OR DELETE ON hms_identity_resources FOR EACH ROW EXECUTE FUNCTION hms_identity_no_rewrite();
CREATE TRIGGER trg_identity_map_immutable BEFORE UPDATE OR DELETE ON hms_legacy_identity_map FOR EACH ROW EXECUTE FUNCTION hms_identity_no_rewrite();
CREATE TRIGGER trg_audit_hms_identity_resources AFTER INSERT OR UPDATE OR DELETE ON hms_identity_resources FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE TRIGGER trg_audit_hms_legacy_identity_map AFTER INSERT OR UPDATE OR DELETE ON hms_legacy_identity_map FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
CREATE FUNCTION hms_identity_map_check() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE target regclass; value uuid; BEGIN
 SELECT resource_table INTO target FROM public.hms_identity_resources WHERE resource_key=NEW.resource_key;
 IF target IS NULL THEN RAISE EXCEPTION 'Unknown identity resource' USING ERRCODE='23503'; END IF;
 EXECUTE format('SELECT public_id FROM %s WHERE id=$1',target) INTO value USING NEW.legacy_id;
 IF value IS DISTINCT FROM NEW.public_id THEN RAISE EXCEPTION 'Legacy identity must match its actual resource' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_identity_map_check BEFORE INSERT ON hms_legacy_identity_map FOR EACH ROW EXECUTE FUNCTION hms_identity_map_check();
CREATE FUNCTION hms_capture_legacy_identity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE kind text; BEGIN
 SELECT resource_key INTO kind FROM public.hms_identity_resources WHERE resource_table=TG_RELID;
 IF kind IS NULL THEN RAISE EXCEPTION 'Resource identity registry is missing'; END IF;
 INSERT INTO public.hms_legacy_identity_map(resource_key,legacy_id,public_id) VALUES(kind,NEW.id,NEW.public_id);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION hms_capture_legacy_identity() FROM PUBLIC;
CREATE FUNCTION hms_guard_public_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.public_id IS DISTINCT FROM OLD.public_id THEN RAISE EXCEPTION 'Public clinical identity is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('principal','hms_users'),('patient','hms_patients'),('practitioner','hms_practitioners'),
 ('department','hms_departments'),('doctor_record','hms_doctors'),('encounter','hms_encounters'),
 ('admission','hms_admissions'),('ward','hms_wards'),('bed','hms_beds'),('appointment','hms_appointments'),('token','hms_tokens'),
 ('clinical_document','hms_clinical_documents'),('diagnosis','hms_diagnoses'),('lab_order','hms_investigation_orders'),
 ('lab_item','hms_investigation_order_items'),('vital','hms_vitals'),('patient_document','hms_patient_documents'),
 ('medicine_legacy','hms_medicines'),('batch','hms_medicine_batches'),('supplier','hms_suppliers'),
 ('prescription_legacy','hms_prescriptions'),('prescription_item_legacy','hms_prescription_items'),
 ('bill_legacy','hms_bills'),('bill_item_legacy','hms_bill_items'),('payment_legacy','hms_payments')
 ) entries(kind,tab) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname='public_id' AND NOT a.attisdropped) THEN
   EXECUTE format('ALTER TABLE %I ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE',r.tab);
  END IF;
  INSERT INTO hms_identity_resources(resource_key,resource_table,facility_owned)
   VALUES(r.kind,to_regclass('public.'||r.tab),EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.tab) AND a.attname='facility_id' AND NOT a.attisdropped));
  EXECUTE format('INSERT INTO hms_legacy_identity_map(resource_key,legacy_id,public_id) SELECT %L,id,public_id FROM %I',r.kind,r.tab);
  EXECUTE format('CREATE TRIGGER trg_capture_public_identity AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION hms_capture_legacy_identity()',r.tab);
  EXECUTE format('CREATE TRIGGER trg_guard_public_identity BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION hms_guard_public_identity()',r.tab);
 END LOOP;
END $$;

-- The public API's aggregate version includes state changes that older
-- content-only counters did not include. Old services keep their own counters;
-- adapters validate this version and translate under the same row lock.
CREATE FUNCTION hms_bump_api_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF to_jsonb(NEW)-'api_version' IS DISTINCT FROM to_jsonb(OLD)-'api_version' THEN NEW.api_version:=OLD.api_version+1;
 ELSE NEW.api_version:=OLD.api_version; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['hms_patients','hms_encounters','hms_admissions','hms_appointments','hms_tokens','hms_beds','hms_clinical_documents',
  'hms_med_orders','hms_med_requisitions','hms_med_handovers','hms_med_discrepancies','hms_med_tasks',
  'hms_lab_specimens','hms_investigation_orders','hms_investigation_order_items','hms_lab_critical_tasks','hms_lab_review_tasks',
  'hms_billing_accounts','hms_invoices','hms_invoice_notes','hms_payment_intents','hms_patient_funds','hms_refunds',
  'hms_preauthorizations','hms_claims','hms_denials','hms_cash_sessions','hms_recon_exceptions'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN api_version integer NOT NULL DEFAULT 1 CHECK(api_version>0)',tab);
  EXECUTE format('CREATE TRIGGER trg_api_version BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION hms_bump_api_version()',tab);
 END LOOP;
END $$;
