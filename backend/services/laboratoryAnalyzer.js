const crypto = require("crypto"),
  C = require("./laboratoryCommon"),
  R = require("./laboratoryResults");
const { acceptOnce } = require("../utils/inbox");
async function ingest(body, user, tx) {
  await C.privilege(user, "ANALYZER", tx);
  C.check(
    body.contract_version === 1,
    "CONTRACT_UNSUPPORTED",
    "Use analyzer contract version 1.",
  );
  const source = C.text(body.source, "Adapter source"),
    message = C.text(body.message_id, "Message ID");
  const fingerprint = require("./medicationCommon").digest(body);
  const prior = await C.one(
    "SELECT payload FROM hms_lab_reconciliation WHERE source= :source AND message_id= :message",
    { source, message },
    tx,
  );
  if (prior)
    C.check(
      prior.payload?.fingerprint === fingerprint,
      "MESSAGE_ID_REUSED",
      "A message identifier cannot identify different content.",
      409,
    );
  if (!(await acceptOnce("LAB:" + source, message, { transaction: tx }))) {
    const receipt = await C.one(
      "SELECT payload FROM hms_lab_reconciliation WHERE source=:source AND message_id=:message",
      { source, message },
      tx,
    );
    C.check(
      receipt?.payload?.fingerprint === fingerprint,
      "MESSAGE_ID_REUSED",
      "A message identifier cannot identify different content.",
      409,
    );
    return { duplicate: true };
  }
  const specimen = await C.one(
    "SELECT * FROM hms_lab_specimens WHERE accession= :accession",
    { accession: C.text(body.accession, "Accession") },
    tx,
  );
  const resultBody = body.result || {};
  const linked =
    specimen &&
    (await C.one(
      "SELECT 1 FROM hms_lab_specimen_links WHERE specimen_id= :specimen AND item_id= :item",
      { specimen: specimen.id, item: C.integer(body.item_id) },
      tx,
    ));
  const valid =
    specimen &&
    specimen.patient_id === Number(body.patient_id) &&
    linked &&
    ["RECEIVED", "STORED"].includes(specimen.state);
  // Every analyzer message retains protected provenance, even when matched.
  const record = await C.one(
    `INSERT INTO hms_lab_reconciliation(source,message_id,payload,reason) VALUES(:source,:message,:payload::jsonb,:reason) RETURNING *`,
    {
      source,
      message,
      payload: JSON.stringify({ fingerprint, contract: body }),
      reason: valid
        ? "Provisional analyzer message received; processing validation pending"
        : "Unmatched patient/accession/item or unusable specimen",
    },
    tx,
  );
  if (!valid) return { reconciliation_id: record.id, provisional: true };
  const { item } = await C.lockItem(body.item_id, user, tx);
  // An unsolicited analyzer message cannot overwrite a manually entered or reviewed version.
  if (
    item.lab_state === "ENTERED" ||
    item.lab_state === "VERIFIED" ||
    item.lab_state === "RELEASED"
  )
    return { reconciliation_id: record.id, provisional: true };
  let run = await C.one(
    "SELECT * FROM hms_lab_analyzer_runs WHERE source= :source AND instrument= :instrument AND external_run_id= :run",
    {
      source,
      instrument: C.text(body.instrument, "Instrument"),
      run: C.text(body.run_id, "Analyzer run"),
    },
    tx,
  );
  if (!run)
    run = await C.one(
      "INSERT INTO hms_lab_analyzer_runs(source,instrument,external_run_id,method,created_by_user_id) VALUES(:source,:instrument,:run,:method,:user) ON CONFLICT(source,instrument,external_run_id) DO NOTHING RETURNING *",
      {
        source,
        instrument: body.instrument,
        run: body.run_id,
        method: C.text(resultBody.method, "Method"),
        user: user.id,
      },
      tx,
    );
  if (!run)
    run = await C.one(
      "SELECT * FROM hms_lab_analyzer_runs WHERE source=:source AND instrument=:instrument AND external_run_id=:run",
      { source, instrument: body.instrument, run: body.run_id },
      tx,
    );
  if (run.method !== resultBody.method)
    return {
      reconciliation_id: record.id,
      provisional: true,
      failure_code: "METHOD_MISMATCH",
    };
  let result;
  try {
    result = await C.sequelize.transaction((nested) =>
      R.write(
        item.id,
        { ...resultBody, specimen_id: specimen.id, analyzer_run_id: run.id },
        user,
        String(item.lab_revision),
        nested,
        "ANALYZER",
      ),
    );
  } catch (e) {
    if (e.status && e.status < 500)
      return {
        reconciliation_id: record.id,
        provisional: true,
        failure_code: e.code,
      };
    throw e;
  }
  await C.q(
    `UPDATE hms_lab_reconciliation SET state='RESOLVED',resolved_by_user_id= :user,resolution='Matched accession, patient and ordered test; imported provisional result' WHERE id= :id`,
    { user: user.id, id: record.id },
    tx,
  );
  return { ...result, provisional: true, reconciliation_id: record.id };
}
async function resolve(recordId, body, user, header, tx) {
  await C.privilege(user, "ANALYZER", tx);
  const record = await C.one(
    "SELECT * FROM hms_lab_reconciliation WHERE id=:id FOR UPDATE",
    { id: C.id(recordId) },
    tx,
  );
  C.check(
    record && record.item_id === null,
    "NOT_FOUND",
    "Analyzer reconciliation record not found.",
    404,
  );
  C.check(
    record.state === "PENDING",
    "RECONCILIATION_RESOLVED",
    "This message has already been reconciled.",
    409,
  );
  const reason = C.text(body.reason, "Identity reconciliation evidence");
  const { item, order } = await C.lockItem(body.item_id, user, tx);
  C.expected(header, item.lab_revision);
  const specimen = await C.one(
    "SELECT * FROM hms_lab_specimens WHERE id=:id",
    { id: C.id(body.specimen_id) },
    tx,
  );
  C.check(
    specimen &&
      specimen.accession === body.accession &&
      specimen.patient_id === order.patient_id &&
      Number(body.patient_id) === order.patient_id,
    "SPECIMEN_PATIENT_MISMATCH",
    "Explicitly confirm the corrected patient, accession and ordered item.",
  );
  const original = record.payload.contract;
  const result = await R.write(
    item.id,
    { ...original.result, specimen_id: specimen.id },
    user,
    String(item.lab_revision),
    tx,
    "ANALYZER",
  );
  await C.q(
    "UPDATE hms_lab_reconciliation SET state='RESOLVED',resolved_by_user_id=:user,resolution=:reason WHERE id=:id",
    { user: user.id, id: record.id, reason, id: record.id },
    tx,
  );
  return result;
}
module.exports = { ingest, resolve };
