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
  expected,
  event,
  order,
  active,
  userRole,
} = C;
const I = require("./medicationInventory");
async function schedule(oid, b, u, header, tx) {
  await require('./medicationAccess.cts').authorize(u,u.role==='pharmacist'?'DISPENSE':'NURSING_DOCUMENT',tx);
  const { o, v } = await order(oid, tx);
  expected(header, o.revision);
  await active(o, v, tx);
  check(
    !v.prn,
    "PRN_OCCURRENCE_REQUIRED",
    "PRN occurrences must be explicitly requested.",
  );
  const through = instant(b.through_at, "Schedule through");
  check(
    C.epoch(through) > C.epoch(v.starts_at) &&
      C.epoch(through) <= C.epoch(v.ends_at),
    "INVALID_SCHEDULE_PERIOD",
    "Schedule through must be inside the order period.",
  );
  const interval = v.frequency.interval_minutes;
  check(
    v.frequency.type === "INTERVAL" &&
      Number.isInteger(interval) &&
      interval > 0,
    "INVALID_FREQUENCY",
    "This frequency cannot generate a validated schedule.",
  );
  const from = b.from_at ? instant(b.from_at, "Schedule from") : v.starts_at;
  check(
    C.epoch(from) >= C.epoch(v.starts_at) && C.epoch(from) < C.epoch(through),
    "INVALID_SCHEDULE_PERIOD",
    "Schedule from must be within the order.",
  );
  const count = Math.ceil(
    (C.epoch(through) - C.epoch(from)) / (interval * 60000),
  );
  check(
    count <= 500,
    "SCHEDULE_TOO_LARGE",
    "Generate no more than 500 occurrences per request.",
  );
  const occurrences = await q(
    `INSERT INTO hms_med_schedules(version_id,patient_id,scheduled_at,created_by_user_id)
 SELECT :v,:pid,t,:user FROM generate_series(CAST(:start AS timestamptz) + ceil(extract(epoch FROM(CAST(:from AS timestamptz)-CAST(:start AS timestamptz)))/(:minutes *60)) * (:minutes ||' minutes')::interval,CAST(:through AS timestamptz)-interval '1 microsecond',(:minutes ||' minutes')::interval) t
 WHERE t>=CAST(:from AS timestamptz) ON CONFLICT(version_id,scheduled_at) DO NOTHING RETURNING *`,
    {
      v: v.id,
      pid: o.patient_id,
      user: u.id,
      start: v.starts_at,
      through,
      minutes: interval,
      from,
    },
    tx,
  );
  await event(
    "medication_schedule_changed",
    { order_id: o.id, patient_id: o.patient_id },
    tx,
  );
  return occurrences;
}
async function prn(oid, b, u, header, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const { o, v } = await order(oid, tx);
  expected(header, o.revision);
  await active(o, v, tx);
  check(v.prn, "NOT_PRN", "The order is not PRN.");
  const at = instant(b.scheduled_at, "PRN occurrence time");
  check(
    C.epoch(at) >= C.epoch(v.starts_at) && C.epoch(at) < C.epoch(v.ends_at),
    "INVALID_TIME",
    "PRN occurrence must be inside the order period.",
  );
  return one(
    `INSERT INTO hms_med_schedules(version_id,patient_id,scheduled_at,prn,indication,created_by_user_id)
 VALUES(:v,:pid,:at,true,:indication,:user) RETURNING *`,
    {
      v: v.id,
      pid: o.patient_id,
      at,
      indication: text(b.indication, "PRN indication"),
      user: u.id,
    },
    tx,
  );
}
async function occurrence(sid, tx, historical = false) {
  const facility=require('./medicationAccess.cts').facility();
  const hint = await one(
    "SELECT v.order_id FROM hms_med_schedules s JOIN hms_med_order_versions v ON v.id=s.version_id AND v.facility_id=s.facility_id WHERE s.id=:id AND s.facility_id=:facility",
    { id: id(sid, "Occurrence"),facility },
    tx,
  );
  check(hint, "NOT_FOUND", "Occurrence not found.", 404);
  const { o, v: currentVersion } = await order(hint.order_id, tx);
  const s = await one(
    "SELECT * FROM hms_med_schedules WHERE id=:id AND facility_id=:facility FOR UPDATE",
    { id: sid,facility },
    tx,
  );
  const v = historical
    ? await one(
        "SELECT * FROM hms_med_order_versions WHERE id=:id AND facility_id=:facility",
        { id: s.version_id,facility },
        tx,
      )
    : currentVersion;
  check(
    historical || v.id === s.version_id,
    "STALE_ORDER_VERSION",
    "This occurrence belongs to a superseded order version.",
    409,
  );
  return { o, v, s };
}
async function scan(o, v, b, tx, historical = false) {
  check(
    integer(b.patient_id, "Patient") === o.patient_id,
    "WRONG_PATIENT",
    "Patient does not match this order.",
  );
  const patient = await one(
    "SELECT uhid FROM hms_patients WHERE id=:id",
    { id: o.patient_id },
    tx,
  );
  const p = historical
    ? await one(
        "SELECT * FROM hms_med_products WHERE id=:id",
        { id: id(b.product_id || v.product_id) },
        tx,
      )
    : await I.product(b.product_id || v.product_id, tx);
  check(p, "PRODUCT_NOT_FOUND", "Approved historical product not found.", 404);
  const substitution =
    v.product_id !== p.id
      ? await one(
          "SELECT id FROM hms_med_substitutions WHERE version_id=:v AND product_id=:p",
          { v: v.id, p: p.id },
          tx,
        )
      : null;
  check(
    p.id === v.product_id || substitution,
    "WRONG_PRODUCT",
    "Product does not match the order or authorized substitution.",
  );
  check(
    b.route === v.route &&
      b.dose_unit === v.dose_unit &&
      (
        await one(
          "SELECT CAST(:actual AS numeric)=CAST(:intended AS numeric) AS matches",
          { actual: decimal(b.dose, "Actual dose"), intended: v.dose },
          tx,
        )
      ).matches,
    "DOSE_ROUTE_MISMATCH",
    "Confirm the exact intended dose, unit and route.",
  );
  const evidence = b.scan_evidence;
  check(
    evidence && ["BARCODE", "MANUAL"].includes(evidence.mode),
    "SCAN_EVIDENCE_REQUIRED",
    "Barcode evidence or documented manual verification is required.",
  );
  check(
    evidence.patient_identifier === patient.uhid,
    "WRONG_PATIENT",
    "Wristband/manual patient identifier does not match.",
  );
  check(
    evidence.route_checked === true &&
      evidence.dose_checked === true &&
      evidence.time_checked === true,
    "FIVE_RIGHTS_REQUIRED",
    "Confirm dose, route and scheduled time at the bedside.",
  );
  if (evidence.mode === "BARCODE")
    check(
      p.barcode && evidence.product_barcode === p.barcode,
      "WRONG_PRODUCT",
      "Product barcode does not match the approved identity.",
    );
  else {
    text(evidence.reason, "Manual fallback reason");
    check(
      evidence.product_id === p.id && evidence.identity_confirmed === true,
      "MANUAL_CHECK_REQUIRED",
      "Manual fallback requires positive patient and product identity confirmation.",
    );
  }
  return { p, evidence };
}
async function doseAvailability(o, v, p, b, at, tx, historical = false) {
  const line = await one(
    `SELECT l.*,d.patient_id,ba.lot_status,ba.expiry_date FROM hms_med_dispense_lines l
 JOIN hms_med_dispenses d ON d.id=l.dispense_id JOIN hms_medicine_batches ba ON ba.id=l.batch_id WHERE l.id=:id FOR UPDATE OF l FOR SHARE OF ba`,
    { id: id(b.dispense_line_id, "Dispense line") },
    tx,
  );
  check(
    line &&
      line.version_id === v.id &&
      line.patient_id === o.patient_id &&
      line.product_id === p.id,
    "SUPPLY_MISMATCH",
    "A supplied product for this exact patient and order version is required.",
  );
  const expiry = await one(
    "SELECT b.expiry_date >= (CAST(:at AS timestamptz) AT TIME ZONE l.timezone)::date AS valid FROM hms_medicine_batches b JOIN hms_med_locations l ON l.id=:location WHERE b.id=:batch",
    { at, location: line.location_id, batch: line.batch_id },
    tx,
  );
  check(
    (historical || line.lot_status === "AVAILABLE") && expiry?.valid,
    "LOT_UNAVAILABLE",
    "Recalled, quarantined or expired product cannot be administered.",
    409,
  );
  const quantity = await one(
    `SELECT CASE WHEN :unit = :base THEN CAST(:dose AS numeric)
 ELSE CAST(:dose AS numeric)/CAST(:strength AS numeric)*coalesce(CAST(:denominator AS numeric),1) END::text AS quantity`,
    {
      unit: v.dose_unit,
      base: p.base_unit,
      dose: v.dose,
      strength: p.strength,
      denominator: p.concentration_denominator,
    },
    tx,
  );
  decimal(
    quantity.quantity,
    "Administration base quantity",
    p.quantity_precision,
  );
  const available = await one(
    `SELECT CAST(:supplied AS numeric)-coalesce((SELECT sum(base_quantity) FROM hms_med_administrations WHERE dispense_line_id=:line AND outcome='GIVEN'),0)
 -coalesce((SELECT sum(quantity) FROM hms_med_returns WHERE dispense_line_id=:line),0) AS remaining`,
    { supplied: line.quantity, line: line.id },
    tx,
  );
  check(
    (
      await one(
        "SELECT CAST(:need AS numeric)<=CAST(:have AS numeric) AS allowed",
        { need: quantity.quantity, have: available.remaining },
        tx,
      )
    ).allowed,
    "SUPPLY_EXHAUSTED",
    "The supplied, unused quantity is insufficient.",
    409,
  );
  if (!v.prn) {
    const previous = await one(
      `SELECT 1 FROM hms_med_administrations WHERE version_id=:version AND outcome='GIVEN'
       AND abs(extract(epoch FROM(actual_at-CAST(:at AS timestamptz)))) < :minutes * 60 LIMIT 1`,
      { version: v.id, at, minutes: v.frequency.interval_minutes },
      tx,
    );
    check(
      !previous,
      "SCHEDULE_INTERVAL_EXCEEDED",
      "The signed administration interval has not elapsed.",
      409,
    );
  }
  if (v.prn) {
    const previous = await one(
      `SELECT coalesce(sum(dose),0)::text AS used,coalesce(bool_or(abs(extract(epoch FROM(actual_at-CAST(:at AS timestamptz))))< :minutes *60),false) AS too_close
 FROM hms_med_administrations WHERE version_id=:vid AND outcome='GIVEN'
 AND actual_at>CAST(:at AS timestamptz)-(:hours ||' hours')::interval AND actual_at<CAST(:at AS timestamptz)+(:hours ||' hours')::interval`,
      {
        vid: v.id,
        at,
        minutes: v.min_interval_minutes,
        hours: v.max_period_hours,
      },
      tx,
    );
    check(
      !previous.too_close,
      "PRN_INTERVAL_EXCEEDED",
      "The PRN minimum interval has not elapsed.",
      409,
    );
    check(
      (
        await one(
          "SELECT CAST(:used AS numeric)+CAST(:dose AS numeric)<=CAST(:maximum AS numeric) AS allowed",
          { used: previous.used, dose: v.dose, maximum: v.max_dose },
          tx,
        )
      ).allowed,
      "PRN_LIMIT_EXCEEDED",
      "This dose would exceed the PRN maximum.",
      409,
    );
  }
  return { line, baseQuantity: quantity.quantity };
}
async function prepare(sid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const { o, v, s } = await occurrence(sid, tx);
  await active(o, v, tx);
  check(
    s.state === "PENDING",
    "OCCURRENCE_ALREADY_RECORDED",
    "This occurrence is already recorded or cancelled.",
    409,
  );
  check(
    C.epoch(v.starts_at) <= Date.now() && C.epoch(v.ends_at) > Date.now(),
    "ORDER_OUTSIDE_PERIOD",
    "The order is outside its active period.",
    409,
  );
  check(
    !(await one(
      "SELECT 1 FROM hms_med_documentation_intents i JOIN hms_med_schedules s ON s.id=i.schedule_id JOIN hms_med_order_versions v ON v.id=s.version_id WHERE v.order_id=:oid AND s.id<> :sid AND i.state='PENDING_DOCUMENTATION'",
      { oid: o.id, sid: s.id },
      tx,
    )),
    "PENDING_DOCUMENTATION",
    "An earlier dose for this order still needs reconciliation. Do not give another dose.",
    409,
  );
  check(
    s.prn || C.epoch(s.scheduled_at) <= Date.now(),
    "OCCURRENCE_NOT_DUE",
    "This scheduled occurrence is not due yet.",
    409,
  );
  const { p, evidence } = await scan(o, v, b, tx);
  await doseAvailability(o, v, p, b, new Date().toISOString(), tx);
  const prior = await one(
    "SELECT * FROM hms_med_documentation_intents WHERE schedule_id=:id",
    { id: s.id },
    tx,
  );
  check(
    !prior,
    "PENDING_DOCUMENTATION",
    "This occurrence already has a bedside claim. Reconcile its documentation; do not give another dose.",
    409,
  );
  const intent = await one(
    "INSERT INTO hms_med_documentation_intents(schedule_id,performer_user_id,scan_evidence) VALUES(:id,:user,CAST(:scan AS jsonb)) RETURNING *",
    {
      id: s.id,
      user: u.id,
      scan: JSON.stringify({
        ...evidence,
        patient_id: o.patient_id,
        product_id: p.id,
        dispense_line_id: b.dispense_line_id,
        dose: b.dose,
        dose_unit: b.dose_unit,
        route: b.route,
      }),
    },
    tx,
  );
  await event(
    "medication_documentation_pending",
    { schedule_id: s.id, patient_id: o.patient_id },
    tx,
  );
  return intent;
}
async function administer(sid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const historical = Boolean(b.late_review_id);
  const { o, v, s } = await occurrence(sid, tx, historical);
  if (!historical) await active(o, v, tx);
  else {
    const r = await one(
      "SELECT * FROM hms_med_late_documentation_reviews WHERE id=:id",
      { id: id(b.late_review_id) },
      tx,
    );
    check(
      r &&
        r.schedule_id === s.id &&
        r.performer_user_id === u.id &&
        r.approved_by_user_id === o.prescriber_user_id &&
        r.request_hash === documentationHash(b),
      "INVALID_LATE_REVIEW",
      "Late review does not authorize this exact prior documentation.",
      409,
    );
  }
  check(
    s.state === "PENDING" || (historical && s.state === "CANCELLED"),
    "OCCURRENCE_ALREADY_RECORDED",
    "This occurrence is already recorded; never repeat the physical dose.",
    409,
  );
  check(
    ["GIVEN", "HELD", "REFUSED", "OMITTED"].includes(b.outcome),
    "INVALID_OUTCOME",
    "Record given, held, refused or omitted.",
  );
  const at = instant(b.actual_at, "Actual time");
  check(
    C.epoch(at) <= Date.now() + 60000,
    "FUTURE_ADMINISTRATION",
    "Actual administration cannot be in the future.",
  );
  check(
    C.epoch(at) >= C.epoch(v.starts_at) && C.epoch(at) < C.epoch(v.ends_at),
    "ORDER_OUTSIDE_PERIOD",
    "Actual time is outside the authorized order period.",
    409,
  );
  if (b.outcome === "GIVEN") {
    const verified = await one(
      "SELECT reviewed_at FROM hms_med_verifications WHERE version_id=:id AND state='VERIFIED'",
      { id: v.id },
      tx,
    );
    check(
      C.epoch(at) >= C.epoch(v.signed_at) &&
        C.epoch(at) >= C.epoch(verified?.reviewed_at),
      "ADMINISTRATION_BEFORE_AUTHORIZATION",
      "Actual administration must follow signing and exact-version pharmacist verification.",
    );
  }
  const { p, evidence } = await scan(o, v, b, tx, historical);
  let supply = null,
    w = null;
  const intent = await one(
    "SELECT * FROM hms_med_documentation_intents WHERE schedule_id=:id FOR UPDATE",
    { id: s.id },
    tx,
  );
  if (intent)
    check(
      intent.performer_user_id === u.id,
      "DOCUMENTATION_OWNER_REQUIRED",
      "Only the nurse who claimed this occurrence can reconcile it.",
      403,
    );
  if (b.outcome === "GIVEN") {
    check(
      intent?.state === "PENDING_DOCUMENTATION",
      "BEDSIDE_CLAIM_REQUIRED",
      "Confirm a bedside claim before administering.",
    );
    check(
      intent.scan_evidence.dispense_line_id === b.dispense_line_id &&
        intent.scan_evidence.product_id === p.id,
      "CLAIM_EVIDENCE_MISMATCH",
      "The supplied product must match the bedside claim.",
    );
    supply = await doseAvailability(o, v, p, b, at, tx, historical);
    if (p.controlled) w = await I.witness("ADMINISTRATION", s.id, b, u, tx);
  } else text(b.reason, "Dose exception reason");
  const a = await one(
    `INSERT INTO hms_med_administrations(schedule_id,version_id,patient_id,product_id,dispense_line_id,outcome,dose,dose_unit,route,actual_at,performer_user_id,scan_evidence,reason,witness_id,base_quantity,late_review_id)
 VALUES(:sid,:vid,:pid,:product,:line,:outcome,:dose,:unit,:route,:at,:user,CAST(:scan AS jsonb),:reason,:witness,:base,:late) RETURNING *`,
    {
      sid: s.id,
      vid: v.id,
      pid: o.patient_id,
      product: p.id,
      line: supply?.line.id || null,
      outcome: b.outcome,
      dose: v.dose,
      unit: v.dose_unit,
      route: v.route,
      at,
      user: u.id,
      scan: JSON.stringify(evidence),
      reason: b.reason || null,
      witness: w,
      base: supply?.baseQuantity || "0",
      late: b.late_review_id || null,
    },
    tx,
  );
  await q(
    "UPDATE hms_med_schedules SET state=:outcome WHERE id=:id",
    { outcome: b.outcome, id: s.id },
    tx,
  );
  if (intent)
    await q(
      "UPDATE hms_med_documentation_intents SET state='DOCUMENTED',documented_at=now() WHERE id=:id",
      { id: intent.id },
      tx,
    );
  if (supply)
    await I.register(
      p,
      supply.line.batch_id,
      supply.line.location_id,
      "ADMINISTRATION",
      supply.baseQuantity,
      a.id,
      u,
      w,
      tx,
    );
  if (b.outcome !== "GIVEN" || v.prn)
    await q(
      `INSERT INTO hms_med_tasks(patient_id,order_id,administration_id,kind,assigned_user_id,created_by_user_id,detail)
 VALUES(:pid,:oid,:aid,:kind,:doctor,:user,:detail)`,
      {
        pid: o.patient_id,
        oid: o.id,
        aid: a.id,
        kind: b.outcome !== "GIVEN" ? "DOSE_EXCEPTION" : "PRN_REASSESSMENT",
        doctor: o.prescriber_user_id,
        user: u.id,
        detail:
          b.outcome !== "GIVEN"
            ? `${b.outcome}: ${b.reason}`
            : "PRN effect requires reassessment",
      },
      tx,
    );
  await event(
    "medication_administration_recorded",
    { schedule_id: s.id, patient_id: o.patient_id, outcome: b.outcome },
    tx,
  );
  return a;
}
function documentationHash(b) {
  return C.digest(
    Object.fromEntries(
      Object.entries(b).filter(
        ([k]) => !["witness_id", "late_review_id"].includes(k),
      ),
    ),
  );
}
async function requestLate(sid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const { o, v, s } = await occurrence(sid, tx, true);
  const intent = await one(
    "SELECT * FROM hms_med_documentation_intents WHERE schedule_id=:id",
    { id: s.id },
    tx,
  );
  check(
    intent?.state === "PENDING_DOCUMENTATION" &&
      intent.performer_user_id === u.id,
    "PENDING_DOCUMENTATION_REQUIRED",
    "Only the claiming nurse can request review of prior documentation.",
    403,
  );
  check(
    b.documentation?.outcome === "GIVEN" &&
      b.documentation.patient_id === o.patient_id,
    "INVALID_LATE_REQUEST",
    "Review must describe the prior given dose for this patient.",
  );
  instant(b.documentation.actual_at, "Prior actual time");
  text(b.reason, "Review request reason");
  const request = await one(
    `INSERT INTO hms_med_late_documentation_requests(schedule_id,performer_user_id,details,request_hash,reason)
 VALUES(:sid,:user,CAST(:details AS jsonb),:hash,:reason) ON CONFLICT(schedule_id,request_hash) DO UPDATE SET request_hash=EXCLUDED.request_hash RETURNING *`,
    {
      sid: s.id,
      user: u.id,
      details: JSON.stringify(b.documentation),
      hash: documentationHash(b.documentation),
      reason: b.reason,
    },
    tx,
  );
  await event(
    "medication_late_documentation_requested",
    {
      schedule_id: s.id,
      patient_id: o.patient_id,
      review_request_id: request.id,
      doctor_user_id: o.prescriber_user_id,
    },
    tx,
  );
  return request;
}
async function reviewLate(rid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'CLINICAL_SIGN',tx);
  const request = await one(
    "SELECT * FROM hms_med_late_documentation_requests WHERE id=:id",
    { id: id(rid) },
    tx,
  );
  check(request, "NOT_FOUND", "Review request not found.", 404);
  const { o, v, s } = await occurrence(request.schedule_id, tx, true);
  check(
    o.prescriber_user_id === u.id,
    "PRESCRIBER_REVIEW_REQUIRED",
    "Only the responsible prescriber can review prior documentation.",
    403,
  );
  check(
    !request.review_id,
    "ALREADY_REVIEWED",
    "This request already has a review.",
    409,
  );
  const intent = await one(
    "SELECT * FROM hms_med_documentation_intents WHERE schedule_id=:id FOR UPDATE",
    { id: s.id },
    tx,
  );
  check(
    intent?.state === "PENDING_DOCUMENTATION",
    "DOCUMENTATION_ALREADY_RECONCILED",
    "Documentation is no longer pending.",
    409,
  );
  const details = request.details,
    actual = instant(details.actual_at, "Actual time");
  const verification = await one(
    "SELECT * FROM hms_med_verifications WHERE version_id=:id AND state='VERIFIED'",
    { id: v.id },
    tx,
  );
  check(
    verification &&
      C.epoch(actual) >= C.epoch(v.signed_at) &&
      C.epoch(actual) >= C.epoch(verification.reviewed_at) &&
      C.epoch(actual) >= C.epoch(v.starts_at) &&
      C.epoch(actual) < C.epoch(v.ends_at) &&
      C.epoch(actual) <= Date.now(),
    "PRIOR_AUTHORIZATION_REQUIRED",
    "The prior actual time must follow authorization and lie within the original order period.",
  );
  const disruption = await one(
    "SELECT min(recorded_at) AS first_disruption FROM hms_med_transitions WHERE order_id=:id AND action IN ('HOLD','DISCONTINUE','AMEND') AND recorded_at> :signed",
    { id: o.id, signed: v.signed_at },
    tx,
  );
  check(
    !disruption.first_disruption ||
      C.epoch(actual) < C.epoch(disruption.first_disruption),
    "PRIOR_ACTIVE_ORDER_REQUIRED",
    "Review cannot authorize a dose given after the order was held, discontinued or amended.",
  );
  await scan(o, v, details, tx, true);
  const review = await one(
    `INSERT INTO hms_med_late_documentation_reviews(schedule_id,version_id,patient_id,performer_user_id,approved_by_user_id,actual_at,request_hash,reason)
 VALUES(:sid,:vid,:pid,:performer,:doctor,:actual,:hash,:reason) RETURNING *`,
    {
      sid: s.id,
      vid: v.id,
      pid: o.patient_id,
      performer: intent.performer_user_id,
      doctor: u.id,
      actual,
      hash: request.request_hash,
      reason: text(b.reason, "Clinical review reason"),
    },
    tx,
  );
  await q(
    "UPDATE hms_med_late_documentation_requests SET review_id=:review WHERE id=:id",
    { review: review.id, id: request.id },
    tx,
  );
  return review;
}
async function correct(aid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,u.role==='doctor'?'CLINICAL_SIGN':u.role==='pharmacist'?'DISPENSE':'NURSING_DOCUMENT',tx);
  const a = await one(
    "SELECT * FROM hms_med_administrations WHERE id=:id",
    { id: id(aid, "Administration") },
    tx,
  );
  check(a, "NOT_FOUND", "Administration not found.", 404);
  check(
    b.corrected_fields &&
      Object.keys(b.corrected_fields).length > 0 &&
      Object.keys(b.corrected_fields).every((k) =>
        ["actual_at", "notes", "entered_in_error"].includes(k),
      ),
    "CORRECTION_REVIEW_REQUIRED",
    "Linked corrections support actual time, notes and entered-in-error explanations; dose/stock changes require reconciliation.",
  );
  if (b.corrected_fields.actual_at)
    instant(b.corrected_fields.actual_at, "Corrected actual time");
  if (b.corrected_fields.entered_in_error !== undefined)
    check(
      typeof b.corrected_fields.entered_in_error === "boolean",
      "INVALID_CORRECTION",
      "Entered-in-error must be a boolean.",
    );
  const c = await one(
    "INSERT INTO hms_med_corrections(administration_id,corrected_fields,reason,author_user_id) VALUES(:id,CAST(:fields AS jsonb),:reason,:user) RETURNING *",
    {
      id: a.id,
      fields: JSON.stringify(b.corrected_fields),
      reason: text(b.reason, "Correction reason"),
      user: u.id,
    },
    tx,
  );
  const v = await one(
      "SELECT order_id FROM hms_med_order_versions WHERE id=:id",
      { id: a.version_id },
      tx,
    ),
    { o } = await order(v.order_id, tx);
  await q(
    "INSERT INTO hms_med_tasks(patient_id,order_id,administration_id,kind,assigned_user_id,created_by_user_id,detail) VALUES(:pid,:oid,:aid,'DOSE_EXCEPTION',:doctor,:user,:detail)",
    {
      pid: o.patient_id,
      oid: o.id,
      aid: a.id,
      doctor: o.prescriber_user_id,
      user: u.id,
      detail: "Administration correction requires review: " + b.reason,
    },
    tx,
  );
  return c;
}
async function handover(b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const pid = integer(b.patient_id, "Patient");
  await q("SELECT pg_advisory_xact_lock(727287,:pid)", { pid }, tx);
  const receiver = await userRole(b.receiver_user_id, ["nurse"], tx);
  check(
    receiver.id !== u.id,
    "INDEPENDENT_RECEIVER_REQUIRED",
    "Select a different receiving nurse.",
  );
  check(
    b.sbar &&
      ["situation", "background", "assessment", "recommendation"].every(
        (k) => typeof b.sbar[k] === "string" && b.sbar[k].trim(),
      ),
    "SBAR_REQUIRED",
    "All four SBAR sections are required.",
  );
  if (b.admission_id)
    check(
      await one(
        "SELECT id FROM hms_admissions WHERE id=:id AND patient_id=:pid AND status='Active'",
        { id: integer(b.admission_id, "Admission"), pid },
        tx,
      ),
      "PATIENT_ADMISSION_MISMATCH",
      "Admission must belong to this patient.",
    );
  const responsibility = await one(
    "SELECT * FROM hms_med_nursing_responsibility WHERE patient_id=:pid FOR UPDATE",
    { pid },
    tx,
  );
  check(
    !responsibility || responsibility.responsible_user_id === u.id,
    "RESPONSIBLE_NURSE_REQUIRED",
    "Only the currently responsible nurse can send handover.",
    403,
  );
  if (!responsibility)
    await q(
      "INSERT INTO hms_med_nursing_responsibility(patient_id,responsible_user_id) VALUES(:pid,:user)",
      { pid, user: u.id },
      tx,
    );
  check(
    !(await one(
      "SELECT id FROM hms_med_handovers WHERE patient_id=:pid AND state='SENT'",
      { pid },
      tx,
    )),
    "HANDOVER_PENDING",
    "An earlier handover still needs acknowledgment.",
    409,
  );
  const h = await one(
    "INSERT INTO hms_med_handovers(patient_id,admission_id,sender_user_id,receiver_user_id,sbar) VALUES(:pid,:aid,:sender,:receiver,CAST(:sbar AS jsonb)) RETURNING *",
    {
      pid,
      aid: b.admission_id || null,
      sender: u.id,
      receiver: receiver.id,
      sbar: JSON.stringify(b.sbar),
    },
    tx,
  );
  for (const task of b.outstanding_task_ids || []) {
    check(
      await one(
        "SELECT id FROM hms_med_tasks WHERE id=:id AND patient_id=:pid AND state<>'CLOSED' AND assigned_user_id=:sender FOR UPDATE",
        { id: id(task, "Task"), pid, sender: u.id },
        tx,
      ),
      "TASK_HANDOVER_MISMATCH",
      "Only this nurse’s open tasks for this patient can be transferred.",
    );
    await q(
      "INSERT INTO hms_med_handover_tasks(handover_id,task_id) VALUES(:h,:t)",
      { h: h.id, t: task },
      tx,
    );
  }
  // The receiving nurse sees the observations the sender had: the latest current set (A5).
  const linked = await q(
    `INSERT INTO hms_observation_links(observation_set_id,handover_id,facility_id,linked_by)
 SELECT s.id,:h,s.facility_id,:user FROM hms_observation_sets s
 WHERE s.patient_id=:pid AND s.facility_id=:facility AND NOT EXISTS (SELECT 1 FROM hms_observation_sets c WHERE c.correction_of=s.id)
 ORDER BY s.observed_at DESC,s.created_at DESC LIMIT 1 RETURNING observation_set_id`,
    { h: h.id, user: u.id, pid, facility: h.facility_id },
    tx,
  );
  await event(
    "nursing_handover_sent",
    { handover_id: h.id, receiver_user_id: receiver.id },
    tx,
  );
  return { ...h, observation_set_ids: linked.map((l) => l.observation_set_id) };
}
async function acknowledgeHandover(hid, b, u, header, tx) {
  await require('./medicationAccess.cts').authorize(u,'NURSING_DOCUMENT',tx);
  const hint = await one(
    "SELECT patient_id FROM hms_med_handovers WHERE id=:id",
    { id: id(hid) },
    tx,
  );
  check(hint, "NOT_FOUND", "Handover not found.", 404);
  await q(
    "SELECT pg_advisory_xact_lock(727287,:pid)",
    { pid: hint.patient_id },
    tx,
  );
  const h = await one(
    "SELECT * FROM hms_med_handovers WHERE id=:id FOR UPDATE",
    { id: hid },
    tx,
  );
  expected(header, h.revision);
  check(
    h.state === "SENT" && h.receiver_user_id === u.id,
    "RECEIVER_ACKNOWLEDGMENT_REQUIRED",
    "Only the designated receiving nurse can acknowledge this handover.",
    403,
  );
  const r = await one(
    "SELECT * FROM hms_med_nursing_responsibility WHERE patient_id=:pid FOR UPDATE",
    { pid: h.patient_id },
    tx,
  );
  check(
    r.responsible_user_id === h.sender_user_id,
    "RESPONSIBILITY_CONFLICT",
    "Responsibility changed before acknowledgment.",
    409,
  );
  for (const t of await q(
    "SELECT task_id FROM hms_med_handover_tasks WHERE handover_id=:id ORDER BY task_id",
    { id: h.id },
    tx,
  ))
    await q(
      "UPDATE hms_med_tasks SET assigned_user_id=:user WHERE id=:id AND state<>'CLOSED'",
      { user: u.id, id: t.task_id },
      tx,
    );
  await q(
    "UPDATE hms_med_nursing_responsibility SET responsible_user_id=:user,handover_id=:h,revision=revision+1,changed_at=now() WHERE patient_id=:pid",
    { user: u.id, h: h.id, pid: h.patient_id },
    tx,
  );
  return one(
    "UPDATE hms_med_handovers SET state='ACKNOWLEDGED',revision=revision+1,acknowledged_at=now() WHERE id=:id RETURNING *",
    { id: h.id },
    tx,
  );
}
async function taskAction(tid, b, u, tx) {
  await require('./medicationAccess.cts').authorize(u,u.role==='doctor'?'CLINICAL_SIGN':u.role==='pharmacist'?'DISPENSE':'NURSING_DOCUMENT',tx);
  const t = await one(
    "SELECT * FROM hms_med_tasks WHERE id=:id FOR UPDATE",
    { id: id(tid) },
    tx,
  );
  check(
    t && t.assigned_user_id === u.id,
    "TASK_OWNER_REQUIRED",
    "Only the assigned clinician can acknowledge or close this task.",
    403,
  );
  check(
    t.state !== "CLOSED" && ["ACKNOWLEDGED", "CLOSED"].includes(b.state),
    "INVALID_TRANSITION",
    "This task cannot accept that transition.",
    409,
  );
  if (b.state === "CLOSED")
    check(
      t.state === "ACKNOWLEDGED",
      "ACKNOWLEDGMENT_REQUIRED",
      "Acknowledge the task before recording closure.",
      409,
    );
  return one(
    `UPDATE hms_med_tasks SET state=:state,acknowledged_at=coalesce(acknowledged_at,now()),closed_at=CASE WHEN :state = 'CLOSED' THEN now() ELSE NULL END,
 closure_reason=:reason WHERE id=:id RETURNING *`,
    {
      id: t.id,
      state: b.state,
      reason:
        b.state === "CLOSED"
          ? text(b.reason, "Clinical action/closure reason")
          : null,
    },
    tx,
  );
}
module.exports = {
  requestLate,
  reviewLate,
  documentationHash,
  schedule,
  prn,
  prepare,
  administer,
  correct,
  handover,
  acknowledgeHandover,
  taskAction,
  scan,
  doseAvailability,
};
