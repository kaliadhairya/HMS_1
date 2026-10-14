const {
  chromium,
  BASE,
  api,
  apiLogin,
  sql,
  browserAs,
  inCare,
  runner,
  assert,
  requireThrowawayDb,
} = require("./helpers");
const crypto = require("crypto");
requireThrowawayDb();
assert(/^hms_p4_/.test(process.env.DB_NAME || ""), "Use Phase 4 private DB");
const { step, done } = runner("Phase 4 laboratory browser"),
  tag = crypto.randomUUID().slice(0, 8);
const ok = (r, n = 200) => {
  assert(
    r.status === n,
    `${r.status}: ${JSON.stringify(r.data).slice(0, 250)}`,
  );
  return r.data.data;
};
let pid, eid, lab, doc, order, test, specimen, session;
(async () => {
  const browser = await chromium.launch();
  try {
    await step(
      "Prepare a coded specimen worklist and render the real laboratory screen",
      async () => {
        lab = await apiLogin("lab_technician");
        doc = await apiLogin("doctor");
        const [{ id: uid }] = await sql(
          "SELECT id FROM hms_users WHERE username='doctor'",
        );
        [{ id: pid }] = await sql(
          "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Female','OPD',CURRENT_DATE) RETURNING id",
          ["Synthetic browser lab " + tag, "P4B-" + tag],
        );
        await inCare(pid);
        [{ id: eid }] = await sql(
          "INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'In Progress') RETURNING id",
          [pid, uid],
        );
        test = ok(
          await api("POST", "/laboratory/catalogue", {
            token: lab,
            body: {
              code_system: "TEST-BROWSER",
              code: tag,
              kind: "TEST",
              name: "Synthetic browser test " + tag,
              section: "TEST",
              unit: "TEST-U",
              method: "TEST-METHOD",
              provenance: "Browser acceptance fixture only",
              effective_at: new Date(Date.now() - 1000).toISOString(),
              requirements: [
                { specimen_type: "TEST-BLOOD", container: "TEST-TUBE" },
              ],
            },
          }),
          201,
        );
        order = ok(
          await api("POST", "/laboratory/orders", {
            token: doc,
            body: {
              patient_id: pid,
              encounter_id: eid,
              test_version_ids: [test.id],
            },
          }),
          201,
        );
        session = await browserAs(browser, "lab_technician");
        await session.page.goto(BASE + "/lab/governed?patient_id=" + pid, {
          waitUntil: "networkidle",
        });
        await session.page
          .getByRole("heading", { name: "Laboratory workflow", exact: true })
          .waitFor();
        await session.page
          .getByLabel("Diagnostic order")
          .selectOption(String(order.id));
      },
    );
    await step(
      "Accession label, identity confirmation, collection and receipt commit through the UI",
      async () => {
        const p = session.page,
          [req] = await sql(
            "SELECT id FROM hms_lab_requirements WHERE test_version_id=$1",
            [test.id],
          );
        await p
          .getByLabel("Declared specimen requirement")
          .selectOption(req.id);
        await p
          .getByLabel("Synthetic browser test " + tag, { exact: true })
          .check();
        await p.getByLabel("Location", { exact: true }).fill("TEST-COLLECTION");
        await p
          .getByRole("button", { name: "Create accession", exact: true })
          .click();
        await p
          .getByRole("button", { name: /LAB-.*TEST-BLOOD.*PLANNED/ })
          .waitFor();
        await p
          .getByRole("button", { name: /LAB-.*TEST-BLOOD.*PLANNED/ })
          .click();
        [specimen] = await sql(
          "SELECT s.* FROM hms_lab_specimens s JOIN hms_lab_specimen_links l ON l.specimen_id=s.id WHERE l.item_id=$1",
          [order.items[0].id],
        );
        assert(
          (await p.locator("svg").count()) > 0,
          "Barcode label not rendered",
        );
        await p.getByLabel("Confirm patient identifier").fill(String(pid));
        await p
          .getByLabel("Scan or confirm accession")
          .fill(specimen.accession);
        await p.getByLabel("Custody location").fill("TEST-LAB");
        await p
          .getByLabel("Custody or rejection reason")
          .fill("Synthetic browser custody");
        await p.getByRole("button", { name: "COLLECTED", exact: true }).click();
        await p
          .getByRole("button", { name: "RECEIVED", exact: true })
          .waitFor();
        await p.getByRole("button", { name: "RECEIVED", exact: true }).click();
        await p
          .getByRole("button", { name: /LAB-.*TEST-BLOOD.*RECEIVED/ })
          .waitFor();
        const [stored] = await sql(
          "SELECT state,collected_at,received_at FROM hms_lab_specimens WHERE id=$1",
          [specimen.id],
        );
        assert(
          stored.state === "RECEIVED" &&
            stored.collected_at &&
            stored.received_at,
          "Custody not durable",
        );
      },
    );
    await step(
      "Lost post-commit response preserves the draft and reconciles one original save",
      async () => {
        const p = session.page;
        await p
          .getByRole("button", { name: "Result entry and review", exact: true })
          .click();
        await p
          .getByRole("button", {
            name: /Synthetic browser test.*PROCESSING.*revision 0/,
          })
          .click();
        await p.getByLabel("Raw observed value").fill("5");
        let committed = false;
        const keys = [];
        await p.route("**/api/laboratory/items/*/results", async (route) => {
          keys.push(route.request().headers()["idempotency-key"]);
          if (!committed) {
            const response = await route.fetch();
            assert(response.status() === 201, "Original save did not commit");
            committed = true;
          }
          await route.abort("failed");
        });
        await p
          .getByRole("button", { name: "Save provisional result", exact: true })
          .click();
        await p
          .getByRole("button", { name: "Reconcile original save", exact: true })
          .waitFor({ timeout: 20000 });
        assert(
          (await p.getByLabel("Raw observed value").inputValue()) === "5",
          "Draft lost",
        );
        await p.unroute("**/api/laboratory/items/*/results");
        await p
          .getByRole("button", { name: "Reconcile original save", exact: true })
          .click();
        await p.getByText("Saved and confirmed.", { exact: true }).waitFor();
        const results = await sql(
          "SELECT id FROM hms_lab_result_versions WHERE item_id=$1",
          [order.items[0].id],
        );
        assert(
          results.length === 1 && keys.every((k) => k === keys[0]),
          "Original command replay created duplicate results",
        );
        await p.getByText(/NO REFERENCE INTERVAL/).waitFor();
      },
    );
    await step(
      "A competing writer returns a conflict while preserving the browser draft",
      async () => {
        const p = session.page;
        await p
          .getByRole("button", {
            name: /Synthetic browser test.*ENTERED.*revision 1/,
          })
          .click();
        await p.getByLabel("Raw observed value").fill("6");
        ok(
          await api(
            "POST",
            "/laboratory/items/" + order.items[0].id + "/results",
            {
              token: lab,
              body: {
                specimen_id: specimen.id,
                raw_value: "7",
                unit: "TEST-U",
                method: "TEST-METHOD",
              },
              headers: { "if-match": "1" },
            },
          ),
          201,
        );
        await p
          .getByRole("button", { name: "Save provisional result", exact: true })
          .click();
        await p.getByText(/This record changed/).waitFor();
        assert(
          (await p.getByLabel("Raw observed value").inputValue()) === "6",
          "Conflict destroyed browser draft",
        );
        await p
          .getByRole("button", { name: "Refresh observations", exact: true })
          .click();
        await p
          .getByRole("button", {
            name: "Use reviewed current revision",
            exact: true,
          })
          .waitFor();
        assert(
          (await p.getByLabel("Raw observed value").inputValue()) === "6",
          "Refresh destroyed draft",
        );
      },
    );
    await step(
      "Historical editor has no save path and role boundaries prevent pharmacy access",
      async () => {
        const p = session.page;
        await p.goto(BASE + "/report/new?patient_id=" + pid, {
          waitUntil: "networkidle",
        });
        await p
          .getByRole("heading", {
            name: "Historical laboratory report",
            exact: true,
          })
          .waitFor();
        assert(
          (await p.getByRole("button", { name: /Save report/ }).count()) === 0,
          "Legacy editor remains writable",
        );
        await p.getByRole("link", { name: "Open laboratory workflow" }).click();
        await p
          .getByRole("heading", { name: "Laboratory workflow", exact: true })
          .waitFor();
        const pharm = await browserAs(browser, "pharmacist");
        try {
          await pharm.page.goto(BASE + "/lab/governed", {
            waitUntil: "networkidle",
          });
          assert(
            !(await pharm.page
              .getByRole("heading", {
                name: "Laboratory workflow",
                exact: true,
              })
              .isVisible()),
            "Pharmacist bypassed frontend role guard",
          );
        } finally {
          await pharm.ctx.close();
        }
      },
    );
    await step(
      "Loaded screen has no script errors or horizontal page overflow",
      async () => {
        const p = session.page;
        await p.goto(BASE + "/lab/governed?patient_id=" + pid, {
          waitUntil: "networkidle",
        });
        await p.getByLabel("Diagnostic order").selectOption(String(order.id));
        await p.waitForTimeout(400);
        assert(session.errors.length === 0, session.errors.join(" | "));
        const layout = await p.evaluate(() => ({
          width: window.innerWidth,
          scroll: document.documentElement.scrollWidth,
        }));
        assert(
          layout.scroll <= layout.width + 2,
          "Lab page overflows viewport",
        );
        await p.screenshot({
          path: process.env.LAB_SCREENSHOT_PATH || "/tmp/hms-phase4-work/laboratory-screen.png",
          fullPage: true,
        });
      },
    );
  } finally {
    if (session) await session.ctx.close();
    await browser.close();
    done();
  }
})();
