const express = require("express"),
  router = express.Router();
const { protect, restrictTo } = require("../middleware/auth");
const C = require("../services/laboratoryCommon"),
  Cat = require("../services/laboratoryCatalogue"),
  S = require("../services/laboratorySpecimens"),
  R = require("../services/laboratoryResults"),
  F = require("../services/laboratoryFollowup"),
  O = require("../services/laboratoryOrders"),
  Config = require("../services/laboratoryConfiguration"),
  A = require("../services/laboratoryAnalyzer");
const { beforeSend } = require("../utils/responseGate"),
  { storage } = require("../utils/auditContext");
const readers = ["doctor", "nurse", "lab_technician", "admin", "super_admin"];
router.use(protect);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (req.method === "GET")
    beforeSend(res, 20, async () => {
      if (res.statusCode >= 400) return;
      await storage.run({ ...storage.getStore(), command: null }, () =>
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
              Number(req.query.patient_id) || res.locals.labPatientId || null,
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
      const data = command
        ? await C.sequelize.transaction((tx) => fn(req, tx))
        : await fn(req);
      res.status(status).json({ success: true, data });
    } catch (e) {
      console.error(
        "Laboratory command:",
        e.code || e.original?.code || e.name,
      );
      res
        .status(
          e.status ||
            (["23503", "23505", "23514", "22P02"].includes(e.original?.code)
              ? 422
              : 500),
        )
        .json({
          success: false,
          code: e.code || "LAB_COMMAND_FAILED",
          message: e.status
            ? e.message
            : "The laboratory operation could not be confirmed. Preserve the draft and request key.",
        });
    }
  };
const doctor = (r) => (r.user.role === "doctor" ? r.user.id : null);
const care = "(:doctor::int IS NULL OR patient_in_care(:doctor,o.patient_id))";
router.get(
  "/catalogue",
  restrictTo(...readers),
  wrap(() => Cat.catalogue()),
);
router.post(
  "/catalogue",
  restrictTo("doctor", "lab_technician"),
  wrap((r, t) => Cat.create(r.body, r.user, t), true, 201),
);
router.get(
  "/privileges",
  restrictTo(...readers),
  wrap((r) =>
    C.q(
      "SELECT * FROM hms_lab_privileges WHERE user_id=:user AND revoked_at IS NULL AND valid_from<=now() AND valid_until>now()",
      { user: r.user.id },
    ),
  ),
);
router.post(
  "/privileges",
  restrictTo("admin", "super_admin"),
  wrap(
    async (r, t) => {
      const user = await C.one(
        "SELECT id,role FROM hms_users WHERE id=:id AND is_active=1 FOR SHARE",
        { id: C.integer(r.body.user_id) },
        t,
      );
      C.check(
        user && ["doctor", "lab_technician"].includes(user.role),
        "INVALID_RECIPIENT",
        "Grant laboratory privileges to active clinical/laboratory accounts.",
      );
      C.check(
        r.body.privilege !== "RELEASE" || user.role === "doctor",
        "INVALID_RELEASER",
        "Report release requires a clinical practitioner.",
      );
      return C.one(
        `INSERT INTO hms_lab_privileges(user_id,privilege,granted_by_user_id,reason,valid_from,valid_until)
 VALUES(:user,:privilege,:actor,:reason,:from,:until) RETURNING *`,
        {
          user: user.id,
          privilege: r.body.privilege,
          actor: r.user.id,
          reason: C.text(r.body.reason, "Grant reason"),
          from: require("../services/medicationCommon").instant(
            r.body.valid_from,
            "Valid from",
          ),
          until: require("../services/medicationCommon").instant(
            r.body.valid_until,
            "Valid until",
          ),
        },
        t,
      );
    },
    true,
    201,
  ),
);
router.post(
  "/privileges/:id/revoke",
  restrictTo("admin", "super_admin"),
  wrap(async (r, t) => {
    C.text(r.body.reason, "Revocation reason");
    return C.one(
      "UPDATE hms_lab_privileges SET revoked_at=now(),reason=reason || :reason WHERE id=:id AND revoked_at IS NULL RETURNING *",
      { id: C.id(r.params.id), reason: "; Revoked: " + r.body.reason },
      t,
    );
  }, true),
);
router.post(
  "/configuration/:kind",
  restrictTo("doctor", "lab_technician"),
  wrap((r, t) => Config.configure(r.params.kind, r.body, r.user, t), true, 201),
);
router.get(
  "/configuration/:kind",
  restrictTo("doctor", "lab_technician"),
  wrap((r) => {
    C.check(
      Config.tables[r.params.kind],
      "INVALID_POLICY",
      "Unknown configuration kind.",
    );
    return C.q(
      `SELECT * FROM ${Config.tables[r.params.kind]} ORDER BY effective_at DESC LIMIT 200`,
    );
  }),
);
router.post(
  "/qc",
  restrictTo("doctor", "lab_technician"),
  wrap((r, t) => Config.qc(r.body, r.user, t), true, 201),
);
router.get(
  "/qc",
  restrictTo("doctor", "lab_technician"),
  wrap(() =>
    C.q(
      "SELECT q.*,r.test_version_id,r.method FROM hms_lab_qc_records q JOIN hms_lab_qc_rules r ON r.id=q.rule_id ORDER BY q.recorded_at DESC LIMIT 200",
    ),
  ),
);
router.get(
  "/worklist",
  restrictTo(...readers),
  wrap(async (r) => {
    const values = {
      doctor: doctor(r),
      patient: r.query.patient_id ? C.integer(r.query.patient_id) : null,
    };
    const orders = await C.q(
      `SELECT o.*,p.name AS patient_name,p.uhid,p.age,p.gender FROM hms_investigation_orders o JOIN hms_patients p ON p.id=o.patient_id
 WHERE ${care} AND (:patient::int IS NULL OR o.patient_id=:patient) ORDER BY o.created_at DESC,o.id DESC LIMIT 200`,
      values,
    );
    for (const o of orders) {
      o.items = await C.q(
        `SELECT i.*,t.unit,t.method FROM hms_investigation_order_items i LEFT JOIN hms_lab_test_versions t ON t.id=i.lab_test_version_id WHERE i.order_id=:id ORDER BY i.id`,
        { id: o.id },
      );
      for (const i of o.items) {
        i.requirements = i.lab_test_version_id
          ? await C.q(
              "SELECT * FROM hms_lab_requirements WHERE test_version_id=:id",
              { id: i.lab_test_version_id },
            )
          : [];
        i.result = await C.one(
          "SELECT r.*,v.decision AS technical_decision FROM hms_lab_result_versions r LEFT JOIN hms_lab_technical_reviews v ON v.result_version_id=r.id WHERE r.item_id=:id ORDER BY r.version DESC LIMIT 1",
          { id: i.id },
        );
        i.specimens = await C.q(
          "SELECT DISTINCT s.* FROM hms_lab_specimens s JOIN hms_lab_specimen_links l ON l.specimen_id=s.id WHERE l.item_id=:id ORDER BY s.created_at",
          { id: i.id },
        );
      }
      o.report_versions = await C.q(
        "SELECT v.* FROM hms_lab_report_versions v JOIN hms_lab_reports p ON p.id=v.report_id WHERE p.order_id=:id ORDER BY v.version DESC",
        { id: o.id },
      );
    }
    return orders;
  }),
);
router.post(
  "/orders",
  restrictTo("doctor"),
  wrap((r, t) => O.create(r.body, r.user, t), true, 201),
);
router.post(
  "/orders/:id/cancel",
  restrictTo("doctor", "lab_technician"),
  wrap((r, t) => O.cancel(r.params.id, r.user, r.headers["if-match"], t), true),
);
router.post(
  "/orders/:id/release",
  restrictTo("doctor"),
  wrap(
    (r, t) => R.release(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
    201,
  ),
);
router.post(
  "/items/:id/reconcile",
  restrictTo("doctor", "lab_technician"),
  wrap(
    (r, t) =>
      Cat.linkLegacy(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
  ),
);
router.post(
  "/specimens",
  restrictTo("lab_technician", "nurse"),
  wrap((r, t) => S.create(r.body, r.user, t), true, 201),
);
router.post(
  "/specimens/:id/transition",
  restrictTo("lab_technician", "nurse"),
  wrap(
    (r, t) =>
      S.transition(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
  ),
);
router.get(
  "/specimens/:id/custody",
  restrictTo(...readers),
  wrap(async (r) => {
    const s = await C.one("SELECT * FROM hms_lab_specimens WHERE id=:id", {
      id: C.id(r.params.id),
    });
    C.check(s, "NOT_FOUND", "Specimen not found.", 404);
    await C.scope(r.user, s.patient_id);
    return {
      specimen: s,
      custody: await C.q(
        "SELECT * FROM hms_lab_custody WHERE specimen_id=:id ORDER BY recorded_at,id",
        { id: s.id },
      ),
    };
  }),
);
router.post(
  "/items/:id/results",
  restrictTo("lab_technician"),
  wrap(
    (r, t) => R.write(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
    201,
  ),
);
router.post(
  "/results/:id/technical-review",
  restrictTo("doctor", "lab_technician"),
  wrap(
    (r, t) => R.review(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
  ),
);
router.post(
  "/analyzer-messages",
  restrictTo("lab_technician"),
  wrap((r, t) => A.ingest(r.body, r.user, t), true, 202),
);
router.post(
  "/reconciliation/:id/resolve",
  restrictTo("lab_technician"),
  wrap(
    (r, t) => A.resolve(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
  ),
);
router.get(
  "/reconciliation",
  restrictTo("doctor", "lab_technician"),
  wrap((r) =>
    C.q(
      `SELECT r.* FROM hms_lab_reconciliation r LEFT JOIN hms_investigation_order_items i ON i.id=r.item_id LEFT JOIN hms_investigation_orders o ON o.id=i.order_id
 WHERE r.state='PENDING' AND (:doctor::int IS NULL OR (r.item_id IS NOT NULL AND patient_in_care(:doctor,o.patient_id))) ORDER BY r.created_at LIMIT 200`,
      { doctor: doctor(r) },
    ),
  ),
);
router.get(
  "/recollections",
  restrictTo(...readers),
  wrap((r) =>
    C.q(
      `SELECT r.*,o.patient_id FROM hms_lab_recollections r JOIN hms_investigation_order_items i ON i.id=r.item_id JOIN hms_investigation_orders o ON o.id=i.order_id WHERE completed_at IS NULL AND ${care} ORDER BY r.created_at`,
      { doctor: doctor(r) },
    ),
  ),
);
router.get(
  "/critical-tasks",
  restrictTo(...readers),
  wrap((r) =>
    C.q(
      `SELECT * FROM hms_lab_critical_tasks WHERE (:doctor::int IS NULL OR patient_in_care(:doctor,patient_id)) ORDER BY created_at DESC LIMIT 200`,
      { doctor: doctor(r) },
    ),
  ),
);
router.post(
  "/critical-tasks/advance",
  restrictTo("lab_technician"),
  wrap((r, t) => F.advance(r.user, t), true),
);
router.post(
  "/critical-tasks/:id/action",
  restrictTo("doctor"),
  wrap(
    (r, t) =>
      F.taskCommand(r.params.id, r.body, r.user, r.headers["if-match"], t),
    true,
  ),
);
router.get(
  "/critical-tasks/:id/deliveries",
  restrictTo(...readers),
  wrap(async (r) => {
    const task = await C.one(
      "SELECT * FROM hms_lab_critical_tasks WHERE id=:id",
      { id: C.id(r.params.id) },
    );
    C.check(task, "NOT_FOUND", "Task not found.", 404);
    await C.scope(r.user, task.patient_id);
    return C.q(
      "SELECT * FROM hms_lab_delivery_attempts WHERE task_id=:id ORDER BY created_at,id",
      { id: task.id },
    );
  }),
);
router.post(
  "/critical-tasks/:id/deliveries",
  restrictTo("lab_technician"),
  wrap(async (r, t) => {
    const task = await C.one(
      "SELECT * FROM hms_lab_critical_tasks WHERE id=:id FOR UPDATE",
      { id: C.id(r.params.id) },
      t,
    );
    C.check(task, "NOT_FOUND", "Task not found.", 404);
    C.check(task.state !== "CLOSED", "TASK_CLOSED", "The task is closed.", 409);
    return {
      outcome: await F.delivery(
        task,
        C.integer(r.body.recipient_user_id),
        task.escalation_level,
        r.user,
        t,
        C.text(r.body.channel, "Channel"),
        C.text(r.body.outcome, "Outcome"),
        C.text(r.body.evidence, "Contact evidence"),
      ),
    };
  }, true),
);
router.get(
  "/review-tasks",
  restrictTo(...readers),
  wrap((r) =>
    C.q(
      `SELECT * FROM hms_lab_review_tasks WHERE (:doctor::int IS NULL OR patient_in_care(:doctor,patient_id)) ORDER BY created_at DESC LIMIT 200`,
      { doctor: doctor(r) },
    ),
  ),
);
router.post(
  "/review-tasks/:id/action",
  restrictTo("doctor"),
  wrap(
    (r, t) =>
      F.taskCommand(
        r.params.id,
        r.body,
        r.user,
        r.headers["if-match"],
        t,
        "review",
      ),
    true,
  ),
);
router.get(
  "/reports/:id",
  restrictTo(...readers),
  wrap(async (r) => {
    const version = await C.one(
      "SELECT v.*,p.order_id,o.patient_id FROM hms_lab_report_versions v JOIN hms_lab_reports p ON p.id=v.report_id JOIN hms_investigation_orders o ON o.id=p.order_id WHERE v.id=:id",
      { id: C.id(r.params.id) },
    );
    C.check(version, "NOT_FOUND", "Report version not found.", 404);
    await C.scope(r.user, version.patient_id);
    return {
      version,
      results: await C.q(
        "SELECT r.*,i.item_name FROM hms_lab_report_results l JOIN hms_lab_result_versions r ON r.id=l.result_version_id JOIN hms_investigation_order_items i ON i.id=r.item_id WHERE l.report_version_id=:id ORDER BY l.position",
        { id: version.id },
      ),
    };
  }),
);
router.get("/reports/:id/pdf", restrictTo(...readers), async (r, res) => {
  try {
    const v = await C.one(
      "SELECT v.*,p.order_id,o.patient_id FROM hms_lab_report_versions v JOIN hms_lab_reports p ON p.id=v.report_id JOIN hms_investigation_orders o ON o.id=p.order_id WHERE v.id=:id",
      { id: C.id(r.params.id) },
    );
    C.check(v, "NOT_FOUND", "Report version not found.", 404);
    await C.scope(r.user, v.patient_id);
    res.locals.labPatientId = v.patient_id;
    const results = await C.q(
      "SELECT r.*,i.item_name FROM hms_lab_report_results l JOIN hms_lab_result_versions r ON r.id=l.result_version_id JOIN hms_investigation_order_items i ON i.id=r.item_id WHERE l.report_version_id=:id ORDER BY l.position",
      { id: v.id },
    );
    const PDF = require("pdfkit"),
      doc = new PDF({ margin: 40 });
    res.type("pdf");
    res.set(
      "Content-Disposition",
      `attachment; filename="lab-${v.order_id}-v${v.version}.pdf"`,
    );
    doc.pipe(res);
    doc.fontSize(18).text(`Diagnostic report: ${v.status}`);
    doc
      .fontSize(10)
      .text(
        `Order ${v.order_id}; patient ${v.patient_id}; report version ${v.version}`,
      );
    doc.text(
      `Released ${new Date(v.released_at).toISOString()} by user ${v.released_by_user_id}`,
    );
    doc.text(v.reason);
    for (const x of results) {
      doc.moveDown().fontSize(12).text(x.item_name);
      doc
        .fontSize(10)
        .text(
          `${x.normalized_value} ${x.normalized_unit}; ${x.abnormal_flag.replace(/_/g, " ")}`,
        );
      doc.text(
        `Method: ${x.method}; result version ${x.version}; accession specimen ${x.specimen_id}`,
      );
      if (x.remarks) doc.text(x.remarks);
    }
    doc.end();
  } catch (e) {
    if (!res.headersSent)
      res
        .status(e.status || 500)
        .json({
          success: false,
          code: e.code || "REPORT_UNAVAILABLE",
          message: e.status ? e.message : "Report unavailable.",
        });
  }
});
module.exports = router;
