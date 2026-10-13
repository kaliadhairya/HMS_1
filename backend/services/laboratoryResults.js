const C = require("./laboratoryCommon"),
  S = require("./laboratorySpecimens"),
  F = require("./laboratoryFollowup");
async function write(itemId, body, user, header, tx, source = "MANUAL") {
  const { item, order } = await C.lockItem(itemId, user, tx);
  C.expected(header, item.lab_revision);
  C.check(
    item.lab_test_version_id &&
      !["CANCELLED", "UNMAPPED"].includes(item.lab_state) &&
      order.status !== "Cancelled",
    "ORDER_NOT_PROCESSABLE",
    "A coded, non-cancelled test is required.",
    409,
  );
  const s = await C.one(
    `SELECT s.* FROM hms_lab_specimens s JOIN hms_lab_specimen_links l ON l.specimen_id=s.id WHERE s.id= :specimen AND l.item_id= :item FOR SHARE OF s`,
    { specimen: C.id(body.specimen_id), item: item.id },
    tx,
  );
  C.check(
    s &&
      s.patient_id === order.patient_id &&
      ["RECEIVED", "STORED"].includes(s.state),
    "SPECIMEN_NOT_RECEIVED",
    "A received, matching specimen is required.",
    409,
  );
  await S.requirementsComplete(item.id, tx);
  const test = await C.one(
    "SELECT * FROM hms_lab_test_versions WHERE id= :id",
    { id: item.lab_test_version_id },
    tx,
  );
  const method = C.text(body.method, "Method"),
    unit = C.text(body.unit, "Unit"),
    raw = C.text(body.raw_value, "Raw result", 500);
  C.check(
    method === test.method,
    "METHOD_MISMATCH",
    "The method must match the ordered test version.",
  );
  const old = await C.one(
    "SELECT * FROM hms_lab_result_versions WHERE item_id= :id ORDER BY version DESC LIMIT 1",
    { id: item.id },
    tx,
  );
  const reviewed =
    old &&
    (await C.one(
      "SELECT id FROM hms_lab_technical_reviews WHERE result_version_id= :id",
      { id: old.id },
      tx,
    ));
  if (reviewed)
    C.check(
      body.correction_of_id === old.id &&
        C.text(body.correction_reason, "Correction reason"),
      "CORRECTION_REQUIRED",
      "A reviewed result requires a linked correction.",
    );
  if (body.correction_of_id)
    C.check(
      old && body.correction_of_id === old.id,
      "CORRECTION_MISMATCH",
      "Correct the latest result version.",
    );
  let normalized = raw,
    conversion = null;
  if (unit !== test.unit) {
    const rows = await C.q(
      `SELECT * FROM hms_lab_conversions WHERE test_version_id= :test AND method= :method AND from_unit= :from AND to_unit= :to
 AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now())`,
      { test: test.id, method, from: unit, to: test.unit },
      tx,
    );
    C.check(
      rows.length === 1 && /^[+-]?\d+(?:\.\d+)?$/.test(raw),
      "UNIT_MISMATCH",
      "A numeric value and one approved explicit unit conversion are required.",
    );
    conversion = rows[0];
    const v = await C.one(
      "SELECT (:raw::numeric* :factor::numeric+ :offset::numeric)::text AS value",
      { raw, factor: conversion.multiplier, offset: conversion.offset_value },
      tx,
    );
    normalized = v.value;
  }
  const patient = await C.one(
    `SELECT age,gender,dob,birth_date_estimated,
 CASE WHEN dob IS NOT NULL AND NOT birth_date_estimated AND dob<=CURRENT_DATE THEN
 extract(year FROM age(CURRENT_DATE,dob))::numeric +
 (CURRENT_DATE-(dob+make_interval(years=>extract(year FROM age(CURRENT_DATE,dob))::int))::date)::numeric /
 ((dob+make_interval(years=>extract(year FROM age(CURRENT_DATE,dob))::int+1))::date-(dob+make_interval(years=>extract(year FROM age(CURRENT_DATE,dob))::int))::date)::numeric
 ELSE age::numeric END AS age_years FROM hms_patients WHERE id=:id`,
    { id: order.patient_id },
    tx,
  );
  const exact = patient.dob && !patient.birth_date_estimated;
  const context = {
    age_years: patient.age_years,
    age_upper_years: exact
      ? patient.age_years
      : String(Number(patient.age) + 1),
    age_source: exact ? "RECORDED_DOB" : "RECORDED_WHOLE_YEARS",
    sex: patient.gender,
  };
  const at = new Date().toISOString();
  const candidate = {
    method,
    normalized_unit: test.unit,
    normalized_value: normalized,
    context_snapshot: context,
    created_at: at,
  };
  const interval = await F.policy(
    "hms_lab_reference_intervals",
    candidate,
    item,
    tx,
  );
  let flag = "NO_REFERENCE_INTERVAL";
  if (interval) {
    flag = "NOT_ASSESSABLE";
    if (/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
      const n = await C.one(
        `SELECT CASE WHEN :low::numeric IS NOT NULL AND :value::numeric < :low::numeric THEN 'LOW' WHEN :high::numeric IS NOT NULL AND :value::numeric > :high::numeric THEN 'HIGH' ELSE 'IN_RANGE' END AS flag`,
        {
          low: interval.lower_bound,
          high: interval.upper_bound,
          value: normalized,
          lowInclusive: interval.lower_inclusive,
          highInclusive: interval.upper_inclusive,
        },
        tx,
      );
      flag = n.flag;
    }
  }
  let qc = null;
  if (body.qc_record_id) {
    qc = await C.one(
      `SELECT q.*,r.test_version_id,r.method,r.effective_at,r.expires_at FROM hms_lab_qc_records q JOIN hms_lab_qc_rules r ON r.id=q.rule_id WHERE q.id= :id`,
      { id: C.id(body.qc_record_id) },
      tx,
    );
    C.check(
      qc &&
        qc.test_version_id === test.id &&
        qc.method === method &&
        (!body.analyzer_run_id || qc.run_id === body.analyzer_run_id),
      "QC_MISMATCH",
      "QC must belong to this test, method and analyzer run.",
    );
  }
  const result = await C.one(
    `INSERT INTO hms_lab_result_versions(item_id,version,specimen_id,raw_value,raw_unit,normalized_value,normalized_unit,method,author_user_id,
 analyzer_run_id,qc_record_id,conversion_id,reference_interval_id,abnormal_flag,context_snapshot,correction_of_id,correction_reason,remarks,source)
 VALUES(:item,:version,:specimen,:raw,:unit,:value,:normalizedUnit,:method,:user,:run,:qc,:conversion,:interval,:flag,:context::jsonb,:previous,:reason,:remarks,:source) RETURNING *`,
    {
      item: item.id,
      version: (old?.version || 0) + 1,
      specimen: s.id,
      raw,
      unit,
      value: normalized,
      normalizedUnit: test.unit,
      method,
      user: user.id,
      run: body.analyzer_run_id || null,
      qc: qc?.id || null,
      conversion: conversion?.id || null,
      interval: interval?.id || null,
      flag,
      context: JSON.stringify(context),
      previous: body.correction_of_id || null,
      reason: body.correction_of_id
        ? C.text(body.correction_reason, "Correction reason")
        : null,
      remarks: body.remarks || null,
      source,
    },
    tx,
  );
  await C.q(
    `UPDATE hms_investigation_order_items SET lab_revision=lab_revision+1,lab_state='ENTERED',status='In Progress',updated_at=now() WHERE id= :id`,
    { id: item.id },
    tx,
  );
  await C.q(
    `UPDATE hms_investigation_orders SET status='In Progress',updated_at=now() WHERE id= :id`,
    { id: order.id },
    tx,
  );
  return { result, revision: item.lab_revision + 1 };
}
async function review(resultId, body, user, header, tx) {
  await C.privilege(user, "TECHNICAL_REVIEW", tx);
  const r = await C.one(
    "SELECT * FROM hms_lab_result_versions WHERE id= :id",
    { id: C.id(resultId) },
    tx,
  );
  C.check(r, "NOT_FOUND", "Result not found.", 404);
  const { item, order } = await C.lockItem(r.item_id, user, tx);
  C.expected(header, item.lab_revision);
  const current = await C.one(
    "SELECT id FROM hms_lab_result_versions WHERE item_id= :id ORDER BY version DESC LIMIT 1",
    { id: item.id },
    tx,
  );
  C.check(
    current.id === r.id && item.lab_state === "ENTERED",
    "RESULT_VERSION_NOT_CURRENT",
    "Review the current entered version.",
    409,
  );
  const qc = await C.one(
    `SELECT q.*,p.test_version_id,p.method,p.effective_at,p.expires_at FROM hms_lab_qc_records q JOIN hms_lab_qc_rules p ON p.id=q.rule_id WHERE q.id= :id`,
    { id: C.id(body.qc_record_id) },
    tx,
  );
  C.check(
    qc &&
      qc.test_version_id === item.lab_test_version_id &&
      qc.method === r.method &&
      (!r.analyzer_run_id || qc.run_id === r.analyzer_run_id),
    "QC_MISMATCH",
    "QC evidence must match this test, method and run.",
  );
  C.check(
    new Date(qc.effective_at) <= new Date(r.created_at) &&
      (!qc.expires_at || new Date(qc.expires_at) > new Date(r.created_at)),
    "QC_POLICY_NOT_EFFECTIVE",
    "QC policy was not effective for this result.",
  );
  await S.requirementsComplete(item.id, tx);
  const specimen = await C.one(
    "SELECT state FROM hms_lab_specimens WHERE id= :id FOR SHARE",
    { id: r.specimen_id },
    tx,
  );
  C.check(
    ["RECEIVED", "STORED"].includes(specimen.state),
    "SPECIMEN_REJECTED",
    "The result specimen is rejected.",
    409,
  );
  const decision =
    body.decision === "REPEAT" || qc.status !== "PASS" ? "REPEAT" : "VERIFIED";
  C.check(
    ["VERIFIED", "REPEAT"].includes(body.decision),
    "INVALID_DECISION",
    "Use VERIFIED or REPEAT.",
  );
  await C.q(
    "INSERT INTO hms_lab_technical_reviews(result_version_id,reviewer_user_id,qc_record_id,decision,reason) VALUES(:result,:user,:qc,:decision,:reason)",
    {
      result: r.id,
      user: user.id,
      qc: qc.id,
      decision,
      reason: C.text(body.reason, "Technical review evidence"),
    },
    tx,
  );
  await C.q(
    "UPDATE hms_investigation_order_items SET lab_state= :state,lab_revision=lab_revision+1 WHERE id= :id",
    { state: decision === "VERIFIED" ? "VERIFIED" : "REPEAT", id: item.id },
    tx,
  );
  const task =
    decision === "VERIFIED" ? await F.verified(r, item, order, user, tx) : null;
  await C.event(
    "lab_technical_review",
    order,
    { itemId: item.id, resultVersionId: r.id, decision },
    tx,
  );
  return { decision, critical_task: task, revision: item.lab_revision + 1 };
}
async function release(orderId, body, user, header, tx) {
  await C.privilege(user, "RELEASE", tx);
  const order = await C.lockOrder(orderId, user, tx);
  C.expected(header, order.lab_revision);
  C.check(
    order.status !== "Cancelled",
    "ORDER_CANCELLED",
    "A cancelled order cannot be released.",
    409,
  );
  C.check(
    ["PRELIMINARY", "FINAL", "AMENDED"].includes(body.status),
    "INVALID_REPORT_STATUS",
    "Use PRELIMINARY, FINAL or AMENDED.",
  );
  C.check(
    Array.isArray(body.result_version_ids) &&
      body.result_version_ids.length > 0 &&
      new Set(body.result_version_ids).size === body.result_version_ids.length,
    "INVALID_RESULTS",
    "Select distinct technically verified result versions.",
  );
  const items = await C.q(
    `SELECT i.*,r.id AS result_id,r.version,r.specimen_id,v.decision FROM hms_investigation_order_items i
 LEFT JOIN LATERAL(SELECT * FROM hms_lab_result_versions WHERE item_id=i.id ORDER BY version DESC LIMIT 1) r ON true
 LEFT JOIN hms_lab_technical_reviews v ON v.result_version_id=r.id WHERE i.order_id= :order AND i.status<>'Cancelled' ORDER BY i.id`,
    { order: order.id },
    tx,
  );
  const selected = items.filter((i) =>
    body.result_version_ids.includes(i.result_id),
  );
  C.check(
    selected.length === body.result_version_ids.length &&
      selected.every(
        (i) =>
          i.decision === "VERIFIED" &&
          ["VERIFIED", "RELEASED"].includes(i.lab_state),
      ),
    "UNVERIFIED_RESULT",
    "Release only the current technically verified versions.",
    409,
  );
  for (const item of selected) {
    await S.requirementsComplete(item.id, tx);
    const s = await C.one(
      "SELECT state FROM hms_lab_specimens WHERE id= :id FOR SHARE",
      { id: item.specimen_id },
      tx,
    );
    C.check(
      ["RECEIVED", "STORED"].includes(s.state),
      "SPECIMEN_REJECTED",
      "A selected specimen was rejected.",
      409,
    );
  }
  if (body.status !== "PRELIMINARY")
    C.check(
      selected.length === items.length,
      "REPORT_INCOMPLETE",
      "Final/amended reports must include every active test.",
      409,
    );
  let report = await C.one(
    "SELECT * FROM hms_lab_reports WHERE order_id= :id FOR UPDATE",
    { id: order.id },
    tx,
  );
  if (!report)
    report = await C.one(
      "INSERT INTO hms_lab_reports(order_id) VALUES(:id) RETURNING *",
      { id: order.id },
      tx,
    );
  const previous = await C.one(
    "SELECT * FROM hms_lab_report_versions WHERE report_id= :id ORDER BY version DESC LIMIT 1",
    { id: report.id },
    tx,
  );
  C.check(
    !previous ||
      !["FINAL", "AMENDED"].includes(previous.status) ||
      body.status === "AMENDED",
    "AMENDMENT_REQUIRED",
    "An authorized final report can only be amended.",
    409,
  );
  C.check(
    body.status !== "AMENDED" || previous,
    "AMENDMENT_REQUIRED",
    "There is no prior report to amend.",
    409,
  );
  const version = await C.one(
    `INSERT INTO hms_lab_report_versions(report_id,version,status,previous_version_id,reason,released_by_user_id)
 VALUES(:id,:version,:status,:previous,:reason,:user) RETURNING *`,
    {
      id: report.id,
      version: report.revision + 1,
      status: body.status,
      previous: previous?.id || null,
      reason: C.text(body.reason, "Release/amendment reason"),
      user: user.id,
    },
    tx,
  );
  for (const [position, i] of selected.entries()) {
    await C.q(
      "INSERT INTO hms_lab_report_results(report_version_id,result_version_id,position) VALUES(:report,:result,:position)",
      { report: version.id, result: i.result_id, position },
      tx,
    );
    const r = await C.one(
      "SELECT * FROM hms_lab_result_versions WHERE id= :id",
      { id: i.result_id },
      tx,
    );
    await C.q(
      `UPDATE hms_investigation_order_items SET lab_state='RELEASED',lab_revision=lab_revision+1,status='Completed',result_value= :value,reference_range=NULL,remarks= :remarks,updated_at=now() WHERE id= :id`,
      {
        id: i.id,
        value: r.normalized_value + " " + r.normalized_unit,
        remarks: r.remarks || null,
      },
      tx,
    );
  }
  await C.q(
    "UPDATE hms_lab_reports SET revision=revision+1 WHERE id= :id",
    { id: report.id },
    tx,
  );
  const next =
    selected.length === items.length && body.status !== "PRELIMINARY"
      ? "Completed"
      : "In Progress";
  await C.q(
    "UPDATE hms_investigation_orders SET status= :status,lab_revision=lab_revision+1,updated_at=now() WHERE id= :id",
    { id: order.id, status: next },
    tx,
  );
  const assigned = await F.responsible(order, tx);
  await C.q(
    "INSERT INTO hms_lab_review_tasks(report_version_id,patient_id,assigned_user_id) VALUES(:report,:patient,:assigned)",
    { report: version.id, patient: order.patient_id, assigned },
    tx,
  );
  await C.event(
    body.status === "AMENDED" ? "lab_report_amended" : "lab_result_ready",
    order,
    { reportVersionId: version.id, status: body.status, orderStatus: next },
    tx,
  );
  return { report, version, revision: order.lab_revision + 1 };
}
module.exports = { write, review, release };
