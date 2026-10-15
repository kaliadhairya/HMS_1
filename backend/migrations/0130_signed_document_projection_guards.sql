-- Signed versions remain the authority; a presentation row cannot silently
-- replace their content or remove an existing signature link.
CREATE FUNCTION hms_signed_document_projection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF EXISTS(SELECT 1 FROM hms_document_signatures WHERE document_id=OLD.id) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signed documents are retained, not deleted';
  END IF;
  RETURN OLD;
 END IF;
 IF (NEW.author_user_id,NEW.doc_type,NEW.encounter_id,NEW.admission_id)
    IS DISTINCT FROM (OLD.author_user_id,OLD.doc_type,OLD.encounter_id,OLD.admission_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Clinical author, document type and care context are immutable';
 END IF;
 IF OLD.signed_version IS NOT NULL AND (NEW.signed_version IS NULL OR NEW.signed_version<OLD.signed_version) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='An existing signed version cannot be removed or rewound';
 END IF;
 IF OLD.state='signed' THEN
  IF NEW.draft_content IS DISTINCT FROM OLD.draft_content THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signed content is immutable; start a linked amendment before editing';
  END IF;
  IF NEW.state='draft' THEN
   IF NEW.draft_version<>OLD.draft_version+1 OR NEW.signed_version IS DISTINCT FROM OLD.signed_version
     OR NEW.amendment_reason IS NULL OR length(btrim(NEW.amendment_reason)) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='An amendment requires a new draft revision and a recorded reason';
   END IF;
  ELSIF (NEW.draft_version,NEW.signed_version,NEW.amendment_reason)
    IS DISTINCT FROM (OLD.draft_version,OLD.signed_version,OLD.amendment_reason) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Signed document metadata requires a linked amendment';
  END IF;
 END IF;
 IF NEW.state='signed' AND NOT EXISTS(SELECT 1 FROM hms_document_signatures s
   WHERE s.document_id=NEW.id AND s.version=NEW.signed_version AND s.content=NEW.draft_content
    AND s.signed_by=NEW.author_user_id AND s.facility_id=NEW.facility_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='The signed document must match its exact author, facility and immutable signature';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trg_signed_document_projection_guard BEFORE UPDATE OR DELETE ON hms_clinical_documents
 FOR EACH ROW EXECUTE FUNCTION hms_signed_document_projection_guard();
