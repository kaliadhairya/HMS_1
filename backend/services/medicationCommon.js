const crypto = require("crypto");
const { sequelize } = require("../models/db");
const { QueryTypes } = require("sequelize");
const { publish } = require("../utils/outbox");
const fail = (status, code, message) => {
  throw Object.assign(new Error(message), { status, code });
};
const check = (ok, code, message, status = 422) => {
  if (!ok) fail(status, code, message);
};
const text = (v, name) => {
  check(
    typeof v === "string" && v.trim().length > 0 && v.length <= 4000,
    "INVALID_INPUT",
    `${name} is required.`,
  );
  return v.trim();
};
const id = (v, name = "ID") => {
  check(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(v),
    ),
    "INVALID_ID",
    `${name} must be a UUID.`,
  );
  return v;
};
const integer = (v, name) => {
  check(
    Number.isSafeInteger(Number(v)) && Number(v) > 0,
    "INVALID_INPUT",
    `${name} must be a positive integer.`,
  );
  return Number(v);
};
const decimal = (v, name, precision = 6, allowZero = false) => {
  const s = String(v ?? "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
  check(
    new RegExp(`^\\d+(?:\\.\\d{1,${precision || 1}})?$`).test(s) &&
      Number.isFinite(Number(s)) &&
      Number(s) < 1e12 &&
      (allowZero ? Number(s) >= 0 : Number(s) > 0),
    "INVALID_QUANTITY",
    `${name} must be ${allowZero ? "nonnegative" : "positive"} with at most ${precision} decimal places.`,
  );
  check(
    precision !== 0 || !s.includes(".") || /^0+$/.test(s.split(".")[1]),
    "INVALID_QUANTITY",
    `${name} requires whole units.`,
  );
  return s;
};
const epoch = (value) =>
  value instanceof Date ? value.getTime() : Date.parse(value);
const instant = (v, name) => {
  check(
    typeof v === "string" &&
      /(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
      Number.isFinite(Date.parse(v)),
    "INVALID_TIME",
    `${name} requires an ISO timestamp with timezone.`,
  );
  return new Date(v).toISOString();
};
const q = (sql, values = {}, tx) =>
  sequelize.query(sql, {
    replacements: values,
    transaction: tx,
    type: QueryTypes.SELECT,
    retry: { max: 0 },
  });
const one = async (sql, values, tx) => (await q(sql, values, tx))[0];
function expected(header, actual) {
  check(
    header,
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
    "This record changed. Refresh and review before saving.",
    412,
  );
}
async function userRole(userId, roles, tx) {
  const u = await one(
    "SELECT id,role,is_active FROM hms_users WHERE id=:id",
    { id: integer(userId, "User") },
    tx,
  );
  check(
    u && u.is_active === 1 && roles.includes(u.role),
    "INVALID_REVIEWER",
    "An active authorized clinical reviewer is required.",
  );
  return u;
}
async function event(type, payload, tx) {
  for (const role of ["doctor", "pharmacist", "nurse"])
    await publish(type, role, payload, { transaction: tx });
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
const digest = (v) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(canonical(v)))
    .digest("hex");
async function order(idValue, tx, lock = true) {
  if (lock) {
    const hint = await one(
      "SELECT admission_id,patient_id FROM hms_med_orders WHERE id=:id",
      { id: id(idValue, "Order") },
      tx,
    );
    if (hint?.admission_id)
      await q(
        "SELECT id FROM hms_admissions WHERE id=:id FOR SHARE",
        { id: hint.admission_id },
        tx,
      );
  }
  if (lock) {
    const hint = await one(
      "SELECT patient_id FROM hms_med_orders WHERE id=:id",
      { id: id(idValue) },
      tx,
    );
    if (hint)
      await q(
        "SELECT id FROM hms_patients WHERE id=:id FOR SHARE",
        { id: hint.patient_id },
        tx,
      );
  }
  const o = await one(
    `SELECT * FROM hms_med_orders WHERE id=:id ${lock ? "FOR UPDATE" : ""}`,
    { id: id(idValue, "Order") },
    tx,
  );
  check(o, "NOT_FOUND", "Medication order not found.", 404);
  const v = await one(
    "SELECT * FROM hms_med_order_versions WHERE order_id=:id AND version=:version",
    { id: o.id, version: o.current_version },
    tx,
  );
  return { o, v };
}
async function active(o, v, tx) {
  check(
    o.state === "SIGNED" && v.signed_at,
    "ORDER_NOT_ACTIVE",
    "The current order must be signed and active.",
    409,
  );
  check(
    await one(
      "SELECT 1 FROM hms_med_verifications WHERE version_id=:id AND state='VERIFIED'",
      { id: v.id },
      tx,
    ),
    "PHARMACY_REVIEW_REQUIRED",
    "Pharmacist verification of this exact version is required.",
    409,
  );
  const O = require("./medicationOrders");
  const a = await one(
    "SELECT a.input_snapshot FROM hms_med_verifications z JOIN hms_med_assessments a ON a.id=z.assessment_id WHERE z.version_id=:id",
    { id: v.id },
    tx,
  );
  check(
    a?.input_snapshot.allergy_fingerprint ===
      O.allergyFingerprint(await O.allergies(o.patient_id, tx)),
    "ALLERGY_CONTEXT_CHANGED",
    "Allergy context changed; the prescriber must review and amend before supply or administration.",
    409,
  );
  if (o.admission_id) {
    const a = await one(
      "SELECT status,patient_id FROM hms_admissions WHERE id=:id",
      { id: o.admission_id },
      tx,
    );
    check(
      a?.status === "Active" && a.patient_id === o.patient_id,
      "ADMISSION_NOT_ACTIVE",
      "The admission is no longer active.",
      409,
    );
  }
}
module.exports = {
  sequelize,
  fail,
  check,
  text,
  id,
  integer,
  decimal,
  instant,
  epoch,
  q,
  one,
  expected,
  userRole,
  event,
  digest,
  order,
  active,
};
