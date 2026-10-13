# Prompt: HMS_1 Phases 2–7

Paste this into the coding agent. Start only once `AGENTS.md` no longer
says STOP (Claude is finishing Phase 1).

---

You are continuing work on HMS_1, a hospital management system (Node/Express
+ Sequelize + PostgreSQL backend, React/Vite frontend, Docker Compose).
Repository: `~/Desktop/projects all i made/HMS_1`.

## Read first

1. `~/Desktop/HMS_1_Clinical_Architecture_Blueprint.md`. This is the target
   architecture. Sections 3–5 define the entities, invariants, workflows and
   acceptance scenarios for every phase below.
2. `docs/phase0/README.md` and `docs/phase1/README.md`. They describe what
   exists and how it was verified.
3. `AGENTS.md`. These are the rules for agents in this repo.

## Foundations already in place (Phases 0–1). Build on them; do not bypass them.

- **Schema.** The schema changes only through numbered files in
  `backend/migrations/`, applied by `node migrate.js up`.
  - Never edit an applied migration. Add a new one.
  - The server refuses to start if a migration is pending.
  - `backend/scripts/verify-migrations.sh` must pass on PostgreSQL 16 and 18.
- **Constraints.** 97 foreign keys plus uniqueness and value rules are in place.
  - New tables need foreign keys, CHECK constraints where they apply, and an
    audit trigger (`audit.capture_change`).
  - CI fails if an application table has no audit trigger.
- **Authentication.** Sessions are server-side (`hms_sessions`), carried in an
  HttpOnly cookie with a CSRF header guard.
- **Authorization.** Every endpoint has an explicit role list
  (`restrictTo`/`checkPermission`). Keep `e2e/authorization.e2e.js` passing,
  and extend it for every new endpoint.
- **Audit.** Every row change is captured transactionally in
  `audit.row_changes`, with hash chains and signed checkpoints. Reads and
  refusals go to `audit.access_events`.
- **Idempotency.** Clinical and financial commands require an
  `Idempotency-Key`. The claim, the domain change, the audit entries, the
  outbox events and the stored response commit in one transaction
  (`utils/idempotency.js`, `models/db.js`). New commands must go through it.
- **Notifications.** Use `publish()` from `utils/outbox.js` inside the
  domain transaction. Never call `io.emit` directly.
- **Settings.** Use `utils/settings.js` (`saveSetting`), never module-level
  variables.

## Working rules

- **Branch.** Work on a branch named `phaseN/<topic>` cut from the latest
  completed phase. Make small commits with clear messages.
- **No invented clinical values.** Do not invent clinical thresholds, dose
  limits, reference ranges, triage rules or drug-interaction content. Model
  them as configuration with provenance and leave them empty until a
  clinician approves them; the feature stays off until then (blueprint 5.4).
- **Test on throwaway databases.** Run tests only against throwaway database
  copies, never the live Docker database or the local `hms` database.
  - The audit tests tamper with history on purpose.
  - The harness pattern: restore `~/hms-backups/<latest>/hms.dump` into a
    database named `hms_e2e` on the Docker PostgreSQL (port 5434), run
    `node migrate.js up`, then start the backend on port 5002 with
    `TZ=UTC RATE_LIMIT_MAX_AUTH=1000` and a `JWT_SECRET` shared with the test
    runner. Run vite on 5174 with `VITE_BACKEND_TARGET=http://localhost:5002`.
- **Prove each phase.** For each phase:
  1. Write the blueprint's acceptance scenarios (section 5.3) as e2e or
     integration tests.
  2. Run every existing suite. All must pass, except the two known IPD
     billing steps until Phase 5 fixes them.
  3. Run `verify-migrations.sh`.
  4. Back up with `scripts/backup-db.sh`, then deploy with
     `docker compose up -d --build`.
  5. Verify the deployment live.
  6. Write `docs/phaseN/README.md` with what changed and how it was verified.
  - Report failures honestly. Do not claim a deployment or evidence file
    that does not exist.
- **Shared repository.** Another agent may share this repository. Check
  `AGENTS.md` before starting, and put a STOP notice there while you work.

## Phase 2: patient journey, identity and ADT (blueprint 3.3, 4.1)

1. **Patient identity.** Separate patient, identifier, contact, guardian and
   coverage records. Support temporary identities for unknown or unconscious
   patients, newborns (age 0), estimated dates of birth, and verified
   identifiers that are unique per issuer. Duplicate review and merge must be
   reviewed, recorded and reversible. Never merge charts automatically on
   name or phone similarity.
2. **Practitioners.** Model practitioner and practitioner-role records
   separately from user accounts, with credentials and validity dates. Expired
   credentials remove the matching privileges.
3. **Scheduling.** Book resource reservations with start and end instants,
   and use an exclusion constraint so active reservations cannot overlap.
   Booking and rescheduling share one atomic path. Queue counters are
   allocated atomically per queue and day.
4. **Emergency.** Add arrival, triage assessment (protocol and version
   stored; content left empty until clinicians approve it), reassessment,
   disposition and transfer responsibility.
5. **Clinical documents.** Store versioned documents with signatures. Signed
   content is immutable; corrections are linked amendments. Edits use
   expected versions: `If-Match`, returning 428 when it is missing and 412
   when it is stale.
6. **ADT.** Record bed occupancy as intervals with an exclusion constraint.
   Transfers close one occupancy and open the next atomically. The bed
   lifecycle is Ready → Reserved → Occupied → Dirty → Cleaning → Ready, plus
   OutOfService. Discharge planning keeps clinical readiness separate from
   financial clearance, and pending results keep a named owner after
   discharge.
7. **Care teams and referrals.** Add care-team assignments, and enforce
   patient scope: clinicians see the patients in their care, and
   break-the-glass access is audited and reviewed. Referrals and handoffs
   need an acknowledgement from the receiving side.
8. **Migrating existing data.** Patients, appointments, tokens, admissions
   and beds move to the new model by expand, backfill, validate, switch, then
   contract (blueprint 5.2). Quarantine ambiguous records; never guess.

**Exit:** 50 simultaneous requests for the same bed or slot resolve
correctly, signed notes resist stale updates, the newborn and
unknown-patient scenarios pass, and transfer and discharge history stays
intact.

## Phase 3: medication safety and nursing (blueprint 3.4, 4.2)

1. **Product catalogue.** Model medication products with ingredients,
   strength, form and route, and keep a formulary. A drug's identity is
   never just its display name.
2. **Medication orders.** Orders are coded and versioned, with stable order
   IDs. Sign, hold, resume, discontinue and amend are explicit commands. Each
   prescription line references a product.
3. **CDS.** Run checks on the server when an order is signed, with declared
   coverage and recorded overrides. Allergy status distinguishes "unknown",
   "not reviewed" and "reviewed, none known". Rule packs stay empty until
   approved.
4. **Pharmacy.** A pharmacist verifies each order before it is dispensed.
   Dispensing is recorded per line with a remaining balance. Lots carry
   location and status (quarantine, recalled). Picking is FEFO. Add ward
   requisitions and in-transit transfers.
5. **eMAR.** The medication administration record has one administration
   per scheduled occurrence, built from verified orders. Record the actual
   versus recorded time, barcode checks with a manual fallback, and a
   hold/refused/omitted reason. PRN orders have limits. A network timeout
   must never invite a repeat administration.
6. **Controlled drugs and handover.** Controlled drugs need a witness,
   counts and discrepancy cases. SBAR handover requires acknowledgement.

**Exit:** every administration traces to an authorized order; wrong-patient,
wrong-product and discontinued-order scenarios are blocked; the stock
journal reconciles.

## Phase 4: complete laboratory loop (blueprint 3.5, 4.3)

1. **Specimens.** Add a test catalogue, then specimens with accession
   barcodes, containers and a custody trail. Support rejection and
   re-collection, and aliquots that keep their lineage.
2. **Results and reports.** Results are versioned. Validation includes an
   analyzer-run and QC record. Release goes through technical review and
   authorized release. Amended reports keep the original.
3. **Reference intervals and critical results.** Keep reference intervals
   separate from critical policies; both stay empty until the lab director
   approves them. A critical result raises a task that escalates until it is
   acknowledged. Discharge does not close it.
4. **One report path.** Unify the legacy report editor with the new flow,
   so there is a single report path.

**Exit:** multi-test specimens and multi-specimen orders work, two writers
cannot overwrite each other, amended reports preserve the original, and
escalation works, including after discharge.

## Phase 5: revenue cycle (blueprint 3.6, 4.4)

1. **Billing account and charges.** Each episode has one billing account.
   Charge events are linked to their source and unique per source (for
   example, one charge per dispense line). Charge-master and package rules
   are versioned.
2. **Invoices and journal.** Issued invoices are immutable; corrections go
   through credit and debit notes. Keep a balanced financial journal that
   only gains entries.
3. **Deposits, payments and refunds.** A deposit is a liability allocated
   under lock, and cannot be over-allocated. Refunds reference real credit
   and an approval. Payment intents can be unknown, which leads to
   reconciliation, never a second collection.
4. **Insurance and reconciliation.** Track coverage, eligibility,
   pre-authorization, claims, remittance and denials. Reconcile cash, bank
   and payer records.
5. **Known failures.** Fix the two IPD billing steps that fail today
   (advance not applied; billing history). Remove the conflict between
   pharmacy-created and IPD bills.

**Exit:** one episode produces a fully itemized, reconciled account; partial
deposits and payer splits work; retries never post twice.

## Phase 6: interoperability and operations (blueprint 3.11, 3.13)

1. **FHIR.** Build a FHIR R4 (4.0.1) boundary aligned with ABDM IG 6.5.0,
   publish a capability statement, and validate profiles.
2. **ABDM.** Implement M1 (ABHA), M2 (HIP linking/export) and M3 (HIU
   consent and import). Consent must be enforceable and revocable, and
   imported data goes through reconciliation.
3. **Terminology.** Manage terminology releases: ICD-10 edition, SNOMED and
   LOINC under proper licences, and coded units.
4. **Adapters.** Build adapters for analyzers, PACS, theatre, blood bank and
   devices. Each adapter needs versioned contracts, an acknowledgement and
   retry policy, inbox deduplication (`utils/inbox.js`) and reconciliation
   queues.
5. **Operations.** Cover point-in-time restore and regional failover drills
   (RPO ≤ 5 min, RTO ≤ 60 min), plus a local downtime kit (read-only
   summaries, paper procedures, reconciliation afterwards).
6. **Audit checkpoint storage.** Ship audit checkpoints to write-once
   storage outside the database administrators' control.

## Phase 7: controlled clinical rollout (blueprint 5.1, 5.4)

Assign a named owner for each clinical policy, and trace every hazard to a
control, a test, a procedure and an owner. Train staff and rehearse. Roll
out to one OPD service first, then one ward, then expand while monitoring
defects. There must be no open P0 defects, and stock and financial
reconciliation must hold.

## Order of work

Start with Phase 2; every later phase depends on its patient, encounter and
care-team model. If the hospital needs inpatient billing sooner, the two IPD
billing fixes from Phase 5 can be pulled forward as a separate branch.
