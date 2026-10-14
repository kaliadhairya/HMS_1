ALTER TABLE hms_practitioner_credentials DROP CONSTRAINT hms_practitioner_credentials_kind_check;
ALTER TABLE hms_practitioner_credentials ADD CONSTRAINT ck_professional_credential_kind
 CHECK(kind IN ('medical_registration','specialist_registration','nursing_registration','pharmacy_registration','laboratory_qualification','other'));
ALTER TABLE hms_practitioner_credentials ADD COLUMN verification_evidence jsonb
 CHECK(verification_evidence IS NULL OR jsonb_typeof(verification_evidence)='object');
-- Earlier "verified" rows without recorded verification evidence require
-- reviewed re-verification. Nothing fabricates a license or its evidence.
CREATE FUNCTION hms_current_professional_credential(login_user_id integer,clinical_role text) RETURNS boolean
 LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM hms_practitioners p JOIN hms_practitioner_credentials c ON c.practitioner_id=p.id
 WHERE p.user_id=login_user_id AND c.ended_by IS NULL AND c.verified_at IS NOT NULL AND c.verified_at<=now()
 AND c.verified_by<>p.user_id AND c.verified_by IS DISTINCT FROM c.created_by
 AND length(btrim(coalesce(c.verification_evidence->>'reference','')))>=3
 AND length(btrim(coalesce(c.verification_evidence->>'reason','')))>=10
 AND c.valid_from<=hms_service_today() AND (c.valid_to IS NULL OR c.valid_to>=hms_service_today())
 AND CASE clinical_role WHEN 'doctor' THEN c.kind IN ('medical_registration','specialist_registration')
 WHEN 'nurse' THEN c.kind='nursing_registration' WHEN 'pharmacist' THEN c.kind='pharmacy_registration'
 WHEN 'lab_technician' THEN c.kind='laboratory_qualification' ELSE false END)
$$;
CREATE OR REPLACE FUNCTION practitioner_credentials_expired(login_user_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT hms_current_professional_credential(login_user_id,'doctor')
$$;
