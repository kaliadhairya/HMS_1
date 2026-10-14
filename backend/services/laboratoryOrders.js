const C = require("./laboratoryCommon"),
  Cat = require("./laboratoryCatalogue");
async function create(body, user, tx) {
  await require('./facilities.cts').requirePrivilege(user, 'PRESCRIBE', tx);
  const patient = C.integer(body.patient_id),
    encounter = C.integer(body.encounter_id);
  await C.scope(user, patient, tx);
  const e = await C.one(
    "SELECT * FROM hms_encounters WHERE id= :id FOR UPDATE",
    { id: encounter },
    tx,
  );
  C.check(
    e && e.patient_id === patient,
    "ENCOUNTER_PATIENT_MISMATCH",
    "The encounter must belong to this patient.",
    400,
  );
  C.check(
    e.status !== "Finalized",
    "ENCOUNTER_FINALIZED",
    "Start a new consultation to order more investigations.",
    409,
  );
  const credentials = await C.one(
    "SELECT practitioner_credentials_expired(:id) AS expired",
    { id: user.id },
    tx,
  );
  C.check(
    !credentials.expired,
    "REGISTRATION_EXPIRED",
    "Recorded practitioner credentials have expired.",
    403,
  );
  const request =
    body.test_version_ids ||
    (Array.isArray(body.items) ? body.items.map((i) => i.test_version_id) : []);
  C.check(
    Array.isArray(request) &&
      request.length > 0 &&
      request.length <= 100 &&
      request.every(Boolean),
    "CODED_TEST_REQUIRED",
    "Select approved catalogue test/panel version IDs.",
    400,
  );
  const versions = [];
  for (const id of request) {
    const v = await C.one(
      `SELECT v.*,t.kind FROM hms_lab_test_versions v JOIN hms_lab_tests t ON t.id=v.test_id WHERE v.id= :id AND ${Cat.active}`,
      { id: C.id(id) },
      tx,
    );
    C.check(
      v,
      "CATALOGUE_NOT_ACTIVE",
      "The catalogue test/panel is not active.",
      409,
    );
    if (v.kind === "PANEL") {
      const members = await C.q(
        `SELECT v.* FROM hms_lab_panel_members m JOIN hms_lab_test_versions v ON v.id=m.test_version_id WHERE m.panel_version_id= :id AND ${Cat.active} ORDER BY m.position`,
        { id: v.id },
        tx,
      );
      const n = await C.one(
        "SELECT count(*)::int AS n FROM hms_lab_panel_members WHERE panel_version_id= :id",
        { id: v.id },
        tx,
      );
      C.check(
        members.length === n.n && members.length > 0,
        "PANEL_MEMBER_NOT_ACTIVE",
        "Every panel member must be active.",
      );
      versions.push(...members);
    } else versions.push(v);
  }
  C.check(
    new Set(versions.map((v) => v.id)).size === versions.length,
    "DUPLICATE_TEST",
    "A test cannot be ordered twice in one diagnostic order.",
  );
  const priority = body.priority || body.urgency || "Routine";
  C.check(
    ["STAT", "Urgent", "Routine"].includes(priority),
    "INVALID_PRIORITY",
    "Use STAT, Urgent or Routine.",
    400,
  );
  const order = await C.one(
    `INSERT INTO hms_investigation_orders(id,encounter_id,patient_id,doctor_id,order_type,urgency,clinical_notes,status)
 VALUES(nextval('hms_inv_orders_seq'),:encounter,:patient,:doctor,'Lab',:priority,:notes,'Pending') RETURNING *`,
    {
      encounter,
      patient,
      doctor: user.id,
      priority,
      notes: body.clinical_notes || null,
    },
    tx,
  );
  const items = [];
  for (const v of versions)
    items.push(
      await C.one(
        `INSERT INTO hms_investigation_order_items(id,order_id,item_name,test_category,item_type,status,lab_test_version_id,lab_state)
 VALUES(nextval('hms_inv_items_seq'),:order,:name,:section,'Test','Pending',:test,'ORDERED') RETURNING *`,
        { order: order.id, name: v.name, section: v.section, test: v.id },
        tx,
      ),
    );
  await require("../utils/outbox").publish(
    "new_lab_order",
    "lab_technician",
    { order_id: order.id, patient_id: patient },
    { transaction: tx },
  );
  return { ...order, items };
}
async function cancel(orderId, user, header, tx) {
  await require('./facilities.cts').requirePrivilege(user, 'PRESCRIBE', tx);
  const o = await C.lockOrder(orderId, user, tx);
  C.expected(header, o.lab_revision);
  const evidence = await C.one(
    `SELECT 1 FROM hms_lab_result_versions r JOIN hms_investigation_order_items i ON i.id=r.item_id WHERE i.order_id= :id LIMIT 1`,
    { id: o.id },
    tx,
  );
  C.check(
    o.status !== "Cancelled" && o.status !== "Completed" && !evidence,
    "CANNOT_CANCEL",
    "An order with result evidence cannot be silently cancelled.",
    409,
  );
  await C.q(
    "UPDATE hms_investigation_order_items SET status='Cancelled',lab_state='CANCELLED',lab_revision=lab_revision+1,updated_at=now() WHERE order_id= :id",
    { id: o.id },
    tx,
  );
  await C.q(
    "UPDATE hms_investigation_orders SET status='Cancelled',lab_revision=lab_revision+1,updated_at=now() WHERE id= :id",
    { id: o.id },
    tx,
  );
  await C.event("lab_status_change", o, { status: "Cancelled" }, tx);
  return { order_id: o.id, revision: o.lab_revision + 1 };
}
module.exports = { create, cancel };
