const express = require("express");
const router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const C = require("../services/medicationCommon");
const O = require("../services/medicationOrders");
const I = require("../services/medicationInventory");
const N = require("../services/medicationNursing");
const { beforeSend } = require("../utils/responseGate");
const { storage } = require("../utils/auditContext");
const { patientInCare, NOT_IN_CARE } = require("../utils/careTeam");
const Access=require('../services/medicationAccess.cts');
const readers = ["doctor", "nurse", "pharmacist"];
// Patient scope (Phase 2, migration 0014): a doctor works only with patients in
// their care, as on the patient record routes. Other roles are not limited here.
async function inCare(r, patientId, t) {
  if (r.user.role !== "doctor" || patientId == null) return;
  C.check(
    await patientInCare(r.user.id, Number(patientId), t),
    "PATIENT_NOT_IN_CARE",
    NOT_IN_CARE,
    403,
  );
}
async function orderInCare(r, orderId, t) {
  if (r.user.role !== "doctor") return;
  const row = await C.one(
    "SELECT patient_id FROM hms_med_orders WHERE id::text=:id",
    { id: String(orderId) },
    t,
  );
  if (row) await inCare(r, row.patient_id, t);
}
// SQL filter for lists: doctors see rows for patients in their care only.
const careFilter = (column) =>
  `(:careDoctor::int IS NULL OR patient_in_care(:careDoctor, ${column}))`;
const careDoctor = (r) => (r.user.role === "doctor" ? r.user.id : null);
router.use(protect);
router.use((req,res,next)=>{
 const action=req.method==='GET'?'CHART_READ':req.user.role==='doctor'?'PRESCRIBE':req.user.role==='nurse'?'NURSING_DOCUMENT':'DISPENSE';
 Access.authorize(req.user,action).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);});
});
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  // Extend Phase 1's before-first-byte protection without editing its shared middleware.
  if (
    req.method === "GET" &&
    /^\/(orders|allergies|emar|tasks|handovers|late-documentation-requests)/.test(
      req.path,
    )
  )
    beforeSend(res, 20, async () => {
      if (res.statusCode >= 400) return;
      const context = { ...(storage.getStore() || {}), command: null };
      await storage.run(context, () =>
        C.q(
          `INSERT INTO audit.access_events(user_id,session_id,request_id,method,path,status,outcome,patient_id,ip)
 VALUES(:user,:session,:request,'GET',:path,:status,'read',:patient,:ip)`,
          {
            user: req.user.id,
            session: req.user.sessionId || null,
            request: req.id,
            path: req.originalUrl.split("?")[0],
            status: res.statusCode,
            patient:
              Number(
                req.params.patientId ??
                  req.query.patient_id ??
                  res.locals.responseBody?.data?.order?.patient_id,
              ) || null,
            ip: req.ip || null,
          },
        ),
      );
    });
  next();
});
const wrap =
  (fn, command = false, status = 200) =>
  async (req, res) => {
    try {
      const result = command
        ? await C.sequelize.transaction((tx) => fn(req, tx))
        : await fn(req);
      res.status(status).json({ success: true, data: result });
    } catch (e) {
      if (!e.status)
        console.error(
          "Medication command failed:",
          e.original?.code || e.code || e.name,
        );
      res.status(e.status || 500).json({
        success: false,
        code: e.status ? e.code : "MEDICATION_OPERATION_FAILED",
        message: e.status
          ? e.message
          : "Medication operation failed. Your work was not confirmed.",
      });
    }
  };
const read = (path, roles, fn) =>
  router.get(path, restrictTo(...roles), wrap(fn));
const post = (path, roles, fn, status = 200) =>
  router.post(path, restrictTo(...roles), wrap(fn, true, status));
read("/staff", readers, () =>
  C.q(
    "SELECT id,name,role FROM hms_users WHERE is_active=1 AND role IN ('doctor','nurse','pharmacist') ORDER BY name",
  ),
);
read("/ingredients", readers, () =>
  C.q("SELECT * FROM hms_med_ingredients ORDER BY name"),
);
post(
  "/ingredients",
  ["pharmacist"],
  (r, t) => O.createIngredient(r.body, r.user, t),
  201,
);
read("/products", readers, () =>
  C.q(
    "SELECT p.*,CASE WHEN EXISTS(SELECT 1 FROM hms_med_product_retirements r WHERE r.product_id=p.id) THEN 'RETIRED' ELSE p.status END AS status,coalesce((SELECT jsonb_agg(jsonb_build_object('ingredient_id',i.ingredient_id,'amount',i.amount,'unit',i.unit)) FROM hms_med_product_ingredients i WHERE i.product_id=p.id),'[]') AS ingredients FROM hms_med_products p ORDER BY name",
  ),
);
post(
  "/products",
  ["pharmacist"],
  (r, t) => O.createProduct(r.body, r.user, t),
  201,
);
post("/products/:id/retire", ["pharmacist"], async (r, t) => {
  await C.q(
    "SELECT id FROM hms_med_products WHERE id=:id FOR UPDATE",
    { id: C.id(r.params.id) },
    t,
  );
  return C.one(
    "INSERT INTO hms_med_product_retirements(product_id,reason,retired_by_user_id) VALUES(:id,:reason,:user) RETURNING *",
    {
      id: C.id(r.params.id),
      reason: C.text(r.body.reason, "Retirement reason"),
      user: r.user.id,
    },
    t,
  );
});
post(
  "/products/:id/formulary",
  ["pharmacist"],
  (r, t) => O.addFormulary(r.params.id, r.body, r.user, t),
  201,
);
post("/products/:id/approve", ["pharmacist"], (r, t) =>
  O.createProduct(r.body, r.user, t, r.params.id),
);
read("/reconciliation", ["pharmacist"], () =>
  C.q(
    "SELECT * FROM hms_med_reconciliation WHERE status='PENDING' ORDER BY created_at,id LIMIT 200",
  ),
);
read("/rule-packs", ["doctor", "pharmacist"], () =>
  C.q(
    "SELECT * FROM hms_med_rule_packs ORDER BY effective_at DESC,revision DESC",
  ),
);
post(
  "/rule-packs",
  ["pharmacist"],
  (r, t) => O.createRulePack(r.body, r.user, t),
  201,
);
read(
  "/allergies/:patientId",
  [
    "super_admin",
    "admin",
    "doctor",
    "nurse",
    "pharmacist",
    "receptionist",
    "lab_technician",
  ],
  async (r) => {
    await inCare(r, C.integer(r.params.patientId, "Patient"));
    return O.allergies(r.params.patientId);
  },
);
post("/allergies/:patientId/review", ["doctor", "nurse"], async (r, t) =>
  (await inCare(r, C.integer(r.params.patientId, "Patient"), t)) ||
  O.reviewAllergies(
    r.params.patientId,
    r.body,
    r.user,
    r.headers["if-match"],
    t,
  ),
);
post(
  "/allergies/:patientId",
  ["doctor", "nurse"],
  async (r, t) => {
    await inCare(r, C.integer(r.params.patientId, "Patient"), t);
    return O.addAllergy(r.params.patientId, r.body, r.user, t);
  },
  201,
);
read("/orders", readers, async (r) => {
  if (r.query.patient_id) await inCare(r, C.integer(r.query.patient_id, "Patient"));
  const patient = r.query.patient_id
      ? C.integer(r.query.patient_id, "Patient")
      : null,
    encounter = r.query.encounter_id
      ? C.integer(r.query.encounter_id, "Encounter")
      : null;
  return C.q(
    `SELECT o.*,v.id AS version_id,v.product_id,v.ingredient_id,v.product_snapshot,v.dose,v.dose_unit,v.route,v.frequency,v.starts_at,v.ends_at,v.prn,v.indication,v.max_dose,v.max_period_hours,v.min_interval_minutes,v.supply_quantity,v.supply_unit,v.signed_at,
 p.name AS patient_name,p.uhid,z.state AS verification_state,z.id AS verification_id,a.findings,a.coverage,a.input_snapshot,
 (v.supply_quantity-coalesce((SELECT sum(l.quantity) FROM hms_med_dispense_lines l WHERE l.version_id=v.id),0))::text AS remaining
 FROM hms_med_orders o JOIN hms_med_order_versions v ON v.order_id=o.id AND v.version=o.current_version
 JOIN hms_patients p ON p.id=o.patient_id LEFT JOIN hms_med_verifications z ON z.version_id=v.id LEFT JOIN hms_med_assessments a ON a.id=z.assessment_id
 WHERE o.facility_id=:facility AND (:patient IS NULL OR o.patient_id=:patient) AND (:encounter IS NULL OR o.encounter_id=:encounter) AND ${careFilter("o.patient_id")}
 ORDER BY o.created_at DESC LIMIT 200`,
    { patient, encounter, careDoctor: careDoctor(r),facility:Access.facility() },
  );
});
read("/orders/:id", readers, async (r) => {
  const { o, v } = await C.order(r.params.id, undefined, false);
  await inCare(r, o.patient_id);
  return {
    order: o,
    version: v,
    versions: await C.q(
      "SELECT * FROM hms_med_order_versions WHERE order_id=:id ORDER BY version",
      { id: o.id },
    ),
    assessments: await C.q(
      "SELECT a.* FROM hms_med_assessments a JOIN hms_med_order_versions v ON v.id=a.version_id WHERE v.order_id=:id ORDER BY a.assessed_at",
      { id: o.id },
    ),
    verifications: await C.q(
      "SELECT z.* FROM hms_med_verifications z JOIN hms_med_order_versions v ON v.id=z.version_id WHERE v.order_id=:id",
      { id: o.id },
    ),
    dispenses: await C.q(
      "SELECT l.* FROM hms_med_dispense_lines l JOIN hms_med_order_versions v ON v.id=l.version_id WHERE v.order_id=:id",
      { id: o.id },
    ),
  };
});
post("/orders/:id/assess", ["doctor"], async (r, t) => {
  const { o, v } = await C.order(r.params.id, t);
  await inCare(r, o.patient_id, t);
  C.expected(r.headers["if-match"], o.revision);
  C.check(
    o.prescriber_user_id === r.user.id && o.state === "DRAFT",
    "DRAFT_PRESCRIBER_REQUIRED",
    "Only the responsible prescriber can assess this draft.",
    403,
  );
  return O.assess(o, v, { ...r.body, preview: true }, r.user, t);
});
post(
  "/orders",
  ["doctor"],
  async (r, t) => {
    await inCare(r, C.integer(r.body?.patient_id, "Patient"), t);
    return O.createOrder(r.body, r.user, t);
  },
  201,
);
for (const action of ["sign", "hold", "resume", "discontinue", "amend"])
  post("/orders/:id/" + action, ["doctor"], async (r, t) =>
    (await orderInCare(r, r.params.id, t)) ||
    O.transition(r.params.id, action, r.body, r.user, r.headers["if-match"], t),
  );
post("/orders/:id/verify", ["pharmacist"], (r, t) =>
  O.verify(r.params.id, r.body, r.user, r.headers["if-match"], t),
);
post(
  "/orders/:id/substitutions",
  ["doctor"],
  async (r, t) =>
    (await orderInCare(r, r.params.id, t)) ||
    I.authorizeSubstitution(
      r.params.id,
      r.body,
      r.user,
      r.headers["if-match"],
      t,
    ),
  201,
);
post(
  "/orders/:id/dispense",
  ["pharmacist"],
  (r, t) => I.dispense(r.params.id, r.body, r.user, r.headers["if-match"], t),
  201,
);
read("/locations", readers, () =>
  C.q("SELECT * FROM hms_med_locations WHERE facility_id=:facility ORDER BY code",{facility:Access.facility()}),
);
post(
  "/locations",
  ["pharmacist"],
  (r, t) => I.createLocation(r.body, r.user, t),
  201,
);
read("/stock", readers, () =>
  C.q(`SELECT b.id AS batch_id,b.batch_number,b.expiry_date,b.lot_status,CASE WHEN b.expiry_date<(now() AT TIME ZONE l.timezone)::date THEN 'EXPIRED' ELSE b.lot_status END AS effective_lot_status,b.provenance,p.id AS product_id,p.name,p.base_unit,p.quantity_precision,
 l.id AS location_id,l.name AS location_name,l.kind,x.quantity FROM hms_med_balances x JOIN hms_medicine_batches b ON b.id=x.batch_id
 JOIN hms_med_locations l ON l.id=x.location_id LEFT JOIN hms_med_products p ON p.legacy_medicine_id=b.medicine_id ORDER BY b.expiry_date,b.id,l.code`),
);
read("/stock/reconciliation", ["pharmacist"], () =>
  C.q(`SELECT x.batch_id,x.location_id,x.quantity AS balance,coalesce(sum(m.delta),0) AS journal,
 x.quantity=coalesce(sum(m.delta),0) AND (l.code<>'MAIN' OR x.quantity=b.quantity) AS reconciled
 FROM hms_med_balances x JOIN hms_med_locations l ON l.id=x.location_id JOIN hms_medicine_batches b ON b.id=x.batch_id
 LEFT JOIN hms_med_movements m ON m.batch_id=x.batch_id AND m.location_id=x.location_id GROUP BY x.id,l.code,b.quantity`),
);
post("/stock/:batchId/status", ["pharmacist"], (r, t) =>
  I.setLotStatus(r.params.batchId, r.body, r.user, t),
);
post("/receipts", ["pharmacist"], (r, t) => I.receive(r.body, r.user, t), 201);
post(
  "/returns/:lineId",
  ["pharmacist"],
  (r, t) => I.returnSupply(r.params.lineId, r.body, r.user, t),
  201,
);
read("/returns", ["pharmacist"], () =>
  C.q(
    "SELECT r.*,l.product_id,l.batch_id FROM hms_med_returns r JOIN hms_med_dispense_lines l ON l.id=r.dispense_line_id ORDER BY r.recorded_at DESC LIMIT 200",
  ),
);
read("/requisitions", ["nurse", "pharmacist"], () =>
  C.q(
    "SELECT r.*,p.name AS product_name,l.name AS destination_name FROM hms_med_requisitions r JOIN hms_med_products p ON p.id=r.product_id JOIN hms_med_locations l ON l.id=r.destination_id ORDER BY r.created_at DESC LIMIT 200",
  ),
);
post(
  "/requisitions",
  ["nurse"],
  (r, t) => I.requisition(r.body, r.user, t),
  201,
);
for (const action of ["approve", "pick", "receive"])
  post(
    "/requisitions/:id/" + action,
    action === "receive" ? ["nurse"] : ["pharmacist"],
    (r, t) =>
      I.requisitionAction(
        r.params.id,
        action,
        r.body,
        r.user,
        r.headers["if-match"],
        t,
      ),
  );
read("/witness-requests", readers, (r) =>
  C.q(
    "SELECT r.*,p.name AS performer_name,w.name AS witness_name FROM hms_med_witness_requests r JOIN hms_users p ON p.id=r.performer_user_id JOIN hms_users w ON w.id=r.requested_witness_user_id WHERE r.performer_user_id=:user OR r.requested_witness_user_id=:user ORDER BY r.requested_at DESC LIMIT 200",
    { user: r.user.id,facility:Access.facility() },
  ),
);
post(
  "/witness-requests",
  readers,
  (r, t) => I.requestWitness(r.body, r.user, t),
  201,
);
post("/witness-requests/:id/attest", readers, (r, t) =>
  I.attestRequest(r.params.id, r.body, r.user, t),
);
post("/witnesses", readers, (r, t) => I.createWitness(r.body, r.user, t), 201);
post(
  "/wastage",
  ["pharmacist", "nurse"],
  (r, t) => I.wastage(r.body, r.user, t),
  201,
);
post(
  "/shift-counts",
  ["pharmacist", "nurse"],
  (r, t) => I.shiftCount(r.body, r.user, t),
  201,
);
read("/controlled/register", ["pharmacist", "nurse"], () =>
  C.q(
    "SELECT r.*,p.name,w.witness_user_id FROM hms_med_controlled_register r JOIN hms_med_products p ON p.id=r.product_id JOIN hms_med_witnesses w ON w.id=r.witness_id ORDER BY r.recorded_at DESC LIMIT 200",
  ),
);
read("/controlled/discrepancies", ["pharmacist", "nurse"], () =>
  C.q(
    "SELECT d.*,c.expected_quantity,c.counted_quantity,c.shift_ref,c.product_id,c.batch_id,c.location_id FROM hms_med_discrepancies d JOIN hms_med_shift_counts c ON c.id=d.count_id ORDER BY c.recorded_at DESC LIMIT 200",
  ),
);
post("/controlled/discrepancies/:id", ["pharmacist"], (r, t) =>
  I.discrepancyAction(r.params.id, r.body, r.user, t),
);
post(
  "/orders/:id/schedules",
  ["nurse", "pharmacist"],
  (r, t) => N.schedule(r.params.id, r.body, r.user, r.headers["if-match"], t),
  201,
);
post(
  "/orders/:id/prn",
  ["nurse"],
  (r, t) => N.prn(r.params.id, r.body, r.user, r.headers["if-match"], t),
  201,
);
read("/late-documentation-requests", ["doctor", "nurse"], (r) =>
  C.q(
    `SELECT r.*,o.patient_id,o.prescriber_user_id,p.name AS patient_name,p.uhid,v.product_snapshot FROM hms_med_late_documentation_requests r JOIN hms_med_schedules s ON s.id=r.schedule_id JOIN hms_med_order_versions v ON v.id=s.version_id JOIN hms_med_orders o ON o.id=v.order_id JOIN hms_patients p ON p.id=o.patient_id WHERE r.facility_id=:facility AND (r.performer_user_id=:user OR o.prescriber_user_id=:user) ORDER BY r.requested_at DESC LIMIT 200`,
    { user: r.user.id,facility:Access.facility() },
  ),
);
post(
  "/emar/:id/request-late-review",
  ["nurse"],
  (r, t) => N.requestLate(r.params.id, r.body, r.user, t),
  201,
);
post("/late-documentation-requests/:id/review", ["doctor"], (r, t) =>
  N.reviewLate(r.params.id, r.body, r.user, t),
);
read("/emar", readers, (r) =>
  C.q(
    `SELECT s.*,o.id AS order_id,o.revision AS order_revision,o.state AS order_state,v.dose,v.dose_unit,v.route,v.product_id,v.product_snapshot,v.indication,v.max_dose,v.prn,
 p.name AS patient_name,p.uhid,a.id AS administration_id,a.actual_at,a.recorded_at,a.outcome,a.performer_user_id,
 i.id AS documentation_intent_id,i.state AS documentation_state,i.performer_user_id AS documentation_owner_user_id,i.scan_evidence AS documentation_scan_evidence,
 coalesce((SELECT jsonb_agg(c) FROM hms_med_corrections c WHERE c.administration_id=a.id),'[]') AS corrections
 FROM hms_med_schedules s JOIN hms_med_order_versions v ON v.id=s.version_id JOIN hms_med_orders o ON o.id=v.order_id JOIN hms_patients p ON p.id=s.patient_id
 LEFT JOIN hms_med_administrations a ON a.schedule_id=s.id LEFT JOIN hms_med_documentation_intents i ON i.schedule_id=s.id
 WHERE s.facility_id=:facility AND (:patient IS NULL OR s.patient_id=:patient) AND ${careFilter("s.patient_id")} ORDER BY s.scheduled_at DESC LIMIT 200`,
    {
      careDoctor: careDoctor(r),
      facility:Access.facility(),
      patient: r.query.patient_id
        ? C.integer(r.query.patient_id, "Patient")
        : null,
    },
  ),
);
post(
  "/emar/:id/prepare",
  ["nurse"],
  (r, t) => N.prepare(r.params.id, r.body, r.user, t),
  201,
);
post(
  "/emar/:id/record",
  ["nurse"],
  (r, t) => N.administer(r.params.id, r.body, r.user, t),
  201,
);
post(
  "/administrations/:id/corrections",
  ["nurse", "doctor"],
  (r, t) => N.correct(r.params.id, r.body, r.user, t),
  201,
);
read("/tasks", readers, (r) =>
  C.q(
    "SELECT * FROM hms_med_tasks WHERE facility_id=:facility AND assigned_user_id=:user AND state<>'CLOSED' ORDER BY created_at",
    { user: r.user.id,facility:Access.facility() },
  ),
);
post("/tasks/:id", ["doctor", "nurse", "pharmacist"], (r, t) =>
  N.taskAction(r.params.id, r.body, r.user, t),
);
read("/handovers", ["nurse"], (r) =>
  C.q(
    "SELECT * FROM hms_med_handovers WHERE facility_id=:facility AND (sender_user_id=:user OR receiver_user_id=:user) ORDER BY sent_at DESC LIMIT 200",
    { user: r.user.id,facility:Access.facility() },
  ),
);
post("/handovers", ["nurse"], (r, t) => N.handover(r.body, r.user, t), 201);
post("/handovers/:id/acknowledge", ["nurse"], (r, t) =>
  N.acknowledgeHandover(r.params.id, r.body, r.user, r.headers["if-match"], t),
);
module.exports = router;
