const { QueryTypes } = require("sequelize");
const { sequelize } = require("../models/db");
const { patientInCare, NOT_IN_CARE } = require("../utils/careTeam");
const { publish } = require("../utils/outbox");
const fail = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};
const check = (ok, code, message, status = 422) => {
  if (!ok) fail(status, code, message);
};
const text = (v, name, max = 2000) => {
  check(
    typeof v === "string" && v.trim().length > 0 && v.length <= max,
    "INVALID_INPUT",
    `${name} is required (maximum ${max} characters).`,
  );
  return v.trim();
};
const integer = (v, name = "ID") => {
  check(
    /^[1-9]\d*$/.test(String(v)) && Number.isSafeInteger(Number(v)),
    "INVALID_ID",
    `${name} must be a positive integer.`,
  );
  return Number(v);
};
const id = (v) => {
  check(
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
      String(v),
    ),
    "INVALID_ID",
    "A UUID is required.",
  );
  return String(v);
};
const q = (sql, values = {}, tx) =>
  sequelize.query(sql, {
    replacements: values,
    transaction: tx,
    type: QueryTypes.SELECT,
    retry: { max: 0 },
  });
const one = async (sql, values = {}, tx) => (await q(sql, values, tx))[0];
function expected(header, actual) {
  check(
    header !== undefined,
    "EXPECTED_VERSION_REQUIRED",
    "Send If-Match with the current revision.",
    428,
  );
  check(
    /^"?\d+"?$/.test(String(header)),
    "INVALID_VERSION",
    "If-Match must be a revision number.",
    400,
  );
  check(
    Number(String(header).replace(/"/g, "")) === Number(actual),
    "VERSION_CONFLICT",
    "This record changed. Review the latest version before saving.",
    412,
  );
}
async function scope(user, patientId, tx) {
  if (user.role === "doctor")
    check(
      await patientInCare(user.id, patientId, tx),
      "PATIENT_NOT_IN_CARE",
      NOT_IN_CARE,
      403,
    );
}
async function privilege(user, name, tx) {
  const F=require('./facilities.cts');
  if(name==='ANALYZER') {
    check(user.facilityId && (await F.membership(user.id,user.facilityId,tx)).length,'FACILITY_MEMBERSHIP_REQUIRED','Approved analyzer processing requires current service-account facility membership.',403);
  } else await F.requirePrivilege(user, name === 'RELEASE' ? 'LAB_RELEASE' : 'LAB_PROCESS', tx);
  const u = await one(
    "SELECT id,role,is_active FROM hms_users WHERE id= :id FOR SHARE",
    { id: user.id },
    tx,
  );
  check(
    u?.is_active === 1,
    "CLINICAL_PRIVILEGE_REQUIRED",
    "An active account is required.",
    403,
  );
  if(name==='ANALYZER')check(u.role==='lab_technician','DEVICE_ACCOUNT_ROLE_REQUIRED','Analyzer processing requires an approved laboratory service account.',403);
  if (["RELEASE", "CONTENT"].includes(name) && u.role === "doctor") {
    const c = await one(
      "SELECT practitioner_credentials_expired(:id) AS expired",
      { id: user.id },
      tx,
    );
    check(
      !c.expired,
      "REGISTRATION_EXPIRED",
      "Recorded practitioner credentials have expired.",
      403,
    );
  }
  check(
    await one(
      `SELECT id FROM hms_lab_privileges WHERE user_id= :id AND facility_id=:facility AND privilege= :name AND revoked_at IS NULL
 AND valid_from<=now() AND valid_until>now() FOR SHARE`,
      { id: user.id, name,facility:user.facilityId },
      tx,
    ),
    "CLINICAL_PRIVILEGE_REQUIRED",
    `A current laboratory ${name} grant is required.`,
    403,
  );
}
async function lockOrder(orderId, user, tx) {
  const o = await one(
    "SELECT * FROM hms_investigation_orders WHERE id= :id FOR UPDATE",
    { id: integer(orderId) },
    tx,
  );
  check(o, "NOT_FOUND", "Investigation order not found.", 404);
  await scope(user, o.patient_id, tx);
  return o;
}
async function lockItem(itemId, user, tx) {
  const hint = await one(
    "SELECT order_id FROM hms_investigation_order_items WHERE id= :id",
    { id: integer(itemId) },
    tx,
  );
  check(hint, "NOT_FOUND", "Investigation item not found.", 404);
  const order = await lockOrder(hint.order_id, user, tx);
  const item = await one(
    "SELECT * FROM hms_investigation_order_items WHERE id= :id FOR UPDATE",
    { id: integer(itemId) },
    tx,
  );
  return { item, order };
}
async function event(type, order, extra, tx) {
  await publish(
    type,
    `user:${order.doctor_id}`,
    { orderId: order.id, patientId: order.patient_id, ...extra },
    { transaction: tx },
  );
  await publish(
    "lab_work_changed",
    "lab_technician",
    { orderId: order.id },
    { transaction: tx },
  );
}
module.exports = {
  sequelize,
  fail,
  check,
  text,
  integer,
  id,
  q,
  one,
  expected,
  scope,
  privilege,
  lockOrder,
  lockItem,
  event,
};
