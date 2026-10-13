-- A legacy placeholder is not proof of a manufacturer lot or expiry source.
-- Retain documented receipt evidence only when the lot, medicine and expiry
-- match a stored purchase line; otherwise require explicit pharmacy review.
WITH evidence AS (
 SELECT DISTINCT ON (b.id) b.id,po.id AS purchase_order_id,po.invoice_number,
   pi.batch_number,pi.expiry_date,po.created_by
 FROM hms_medicine_batches b JOIN hms_purchase_items pi
   ON pi.medicine_id=b.medicine_id AND pi.batch_number=b.batch_number AND pi.expiry_date=b.expiry_date
 JOIN hms_purchase_orders po ON po.id=pi.purchase_order_id
 WHERE nullif(trim(po.invoice_number),'') IS NOT NULL
 ORDER BY b.id,po.id,pi.id
)
UPDATE hms_medicine_batches b SET provenance=jsonb_build_object(
 'source','documented legacy purchase line','document_ref',e.invoice_number,
 'purchase_order_id',e.purchase_order_id,'manufacturer_lot',e.batch_number,
 'expiry_date',e.expiry_date,'recorded_by_user_id',e.created_by)
FROM evidence e WHERE b.id=e.id AND nullif(trim(b.provenance->>'document_ref'),'') IS NULL;
UPDATE hms_medicine_batches SET lot_status='QUARANTINED',
 provenance=provenance||jsonb_build_object('review_required','Manufacturer lot and expiry provenance not established')
 WHERE lot_status='AVAILABLE' AND nullif(trim(provenance->>'document_ref'),'') IS NULL;
ALTER TABLE hms_medicine_batches ALTER COLUMN lot_status SET DEFAULT 'QUARANTINED';
ALTER TABLE hms_medicine_batches ALTER COLUMN provenance SET DEFAULT '{"source":"unverified entry; pharmacist provenance review required"}';
