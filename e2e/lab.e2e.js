// Legacy compatibility and intentional write retirement. The full governed
// diagnostic loop/races are exercised in laboratory and laboratoryFrontend.
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
const { step, done } = runner("Laboratory compatibility");
let pid, reportId, lab, doc, session;
const tag = crypto.randomUUID().slice(0, 8);
(async () => {
  const browser = await chromium.launch();
  try {
    await step(
      "Historical evidence remains patient-linked and readable",
      async () => {
        lab = await apiLogin("lab_technician");
        doc = await apiLogin("doctor");
        const [{ id: uid }] = await sql(
          "SELECT id FROM hms_users WHERE username='labtech'",
        );
        [{ id: pid }] = await sql(
          "INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",
          ["Synthetic legacy lab " + tag, "P4H-" + tag],
        );
        await inCare(pid);
        [{ id: reportId }] = await sql(
          "INSERT INTO hms_test_reports(id,patient_id,haematology,reported_by,status) VALUES(nextval('hms_test_reports_seq'),$1,$2,$3,'Draft') RETURNING id",
          [pid, JSON.stringify({ hb: { result: "5" } }), uid],
        );
        const r = await api("GET", "/reports/" + reportId, { token: lab });
        assert(
          r.status === 200 && r.data.report.patientId === pid,
          "Historical report lost",
        );
      },
    );
    await step(
      "Historical PDF remains downloadable with scoped authorization",
      async () => {
        const r = await fetch(
          process.env.E2E_API + "/reports/" + reportId + "/pdf",
          { headers: { Authorization: "Bearer " + doc } },
        );
        assert(
          r.status === 200 &&
            Buffer.from(await r.arrayBuffer())
              .subarray(0, 4)
              .toString() === "%PDF",
          "Historical PDF unavailable",
        );
      },
    );
    await step(
      "Legacy report creation and editing are explicitly retired",
      async () => {
        for (const [method, path] of [
          ["POST", "/reports"],
          ["PUT", "/reports/" + reportId],
        ]) {
          const r = await api(method, path, {
            token: lab,
            body: { patientId: pid, status: "Final" },
          });
          assert(r.status === 410, "Legacy report still writable");
        }
      },
    );
    await step(
      "Legacy sample and result aliases cannot bypass accession or review",
      async () => {
        for (const path of [
          "/lab/samples",
          "/lab/results/1",
          "/lab/results/RES-1",
        ]) {
          const r = await api("POST", path, {
            token: lab,
            body: { itemId: 1, result_value: "5" },
          });
          assert(r.status === 410, "Legacy lab write accepted");
        }
      },
    );
    await step(
      "Status-only report linking cannot manufacture a release",
      async () => {
        const r = await api(
          "PATCH",
          "/hms/investigation-orders/1/link-report",
          { token: lab, body: {} },
        );
        assert(r.status === 410, "Old report-link command active");
      },
    );
    await step(
      "Wrong clinical roles are refused before retired handlers",
      async () => {
        const pharmacist = await apiLogin("pharmacist");
        for (const path of [
          "/lab/queue",
          "/lab/results",
          "/laboratory/worklist",
        ]) {
          const r = await api("GET", path, { token: pharmacist });
          assert(r.status === 403, "Pharmacist accessed lab");
        }
        const r = await api("POST", "/lab/results/1", {
          token: doc,
          body: { result_value: "5" },
        });
        assert(r.status === 403, "Doctor entered legacy result");
      },
    );
    await step(
      "Historical editor exposes a labelled read-only report",
      async () => {
        session = await browserAs(browser, "lab_technician");
        await session.page.goto(BASE + "/report/" + reportId, {
          waitUntil: "networkidle",
        });
        await session.page
          .getByRole("heading", {
            name: "Historical laboratory report",
            exact: true,
          })
          .waitFor();
        await session.page
          .getByRole("heading", {
            name: "Synthetic legacy lab " + tag,
            exact: true,
          })
          .waitFor();
        assert(
          (await session.page
            .getByRole("button", { name: "Save report" })
            .count()) === 0,
          "Legacy UI writable",
        );
      },
    );
    await step(
      "Existing lab queue, samples, result and report entry URLs reach governed workspace",
      async () => {
        for (const path of [
          "/lab/queue",
          "/lab/samples",
          "/lab/results",
          "/lab/reports",
        ]) {
          await session.page.goto(BASE + path, { waitUntil: "networkidle" });
          await session.page
            .getByRole("heading", { name: "Laboratory workflow", exact: true })
            .waitFor();
        }
        assert(session.errors.length === 0, session.errors.join(" | "));
      },
    );
    await step(
      "Read-only workload and dashboard observations still load",
      async () => {
        for (const path of ["/lab/dashboard", "/lab/workload"]) {
          const r = await api("GET", path, { token: lab });
          assert(
            r.status === 200 && r.data.data,
            "Lab workload compatibility failed",
          );
        }
      },
    );
    await step(
      "Ending care refuses historical report and PDF access",
      async () => {
        const [{ id: uid }] = await sql(
          "SELECT id FROM hms_users WHERE username='doctor'",
        );
        await sql(
          "UPDATE hms_care_team_assignments SET valid_to=now(),ended_by=$1,ended_reason=$2 WHERE patient_id=$3 AND valid_to IS NULL",
          [uid, "Synthetic care ended", pid],
        );
        for (const path of [
          "/reports/" + reportId,
          "/reports/" + reportId + "/pdf",
        ]) {
          const r = await api("GET", path, { token: doc });
          assert(
            r.status === 403,
            "Ended care could still read historical report",
          );
        }
      },
    );
  } finally {
    if (session) await session.ctx.close();
    await browser.close();
    done();
  }
})();
