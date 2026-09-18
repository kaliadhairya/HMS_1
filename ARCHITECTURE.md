# Hospital Management System — Architecture & Technical Report

A role-based clinical and administrative platform covering the full patient journey:
registration through OPD, consultation, diagnostics, pharmacy, inpatient care and billing.
Node.js REST API, React SPA, PostgreSQL.

All figures below were measured from the source, schema and git history — not estimated.

| Metric | Value |
|---|---|
| Application code | ~45,500 lines (backend 14.5K, frontend 31K) |
| REST endpoints | 248 |
| Database tables | 45 |
| Route modules | 29 |
| Sequelize models | 46 |
| Frontend files | 101 (78 pages, 19 components, 3 contexts) |
| Commits | 137 |

---

## 1. System overview

The system digitises hospital operations end to end. A patient is registered once and issued
a UHID; from there every interaction — OPD token, consultation, prescription, lab order,
medicine dispensing, ward admission, bill — attaches to that identity and accumulates into a
longitudinal record.

Seven roles operate the system, each with a distinct dashboard and a permission set enforced
server-side: `super_admin`, `admin`, `doctor`, `nurse`, `receptionist`, `lab_technician`,
`pharmacist`.

**Functional domains**

- **Front office** — patient registration, UHID allocation, search, OPD token queue,
  appointment scheduling, referrals.
- **Clinical** — encounters, vitals, ICD-10 diagnoses, prescriptions, investigation orders,
  allergies and chronic conditions.
- **Diagnostics** — lab order queue, result entry, test report generation and release back to
  the ordering doctor.
- **Pharmacy** — medicine master, batch and expiry tracking, GRN and purchase orders,
  dispensing, OTC sales, stock ledger.
- **Inpatient** — admission requests, ward and bed allocation, nursing notes, progress notes,
  MAR records, IPD vitals.
- **Revenue** — tariff master, bill and bill-item generation, GST, advances, payments,
  outstanding tracking.

---

## 2. Technology stack

| Layer | Technology | Role in the system |
|---|---|---|
| Runtime | Node.js 20 (bookworm-slim) | Backend execution environment |
| API framework | Express 4.18 | Routing, middleware pipeline |
| ORM | Sequelize 6.37 | Models, associations, transactions |
| Database | PostgreSQL 18 | Relational store, 45 tables |
| Driver | pg 8.11 | Connects over Unix socket |
| UI library | React 18.2 | SPA, hooks, context |
| Build tool | Vite 5.4 | Dev server, HMR, API proxy, bundling |
| Routing | react-router-dom 6.21 | Client routes, role guards |
| HTTP client | axios 1.6 | Interceptors attach the JWT |
| Real-time | socket.io 4.8 | Role-room event broadcast |
| Auth | jsonwebtoken 9, bcryptjs 2.4 | Stateless sessions, cost-12 hashing |
| Hardening | helmet 8, express-rate-limit 8 | Security headers, CSP, throttling |
| Validation | express-validator 7.3 | Request body sanitisation |
| Documents | pdfkit 0.14, exceljs 4.4 | Prescription slips, reports, exports |
| Encoding | qrcode, react-barcode | Patient wristbands, slip identifiers |
| Charts | recharts 3.8 | Dashboard analytics |
| Uploads | multer 2.1 | Patient document attachments |
| Containerisation | Docker Compose | Two-service local and server topology |
| CI/CD | Jenkins | Declarative pipeline, build and deploy |

---

## 3. Architecture

A conventional three-tier split. The React SPA never contacts the API host directly — Vite
proxies `/api` and `/socket.io` to the backend, so the browser sees a single origin and CORS
never enters the picture in normal operation.

```
Browser (React 18 SPA)
        |  HTTP
        v
Vite dev server  :4999 -> published on :4999
  proxies /api and /socket.io
        |
        v
Express API :5001
        |
        v
Middleware chain
  helmet -> CORS -> body parse -> rate limit -> audit
        |
        v
29 route modules / 248 endpoints
        |
        v
Sequelize ORM (46 models)
        |  Unix socket
        v
PostgreSQL 18 (45 tables)

Routes also emit -> socket.io role rooms -> pushed to Browser
```

The database connection is a Unix socket, not a TCP port — PostgreSQL listens on no network
interface at all.

### Middleware order

Order is load-bearing. Security headers apply before anything can respond; the auth limiter is
mounted on the login paths *before* the general API limiter so credential stuffing is throttled
harder than ordinary traffic; audit logging sits ahead of the routes so it captures every
request including rejected ones.

| # | Middleware | Effect |
|---|---|---|
| 1 | `helmet` | Security headers + CSP (`defaultSrc 'self'`) |
| 2 | `cors` | Origin allowlist from `CORS_ORIGIN`, credentials enabled |
| 3 | `express.json` | Body parsing |
| 4 | `authLimiter` | 20 requests / 15 min on login and forgot-password |
| 5 | `apiLimiter` | Global throttle on `/api` |
| 6 | `auditLogger` | Writes to `hms_audit_logs` |
| 7 | `protect` | JWT verification, loads `req.user` |
| 8 | `checkPermission` | Per-module, per-action authorisation |

---

## 4. Repository structure

```
Dhairya-skyeye-HMS/
├── backend/                     Express API — 14.5K lines
│   ├── routes/                  29 modules, 248 endpoints
│   │   ├── auth.js              login, JWT issue, password reset
│   │   ├── patients.js          registration, UHID, search
│   │   ├── doctor.js            consultation workspace
│   │   ├── ipd.js               admissions, wards, beds, notes
│   │   ├── pharmacy.js          stock, batches, GRN, dispense
│   │   ├── pharmacist_lms.js    dispensing, OTC sales
│   │   ├── billing.js           bills, advances, payments
│   │   ├── lab.js               order queue, results
│   │   ├── security.js          permissions, sessions, policy
│   │   ├── reports.js           analytics, audit reporting
│   │   ├── dashboard.js         role-specific aggregates
│   │   ├── admin.js             hospital profile, masters, staff
│   │   ├── users.js             staff account management
│   │   ├── receptionist.js      front-office workflows
│   │   ├── suppliers.js         supplier master
│   │   ├── pdfRoutes.js         PDF generation
│   │   └── hms/                 clinical sub-domain
│   │       ├── encounters.js       prescriptions.js    vitals.js
│   │       ├── appointments.js     tokens.js           diagnoses.js
│   │       ├── departments.js      doctors.js          icd10.js
│   │       ├── medicines.js        restForms.js
│   │       └── investigationOrders.js
│   ├── models/                  46 Sequelize models
│   ├── middleware/
│   │   ├── auth.js              protect / restrictTo / checkPermission
│   │   └── auditLogger.js       request-level audit capture
│   ├── utils/
│   │   ├── encryption.js        AES-256-CBC for sensitive identifiers
│   │   ├── auditLogger.js       logAction() helper
│   │   ├── seedPermissions.js   role x module matrix seed
│   │   ├── seedUsers.js         initial staff accounts
│   │   ├── settings.js          runtime security policy
│   │   └── clobToString.js      large-text field handling
│   ├── migrations/              schema evolution scripts
│   ├── uploads/                 patient document storage
│   ├── server.js                bootstrap, route mounts, socket.io
│   ├── startup.sh               DB readiness gate, then boot
│   └── Dockerfile
│
├── frontend/                    React SPA — 31K lines
│   └── src/
│       ├── pages/               78 files
│       │   ├── LoginPage.jsx           DashboardPage.jsx
│       │   ├── PatientJourneyPage.jsx  SearchPage.jsx
│       │   ├── RegisterPatientPage.jsx ReportsPage.jsx
│       │   ├── AdminDashboardPage.jsx  AdminSettingsPage.jsx
│       │   └── hms/             opd / doctor / lab / pharmacy
│       │       │                ipd / billing / admin / patients
│       │       ├── RoleDashboard.jsx
│       │       ├── PermissionMatrixPage.jsx
│       │       ├── UserManagementPage.jsx
│       │       ├── StaffManagementPage.jsx
│       │       └── SecurityPage.jsx
│       ├── components/          19 — dashboards, modals
│       ├── context/
│       │   ├── AuthContext.jsx     session, role, token
│       │   ├── SocketContext.jsx   socket lifecycle
│       │   └── ThemeContext.jsx    light/dark preference
│       ├── api/axios.js         base URL + JWT interceptor
│       ├── App.jsx              route tree, role guards
│       └── main.jsx             entry point
│
├── deploy/                      env templates, DB init SQL
├── docker-compose.yml
├── Jenkinsfile                  declarative pipeline
└── final_hms_schema.sql         authoritative schema
```

---

## 5. Backend design

Routes are organised by **actor** at the top level (`doctor`, `receptionist`, `lab`, `pharmacy`)
and by **clinical entity** under `routes/hms/` (`encounters`, `prescriptions`, `vitals`). The two
schemes coexist deliberately: actor routes assemble screen-shaped payloads for a specific
dashboard, while entity routes expose normalised CRUD reused across screens. This is a
backend-for-frontend split.

### Route inventory

| Module | Lines | Endpoints | Responsibility |
|---|---:|---:|---|
| ipd.js | 1,315 | 34 | Admissions, ward/bed state, nursing & progress notes, MAR |
| patients.js | 983 | 17 | Registration, UHID, demographics, documents, search |
| doctor.js | 899 | 16 | Consultation workspace, diagnosis, orders |
| pharmacy.js | 848 | 13 | Stock, batches, purchase orders, ledger |
| reports.js | 826 | 10 | Operational analytics, audit reporting |
| security.js | 712 | 34 | Permission matrix, sessions, security policy |
| dashboard.js | 505 | 7 | Role-specific aggregate metrics |
| pharmacist_lms.js | 474 | 11 | Dispensing, OTC sales, batch selection |
| hms/prescriptions.js | 444 | 6 | Prescription header and line items |
| billing.js | 417 | 9 | Bills, GST, advances, payments |
| hms/appointments.js | 408 | 3 | Scheduling and slot management |
| receptionist.js | 402 | 7 | Front-office workflows |
| pdfRoutes.js | 384 | 2 | PDF document generation |
| admin.js | 345 | 15 | Hospital profile, masters, staff |
| hms/medicines.js | 329 | 6 | Medicine master and lookup |
| auth.js | 321 | 7 | Login, lockout, password reset |
| users.js | 299 | 9 | Staff account management |
| lab.js | 288 | 9 | Investigation queue and results |
| hms/encounters.js | 249 | 5 | Encounter lifecycle |
| hms/tokens.js | 189 | 5 | OPD token queue |
| hms/restForms.js | 158 | 5 | Rest/fitness certificates |
| hms/vitals.js | 96 | 3 | Vitals capture |
| hms/investigationOrders.js | 78 | 2 | Order creation |
| hms/doctors.js | 69 | 3 | Doctor master |
| suppliers.js | 69 | 4 | Supplier master |
| hms/departments.js | 51 | 3 | Department master |
| hms/diagnoses.js | 44 | 2 | Diagnosis records |
| hms/icd10.js | 38 | 1 | ICD-10 code lookup |

### Transaction discipline

Multi-table writes are wrapped in Sequelize transactions — **149 usages** across the route
layer. This matters most where a single user action mutates several tables at once: dispensing
decrements a batch, appends to the stock ledger, updates the prescription item and touches the
bill. Either all of it lands or none does.

### Query strategy

Two approaches sit side by side. Simple entity access goes through Sequelize model methods;
reporting and multi-join reads drop to `sequelize.query()` for control over the SQL.

Dynamic filters are built by concatenating *static* SQL fragments that carry named bind
parameters, with values supplied through `replacements` — so user input never reaches the query
string. Numeric inputs that must be interpolated (e.g. `LIMIT`) are clamped through
`parseInt` + `Math.min`/`Math.max` first.

---

## 6. Data model

45 tables, uniformly `hms_`-prefixed, clustering into eight domains. Patient identity is the
hub: `hms_patients` is referenced by encounters, prescriptions, orders, admissions and bills
alike.

| Domain | Tables | Members |
|---|---:|---|
| Identity & access | 3 | `users`, `permissions`, `audit_logs` |
| Patient record | 6 | `patients`, `allergies`, `chronic_conditions`, `patient_documents`, `referrals`, `vitals` |
| Scheduling & OPD | 5 | `tokens`, `appointments`, `departments`, `doctors`, `encounters` |
| Clinical | 5 | `diagnoses`, `prescriptions`, `prescription_items`, `rest_forms`, `progress_notes` |
| Diagnostics | 3 | `investigation_orders`, `investigation_order_items`, `test_reports` |
| Pharmacy | 10 | `medicines`, `medicine_batches`, `stock_ledger`, `suppliers`, `purchase_orders`, `purchase_items`, `dispensing_records`, `dispensing_items`, `otc_items`, `otc_sales` |
| Inpatient | 7 | `admissions`, `ipd_requests`, `wards`, `beds`, `nursing_notes`, `mar_records`, `ipd_vitals` |
| Revenue | 6 | `bills`, `bill_items`, `payments`, `patient_advances`, `tariffs`, `hospital_profile` |

### Identifier conventions

Models declare uppercase identifiers (`tableName: 'HMS_USERS'`, `field: 'USERNAME'`), which
resolve correctly because the connection sets `quoteIdentifiers: false` — unquoted identifiers
are folded to lowercase by PostgreSQL and match the underlying tables.

---

## 7. Security & access control

### Authentication

Username and password are posted to `/api/auth/login`. The account is checked for active
status, lockout window and maintenance mode before the password is compared with bcrypt at
**cost 12**. Failures increment a counter; five failures lock the account for 15 minutes.
Success issues a JWT signed with `JWT_SECRET`, default expiry 8 hours.

There is no fallback secret — a missing environment variable fails loudly rather than signing
with a guessable default.

### Authorisation — three tiers

1. **`protect`** — verifies the bearer token, loads the user, rejects unauthenticated requests.
2. **`restrictTo(...roles)`** — coarse role gate for routes belonging to a single actor.
3. **`checkPermission(module, action)`** — fine-grained lookup against the permission matrix.

The third tier is the substantive one. `hms_permissions` stores a row per *role × module* with
four flags — `can_read`, `can_write`, `can_edit`, `can_delete` — and the middleware resolves the
required flag at request time. Permissions are editable at runtime through the admin
**Permission Matrix** screen, so access policy is data rather than code. `super_admin` and
`admin` short-circuit the check.

### Defence in depth

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost 12, hashed in a Sequelize lifecycle hook |
| Brute-force | Account lockout (5 attempts / 15 min) + IP rate limit (20 / 15 min) |
| Transport headers | helmet with explicit CSP directives |
| Injection | Named bind parameters; numeric inputs clamped via `parseInt` |
| Input sanitisation | `express-validator` trim and escape |
| Identifier encryption | AES-256-CBC with a per-record random IV |
| Audit trail | `hms_audit_logs` — actor, action, module, record, IP |
| Maintenance mode | Runtime policy locking out all roles except `super_admin` |

Audit logging operates at two levels: request-level middleware across `/api`, plus explicit
`logAction()` calls at decision points — including failed logins, recording the reason
(inactive account, lockout, maintenance) alongside the IP.

---

## 8. Clinical workflows

### Outpatient journey

```
Registration (UHID issued)
    -> OPD token queued
    -> Vitals recorded
    -> Consultation (encounter opened)
         |-> ICD-10 diagnosis ------------------\
         |-> Prescription -----> Pharmacy dispense -> Bill
         \-> Investigation order -> Lab queue -> Result
                                                   |
                                    (returns to consultation)
```

Lab results return to the consultation rather than terminating — the doctor is notified over
the socket channel when a result is released.

### Dispensing and stock control

Pharmacy is the most operationally demanding module. Stock is tracked per **batch**, each with
its own expiry date, and dispensing selects batches by **FEFO — First Expiry, First Out**
(`ORDER BY EXPIRY_DATE ASC`), the correct strategy for perishable pharmaceutical inventory.
Every movement writes to `hms_stock_ledger`, giving an append-only history that can be
reconciled against on-hand quantity.

```
Prescription item
    -> batches available?
         no  -> flag out of stock
         yes -> select by FEFO (earliest expiry)
                 -> decrement batch          \
                 -> append to stock ledger    | one transaction
                 -> record dispensing item    |
                 -> add to bill              /
                 -> emit stock_updated + billing_updated (after commit)
```

### Inpatient

An IPD request is raised from consultation, an admission allocates a bed within a ward, and the
stay accumulates nursing notes, progress notes, IPD vitals and MAR (medication administration
record) entries. Bed state is held in `hms_beds` so occupancy is queryable in real time rather
than derived.

---

## 9. Frontend design

A single-page React application: 78 page components and 19 shared components. State is handled
with hooks and three React contexts — no Redux — which suits an app where most state is
server-owned and fetched per screen.

- **AuthContext** — holds the session, decodes the JWT for role and expiry, exposes login and
  logout, and gates routes.
- **SocketContext** — owns the socket connection lifecycle and joins the role room on connect.
- **ThemeContext** — light and dark theme preference.

`api/axios.js` centralises HTTP: a configured base URL plus an interceptor that attaches the
bearer token to every request, so no page component handles auth headers.

Pages are grouped by role under `pages/hms/` — `opd`, `doctor`, `lab`, `pharmacy`, `ipd`,
`billing`, `admin` — mirroring the backend's actor-oriented routes, so a feature is traceable
across both tiers by name.

`RoleDashboard.jsx` dispatches to the correct dashboard on login, and `PatientJourneyPage.jsx`
assembles the longitudinal record — every encounter, prescription, order and bill for one
patient in a single timeline.

---

## 10. Real-time layer

socket.io runs on the same HTTP server as the API. On connect a client emits `join_role` and is
placed in a room named for its role; the server then addresses whole job functions with
`io.to(role).emit(...)` rather than tracking individual sockets.

| Event | Emitted when | Delivered to |
|---|---|---|
| `lab_status_change` | An investigation order changes state | doctor |
| `lab_result_ready` | A result value is released | doctor |
| `stock_updated` | Medicine is dispensed | pharmacist |
| `billing_updated` | A charge is added to a bill | receptionist |

This is the correct granularity for the domain: a doctor cares that *a* result is ready, and
the pharmacy counter cares that stock moved. Rooms keyed by role express that directly and keep
client subscription logic trivial.

---

## 11. Deployment

Two containers: the Express API and the Vite-served frontend. The database runs on the host and
is reached over its **Unix socket**, bind-mounted into the API container — so PostgreSQL binds
no network interface and needs no firewall exception.

| Service | Image | Port | Notes |
|---|---|---|---|
| hms-backend | node:20-bookworm-slim | 5001 | Healthcheck on `/api/health`; `startup.sh` gates boot on DB readiness |
| hms-frontend | node + Vite | 4999 -> 4999 | Proxies `/api` and `/socket.io` to the backend |
| PostgreSQL 18 | host service | socket | No TCP listener; `pg_hba` scoped to the `hms` database |

### Startup sequencing

`startup.sh` polls the database up to 20 times at 3-second intervals before starting the server,
then runs idempotent initialisation — departments, wards, users and permissions are seeded only
when absent. This makes a cold start on an empty database a single command.

### Local run

```bash
docker compose up -d
# frontend  http://localhost:4999
# API       http://localhost:5001/api/health
```

### Pipeline

The Jenkins declarative pipeline runs:

```
Checkout
  -> Environment Setup
  -> Install Backend Dependencies
  -> Install Frontend Dependencies
  -> Deploy   (docker-compose build --no-cache, then up -d)
```

Deploy removes conflicting containers by name first to survive cross-project name collisions.

---

## 12. Methodologies & patterns

| Pattern | Where it appears |
|---|---|
| Layered architecture | Routes -> middleware -> ORM models -> database, with no layer skipping |
| RBAC with runtime policy | Permission matrix stored as data and editable through the UI |
| Middleware chain of responsibility | Express pipeline; each concern isolated and independently ordered |
| Active Record via ORM | Sequelize models own persistence and lifecycle hooks (password hashing) |
| Unit of work | Transactions around multi-table clinical and financial writes |
| Append-only ledger | `hms_stock_ledger` as the authority on inventory movement |
| Audit logging | Cross-cutting middleware plus targeted `logAction()` calls |
| Publish/subscribe | socket.io rooms keyed by role |
| Idempotent seeding | Initialisation that is safe to re-run on every boot |
| Environment-based config | `dotenv`; no credentials in application code |
| Backend-for-frontend shaping | Actor routes return screen-shaped aggregates; entity routes stay normalised |
| Containerised delivery | Compose topology identical in local and server deployment |

---

## 13. Known gaps

An accurate report names what is missing as plainly as what is present.

| Gap | Severity | Detail |
|---|---|---|
| Secrets in version control | Critical | `deploy/local.env` is tracked from the initial commit with a live DB password, JWT secret and encryption key. Present in git history. |
| Test coverage expansion | Medium | Critical flows are smoke-tested via `smoke_critical_flows.js`; full unit test coverage suite remains to be expanded. |

---

*Compiled by reading the source and schema directly. Line counts, endpoint counts
and table names are measured, not estimated.*
