# HMS Phase 0 Baseline

Date: 2026-08-12

## Verdict

PASS after one baseline correctness fix. The original monolith starts, connects to the existing PostgreSQL database, serves the React frontend, enforces tested RBAC, supports Socket.IO over WebSocket, and passes the existing critical workflow suite against an isolated database. No service extraction has started.

The failed `services/` implementation was an untracked wrapper tree and has been removed. Its two root launch scripts were also removed. No working monolith code was deleted.

## Repository and change-safety baseline

- Repository: `HMS_1`
- Branch/HEAD: `main` at `df38568`
- Existing user changes were present before this phase and were preserved.
- Failed migration artifacts were exactly the former `services/` tree (10 thin service entry points, shared DB/context/client helpers, launcher, and health script) plus `start:microservices` and `health:microservices` in the root package.
- None of those services had an independent package, models, repositories, controllers, migrations, contracts, tests, or owned data.
- Every domain wrapper imported `backend/routes/*`; imported monolith routes then imported the monolithic `backend/models` registry.
- All wrappers used the same unrestricted database credentials.
- Their health endpoints returned HTTP 200 even when their database connection failed.
- The gateway manually replayed parsed JSON with `http.request`, could corrupt or hang non-JSON/multipart/streaming requests, trusted forgeable `x-user-*` headers downstream, exposed an unauthenticated internal broadcast endpoint, and did not provide safe timeout/error semantics.
- The wrapper services could not provide working `req.app.get('io')`, so route-originated realtime events were disconnected from the gateway Socket.IO server.

## Existing architecture

```text
Browser / React 18 + Vite (:4999)
        | relative /api and /socket.io proxy
        v
Express monolith + Socket.IO (:5001)
        | Sequelize 6 / pg
        v
PostgreSQL 18.4 database `hms`
        host Unix socket /var/run/postgresql, port 5432
```

Runtime configuration currently comes from `backend/.env`. Secrets were not copied into this report. Non-secret baseline values are backend port 5001, frontend port 4999, database `hms`, PostgreSQL user `postgres`, JWT lifetime 8h, upload limit 5 MB, and frontend URL `http://localhost:4999`.

Configuration notes:

- Runtime, Docker container, and startup all use PostgreSQL.
- Host verification used Node 24.13.0/npm 11.6.2; Docker declares Node 20.

## Backend route inventory

The monolith declares 248 Express route handlers. Public mount paths are preserved as the future gateway compatibility contract.

| Mount | Route source | Handlers | Context |
|---|---|---:|---|
| `/api/auth` | `routes/auth.js` | 7 | login, session identity, password change/reset |
| `/api/users` | `routes/users.js` | 9 | users and permissions |
| `/api/security` | `routes/security.js` | 34 | security/admin controls |
| `/api/patients` | `routes/patients.js` | 17 | registration, search, profile, documents, allergies, conditions |
| `/api/reports` | `routes/reports.js` | 10 | legacy lab report operations and cross-domain reports |
| `/api/dashboard` | `routes/dashboard.js` | 7 | role dashboards and aggregation |
| `/api/medicines`, `/api/hms/medicines` | `routes/hms/medicines.js` | 6 | medicine master/search |
| `/api/suppliers` | `routes/suppliers.js` | 4 | suppliers |
| `/api/pharmacy` | `routes/pharmacy.js` | 13 | stock, GRN, dispense, OTC, returns |
| `/api/pharmacist_lms` | `routes/pharmacist_lms.js` | 11 | legacy pharmacy compatibility |
| `/api/hms/tokens` | `routes/hms/tokens.js` | 5 | OPD tokens/queue |
| `/api/hms/appointments` | `routes/hms/appointments.js` | 3 | appointment booking/list/update |
| `/api/hms/vitals` | `routes/hms/vitals.js` | 3 | OPD vitals |
| `/api/hms/departments` | `routes/hms/departments.js` | 3 | department listing/creation/doctors |
| `/api/hms/doctors` | `routes/hms/doctors.js` | 3 | doctor listing/creation/detail |
| `/api/hms/encounters` | `routes/hms/encounters.js` | 5 | consultation encounters |
| `/api/hms/diagnoses` | `routes/hms/diagnoses.js` | 2 | diagnoses |
| `/api/hms/prescriptions` | `routes/hms/prescriptions.js` | 6 | prescription lifecycle/items/status |
| `/api/hms/rest-forms` | `routes/hms/restForms.js` | 5 | rest certificates |
| `/api/hms/investigation-orders` | `routes/hms/investigationOrders.js` | 2 | clinical lab ordering |
| `/api/hms/icd10` | `routes/hms/icd10.js` | 1 | ICD-10 lookup |
| `/api/ipd` | `routes/ipd.js` | 34 | wards, beds, requests, admission, chart, MAR, discharge, charges |
| `/api/billing` | `routes/billing.js` | 9 | bills, advances, payments, discounts |
| `/api/admin` | `routes/admin.js` | 15 | hospital profile, tariffs, staff, notices |
| `/api/pdf` | `routes/pdfRoutes.js` | 2 | prescription/bill PDF |
| `/api/doctor` | `routes/doctor.js` | 16 | doctor worklists, referrals, notes, schedules |
| `/api/receptionist` | `routes/receptionist.js` | 7 | visitor log, notifications, billing/IPD summaries |
| `/api/lab` | `routes/lab.js` | 9 | queue, samples, results, reports, workload |
| `/api/health` | `server.js` | 1 | process health only |

Important compatibility finding: most frontend calls use the relative Axios `/api` client, but 12 calls bypass it with hard-coded `localhost:5001` or `127.0.0.1:5001`. Eleven are in `ConsultationPage.jsx`; one is the pharmacy prescription PDF link. These must be converted to gateway-relative URLs during gateway foundation work.

## PostgreSQL schema and preliminary logical ownership

The live database has 45 HMS base tables, 47 HMS sequences, 50 HMS-named indexes, 45 primary-key constraints, 5 unique constraints, and no foreign-key constraints. Existing data was present and was not recreated or modified except normal login/audit effects during verification.

| Proposed owner | Existing tables |
|---|---|
| Identity | `hms_users`, `hms_permissions`, `hms_audit_logs` |
| Patient | `hms_patients`, `hms_patient_documents`, `hms_allergies`, `hms_chronic_conditions` |
| OPD | `hms_departments`, `hms_doctors`, `hms_appointments`, `hms_tokens`, `hms_vitals` |
| Clinical/EMR | `hms_encounters`, `hms_diagnoses`, `hms_referrals`, `hms_prescriptions`, `hms_prescription_items`, `hms_rest_forms` |
| Lab | `hms_investigation_orders`, `hms_investigation_order_items`, `hms_test_reports` |
| Pharmacy | `hms_medicines`, `hms_suppliers`, `hms_medicine_batches`, `hms_stock_ledger`, `hms_purchase_orders`, `hms_purchase_items`, `hms_dispensing_records`, `hms_dispensing_items`, `hms_otc_sales`, `hms_otc_items` |
| IPD/Nursing | `hms_wards`, `hms_beds`, `hms_admissions`, `hms_ipd_requests`, `hms_progress_notes`, `hms_nursing_notes`, `hms_ipd_vitals`, `hms_mar_records` |
| Billing | `hms_bills`, `hms_bill_items`, `hms_payments`, `hms_patient_advances`, `hms_tariffs` |
| Admin | `hms_hospital_profile` |

This is an ownership proposal, not yet enforcement. Current routes freely cross these boundaries. Notable examples include pharmacy writing billing and prescription tables, IPD writing bill tables, billing reading encounter/lab/pharmacy tables, dashboards reading almost every domain, and patient profile queries aggregating clinical/billing data.

## Authentication and RBAC baseline

- Login queries `hms_users`, verifies bcrypt hashes, active status, lock expiry, and maintenance mode.
- Five failed attempts lock an account for 15 minutes.
- Successful login resets failures, updates `last_login`, creates audit entries, and signs an 8-hour JWT.
- Frontend stores JWT/user data in local storage and sends `Authorization: Bearer` through an Axios interceptor.
- `protect` verifies the JWT and reloads the user from the database, so deactivation and lock state are checked per request.
- `restrictTo` enforces coarse roles.
- `checkPermission` reads `hms_permissions`; admin and super-admin bypass it.
- Tested evidence: receptionist login 200, `/auth/me` 200, patient search 200, doctors 200, and super-admin dashboard access 403.
- Known production blockers retained from baseline: public `/api/auth/emergency-reset`, OTP returned in forgot-password response, query-string JWT acceptance, and permissive CORS when configured as `*`/empty.

## Realtime baseline and event map

Socket.IO shares the monolith HTTP server on port 5001. The frontend connects to its own origin, Vite proxies `/socket.io`, and the client emits `join_role`. The server currently trusts the supplied role without authenticating the socket.

| Event | Producer | Room/consumer | Trigger |
|---|---|---|---|
| `join_role` | frontend SocketContext | server room membership | authenticated React user becomes available, but socket itself is not authenticated |
| `new_ipd_request` | IPD route | nurse; frontend SocketContext also shows for admin/super-admin | doctor creates IPD request |
| `new_lab_order` | investigation-order route | lab technician / lab queue | doctor creates investigation order |
| `lab_status_change` | lab route | doctor dashboard | lab queue status update |
| `lab_result_ready` | lab route | doctor dashboard | lab result saved |
| `new_prescription` | prescription route | pharmacist dispense page | prescription created |
| `prescription_items_updated` | prescription route | pharmacist | items replaced |
| `prescription_status_change` | prescription route | pharmacist and doctor | status update |
| `stock_updated` | pharmacy routes | pharmacist | dispensing changes stock |
| `billing_updated` | pharmacy routes | receptionist billing | dispensing adds bill item |
| `prescription_dispensed` | pharmacy routes | doctor dashboard | dispensing completes |
| `return_processed` | legacy pharmacy route | pharmacist | pharmacy return |

Runtime evidence: a real Socket.IO client connected using WebSocket, joined the receptionist room, and disconnected; matching server logs were observed.

## Database transaction boundaries

Current explicit transactions exist around:

- basic patient plus test-report creation;
- HMS patient registration helper paths;
- OPD token number generation and creation;
- encounter creation and encounter finalization/token completion;
- prescription item replacement and status update;
- medicine/batch/stock creation and adjustment;
- pharmacy GRN/purchase order, dispensing, OTC, and returns;
- legacy pharmacist GRN and dispensing;
- IPD admission plus bed allocation, discharge, and IPD bill generation;
- billing OPD bill generation and payment/advance adjustment;
- doctor referral mutation.

These transactions are currently cross-domain because all tables share one database transaction. Extraction must replace those guarantees with explicit idempotent workflows and compensation/outbox state where ownership crosses a service boundary.

## Major workflow map

1. Receptionist logs in, registers/searches patient, books appointment or creates OPD token.
2. Doctor opens queue/patient, creates encounter, diagnosis, prescription, lab order, referral, rest form, or IPD request.
3. Lab receives order, logs sample, records result, updates status, and notifies doctor.
4. Pharmacy receives prescription, receives stock through GRN, selects batch, dispenses, decrements stock, creates billing item, and notifies pharmacist/receptionist/doctor.
5. IPD receives request, allocates ward/bed, records progress/nursing notes/vitals/MAR, handles charges/discharge, and can generate a bill.
6. Billing creates OPD/IPD bills, applies advances/discounts/payments, changes bill status, and produces PDFs.
7. Global audit middleware and explicit action logging write audit records for API behavior.

## Runtime dependencies

Backend production dependencies: Express, Sequelize, pg, JWT, bcrypt, Helmet, CORS, express-rate-limit, express-validator, Multer, Socket.IO, PDFKit, ExcelJS, QR code support, plus currently unused/legacy MySQL compatibility dependency. Frontend uses React 18, React Router, Axios, Socket.IO client, React Hot Toast, Recharts, QR/barcode components, and Vite.

There is no formal unit/integration test runner or lint command. The principal executable regression is `backend/smoke_critical_flows.js`; numerous ad-hoc test/debug/migration scripts also exist.

## Phase 0 defect found and fixed

The dispensing transaction inserted a bill item correctly but read PostgreSQL's lowercase aggregate alias using `TOTAL_AMOUNT`. This silently set bill totals to zero. The code now accepts the PostgreSQL `total_amount` key, retaining uppercase compatibility, and the smoke test now asserts `TOTAL_AMOUNT` and `NET_PAYABLE` both equal the dispensed amount.

## Verification evidence

- Original backend start: PASS, PostgreSQL connected, HTTP server on 5001.
- Original frontend start: PASS, Vite on 4999.
- Backend health direct: PASS, HTTP 200.
- Backend health through frontend proxy: PASS, HTTP 200.
- Frontend HTML: PASS, HTTP 200.
- Frontend production build to `/tmp`: PASS, 1,087 modules; main JS 1.723 MB / 423.71 KB gzip; bundle-size warning remains.
- Backend JavaScript syntax check: PASS.
- Authenticated endpoint checks: PASS.
- Negative RBAC check: PASS, receptionist denied super-admin dashboard with 403.
- Live DB effect check: PASS, login updated user state and audit rows increased from 221 to 223.
- Socket.IO WebSocket connection and role join: PASS.
- Critical write workflow: PASS against temporary isolated PostgreSQL database.
- DB effects after fixed smoke: patient 1, token 1, appointment 1, encounter 1, prescription/item 1/1, lab order/completed item 1/1, dispensing record 1, bill 1, audit rows 28, smoke batch stock 4 after dispensing 1 from received quantity 5.
- Billing regression assertion: PASS, total and net payable both 3.00.
- Test backend logs: no errors observed.
- Temporary database `hms_phase0_test_20260812`: removed after verification; it contained only test data.
- Existing live clinical data: not changed by the write smoke test.
- Frontend workflow compatibility: API proxy, auth/session, patient/doctor reads, RBAC, production build, and realtime transport verified. Full browser-driven UI automation does not yet exist and remains test debt.

## Sprint evidence record

Sprint: Phase 0 — Preserve and clean baseline

Changes made: removed invalid wrapper-service tree and launch scripts; fixed PostgreSQL dispensing bill aggregate lookup; strengthened critical smoke assertion; added this baseline report.

Files changed by this phase: `backend/routes/pharmacy.js`, `backend/smoke_critical_flows.js`, `docs/migration/PHASE_0_BASELINE.md`. The root `package.json` was restored to its pre-wrapper state. Existing unrelated user modifications remain untouched.

Service extracted: none.

Tables owned: ownership documented only; enforcement begins with extraction.

Old monolith dependencies removed: none; monolith remains the operational baseline.

Inter-service dependencies: none yet.

Tests run: frontend production build; backend syntax checks; authenticated HTTP/RBAC checks; Socket.IO transport check; full critical smoke workflow against isolated PostgreSQL; direct post-workflow DB checks.

Runtime checks: backend/frontend starts and health endpoints PASS.

HTTP checks: PASS.

DB checks: PASS after the billing fix.

Frontend checks: build/proxy/API/realtime compatibility PASS; browser automation pending.

Failures: initial isolated smoke exposed a zero-value bill; fixed and full suite rerun successfully. Initial temporary DB socket initialization failed because pg_hba is scoped to `hms`; TCP password authentication was used for the isolated database.

Remaining blockers before Sprint 1: design the gateway contract and test harness; convert 12 hard-coded frontend backend URLs; decide how the gateway authenticates Socket.IO and internal service identity; add contract tests around uploads/PDFs; preserve the monolith as fallback during strangling.

Verdict: PASS. Sprint 1 may begin, but only with the monolith still serving all domain routes behind the gateway.
