// Real PostgreSQL and HTTP acceptance tests. Clinical values below are synthetic
// test fixtures only; no production clinical rule pack is seeded.
const { api, apiLogin, sql, runner, assert } = require("./helpers");
const crypto = require("crypto");
assert(
  /^hms_p3_/.test(process.env.DB_NAME || ""),
  "Use a Phase 3 throwaway database",
);
const { step, done } = runner("Phase 3 medication safety");
const tag = crypto.randomUUID().slice(0, 8);
let doctor,
  pharmacist,
  nurse,
  nurse2,
  pid,
  eid,
  ingredient,
  product,
  other,
  main,
  ward,
  first,
  fill,
  supplier;
const at = (minutes = 0) =>
  new Date(Date.now() + minutes * 60000).toISOString();
const day = (offset) =>
  new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const call = async (method, path, token, body, revision, key) =>
  api(method, "/medication" + path, {
    token,
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
const draft = async (extra = {}) =>
  ok(
    await call("POST", "/orders", doctor, {
      patient_id: pid,
      encounter_id: eid,
      product_id: product.id,
      dose: "1",
      dose_unit: "mL",
      route: "TEST-ROUTE",
      frequency: { type: "INTERVAL", interval_minutes: 60 },
      starts_at: at(-1440),
      ends_at: at(1440),
      supply_quantity: "10",
      supply_unit: "mL",
      ...extra,
    }),
    201,
  );
const sign = async (d, requests = []) =>
  ok(
    await call(
      "POST",
      `/orders/${d.order.id}/sign`,
      doctor,
      {
        reason: "Synthetic test prescriber signature",
        override_requests: requests,
      },
      d.order.revision,
    ),
  );
const verification = async (d, overrides = []) =>
  ok(
    await call(
      "POST",
      `/orders/${d.order.id}/verify`,
      pharmacist,
      {
        state: "VERIFIED",
        reason: "Synthetic independent review of coverage and context",
        coverage_acknowledged: true,
        overrides,
      },
      d.order.revision,
    ),
  );
const current = async (oid) => ok(await call("GET", "/orders/" + oid, doctor));
const reviewed = async (extra = {}, overrides = []) => {
  let d = await draft(extra);
  d = await sign(d, overrides);
  await verification(d, overrides);
  return current(d.order.id);
};
const rx = async (invoice, lines) =>
  call("POST", "/receipts", pharmacist, {
    supplier_id: supplier,
    invoice_ref: invoice,
    lines,
  });
const receiptLine = (lot, qty, expiry = day(30), p = product) => ({
  product_id: p.id,
  manufacturer_lot: lot,
  expiry_date: expiry,
  manufacturer: "Synthetic fixture manufacturer",
  document_ref: "TEST-ONLY receipt " + lot,
  quantity: String(qty),
  purchase_rate: "1.25",
  mrp: "2.50",
});
const dispense = async (d, qty, extra = {}) =>
  call(
    "POST",
    `/orders/${d.order.id}/dispense`,
    pharmacist,
    {
      quantity: String(qty),
      product_id: d.version.product_id,
      location_id: main.id,
      ...extra,
    },
    d.order.revision,
  );
const schedule = async (d) =>
  ok(
    await call(
      "POST",
      `/orders/${d.order.id}/schedules`,
      nurse,
      { from_at: at(-60), through_at: at(120) },
      d.order.revision,
    ),
    201,
  );
const evidence = (p = product) => ({
  mode: "MANUAL",
  reason: "Synthetic scanner unavailable",
  patient_identifier: "P3-" + tag,
  product_id: p.id,
  identity_confirmed: true,
  dose_checked: true,
  route_checked: true,
  time_checked: true,
});
const doseBody = (d, line, extra = {}) => ({
  patient_id: pid,
  product_id: d.version.product_id,
  dispense_line_id: line.id,
  dose: d.version.dose,
  dose_unit: d.version.dose_unit,
  route: d.version.route,
  scan_evidence: evidence(),
  outcome: "GIVEN",
  actual_at: at(),
  ...extra,
});
const witness = async (action, subject, performer, details, token = nurse) =>
  ok(
    await call("POST", "/witnesses", token, {
      action,
      subject_id: String(subject),
      performer_user_id: performer,
      details,
      reason: "Independent synthetic witness attestation",
    }),
    201,
  );
(async () => {
  await step(
    "Setup isolated synthetic patients, staff and coded products",
    async () => {
      doctor = await apiLogin("doctor");
      pharmacist = await apiLogin("pharmacist");
      nurse = await apiLogin("nurse");
      const password = await require("../backend/node_modules/bcryptjs").hash(
        "SyntheticNurse@123",
        10,
      );
      const [n] = await sql(
        "INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic receiving nurse','nurse',1,0) RETURNING id",
        ["p3-nurse-" + tag, password],
      );
      nurse2 = ok({
        status: 200,
        data: {
          data: (
            await api("POST", "/auth/login", {
              body: {
                username: "p3-nurse-" + tag,
                password: "SyntheticNurse@123",
              },
              headers: { "X-Auth-Transport": "bearer" },
            })
          ).data.token,
        },
      });
      const [p] = await sql(
        "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic medication patient',$1,'other',30,'Other','OPD',CURRENT_DATE) RETURNING id",
        ["P3-" + tag],
      );
      pid = p.id;
      const [du] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      const [e] = await sql(
        "INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",
        [pid, du.id],
      );
      eid = e.id;
      const [s] = await sql(
        "INSERT INTO hms_suppliers(name,is_active) VALUES($1,1) RETURNING id",
        ["Synthetic supplier " + tag],
      );
      supplier = s.id;
      ingredient = ok(
        await call("POST", "/ingredients", pharmacist, {
          code_system: "urn:test-only",
          code: tag,
          name: "Synthetic ingredient " + tag,
          provenance: "Synthetic acceptance fixture; not clinical content",
          effective_at: at(-60),
        }),
        201,
      );
      const make = async (code, strength = "1", controlled = false) =>
        ok(
          await call("POST", "/products", pharmacist, {
            code: "TEST-" + tag + "-" + code,
            name: "Synthetic product " + code + " " + tag,
            strength,
            strength_unit: "mg",
            dose_form: "TEST-FORM",
            route: "TEST-ROUTE",
            base_unit: "mL",
            pack_unit: "test-pack",
            pack_conversion: "10",
            quantity_precision: 3,
            concentration_denominator: "1",
            concentration_unit: "mL",
            barcode: "TEST-BARCODE-" + tag + "-" + code,
            controlled,
            provenance: "Synthetic acceptance fixture; not clinical content",
            effective_at: at(-60),
            ingredients: [
              { ingredient_id: ingredient.id, amount: strength, unit: "mg" },
            ],
          }),
          201,
        );
      product = await make("A");
      other = await make("WRONG-STRENGTH", "9");
      main = ok(await call("GET", "/locations", pharmacist)).find(
        (l) => l.code === "MAIN",
      );
      ward = ok(
        await call("POST", "/locations", pharmacist, {
          code: "TEST-WARD-" + tag,
          name: "Synthetic ward " + tag,
          kind: "WARD",
        }),
        201,
      );
      assert(typeof nurse2 === "string" && n.id, "Second nurse login failed");
    },
  );
  await step(
    "Unreviewed allergy, missing weight and empty coverage require pharmacy review",
    async () => {
      const d = await draft();
      first = await sign(d);
      const detail = await current(first.order.id);
      const assessment = detail.assessments[0];
      assert(
        assessment.findings.some((f) => f.code === "ALLERGY_NOT_REVIEWED"),
        "Unknown allergy was hidden",
      );
      assert(
        assessment.findings.some((f) => f.code === "WEIGHT_MISSING"),
        "Missing weight was hidden",
      );
      assert(
        assessment.findings.some((f) => f.code === "MEDICINE_UNCOVERED"),
        "Empty pack falsely covered medicine",
      );
      assert(
        (await dispense(first, 1)).status === 409,
        "Unverified order was supplied",
      );
      assert(
        (
          await call(
            "POST",
            `/orders/${first.order.id}/verify`,
            pharmacist,
            { state: "VERIFIED", reason: "test" },
            first.order.revision,
          )
        ).status === 422,
        "Coverage acknowledgment omitted",
      );
      await verification(first);
      first = await current(first.order.id);
    },
  );
  await step(
    "Expected revisions, signed immutability and duplicate therapy override",
    async () => {
      assert(
        (
          await call("POST", `/orders/${first.order.id}/hold`, doctor, {
            reason: "test",
          })
        ).status === 428,
        "Missing If-Match accepted",
      );
      assert(
        (
          await call(
            "POST",
            `/orders/${first.order.id}/hold`,
            doctor,
            { reason: "test" },
            1,
          )
        ).status === 412,
        "Stale revision accepted",
      );
      let blocked = false;
      try {
        await sql("UPDATE hms_med_order_versions SET dose=2 WHERE id=$1", [
          first.version.id,
        ]);
      } catch {
        blocked = true;
      }
      assert(blocked, "Signed version overwritten");
      const d = await draft();
      assert(
        (
          await call(
            "POST",
            `/orders/${d.order.id}/sign`,
            doctor,
            { reason: "test" },
            1,
          )
        ).status === 409,
        "Duplicate therapy signed without reason",
      );
      const override = [
        {
          finding_code: "DUPLICATE_THERAPY",
          reason: "Synthetic duplicate approved for acceptance test",
        },
      ];
      const signed = await sign(d, override);
      assert(
        (
          await call(
            "POST",
            `/orders/${signed.order.id}/verify`,
            pharmacist,
            { state: "VERIFIED", reason: "test", coverage_acknowledged: true },
            signed.order.revision,
          )
        ).status === 409,
        "Requested override silently approved",
      );
      await verification(signed, override);
      const [count] = await sql(
        "SELECT count(*)::int AS n FROM hms_med_overrides",
      );
      assert(count.n > 0, "Approved override absent");
      await call(
        "POST",
        `/orders/${signed.order.id}/discontinue`,
        doctor,
        { reason: "Synthetic test complete" },
        (await current(signed.order.id)).order.revision,
      );
    },
  );
  await step(
    "Concurrent new-lot receipts and duplicate invoice protection",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          rx(`TEST-${tag}-NEW-${i}`, [receiptLine("TEST-NEW-" + tag, "2")]),
        ),
      );
      responses.forEach((r) => ok(r, 201));
      const [lot] = await sql(
        "SELECT count(*)::int AS n,sum(quantity)::text AS qty FROM hms_medicine_batches WHERE medicine_id=$1 AND batch_number=$2",
        [product.legacy_medicine_id, "TEST-NEW-" + tag],
      );
      assert(
        lot.n === 1 && Number(lot.qty) === 12,
        "New lot receipt race lost stock",
      );
      const invoice = "TEST-" + tag + "-DUP";
      const line = receiptLine("TEST-DUP-" + tag, 1);
      ok(await rx(invoice, [line]), 201);
      ok(await rx(invoice, [line]), 201);
      assert(
        (await rx(invoice, [{ ...line, quantity: "2" }])).status === 409,
        "Invoice replay changed receipt",
      );
    },
  );
  await step(
    "Wrong strength/product is rejected and partial fills retain a quantified balance",
    async () => {
      assert(
        (await dispense(first, 1, { product_id: other.id })).status === 409,
        "Wrong strength substituted silently",
      );
      fill = ok(await dispense(first, "0.25"), 201);
      assert(Number(fill.remaining) === 9.75, "Partial balance lost");
      assert(
        Number(fill.lines[0].amount) === 0.63,
        "Fractional monetary amount not rounded in PostgreSQL",
      );
      const [charge] = await sql(
        "SELECT * FROM hms_med_charges WHERE dispense_line_id=$1",
        [fill.lines[0].id],
      );
      assert(
        charge && Number(charge.amount) === 0.63,
        "Stock and charge not atomic",
      );
    },
  );
  await step(
    "FEFO excludes quarantined, recalled and expired lots",
    async () => {
      for (const [suffix, status] of [
        ["Q", "QUARANTINED"],
        ["R", "RECALLED"],
        ["E", "EXPIRED"],
      ]) {
        ok(
          await rx("TEST-" + tag + "-" + suffix, [
            receiptLine("TEST-" + tag + "-" + suffix, 10, day(5)),
          ]),
          201,
        );
        const [b] = await sql(
          "SELECT id FROM hms_medicine_batches WHERE batch_number=$1",
          ["TEST-" + tag + "-" + suffix],
        );
        ok(
          await call("POST", "/stock/" + b.id + "/status", pharmacist, {
            status,
            reason: "Synthetic lot disposition",
          }),
        );
      }
      const r = ok(await dispense(first, 1), 201);
      for (const l of r.lines) {
        const [lot] = await sql(
          "SELECT batch_number,lot_status FROM hms_medicine_batches WHERE id=$1",
          [l.batch_id],
        );
        assert(
          lot.lot_status === "AVAILABLE" &&
            !["Q", "R", "E"].some(
              (s) => lot.batch_number === "TEST-" + tag + "-" + s,
            ),
          "Ineligible lot picked",
        );
      }
    },
  );
  await step(
    "Concurrent counters cannot overfill or produce negative stock",
    async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => dispense(first, 2)),
      );
      assert(
        responses.every((r) => r.status === 201 || r.status === 409),
        "Unexpected concurrency response",
      );
      const [total] = await sql(
        "SELECT sum(quantity) AS qty FROM hms_med_dispense_lines WHERE version_id=$1",
        [first.version.id],
      );
      assert(Number(total.qty) <= 10, "Order overfilled");
      assert(
        !(await sql("SELECT id FROM hms_med_balances WHERE quantity<0")).length,
        "Negative balance",
      );
    },
  );
  await step(
    "Returns enter quarantine without changing an issued charge",
    async () => {
      const r = ok(
        await call("POST", "/returns/" + fill.lines[0].id, pharmacist, {
          quantity: "0.125",
          reason: "Synthetic patient return",
        }),
        201,
      );
      assert(
        r.financial_credit_status === "PENDING",
        "Return auto-issued financial credit",
      );
      const [q] = await sql(
        "SELECT x.quantity FROM hms_med_balances x JOIN hms_med_locations l ON l.id=x.location_id WHERE x.batch_id=$1 AND l.code='QUARANTINE'",
        [fill.lines[0].batch_id],
      );
      assert(Number(q.quantity) === 0.125, "Return became available stock");
    },
  );
  await step(
    "Ward supply remains in transit until receiving nurse acknowledges",
    async () => {
      const r = ok(
        await call("POST", "/requisitions", nurse, {
          product_id: product.id,
          destination_id: ward.id,
          quantity: "1",
          reason: "Synthetic ward supply",
        }),
        201,
      );
      const approved = ok(
        await call(
          "POST",
          "/requisitions/" + r.id + "/approve",
          pharmacist,
          {},
          r.revision,
        ),
      );
      const picked = ok(
        await call(
          "POST",
          "/requisitions/" + r.id + "/pick",
          pharmacist,
          {},
          approved.revision,
        ),
      );
      const dest = await sql(
        "SELECT quantity FROM hms_med_balances WHERE location_id=$1",
        [ward.id],
      );
      assert(
        !dest.length || dest.every((x) => Number(x.quantity) === 0),
        "Stock available before acknowledgment",
      );
      assert(
        (
          await call(
            "POST",
            "/requisitions/" + r.id + "/receive",
            nurse2,
            {},
            picked.revision,
          )
        ).status === 403,
        "Wrong nurse acknowledged",
      );
      const received = ok(
        await call(
          "POST",
          "/requisitions/" + r.id + "/receive",
          nurse,
          {},
          picked.revision,
        ),
      );
      assert(received.state === "RECEIVED", "Ward receipt not acknowledged");
    },
  );
  await step(
    "Held and discontinued orders stop future dispensing; amendments keep prior versions",
    async () => {
      const held = ok(
        await call(
          "POST",
          `/orders/${first.order.id}/hold`,
          doctor,
          { reason: "Synthetic hold" },
          first.order.revision,
        ),
      );
      assert((await dispense(held, 1)).status === 409, "Held order dispensed");
      const resumed = ok(
        await call(
          "POST",
          `/orders/${first.order.id}/resume`,
          doctor,
          { reason: "Synthetic resume" },
          held.order.revision,
        ),
      );
      const stopped = ok(
        await call(
          "POST",
          `/orders/${first.order.id}/discontinue`,
          doctor,
          { reason: "Synthetic discontinue" },
          resumed.order.revision,
        ),
      );
      assert(
        (await dispense(stopped, 1)).status === 409,
        "Discontinued order dispensed",
      );
    },
  );
  let administrationOrder, administrationLine, occurrences;
  await step(
    "Schedules come from verified orders; wrong patient and product cannot claim a dose",
    async () => {
      ok(
        await rx("TEST-" + tag + "-NURSING-STOCK", [
          receiptLine("TEST-NURSING-" + tag, 20),
        ]),
        201,
      );
      administrationOrder = await reviewed({
        dose: "0.25",
        supply_quantity: "2",
      });
      administrationLine = ok(await dispense(administrationOrder, 2), 201)
        .lines[0];
      occurrences = await schedule(administrationOrder);
      assert(occurrences.length > 0, "No schedules generated");
      const body = doseBody(administrationOrder, administrationLine, {
        dose: "0.25",
      });
      assert(
        (
          await call("POST", "/emar/" + occurrences[0].id + "/prepare", nurse, {
            ...body,
            patient_id: pid + 9999,
          })
        ).status === 422,
        "Wrong patient claimed",
      );
      assert(
        (
          await call("POST", "/emar/" + occurrences[0].id + "/prepare", nurse, {
            ...body,
            product_id: other.id,
          })
        ).status === 422,
        "Wrong product claimed",
      );
    },
  );
  await step(
    "Bedside claim survives uncertainty; duplicate documentation never records a second dose",
    async () => {
      const sid = occurrences[0].id,
        b = doseBody(administrationOrder, administrationLine, {
          dose: "0.25",
          actual_at: at(),
        });
      ok(await call("POST", "/emar/" + sid + "/prepare", nurse, b), 201);
      assert(
        (await call("POST", "/emar/" + sid + "/prepare", nurse, b)).status ===
          409,
        "A second nurse can claim pending documentation",
      );
      const key = crypto.randomUUID();
      const recorded = ok(
        await call(
          "POST",
          "/emar/" + sid + "/record",
          nurse,
          b,
          undefined,
          key,
        ),
        201,
      );
      const replay = ok(
        await call(
          "POST",
          "/emar/" + sid + "/record",
          nurse,
          b,
          undefined,
          key,
        ),
        201,
      );
      assert(recorded.id === replay.id, "Lost-response retry duplicated dose");
      assert(
        (await call("POST", "/emar/" + sid + "/record", nurse, b)).status ===
          409,
        "Fresh retry recorded second dose",
      );
      assert(
        Date.parse(recorded.recorded_at) > Date.parse(recorded.actual_at),
        "Late documentation changed actual time",
      );
      ok(
        await call(
          "POST",
          "/administrations/" + recorded.id + "/corrections",
          nurse,
          {
            corrected_fields: { notes: "Synthetic correction" },
            reason: "Synthetic linked correction",
          },
        ),
        201,
      );
      const [original] = await sql(
        "SELECT outcome FROM hms_med_administrations WHERE id=$1",
        [recorded.id],
      );
      assert(original.outcome === "GIVEN", "Correction erased original");
    },
  );
  await step(
    "Held/refused dose outcomes create durable escalation tasks",
    async () => {
      for (const [i, outcome] of [
        [1, "HELD"],
        [2, "REFUSED"],
      ]) {
        const b = doseBody(administrationOrder, administrationLine, {
          dose: "0.25",
          outcome,
          reason: "Synthetic dose exception",
        });
        ok(
          await call(
            "POST",
            "/emar/" + occurrences[i].id + "/record",
            nurse,
            b,
          ),
          201,
        );
      }
      const [tasks] = await sql(
        "SELECT count(*)::int AS n FROM hms_med_tasks WHERE order_id=$1 AND kind='DOSE_EXCEPTION'",
        [administrationOrder.order.id],
      );
      assert(tasks.n >= 2, "Dose exceptions have no escalation");
    },
  );
  await step(
    "PRN intervals and dose limits are enforced across real transactions",
    async () => {
      const previous = await current(administrationOrder.order.id);
      ok(
        await call(
          "POST",
          `/orders/${previous.order.id}/discontinue`,
          doctor,
          { reason: "Synthetic switch to PRN" },
          previous.order.revision,
        ),
      );
      const d = await reviewed({
        prn: true,
        indication: "Synthetic PRN need",
        max_dose: "0.25",
        max_period_hours: "24",
        min_interval_minutes: 1,
        dose: "0.25",
        supply_quantity: "2",
      });
      const l = ok(await dispense(d, 2), 201).lines[0];
      const occurrence = async () =>
        ok(
          await call(
            "POST",
            `/orders/${d.order.id}/prn`,
            nurse,
            { scheduled_at: at(), indication: "Synthetic need" },
            d.order.revision,
          ),
          201,
        );
      const s1 = await occurrence();
      const b1 = doseBody(d, l, { dose: "0.25" });
      ok(await call("POST", "/emar/" + s1.id + "/prepare", nurse, b1), 201);
      ok(await call("POST", "/emar/" + s1.id + "/record", nurse, b1), 201);
      const s2 = await occurrence();
      const b2 = doseBody(d, l, { dose: "0.25" });
      assert(
        (await call("POST", "/emar/" + s2.id + "/prepare", nurse, b2)).data
          .code === "PRN_INTERVAL_EXCEEDED",
        "PRN interval not enforced",
      );
      await new Promise((resolve) => setTimeout(resolve, 61000));
      const s3 = await occurrence();
      const b3 = doseBody(d, l, { dose: "0.25" });
      assert(
        (await call("POST", "/emar/" + s3.id + "/prepare", nurse, b3)).data
          .code === "PRN_LIMIT_EXCEEDED",
        "PRN rolling maximum not enforced",
      );
      ok(
        await call(
          "POST",
          `/orders/${d.order.id}/discontinue`,
          doctor,
          { reason: "Synthetic complete" },
          d.order.revision,
        ),
      );
    },
  );
  await step(
    "Coded ingredient allergy needs prescriber reason and authenticated override review",
    async () => {
      ok(
        await call("POST", "/allergies/" + pid, nurse, {
          ingredient_id: ingredient.id,
          clinical_text: "Synthetic ingredient allergy",
          reaction: "Synthetic reaction",
          clinical_status: "ACTIVE",
          verification_status: "CONFIRMED",
        }),
        201,
      );
      const a = ok(await call("GET", "/allergies/" + pid, doctor));
      assert(
        a.review_state === "ALLERGIES_RECORDED",
        "Allergy review state not explicit",
      );
      assert(
        (
          await call(
            "POST",
            "/allergies/" + pid + "/review",
            doctor,
            { state: "NONE_KNOWN", reason: "test" },
            a.revision,
          )
        ).status === 409,
        "Active allergy hidden as none-known",
      );
      const d = await draft();
      assert(
        (
          await call(
            "POST",
            `/orders/${d.order.id}/sign`,
            doctor,
            { reason: "test" },
            1,
          )
        ).data.code === "OVERRIDE_REASON_REQUIRED",
        "Ingredient allergy did not block signing",
      );
      const requests = [
        {
          finding_code: "ALLERGY:" + a.allergies[0].id,
          reason: "Synthetic test-only approved reason",
        },
      ];
      const signed = await sign(d, requests);
      await verification(signed, requests);
      const now = await current(d.order.id);
      ok(
        await call(
          "POST",
          `/orders/${now.order.id}/discontinue`,
          doctor,
          { reason: "Synthetic complete" },
          now.order.revision,
        ),
      );
    },
  );
  await step(
    "Nursing responsibility changes only on the designated receiver’s acknowledgment",
    async () => {
      const [uid] = await sql("SELECT id FROM hms_users WHERE username=$1", [
        "p3-nurse-" + tag,
      ]);
      const h = ok(
        await call("POST", "/handovers", nurse, {
          patient_id: pid,
          receiver_user_id: uid.id,
          sbar: {
            situation: "Synthetic situation",
            background: "Synthetic background",
            assessment: "Synthetic assessment",
            recommendation: "Synthetic recommendation",
          },
          outstanding_task_ids: [],
        }),
        201,
      );
      const [before] = await sql(
        "SELECT responsible_user_id FROM hms_med_nursing_responsibility WHERE patient_id=$1",
        [pid],
      );
      assert(
        before.responsible_user_id !== uid.id,
        "Responsibility transferred before acknowledgment",
      );
      assert(
        (
          await call(
            "POST",
            "/handovers/" + h.id + "/acknowledge",
            nurse,
            {},
            h.revision,
          )
        ).status === 403,
        "Sender acknowledged as receiver",
      );
      ok(
        await call(
          "POST",
          "/handovers/" + h.id + "/acknowledge",
          nurse2,
          {},
          h.revision,
        ),
      );
      const [after] = await sql(
        "SELECT responsible_user_id FROM hms_med_nursing_responsibility WHERE patient_id=$1",
        [pid],
      );
      assert(
        after.responsible_user_id === uid.id,
        "Receiver did not acquire responsibility",
      );
    },
  );
  await step(
    "Controlled supply, administration, returns and wastage require independent witnesses",
    async () => {
      const ci = ok(
        await call("POST", "/ingredients", pharmacist, {
          code_system: "urn:test-controlled",
          code: tag,
          name: "Synthetic controlled ingredient",
          provenance: "Synthetic test fixture only",
          effective_at: at(-60),
        }),
        201,
      );
      const cp = ok(
        await call("POST", "/products", pharmacist, {
          code: "CONTROLLED-" + tag,
          name: "Synthetic controlled product",
          strength: "1",
          strength_unit: "mg",
          dose_form: "TEST-FORM",
          route: "TEST-ROUTE",
          base_unit: "mL",
          pack_unit: "test-pack",
          pack_conversion: "10",
          quantity_precision: 3,
          concentration_denominator: "1",
          concentration_unit: "mL",
          barcode: "TEST-CONTROLLED-" + tag,
          controlled: true,
          provenance: "Synthetic test fixture only",
          effective_at: at(-60),
          ingredients: [{ ingredient_id: ci.id, amount: "1", unit: "mg" }],
        }),
        201,
      );
      ok(
        await rx("TEST-CONTROLLED-RECEIPT-" + tag, [
          receiptLine("TEST-CONTROLLED-LOT-" + tag, 10, day(30), cp),
        ]),
        201,
      );
      const d = await reviewed({ product_id: cp.id, supply_quantity: "3" });
      const [pu] = await sql(
        "SELECT id FROM hms_users WHERE username='pharmacist'",
      );
      const [nu] = await sql("SELECT id FROM hms_users WHERE username='nurse'");
      const supplyBody = {
        product_id: cp.id,
        location_id: main.id,
        quantity: "3",
      };
      assert(
        (await dispense(d, 3, supplyBody)).data.code === "WITNESS_REQUIRED",
        "Controlled supply lacked witness",
      );
      const w = await witness("SUPPLY", d.version.id, pu.id, supplyBody);
      const supplied = ok(
        await dispense(d, 3, { ...supplyBody, witness_id: w.id }),
        201,
      );
      const [before] = await sql(
        "SELECT quantity FROM hms_medicine_batches WHERE id=$1",
        [supplied.lines[0].batch_id],
      );
      const countBody = {
        product_id: cp.id,
        batch_id: supplied.lines[0].batch_id,
        location_id: main.id,
        counted_quantity: String(Number(before.quantity) - 1),
        shift_ref: "TEST-SHIFT-" + tag,
      };
      assert(
        (await call("POST", "/shift-counts", pharmacist, countBody)).data
          .code === "WITNESS_REQUIRED",
        "Count lacked witness",
      );
      const request = ok(
        await call("POST", "/witness-requests", pharmacist, {
          action: "COUNT",
          subject_id: String(countBody.batch_id),
          details: countBody,
          requested_witness_user_id: nu.id,
        }),
        201,
      );
      assert(
        (
          await call(
            "POST",
            "/witness-requests/" + request.id + "/attest",
            pharmacist,
            { reason: "self" },
          )
        ).status === 403,
        "Performer witnessed their own count",
      );
      const attested = ok(
        await call(
          "POST",
          "/witness-requests/" + request.id + "/attest",
          nurse,
          { reason: "Independent synthetic count witness" },
        ),
      );
      const count = ok(
        await call("POST", "/shift-counts", pharmacist, {
          ...countBody,
          witness_id: attested.witness_id,
        }),
        201,
      );
      const [caseRow] = await sql(
        "SELECT * FROM hms_med_discrepancies WHERE count_id=$1",
        [count.id],
      );
      assert(
        caseRow?.state === "OPEN",
        "Count discrepancy did not open a case",
      );
      assert(
        (
          await call(
            "POST",
            "/controlled/discrepancies/" + caseRow.id,
            pharmacist,
            { state: "CLOSED", investigation: "test", closure_reason: "test" },
          )
        ).status === 409,
        "Uninvestigated case closed",
      );
      ok(
        await call(
          "POST",
          "/controlled/discrepancies/" + caseRow.id,
          pharmacist,
          {
            state: "INVESTIGATING",
            investigation: "Synthetic physical count reviewed",
          },
        ),
      );
      ok(
        await call(
          "POST",
          "/controlled/discrepancies/" + caseRow.id,
          pharmacist,
          {
            state: "CLOSED",
            investigation: "Synthetic physical count reviewed",
            closure_reason:
              "Synthetic discrepancy investigated; no silent balance replacement",
          },
        ),
      );
      const schedules = await schedule(d),
        sid = schedules[0].id,
        body = doseBody(d, supplied.lines[0], {
          product_id: cp.id,
          scan_evidence: evidence(cp),
        });
      ok(await call("POST", "/emar/" + sid + "/prepare", nurse, body), 201);
      assert(
        (await call("POST", "/emar/" + sid + "/record", nurse, body)).data
          .code === "WITNESS_REQUIRED",
        "Controlled administration lacked witness",
      );
      const adminWitness = await witness(
        "ADMINISTRATION",
        sid,
        nu.id,
        body,
        pharmacist,
      );
      ok(
        await call("POST", "/emar/" + sid + "/record", nurse, {
          ...body,
          witness_id: adminWitness.id,
        }),
        201,
      );
      const returnBody = {
        quantity: "1",
        reason: "Synthetic unused controlled return",
      };
      const returnWitness = await witness(
        "RETURN",
        supplied.lines[0].id,
        pu.id,
        returnBody,
      );
      ok(
        await call("POST", "/returns/" + supplied.lines[0].id, pharmacist, {
          ...returnBody,
          witness_id: returnWitness.id,
        }),
        201,
      );
      const wasteBody = {
        product_id: cp.id,
        batch_id: supplied.lines[0].batch_id,
        location_id: main.id,
        quantity: "0.5",
        reason: "Synthetic witnessed wastage",
      };
      assert(
        (await call("POST", "/wastage", pharmacist, wasteBody)).data.code ===
          "WITNESS_REQUIRED",
        "Controlled wastage lacked witness",
      );
      const wasteWitness = await witness(
        "WASTAGE",
        String(wasteBody.batch_id),
        pu.id,
        wasteBody,
      );
      ok(
        await call("POST", "/wastage", pharmacist, {
          ...wasteBody,
          witness_id: wasteWitness.id,
        }),
        201,
      );
      const rows = await sql(
        "SELECT action FROM hms_med_controlled_register WHERE product_id=$1",
        [cp.id],
      );
      assert(
        ["SUPPLY", "ADMINISTRATION", "RETURN", "WASTAGE"].every((action) =>
          rows.some((r) => r.action === action),
        ),
        "Controlled register incomplete",
      );
    },
  );
  await step(
    "A previously given dose can be documented after a hold only under exact prescriber review",
    async () => {
      const ingredient = ok(
        await call("POST", "/ingredients", pharmacist, {
          code_system: "urn:test-late",
          code: tag,
          name: "Synthetic late-documentation ingredient",
          provenance: "Synthetic fixture only",
          effective_at: at(-60),
        }),
        201,
      );
      const p = ok(
        await call("POST", "/products", pharmacist, {
          code: "LATE-" + tag,
          name: "Synthetic late-documentation product",
          strength: "1",
          strength_unit: "mg",
          dose_form: "TEST-FORM",
          route: "TEST-ROUTE",
          base_unit: "mL",
          pack_unit: "test-pack",
          pack_conversion: "10",
          quantity_precision: 3,
          concentration_denominator: "1",
          concentration_unit: "mL",
          barcode: "TEST-LATE-" + tag,
          provenance: "Synthetic fixture only",
          effective_at: at(-60),
          ingredients: [
            { ingredient_id: ingredient.id, amount: "1", unit: "mg" },
          ],
        }),
        201,
      );
      ok(
        await rx("TEST-LATE-RECEIPT-" + tag, [
          {
            ...receiptLine("TEST-LATE-LOT-" + tag, "0.5", day(30), p),
            quantity_unit: "test-pack",
          },
        ]),
        201,
      );
      const [batch] = await sql(
        "SELECT quantity FROM hms_medicine_batches WHERE medicine_id=$1",
        [p.legacy_medicine_id],
      );
      assert(
        Number(batch.quantity) === 5,
        "Fractional pack conversion did not retain exact base units",
      );
      const d = await reviewed({ product_id: p.id, supply_quantity: "2" }),
        line = ok(await dispense(d, 2), 201).lines[0],
        s = (await schedule(d))[0];
      const body = doseBody(d, line, {
        product_id: p.id,
        scan_evidence: evidence(p),
      });
      ok(await call("POST", "/emar/" + s.id + "/prepare", nurse, body), 201);
      const held = ok(
        await call(
          "POST",
          "/orders/" + d.order.id + "/hold",
          doctor,
          { reason: "Synthetic hold after physical administration" },
          d.order.revision,
        ),
      );
      assert(
        (await call("POST", "/emar/" + s.id + "/record", nurse, body))
          .status === 409,
        "Held order accepted routine administration",
      );
      const request = ok(
        await call("POST", "/emar/" + s.id + "/request-late-review", nurse, {
          documentation: body,
          reason: "Dose given before hold; response/documentation delayed",
        }),
        201,
      );
      const review = ok(
        await call(
          "POST",
          "/late-documentation-requests/" + request.id + "/review",
          doctor,
          { reason: "Reviewed prior dose timing and authorization" },
        ),
      );
      const record = ok(
        await call("POST", "/emar/" + s.id + "/record", nurse, {
          ...body,
          late_review_id: review.id,
        }),
        201,
      );
      assert(record.late_review_id === review.id, "Late evidence not linked");
      assert(
        (
          await call("POST", "/emar/" + s.id + "/record", nurse, {
            ...body,
            late_review_id: review.id,
          })
        ).status === 409,
        "Reviewed documentation repeated physical dose",
      );
    },
  );
  await step(
    "Missing clinical content cannot declare unsupported checks performed",
    async () => {
      const d = await draft({ product_id: other.id });
      const invalid = await call("POST", "/rule-packs", pharmacist, {
        code: "INVALID-" + tag,
        revision: 1,
        content: { rules: [] },
        coverage: { product_ids: [other.id], checks: ["DOSE"] },
        provenance: "Synthetic invalid coverage fixture",
        effective_at: at(-60),
      });
      assert(
        invalid.status === 422,
        "Empty dose content falsely declared coverage",
      );
      const pack = ok(
        await call("POST", "/rule-packs", pharmacist, {
          code: "VALID-TEST-" + tag,
          revision: 1,
          content: {
            rules: [
              {
                code: "TEST-DOSE-LIMIT",
                type: "DOSE",
                product_ids: [other.id],
                severity: "BLOCK",
                override_allowed: false,
                max: "0.5",
                unit: "mL",
                message: "Synthetic test-only threshold",
              },
            ],
          },
          coverage: { product_ids: [other.id], checks: ["DOSE"] },
          provenance:
            "Synthetic clinical threshold fixture, never production content",
          effective_at: at(-60),
        }),
        201,
      );
      assert(
        (
          await call(
            "POST",
            "/orders/" + d.order.id + "/sign",
            doctor,
            { reason: "test", rule_pack_id: pack.id },
            d.order.revision,
          )
        ).data.code === "CDS_BLOCKED",
        "Non-overridable dose rule bypassed",
      );
    },
  );
  await step(
    "Every new stock balance reconciles with the immutable movement journal",
    async () => {
      const rows = ok(await call("GET", "/stock/reconciliation", pharmacist));
      assert(
        rows.length > 0 && rows.every((x) => x.reconciled),
        "Inventory journal and balances diverged",
      );
    },
  );
  done();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
