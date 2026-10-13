// Actual worker processes compete on real PostgreSQL; repeated execution
// cannot duplicate an escalation level or imply clinical acknowledgment.
const {
  api,
  apiLogin,
  sql,
  inCare,
  runner,
  assert,
  requireThrowawayDb,
} = require("./helpers");
const { spawn } = require("node:child_process"),
  path = require("node:path"),
  crypto = require("node:crypto");
requireThrowawayDb();
assert(/^hms_p4_/.test(process.env.DB_NAME || ""), "Use private Phase 4 DB");
const { step, done } = runner("Laboratory escalation worker"),
  tag = crypto.randomUUID().slice(0, 8);
let task, labid;
const ok = (r, n = 200) => {
  assert(
    r.status === n,
    `${r.status}: ${JSON.stringify(r.data).slice(0, 250)}`,
  );
  return r.data.data;
};
const worker = () =>
  new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      ["scripts/laboratory-escalation-worker.js"],
      {
        cwd: path.join(__dirname, "../backend"),
        env: {
          ...process.env,
          LAB_ESCALATION_WORKER_USER_ID: String(labid),
          LAB_ESCALATION_POLL_MS: "100",
          LAB_ESCALATION_ONCE: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    p.stdout.on("data", (b) => {
      output += b;
    });
    p.stderr.on("data", (b) => {
      output += b;
    });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Worker failed: " + output.slice(-300))),
    );
  });
(async () => {
  await step(
    "Prepare a verified critical finding with an approved due escalation step",
    async () => {
      const lab = await apiLogin("lab_technician"),
        doctor = await apiLogin("doctor");
      const [{ id: uid }] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      [{ id: labid }] = await sql(
        "SELECT id FROM hms_users WHERE username='labtech'",
      );
      const [{ id: pid }] = await sql(
        "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",
        ["Synthetic worker " + tag, "P4W-" + tag],
      );
      await inCare(pid);
      const [{ id: eid }] = await sql(
        "INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'Draft') RETURNING id",
        [pid, uid],
      );
      const call = async (p, b, revision) =>
          api("POST", "/laboratory" + p, {
            token: lab,
            body: b,
            headers:
              revision === undefined ? {} : { "if-match": String(revision) },
          }),
        base = {
          provenance: "Synthetic worker fixture only",
          effective_at: new Date(Date.now() - 60000).toISOString(),
        };
      const test = ok(
        await call("/catalogue", {
          ...base,
          code_system: "TEST-WORKER",
          code: tag,
          name: "Synthetic worker test",
          kind: "TEST",
          section: "TEST",
          unit: "TEST-U",
          method: "TEST-METHOD",
          requirements: [
            { specimen_type: "TEST-BLOOD", container: "TEST-TUBE" },
          ],
        }),
        201,
      );
      const escalation = ok(
        await call("/configuration/escalation", {
          ...base,
          code: tag,
          version: 1,
          steps: [{ after_seconds: 0, recipient_user_id: uid }],
        }),
        201,
      );
      ok(
        await call("/configuration/critical", {
          ...base,
          test_version_id: test.id,
          version: 1,
          method: "TEST-METHOD",
          unit: "TEST-U",
          upper_bound: "1",
          lower_inclusive: false,
          upper_inclusive: false,
          escalation_policy_id: escalation.id,
        }),
        201,
      );
      const rule = ok(
          await call("/configuration/qc", {
            ...base,
            test_version_id: test.id,
            version: 1,
            method: "TEST-METHOD",
            criteria: { synthetic_control: "fixture" },
          }),
          201,
        ),
        qc = ok(
          await call("/qc", {
            rule_id: rule.id,
            status: "PASS",
            evidence: { synthetic_control: "pass" },
          }),
          201,
        );
      const order = ok(
          await api("POST", "/laboratory/orders", {
            token: doctor,
            body: {
              patient_id: pid,
              encounter_id: eid,
              test_version_ids: [test.id],
            },
          }),
          201,
        ),
        item = order.items[0],
        [req] = await sql(
          "SELECT id FROM hms_lab_requirements WHERE test_version_id=$1",
          [test.id],
        );
      let s = ok(
        await call("/specimens", {
          patient_id: pid,
          specimen_type: "TEST-BLOOD",
          container: "TEST-TUBE",
          location: "TEST",
          links: [{ item_id: item.id, requirement_id: req.id }],
        }),
        201,
      );
      for (const state of ["COLLECTED", "RECEIVED"])
        s = ok(
          await call(
            "/specimens/" + s.id + "/transition",
            {
              patient_id: pid,
              accession: s.accession,
              state,
              location: "TEST",
              reason: "Synthetic custody",
            },
            s.revision,
          ),
        );
      const result = ok(
        await call(
          "/items/" + item.id + "/results",
          {
            specimen_id: s.id,
            raw_value: "5",
            unit: "TEST-U",
            method: "TEST-METHOD",
          },
          0,
        ),
        201,
      );
      task = ok(
        await call(
          "/results/" + result.result.id + "/technical-review",
          {
            decision: "VERIFIED",
            qc_record_id: qc.id,
            reason: "Synthetic worker verification",
          },
          1,
        ),
      ).critical_task;
      assert(task?.next_due_at, "No approved due task");
    },
  );
  await step(
    "Two worker processes advance one level once with durable delivery evidence",
    async () => {
      await Promise.all([worker(), worker()]);
      const [row] = await sql(
        "SELECT * FROM hms_lab_critical_tasks WHERE id=$1",
        [task.id],
      );
      assert(
        row.escalation_level === 0 && row.state === "OPEN",
        "Worker duplicated or closed the critical task",
      );
      const attempts = await sql(
        "SELECT id FROM hms_lab_delivery_attempts WHERE task_id=$1 AND level=0",
        [task.id],
      );
      assert(
        attempts.length === 1,
        "Concurrent workers duplicated delivery attempts",
      );
    },
  );
  await step(
    "Worker restart does not repeat a completed escalation or imply acknowledgment",
    async () => {
      await worker();
      const attempts = await sql(
        "SELECT id FROM hms_lab_delivery_attempts WHERE task_id=$1",
        [task.id],
      );
      assert(attempts.length === 2, "Restart repeated escalation");
      const [row] = await sql(
        "SELECT state,acknowledged_at FROM hms_lab_critical_tasks WHERE id=$1",
        [task.id],
      );
      assert(
        row.state === "OPEN" && row.acknowledged_at === null,
        "Dispatch counted as acknowledgment",
      );
    },
  );
  done();
})();
