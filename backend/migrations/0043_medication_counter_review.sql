-- Historical sales remain labelled unassessed. New counter sales record the
-- explicit formulary permission and pharmacist review used at that time.
ALTER TABLE hms_otc_sales ADD COLUMN clinical_review JSONB NOT NULL
 DEFAULT '{"state":"LEGACY_NOT_ASSESSED"}' CHECK(jsonb_typeof(clinical_review)='object');
