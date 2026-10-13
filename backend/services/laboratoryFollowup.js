const C = require("./laboratoryCommon");
async function responsible(order, tx) {
  const u = await C.one(
    `SELECT u.id FROM hms_care_team_assignments c JOIN hms_users u ON u.id=c.practitioner_user_id
 WHERE c.patient_id= :patient AND c.valid_to IS NULL AND c.valid_from<=now() AND u.is_active=1 AND u.role='doctor'
 ORDER BY CASE c.role WHEN 'covering' THEN 0 WHEN 'primary' THEN 1 ELSE 2 END,c.valid_from DESC,c.id DESC LIMIT 1`,
    { patient: order.patient_id },
    tx,
  );
  if (u) return u.id;
  const author = await C.one(
    `SELECT id FROM hms_users WHERE id= :id AND is_active=1 AND role='doctor'`,
    { id: order.doctor_id },
    tx,
  );
  return author?.id || null;
}
async function policy(table, result, item, tx) {
  C.check(
    ["hms_lab_reference_intervals", "hms_lab_critical_policies"].includes(
      table,
    ),
    "INVALID_POLICY",
    "Invalid policy table.",
  );
  const c = result.context_snapshot;
  const policies = await C.q(
    `SELECT p.* FROM ${table} p WHERE p.test_version_id= :test AND method= :method AND unit= :unit
 AND (sex IS NULL OR sex= :sex) AND (min_age_years IS NULL OR min_age_years<= :age) AND (max_age_years IS NULL OR max_age_years>= :ageUpper)
 AND p.effective_at<= :at::timestamptz AND (p.expires_at IS NULL OR p.expires_at> :at::timestamptz)
 AND NOT EXISTS(SELECT 1 FROM ${table} n WHERE n.test_version_id=p.test_version_id AND n.method=p.method AND n.unit=p.unit
 AND n.sex IS NOT DISTINCT FROM p.sex AND n.min_age_years IS NOT DISTINCT FROM p.min_age_years AND n.max_age_years IS NOT DISTINCT FROM p.max_age_years
 AND n.version>p.version AND n.effective_at<= :at::timestamptz)
 ORDER BY version DESC`,
    {
      test: item.lab_test_version_id,
      method: result.method,
      unit: result.normalized_unit,
      sex: c.sex,
      age: c.age_years,
      ageUpper: c.age_upper_years ?? c.age_years,
      at: result.created_at || new Date().toISOString(),
    },
    tx,
  );
  // A new revision supersedes an older version of the exact same context.
  const contexts = new Map();
  for (const p of policies) {
    const key = JSON.stringify([p.sex, p.min_age_years, p.max_age_years]);
    if (!contexts.has(key)) contexts.set(key, p);
  }
  C.check(
    contexts.size <= 1,
    "AMBIGUOUS_POLICY",
    "Overlapping approved clinical policies require reconciliation.",
    409,
  );
  return [...contexts.values()][0] || null;
}
async function delivery(
  task,
  recipient,
  level,
  user,
  tx,
  channel = "OUTBOX",
  outcome = null,
  evidence = null,
) {
  let available = false;
  if (recipient) {
    const u = await C.one(
      "SELECT id FROM hms_users WHERE id= :id AND is_active=1 AND role='doctor'",
      { id: recipient },
      tx,
    );
    available =
      Boolean(u) &&
      (await require("../utils/careTeam").patientInCare(
        recipient,
        task.patient_id,
        tx,
      ));
  }
  const status = outcome || (available ? "QUEUED" : "UNAVAILABLE");
  C.check(
    status !== "CONTACTED" || available,
    "RECIPIENT_UNAVAILABLE",
    "A documented contact requires an active responsible clinician.",
  );
  await C.q(
    `INSERT INTO hms_lab_delivery_attempts(task_id,recipient_user_id,actor_user_id,level,outcome,channel,evidence)
 VALUES(:task,:recipient,:actor,:level,:outcome,:channel,:evidence)`,
    {
      task: task.id,
      recipient: recipient || null,
      actor: user.id,
      level,
      outcome: status,
      channel,
      evidence:
        evidence ||
        (available
          ? "Durable notification queued; human receipt unconfirmed"
          : "No available authorized clinician; follow-up remains open"),
    },
    tx,
  );
  if (status === "QUEUED")
    await require("../utils/outbox").publish(
      "lab_critical_result",
      `user:${recipient}`,
      {
        taskId: task.id,
        patientId: task.patient_id,
        resultVersionId: task.result_version_id,
      },
      { transaction: tx },
    );
  return status;
}
async function verified(result, item, order, user, tx) {
  const p = await policy("hms_lab_critical_policies", result, item, tx);
  if (!p || !/^[+-]?\d+(?:\.\d+)?$/.test(result.normalized_value)) return null;
  const match = await C.one(
    `SELECT (:lower::numeric IS NOT NULL AND :value::numeric < :lower::numeric)
 OR (:upper::numeric IS NOT NULL AND :value::numeric > :upper::numeric) AS critical`,
    {
      lower: p.lower_bound,
      upper: p.upper_bound,
      value: result.normalized_value,
      lowInclusive: p.lower_inclusive,
      highInclusive: p.upper_inclusive,
    },
    tx,
  );
  if (!match.critical) return null;
  let steps = [];
  if (p.escalation_policy_id) {
    const ep = await C.one(
      `SELECT id FROM hms_lab_escalation_policies WHERE id= :id AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now())`,
      { id: p.escalation_policy_id },
      tx,
    );
    C.check(
      ep,
      "ESCALATION_POLICY_EXPIRED",
      "The approved escalation policy is not effective.",
      409,
    );
    steps = await C.q(
      "SELECT level,after_seconds,recipient_user_id FROM hms_lab_escalation_steps WHERE policy_id= :id ORDER BY level",
      { id: ep.id },
      tx,
    );
  }
  const assigned = await responsible(order, tx);
  const task = await C.one(
    `INSERT INTO hms_lab_critical_tasks(result_version_id,policy_id,patient_id,assigned_user_id,state,schedule_snapshot,next_due_at)
 VALUES(:result,:policy,:patient,:assigned,'OPEN',:steps::jsonb,CASE WHEN :seconds::int IS NULL THEN NULL ELSE now()+make_interval(secs=> :seconds::int) END)
 ON CONFLICT(result_version_id) DO NOTHING RETURNING *`,
    {
      result: result.id,
      policy: p.id,
      patient: order.patient_id,
      assigned,
      steps: JSON.stringify(
        steps.map((s) => ({
          level: s.level,
          after_seconds: s.after_seconds,
          recipient_user_id: s.recipient_user_id,
        })),
      ),
      seconds: steps[0]?.after_seconds ?? null,
    },
    tx,
  );
  if (task) await delivery(task, assigned, -1, user, tx);
  return task;
}
async function advance(user, tx) {
  const due = await C.q(
    `SELECT * FROM hms_lab_critical_tasks WHERE state='OPEN' AND next_due_at<=now() ORDER BY next_due_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
    {},
    tx,
  );
  for (const task of due) {
    const step = task.schedule_snapshot.find(
      (s) => s.level > task.escalation_level,
    );
    if (!step) continue;
    const available = await delivery(
      task,
      step.recipient_user_id,
      step.level,
      user,
      tx,
    );
    const next = task.schedule_snapshot.find((s) => s.level > step.level);
    await C.q(
      `UPDATE hms_lab_critical_tasks SET assigned_user_id=CASE WHEN :available THEN :recipient ELSE assigned_user_id END,
 escalation_level= :level,revision=revision+1,next_due_at=CASE WHEN :seconds::int IS NULL THEN NULL ELSE created_at+make_interval(secs=> :seconds::int) END WHERE id= :id`,
      {
        id: task.id,
        available: available === "QUEUED",
        recipient: step.recipient_user_id,
        level: step.level,
        seconds: next?.after_seconds ?? null,
      },
      tx,
    );
  }
  return { advanced: due.length };
}
async function taskCommand(taskId, body, user, header, tx, type = "critical") {
  const table =
    type === "critical" ? "hms_lab_critical_tasks" : "hms_lab_review_tasks";
  const task = await C.one(
    `SELECT * FROM ${table} WHERE id= :id FOR UPDATE`,
    { id: C.id(taskId) },
    tx,
  );
  C.check(task, "NOT_FOUND", "Follow-up task not found.", 404);
  await C.scope(user, task.patient_id, tx);
  C.expected(header, task.revision);
  C.check(
    task.state !== "CLOSED",
    "TASK_CLOSED",
    "This task is already closed.",
    409,
  );
  C.check(
    user.role === "doctor",
    "CLINICAL_ACTION_REQUIRED",
    "A responsible clinician must acknowledge or document clinical action.",
    403,
  );
  if (type === "critical" && body.action === "acknowledge") {
    C.check(
      task.state === "OPEN",
      "ALREADY_ACKNOWLEDGED",
      "This task is already acknowledged.",
      409,
    );
    C.text(body.reason, "Acknowledgment evidence");
    return C.one(
      `UPDATE ${table} SET state='ACKNOWLEDGED',acknowledged_by_user_id= :user,acknowledged_at=now(),next_due_at=NULL,assigned_user_id= :user,revision=revision+1 WHERE id= :id RETURNING *`,
      { user: user.id, id: task.id },
      tx,
    );
  }
  C.check(
    body.action === "close",
    "INVALID_ACTION",
    "Acknowledge first, then document a clinical action.",
  );
  if (type === "critical")
    C.check(
      task.state === "ACKNOWLEDGED",
      "ACKNOWLEDGMENT_REQUIRED",
      "Acknowledgment and clinical action are separate steps.",
      409,
    );
  return C.one(
    `UPDATE ${table} SET state='CLOSED',clinical_action= :action,closed_by_user_id= :user,closed_at=now(),revision=revision+1 WHERE id= :id RETURNING *`,
    {
      action: C.text(
        body.clinical_action,
        "Clinical action or documented disposition",
      ),
      user: user.id,
      id: task.id,
    },
    tx,
  );
}
module.exports = {
  responsible,
  policy,
  delivery,
  verified,
  advance,
  taskCommand,
};
