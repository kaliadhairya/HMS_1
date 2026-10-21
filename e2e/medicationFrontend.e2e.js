const {
  chromium,
  BASE,
  api,
  apiLogin,
  sql,
  browserAs,
  runner,
  assert,
  requireThrowawayDb,
} = require("./helpers");
const crypto = require("crypto");
requireThrowawayDb();
const { step, done } = runner("Phase 3 medication frontend");
const stamp = crypto.randomUUID().slice(0, 8);
// datetime-local inputs take local time; the browser runs in the machine's time zone.
const dt = (v) => {
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
let doctor,
  pharmacist,
  nurse,
  product,
  pid,
  eid,
  orderId,
  versionId,
  line,
  scheduleId,
  doctorUI,
  pharmacyUI,
  nursingUI;
const browser = chromium;
(async () => {
  const b = await browser.launch();
  try {
    await step(
      "Setup synthetic browser workflow with an approved product",
      async () => {
        doctor = await apiLogin("doctor");
        pharmacist = await apiLogin("pharmacist");
        nurse = await apiLogin("nurse");
        [product] = await sql(
          "SELECT p.* FROM hms_med_products p WHERE status='APPROVED' AND controlled=false AND base_unit='mL' AND strength=1 AND code LIKE 'LATE-%' AND NOT EXISTS(SELECT 1 FROM hms_med_product_retirements r WHERE r.product_id=p.id) ORDER BY effective_at DESC LIMIT 1",
        );
        if (!product)
          [product] = await sql(
            "SELECT p.* FROM hms_med_products p WHERE status='APPROVED' AND controlled=false AND base_unit='mL' AND strength=1 AND code LIKE 'TEST-%' ORDER BY effective_at DESC LIMIT 1",
          );
        assert(product, "Run medication acceptance fixtures first");
        const [p] = await sql(
          "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',40,'Other','OPD',CURRENT_DATE) RETURNING id",
          ["Synthetic browser medication " + stamp, "P3-UI-" + stamp],
        );
        pid = p.id;
        const [u] = await sql(
          "SELECT id FROM hms_users WHERE username='doctor'",
        );
        const [e] = await sql(
          "INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",
          [pid, u.id],
        );
        await sql(
          "INSERT INTO hms_care_team_assignments(patient_id,practitioner_user_id,role,assigned_by) VALUES($1,$2,'consulting',$2)",
          [pid, u.id],
        );
        eid = e.id;
        doctorUI = await browserAs(b, "doctor");
        pharmacyUI = await browserAs(b, "pharmacist");
        nursingUI = await browserAs(b, "nurse");
      },
    );
    await step(
      "Prescribing has no invented dose and signs an exact coded draft with visible coverage",
      async () => {
        const p = doctorUI.page;
        await p.goto(
          `${BASE}/medication/orders?patient_id=${pid}&encounter_id=${eid}`,
          { waitUntil: "domcontentloaded" },
        );
        await p
          .getByLabel("Approved product", { exact: true })
          .selectOption(product.id);
        assert(
          (await p.getByLabel("Dose", { exact: true }).inputValue()) === "",
          "Dose was prefilled without an approved order set",
        );
        await p.getByLabel("Dose", { exact: true }).fill("0.25");
        await p.getByLabel("Interval (minutes)").fill("60");
        await p.getByLabel("Starts at").fill(dt(Date.now() - 3600000));
        await p.getByLabel("Ends at").fill(dt(Date.now() + 86400000));
        await p.getByLabel("Authorized supply quantity").fill("2");
        await p
          .getByRole("button", { name: "Save coded draft", exact: true })
          .click();
        await p
          .getByRole("button", { name: "sign", exact: true })
          .last()
          .waitFor();
        const [o] = await sql(
          "SELECT o.id,v.id AS version_id FROM hms_med_orders o JOIN hms_med_order_versions v ON v.order_id=o.id WHERE encounter_id=$1",
          [eid],
        );
        orderId = o.id;
        versionId = o.version_id;
        await p
          .getByRole("button", { name: "sign", exact: true })
          .last()
          .click();
        await p.getByText("Declared coverage:", { exact: false }).waitFor();
        assert(
          (await p.getByText("check unavailable", { exact: false }).count()) >
            0,
          "Missing coverage hidden",
        );
        await p
          .getByLabel("Clinical transition reason")
          .fill("Synthetic browser prescriber review");
        await p
          .getByRole("button", { name: "Confirm sign", exact: true })
          .click();
        await p
          .getByRole("button", { name: "hold", exact: true })
          .last()
          .waitFor();
      },
    );
    await step(
      "A version conflict keeps the clinician reason and the current chart",
      async () => {
        const p = doctorUI.page;
        // The screen holds an order through the v2 medication API (completion A3).
        await p.route("**/api/v2/medication-orders/*/hold", (r) =>
          r.fulfill({
            status: 412,
            contentType: "application/json",
            body: JSON.stringify({
              code: "VERSION_CONFLICT",
              message: "Synthetic conflict fixture",
            }),
          }),
        );
        await p
          .getByRole("button", { name: "hold", exact: true })
          .last()
          .click();
        await p
          .getByLabel("Clinical transition reason")
          .fill("Preserve this clinical draft");
        await p
          .getByRole("button", { name: "Confirm hold", exact: true })
          .click();
        await p
          .getByText("Synthetic conflict fixture", { exact: false })
          .waitFor();
        assert(
          (await p.getByLabel("Clinical transition reason").inputValue()) ===
            "Preserve this clinical draft",
          "Conflict erased draft",
        );
        assert(
          p.url().includes("/medication/orders"),
          "Conflict navigated away",
        );
        await p.unroute("**/api/v2/medication-orders/*/hold");
        await p.getByRole("button", { name: "Cancel", exact: true }).click();
      },
    );
    await step(
      "Pharmacist explicitly verifies coverage and confirms partial supply",
      async () => {
        const p = pharmacyUI.page;
        await p.goto(`${BASE}/medication/pharmacy`, {
          waitUntil: "domcontentloaded",
        });
        const row = p
          .locator("tr")
          .filter({ hasText: "Synthetic browser medication " + stamp });
        await row.getByRole("button", { name: "Review version 1" }).click();
        await p
          .getByLabel("Pharmacist review / clarification reason")
          .fill("Synthetic pharmacist review with incomplete coverage");
        await p
          .getByLabel(
            "I reviewed declared coverage, missing context and requested overrides.",
          )
          .check();
        await p
          .getByRole("button", { name: "Verify exact version", exact: true })
          .click();
        await p
          .getByText("The server confirmed this change.", { exact: false })
          .waitFor();
        await p.getByRole("button", { name: "Refresh worklist" }).click();
        await row.filter({ hasText: "VERIFIED" }).waitFor();
        await row.getByRole("button", { name: "Review version 1" }).click();
        await p
          .getByLabel("Supply location")
          .selectOption({ label: "Main pharmacy" });
        await p.getByLabel("Quantity to supply (base units)").fill("2");
        await p
          .getByRole("button", { name: "Confirm partial supply", exact: true })
          .click();
        await p.getByRole("heading", { name: "Confirmed supply" }).waitFor();
        [line] = await sql(
          "SELECT * FROM hms_med_dispense_lines WHERE version_id=$1",
          [versionId],
        );
        assert(line, "No confirmed supply line");
        const r = await api("GET", "/medication/orders/" + orderId, {
          token: doctor,
        });
        const o = r.data.data.order;
        const scheduled = await api(
          "POST",
          `/medication/orders/${orderId}/schedules`,
          {
            token: nurse,
            headers: { "if-match": String(o.revision) },
            body: {
              from_at: new Date(Date.now() - 1800000).toISOString(),
              through_at: new Date(Date.now() + 7200000).toISOString(),
            },
          },
        );
        assert(scheduled.status === 201, "Schedule creation failed");
        scheduleId = scheduled.data.data[0].id;
      },
    );
    await step(
      "Lost responses after a documented dose retain the original key and never invite a repeat dose",
      async () => {
        const p = nursingUI.page;
        await p.goto(`${BASE}/medication/nursing`, {
          waitUntil: "domcontentloaded",
        });
        const row = p.locator(`tr[data-occurrence-id="${scheduleId}"]`);
        await row
          .getByRole("button", { name: "Bedside checks", exact: true })
          .click();
        await p.getByLabel("Supplied line").selectOption(line.id);
        await p
          .getByLabel("Bedside verification method")
          .selectOption("MANUAL");
        await p
          .getByLabel("Scanned / confirmed patient identifier")
          .fill("P3-UI-" + stamp);
        await p
          .getByLabel("Manual fallback reason")
          .fill("Synthetic unavailable scanner");
        await p
          .getByLabel(
            "Positively confirmed patient and approved product identity",
          )
          .check();
        for (const k of ["dose", "route", "time"])
          await p
            .getByLabel("Confirmed intended " + k, { exact: true })
            .check();
        await p
          .getByRole("button", {
            name: "Confirm bedside checks and reserve documentation",
            exact: true,
          })
          .click();
        await p
          .getByRole("button", {
            name: "Record outcome; do not administer again",
            exact: true,
          })
          .waitFor();
        const keys = [];
        let sid;
        // The dose is documented through the v2 administrations command, which names its occurrence.
        await p.route("**/api/v2/administrations", async (route) => {
          sid = route.request().postDataJSON().schedule_id;
          keys.push(route.request().headers()["idempotency-key"]);
          await route.fetch();
          await route.abort("failed");
        });
        await p
          .getByRole("button", {
            name: "Record outcome; do not administer again",
            exact: true,
          })
          .click();
        await p
          .getByRole("heading", {
            name: "Pending documentation — do not repeat the dose",
          })
          .waitFor();
        await p
          .getByRole("button", { name: "Reconcile original save", exact: true })
          .waitFor({ timeout: 20000 });
        const [count] = await sql(
          "SELECT count(*)::int AS n FROM hms_med_administrations WHERE schedule_id=$1",
          [sid],
        );
        assert(count.n === 1, "Physical-dose documentation duplicated");
        assert(
          keys.length === 3 && new Set(keys).size === 1,
          "Network retries used different keys",
        );
        await p.unroute("**/api/v2/administrations");
        await p
          .getByRole("button", {
            name: "Reconcile original documentation",
            exact: true,
          })
          .click();
        await p
          .getByRole("heading", {
            name: "Pending documentation — do not repeat the dose",
          })
          .waitFor({ state: "hidden", timeout: 20000 });
        const [again] = await sql(
          "SELECT count(*)::int AS n FROM hms_med_administrations WHERE schedule_id=$1",
          [sid],
        );
        assert(again.n === 1, "Reconciliation recorded another dose");
      },
    );
    await step(
      "Medication screens render without uncaught exceptions",
      async () => {
        for (const [path, heading] of [
          ["/medication/stock", "Location stock and ward supply"],
          ["/medication/controlled", "Controlled-drug accountability"],
          ["/medication/catalogue", "Governed medication catalogue"],
          ["/medication/witness", "Independent clinical witnessing"],
        ]) {
          await pharmacyUI.page.goto(BASE + path, {
            waitUntil: "domcontentloaded",
          });
          await pharmacyUI.page
            .getByRole("heading", { name: heading, exact: true })
            .waitFor();
          await pharmacyUI.page
            .getByText(/Last confirmed/)
            .first()
            .waitFor();
          await pharmacyUI.page.waitForFunction(
            () =>
              document.querySelector("main").getBoundingClientRect().left >=
              document
                .querySelector("aside.app-sidebar")
                .getBoundingClientRect().right -
                1,
          );
        }
        assert(
          [doctorUI, pharmacyUI, nursingUI].every((s) => s.errors.length === 0),
          JSON.stringify([
            doctorUI.errors,
            pharmacyUI.errors,
            nursingUI.errors,
          ]),
        );
        await pharmacyUI.page.screenshot({
          path: "/tmp/hms-phase3-work/pharmacy-screen.png",
          fullPage: true,
        });
      },
    );
  } finally {
    await b.close();
    done();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
