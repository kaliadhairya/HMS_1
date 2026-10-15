const C = require("./medicationCommon");
const {
  q,
  one,
  check,
  text,
  id,
  integer,
  decimal,
  instant,
  event,
  digest,
  order,
  active,
  expected,
  userRole,
} = C;
const witnessDetails = (b) =>
  Object.fromEntries(Object.entries(b).filter(([k]) => k !== "witness_id"));
async function createWitness(b, u, tx) {
  check(
    [
      "SUPPLY",
      "ADMINISTRATION",
      "RETURN",
      "WASTAGE",
      "TRANSFER",
      "COUNT",
    ].includes(b.action),
    "INVALID_WITNESS_ACTION",
    "Choose a supported witness action.",
  );
  const performer = await userRole(
    b.performer_user_id,
    ["doctor", "nurse", "pharmacist"],
    tx,
  );
  check(
    performer.id !== u.id,
    "INDEPENDENT_WITNESS_REQUIRED",
    "The performer cannot witness their own action.",
  );
  check(
    b.details && typeof b.details === "object" && !Array.isArray(b.details),
    "WITNESS_DETAILS_REQUIRED",
    "Review the exact proposed action details.",
  );
  return one(
    `INSERT INTO hms_med_witnesses(action,subject_id,details_hash,witness_user_id,performer_user_id,reason,expires_at)
 VALUES(:action,:subject,:hash,:witness,:performer,:reason,now()+interval '5 minutes') RETURNING *`,
    {
      action: b.action,
      subject: text(b.subject_id, "Witness subject"),
      hash: digest(witnessDetails(b.details)),
      witness: u.id,
      performer: performer.id,
      reason: text(b.reason, "Witness attestation"),
    },
    tx,
  );
}
async function requestWitness(b, u, tx) {
  const recipient = await userRole(
    b.requested_witness_user_id,
    ["doctor", "nurse", "pharmacist"],
    tx,
  );
  check(
    recipient.id !== u.id,
    "INDEPENDENT_WITNESS_REQUIRED",
    "Select an independent witness.",
  );
  check(
    [
      "SUPPLY",
      "ADMINISTRATION",
      "RETURN",
      "WASTAGE",
      "TRANSFER",
      "COUNT",
    ].includes(b.action) &&
      b.details &&
      typeof b.details === "object" &&
      !Array.isArray(b.details),
    "INVALID_WITNESS_REQUEST",
    "Provide a supported action and exact details.",
  );
  return one(
    `INSERT INTO hms_med_witness_requests(action,subject_id,details,performer_user_id,requested_witness_user_id)
 VALUES(:action,:subject,CAST(:details AS jsonb),:user,:recipient) RETURNING *`,
    {
      action: b.action,
      subject: text(b.subject_id, "Subject"),
      details: JSON.stringify(witnessDetails(b.details)),
      user: u.id,
      recipient: recipient.id,
    },
    tx,
  );
}
async function attestRequest(rid, b, u, tx) {
  const r = await one(
    "SELECT * FROM hms_med_witness_requests WHERE id=:id FOR UPDATE",
    { id: id(rid) },
    tx,
  );
  check(
    r && r.state === "PENDING" && r.requested_witness_user_id === u.id,
    "WITNESS_RECIPIENT_REQUIRED",
    "Only the requested independent witness can attest this pending action.",
    403,
  );
  const w = await createWitness(
    {
      action: r.action,
      subject_id: r.subject_id,
      performer_user_id: r.performer_user_id,
      details: r.details,
      reason: b.reason,
    },
    u,
    tx,
  );
  return one(
    "UPDATE hms_med_witness_requests SET state='ATTESTED',witness_id=:w WHERE id=:id RETURNING *",
    { w: w.id, id: r.id },
    tx,
  );
}
async function witness(action, subject, b, u, tx) {
  check(
    b.witness_id,
    "WITNESS_REQUIRED",
    "An independently authenticated witness must attest this exact action.",
    409,
  );
  const w = await one(
    "SELECT * FROM hms_med_witnesses WHERE id=:id FOR UPDATE",
    { id: id(b.witness_id, "Witness") },
    tx,
  );
  check(
    w &&
      w.action === action &&
      w.subject_id === String(subject) &&
      w.details_hash === digest(witnessDetails(b)) &&
      w.performer_user_id === u.id &&
      w.witness_user_id !== u.id &&
      !w.consumed_at &&
      C.epoch(w.expires_at) > Date.now(),
    "INVALID_WITNESS",
    "Witness attestation is expired, consumed or does not match this action.",
    409,
  );
  await userRole(w.witness_user_id, ["doctor", "nurse", "pharmacist"], tx);
  await q(
    "UPDATE hms_med_witnesses SET consumed_at=now() WHERE id=:id",
    { id: w.id },
    tx,
  );
  return w.id;
}
async function register(
  p,
  batch,
  location,
  action,
  quantity,
  source,
  u,
  w,
  tx,
) {
  if (!p.controlled) return;
  check(
    w,
    "WITNESS_REQUIRED",
    "Controlled-drug events require a witness.",
    409,
  );
  await q(
    `INSERT INTO hms_med_controlled_register(product_id,batch_id,location_id,action,quantity,unit,source_id,performer_user_id,witness_id)
 VALUES(:product,:batch,:location,:action,:quantity,:unit,:source,:user,:witness)`,
    {
      product: p.id,
      batch,
      location,
      action,
      quantity,
      unit: p.base_unit,
      source,
      user: u.id,
      witness: w,
    },
    tx,
  );
}
async function product(pid, tx) {
  const p = await one(
    "SELECT * FROM hms_med_products WHERE id=:id FOR SHARE",
    { id: id(pid, "Product") },
    tx,
  );
  check(
    p &&
      p.status === "APPROVED" &&
      !(await one(
        "SELECT 1 FROM hms_med_product_retirements WHERE product_id=:id",
        { id: p.id },
        tx,
      )) &&
      C.epoch(p.effective_at) <= Date.now(),
    "PRODUCT_NOT_APPROVED",
    "An effective approved product is required.",
  );
  return p;
}
async function location(lid, tx, allowTransit = false) {
  const l = await one(
    "SELECT * FROM hms_med_locations WHERE id=:id AND facility_id=:facility",
    { id: id(lid, "Location"),facility:require('./medicationAccess.cts').facility() },
    tx,
  );
  check(
    l && (allowTransit || ["STORE", "WARD"].includes(l.kind)),
    "INVALID_LOCATION",
    "Choose a stock-holding location.",
  );
  return l;
}
async function createLocation(b, u, tx) {
  return one(
    "INSERT INTO hms_med_locations(code,name,kind,ward_id,created_by_user_id,timezone) VALUES(:code,:name,:kind,:ward,:user,:timezone) RETURNING *",
    {
      code: text(b.code, "Location code"),
      name: text(b.name, "Location name"),
      kind: b.kind,
      timezone: b.timezone || "Asia/Kolkata",
      ward: b.ward_id ? integer(b.ward_id, "Ward") : null,
      user: u.id,
    },
    tx,
  );
}
async function move(batch, loc, delta, sourceType, sourceId, reason, u, tx) {
  if (loc.code === "MAIN") {
    await q(
      "SELECT set_config('med.source_type',:type,true),set_config('med.source_id',:source,true),set_config('med.reason',:reason,true)",
      { type: sourceType, source: String(sourceId), reason },
      tx,
    );
    const updated = await one(
      "UPDATE hms_medicine_batches SET quantity=quantity+CAST(:delta AS numeric) WHERE id=:batch AND quantity+CAST(:delta AS numeric)>=0 RETURNING quantity",
      { batch, delta },
      tx,
    );
    check(updated, "INSUFFICIENT_STOCK", "Stock is no longer sufficient.", 409);
    await q(
      `INSERT INTO hms_stock_ledger(id,medicine_id,batch_id,transaction_type,quantity,reference_type,performed_by)
 SELECT nextval('hms_stock_led_seq'),medicine_id,id,CASE WHEN CAST(:delta AS numeric)>0 THEN 'IN' ELSE 'OUT' END,abs(CAST(:delta AS numeric)),:type,:user FROM hms_medicine_batches WHERE id=:batch`,
      { batch, delta, type: sourceType.slice(0, 30), user: u.id },
      tx,
    );
    return updated.quantity;
  }
  await q(
    "INSERT INTO hms_med_balances(batch_id,location_id,quantity) VALUES(:batch,:loc,0) ON CONFLICT DO NOTHING",
    { batch, loc: loc.id },
    tx,
  );
  const updated = await one(
    "UPDATE hms_med_balances SET quantity=quantity+CAST(:delta AS numeric) WHERE batch_id=:batch AND location_id=:loc AND quantity+CAST(:delta AS numeric)>=0 RETURNING quantity",
    { batch, loc: loc.id, delta },
    tx,
  );
  check(updated, "INSUFFICIENT_STOCK", "Location stock is insufficient.", 409);
  await q(
    "INSERT INTO hms_med_movements(batch_id,location_id,delta,source_type,source_id,actor_user_id,reason,balance_after) VALUES(:batch,:loc,:delta,:type,:source,:user,:reason,:balance)",
    {
      batch,
      loc: loc.id,
      delta,
      type: sourceType,
      source: String(sourceId),
      user: u.id,
      reason,
      balance: updated.quantity,
    },
    tx,
  );
  return updated.quantity;
}
async function receive(b, u, tx) {
  const supplier = integer(b.supplier_id, "Supplier"),
    invoice = text(b.invoice_ref, "Supplier invoice");
  check(
    Array.isArray(b.lines) && b.lines.length > 0 && b.lines.length <= 100,
    "RECEIPT_LINES_REQUIRED",
    "Provide 1–100 receipt lines.",
  );
  check(
    await one(
      "SELECT id FROM hms_suppliers WHERE id=:id AND is_active=1",
      { id: supplier },
      tx,
    ),
    "INVALID_SUPPLIER",
    "Select an active supplier.",
  );
  await q(
    "SELECT pg_advisory_xact_lock(727284,hashtext(:key))",
    { key: `${supplier}:${invoice}` },
    tx,
  );
  const prior = await one(
    "SELECT * FROM hms_med_receipts WHERE supplier_id=:supplier AND invoice_ref=:invoice",
    { supplier, invoice },
    tx,
  );
  if (prior) {
    check(
      prior.request_hash === digest(b),
      "DUPLICATE_RECEIPT_CONFLICT",
      "This invoice already has a different receipt.",
      409,
    );
    return { ...prior, replayed: true };
  }
  const receipt = await one(
    "INSERT INTO hms_med_receipts(supplier_id,invoice_ref,request_hash,received_by_user_id) VALUES(:supplier,:invoice,:hash,:user) RETURNING *",
    { supplier, invoice, hash: digest(b), user: u.id },
    tx,
  );
  const resolved = await Promise.all(
    b.lines.map(async (line) => ({
      line,
      p: await product(line.product_id, tx),
    })),
  );
  resolved.sort(
    (a, b) =>
      a.p.legacy_medicine_id - b.p.legacy_medicine_id ||
      String(a.line.manufacturer_lot).localeCompare(
        String(b.line.manufacturer_lot),
      ),
  );
  const sorted = resolved.map((x) => x.line);
  const mainLocation = await one(
    "SELECT * FROM hms_med_locations WHERE code='MAIN' AND facility_id=hms_current_facility()",
    {},
    tx,
  );
  const today = await one(
    "SELECT to_char((now() AT TIME ZONE :timezone)::date,'YYYY-MM-DD') AS day",
    { timezone: mainLocation.timezone },
    tx,
  );
  const seen = new Set();
  for (const line of sorted) {
    const p = await product(line.product_id, tx),
      lot = text(line.manufacturer_lot, "Manufacturer lot");
    const key = p.id + ":" + lot;
    check(!seen.has(key), "DUPLICATE_RECEIPT_LINE", "A lot is listed twice.");
    seen.add(key);
    const originalQuantity = decimal(line.quantity, "Receipt quantity");
    const quantityUnit = line.quantity_unit || p.base_unit;
    check(
      [p.base_unit, p.pack_unit].includes(quantityUnit),
      "RECEIPT_UNIT_MISMATCH",
      "Receipt unit must match an approved base or pack unit.",
    );
    const converted = await one(
      "SELECT (CAST(:quantity AS numeric)*CAST(:conversion AS numeric))::text AS quantity",
      {
        quantity: originalQuantity,
        conversion: quantityUnit === p.base_unit ? "1" : p.pack_conversion,
      },
      tx,
    );
    const quantity = decimal(
        converted.quantity,
        "Converted base quantity",
        p.quantity_precision,
      ),
      rate = decimal(line.purchase_rate, "Purchase rate", 6, true),
      mrp = decimal(line.mrp, "MRP", 6, true);
    check(
      /^\d{4}-\d{2}-\d{2}$/.test(String(line.expiry_date)) &&
        !Number.isNaN(C.epoch(line.expiry_date + "T00:00:00Z")) &&
        new Date(line.expiry_date + "T00:00:00Z").toISOString().slice(0, 10) ===
          line.expiry_date,
      "INVALID_EXPIRY",
      "Supply an actual expiry date.",
    );
    check(
      line.expiry_date >= today.day,
      "EXPIRED_LOT",
      "Expired stock cannot be received as available.",
    );
    const provenance = {
      manufacturer: text(line.manufacturer, "Manufacturer"),
      document_ref: text(line.document_ref, "Receipt provenance document"),
      manufacturer_lot: lot,
      expiry_date: line.expiry_date,
      receipt_id: receipt.id,
      original_quantity: originalQuantity,
      original_unit: quantityUnit,
      pack_conversion: p.pack_conversion,
    };
    await q(
      "SELECT pg_advisory_xact_lock(727285,:medicine)",
      { medicine: p.legacy_medicine_id },
      tx,
    );
    let batch = await one(
      "SELECT *,to_char(expiry_date,'YYYY-MM-DD') AS expiry FROM hms_medicine_batches WHERE medicine_id=:med AND batch_number=:lot FOR UPDATE",
      { med: p.legacy_medicine_id, lot },
      tx,
    );
    if (batch)
      check(
        batch.expiry === line.expiry_date &&
          batch.lot_status === "AVAILABLE" &&
          (!batch.provenance.manufacturer ||
            batch.provenance.manufacturer === provenance.manufacturer),
        "LOT_PROVENANCE_CONFLICT",
        "Existing lot status or manufacturer/expiry does not match.",
        409,
      );
    else
      batch = await one(
        `INSERT INTO hms_medicine_batches(medicine_id,supplier_id,batch_number,expiry_date,quantity,purchase_rate,mrp,provenance,lot_status)
 VALUES(:med,:supplier,:lot,:expiry,0,:rate,:mrp,CAST(:source AS jsonb),'AVAILABLE') RETURNING *`,
        {
          med: p.legacy_medicine_id,
          supplier,
          lot,
          expiry: line.expiry_date,
          rate,
          mrp,
          source: JSON.stringify(provenance),
        },
        tx,
      );
    const main = await one(
      "SELECT * FROM hms_med_locations WHERE code='MAIN' AND facility_id=hms_current_facility()",
      {},
      tx,
    );
    await move(
      batch.id,
      main,
      quantity,
      "RECEIPT",
      receipt.id,
      "Receipt " + invoice,
      u,
      tx,
    );
    await q(
      "INSERT INTO hms_med_receipt_lines(receipt_id,batch_id,quantity,purchase_rate,provenance) VALUES(:receipt,:batch,:quantity,:rate,CAST(:source AS jsonb))",
      {
        receipt: receipt.id,
        batch: batch.id,
        quantity,
        rate,
        source: JSON.stringify(provenance),
      },
      tx,
    );
  }
  await event("medication_stock_changed", { receipt_id: receipt.id }, tx);
  return receipt;
}
async function pick(p, loc, quantity, tx) {
  const candidates = await q(
    `SELECT b.id,b.batch_number,b.expiry_date,b.mrp,x.quantity,x.id AS balance_id FROM hms_medicine_batches b
 JOIN hms_med_balances x ON x.batch_id=b.id WHERE b.medicine_id=:med AND x.location_id=:loc AND x.quantity>0
 AND b.lot_status='AVAILABLE' AND b.expiry_date>=(now() AT TIME ZONE :timezone)::date ORDER BY b.id FOR UPDATE OF b,x`,
    { med: p.legacy_medicine_id, loc: loc.id, timezone: loc.timezone },
    tx,
  );
  candidates.sort(
    (a, b) => C.epoch(a.expiry_date) - C.epoch(b.expiry_date) || a.id - b.id,
  );
  const selected = [];
  let remaining = quantity;
  for (const row of candidates) {
    const amount = await one(
      "SELECT least(CAST(:remaining AS numeric),CAST(:available AS numeric))::text AS quantity, greatest(CAST(:remaining AS numeric)-CAST(:available AS numeric),0)::text AS remaining",
      { remaining, available: row.quantity },
      tx,
    );
    if (Number(amount.quantity) > 0)
      selected.push({ ...row, pick_quantity: amount.quantity });
    remaining = amount.remaining;
    if (Number(remaining) === 0) break;
  }
  check(
    Number(remaining) === 0,
    "INSUFFICIENT_ELIGIBLE_STOCK",
    "Available, unexpired stock is insufficient.",
    409,
  );
  return selected;
}
async function dispense(oid, b, u, header, tx) {
  await require('./medicationAccess.cts').authorize(u,'DISPENSE',tx);
  const { o, v } = await order(oid, tx);
  expected(header, o.revision);
  await active(o, v, tx);
  check(
    C.epoch(v.starts_at) <= Date.now() && C.epoch(v.ends_at) > Date.now(),
    "ORDER_OUTSIDE_PERIOD",
    "The order is outside its active period.",
    409,
  );
  const p = await product(b.product_id || v.product_id, tx);
  let substitution = null;
  if (v.product_id !== p.id)
    substitution = await one(
      "SELECT * FROM hms_med_substitutions WHERE version_id=:v AND product_id=:p",
      { v: v.id, p: p.id },
      tx,
    );
  check(
    v.product_id === p.id || substitution,
    "SUBSTITUTION_NOT_AUTHORIZED",
    "Exact product identity or explicit prescriber substitution authorization is required.",
    409,
  );
  check(
    p.base_unit === v.supply_unit && p.route === v.route,
    "PRODUCT_MISMATCH",
    "The product route or supply unit does not match the order.",
  );
  const qty = decimal(b.quantity, "Dispense quantity", p.quantity_precision);
  const loc = await location(b.location_id, tx);
  await q(
    "SELECT pg_advisory_xact_lock(727286,:encounter)",
    { encounter: o.encounter_id },
    tx,
  );
  const amount = await one(
    "SELECT coalesce(sum(quantity),0)::text AS supplied FROM hms_med_dispense_lines WHERE version_id=:v",
    { v: v.id },
    tx,
  );
  check(
    (
      await one(
        "SELECT CAST(:qty AS numeric)+CAST(:supplied AS numeric)<=CAST(:limit AS numeric) AS allowed",
        { qty, supplied: amount.supplied, limit: v.supply_quantity },
        tx,
      )
    ).allowed,
    "ORDER_OVERFILL",
    "Dispensing would exceed the authorized remaining quantity.",
    409,
  );
  const chosen = await pick(p, loc, qty, tx);
  const w = p.controlled ? await witness("SUPPLY", v.id, b, u, tx) : null;
  const d = await one(
    "INSERT INTO hms_med_dispenses(version_id,patient_id,dispenser_user_id) VALUES(:v,:pid,:user) RETURNING *",
    { v: v.id, pid: o.patient_id, user: u.id },
    tx,
  );
  const lines = [];
  for (const lot of chosen) {
    const line = await one(
      `INSERT INTO hms_med_dispense_lines(dispense_id,version_id,product_id,batch_id,location_id,substitution_id,quantity,unit,rate,amount)
 VALUES(:d,:v,:p,:batch,:loc,:sub,:qty,:unit,:rate,round(CAST(:qty AS numeric)*CAST(:rate AS numeric),2)) RETURNING *`,
      {
        d: d.id,
        v: v.id,
        p: p.id,
        batch: lot.id,
        loc: loc.id,
        sub: substitution?.id || null,
        qty: lot.pick_quantity,
        unit: p.base_unit,
        rate: lot.mrp || "0",
      },
      tx,
    );
    await move(
      lot.id,
      loc,
      "-" + lot.pick_quantity,
      "DISPENSE",
      line.id,
      "Verified order fulfillment",
      u,
      tx,
    );
    await q(
      "INSERT INTO hms_med_charges(dispense_line_id,encounter_id,admission_id,amount,posted_by_user_id) VALUES(:line,:enc,:adm,:amount,:user)",
      {
        line: line.id,
        enc: o.encounter_id,
        adm: o.admission_id,
        amount: line.amount,
        user: u.id,
      },
      tx,
    );
    await register(
      p,
      lot.id,
      loc.id,
      "SUPPLY",
      lot.pick_quantity,
      line.id,
      u,
      w,
      tx,
    );
    lines.push(line);
  }
  await q('UPDATE hms_med_orders SET fulfillment_revision=fulfillment_revision+1 WHERE id=:id',{id:o.id},tx);
  const balance = await one(
    "SELECT (CAST(:limit AS numeric)-coalesce(sum(quantity),0))::text AS remaining FROM hms_med_dispense_lines WHERE version_id=:v",
    { limit: v.supply_quantity, v: v.id },
    tx,
  );
  await event(
    "medication_dispensed",
    { order_id: o.id, dispense_id: d.id, remaining: balance.remaining },
    tx,
  );
  return { dispense: d, lines, remaining: balance.remaining };
}
async function authorizeSubstitution(oid, b, u, header, tx) {
  const { o, v } = await order(oid, tx);
  await require('./medicationAccess.cts').authorize(u,'PRESCRIBE',tx,o.patient_id);
  expected(header, o.revision);
  check(
    o.prescriber_user_id === u.id,
    "PRESCRIBER_REQUIRED",
    "Substitution needs the responsible prescriber.",
    403,
  );
  await active(o, v, tx);
  const p = await product(b.product_id, tx);
  check(
    p.route === v.route && p.base_unit === v.supply_unit,
    "SUBSTITUTION_UNIT_MISMATCH",
    "Substitution must use the same route and base supply unit.",
  );
  const a = await one(
    "INSERT INTO hms_med_substitutions(version_id,product_id,authorized_by_user_id,reason) VALUES(:v,:p,:user,:reason) RETURNING *",
    {
      v: v.id,
      p: p.id,
      user: u.id,
      reason: text(b.reason, "Substitution authorization reason"),
    },
    tx,
  );
  await q(
    "UPDATE hms_med_orders SET revision=revision+1 WHERE id=:id",
    { id: o.id },
    tx,
  );
  return a;
}
async function returnSupply(lineId, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'DISPENSE',tx);
  const hint = await one(
    "SELECT v.order_id FROM hms_med_dispense_lines l JOIN hms_med_order_versions v ON v.id=l.version_id WHERE l.id=:id",
    { id: id(lineId) },
    tx,
  );
  check(hint, "NOT_FOUND", "Dispense line not found.", 404);
  await order(hint.order_id, tx);
  const l = await one(
      "SELECT * FROM hms_med_dispense_lines WHERE id=:id FOR UPDATE",
      { id: lineId },
      tx,
    ),
    p = await product(l.product_id, tx);
  check(
    !(await one(
      "SELECT 1 FROM hms_med_documentation_intents WHERE scan_evidence->>'dispense_line_id'=:line AND state='PENDING_DOCUMENTATION'",
      { line: l.id },
      tx,
    )),
    "PENDING_DOCUMENTATION",
    "Resolve bedside documentation before returning this supplied line.",
    409,
  );
  const qty = decimal(b.quantity, "Return quantity", p.quantity_precision);
  const reason = text(b.reason, "Return reason");
  await q('UPDATE hms_med_orders SET fulfillment_revision=fulfillment_revision+1 WHERE id=:id',{id:hint.order_id},tx);
  const allowance = await one(
    `SELECT CAST(:supplied AS numeric)-coalesce((SELECT sum(quantity) FROM hms_med_returns WHERE dispense_line_id=:id),0)
 -coalesce((SELECT sum(base_quantity) FROM hms_med_administrations WHERE dispense_line_id=:id AND outcome='GIVEN'),0) AS available`,
    { supplied: l.quantity, id: l.id },
    tx,
  );
  check(
    (
      await one(
        "SELECT CAST(:qty AS numeric)<=CAST(:available AS numeric) AS allowed",
        { qty, available: allowance.available },
        tx,
      )
    ).allowed,
    "RETURN_EXCEEDS_SUPPLY",
    "Return exceeds supplied, unused quantity.",
    409,
  );
  const w = p.controlled ? await witness("RETURN", l.id, b, u, tx) : null;
  await q(
    "SELECT id FROM hms_medicine_batches WHERE id=:id FOR UPDATE",
    { id: l.batch_id },
    tx,
  );
  const ret = await one(
    "INSERT INTO hms_med_returns(dispense_line_id,quantity,reason,received_by_user_id) VALUES(:id,:qty,:reason,:user) RETURNING *",
    { id: l.id, qty, reason, user: u.id },
    tx,
  );
  const quarantine = await one(
    "SELECT * FROM hms_med_locations WHERE code='QUARANTINE'",
    {},
    tx,
  );
  await move(l.batch_id, quarantine, qty, "RETURN", ret.id, reason, u, tx);
  await register(p, l.batch_id, quarantine.id, "RETURN", qty, ret.id, u, w, tx);
  await event(
    "medication_stock_changed",
    { return_id: ret.id, credit_status: "PENDING" },
    tx,
  );
  return ret;
}
async function setLotStatus(batchId, b, u, tx) {
  const batch = await one(
    "SELECT * FROM hms_medicine_batches WHERE id=:id FOR UPDATE",
    { id: integer(batchId, "Batch") },
    tx,
  );
  check(batch, "NOT_FOUND", "Lot not found.", 404);
  check(
    ["AVAILABLE", "QUARANTINED", "RECALLED", "EXPIRED"].includes(b.status),
    "INVALID_STATUS",
    "Choose a lot disposition.",
  );
  text(b.reason, "Disposition reason");
  check(
    batch.lot_status !== "RECALLED" || b.status === "RECALLED",
    "LOT_CANNOT_RELEASE",
    "A recalled lot cannot be relabelled to bypass its recall.",
    409,
  );
  const businessDate = await one(
    "SELECT (now() AT TIME ZONE timezone)::date::text AS day FROM hms_med_locations WHERE code='MAIN' AND facility_id=hms_current_facility()",
    {},
    tx,
  );
  check(
    b.status !== "AVAILABLE" ||
      (batch.lot_status !== "RECALLED" &&
        new Date(batch.expiry_date).toISOString().slice(0, 10) >=
          businessDate.day),
    "LOT_CANNOT_RELEASE",
    "Recalled or expired stock cannot be released.",
    409,
  );
  const documentRef = b.document_ref
    ? text(b.document_ref, "Verified lot/expiry source document")
    : batch.provenance.document_ref;
  check(
    b.status !== "AVAILABLE" || documentRef?.trim(),
    "LOT_PROVENANCE_REQUIRED",
    "Verify the manufacturer lot and expiry against a source document before release.",
    409,
  );
  const result = await one(
    "UPDATE hms_medicine_batches SET lot_status=:status,provenance=provenance||CAST(:review AS jsonb) WHERE id=:id RETURNING *",
    {
      id: batch.id,
      status: b.status,
      review: JSON.stringify({
        ...(documentRef
          ? {
              document_ref: documentRef,
              manufacturer_lot: batch.batch_number,
              expiry_date: new Date(batch.expiry_date)
                .toISOString()
                .slice(0, 10),
            }
          : {}),
        disposition_reason: b.reason,
        reviewer_user_id: u.id,
        reviewed_at: new Date().toISOString(),
      }),
    },
    tx,
  );
  await event(
    "medication_stock_changed",
    { batch_id: batch.id, status: b.status },
    tx,
  );
  return result;
}
async function requisition(b, u, tx) {
  const p = await product(b.product_id, tx),
    l = await location(b.destination_id, tx);
  check(
    l.kind === "WARD",
    "WARD_REQUIRED",
    "Requisitions must go to a ward location.",
  );
  return one(
    "INSERT INTO hms_med_requisitions(product_id,destination_id,quantity,requested_by_user_id,reason) VALUES(:p,:l,:qty,:user,:reason) RETURNING *",
    {
      p: p.id,
      l: l.id,
      qty: decimal(b.quantity, "Quantity", p.quantity_precision),
      user: u.id,
      reason: text(b.reason, "Requisition reason"),
    },
    tx,
  );
}
async function requisitionAction(rid, action, b, u, header, tx) {
  const r = await one(
    "SELECT * FROM hms_med_requisitions WHERE id=:id FOR UPDATE",
    { id: id(rid) },
    tx,
  );
  check(r, "NOT_FOUND", "Requisition not found.", 404);
  expected(header, r.revision);
  const p = await product(r.product_id, tx);
  if (action === "approve") {
    check(
      r.state === "REQUESTED",
      "INVALID_TRANSITION",
      "Only requested requisitions can be approved.",
      409,
    );
    check(
      r.requested_by_user_id !== u.id,
      "INDEPENDENT_APPROVAL_REQUIRED",
      "The requester cannot approve their requisition.",
      403,
    );
    return one(
      "UPDATE hms_med_requisitions SET state='APPROVED',approved_by_user_id=:user,revision=revision+1 WHERE id=:id RETURNING *",
      { id: r.id, user: u.id },
      tx,
    );
  }
  const transit = await one(
    "SELECT * FROM hms_med_locations WHERE code='TRANSIT'",
    {},
    tx,
  );
  if (action === "pick") {
    check(
      r.state === "APPROVED",
      "INVALID_TRANSITION",
      "Requisition needs approval before picking.",
      409,
    );
    const main = await one(
      "SELECT * FROM hms_med_locations WHERE code='MAIN' AND facility_id=hms_current_facility()",
      {},
      tx,
    );
    if (p.controlled)
      check(
        b.product_id === r.product_id &&
          b.destination_id === r.destination_id &&
          (
            await one(
              "SELECT CAST(:proposed AS numeric)=CAST(:approved AS numeric) AS matches",
              {
                proposed: decimal(
                  b.quantity,
                  "Witnessed transfer quantity",
                  p.quantity_precision,
                ),
                approved: r.quantity,
              },
              tx,
            )
          ).matches,
        "TRANSFER_CONTEXT_MISMATCH",
        "Witness the approved product, quantity and receiving location.",
        409,
      );
    const chosen = await pick(p, main, r.quantity, tx);
    const w = p.controlled ? await witness("TRANSFER", r.id, b, u, tx) : null;
    for (const lot of chosen) {
      const line = await one(
        "INSERT INTO hms_med_transfer_lines(requisition_id,batch_id,quantity,picked_by_user_id) VALUES(:r,:batch,:qty,:user) RETURNING *",
        { r: r.id, batch: lot.id, qty: lot.pick_quantity, user: u.id },
        tx,
      );
      await move(
        lot.id,
        main,
        "-" + lot.pick_quantity,
        "TRANSFER_OUT",
        line.id,
        "Approved ward supply",
        u,
        tx,
      );
      await move(
        lot.id,
        transit,
        lot.pick_quantity,
        "TRANSFER_IN_TRANSIT",
        line.id,
        "Awaiting ward acknowledgment",
        u,
        tx,
      );
      await register(
        p,
        lot.id,
        main.id,
        "TRANSFER",
        lot.pick_quantity,
        line.id,
        u,
        w,
        tx,
      );
    }
    return one(
      "UPDATE hms_med_requisitions SET state='PICKED',revision=revision+1 WHERE id=:id RETURNING *",
      { id: r.id },
      tx,
    );
  }
  check(
    action === "receive" && r.state === "PICKED",
    "INVALID_TRANSITION",
    "Only picked transfers can be acknowledged.",
    409,
  );
  check(
    u.id === r.requested_by_user_id,
    "RECEIVING_NURSE_REQUIRED",
    "The requesting nurse must acknowledge receipt.",
    403,
  );
  const dest = await location(r.destination_id, tx);
  for (const line of await q(
    "SELECT * FROM hms_med_transfer_lines WHERE requisition_id=:id ORDER BY batch_id",
    { id: r.id },
    tx,
  )) {
    await q(
      "SELECT id FROM hms_medicine_batches WHERE id=:id FOR UPDATE",
      { id: line.batch_id },
      tx,
    );
    await move(
      line.batch_id,
      transit,
      "-" + line.quantity,
      "TRANSFER_RECEIVED",
      line.id,
      "Ward acknowledgment",
      u,
      tx,
    );
    await move(
      line.batch_id,
      dest,
      line.quantity,
      "WARD_RECEIPT",
      line.id,
      "Ward acknowledgment",
      u,
      tx,
    );
    await q(
      "UPDATE hms_med_transfer_lines SET received_at=now() WHERE id=:id",
      { id: line.id },
      tx,
    );
  }
  return one(
    "UPDATE hms_med_requisitions SET state='RECEIVED',received_by_user_id=:user,revision=revision+1 WHERE id=:id RETURNING *",
    { id: r.id, user: u.id },
    tx,
  );
}
async function wastage(b, u, tx) {
  const p = await product(b.product_id, tx),
    loc = await location(b.location_id, tx),
    batch = integer(b.batch_id, "Batch"),
    qty = decimal(b.quantity, "Wastage quantity", p.quantity_precision),
    reason = text(b.reason, "Wastage reason");
  check(
    await one(
      "SELECT id FROM hms_medicine_batches WHERE id=:batch AND medicine_id=:med FOR UPDATE",
      { batch, med: p.legacy_medicine_id },
      tx,
    ),
    "PRODUCT_MISMATCH",
    "Lot does not match the product.",
  );
  const w = p.controlled
    ? await witness("WASTAGE", String(batch), b, u, tx)
    : null;
  const source = require("crypto").randomUUID();
  await move(batch, loc, "-" + qty, "WASTAGE", source, reason, u, tx);
  await register(p, batch, loc.id, "WASTAGE", qty, source, u, w, tx);
  return { source_id: source };
}
async function shiftCount(b, u, tx) {
  const p = await product(b.product_id, tx);
  check(
    p.controlled,
    "CONTROLLED_PRODUCT_REQUIRED",
    "Shift counts here are for controlled products.",
  );
  const loc = await location(b.location_id, tx),
    batch = integer(b.batch_id, "Batch");
  check(
    await one(
      "SELECT id FROM hms_medicine_batches WHERE id=:batch AND medicine_id=:med FOR UPDATE",
      { batch, med: p.legacy_medicine_id },
      tx,
    ),
    "PRODUCT_MISMATCH",
    "Batch must belong to the counted product.",
  );
  const balance = await one(
    "SELECT quantity FROM hms_med_balances WHERE batch_id=:batch AND location_id=:loc FOR UPDATE",
    { batch, loc: loc.id },
    tx,
  );
  const w = await witness("COUNT", String(batch), b, u, tx);
  const count = await one(
    "INSERT INTO hms_med_shift_counts(product_id,batch_id,location_id,expected_quantity,counted_quantity,performer_user_id,witness_id,shift_ref) VALUES(:p,:batch,:loc,:expected,:actual,:user,:witness,:shift) RETURNING *",
    {
      p: p.id,
      batch,
      loc: loc.id,
      expected: balance?.quantity || "0",
      actual: decimal(
        b.counted_quantity,
        "Counted quantity",
        p.quantity_precision,
        true,
      ),
      user: u.id,
      witness: w,
      shift: text(b.shift_ref, "Shift reference"),
    },
    tx,
  );
  if (Number(count.expected_quantity) !== Number(count.counted_quantity))
    await q(
      "INSERT INTO hms_med_discrepancies(count_id) VALUES(:id)",
      { id: count.id },
      tx,
    );
  return count;
}
async function discrepancyAction(cid, b, u, tx) {
  const c = await one(
    "SELECT * FROM hms_med_discrepancies WHERE id=:id FOR UPDATE",
    { id: id(cid) },
    tx,
  );
  check(
    c && c.state !== "CLOSED",
    "CASE_NOT_OPEN",
    "This discrepancy is not open.",
    409,
  );
  check(
    ["INVESTIGATING", "CLOSED"].includes(b.state),
    "INVALID_STATE",
    "Investigate or close the discrepancy.",
  );
  if (b.state === "CLOSED")
    check(
      c.state === "INVESTIGATING" && c.investigator_user_id === u.id,
      "INVESTIGATION_REQUIRED",
      "The assigned investigator must investigate before closure.",
      409,
    );
  return one(
    `UPDATE hms_med_discrepancies SET state=:state,investigator_user_id=:user,investigation=:detail,closure_reason=:reason,
 closed_by_user_id=CASE WHEN :state = 'CLOSED' THEN :user ELSE NULL END,closed_at=CASE WHEN :state = 'CLOSED' THEN now() ELSE NULL END WHERE id=:id RETURNING *`,
    {
      id: c.id,
      state: b.state,
      user: u.id,
      detail: text(b.investigation || c.investigation, "Investigation"),
      reason:
        b.state === "CLOSED" ? text(b.closure_reason, "Closure reason") : null,
    },
    tx,
  );
}
module.exports = {
  requestWitness,
  attestRequest,
  product,
  location,
  createLocation,
  createWitness,
  witness,
  register,
  move,
  receive,
  dispense,
  authorizeSubstitution,
  returnSupply,
  setLotStatus,
  requisition,
  requisitionAction,
  wastage,
  shiftCount,
  discrepancyAction,
  witnessDetails,
};
