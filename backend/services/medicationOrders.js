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
  userRole,
} = C;
const snapshot = (p) =>
  Object.fromEntries(
    [
      "id",
      "code",
      "name",
      "strength",
      "strength_unit",
      "concentration_denominator",
      "concentration_unit",
      "dose_form",
      "route",
      "base_unit",
      "pack_unit",
      "pack_conversion",
      "quantity_precision",
      "barcode",
      "controlled",
    ].map((k) => [k, p[k] ?? null]),
  );
async function createIngredient(b, u, tx) {
  return one(
    `INSERT INTO hms_med_ingredients(code_system,code,name,provenance,effective_at,created_by_user_id)
 VALUES(:system,:code,:name,:source,:at,:user) RETURNING *`,
    {
      system: text(b.code_system, "Code system"),
      code: text(b.code, "Code"),
      name: text(b.name, "Name"),
      source: text(b.provenance, "Provenance"),
      at: instant(b.effective_at, "Effective date"),
      user: u.id,
    },
    tx,
  );
}
async function createProduct(b, u, tx, existingId = null) {
  const a = {
    code: text(b.code, "Product code"),
    name: text(b.name, "Name"),
    strength: decimal(b.strength, "Strength"),
    unit: text(b.strength_unit, "Strength unit"),
    form: text(b.dose_form, "Dose form"),
    route: text(b.route, "Route"),
    base: text(b.base_unit, "Base unit"),
    pack: text(b.pack_unit, "Pack unit"),
    conversion: decimal(b.pack_conversion, "Pack conversion"),
    precision: Number(b.quantity_precision ?? 0),
    barcode: b.barcode ? text(b.barcode, "Barcode") : null,
    controlled: b.controlled === true,
    source: text(b.provenance, "Provenance"),
    at: instant(b.effective_at, "Effective date"),
    user: u.id,
    denominator: b.concentration_denominator
      ? decimal(b.concentration_denominator, "Concentration denominator")
      : null,
    denominatorUnit: b.concentration_denominator
      ? text(b.concentration_unit, "Concentration unit")
      : null,
  };
  check(
    Number.isInteger(a.precision) && a.precision >= 0 && a.precision <= 6,
    "INVALID_PRECISION",
    "Quantity precision must be 0–6.",
  );
  check(
    Array.isArray(b.ingredients) && b.ingredients.length > 0,
    "COMPOSITION_REQUIRED",
    "Approved ingredient composition is required.",
  );
  check(
    a.pack !== a.base || Number(a.conversion) === 1,
    "AMBIGUOUS_PACK_UNIT",
    "A pack with a different conversion must have a distinct unit code.",
  );
  check(
    a.unit === a.base || a.denominator,
    "CONCENTRATION_REQUIRED",
    "Explicit strength per base-unit amount is required for dose conversion.",
  );
  check(
    !a.denominator || a.denominatorUnit === a.base,
    "CONCENTRATION_UNIT_MISMATCH",
    "Concentration denominator must use the declared base unit.",
  );
  let legacy, p;
  if (existingId) {
    const prior = await one(
      "SELECT * FROM hms_med_products WHERE id=:id FOR UPDATE",
      { id: id(existingId) },
      tx,
    );
    check(
      prior?.status === "DRAFT",
      "IDENTITY_ALREADY_APPROVED",
      "Only an unapproved legacy identity can be reconciled.",
      409,
    );
    legacy = { id: prior.legacy_medicine_id };
    await q(
      `UPDATE hms_medicines SET generic_name=:name,formulation=:form,strength=:strength,strength_unit=:unit,
      unit_of_sale=:base,is_controlled=CASE WHEN :controlled THEN 1 ELSE 0 END WHERE id=:legacy`,
      { ...a, legacy: legacy.id },
      tx,
    );
    p = await one(
      `UPDATE hms_med_products SET code=:code,name=:name,strength=:strength,strength_unit=:unit,dose_form=:form,
      route=:route,base_unit=:base,pack_unit=:pack,pack_conversion=:conversion,quantity_precision=:precision,barcode=:barcode,
      controlled=:controlled,status='APPROVED',provenance=:source,effective_at=:at,created_by_user_id=:user,
      concentration_denominator=:denominator,concentration_unit=:denominatorUnit WHERE id=:id RETURNING *`,
      { ...a, id: prior.id },
      tx,
    );
    await q(
      "UPDATE hms_med_reconciliation SET status='RESOLVED',resolved_by_user_id=:user WHERE product_id=:id AND legacy_item_id IS NULL",
      { user: u.id, id: p.id },
      tx,
    );
  } else {
    await q("SELECT set_config('med.catalogue_create','true',true)", {}, tx);
    [legacy] = await q(
      `INSERT INTO hms_medicines(generic_name,formulation,strength,strength_unit,unit_of_sale,is_controlled,is_active)
      VALUES(:name,:form,:strength,:unit,:base,CASE WHEN :controlled THEN 1 ELSE 0 END,1) RETURNING id`,
      a,
      tx,
    );
    p = await one(
      `INSERT INTO hms_med_products(legacy_medicine_id,code,name,strength,strength_unit,dose_form,route,base_unit,pack_unit,pack_conversion,
      quantity_precision,barcode,controlled,status,provenance,effective_at,created_by_user_id,concentration_denominator,concentration_unit)
      VALUES(:legacy,:code,:name,:strength,:unit,:form,:route,:base,:pack,:conversion,:precision,:barcode,:controlled,'APPROVED',:source,:at,:user,:denominator,:denominatorUnit) RETURNING *`,
      { ...a, legacy: legacy.id },
      tx,
    );
  }
  for (const i of b.ingredients)
    await q(
      `INSERT INTO hms_med_product_ingredients(product_id,ingredient_id,amount,unit) VALUES(:product,:ingredient,:amount,:unit)`,
      {
        product: p.id,
        ingredient: id(i.ingredient_id, "Ingredient"),
        amount: decimal(i.amount, "Ingredient amount"),
        unit: text(i.unit, "Ingredient unit"),
      },
      tx,
    );
  await addFormulary(
    p.id,
    {
      provenance: a.source,
      effective_at: a.at,
      restrictions: b.restrictions || {},
    },
    u,
    tx,
  );
  return p;
}
async function addFormulary(product, b, u, tx) {
  await q(
    "SELECT id FROM hms_med_products WHERE id=:id FOR UPDATE",
    { id: id(product) },
    tx,
  );
  const restrictions = b.restrictions || {};
  check(
    restrictions &&
      typeof restrictions === "object" &&
      !Array.isArray(restrictions),
    "INVALID_RESTRICTIONS",
    "Restrictions must be an object.",
  );
  check(
    Object.keys(restrictions).every((k) =>
      [
        "routes",
        "min_age",
        "max_age",
        "required_context",
        "review_note",
        "otc_allowed",
      ].includes(k),
    ),
    "UNSUPPORTED_RESTRICTION",
    "Unsupported formulary restriction.",
  );
  if (restrictions.otc_allowed !== undefined)
    check(
      typeof restrictions.otc_allowed === "boolean",
      "INVALID_RESTRICTIONS",
      "Counter-sale permission must be explicitly true or false.",
    );
  if (restrictions.routes)
    check(
      Array.isArray(restrictions.routes) &&
        restrictions.routes.length > 0 &&
        restrictions.routes.every((v) => typeof v === "string" && v.trim()),
      "INVALID_RESTRICTIONS",
      "Routes must be a nonempty list.",
    );
  if (restrictions.required_context)
    check(
      Array.isArray(restrictions.required_context) &&
        restrictions.required_context.every((v) =>
          ["age", "weight_kg", "renal"].includes(v),
        ),
      "INVALID_RESTRICTIONS",
      "Unsupported required clinical context.",
    );
  for (const field of ["min_age", "max_age"])
    if (restrictions[field] !== undefined)
      check(
        Number.isInteger(restrictions[field]) && restrictions[field] >= 0,
        "INVALID_RESTRICTIONS",
        "Age restrictions must be nonnegative integers.",
      );
  check(
    restrictions.min_age === undefined ||
      restrictions.max_age === undefined ||
      restrictions.min_age <= restrictions.max_age,
    "INVALID_RESTRICTIONS",
    "Age range is reversed.",
  );
  return one(
    `INSERT INTO hms_med_formulary(product_id,revision,restrictions,provenance,effective_at,expires_at,approved_by_user_id)
 SELECT :id,coalesce(max(revision),0)+1,CAST(:restrictions AS jsonb),:source,:at,:until,:user FROM hms_med_formulary WHERE product_id=:id RETURNING *`,
    {
      id: product,
      restrictions: JSON.stringify(restrictions),
      source: text(b.provenance, "Provenance"),
      at: instant(b.effective_at, "Effective date"),
      until: b.expires_at ? instant(b.expires_at, "Expiry date") : null,
      user: u.id,
    },
    tx,
  );
}
async function createRulePack(b, u, tx) {
  check(
    b.content &&
      typeof b.content === "object" &&
      Array.isArray(b.content.rules),
    "INVALID_RULE_PACK",
    "Content requires a rules array.",
  );
  check(
    b.coverage &&
      typeof b.coverage === "object" &&
      Array.isArray(b.coverage.product_ids) &&
      Array.isArray(b.coverage.checks),
    "INVALID_COVERAGE",
    "Declare product_ids and checks.",
  );
  const codes = new Set();
  for (const r of b.content.rules) {
    text(r.code, "Rule code");
    check(!codes.has(r.code), "DUPLICATE_RULE", "Rule codes must be unique.");
    codes.add(r.code);
    check(
      [
        "DOSE",
        "INTERACTION",
        "ALLERGY",
        "DUPLICATE",
        "CONTEXT",
        "ROUTE",
        "AGE",
        "WEIGHT",
        "RENAL",
      ].includes(r.type),
      "UNSUPPORTED_RULE",
      "Unsupported rule type.",
    );
    check(
      ["WARNING", "BLOCK"].includes(r.severity) &&
        typeof r.override_allowed === "boolean",
      "INVALID_RULE",
      "Declare rule severity and override permission.",
    );
    check(
      Array.isArray(r.product_ids) && r.product_ids.length > 0,
      "INVALID_RULE",
      "Each rule must declare products.",
    );
    r.product_ids.forEach((x) => id(x, "Covered product"));
    if (r.type === "DOSE") {
      decimal(r.max, "Maximum dose");
      text(r.unit, "Dose unit");
      if (r.min !== undefined) decimal(r.min, "Minimum dose", 6, true);
    }
    if (["INTERACTION", "ALLERGY", "DUPLICATE"].includes(r.type)) {
      check(
        Array.isArray(r.with_ingredient_ids) &&
          r.with_ingredient_ids.length > 0,
        "INVALID_RULE",
        "Interaction requires coded ingredient IDs.",
      );
      r.with_ingredient_ids.forEach((x) => id(x));
    }
    if (r.type === "CONTEXT")
      check(
        Array.isArray(r.required) &&
          r.required.every((x) => ["age", "weight_kg", "renal"].includes(x)),
        "INVALID_RULE",
        "Context requirements must be age, weight_kg or renal.",
      );
    if (r.type === "ROUTE")
      check(
        Array.isArray(r.routes) && r.routes.length > 0,
        "INVALID_RULE",
        "Allowed routes are required.",
      );
    if (["AGE", "WEIGHT", "RENAL"].includes(r.type)) {
      check(
        Number.isFinite(Number(r.min)) &&
          Number.isFinite(Number(r.max)) &&
          Number(r.min) <= Number(r.max),
        "INVALID_RULE",
        "Reviewed minimum and maximum context values are required.",
      );
      if (r.type !== "AGE") text(r.unit, "Context unit");
    }
  }
  b.coverage.product_ids.forEach((x) => id(x));
  check(
    b.coverage.checks.every((x) =>
      [
        "ALLERGY",
        "DUPLICATE",
        "INTERACTION",
        "DOSE",
        "ROUTE",
        "AGE",
        "WEIGHT",
        "RENAL",
      ].includes(x),
    ),
    "INVALID_COVERAGE",
    "Unsupported coverage check.",
  );
  for (const product of b.coverage.product_ids) {
    check(
      await one(
        "SELECT 1 FROM hms_med_products WHERE id=:id AND status='APPROVED'",
        { id: product },
        tx,
      ),
      "UNKNOWN_COVERED_PRODUCT",
      "Rule coverage must reference an approved product.",
    );
    for (const name of b.coverage.checks)
      check(
        b.content.rules.some(
          (r) => r.type === name && r.product_ids.includes(product),
        ),
        "COVERAGE_WITHOUT_RULES",
        "Declared " +
          name +
          " coverage has no reviewed rules for this product.",
      );
  }
  return one(
    `INSERT INTO hms_med_rule_packs(code,revision,content,coverage,provenance,effective_at,expires_at,approved_by_user_id)
 VALUES(:code,:revision,CAST(:content AS jsonb),CAST(:coverage AS jsonb),:source,:at,:until,:user) RETURNING *`,
    {
      code: text(b.code, "Rule pack code"),
      revision: integer(b.revision, "Rule pack revision"),
      content: JSON.stringify(b.content),
      coverage: JSON.stringify(b.coverage),
      source: text(b.provenance, "Provenance"),
      at: instant(b.effective_at, "Effective date"),
      until: b.expires_at ? instant(b.expires_at, "Expiry date") : null,
      user: u.id,
    },
    tx,
  );
}
async function allergies(patient, tx) {
  const pid = integer(patient, "Patient");
  const review = await one(
    "SELECT * FROM hms_med_allergy_reviews WHERE patient_id=:id",
    { id: pid },
    tx,
  );
  const records = await q(
    "SELECT * FROM hms_med_allergies WHERE patient_id=:id AND verification_status NOT IN ('REFUTED','ENTERED_IN_ERROR') AND clinical_status='ACTIVE'",
    { id: pid },
    tx,
  );
  const legacy = await q(
    "SELECT id,allergen,reaction,severity FROM hms_allergies WHERE patient_id=:id",
    { id: pid },
    tx,
  );
  return {
    review_state: review?.state || "NOT_REVIEWED",
    revision: review?.version || 0,
    review,
    allergies: records,
    legacy_allergies: legacy,
  };
}
function allergyFingerprint(a) {
  return C.digest({
    state: a.review_state,
    revision: a.revision,
    coded: a.allergies
      .map((x) => ({
        id: x.id,
        ingredient: x.ingredient_id,
        text: x.clinical_text,
        reaction: x.reaction,
        clinical: x.clinical_status,
        verification: x.verification_status,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    legacy: a.legacy_allergies
      .map((x) => ({
        id: x.id,
        allergen: x.allergen,
        reaction: x.reaction,
        severity: x.severity,
      }))
      .sort((a, b) => a.id - b.id),
  });
}
async function reviewAllergies(patient, b, u, header, tx) {
  const pid = integer(patient, "Patient");
  await q(
    "SELECT id FROM hms_patients WHERE id=:id FOR UPDATE",
    { id: pid },
    tx,
  );
  const current = await allergies(pid, tx);
  expected(header, current.revision);
  check(
    ["UNKNOWN", "NOT_REVIEWED", "NONE_KNOWN", "ALLERGIES_RECORDED"].includes(
      b.state,
    ),
    "INVALID_STATE",
    "Choose an explicit allergy review state.",
  );
  check(
    b.state !== "NONE_KNOWN" ||
      (!current.allergies.length && !current.legacy_allergies.length),
    "ALLERGIES_PRESENT",
    "Recorded allergies require reconciliation before none-known can be recorded.",
    409,
  );
  return one(
    `INSERT INTO hms_med_allergy_reviews(patient_id,state,version,reviewer_user_id,reason)
 VALUES(:pid,:state,1,:user,:reason) ON CONFLICT(patient_id) DO UPDATE SET state=EXCLUDED.state,version=hms_med_allergy_reviews.version+1,
 reviewer_user_id=EXCLUDED.reviewer_user_id,reason=EXCLUDED.reason,reviewed_at=now() RETURNING *`,
    {
      pid,
      state: b.state,
      user: u.id,
      reason: text(b.reason, "Review reason"),
    },
    tx,
  );
}
async function addAllergy(patient, b, u, tx) {
  const pid = integer(patient, "Patient");
  await q(
    "SELECT id FROM hms_patients WHERE id=:id FOR UPDATE",
    { id: pid },
    tx,
  );
  const a = await one(
    `INSERT INTO hms_med_allergies(patient_id,ingredient_id,clinical_text,reaction,clinical_status,verification_status,author_user_id)
 VALUES(:pid,:ingredient,:clinical,:reaction,:status,:verification,:user) RETURNING *`,
    {
      pid,
      ingredient: b.ingredient_id ? id(b.ingredient_id) : null,
      clinical: text(b.clinical_text, "Allergy text"),
      reaction: text(b.reaction, "Reaction"),
      status: b.clinical_status || "ACTIVE",
      verification: b.verification_status || "UNCONFIRMED",
      user: u.id,
    },
    tx,
  );
  await q(
    `INSERT INTO hms_med_allergy_reviews(patient_id,state,reviewer_user_id,reason) VALUES(:pid,'ALLERGIES_RECORDED',:user,'Allergy added')
 ON CONFLICT(patient_id) DO UPDATE SET state='ALLERGIES_RECORDED',version=hms_med_allergy_reviews.version+1,reviewer_user_id=:user,reviewed_at=now(),reason='Allergy added'`,
    { pid, user: u.id },
    tx,
  );
  return a;
}
async function versionValues(b, u, tx) {
  check(
    Boolean(b.product_id) !== Boolean(b.ingredient_id),
    "CODED_ORDER_REQUIRED",
    "Choose exactly one coded product or ingredient.",
  );
  const p = b.product_id
    ? await one(
        "SELECT * FROM hms_med_products WHERE id=:id",
        { id: id(b.product_id) },
        tx,
      )
    : null;
  if (b.product_id)
    check(
      p &&
        p.status === "APPROVED" &&
        !(await one(
          "SELECT 1 FROM hms_med_product_retirements WHERE product_id=:id",
          { id: p.id },
          tx,
        )) &&
        C.epoch(p.effective_at) <= Date.now(),
      "PRODUCT_NOT_APPROVED",
      "Choose a currently approved product.",
    );
  if (b.ingredient_id)
    check(
      await one(
        "SELECT id FROM hms_med_ingredients WHERE id=:id",
        { id: id(b.ingredient_id) },
        tx,
      ),
      "NOT_FOUND",
      "Ingredient not found.",
      404,
    );
  const frequency = b.frequency;
  check(
    frequency &&
      frequency.type === "INTERVAL" &&
      Number.isInteger(frequency.interval_minutes) &&
      frequency.interval_minutes > 0,
    "INVALID_FREQUENCY",
    "Use a structured interval_minutes frequency.",
  );
  const starts = instant(b.starts_at, "Start"),
    ends = instant(b.ends_at, "End");
  check(
    C.epoch(ends) > C.epoch(starts),
    "INVALID_TIME",
    "End must follow start.",
  );
  const route = text(b.route, "Route"),
    doseUnit = text(b.dose_unit, "Dose unit");
  if (p) {
    check(
      route === p.route,
      "ROUTE_MISMATCH",
      "Order route must match the approved product.",
    );
    check(
      [p.base_unit, p.strength_unit].includes(doseUnit),
      "DOSE_UNIT_MISMATCH",
      "Use the approved product base or strength unit.",
    );
    check(
      b.supply_unit === p.base_unit,
      "SUPPLY_UNIT_MISMATCH",
      "Supply must be in the product base unit.",
    );
  }
  if (b.prn)
    check(
      Number(b.max_period_hours) < 1000000,
      "INVALID_PRN_PERIOD",
      "The PRN period exceeds the supported numeric representation.",
    );
  return {
    product: p?.id || null,
    ingredient: b.ingredient_id || null,
    snapshot: JSON.stringify(
      p ? snapshot(p) : { ingredient_id: b.ingredient_id },
    ),
    dose: decimal(b.dose, "Dose"),
    doseUnit,
    route,
    frequency: JSON.stringify(frequency),
    starts,
    ends,
    prn: b.prn === true,
    indication: b.prn ? text(b.indication, "PRN indication") : null,
    max: b.prn ? decimal(b.max_dose, "PRN maximum") : null,
    period: b.prn ? decimal(b.max_period_hours, "PRN maximum period", 4) : null,
    interval: b.prn
      ? integer(b.min_interval_minutes, "PRN minimum interval")
      : null,
    supply: decimal(
      b.supply_quantity,
      "Supply quantity",
      p?.quantity_precision ?? 6,
    ),
    supplyUnit: text(b.supply_unit, "Supply unit"),
    user: u.id,
  };
}
async function insertVersion(orderId, version, b, u, reason, tx) {
  const a = await versionValues(b, u, tx);
  return one(
    `INSERT INTO hms_med_order_versions(order_id,version,product_id,ingredient_id,product_snapshot,dose,dose_unit,route,frequency,starts_at,ends_at,prn,indication,max_dose,max_period_hours,min_interval_minutes,supply_quantity,supply_unit,author_user_id,amendment_reason)
 VALUES(:order,:version,:product,:ingredient,CAST(:snapshot AS jsonb),:dose,:doseUnit,:route,CAST(:frequency AS jsonb),:starts,:ends,:prn,:indication,:max,:period,:interval,:supply,:supplyUnit,:user,:reason) RETURNING *`,
    { ...a, order: orderId, version, reason },
    tx,
  );
}
async function createOrder(b, u, tx) {
  const pid = integer(b.patient_id, "Patient"),
    eid = integer(b.encounter_id, "Encounter");
  check(
    await one(
      "SELECT id FROM hms_encounters WHERE id=:eid AND patient_id=:pid",
      { eid, pid },
      tx,
    ),
    "PATIENT_ENCOUNTER_MISMATCH",
    "Encounter must belong to this patient.",
  );
  if (b.admission_id)
    check(
      await one(
        "SELECT id FROM hms_admissions WHERE id=:aid AND patient_id=:pid AND status='Active'",
        { aid: integer(b.admission_id, "Admission"), pid },
        tx,
      ),
      "PATIENT_ADMISSION_MISMATCH",
      "Admission must be active and belong to the patient.",
    );
  const o = await one(
    `INSERT INTO hms_med_orders(patient_id,encounter_id,admission_id,prescriber_user_id) VALUES(:pid,:eid,:aid,:user) RETURNING *`,
    { pid, eid, aid: b.admission_id || null, user: u.id },
    tx,
  );
  const v = await insertVersion(o.id, 1, b, u, null, tx);
  await event(
    "medication_order_changed",
    { order_id: o.id, patient_id: pid },
    tx,
  );
  return { order: o, version: v };
}
async function assess(o, v, b, u, tx) {
  const allergy = await allergies(o.patient_id, tx);
  const p = await one(
    "SELECT age,gender FROM hms_patients WHERE id=:id",
    { id: o.patient_id },
    tx,
  );
  const weight = await one(
    "SELECT weight_kg,recorded_at,recorded_by FROM hms_vitals WHERE patient_id=:pid AND reference_id=:eid AND encounter_type='OPD' AND weight_kg>0 ORDER BY recorded_at DESC LIMIT 1",
    { pid: o.patient_id, eid: o.encounter_id },
    tx,
  );
  const context = {
    age: p.age,
    gender: p.gender,
    weight_kg: weight?.weight_kg ?? null,
    weight_observation: weight || null,
    renal: null,
  };
  if (b.context?.renal) {
    const r = b.context.renal;
    context.renal = {
      value: decimal(r.value, "Renal observation", 6, true),
      unit: text(r.unit, "Renal unit"),
      provenance: text(r.provenance, "Renal provenance"),
      observed_at: instant(r.observed_at, "Renal observed time"),
      recorded_by_user_id: u.id,
    };
  }
  const ingredients = v.product_id
    ? (
        await q(
          "SELECT ingredient_id FROM hms_med_product_ingredients WHERE product_id=:id",
          { id: v.product_id },
          tx,
        )
      ).map((x) => x.ingredient_id)
    : [v.ingredient_id];
  const others = await q(
    `SELECT x.id,x.product_id,x.ingredient_id,x.dose,x.route FROM hms_med_orders z JOIN hms_med_order_versions x ON x.order_id=z.id AND x.version=z.current_version
 WHERE z.patient_id=:pid AND z.id<> :oid AND z.state IN ('SIGNED','HELD') AND x.ends_at> :start AND x.starts_at< :end`,
    { pid: o.patient_id, oid: o.id, start: v.starts_at, end: v.ends_at },
    tx,
  );
  const otherIngredients = new Set();
  for (const x of others) {
    if (x.ingredient_id) otherIngredients.add(x.ingredient_id);
    else
      for (const i of await q(
        "SELECT ingredient_id FROM hms_med_product_ingredients WHERE product_id=:id",
        { id: x.product_id },
        tx,
      ))
        otherIngredients.add(i.ingredient_id);
  }
  const pack = b.rule_pack_id
    ? await one(
        "SELECT * FROM hms_med_rule_packs WHERE id=:id AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now())",
        { id: id(b.rule_pack_id) },
        tx,
      )
    : await one(
        "SELECT * FROM hms_med_rule_packs WHERE effective_at<=now() AND (expires_at IS NULL OR expires_at>now()) ORDER BY effective_at DESC,revision DESC LIMIT 1",
        {},
        tx,
      );
  if (b.rule_pack_id)
    check(
      pack,
      "RULE_PACK_UNAVAILABLE",
      "The selected rule pack is not currently effective.",
    );
  const findings = [];
  const add = (code, message, severity = "WARNING", override_allowed = true) =>
    findings.push({ code, message, severity, override_allowed });
  if (!["NONE_KNOWN", "ALLERGIES_RECORDED"].includes(allergy.review_state))
    add("ALLERGY_NOT_REVIEWED", "Allergy status is unknown or not reviewed.");
  if (
    allergy.legacy_allergies.length ||
    allergy.allergies.some(
      (a) => !a.ingredient_id || a.verification_status !== "CONFIRMED",
    )
  )
    add(
      "ALLERGY_CODING_INCOMPLETE",
      "Uncoded or unconfirmed allergies require reconciliation.",
    );
  for (const a of allergy.allergies)
    if (a.ingredient_id && ingredients.includes(a.ingredient_id))
      add(
        `ALLERGY:${a.id}`,
        "Recorded ingredient allergy matches this order.",
        "BLOCK",
        true,
      );
  if (ingredients.some((i) => otherIngredients.has(i)))
    add(
      "DUPLICATE_THERAPY",
      "Another active or held order contains this ingredient.",
      "BLOCK",
      true,
    );
  const covered =
    pack && v.product_id && pack.coverage.product_ids.includes(v.product_id);
  const coverage = {
    ALLERGY:
      Boolean(covered && pack.coverage.checks.includes("ALLERGY")) &&
      !allergy.legacy_allergies.length &&
      ((allergy.review_state === "NONE_KNOWN" && !allergy.allergies.length) ||
        (allergy.review_state === "ALLERGIES_RECORDED" &&
          allergy.allergies.length > 0 &&
          allergy.allergies.every(
            (a) => a.ingredient_id && a.verification_status === "CONFIRMED",
          ))),
    DUPLICATE:
      Boolean(covered && pack.coverage.checks.includes("DUPLICATE")) &&
      ingredients.length > 0,
  };
  for (const name of ["INTERACTION", "DOSE", "ROUTE", "AGE", "WEIGHT", "RENAL"])
    coverage[name] = Boolean(covered && pack.coverage.checks.includes(name));
  if (!covered)
    add(
      "MEDICINE_UNCOVERED",
      "Medicine is not covered by an effective approved rule pack.",
    );
  for (const [name, value] of Object.entries(coverage))
    if (!value)
      add(
        `CHECK_UNAVAILABLE:${name}`,
        `${name.toLowerCase()} check unavailable; pharmacist review required.`,
      );
  const formulary = v.product_id
    ? await one(
        "SELECT * FROM hms_med_formulary WHERE product_id=:id AND effective_at<=now() AND (expires_at IS NULL OR expires_at>now()) ORDER BY revision DESC LIMIT 1",
        { id: v.product_id },
        tx,
      )
    : null;
  if (!formulary)
    add("FORMULARY_UNAVAILABLE", "No currently approved formulary entry.");
  const restrictions = formulary?.restrictions || {};
  for (const required of restrictions.required_context || [])
    if (context[required] == null)
      add(
        `MISSING_CONTEXT:${required}`,
        `Required ${required} context is missing.`,
      );
  if (restrictions.routes && !restrictions.routes.includes(v.route))
    add(
      "FORMULARY_ROUTE",
      "Route is outside formulary restrictions.",
      "BLOCK",
      false,
    );
  if (
    (restrictions.min_age != null && Number(p.age) < restrictions.min_age) ||
    (restrictions.max_age != null && Number(p.age) > restrictions.max_age)
  )
    add(
      "FORMULARY_AGE",
      "Age is outside formulary restrictions.",
      "BLOCK",
      false,
    );
  if (!weight)
    add(
      "WEIGHT_MISSING",
      "No weight observation for this encounter; weight-dependent checks unavailable.",
    );
  for (const r of covered
    ? pack.content.rules.filter((r) => r.product_ids.includes(v.product_id))
    : []) {
    let violated = false,
      missing = false;
    if (r.type === "DOSE") {
      missing = v.dose_unit !== r.unit;
      violated =
        !missing &&
        (
          await one(
            "SELECT CAST(:dose AS numeric)>CAST(:max AS numeric) OR (CAST(:min AS numeric) IS NOT NULL AND CAST(:dose AS numeric)<CAST(:min AS numeric)) AS violated",
            { dose: v.dose, max: r.max, min: r.min ?? null },
            tx,
          )
        ).violated;
    }
    if (r.type === "ROUTE") violated = !r.routes.includes(v.route);
    if (r.type === "CONTEXT")
      missing = r.required.some((k) => context[k] == null);
    if (r.type === "INTERACTION" || r.type === "DUPLICATE")
      violated = r.with_ingredient_ids.some((i) => otherIngredients.has(i));
    if (r.type === "ALLERGY")
      violated = r.with_ingredient_ids.some((i) =>
        allergy.allergies.some((a) => a.ingredient_id === i),
      );
    if (["AGE", "WEIGHT", "RENAL"].includes(r.type)) {
      const value =
        r.type === "AGE"
          ? context.age
          : r.type === "WEIGHT"
            ? context.weight_kg
            : context.renal?.value;
      const unit = r.type === "WEIGHT" ? "kg" : context.renal?.unit;
      missing = value == null || (r.type !== "AGE" && unit !== r.unit);
      violated =
        !missing &&
        (Number(value) < Number(r.min) || Number(value) > Number(r.max));
    }
    if (missing && r.type !== "CONTEXT") coverage[r.type] = false;
    if (missing)
      add(
        `RULE_UNAVAILABLE:${r.code}`,
        "Decision-critical context or unit is missing for " + r.code,
      );
    else if (violated)
      add(
        r.code,
        r.message || `Approved rule ${r.code} requires review.`,
        r.severity,
        r.override_allowed,
      );
  }
  const requests = Array.isArray(b.override_requests)
    ? b.override_requests
    : [];
  for (const f of b.preview === true
    ? []
    : findings
        .filter((x) => x.severity === "BLOCK")
        .sort(
          (a, b) => Number(a.override_allowed) - Number(b.override_allowed),
        )) {
    check(f.override_allowed, "CDS_BLOCKED", f.message, 409);
    const request = requests.find((r) => r.finding_code === f.code);
    check(
      request?.reason?.trim(),
      "OVERRIDE_REASON_REQUIRED",
      "A reason and subsequent pharmacist approval are required for " + f.code,
      409,
    );
  }
  const assessment = await one(
    `INSERT INTO hms_med_assessments(version_id,rule_pack_id,input_snapshot,findings,coverage,requires_review,author_user_id)
 VALUES(:vid,:pack,CAST(:input AS jsonb),CAST(:findings AS jsonb),CAST(:coverage AS jsonb),:review,:user) RETURNING *`,
    {
      vid: v.id,
      pack: pack?.id || null,
      input: JSON.stringify({
        patient_id: o.patient_id,
        order_version_id: v.id,
        context,
        allergy,
        allergy_fingerprint: allergyFingerprint(allergy),
        ingredients,
        other_order_versions: others,
        formulary_revision: formulary?.revision || null,
        override_requests: requests,
      }),
      findings: JSON.stringify(findings),
      coverage: JSON.stringify(coverage),
      review: findings.length > 0,
      user: u.id,
    },
    tx,
  );
  return assessment;
}
async function transition(oid, action, b, u, header, tx) {
  const { o, v } = await order(oid, tx);
  expected(header, o.revision);
  check(
    u.id === o.prescriber_user_id,
    "PRESCRIBER_REQUIRED",
    "Only the responsible prescriber can change this order.",
    403,
  );
  const reason = text(b.reason, "Reason");
  let state = o.state,
    version = o.current_version,
    next = v;
  if (action === "amend") {
    check(
      ["SIGNED", "HELD"].includes(o.state),
      "INVALID_TRANSITION",
      "Only signed or held orders can be amended.",
      409,
    );
    version++;
    next = await insertVersion(o.id, version, b, u, reason, tx);
    state = "DRAFT";
    await q(
      "UPDATE hms_med_schedules SET state='CANCELLED' WHERE version_id=:id AND state='PENDING'",
      { id: v.id },
      tx,
    );
  } else if (action === "sign") {
    check(
      o.state === "DRAFT",
      "INVALID_TRANSITION",
      "Only a draft version can be signed.",
      409,
    );
    await q(
      "SELECT pg_advisory_xact_lock(727283,:patient)",
      { patient: o.patient_id },
      tx,
    );
    const assessment = await assess(o, v, b, u, tx);
    next = await one(
      "UPDATE hms_med_order_versions SET signed_at=now() WHERE id=:id RETURNING *",
      { id: v.id },
      tx,
    );
    await q(
      "INSERT INTO hms_med_verifications(version_id,assessment_id) VALUES(:vid,:aid)",
      { vid: v.id, aid: assessment.id },
      tx,
    );
    state = "SIGNED";
  } else if (action === "hold") {
    check(
      o.state === "SIGNED",
      "INVALID_TRANSITION",
      "Only active signed orders can be held.",
      409,
    );
    state = "HELD";
  } else if (action === "resume") {
    check(
      o.state === "HELD",
      "INVALID_TRANSITION",
      "Only held orders can resume.",
      409,
    );
    state = "SIGNED";
  } else if (action === "discontinue") {
    check(
      ["SIGNED", "HELD"].includes(o.state),
      "INVALID_TRANSITION",
      "Only signed or held orders can be discontinued.",
      409,
    );
    state = "DISCONTINUED";
    await q(
      "UPDATE hms_med_schedules SET state='CANCELLED' WHERE version_id=:id AND state='PENDING'",
      { id: v.id },
      tx,
    );
  } else C.fail(400, "INVALID_TRANSITION", "Unknown order action.");
  const updated = await one(
    "UPDATE hms_med_orders SET state=:state,current_version=:version,revision=revision+1 WHERE id=:id RETURNING *",
    { state, version, id: o.id },
    tx,
  );
  await q(
    "INSERT INTO hms_med_transitions(order_id,version_id,action,actor_user_id,reason) VALUES(:oid,:vid,:action,:user,:reason)",
    {
      oid: o.id,
      vid: next.id,
      action: action.toUpperCase(),
      user: u.id,
      reason,
    },
    tx,
  );
  await event(
    "medication_order_changed",
    {
      order_id: o.id,
      patient_id: o.patient_id,
      state,
      revision: updated.revision,
    },
    tx,
  );
  return { order: updated, version: next };
}
async function verify(oid, b, u, header, tx) {
  const { o, v } = await order(oid, tx);
  expected(header, o.revision);
  check(
    o.state === "SIGNED",
    "ORDER_NOT_ACTIVE",
    "Verification requires the current signed order.",
    409,
  );
  check(
    u.id !== o.prescriber_user_id,
    "INDEPENDENT_VERIFICATION_REQUIRED",
    "Pharmacist verification must be independent of the prescriber.",
    403,
  );
  const verification = await one(
    "SELECT z.*,a.findings,a.input_snapshot FROM hms_med_verifications z JOIN hms_med_assessments a ON a.id=z.assessment_id WHERE z.version_id=:id FOR UPDATE OF z",
    { id: v.id },
    tx,
  );
  check(
    verification?.state !== "VERIFIED",
    "ALREADY_VERIFIED",
    "This order version is already verified.",
    409,
  );
  check(
    verification.input_snapshot.allergy_fingerprint ===
      allergyFingerprint(await allergies(o.patient_id, tx)),
    "ALLERGY_CONTEXT_CHANGED",
    "Allergy context changed since signing; the prescriber must review and amend this version.",
    409,
  );
  const reason = text(b.reason, "Verification reason");
  check(
    ["VERIFIED", "CLARIFICATION"].includes(b.state),
    "INVALID_STATE",
    "Verify or request clarification.",
  );
  if (b.state === "VERIFIED") {
    check(
      b.coverage_acknowledged === true,
      "COVERAGE_ACKNOWLEDGMENT_REQUIRED",
      "Review the declared coverage and missing context.",
    );
    for (const f of verification.findings.filter(
      (x) => x.severity === "BLOCK",
    )) {
      const r = (b.overrides || []).find((x) => x.finding_code === f.code);
      check(
        f.override_allowed && r?.reason?.trim(),
        "OVERRIDE_APPROVAL_REQUIRED",
        "Approve and explain the requested override for " + f.code,
        409,
      );
      check(
        verification.input_snapshot.override_requests.some(
          (x) => x.finding_code === f.code,
        ),
        "OVERRIDE_NOT_REQUESTED",
        "The prescriber must request this override.",
        409,
      );
      await q(
        "INSERT INTO hms_med_overrides(assessment_id,finding_code,reason,requester_user_id,reviewer_user_id) VALUES(:aid,:code,:reason,:prescriber,:reviewer)",
        {
          aid: verification.assessment_id,
          code: f.code,
          reason: text(r.reason, "Override reason"),
          prescriber: o.prescriber_user_id,
          reviewer: u.id,
        },
        tx,
      );
    }
  }
  const result = await one(
    "UPDATE hms_med_verifications SET state=:state,reviewer_user_id=:user,reason=:reason,reviewed_at=now() WHERE id=:id RETURNING *",
    { state: b.state, user: u.id, reason, id: verification.id },
    tx,
  );
  if (b.state === "CLARIFICATION")
    await q(
      "INSERT INTO hms_med_tasks(patient_id,order_id,kind,assigned_user_id,created_by_user_id,detail) VALUES(:pid,:oid,'CLARIFICATION',:doctor,:user,:detail)",
      {
        pid: o.patient_id,
        oid: o.id,
        doctor: o.prescriber_user_id,
        user: u.id,
        detail: reason,
      },
      tx,
    );
  await q(
    "UPDATE hms_med_orders SET revision=revision+1 WHERE id=:id",
    { id: o.id },
    tx,
  );
  await event(
    "medication_verification_changed",
    { order_id: o.id, state: b.state },
    tx,
  );
  return result;
}
module.exports = {
  allergyFingerprint,
  createIngredient,
  createProduct,
  addFormulary,
  createRulePack,
  allergies,
  reviewAllergies,
  addAllergy,
  createOrder,
  transition,
  verify,
  assess,
  snapshot,
};
