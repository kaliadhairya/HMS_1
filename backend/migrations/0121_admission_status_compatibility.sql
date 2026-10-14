-- Equivalent explicit alternatives avoid PostgreSQL 16/18's differing
-- array-cast deparsing while retaining the same admitted/discharged invariant.
ALTER TABLE hms_admissions DROP CONSTRAINT ck_admissions_status;
ALTER TABLE hms_admissions ADD CONSTRAINT ck_admissions_status CHECK(status='Active' OR status='Discharged');
