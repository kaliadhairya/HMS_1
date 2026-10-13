// Synthetic clinical content is confined to this fixture. Real HTTP commands
// use independent PostgreSQL command transactions; never run against hms.
const {
  api,
  apiLogin,
  sql,
  inCare,
  runner,
  assert,
  requireThrowawayDb,
} = require("./helpers");
const crypto = require("crypto");
requireThrowawayDb();
assert(
  /^hms_p4_/.test(process.env.DB_NAME || ""),
  "Use a Phase 4 test database",
);
const { step, done } = runner("Phase 4 laboratory safety"),
  tag = crypto.randomUUID().slice(0, 8);
const tokens = {},
  ctx = {};
let pid, eid, uid, labid, a, b, c, ruleA, ruleB, spec, order, r1, r2, critical;
const call = async (
  method,
  path,
  role = "lab_technician",
  body,
  revision,
  key,
) =>
  api(method, "/laboratory" + path, {
    token: tokens[role],
    body,
    headers: {
      ...(revision !== undefined ? { "if-match": String(revision) } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
  });
const ok = (r, status = 200) => {
  assert(
    r.status === status,
    `${r.status}: ${JSON.stringify(r.data).slice(0, 500)}`,
  );
  return r.data.data;
};
const at = new Date(Date.now() - 3600000).toISOString();
const getItem = async (id) =>
  (
    await sql("SELECT * FROM hms_investigation_order_items WHERE id=$1", [id])
  )[0];
const orderFor = async (versions) =>
  ok(
    await call("POST", "/orders", "doctor", {
      patient_id: pid,
      encounter_id: eid,
      test_version_ids: versions,
    }),
    201,
  );
const specimenFor = async (
  o,
  type = "TEST-BLOOD",
  container = "TEST-TUBE",
  items = o.items,
) => {
  const links = [];
  for (const i of items) {
    const reqs = await sql(
      "SELECT * FROM hms_lab_requirements WHERE test_version_id=$1 AND specimen_type=$2 AND container=$3",
      [i.lab_test_version_id, type, container],
    );
    for (const r of reqs) links.push({ item_id: i.id, requirement_id: r.id });
  }
  return ok(
    await call("POST", "/specimens", "lab_technician", {
      patient_id: pid,
      specimen_type: type,
      container,
      location: "TEST-COLLECTION",
      links,
    }),
    201,
  );
};
const move = async (s, state, extra = {}) =>
  ok(
    await call(
      "POST",
      `/specimens/${s.id}/transition`,
      "lab_technician",
      {
        patient_id: s.patient_id,
        accession: s.accession,
        state,
        location: "TEST-LAB",
        reason: "Synthetic custody evidence",
        ...extra,
      },
      s.revision,
    ),
  );
const receive = async (s) => move(await move(s, "COLLECTED"), "RECEIVED");
const enter = async (o, i, s, value = "5", extra = {}) =>
  ok(
    await call(
      "POST",
      `/items/${i.id}/results`,
      "lab_technician",
      {
        specimen_id: s.id,
        raw_value: value,
        unit: "TEST-U",
        method: "TEST-METHOD",
        ...extra,
      },
      (await getItem(i.id)).lab_revision,
    ),
    201,
  );
const review = async (result, item, rule, decision = "VERIFIED") => {
  const qc = ok(
    await call("POST", "/qc", "lab_technician", {
      rule_id: rule.id,
      status: "PASS",
      evidence: { synthetic_control: "fixture-pass" },
    }),
    201,
  );
  return ok(
    await call(
      "POST",
      `/results/${result.id}/technical-review`,
      "lab_technician",
      {
        qc_record_id: qc.id,
        decision,
        reason: "Synthetic technical validation",
      },
      (await getItem(item.id)).lab_revision,
    ),
  );
};
(async () => {
  await step(
    "Prepare isolated patient, encounter, scoped clinicians and laboratory grants",
    async () => {
      for (const role of [
        "doctor",
        "lab_technician",
        "super_admin",
        "nurse",
        "pharmacist",
        "receptionist",
      ])
        tokens[role] = await apiLogin(role);
      [{ id: uid }] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      [{ id: labid }] = await sql(
        "SELECT id FROM hms_users WHERE username='labtech'",
      );
      [{ id: pid }] = await sql(
        "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",
        ["Synthetic lab " + tag, "P4-" + tag],
      );
      await inCare(pid);
      [{ id: eid }] = await sql(
        "INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'In Progress') RETURNING id",
        [pid, uid],
      );
      for (const [user, privilege] of [
        [labid, "CONTENT"],
        [labid, "TECHNICAL_REVIEW"],
        [labid, "ANALYZER"],
        [uid, "RELEASE"],
      ])
        ok(
          await call("POST", "/privileges", "super_admin", {
            user_id: user,
            privilege,
            reason: "Synthetic isolated acceptance fixture",
            valid_from: at,
            valid_until: new Date(Date.now() + 86400000).toISOString(),
          }),
          201,
        );
    },
  );
  await step(
    "Coded catalogue carries immutable method/unit and declared specimen requirements",
    async () => {
      const test = async (
        code,
        requirements = [
          { specimen_type: "TEST-BLOOD", container: "TEST-TUBE" },
        ],
      ) =>
        ok(
          await call("POST", "/catalogue", "lab_technician", {
            code_system: "TEST",
            code: tag + code,
            kind: "TEST",
            name: "Synthetic " + code + " " + tag,
            section: "TEST-SECTION",
            unit: "TEST-U",
            method: "TEST-METHOD",
            provenance: "Synthetic acceptance content only",
            effective_at: at,
            requirements,
          }),
          201,
        );
      a = await test("A");
      b = await test("B");
      c = await test("C", [
        { specimen_type: "TEST-BLOOD", container: "TEST-TUBE" },
        { specimen_type: "TEST-URINE", container: "TEST-POT" },
      ]);
      const cfg = async (kind, body) =>
        ok(
          await call("POST", "/configuration/" + kind, "lab_technician", {
            test_version_id: a.id,
            version: 1,
            method: "TEST-METHOD",
            provenance: "Synthetic fixture only",
            effective_at: at,
            ...body,
          }),
          201,
        );
      ruleA = await cfg("qc", {
        criteria: { synthetic_control: "recorded comparison" },
      });
      ruleB = await cfg("qc", {
        test_version_id: b.id,
        criteria: { synthetic_control: "recorded comparison" },
      });
      const panel = ok(
        await call("POST", "/catalogue", "lab_technician", {
          code_system: "TEST",
          code: tag + "PANEL",
          kind: "PANEL",
          name: "Synthetic panel",
          section: "TEST-SECTION",
          provenance: "Synthetic fixture",
          effective_at: at,
          members: [a.id, b.id],
        }),
        201,
      );
      order = await orderFor([panel.id]);
      assert(
        order.items.length === 2,
        "Panel did not expand to two coded tests",
      );
    },
  );
  await step(
    "Free-text ordering and legacy report writes cannot bypass governed workflow",
    async () => {
      let r = await api("POST", "/hms/investigation-orders", {
        token: tokens.doctor,
        body: {
          patient_id: pid,
          encounter_id: eid,
          items: [{ test_name: "Guess identity" }],
        },
      });
      assert(r.status === 400, "Free-text order accepted");
      for (const [method, path, role, body] of [
        ["POST", "/reports", "lab_technician", { patientId: pid }],
        ["PUT", "/reports/1", "lab_technician", {}],
        [
          "POST",
          "/lab/samples",
          "lab_technician",
          { itemId: order.items[0].id },
        ],
      ]) {
        r = await api(method, path, { token: tokens[role], body });
        assert(r.status === 410, `Legacy path ${path}: ${r.status}`);
      }
    },
  );
  await step(
    "One accession supports several ordered tests and prevents patient mismatch",
    async () => {
      spec = await specimenFor(order);
      assert(
        (
          await sql(
            "SELECT * FROM hms_lab_specimen_links WHERE specimen_id=$1",
            [spec.id],
          )
        ).length === 2,
        "Multi-test specimen links missing",
      );
      const r = await call(
        "POST",
        `/specimens/${spec.id}/transition`,
        "lab_technician",
        {
          patient_id: pid + 100000,
          accession: spec.accession,
          state: "COLLECTED",
          location: "TEST",
          reason: "Mismatch",
        },
        spec.revision,
      );
      assert(r.status === 422, "Mismatched patient accepted");
      spec = await receive(spec);
      assert(
        spec.received_at && spec.collector_user_id === labid,
        "Actual collection/receipt identity missing",
      );
    },
  );
  await step(
    "Two simultaneous writers cannot overwrite one result",
    async () => {
      const i = order.items[0],
        revision = (await getItem(i.id)).lab_revision,
        body = {
          specimen_id: spec.id,
          raw_value: "5",
          unit: "TEST-U",
          method: "TEST-METHOD",
        };
      const outcomes = await Promise.all([
        call(
          "POST",
          `/items/${i.id}/results`,
          "lab_technician",
          body,
          revision,
        ),
        call(
          "POST",
          `/items/${i.id}/results`,
          "lab_technician",
          { ...body, raw_value: "6" },
          revision,
        ),
      ]);
      assert(
        outcomes.filter((r) => r.status === 201).length === 1 &&
          outcomes.filter((r) => r.status === 412).length === 1,
        "Expected one commit and one stale-version rejection",
      );
      r1 = ok(
        outcomes.find((r) => r.status === 201),
        201,
      ).result;
      assert(
        (
          await sql("SELECT id FROM hms_lab_result_versions WHERE item_id=$1", [
            i.id,
          ])
        ).length === 1,
        "Result evidence overwritten or duplicated",
      );
    },
  );
  await step(
    "Missing approved interval is explicit and unit mismatch cannot invent conversion",
    async () => {
      assert(
        r1.abnormal_flag === "NO_REFERENCE_INTERVAL",
        "Missing interval reported normal",
      );
      const r = await call(
        "POST",
        `/items/${order.items[1].id}/results`,
        "lab_technician",
        {
          specimen_id: spec.id,
          raw_value: "5",
          unit: "UNKNOWN-U",
          method: "TEST-METHOD",
        },
        0,
      );
      assert(
        r.status === 422 && r.data.code === "UNIT_MISMATCH",
        "Unapproved unit conversion accepted",
      );
    },
  );
  await step(
    "QC failure sends a result to repeat processing and prevents release",
    async () => {
      r2 = (await enter(order, order.items[1], spec)).result;
      const qc = ok(
        await call("POST", "/qc", "lab_technician", {
          rule_id: ruleB.id,
          status: "FAIL",
          evidence: { synthetic_control: "fixture-failure" },
        }),
        201,
      );
      const reviewed = ok(
        await call(
          "POST",
          `/results/${r2.id}/technical-review`,
          "lab_technician",
          {
            qc_record_id: qc.id,
            decision: "VERIFIED",
            reason: "Synthetic failed QC",
          },
          1,
        ),
      );
      assert(reviewed.decision === "REPEAT", "QC failure verified");
      const r = await call(
        "POST",
        `/orders/${order.id}/release`,
        "doctor",
        {
          status: "FINAL",
          reason: "Attempt unsafe release",
          result_version_ids: [r1.id, r2.id],
        },
        0,
      );
      assert(r.status === 409, "Failed QC released");
    },
  );
  await step(
    "Critical policies and intervals are separate approved configuration",
    async () => {
      const escalation = ok(
        await call("POST", "/configuration/escalation", "lab_technician", {
          code: tag + "ESC",
          version: 1,
          provenance: "Synthetic escalation fixture",
          effective_at: at,
          steps: [
            { after_seconds: 3600, recipient_user_id: uid },
            { after_seconds: 7200, recipient_user_id: uid },
          ],
        }),
        201,
      );
      ok(
        await call("POST", "/configuration/reference", "lab_technician", {
          test_version_id: a.id,
          version: 1,
          method: "TEST-METHOD",
          unit: "TEST-U",
          lower_bound: "1",
          upper_bound: "10",
          lower_inclusive: true,
          upper_inclusive: true,
          provenance: "Synthetic reference fixture",
          effective_at: at,
        }),
        201,
      );
      ok(
        await call("POST", "/configuration/critical", "lab_technician", {
          test_version_id: a.id,
          version: 1,
          method: "TEST-METHOD",
          unit: "TEST-U",
          upper_bound: "4",
          lower_inclusive: false,
          upper_inclusive: false,
          escalation_policy_id: escalation.id,
          provenance: "Synthetic critical fixture",
          effective_at: at,
        }),
        201,
      );
      const t = await review(r1, order.items[0], ruleA);
      critical = t.critical_task;
      assert(
        critical?.state === "OPEN",
        "Verified preliminary critical finding did not create durable task before release",
      );
    },
  );
  await step(
    "Missed acknowledgment escalates on the configured timetable and remains unresolved",
    async () => {
      await sql(
        "UPDATE hms_lab_critical_tasks SET next_due_at=now()-interval '1 second' WHERE id=$1",
        [critical.id],
      );
      ok(await call("POST", "/critical-tasks/advance", "lab_technician", {}));
      const [t] = await sql(
        "SELECT * FROM hms_lab_critical_tasks WHERE id=$1",
        [critical.id],
      );
      assert(
        t.state === "OPEN" && t.escalation_level === 0,
        "Escalation incorrectly acknowledged/closed task",
      );
      assert(
        (
          await sql(
            "SELECT id FROM hms_lab_delivery_attempts WHERE task_id=$1",
            [critical.id],
          )
        ).length === 2,
        "Escalation delivery evidence missing",
      );
      critical = t;
    },
  );
  await step(
    "Unavailable recipient is recorded without claiming delivery or completing follow-up",
    async () => {
      await sql("UPDATE hms_users SET is_active=0 WHERE id=$1", [uid]);
      try {
        ok(
          await call(
            "POST",
            "/critical-tasks/" + critical.id + "/deliveries",
            "lab_technician",
            {
              recipient_user_id: uid,
              outcome: "UNAVAILABLE",
              channel: "PHONE",
              evidence: "Synthetic recipient unavailable",
            },
          ),
        );
      } finally {
        await sql("UPDATE hms_users SET is_active=1 WHERE id=$1", [uid]);
        tokens.doctor = await apiLoginFresh("doctor");
      }
      const [t] = await sql(
        "SELECT state FROM hms_lab_critical_tasks WHERE id=$1",
        [critical.id],
      );
      assert(t.state === "OPEN", "Unavailable contact closed task");
    },
  );
  await step(
    "Clinical acknowledgment and documented action are separate commands",
    async () => {
      let t = ok(
        await call(
          "POST",
          `/critical-tasks/${critical.id}/action`,
          "doctor",
          {
            action: "acknowledge",
            reason: "Synthetic clinician acknowledgment",
          },
          critical.revision,
        ),
      );
      assert(t.state === "ACKNOWLEDGED", "No acknowledgment");
      t = ok(
        await call(
          "POST",
          `/critical-tasks/${critical.id}/action`,
          "doctor",
          {
            action: "close",
            clinical_action: "Synthetic documented clinical disposition",
          },
          t.revision,
        ),
      );
      assert(
        t.state === "CLOSED" && t.clinical_action,
        "Clinical action missing",
      );
    },
  );
  await step(
    "Repeating a failed-QC result retains prior evidence and requires linked correction",
    async () => {
      const bad = await call(
        "POST",
        `/items/${order.items[1].id}/results`,
        "lab_technician",
        {
          specimen_id: spec.id,
          raw_value: "7",
          unit: "TEST-U",
          method: "TEST-METHOD",
        },
        2,
      );
      assert(bad.status === 422, "Reviewed result silently replaced");
      r2 = (
        await enter(order, order.items[1], spec, "7", {
          correction_of_id: r2.id,
          correction_reason: "Synthetic repeat after failed QC",
        })
      ).result;
      await review(r2, order.items[1], ruleB);
    },
  );
  await step(
    "Final report contains exact immutable versions and release requires explicit privilege",
    async () => {
      const bad = await call(
        "POST",
        `/orders/${order.id}/release`,
        "lab_technician",
        {
          status: "FINAL",
          reason: "Wrong role",
          result_version_ids: [r1.id, r2.id],
        },
        0,
      );
      assert(bad.status === 403, "Technician released report");
      ctx.report = ok(
        await call(
          "POST",
          `/orders/${order.id}/release`,
          "doctor",
          {
            status: "FINAL",
            reason: "Synthetic authorized release",
            result_version_ids: [r1.id, r2.id],
          },
          0,
        ),
        201,
      );
      const original = ok(
        await call("GET", "/reports/" + ctx.report.version.id, "doctor"),
      );
      assert(original.results.length === 2, "Final report lost analyte");
      const [o] = await sql(
        "SELECT status FROM hms_investigation_orders WHERE id=$1",
        [order.id],
      );
      assert(o.status === "Completed", "Order completion lost");
    },
  );
  await step(
    "Amended critical finding creates a new communication cycle and preserves the original",
    async () => {
      const corrected = (
        await enter(order, order.items[0], spec, "8", {
          correction_of_id: r1.id,
          correction_reason: "Synthetic correction",
        })
      ).result;
      const t = await review(corrected, order.items[0], ruleA);
      assert(
        t.critical_task && t.critical_task.id !== critical.id,
        "Amendment did not restart critical communication",
      );
      ctx.amended = ok(
        await call(
          "POST",
          `/orders/${order.id}/release`,
          "doctor",
          {
            status: "AMENDED",
            reason: "Synthetic amended release",
            result_version_ids: [corrected.id, r2.id],
          },
          1,
        ),
        201,
      );
      const original = ok(
        await call("GET", "/reports/" + ctx.report.version.id, "doctor"),
      );
      assert(
        original.results.find((x) => x.id === r1.id)?.normalized_value ===
          r1.normalized_value,
        "Original report altered",
      );
      assert(
        ctx.amended.version.previous_version_id === ctx.report.version.id,
        "Amended report lineage missing",
      );
    },
  );
  await step(
    "Concurrent completion of different analytes preserves both current verified states",
    async () => {
      const o = await orderFor([a.id, b.id]),
        s = await receive(await specimenFor(o));
      const rs = await Promise.all(o.items.map((i) => enter(o, i, s, "5")));
      await Promise.all(
        rs.map((r, index) =>
          review(r.result, o.items[index], index === 0 ? ruleA : ruleB),
        ),
      );
      const v = ok(
        await call(
          "POST",
          `/orders/${o.id}/release`,
          "doctor",
          {
            status: "FINAL",
            reason: "Concurrent synthetic release",
            result_version_ids: rs.map((r) => r.result.id),
          },
          0,
        ),
        201,
      );
      assert(
        (
          await sql(
            "SELECT result_version_id FROM hms_lab_report_results WHERE report_version_id=$1",
            [v.version.id],
          )
        ).length === 2,
        "Concurrent analyte completion lost",
      );
    },
  );
  await step(
    "Multi-specimen order cannot be processed until every required specimen is received",
    async () => {
      const o = await orderFor([c.id]),
        s = await receive(await specimenFor(o));
      const r = await call(
        "POST",
        `/items/${o.items[0].id}/results`,
        "lab_technician",
        {
          specimen_id: s.id,
          raw_value: "5",
          unit: "TEST-U",
          method: "TEST-METHOD",
        },
        0,
      );
      assert(r.status === 409, "Missing required urine specimen ignored");
      const urine = await receive(
        await specimenFor(o, "TEST-URINE", "TEST-POT"),
      );
      assert(urine.id !== s.id, "Multi-specimen identity collapsed");
      await enter(o, o.items[0], s);
      ctx.multi = o;
    },
  );
  await step(
    "Rejection creates durable recollection and rejected specimens never count as received",
    async () => {
      const o = await orderFor([a.id]),
        s = await receive(await specimenFor(o));
      const rejected = await move(s, "REJECTED");
      assert(
        (
          await sql(
            "SELECT * FROM hms_lab_recollections WHERE rejected_specimen_id=$1",
            [s.id],
          )
        ).length === 1,
        "Recollection task missing",
      );
      const r = await call(
        "POST",
        `/items/${o.items[0].id}/results`,
        "lab_technician",
        {
          specimen_id: s.id,
          raw_value: "5",
          unit: "TEST-U",
          method: "TEST-METHOD",
        },
        1,
      );
      assert(r.status === 409, "Rejected specimen used");
      const replacement = await receive(await specimenFor(o));
      const [task] = await sql(
        "SELECT * FROM hms_lab_recollections WHERE rejected_specimen_id=$1",
        [s.id],
      );
      assert(
        task.replacement_specimen_id === replacement.id && task.completed_at,
        "Recollection receipt not linked",
      );
    },
  );
  await step(
    "Aliquot lineage retains parent patient and specimen identity",
    async () => {
      const o = await orderFor([a.id]),
        s = await receive(await specimenFor(o));
      const [req] = await sql(
        "SELECT id FROM hms_lab_requirements WHERE test_version_id=$1",
        [a.id],
      );
      const child = ok(
        await call("POST", "/specimens", "lab_technician", {
          patient_id: pid,
          parent_id: s.id,
          specimen_type: "TEST-BLOOD",
          container: "TEST-TUBE",
          location: "TEST-ALIQUOT",
          links: [{ item_id: o.items[0].id, requirement_id: req.id }],
        }),
        201,
      );
      assert(
        child.parent_id === s.id && child.state === "RECEIVED",
        "Aliquot ancestry lost",
      );
    },
  );
  await step(
    "Analyzer contract deduplicates concurrent messages and retains provisional results",
    async () => {
      const o = await orderFor([b.id]),
        s = await receive(await specimenFor(o));
      const body = {
        contract_version: 1,
        source: "TEST-ADAPTER-" + tag,
        message_id: "DUP-" + tag,
        patient_id: pid,
        item_id: o.items[0].id,
        accession: s.accession,
        instrument: "TEST-INSTRUMENT",
        run_id: "RUN-" + tag,
        result: { raw_value: "5", unit: "TEST-U", method: "TEST-METHOD" },
      };
      const rs = await Promise.all([
        call("POST", "/analyzer-messages", "lab_technician", body),
        call("POST", "/analyzer-messages", "lab_technician", body),
      ]);
      rs.forEach((r) => ok(r, 202));
      assert(
        rs.some((r) => r.data.data.duplicate),
        "Duplicate not recognized",
      );
      const results = await sql(
        "SELECT * FROM hms_lab_result_versions WHERE item_id=$1",
        [o.items[0].id],
      );
      assert(
        results.length === 1 && results[0].source === "ANALYZER",
        "Duplicate result or provenance loss",
      );
      assert(
        (await getItem(o.items[0].id)).lab_state === "ENTERED",
        "Analyzer bypassed technical validation",
      );
      const mismatch = ok(
        await call("POST", "/analyzer-messages", "lab_technician", {
          ...body,
          message_id: "MISMATCH-" + tag,
          patient_id: pid + 100000,
        }),
        202,
      );
      assert(
        mismatch.reconciliation_id && !mismatch.result,
        "Mismatched analyzer patient was imported",
      );
      const reused = await call(
        "POST",
        "/analyzer-messages",
        "lab_technician",
        { ...body, result: { ...body.result, raw_value: "999" } },
      );
      assert(
        reused.status === 409,
        "Message ID reuse with different content accepted",
      );
    },
  );
  await step(
    "Discharge does not suppress critical follow-up before result release",
    async () => {
      const o = await orderFor([a.id]),
        s = await receive(await specimenFor(o));
      // Synthetic historical admission is explicitly discharged before verification
      // and release; no live admission/bed records are changed by this fixture.
      const [admission] = await sql(
        "INSERT INTO hms_admissions(patient_id,admitting_doctor_id,status,admission_date,discharge_date,created_by) VALUES($1,$2,'Discharged',now()-interval '1 day',now(),$2) RETURNING id",
        [pid, uid],
      );
      assert(admission.id, "Discharged admission fixture missing");
      await sql("UPDATE hms_encounters SET status='Finalized' WHERE id=$1", [
        eid,
      ]);
      const r = (await enter(o, o.items[0], s, "9")).result,
        t = await review(r, o.items[0], ruleA);
      assert(
        t.critical_task?.state === "OPEN",
        "Post-discharge result did not create follow-up",
      );
      ok(
        await call(
          "POST",
          `/orders/${o.id}/release`,
          "doctor",
          {
            status: "FINAL",
            reason: "Synthetic late release after encounter ended",
            result_version_ids: [r.id],
          },
          0,
        ),
        201,
      );
      const [task] = await sql(
        "SELECT state FROM hms_lab_critical_tasks WHERE id=$1",
        [t.critical_task.id],
      );
      assert(
        task.state === "OPEN",
        "Release/ended encounter closed critical task",
      );
    },
  );
  await step(
    "Patient scope, missing revision, idempotent replay and audit remain enforced",
    async () => {
      const key = crypto.randomUUID(),
        path = "/critical-tasks/advance",
        body = {};
      const first = await call(
          "POST",
          path,
          "lab_technician",
          body,
          undefined,
          key,
        ),
        second = await call(
          "POST",
          path,
          "lab_technician",
          body,
          undefined,
          key,
        );
      assert(
        first.status === 200 && second.status === 200,
        "Idempotent replay failed",
      );
      require("node:assert/strict").deepEqual(first.data, second.data);
      const forbidden = await call("GET", "/worklist", "pharmacist");
      assert(
        forbidden.status === 403,
        "Pharmacist accessed clinical lab worklist",
      );
      const missing = await call(
        "POST",
        `/orders/${order.id}/release`,
        "doctor",
        {
          status: "AMENDED",
          reason: "No version",
          result_version_ids: [r1.id, r2.id],
        },
      );
      assert(missing.status === 428, "Missing expected version accepted");
      const rows = await sql(
        "SELECT id FROM audit.row_changes WHERE table_name='hms_lab_report_versions' AND actor_user_id=$1",
        [uid],
      );
      assert(rows.length > 0, "Attributed report audit missing");
      await sql(
        "UPDATE hms_care_team_assignments SET valid_to=now(),ended_by=$1,ended_reason=$2 WHERE patient_id=$3 AND valid_to IS NULL",
        [uid, "Synthetic care ended", pid],
      );
      const r = await call(
        "GET",
        "/reports/" + ctx.report.version.id,
        "doctor",
      );
      assert(r.status === 403, "Unrelated clinician read report");
    },
  );
  done();
})();
async function apiLoginFresh(role) {
  const { creds } = require("./helpers");
  const [username, password] = creds(role);
  const r = await api("POST", "/auth/login", {
    body: { username, password },
    headers: { "X-Auth-Transport": "bearer" },
  });
  assert(r.data.token, "Fresh sign-in failed");
  return r.data.token;
}
