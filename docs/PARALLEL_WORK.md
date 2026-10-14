# Parallel work rules (Phases 2, 3 and 4)

Claude works on **Phase 2** and Codex on **Phase 3, then Phase 4**, at the same
time. These rules keep the two from overwriting each other. Read them before
every session.

## 1. Separate folders and branches (git worktrees)

Never switch branches in a folder another agent is using.

| Phase | Agent | Folder | Branch |
|---|---|---|---|
| 2 | Claude | `HMS_1/` (the main folder) | `phase2/patient-journey` |
| 3 | Codex | `HMS_1-phase3/` | `phase3/medication-safety` |
| 4 | Codex | `HMS_1-phase4/` | `phase4/laboratory` |
| 5 | Claude | `HMS_1-phase5/` | `phase5/revenue-cycle` |

Create a worktree once, from the main folder:

```bash
cd "~/Desktop/projects all i made/HMS_1"
git worktree add "../HMS_1-phase3" -b phase3/medication-safety phase1/integrity-foundation
# Phase 4, after Phase 3 is finished and merged (see section 6):
git worktree add "../HMS_1-phase4" -b phase4/laboratory <branch named by the owner>
```

Each worktree needs its own `npm ci` in `backend/`, `frontend/` and `e2e/`.

## 2. Database migration numbers

| Phase | Numbers |
|---|---|
| 2 | `0010`–`0029` |
| 3 | `0030`–`0049` |
| 4 | `0050`–`0069` |
| 5 | `0070`–`0089` |
| 6 (Claude) | `0090`–`0109` |
| 7 / Phase 6 adapters (Codex) | `0110`–`0119` |

- Never edit a migration that is already committed.
- Every new `hms_` table needs foreign keys, CHECK constraints, and an audit
  trigger:
  ```sql
  CREATE TRIGGER trg_audit_<table> AFTER INSERT OR UPDATE OR DELETE ON <table>
    FOR EACH ROW EXECUTE FUNCTION audit.capture_change();
  ```
  `verify-migrations.sh` fails without it.

## 3. File ownership

Edit only the files you own. To change a file you don't own, write a short
request in `docs/requests/<phase>-<topic>.md` and leave the edit to its owner.

| Owner | Files |
|---|---|
| **Phase 2 (Claude)** | `routes/patients.js`, `routes/receptionist.js`, `routes/hms/appointments.js`, `routes/hms/tokens.js`, `routes/hms/encounters.js`, `routes/hms/doctors.js`, `routes/hms/departments.js`, `routes/doctor.js` (referrals and schedule), `routes/ipd.js` (everything except the MAR section), `middleware/auth.js`, `models/Patient.js`, `frontend/src/pages/hms/patients/*`, `frontend/src/pages/hms/opd/*`, `frontend/src/pages/hms/receptionist/*`, ADT pages in `frontend/src/pages/hms/ipd/*` |
| **Phase 3 (Codex)** | `routes/pharmacy.js`, `routes/pharmacist_lms.js`, `routes/hms/prescriptions.js`, `routes/hms/medicines.js`, `routes/suppliers.js`, new files for eMAR and controlled drugs (for example `routes/medication.js`), `frontend/src/pages/hms/pharmacy/*`, `frontend/src/pages/hms/consultation/*` (prescribing and allergy parts) |
| **Phase 4 (Codex)** | `routes/lab.js`, `routes/reports.js` (lab report endpoints), `routes/hms/investigationOrders.js`, `routes/pdfRoutes.js` (lab report PDF), `frontend/src/pages/hms/lab/*`, `frontend/src/pages/ReportPage.jsx`, `frontend/src/pages/SearchPage.jsx` |

**Shared files.** Make the smallest additive edits and nothing else. Never
reformat these files.

| File | Allowed edits |
|---|---|
| `server.js` | Mount new routes only |
| `frontend/src/App.jsx` | Add routes only |
| `models/index.js` | Add models and associations only |
| `e2e/helpers.js` | Append only |
| `docs/`, `AGENTS.md` | Only your own section |

**IPD MAR.** The existing `/api/ipd/mar` handlers live in `routes/ipd.js`,
which Phase 2 owns. Phase 3 builds the new eMAR in a new file. When it is
ready, Phase 3 asks Phase 2 (through `docs/requests/`) to remove or redirect
the old MAR handlers.

## 4. Testing without collisions

Everyone uses the Docker PostgreSQL on port 5434, but each phase has its own
throwaway databases and ports. Never test against the database called `hms`.

| Phase | Test databases | Backend port | Vite port |
|---|---|---|---|
| 2 | `hms_e2e`, `hms_p2_*` | 5002 | 5174 |
| 3 | `hms_p3_*` | 5012 | 5184 |
| 4 | `hms_p4_*` | 5022 | 5194 |
| 5 | `hms_p5_*` | 5032 | 5204 |
| 4+5 integration | `hms_p4_p5_*` | 5042 | 5214 |
| 6 | `hms_p6_*` | 5052 | 5224 |

Copy test data from the newest `~/hms-backups/<timestamp>/hms.dump`, then run
`node migrate.js up` in your own worktree.

- Give the backend and the test runner the same `JWT_SECRET`.
- Run the backend with `TZ=UTC` and `RATE_LIMIT_MAX_AUTH=1000`.
- e2e environment: `E2E_BASE=http://localhost:<vite port>`,
  `E2E_API=http://localhost:<backend port>/api`, plus `DB_*` for your test
  database.
- Start vite with `VITE_BACKEND_TARGET=http://localhost:<backend port>`.

## 5. Deploying

**Nobody deploys a phase branch to the shared Docker app on their own.** The
Docker app (ports 4999 and 5001, database `hms`) shows the owner one
version.

Deploy only after a merge the owner has approved, in this order:

1. Phase 2 is merged and deployed.
2. Phase 3 is rebased on it, merged and deployed.
3. Phase 4 follows the same way.

Always back up first with `scripts/backup-db.sh`.

## 6. Merging

- When a phase is finished, its agent reports to the owner with test evidence.
  The owner decides the merge.
- The later phase rebases onto the merged result and re-runs **all** suites
  before its own merge.
- Phase 4 starts from Phase 3's merged branch, or from Phase 2's if the owner
  prefers. The owner says which.

## 7. Integration points with Phase 2

Phase 2 is building these. Do not build them yourself.

| Topic | Until Phase 2 is merged | After the merge |
|---|---|---|
| Patients and encounters | Keep referencing `hms_patients.id` and `hms_encounters.id`. Phase 2 extends them and does not replace them. | No change |
| Practitioners | Prescribers, verifiers and collectors are `hms_users.id`. Name columns `*_user_id` so they can be mapped later. | Mapped to the new practitioner model |
| Patient scope ("clinicians see only their patients") | Use role checks only. Do **not** add your own patient scoping. | Phase 2's care-team check is applied to your endpoints |
| Bed and admission data | Read it; never change it. | No change |
| Patient banner and identifiers | Use the existing patient fields. | Phase 2 adds a shared patient banner component you can adopt |

## 8. Coordination log

Each agent keeps one line per working session in `AGENTS.md` under its own
heading: date, what it is doing, which files it touched.

Remove your STOP or ownership claim when you finish.

## Clinical completion (owner-authorized solo work, 2026-10-14)

`completion/clinical-final` in `../HMS_1-clinical-final` owns the remaining
clinical integration, verification and readiness work in its own checkout.
Original phase worktrees remain unchanged. See `docs/CLINICAL_COMPLETION.md`.
Migrations 0110–0149; test databases `hms_p4_final_*` / `hms_verify_final_*`;
API 5064, Vite 5236, second API 15544, PG18 55464. No shared deployment.
