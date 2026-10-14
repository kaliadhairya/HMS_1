-- A future-dated role must be revocable before its start date. Preserve the
-- original grant and record revocation authority/rationale separately.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='hms_practitioner_roles'::regclass
  AND contype='c' AND pg_get_constraintdef(oid) LIKE '%revoked_at%' AND pg_get_constraintdef(oid) LIKE '%valid_from%'
 LOOP EXECUTE format('ALTER TABLE hms_practitioner_roles DROP CONSTRAINT %I',r.conname); END LOOP;
END $$;
ALTER TABLE hms_practitioner_roles ADD COLUMN revoked_by_user_id integer REFERENCES hms_users(id);
ALTER TABLE hms_practitioner_roles ADD COLUMN revocation_reason text CHECK(revocation_reason IS NULL OR length(btrim(revocation_reason))>=10);
ALTER TABLE hms_clinical_privileges ADD COLUMN revoked_by_user_id integer REFERENCES hms_users(id);
ALTER TABLE hms_clinical_privileges ADD COLUMN revocation_reason text CHECK(revocation_reason IS NULL OR length(btrim(revocation_reason))>=10);
CREATE INDEX ix_professional_role_revoker ON hms_practitioner_roles(revoked_by_user_id);
CREATE INDEX ix_clinical_privilege_revoker ON hms_clinical_privileges(revoked_by_user_id);
