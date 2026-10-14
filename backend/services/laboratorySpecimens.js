const crypto = require("crypto");
const C = require("./laboratoryCommon");
async function lockLinked(specimenId, user, tx) {
  const orders = await C.q(
    "SELECT DISTINCT i.order_id FROM hms_lab_specimen_links l JOIN hms_investigation_order_items i ON i.id=l.item_id WHERE l.specimen_id= :id ORDER BY i.order_id",
    { id: C.id(specimenId) },
    tx,
  );
  for (const o of orders) await C.lockOrder(o.order_id, user, tx);
  const s = await C.one(
    "SELECT * FROM hms_lab_specimens WHERE id= :id FOR UPDATE",
    { id: specimenId },
    tx,
  );
  C.check(s, "NOT_FOUND", "Specimen not found.", 404);
  await C.scope(user, s.patient_id, tx);
  return s;
}
async function create(body, user, tx) {
  const patient = C.integer(body.patient_id, "Patient");
  await C.scope(user, patient, tx);
  C.check(
    Array.isArray(body.links) && body.links.length > 0,
    "SPECIMEN_LINK_REQUIRED",
    "Link the specimen to ordered requirements.",
  );
  const links = [];
  for (const l of body.links)
    links.push({
      item_id: C.integer(l.item_id),
      requirement_id: C.id(l.requirement_id),
    });
  const hints = await C.q(
    "SELECT DISTINCT order_id FROM hms_investigation_order_items WHERE id IN (:ids) ORDER BY order_id",
    { ids: links.map((l) => l.item_id) },
    tx,
  );
  for (const h of hints) await C.lockOrder(h.order_id, user, tx);
  const type = C.text(body.specimen_type, "Specimen type"),
    container = C.text(body.container, "Container"),
    location = C.text(body.location, "Location");
  for (const l of links) {
    const r = await C.one(
      `SELECT i.lab_state,i.lab_test_version_id,o.patient_id,o.status,r.test_version_id,r.specimen_type,r.container
   FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id=i.order_id JOIN hms_lab_requirements r ON r.id= :requirement WHERE i.id= :item`,
      { requirement: l.requirement_id, item: l.item_id },
      tx,
    );
    C.check(
      r && r.patient_id === patient,
      "SPECIMEN_PATIENT_MISMATCH",
      "Every linked test must belong to this patient.",
    );
    C.check(
      !["Cancelled", "Completed"].includes(r.status) &&
        !["CANCELLED", "UNMAPPED", "RELEASED"].includes(r.lab_state),
      "ORDER_NOT_COLLECTABLE",
      "The test is not available for collection.",
    );
    C.check(
      r.test_version_id === r.lab_test_version_id &&
        r.specimen_type === type &&
        r.container === container,
      "SPECIMEN_REQUIREMENT_MISMATCH",
      "Specimen type/container must match this exact test requirement.",
    );
  }
  let parent = null;
  if (body.parent_id) {
    parent = await lockLinked(body.parent_id, user, tx);
    C.check(
      parent.patient_id === patient &&
        ["RECEIVED", "STORED"].includes(parent.state) &&
        parent.specimen_type === type,
      "INVALID_ALIQUOT",
      "Aliquots require a received parent for the same patient and specimen type.",
    );
  }
  const s = await C.one(
    `INSERT INTO hms_lab_specimens(accession,patient_id,parent_id,specimen_type,container,location,created_by_user_id,state,collector_user_id,collected_at,received_at)
 VALUES(:accession,:patient,:parent,:type,:container,:location,:user,:state,:collector,:collected,:received) RETURNING *`,
    {
      accession: "LAB-" + crypto.randomUUID(),
      patient,
      parent: parent?.id || null,
      type,
      container,
      location,
      user: user.id,
      state: parent ? "RECEIVED" : "PLANNED",
      collector: parent?.collector_user_id || null,
      collected: parent?.collected_at || null,
      received: parent ? new Date().toISOString() : null,
    },
    tx,
  );
  for (const l of links)
    await C.q(
      "INSERT INTO hms_lab_specimen_links(specimen_id,item_id,requirement_id,linked_by_user_id) VALUES(:specimen,:item,:requirement,:user)",
      {
        specimen: s.id,
        item: l.item_id,
        requirement: l.requirement_id,
        user: user.id,
      },
      tx,
    );
  await C.q(
    `INSERT INTO hms_lab_custody(specimen_id,event,actor_user_id,occurred_at,location,reason) VALUES(:id,:event,:user,now(),:location,:reason)`,
    {
      id: s.id,
      event: parent ? "ALIQUOT" : "PLANNED",
      user: user.id,
      location,
      reason: parent ? "Aliquot from " + parent.accession : "Accession planned",
    },
    tx,
  );
  return s;
}
async function transition(specimenId, body, user, header, tx) {
  const s = await lockLinked(specimenId, user, tx);
  C.expected(header, s.revision);
  C.check(
    body.patient_id !== undefined &&
      C.integer(body.patient_id) === s.patient_id &&
      body.accession === s.accession,
    "SPECIMEN_PATIENT_MISMATCH",
    "Confirm the patient and accession against the specimen label.",
  );
  const allowed = {
    PLANNED: ["COLLECTED", "REJECTED"],
    COLLECTED: ["SENT", "RECEIVED", "REJECTED"],
    SENT: ["RECEIVED", "REJECTED"],
    RECEIVED: ["STORED", "REJECTED"],
    STORED: ["REJECTED"],
    REJECTED: [],
  };
  C.check(
    allowed[s.state].includes(body.state),
    "INVALID_SPECIMEN_TRANSITION",
    "This specimen cannot make that transition.",
    409,
  );
  const reason = C.text(body.reason, "Custody/rejection reason"),
    location = C.text(body.location, "Location");
  const instant = body.occurred_at
    ? require("./medicationCommon").instant(body.occurred_at, "Custody time")
    : new Date().toISOString();
  C.check(
    new Date(instant) <= new Date(),
    "INVALID_TIME",
    "Custody time cannot be in the future.",
  );
  const last = await C.one(
    "SELECT max(occurred_at) AS last FROM hms_lab_custody WHERE specimen_id= :id",
    { id: s.id },
    tx,
  );
  C.check(
    !last.last || new Date(instant) >= new Date(last.last),
    "INVALID_TIME",
    "Custody time cannot precede the preceding event.",
  );
  const next = await C.one(
    `UPDATE hms_lab_specimens SET state= :state,revision=revision+1,location= :location,
 collected_at=CASE WHEN :state ='COLLECTED' THEN :at::timestamptz ELSE collected_at END,
 collector_user_id=CASE WHEN :state ='COLLECTED' THEN :user ELSE collector_user_id END,
 received_at=CASE WHEN :state ='RECEIVED' THEN :at::timestamptz ELSE received_at END WHERE id= :id RETURNING *`,
    { state: body.state, location, at: instant, user: user.id, id: s.id },
    tx,
  );
  await C.q(
    "INSERT INTO hms_lab_custody(specimen_id,event,actor_user_id,occurred_at,location,reason) VALUES(:id,:event,:user,:at,:location,:reason)",
    {
      id: s.id,
      event: body.state,
      user: user.id,
      at: instant,
      location,
      reason,
    },
    tx,
  );
  const linked = await C.q(
    "SELECT DISTINCT item_id FROM hms_lab_specimen_links WHERE specimen_id= :id",
    { id: s.id },
    tx,
  );
  for (const l of linked) {
    if (body.state === "REJECTED") {
      await C.q(
        `INSERT INTO hms_lab_recollections(rejected_specimen_id,item_id,reason,requested_by_user_id) VALUES(:specimen,:item,:reason,:user) ON CONFLICT DO NOTHING`,
        { specimen: s.id, item: l.item_id, reason, user: user.id },
        tx,
      );
      await C.q(
        `UPDATE hms_investigation_order_items SET lab_state=CASE WHEN lab_state='RELEASED' THEN lab_state ELSE 'REPEAT' END,lab_revision=lab_revision+1,status=CASE WHEN lab_state='RELEASED' THEN status ELSE 'Pending' END WHERE id= :id`,
        { id: l.item_id },
        tx,
      );
    } else if (["RECEIVED", "STORED"].includes(body.state)) {
      await C.q(
        `UPDATE hms_lab_recollections r SET replacement_specimen_id= :specimen,completed_at=now() WHERE r.item_id= :item AND completed_at IS NULL AND EXISTS
   (SELECT 1 FROM hms_lab_specimen_links old JOIN hms_lab_specimen_links newer ON newer.requirement_id=old.requirement_id AND newer.item_id=old.item_id
    WHERE old.specimen_id=r.rejected_specimen_id AND newer.specimen_id= :specimen AND old.item_id= :item)`,
        { specimen: s.id, item: l.item_id },
        tx,
      );
      await C.q(
        `UPDATE hms_investigation_order_items SET status='Received in Lab',lab_state='PROCESSING' WHERE id= :id AND lab_state IN ('ORDERED','REPEAT')`,
        { id: l.item_id },
        tx,
      );
    }
  }
  return next;
}
async function requirementsComplete(itemId, tx) {
  const missing = await C.one(
    `SELECT r.id FROM hms_lab_requirements r JOIN hms_investigation_order_items i ON i.lab_test_version_id=r.test_version_id WHERE i.id= :item
 AND NOT EXISTS(SELECT 1 FROM hms_lab_specimen_links l JOIN hms_lab_specimens s ON s.id=l.specimen_id
 WHERE l.item_id=i.id AND l.requirement_id=r.id AND s.state IN ('RECEIVED','STORED')) LIMIT 1`,
    { item: itemId },
    tx,
  );
  C.check(
    !missing,
    "SPECIMENS_NOT_RECEIVED",
    "All required specimens must be received and not rejected.",
    409,
  );
}
module.exports = { create, transition, lockLinked, requirementsComplete };
