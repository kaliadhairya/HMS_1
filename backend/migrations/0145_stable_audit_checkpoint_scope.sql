-- Stable hospital audit identity survives database renaming, PITR and restore.
-- A PostgreSQL database name is an operational location, not an audit identity.
CREATE TABLE audit.checkpoint_identity (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 scope_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO audit.checkpoint_identity DEFAULT VALUES;
CREATE FUNCTION audit.checkpoint_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='The hospital audit identity is immutable';
END $$;
CREATE TRIGGER trg_checkpoint_identity_immutable BEFORE UPDATE OR DELETE ON audit.checkpoint_identity
 FOR EACH ROW EXECUTE FUNCTION audit.checkpoint_identity_immutable();
CREATE TRIGGER trg_checkpoint_identity_audit AFTER INSERT OR UPDATE OR DELETE ON audit.checkpoint_identity
 FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
