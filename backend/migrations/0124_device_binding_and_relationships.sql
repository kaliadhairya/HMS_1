-- Include compound identity relationships in the facility invariant.
DO $$ DECLARE r record; stable_name text; BEGIN
 FOR r IN SELECT c.conrelid::regclass child,c.confrelid::regclass parent,
  (SELECT string_agg(a.attname,',' ORDER BY k.position) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) child_names,
  (SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.position) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) child_keys,
  (SELECT string_agg(a.attname,',' ORDER BY k.position) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) parent_names,
  (SELECT string_agg(quote_ident(a.attname),',' ORDER BY k.position) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,position) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) parent_keys
 FROM pg_constraint c WHERE c.contype='f'
 AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey) AND a.attname='facility_id')
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.conrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.confrelid AND a.attname='facility_id' AND NOT a.attisdropped)
 LOOP
  stable_name:='fk_fac_'||substr(md5(r.child::text||':'||r.parent::text||':'||r.child_names||',facility_id'),1,24);
  IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=r.child AND c.conname=stable_name) THEN
   EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %s(%s,facility_id)','ux_fac_'||substr(md5(r.parent::text||r.parent_names),1,24),r.parent,r.parent_keys);
   EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY(%s,facility_id) REFERENCES %s(%s,facility_id) DEFERRABLE INITIALLY DEFERRED',r.child,stable_name,r.child_keys,r.parent,r.parent_keys);
  END IF;
 END LOOP;
END $$;

-- Device ingress starts without a human session. This narrowly typed lookup
-- authenticates the exact registered contract before the runtime obtains its
-- service/facility context. It cannot execute arbitrary SQL or return clinical
-- rows. The key digest never replaces an allowlisted transport peer check.
CREATE FUNCTION hms_device_ingress_binding(the_system text,key_digest text,peer inet) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE c public.hms_device_contracts; BEGIN
 SELECT * INTO c FROM public.hms_device_contracts WHERE system=the_system AND status='Active' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('failure_code','NO_CONTRACT'); END IF;
 IF key_digest IS NOT NULL AND c.api_key_hash IS DISTINCT FROM key_digest THEN RETURN jsonb_build_object('failure_code','BAD_KEY'); END IF;
 IF peer IS NOT NULL AND cardinality(c.allowed_hosts)>0 AND NOT peer=ANY(c.allowed_hosts::inet[]) THEN RETURN jsonb_build_object('failure_code','HOST_REFUSED'); END IF;
 IF key_digest IS NULL AND (peer IS NULL OR c.protocol<>'hl7v2' OR c.mllp_port IS NULL OR cardinality(c.allowed_hosts)=0) THEN
  RETURN jsonb_build_object('failure_code','DEVICE_AUTH_REQUIRED');
 END IF;
 IF c.service_user_id IS NULL THEN RETURN jsonb_build_object('failure_code','DEVICE_SERVICE_IDENTITY_REQUIRED'); END IF;
 RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION hms_device_ingress_binding(text,text,inet) FROM PUBLIC;
CREATE FUNCTION hms_device_listener_registry() RETURNS TABLE(id uuid,system text,mllp_port integer)
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT c.id,c.system,c.mllp_port FROM public.hms_device_contracts c
 JOIN public.hms_facilities f ON f.id=c.facility_id
 WHERE c.status='Active' AND c.protocol='hl7v2' AND c.mllp_port IS NOT NULL AND cardinality(c.allowed_hosts)>0
 AND c.service_user_id IS NOT NULL AND f.status='ACTIVE'
$$;
REVOKE ALL ON FUNCTION hms_device_listener_registry() FROM PUBLIC;
