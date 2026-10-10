# End-to-end workflow tests

Browser + API tests that walk each hospital workflow as the real role, then check the database.

| File | Workflow |
|---|---|
| `opd.e2e.js` | Registration → token → vitals → consultation (allergy check) → prescription → lab order → OPD bill → payment |
| `pharmacy.e2e.js` | Stock receipt (GRN) → dispense prescription → OTC sale → stock and bill effects |
| `lab.e2e.js` | Lab order → sample collection → result entry → report → doctor view |
| `ipd.e2e.js` | Admission request → bed allocation → vitals / MAR / notes → discharge summary → IPD bill |
| `admin.e2e.js` | Users, staff, notices, attendance, appointments, visitors, reports |

## Run

Start the stack (backend on :5001, frontend on :4999, PostgreSQL seeded with the default staff accounts), then:

```bash
cd e2e
npm install            # installs playwright + pg (first time only)
npx playwright install chromium
node opd.e2e.js        # or any other *.e2e.js; `npm test` runs all
```

Accounts default to the seeded users (superadmin, admin, doctor, receptionist, pharmacist, nurse, labtech).
Override with `E2E_<ROLE>_USER` / `E2E_<ROLE>_PASS`, the URLs with `E2E_BASE` / `E2E_API`, and the database with `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.

Tests create their own uniquely named patients and records; run them against a test database, not production.
