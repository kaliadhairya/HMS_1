-- Newly entered legacy catalogue rows also require explicit clinical review.
-- This trigger does not approve composition, route or base-unit conversion.
CREATE FUNCTION med_legacy_catalogue_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product uuid; parsed_strength numeric;
BEGIN
 IF current_setting('med.catalogue_create',true)='true' THEN RETURN NULL; END IF;
 IF NEW.strength ~ '^[0-9]+(\.[0-9]+)?$' THEN
   parsed_strength:=NEW.strength::numeric;
   IF parsed_strength<=0 OR parsed_strength>=1000000000000 OR parsed_strength<>round(parsed_strength,6) THEN parsed_strength:=NULL; END IF;
 END IF;
 INSERT INTO hms_med_products(legacy_medicine_id,code,name,strength,strength_unit,dose_form,pack_unit,controlled,status,provenance,effective_at,created_by_user_id)
 VALUES(NEW.id,'legacy:'||NEW.id,coalesce(nullif(trim(NEW.generic_name),''),'Legacy medicine '||NEW.id),parsed_strength,
 NEW.strength_unit,coalesce(nullif(trim(NEW.formulation),''),'UNKNOWN'),NEW.unit_of_sale,coalesce(NEW.is_controlled=1,false),'DRAFT',
 'Legacy catalogue entry: explicit composition, route and unit review required',now(),NULLIF(current_setting('hms.actor_user_id',true),'')::integer)
 RETURNING id INTO product;
 INSERT INTO hms_med_reconciliation(legacy_medicine_id,product_id,reason) VALUES(NEW.id,product,'Legacy identity requires approved composition, route and conversion');
 RETURN NULL;
END $$;
CREATE TRIGGER trg_med_legacy_catalogue_draft AFTER INSERT ON hms_medicines FOR EACH ROW EXECUTE FUNCTION med_legacy_catalogue_draft();
