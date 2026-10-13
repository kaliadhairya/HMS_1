const C = require("./laboratoryCommon");
const tables = {
  reference: "hms_lab_reference_intervals",
  critical: "hms_lab_critical_policies",
  qc: "hms_lab_qc_rules",
  conversion: "hms_lab_conversions",
  escalation: "hms_lab_escalation_policies",
};
const fields = {
  reference: [
    "test_version_id",
    "version",
    "method",
    "unit",
    "sex",
    "min_age_years",
    "max_age_years",
    "lower_bound",
    "upper_bound",
    "lower_inclusive",
    "upper_inclusive",
  ],
  critical: [
    "test_version_id",
    "version",
    "method",
    "unit",
    "sex",
    "min_age_years",
    "max_age_years",
    "lower_bound",
    "upper_bound",
    "lower_inclusive",
    "upper_inclusive",
    "escalation_policy_id",
  ],
  qc: ["test_version_id", "version", "method", "criteria"],
  conversion: [
    "test_version_id",
    "method",
    "from_unit",
    "to_unit",
    "multiplier",
    "offset_value",
  ],
  escalation: ["code", "version"],
};
async function configure(kind, body, user, tx) {
  await C.privilege(user, "CONTENT", tx);
  C.check(tables[kind], "INVALID_POLICY", "Unknown configuration kind.");
  if (["reference", "critical"].includes(kind))
    C.check(
      typeof body.lower_inclusive === "boolean" &&
        typeof body.upper_inclusive === "boolean",
      "EXPLICIT_COMPARATORS_REQUIRED",
      "Declare both comparator inclusivity values from approved clinical content.",
    );
  const values = {
    provenance: C.text(body.provenance, "Provenance"),
    effective_at: require("./medicationCommon").instant(
      body.effective_at,
      "Effective time",
    ),
    expires_at: body.expires_at
      ? require("./medicationCommon").instant(body.expires_at, "Expiry time")
      : null,
    user: user.id,
  };
  for (const key of fields[kind]) values[key] = body[key] ?? null;
  if (values.test_version_id) C.id(values.test_version_id);
  if (kind === "qc")
    C.check(
      body.criteria &&
        typeof body.criteria === "object" &&
        !Array.isArray(body.criteria) &&
        Object.keys(body.criteria).length > 0,
      "QC_CRITERIA_REQUIRED",
      "Approved QC criteria are required.",
    );
  const columns = [
    ...fields[kind],
    "provenance",
    "effective_at",
    "expires_at",
    "approved_by_user_id",
  ];
  const row = await C.one(
    `INSERT INTO ${tables[kind]}(${columns.join(",")}) VALUES(${columns.map((k) => (k === "approved_by_user_id" ? ":user" : k === "criteria" ? ":criteria::jsonb" : ":" + k)).join(",")}) RETURNING *`,
    { ...values, criteria: JSON.stringify(body.criteria) },
    tx,
  );
  if (kind === "escalation") {
    C.check(
      Array.isArray(body.steps) && body.steps.length > 0,
      "ESCALATION_STEPS_REQUIRED",
      "Declare an approved timetable and recipients.",
    );
    let previous = -1;
    for (const [level, s] of body.steps.entries()) {
      C.check(
        Number.isSafeInteger(s.after_seconds) && s.after_seconds > previous,
        "INVALID_TIMETABLE",
        "Escalation deadlines must strictly increase.",
      );
      previous = s.after_seconds;
      const recipient = await C.one(
        "SELECT id FROM hms_users WHERE id= :id AND role='doctor' AND is_active=1",
        { id: C.integer(s.recipient_user_id) },
        tx,
      );
      C.check(
        recipient,
        "INVALID_RECIPIENT",
        "Escalation recipients must be active clinicians.",
      );
      await C.q(
        "INSERT INTO hms_lab_escalation_steps(policy_id,level,after_seconds,recipient_user_id) VALUES(:policy,:level,:seconds,:recipient)",
        {
          policy: row.id,
          level,
          seconds: s.after_seconds,
          recipient: recipient.id,
        },
        tx,
      );
    }
  }
  return row;
}
async function qc(body, user, tx) {
  await C.privilege(user, "TECHNICAL_REVIEW", tx);
  C.check(
    ["PASS", "FAIL", "REPEAT"].includes(body.status),
    "INVALID_QC_STATUS",
    "Use PASS, FAIL or REPEAT.",
  );
  C.check(
    body.evidence &&
      typeof body.evidence === "object" &&
      !Array.isArray(body.evidence) &&
      Object.keys(body.evidence).length > 0,
    "QC_EVIDENCE_REQUIRED",
    "Record actual QC evidence.",
  );
  return C.one(
    "INSERT INTO hms_lab_qc_records(run_id,rule_id,status,evidence,recorded_by_user_id) VALUES(:run,:rule,:status,:evidence::jsonb,:user) RETURNING *",
    {
      run: body.run_id || null,
      rule: C.id(body.rule_id),
      status: body.status,
      evidence: JSON.stringify(body.evidence),
      user: user.id,
    },
    tx,
  );
}
module.exports = { configure, qc, tables };
