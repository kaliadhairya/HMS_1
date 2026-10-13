// Additional safety guards use only synthetic fixtures in a Phase 3 database.
const { api, apiLogin, sql, runner, assert, requireThrowawayDb } = require("./helpers");
const crypto = require("crypto");
requireThrowawayDb();
const { step, done } = runner("Medication provenance and timing guards");
const tag = crypto.randomUUID().slice(0, 8),
  now = (delta = 0) => new Date(Date.now() + delta).toISOString();
let doctor,
  pharmacist,
  nurse,
  product,
  patient,
  order,
  version,
  line,
  schedules;
const call = (path, token, body, revision) =>
  api("POST", "/medication" + path, {
    token,
    body,
    headers: revision === undefined ? {} : { "if-match": String(revision) },
  });
const saved = (r, status = 200) => {
  assert(r.status === status, `${r.status}: ${JSON.stringify(r.data)}`);
  return r.data.data;
};
(async () => {
  await step(
    "Create an independently verified synthetic order and its authorized supply",
    async () => {
      doctor = await apiLogin("doctor");
      pharmacist = await apiLogin("pharmacist");
      nurse = await apiLogin("nurse");
      [product] = await sql(
        "SELECT p.* FROM hms_med_products p WHERE status='APPROVED' AND controlled=false AND code LIKE 'TEST-%' AND strength=1 AND base_unit='mL' AND NOT EXISTS(SELECT 1 FROM hms_med_product_retirements r WHERE r.product_id=p.id) ORDER BY effective_at DESC LIMIT 1",
      );
      assert(product, "Run medication acceptance fixtures first");
      [patient] = await sql(
        "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',40,'Other','OPD',CURRENT_DATE) RETURNING id,uhid",
        ["Synthetic guard patient " + tag, "P3-GUARD-" + tag],
      );
      const [doc] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      const [enc] = await sql(
        "INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",
        [patient.id, doc.id],
      );
      await sql(
        "INSERT INTO hms_care_team_assignments(patient_id,practitioner_user_id,role,assigned_by) VALUES($1,$2,'consulting',$2)",
        [patient.id, doc.id],
      );
      const draft = saved(
        await call("/orders", doctor, {
          patient_id: patient.id,
          encounter_id: enc.id,
          product_id: product.id,
          dose: "0.25",
          dose_unit: "mL",
          route: product.route,
          frequency: { type: "INTERVAL", interval_minutes: 60 },
          starts_at: now(-60000),
          ends_at: now(86400000),
          supply_quantity: "1",
          supply_unit: "mL",
        }),
        201,
      );
      order = draft.order;
      version = draft.version;
      saved(
        await call(
          "/orders/" + order.id + "/sign",
          doctor,
          { reason: "Synthetic authorization" },
          1,
        ),
      );
      saved(
        await call(
          "/orders/" + order.id + "/verify",
          pharmacist,
          {
            state: "VERIFIED",
            reason: "Synthetic independent coverage review",
            coverage_acknowledged: true,
          },
          2,
        ),
      );
      const [main] = await sql(
        "SELECT id FROM hms_med_locations WHERE code='MAIN'",
      );
      line = saved(
        await call(
          "/orders/" + order.id + "/dispense",
          pharmacist,
          { product_id: product.id, location_id: main.id, quantity: "1" },
          3,
        ),
        201,
      ).lines[0];
      schedules = saved(
        await call(
          "/orders/" + order.id + "/schedules",
          nurse,
          { through_at: now(7200000) },
          3,
        ),
        201,
      );
    },
  );
  const body = () => ({
    patient_id: patient.id,
    product_id: product.id,
    dispense_line_id: line.id,
    dose: "0.25",
    dose_unit: "mL",
    route: product.route,
    scan_evidence: {
      mode: "MANUAL",
      reason: "Synthetic unavailable scanner",
      patient_identifier: patient.uhid,
      product_id: product.id,
      identity_confirmed: true,
      dose_checked: true,
      route_checked: true,
      time_checked: true,
    },
  });
  await step(
    "Malformed calendar dates and lossy PRN periods are rejected before signing",
    async () => {
      const base = {
        patient_id: patient.id,
        encounter_id: order.encounter_id,
        product_id: product.id,
        dose: "0.25",
        dose_unit: "mL",
        route: product.route,
        frequency: { type: "INTERVAL", interval_minutes: 60 },
        starts_at: now(),
        ends_at: now(86400000),
        supply_quantity: "1",
        supply_unit: "mL",
      };
      let r = await call("/orders", doctor, {
        ...base,
        starts_at: "2026-02-31T12:00:00Z",
      });
      assert(
        r.status === 422 && r.data.code === "INVALID_TIME",
        "Impossible calendar date was normalized silently",
      );
      r = await call("/orders", doctor, {
        ...base,
        prn: true,
        indication: "Synthetic PRN context",
        max_dose: "1",
        max_period_hours: "1.00001",
        min_interval_minutes: 60,
      });
      assert(
        r.status === 422 && r.data.code === "INVALID_QUANTITY",
        "PRN period was rounded silently",
      );
    },
  );
  await step(
    "Legacy note creation cannot spoof supply status or attach a different patient",
    async () => {
      const created = await api("POST", "/hms/prescriptions", {
        token: doctor,
        body: {
          encounter_id: order.encounter_id,
          patient_id: patient.id,
          status: "Dispensed",
        },
      });
      assert(
        created.status === 200 && created.data.status === "Pending",
        "Legacy caller spoofed a clinical supply status",
      );
      const [other] = await sql(
        "SELECT id FROM hms_patients WHERE id<>$1 ORDER BY id LIMIT 1",
        [patient.id],
      );
      const mismatched = await api("POST", "/hms/prescriptions", {
        token: doctor,
        body: { encounter_id: order.encounter_id, patient_id: other.id },
      });
      assert(
        mismatched.status === 422 &&
          mismatched.data.code === "PATIENT_ENCOUNTER_MISMATCH",
        "Legacy note crossed the patient/encounter identity boundary",
      );
    },
  );
  await step(
    "An occurrence in the future cannot reserve a bedside dose",
    async () => {
      const future = schedules.find(
        (s) => Date.parse(s.scheduled_at) > Date.now(),
      );
      assert(future, "Future fixture missing");
      const r = await call("/emar/" + future.id + "/prepare", nurse, body());
      assert(
        r.status === 409 && r.data.code === "OCCURRENCE_NOT_DUE",
        "Future dose was authorized",
      );
    },
  );
  await step(
    "The server requires the scheduled-time check in the scan evidence",
    async () => {
      const due = schedules.find(
        (s) => Date.parse(s.scheduled_at) <= Date.now(),
      );
      const b = body();
      b.scan_evidence.time_checked = false;
      const r = await call("/emar/" + due.id + "/prepare", nurse, b);
      assert(
        r.status === 422 && r.data.code === "FIVE_RIGHTS_REQUIRED",
        "Missing bedside time check was accepted",
      );
    },
  );
  await step(
    "Undocumented lots remain quarantined until a pharmacist verifies a source document",
    async () => {
      const [lot] = await sql(
        "INSERT INTO hms_medicine_batches(medicine_id,batch_number,expiry_date,quantity,mrp,purchase_rate) VALUES($1,$2,CURRENT_DATE+90,1,2,1) RETURNING id,lot_status",
        [product.legacy_medicine_id, "P3-NOSOURCE-" + tag],
      );
      assert(
        lot.lot_status === "QUARANTINED",
        "Undocumented opening stock became available",
      );
      let r = await call("/stock/" + lot.id + "/status", pharmacist, {
        status: "AVAILABLE",
        reason: "Synthetic release without source",
      });
      assert(
        r.status === 409 && r.data.code === "LOT_PROVENANCE_REQUIRED",
        "Unproven stock released",
      );
      saved(
        await call("/stock/" + lot.id + "/status", pharmacist, {
          status: "AVAILABLE",
          reason: "Synthetic reviewed lot and expiry",
          document_ref: "TEST-ONLY physical lot document " + tag,
        }),
      );
      const [review] = await sql(
        "SELECT lot_status,provenance FROM hms_medicine_batches WHERE id=$1",
        [lot.id],
      );
      assert(
        review.lot_status === "AVAILABLE" && review.provenance.document_ref,
        "Review evidence missing",
      );
      saved(
        await call("/stock/" + lot.id + "/status", pharmacist, {
          status: "QUARANTINED",
          reason: "Synthetic fixture retained outside saleable stock",
        }),
      );
    },
  );
  await step(
    "A recall cannot be bypassed through an intermediate quarantine state",
    async () => {
      const [lot] = await sql(
        "INSERT INTO hms_medicine_batches(medicine_id,batch_number,expiry_date,quantity,mrp,purchase_rate) VALUES($1,$2,CURRENT_DATE+90,0,2,1) RETURNING id",
        [product.legacy_medicine_id, "P3-RECALL-" + tag],
      );
      saved(
        await call("/stock/" + lot.id + "/status", pharmacist, {
          status: "RECALLED",
          reason: "Synthetic recall",
        }),
      );
      const r = await call("/stock/" + lot.id + "/status", pharmacist, {
        status: "QUARANTINED",
        reason: "Attempted intermediate relabelling",
      });
      assert(
        r.status === 409 && r.data.code === "LOT_CANNOT_RELEASE",
        "Recall relabelled through API",
      );
      let blocked = false;
      try {
        await sql(
          "UPDATE hms_medicine_batches SET lot_status='AVAILABLE' WHERE id=$1",
          [lot.id],
        );
      } catch (e) {
        blocked = /recalled lot/i.test(e.message);
      }
      assert(blocked, "Database allowed recall bypass");
    },
  );
  await step(
    "Counter sale cannot bypass an unapproved formulary or an unrecorded pharmacist review",
    async () => {
      const [lot] = await sql(
        "SELECT b.id FROM hms_medicine_batches b JOIN hms_med_balances x ON x.batch_id=b.id JOIN hms_med_locations l ON l.id=x.location_id WHERE b.medicine_id=$1 AND b.lot_status='AVAILABLE' AND x.quantity>=1 AND l.code='MAIN' ORDER BY b.expiry_date,b.id LIMIT 1",
        [product.legacy_medicine_id],
      );
      assert(lot, "Counter fixture lot missing");
      const body = {
        items: [
          {
            medicineId: product.legacy_medicine_id,
            batchId: lot.id,
            quantity: 1,
          },
        ],
        paymentMode: "Cash",
        clinicalReviewAcknowledged: true,
        clinicalReviewReason: "Synthetic retail permission review " + tag,
      };
      const denied = await api("POST", "/pharmacy/otc", {
        token: await apiLogin("admin"),
        body,
      });
      assert(
        denied.status === 403,
        "Administrator acquired pharmacist review authority",
      );
      let r = await api("POST", "/pharmacy/otc", { token: pharmacist, body });
      assert(
        r.status === 409,
        "Product with no counter-sale permission was sold",
      );
      saved(
        await call("/products/" + product.id + "/formulary", pharmacist, {
          restrictions: { otc_allowed: true },
          provenance: "Synthetic counter-sale fixture permission only",
          effective_at: now(),
        }),
        201,
      );
      r = await api("POST", "/pharmacy/otc", {
        token: pharmacist,
        body: { ...body, clinicalReviewAcknowledged: false },
      });
      assert(r.status === 422, "Missing pharmacist review was accepted");
      r = await api("POST", "/pharmacy/otc", { token: pharmacist, body });
      assert(
        r.status === 200,
        "Reviewed approved counter sale failed: " + JSON.stringify(r.data),
      );
      const [sale] = await sql(
        "SELECT clinical_review FROM hms_otc_sales WHERE id=$1",
        [r.data.saleId],
      );
      assert(
        sale.clinical_review.state === "PHARMACIST_REVIEWED" &&
          sale.clinical_review.coverage === "INCOMPLETE_CLINICAL_CONTEXT" &&
          sale.clinical_review.products[0].product_id === product.id,
        "Counter review falsely claimed complete coverage or lost its source",
      );
      const [composition] = await sql(
        "SELECT ingredient_id FROM hms_med_product_ingredients WHERE product_id=$1 LIMIT 1",
        [product.id],
      );
      saved(
        await call("/allergies/" + patient.id, nurse, {
          ingredient_id: composition.ingredient_id,
          clinical_text: "Synthetic counter-sale allergy",
          reaction: "Synthetic reaction",
          clinical_status: "ACTIVE",
          verification_status: "CONFIRMED",
        }),
        201,
      );
      r = await api("POST", "/pharmacy/otc", {
        token: pharmacist,
        body: { ...body, patientId: patient.id },
      });
      assert(
        r.status === 409 && /ingredient allergy/.test(r.data.message),
        "Counter sale bypassed a known ingredient allergy",
      );
    },
  );
  await step(
    "Controlled ward transfer attests the exact approved quantity and destination",
    async () => {
      const [controlled] = await sql(
        "SELECT id FROM hms_med_products WHERE status='APPROVED' AND controlled AND code LIKE 'CONTROLLED-%' ORDER BY effective_at DESC LIMIT 1",
      );
      const [ward] = await sql(
        "SELECT id FROM hms_med_locations WHERE kind='WARD' ORDER BY code LIMIT 1",
      );
      assert(controlled && ward, "Controlled fixture missing");
      const requested = saved(
        await call("/requisitions", nurse, {
          product_id: controlled.id,
          destination_id: ward.id,
          quantity: "0.25",
          reason: "Synthetic controlled ward request",
        }),
        201,
      );
      const approved = saved(
        await call(
          "/requisitions/" + requested.id + "/approve",
          pharmacist,
          {},
          1,
        ),
      );
      const details = {
        product_id: controlled.id,
        destination_id: ward.id,
        quantity: approved.quantity,
      };
      const [performer] = await sql(
        "SELECT id FROM hms_users WHERE username='pharmacist'",
      );
      const [reviewer] = await sql(
        "SELECT id FROM hms_users WHERE username='doctor'",
      );
      const request = saved(
        await call("/witness-requests", pharmacist, {
          action: "TRANSFER",
          subject_id: requested.id,
          details,
          requested_witness_user_id: reviewer.id,
        }),
        201,
      );
      const attestation = saved(
        await call("/witness-requests/" + request.id + "/attest", doctor, {
          reason: "Synthetic independent transfer review",
        }),
      );
      const wrong = await call(
        "/requisitions/" + requested.id + "/pick",
        pharmacist,
        { ...details, quantity: "0.5", witness_id: attestation.witness_id },
        approved.revision,
      );
      assert(
        wrong.status === 409 && wrong.data.code === "TRANSFER_CONTEXT_MISMATCH",
        "Changed transfer quantity passed witness review",
      );
      const picked = saved(
        await call(
          "/requisitions/" + requested.id + "/pick",
          pharmacist,
          { ...details, witness_id: attestation.witness_id },
          approved.revision,
        ),
      );
      assert(picked.state === "PICKED", "Transfer not in transit");
      const received = saved(
        await call(
          "/requisitions/" + requested.id + "/receive",
          nurse,
          {},
          picked.revision,
        ),
      );
      assert(received.state === "RECEIVED", "Receiver acknowledgment missing");
      const [entry] = await sql(
        "SELECT r.performer_user_id,w.witness_user_id FROM hms_med_controlled_register r JOIN hms_med_witnesses w ON w.id=r.witness_id JOIN hms_med_transfer_lines l ON l.id::text=r.source_id WHERE l.requisition_id=$1 AND r.action='TRANSFER'",
        [requested.id],
      );
      assert(
        entry &&
          entry.performer_user_id === performer.id &&
          entry.witness_user_id === reviewer.id,
        "Controlled transfer register missing",
      );
    },
  );
  done();
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
