-- Stable external identities, scoped duplicate contracts and fenced attempts.
ALTER TABLE hms_interface_messages
 ADD COLUMN attempt_series integer NOT NULL DEFAULT 0 CHECK(attempt_series>=0),
 ADD COLUMN retry_of uuid REFERENCES hms_interface_messages(id),
 ADD COLUMN delivery_key uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD COLUMN delivery_epoch integer,
 ADD COLUMN delivery_cluster_id uuid,
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_until timestamptz,
 ADD COLUMN lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
 ADD COLUMN caller_owned boolean NOT NULL DEFAULT false,
 ADD COLUMN delivery_hold boolean NOT NULL DEFAULT false;
ALTER TABLE hms_interface_messages DISABLE TRIGGER trg_interface_message_guard;
UPDATE hms_interface_messages m SET delivery_epoch=f.epoch,delivery_cluster_id=f.cluster_id,
 caller_owned=(m.direction='out' AND m.system='abdm-abha'),
 delivery_hold=(m.direction='out' AND m.status='Pending' AND m.system<>'abdm-abha')
 FROM hms_writer_fence f WHERE f.singleton;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE hms_interface_messages ENABLE TRIGGER trg_interface_message_guard;
UPDATE hms_interface_messages SET next_attempt_at='infinity',last_error=coalesce(last_error,'Migration review: previous external outcome is not proven') WHERE delivery_hold;
ALTER TABLE hms_interface_messages ALTER COLUMN delivery_epoch SET NOT NULL;
ALTER TABLE hms_interface_messages ALTER COLUMN delivery_cluster_id SET NOT NULL;
ALTER TABLE hms_interface_messages ADD CONSTRAINT interface_delivery_epoch_positive CHECK(delivery_epoch>0);
ALTER TABLE hms_interface_messages ADD CONSTRAINT interface_inbound_series CHECK(direction='out' OR attempt_series=0);
ALTER TABLE hms_interface_messages ADD CONSTRAINT interface_lease_pair CHECK((lease_token IS NULL)=(lease_until IS NULL));
ALTER TABLE hms_interface_messages DROP CONSTRAINT hms_interface_messages_system_direction_external_id_key;
CREATE UNIQUE INDEX interface_message_series_identity ON hms_interface_messages(facility_id,system,direction,external_id,attempt_series);
CREATE UNIQUE INDEX interface_retry_successor ON hms_interface_messages(retry_of) WHERE retry_of IS NOT NULL;
CREATE UNIQUE INDEX interface_message_facility_identity ON hms_interface_messages(id,facility_id);
ALTER TABLE hms_interface_messages ADD CONSTRAINT interface_retry_facility FOREIGN KEY(retry_of,facility_id)
 REFERENCES hms_interface_messages(id,facility_id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION hms_interface_fingerprint(text,text,text,text,text,text,jsonb,text,integer,uuid)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(jsonb_build_array($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)::text,'UTF8')),'hex')
$$;
ALTER TABLE hms_interface_messages ADD COLUMN request_fingerprint text GENERATED ALWAYS AS
 (hms_interface_fingerprint(direction,system,message_type,contract_version,correlation_id,endpoint,payload,raw,CASE WHEN direction='in' THEN NULL ELSE patient_id END,facility_id)) STORED;

CREATE TABLE hms_interface_attempt_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid NOT NULL,facility_id uuid NOT NULL REFERENCES hms_facilities(id),
 attempt_number integer NOT NULL CHECK(attempt_number>0),lease_token uuid NOT NULL,
 phase text NOT NULL CHECK(phase IN ('CLAIMED','DELIVERED','FAILED','RETRY_WAIT','HELD','STALE')),
 code text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(message_id,facility_id) REFERENCES hms_interface_messages(id,facility_id)
);
CREATE INDEX interface_attempt_message ON hms_interface_attempt_events(message_id,recorded_at);
CREATE INDEX interface_attempt_facility ON hms_interface_attempt_events(facility_id,recorded_at);
CREATE TABLE hms_interface_delivery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),message_id uuid NOT NULL,facility_id uuid NOT NULL REFERENCES hms_facilities(id),
 decision text NOT NULL CHECK(decision IN ('CONFIRMED_DELIVERED','CONFIRMED_NOT_DELIVERED','SUPPRESS','RETRY_FAILED')),
 actor_user_id integer NOT NULL REFERENCES hms_users(id),reason text NOT NULL CHECK(length(btrim(reason))>=10),
 evidence_ref text NOT NULL CHECK(length(btrim(evidence_ref))>=5),recorded_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(message_id,facility_id) REFERENCES hms_interface_messages(id,facility_id)
);
CREATE INDEX interface_review_message ON hms_interface_delivery_reviews(message_id,recorded_at);
CREATE INDEX interface_review_facility ON hms_interface_delivery_reviews(facility_id,recorded_at);
CREATE INDEX interface_review_actor ON hms_interface_delivery_reviews(actor_user_id);
CREATE FUNCTION hms_interface_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Interface attempt and reconciliation evidence is append-only';
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['hms_interface_attempt_events','hms_interface_delivery_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit.capture_change()',tab,tab);
  EXECUTE format('CREATE TRIGGER trg_history_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hms_interface_history_immutable()',tab);
  EXECUTE format('CREATE TRIGGER trg_facility_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION hms_guard_facility_write()',tab);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY facility_scope ON %I USING(hms_authorized_facility(facility_id)) WITH CHECK(hms_authorized_facility(facility_id))',tab);
  INSERT INTO hms_facility_backfills(facility_id,table_name,row_count,basis)
   VALUES(hms_initial_facility(),tab,0,'New operational evidence; every insert requires an explicit facility');
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION interface_message_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Interface messages are retained' USING ERRCODE='42501'; END IF;
 IF (NEW.id,NEW.direction,NEW.system,NEW.message_type,NEW.contract_version,NEW.external_id,NEW.raw,NEW.created_at,
     NEW.payload,NEW.correlation_id,NEW.endpoint,NEW.facility_id,NEW.delivery_key,NEW.retry_of,NEW.attempt_series,NEW.caller_owned)
 IS DISTINCT FROM
    (OLD.id,OLD.direction,OLD.system,OLD.message_type,OLD.contract_version,OLD.external_id,OLD.raw,OLD.created_at,
     OLD.payload,OLD.correlation_id,OLD.endpoint,OLD.facility_id,OLD.delivery_key,OLD.retry_of,OLD.attempt_series,OLD.caller_owned)
 THEN RAISE EXCEPTION 'An interface delivery contract cannot be rewritten' USING ERRCODE='42501'; END IF;
 IF OLD.finished_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'A finished interface message is closed' USING ERRCODE='42501';
 END IF;
 IF OLD.patient_id IS NOT NULL AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
  RAISE EXCEPTION 'An interface message cannot be reassigned to another patient' USING ERRCODE='42501';
 END IF;
 IF NEW.lease_generation<OLD.lease_generation THEN RAISE EXCEPTION 'Interface lease generations never decrease' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
