-- Preserve the initial version's declared comparison semantics on existing
-- rows; new approval commands require explicit comparators from their source.
ALTER TABLE hms_lab_reference_intervals ADD COLUMN lower_inclusive boolean NOT NULL DEFAULT true, ADD COLUMN upper_inclusive boolean NOT NULL DEFAULT true;
ALTER TABLE hms_lab_critical_policies ADD COLUMN lower_inclusive boolean NOT NULL DEFAULT false, ADD COLUMN upper_inclusive boolean NOT NULL DEFAULT false;
ALTER TABLE hms_lab_reference_intervals ALTER COLUMN lower_inclusive DROP DEFAULT, ALTER COLUMN upper_inclusive DROP DEFAULT;
ALTER TABLE hms_lab_critical_policies ALTER COLUMN lower_inclusive DROP DEFAULT, ALTER COLUMN upper_inclusive DROP DEFAULT;
