// Extra adversarial checks. All policy values are synthetic, never seed content.
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
  "Use Phase 4 private database",
);
const { step, done } = runner("Laboratory evidence and configuration guards"),
  tag = crypto.randomUUID().slice(0, 8);
let pid, eid, lab, doctor, test, item, spec, record;
const ok = (r, n = 200) => {
  assert(
    r.status === n,
    `${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`,
  );
  return r.data.data;
};
const call = async (path, body, revision) =>
  api("POST", "/laboratory" + path, {
    token: lab,
    body,
    headers: revision === undefined ? {} : { "if-match": String(revision) },
  });
async function refusedSQL(text, args) {
  let error;
  try {
    await sql(text, args);
  } catch (e) {
    error = e;
  }
  assert(error, "Database accepted forbidden evidence mutation");
}
(async () => {
  await step(
    "Prepare fresh ordered identity and received specimen",
    async () => {
      lab = await apiLogin("lab_technician");
      doctor = await apiLogin("doctor");
      const [{ id: uid }] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      [{ id: pid }] = await sql(
        "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",
        ["Synthetic lab guard " + tag, "P4G-" + tag],
      );
      await inCare(pid);
      [{ id: eid }] = await sql(
        "INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'Draft') RETURNING id",
        [pid, uid],
      );
      test = ok(
        await call("/catalogue", {
          code_system: "TEST-GUARD",
          code: tag,
          kind: "TEST",
          name: "Synthetic guard " + tag,
          section: "TEST",
          unit: "TEST-U",
          method: "TEST-METHOD",
          effective_at: new Date(Date.now() - 1000).toISOString(),
          provenance: "Synthetic fixture only",
          requirements: [
            { specimen_type: "TEST-BLOOD", container: "TEST-TUBE" },
          ],
        }),
        201,
      );
      const o = ok(
        await api("POST", "/laboratory/orders", {
          token: doctor,
          body: {
            patient_id: pid,
            encounter_id: eid,
            test_version_ids: [test.id],
          },
        }),
        201,
      );
      item = o.items[0];
      const [r] = await sql(
        "SELECT id FROM hms_lab_requirements WHERE test_version_id=$1",
        [test.id],
      );
      spec = ok(
        await call("/specimens", {
          patient_id: pid,
          specimen_type: "TEST-BLOOD",
          container: "TEST-TUBE",
          location: "TEST",
          links: [{ item_id: item.id, requirement_id: r.id }],
        }),
        201,
      );
      for (const state of ["COLLECTED", "RECEIVED"])
        spec = ok(
          await call(
            "/specimens/" + spec.id + "/transition",
            {
              patient_id: pid,
              accession: spec.accession,
              state,
              location: "TEST",
              reason: "Synthetic receipt evidence",
            },
            spec.revision,
          ),
        );
    },
  );
  await step(
    "An approved catalogue cannot gain hidden requirements or change its identity",
    async () => {
      await refusedSQL(
        "UPDATE hms_lab_test_versions SET method='ALTERED' WHERE id=$1",
        [test.id],
      );
      await refusedSQL(
        "INSERT INTO hms_lab_requirements(test_version_id,specimen_type,container) VALUES($1,'HIDDEN','HIDDEN')",
        [test.id],
      );
      await refusedSQL(
        "UPDATE hms_investigation_order_items SET lab_test_version_id=NULL WHERE id=$1",
        [item.id],
      );
    },
  );
  await step(
    "Explicit conversion normalizes with PostgreSQL decimal arithmetic and retains provenance",
    async () => {
      ok(
        await call("/configuration/conversion", {
          test_version_id: test.id,
          method: "TEST-METHOD",
          from_unit: "TEST-ALT",
          to_unit: "TEST-U",
          multiplier: "2",
          offset_value: "1",
          provenance: "Synthetic fixture only",
          effective_at: new Date(Date.now() - 1000).toISOString(),
        }),
        201,
      );
      const r = ok(
        await call(
          "/items/" + item.id + "/results",
          {
            specimen_id: spec.id,
            raw_value: "2.25",
            unit: "TEST-ALT",
            method: "TEST-METHOD",
          },
          0,
        ),
        201,
      );
      record = r.result;
      assert(
        Number(record.normalized_value) === 5.5 &&
          record.conversion_id &&
          record.raw_value === "2.25",
        "Conversion rounded or lost provenance",
      );
    },
  );
  await step(
    "Result versions and specimen identity cannot be rewritten or moved",
    async () => {
      await refusedSQL(
        "UPDATE hms_lab_result_versions SET raw_value='999' WHERE id=$1",
        [record.id],
      );
      await refusedSQL(
        "UPDATE hms_lab_specimens SET accession='ALTERED' WHERE id=$1",
        [spec.id],
      );
      await refusedSQL("DELETE FROM hms_lab_result_versions WHERE id=$1", [
        record.id,
      ]);
    },
  );
  await step(
    "Clinical thresholds require explicit approved comparators",
    async () => {
      const r = await call("/configuration/critical", {
        test_version_id: test.id,
        version: 1,
        method: "TEST-METHOD",
        unit: "TEST-U",
        upper_bound: "5.5",
        provenance: "Synthetic fixture only",
        effective_at: new Date(Date.now() - 1000).toISOString(),
      });
      assert(
        r.status === 422 && r.data.code === "EXPLICIT_COMPARATORS_REQUIRED",
        "Comparator semantics were invented",
      );
    },
  );
  await step(
    "Inclusive critical boundary triggers before final report authorization",
    async () => {
      ok(
        await call("/configuration/critical", {
          test_version_id: test.id,
          version: 1,
          method: "TEST-METHOD",
          unit: "TEST-U",
          upper_bound: "5.5",
          lower_inclusive: false,
          upper_inclusive: true,
          provenance: "Synthetic boundary fixture",
          effective_at: new Date(Date.now() - 60000).toISOString(),
        }),
        201,
      );
      const rule = ok(
        await call("/configuration/qc", {
          test_version_id: test.id,
          version: 1,
          method: "TEST-METHOD",
          criteria: { synthetic_control: "review" },
          provenance: "Synthetic QC fixture",
          effective_at: new Date(Date.now() - 60000).toISOString(),
        }),
        201,
      );
      const qc = ok(
        await call("/qc", {
          rule_id: rule.id,
          status: "PASS",
          evidence: { synthetic_control: "pass" },
        }),
        201,
      );
      const v = ok(
        await call(
          "/results/" + record.id + "/technical-review",
          {
            qc_record_id: qc.id,
            decision: "VERIFIED",
            reason: "Synthetic boundary review",
          },
          1,
        ),
      );
      assert(
        v.critical_task?.state === "OPEN" &&
          v.critical_task.next_due_at === null,
        "Inclusive threshold or empty timetable mishandled",
      );
    },
  );
  await step(
    "Validated analyzer failures remain in reconciliation without losing the inbox receipt",
    async () => {
      const o = ok(
        await api("POST", "/laboratory/orders", {
          token: doctor,
          body: {
            patient_id: pid,
            encounter_id: eid,
            test_version_ids: [test.id],
          },
        }),
        201,
      );
      const [req] = await sql(
        "SELECT id FROM hms_lab_requirements WHERE test_version_id=$1",
        [test.id],
      );
      let s = ok(
        await call("/specimens", {
          patient_id: pid,
          specimen_type: "TEST-BLOOD",
          container: "TEST-TUBE",
          location: "TEST",
          links: [{ item_id: o.items[0].id, requirement_id: req.id }],
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
              reason: "Synthetic receipt",
            },
            s.revision,
          ),
        );
      const body = {
        contract_version: 1,
        source: "TEST-GUARD-" + tag,
        message_id: tag,
        patient_id: pid,
        item_id: o.items[0].id,
        accession: s.accession,
        instrument: "TEST-INSTRUMENT",
        run_id: tag,
        result: { raw_value: "5", unit: "UNAPPROVED", method: "TEST-METHOD" },
      };
      const r = ok(await call("/analyzer-messages", body), 202);
      assert(
        r.reconciliation_id && r.failure_code === "UNIT_MISMATCH",
        "Invalid analyzer value lost instead of queued",
      );
      const repeat = ok(await call("/analyzer-messages", body), 202);
      assert(repeat.duplicate, "Analyzer receipt not durable");
      const wrong = {
        ...body,
        message_id: tag + "-wrong",
        patient_id: pid + 100000,
        result: { ...body.result, unit: "TEST-U" },
      };
      const pending = ok(await call("/analyzer-messages", wrong), 202);
      ok(
        await call(
          "/reconciliation/" + pending.reconciliation_id + "/resolve",
          {
            item_id: o.items[0].id,
            patient_id: pid,
            specimen_id: s.id,
            accession: s.accession,
            reason: "Synthetic identity review against chart and label",
          },
          0,
        ),
      );
      const [receipt] = await sql(
        "SELECT payload,state,result_version_id FROM hms_lab_reconciliation WHERE id=$1",
        [pending.reconciliation_id],
      );
      assert(
        receipt.state === "RESOLVED" && receipt.result_version_id &&
          receipt.payload.contract.patient_id === pid + 100000,
        "Original analyzer identity was overwritten",
      );
    },
  );
  await step(
    "Care and release privileges remain separate from administrative access",
    async () => {
      const admin = await apiLogin("super_admin");
      const r = await api("POST", "/laboratory/orders/1/release", {
        token: admin,
        body: {
          status: "FINAL",
          reason: "Administrative attempt",
          result_version_ids: [record.id],
        },
        headers: { "if-match": "0" },
      });
      assert(
        r.status === 403,
        "Administrator acquired clinical release authority",
      );
    },
  );
  done();
})();
