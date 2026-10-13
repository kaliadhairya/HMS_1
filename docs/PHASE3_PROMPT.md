# Prompt: HMS_1 Phase 3, medication safety and nursing

Paste this into Codex. Phase 2 is being built in parallel by Claude.

---

You are building **Phase 3 (medication safety and nursing)** of HMS_1, a
hospital management system (Node/Express + Sequelize + PostgreSQL, React/Vite,
Docker Compose). The main folder is `~/Desktop/projects all i made/HMS_1`.
Claude is building Phase 2 in that folder at the same time. **You must work in
your own git worktree and follow `~/Desktop/projects all i made/HMS_1/docs/PARALLEL_WORK.md` exactly (read it from the main folder: your worktree may not contain it).**

## Before writing any code

1. **Read** `docs/PARALLEL_WORK.md`, which sets your folder, branch, migration
   numbers, ports, file ownership and deployment rules. Then read `AGENTS.md`,
   `docs/phase1/README.md` and the blueprint
   `~/Desktop/HMS_1_Clinical_Architecture_Blueprint.md`, especially:
   - section 1.4: findings F05, F06, F07, F08, F14, F17;
   - section 2.2: the Pharmacy, Nursing/e-MAR and CDS rows, and the FEFO note;
   - section 3.4: entities;
   - section 3.6: the stock rows;
   - section 3.8: the Dispense and Administer commands;
   - section 4.2: the medication cycle;
   - section 5.3: the CDS/medication, Inventory and e-MAR acceptance scenarios.
2. **Create your worktree and claim it in `AGENTS.md`:**
   ```bash
   cd "~/Desktop/projects all i made/HMS_1"
   git worktree add "../HMS_1-phase3" -b phase3/medication-safety phase1/integrity-foundation
   ```
   Add a "Phase 3 (Codex)" heading in `AGENTS.md` with what you are doing. The
   main folder's STOP notice is about Phase 2's files, so keep to your own
   (section 3 of `PARALLEL_WORK.md`).
3. **Inspect the current medication code** before designing anything:
   - **Prescriptions.** `routes/hms/prescriptions.js` and its items have no
     medicine reference: items are free text, and editing deletes and
     re-creates them. A `PATCH` can change status on its own.
   - **Dispensing.** `routes/pharmacy.js` (the dispense handler) and
     `routes/pharmacist_lms.js` (the alias routes). Dispensing locks stock
     batches but can skip reconciling prescription lines.
   - **Stock.** `routes/hms/medicines.js` holds the catalogue and batches.
     `HMS_MEDICINE_BATCHES` and `HMS_STOCK_LEDGER` carry FEFO picking and
     expiry checks.
   - **MAR.** The `/api/ipd/mar` handlers in `routes/ipd.js` create
     administrations from free text. Phase 2 owns that file, so do not edit it.
   - **Allergy checks.** These match text in the frontend
     (`frontend/src/pages/hms/consultation/allergySafety.jsx`), and an empty
     list is shown as "No known allergies".
   - **Controlled drugs.** Only an `IS_CONTROLLED` flag exists; there is no
     workflow.

## Foundations you must use (Phase 1)

- **Schema.** Change it only through new files in `backend/migrations/`,
  numbered **0030–0049** for you. Every new `hms_` table needs foreign keys,
  CHECK constraints and an audit trigger (`audit.capture_change`). Run
  `backend/scripts/verify-migrations.sh` on PostgreSQL 16 and 18.
- **Roles.** Every endpoint gets an explicit role check (`restrictTo` or
  `checkPermission`). That check is also what runs the idempotency guard.
- **Commands.** Add every command path to the `REQUIRED` list in
  `backend/utils/idempotency.js`. That file is shared: append to the list
  only. The claim, your queries, the audit entry and the stored response then
  commit as one transaction. Never call `sequelize.transaction` in a way that
  escapes it.
- **Notifications.** Use `publish()` from `utils/outbox.js` inside the domain
  transaction. Never call `io.emit`.
- **Settings.** Use `utils/settings.js` `saveSetting`, never module-level
  state.
- **Clinical content.** Never invent dose limits, interaction rules,
  high-alert lists or allergy cross-reactivity data (blueprint 3.4 and 5.4).
  Build them as configuration with provenance and an effective date, and
  leave them **empty**. When content is missing, show "check unavailable" or
  "coverage incomplete" and require pharmacist review. Never show a false
  "no issues".

## Build (blueprint 3.4, 3.6, 3.8 and 4.2)

1. **Medication products.** Model products, ingredients, product ingredients
   and formulary entries: strength or concentration, dose form, route, pack
   units, base unit and conversion, restrictions and effective dates.
   - Back-fill from `HMS_MEDICINES` deterministically. Quarantine anything
     ambiguous; never guess.
   - Catalogue changes never rewrite historical orders.
2. **Medication orders.** Orders and versions get stable order IDs and must
   reference a product or ingredient. They carry dose and unit, route, a
   structured frequency, start and end, and for PRN orders the indication and
   maximum dose.
   - Sign, hold, resume, discontinue and amend are separate commands, each
     with a role check and a transition guard.
   - Edits use expected versions: `If-Match`, answering 428 when it is missing
     and 412 when it is stale.
   - A signed order is never overwritten; an amendment creates a new version.
   - Existing free-text prescription lines stay readable as legacy and are
     linked only where the match is certain.
3. **Allergies.** An `AllergyIntolerance` records a coded substance where
   possible plus the clinician's text, with clinical and verification status.
   The patient's review state is separate from the list: *unknown*,
   *not reviewed* or *reviewed: none known*. Never show "No known allergies"
   for an empty list.
4. **Server-side CDS when an order is signed.** Assess allergy (ingredient
   level), duplicate therapy, interactions and dose/route/age/weight/renal
   context against **versioned rule packs**, which ship empty.
   - Record the input snapshot, the rule version, the findings, the declared
     coverage, and any override with its reason and reviewer.
   - Orders for unsupported medicines, or with missing decision-critical
     context, go to pharmacist review.
5. **Pharmacist verification.** Verification is a task tied to an exact order
   version: verify, or ask for clarification.
6. **Dispensing.** Dispense against stable order-line IDs only, and verify
   product, strength, form and route. Substitution must be authorized.
   - Partial dispensing leaves a quantified remaining balance.
   - Discontinuing an order blocks future dispensing but keeps what was
     already supplied.
   - Dispensing locks in a fixed order (order, then billing account if
     needed, then stock balances), and the dispense, the stock movement and
     the charge commit together.
   - No overfill and no negative stock (blueprint 3.8).
7. **Stock.** Stock locations, plus a lot status: available, quarantined,
   recalled or expired. Only available stock can be picked, in FEFO order
   with receipt order breaking ties.
   - Add ward requisitions (request, approve, pick) and transfers: stock is
     in transit until the receiving ward acknowledges it.
   - Returns go to quarantine, and the financial credit is handled separately.
   - Opening stock and receipts must keep manufacturer lot and expiry
     provenance. Phase 0 already requires it.
8. **eMAR, in a new route file.**
   - Administration schedules are generated only from verified order
     versions.
   - Record one completed administration per scheduled occurrence. Keep the
     actual time apart from the recorded time, and record the performer and
     the scan evidence (patient wristband and product barcode). There is a
     documented manual fallback when scanning fails.
   - A dose that is not given records held, refused or omitted, with a reason
     and an escalation.
   - PRN occurrences are explicit and enforce their limits.
   - Before administering, recheck that the order is still active and not
     held.
   - A network timeout after giving a dose must leave a *pending
     documentation* state and **never** invite a repeat dose. Idempotency keys
     already help; the UI must also say so.
   - A completed administration is never deleted; corrections are linked
     records.
   - When the new eMAR works, write `docs/requests/phase3-retire-old-mar.md`
     so Phase 2 removes the old `/api/ipd/mar` handlers.
9. **Controlled drugs.** Keep a register of supply, administration, return
   and wastage, each with a witness. Shift counts are reconciled, and any
   discrepancy opens a case that must be investigated and closed.
10. **Nursing handover.** SBAR handover with outstanding tasks. Responsibility
    transfers only when the receiving nurse acknowledges it.
11. **Frontend.** Update prescribing (consultation), pharmacist verification,
    dispensing, stock, requisitions, eMAR and controlled drugs.
    - Show save state clearly: saving, saved, failed, conflict, stale.
    - Alerts must not rely on colour alone.
    - Do not pre-fill doses unless they come from an approved order set.
    - Do not report success before the server confirms.

## Prove it

1. **Tests.** Write the blueprint 5.3 acceptance scenarios as e2e or
   integration tests:
   - **CDS:** unknown allergy status, missing weight, uncovered medicine,
     wrong strength, duplicate therapy, approved override, held or
     discontinued order.
   - **Inventory:** concurrent receipt of a new lot, duplicate GRN, dispensing
     from several counters at once, expired/quarantined/recalled stock,
     partial fills, return quarantine, fractional units.
   - **eMAR:** wrong patient or product, duplicate submission, PRN limits,
     held or refused dose, late documentation, witness requirement, network
     failure after the dose was given.
   - Concurrency tests must use real PostgreSQL with several connections.
2. **Regression.** Run every existing suite. All must pass, except the two
   known IPD billing steps (Phase 5). Run `npm test`, the
   `HMS_TEST_DATABASE=true` integration test and `verify-migrations.sh`.
3. **Exit criteria.**
   - Every administration traces back to an authorized, verified order.
   - Wrong-patient, wrong-product and discontinued-order cases are blocked.
   - The stock journal reconciles with the balances.
   - The controlled-drug witness and discrepancy workflows pass.
4. **Report.** Write `docs/phase3/README.md` covering what changed, how it was
   verified (real commands and results), and what is not done. Do **not**
   deploy to the shared Docker app; report to the owner, who decides the
   merge and deployment (`PARALLEL_WORK.md` section 5).
   - Never claim a test pass, deployment or evidence file you have not
     checked.
   - Commit in small steps, with clear messages, on
     `phase3/medication-safety`.
