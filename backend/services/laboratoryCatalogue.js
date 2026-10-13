const C = require("./laboratoryCommon");
const active = `effective_at<=now() AND (expires_at IS NULL OR expires_at>now())`;
async function catalogue(tx) {
  return C.q(
    `SELECT t.id,t.code_system,t.code,t.kind,v.* FROM hms_lab_tests t JOIN hms_lab_test_versions v ON v.test_id=t.id
 WHERE ${active} AND NOT EXISTS(SELECT 1 FROM hms_lab_test_versions newer WHERE newer.test_id=t.id AND newer.version>v.version AND newer.effective_at<=now())
 ORDER BY t.code`,
    {},
    tx,
  );
}
async function create(body, user, tx) {
  await C.privilege(user, "CONTENT", tx);
  const kind = body.kind || "TEST";
  C.check(
    ["TEST", "PANEL"].includes(kind),
    "INVALID_KIND",
    "Use TEST or PANEL.",
  );
  let t = await C.one(
    "SELECT * FROM hms_lab_tests WHERE code_system= :system AND code= :code FOR UPDATE",
    {
      system: C.text(body.code_system, "Code system"),
      code: C.text(body.code, "Code"),
    },
    tx,
  );
  if (!t)
    t = await C.one(
      `INSERT INTO hms_lab_tests(code_system,code,kind,created_by_user_id) VALUES(:system,:code,:kind,:user) RETURNING *`,
      {
        system: body.code_system.trim(),
        code: body.code.trim(),
        kind,
        user: user.id,
      },
      tx,
    );
  C.check(
    t.kind === kind,
    "CODE_KIND_CHANGED",
    "A stable code cannot change its kind.",
  );
  const [{ n }] = await C.q(
    "SELECT coalesce(max(version),0)+1 AS n FROM hms_lab_test_versions WHERE test_id= :id",
    { id: t.id },
    tx,
  );
  const when = new Date(body.effective_at);
  C.check(
    Number.isFinite(when.getTime()),
    "INVALID_TIME",
    "An effective timestamp is required.",
  );
  const v = await C.one(
    `INSERT INTO hms_lab_test_versions(test_id,version,name,section,unit,method,tariff_id,provenance,effective_at,expires_at,approved_by_user_id)
 VALUES(:id,:n,:name,:section,:unit,:method,:tariff,:source,:effective,:expires,:user) RETURNING *`,
    {
      id: t.id,
      n,
      name: C.text(body.name, "Name"),
      section: C.text(body.section, "Section"),
      unit: kind === "TEST" ? C.text(body.unit, "Unit") : null,
      method: kind === "TEST" ? C.text(body.method, "Method") : null,
      tariff: body.tariff_id || null,
      source: C.text(body.provenance, "Provenance"),
      effective: when.toISOString(),
      expires: body.expires_at || null,
      user: user.id,
    },
    tx,
  );
  if (kind === "TEST") {
    C.check(
      Array.isArray(body.requirements) && body.requirements.length > 0,
      "SPECIMEN_REQUIREMENTS_REQUIRED",
      "Declare at least one specimen and container requirement.",
    );
    for (const r of body.requirements)
      await C.q(
        "INSERT INTO hms_lab_requirements(test_version_id,specimen_type,container) VALUES(:id,:type,:container)",
        {
          id: v.id,
          type: C.text(r.specimen_type, "Specimen type"),
          container: C.text(r.container, "Container"),
        },
        tx,
      );
  } else {
    C.check(
      Array.isArray(body.members) && body.members.length > 0,
      "PANEL_MEMBERS_REQUIRED",
      "A panel must contain tests.",
    );
    for (const [position, id] of body.members.entries()) {
      const member = await C.one(
        `SELECT v.id FROM hms_lab_test_versions v JOIN hms_lab_tests t ON t.id=v.test_id WHERE v.id= :id AND t.kind='TEST' AND ${active}`,
        { id: C.id(id) },
        tx,
      );
      C.check(
        member,
        "INVALID_PANEL_MEMBER",
        "Panel members must be active atomic tests.",
      );
      await C.q(
        "INSERT INTO hms_lab_panel_members(panel_version_id,test_version_id,position) VALUES(:panel,:test,:position)",
        { panel: v.id, test: id, position },
        tx,
      );
    }
  }
  return v;
}
async function linkLegacy(itemId, body, user, header, tx) {
  await C.privilege(user, "CONTENT", tx);
  const { item } = await C.lockItem(itemId, user, tx);
  C.expected(header, item.lab_revision);
  C.check(
    item.lab_state === "UNMAPPED",
    "ALREADY_LINKED",
    "Only an unresolved legacy item can be mapped.",
  );
  const v = await C.one(
    `SELECT v.* FROM hms_lab_test_versions v JOIN hms_lab_tests t ON t.id=v.test_id WHERE v.id= :id AND t.kind='TEST' AND ${active}`,
    { id: C.id(body.test_version_id) },
    tx,
  );
  C.check(v, "CATALOGUE_NOT_ACTIVE", "Choose an approved active test.");
  C.text(body.reason, "Mapping evidence");
  await C.q(
    `UPDATE hms_investigation_order_items SET lab_test_version_id= :test,lab_state='ORDERED',lab_revision=lab_revision+1 WHERE id= :id`,
    { test: v.id, id: item.id },
    tx,
  );
  await C.q(
    `UPDATE hms_lab_reconciliation SET state='RESOLVED',resolved_by_user_id= :user,resolution= :reason WHERE item_id= :item`,
    { user: user.id, reason: body.reason, item: item.id },
    tx,
  );
  return { item_id: item.id, revision: item.lab_revision + 1 };
}
module.exports = { active, catalogue, create, linkLegacy };
