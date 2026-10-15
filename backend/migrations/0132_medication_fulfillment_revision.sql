-- Fulfillment changes invalidate public aggregate snapshots while preserving
-- the legacy content/transition revision used by existing clinical screens.
ALTER TABLE hms_med_orders ADD COLUMN fulfillment_revision bigint NOT NULL DEFAULT 0 CHECK(fulfillment_revision>=0);
UPDATE hms_med_orders o SET fulfillment_revision=
 (SELECT count(*) FROM hms_med_dispenses d JOIN hms_med_order_versions v ON v.id=d.version_id WHERE v.order_id=o.id)
 +(SELECT count(*) FROM hms_med_returns r JOIN hms_med_dispense_lines l ON l.id=r.dispense_line_id
   JOIN hms_med_order_versions v ON v.id=l.version_id WHERE v.order_id=o.id);
