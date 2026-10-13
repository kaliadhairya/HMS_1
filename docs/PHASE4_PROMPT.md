# Prompt: HMS_1 Phase 4, complete laboratory loop

Paste this into Codex **after Phase 3 is finished** and the owner has said
which branch to start from.

---

You are building **Phase 4 (the complete laboratory loop)** of HMS_1, a
hospital management system (Node/Express + Sequelize + PostgreSQL, React/Vite,
Docker Compose). The main folder is `~/Desktop/projects all i made/HMS_1`.
Other phases may be in progress in parallel. **You must work in your own git
worktree and follow `docs/PARALLEL_WORK.md` exactly.**

## Before writing any code

1. **Read** `docs/PARALLEL_WORK.md`: folder, branch, migration numbers
   **0050–0069**, ports 5022/5194, test databases `hms_p4_*`, file ownership
   and deployment rules. Then read `AGENTS.md`, `docs/phase1/README.md`,
   `docs/phase3/README.md` if it exists, and the blueprint
   `~/Desktop/HMS_1_Clinical_Architecture_Blueprint.md`, especially:
   - section 1.4: finding F09;
   - section 2.2: the Laboratory row;
   - section 3.5: laboratory entities, and the rule that critical results
     must not wait for report sign-off;
   - section 3.8: the "Verify/release result" command;
   - section 4.3: the diagnostic loop and the critical-result steps;
   - section 5.3: the Laboratory and Critical follow-up scenarios.
2. **Create your worktree** from the branch the owner names (Phase 3's
   finished branch, or Phase 2's if the owner prefers):
   ```bash
   cd "~/Desktop/projects all i made/HMS_1"
   git worktree add "../HMS_1-phase4" -b phase4/laboratory <branch named by the owner>
   ```
   Add a "Phase 4 (Codex)" heading in `AGENTS.md`.
3. **Inspect the current lab code** before designing anything:
   - **Orders.** `routes/hms/investigationOrders.js` creates orders and items
     from test names, with no catalogue codes.
   - **Lab workflow.** `routes/lab.js` covers the queue, "samples" and result
     entry. Samples are derived from order items; there are no specimen
     records. Result entry has no release boundary, and two people entering
     results at the same time can overwrite each other.
   - **Abnormal flags.** A simple `abnormalFlag()` compares a value with a
     free-text reference range.
   - **Legacy report editor.** `routes/reports.js` plus
     `frontend/src/pages/ReportPage.jsx` (the original lab module) is a
     second, separately writable report path.
   - **Notifications.** These already go through the outbox:
     `lab_status_change` and `lab_result_ready`.

## Foundations you must use (Phases 1 and 2)

- **Schema.** Change it only through new migrations numbered 0050–0069. New
  `hms_` tables need foreign keys, CHECK constraints and an audit trigger.
  `verify-migrations.sh` must pass on PostgreSQL 16 and 18.
- **Roles and duplicates.** Every endpoint gets an explicit role check, and
  every command path is appended to `REQUIRED` in `utils/idempotency.js`.
- **Notifications.** Use `publish()` inside the transaction; never call
  `io.emit`.
- **Who did what.** Collectors, verifiers and releasers are `hms_users.id`
  (`*_user_id` columns) until Phase 2's practitioner model is merged. Use
  Phase 2's care-team model for "responsible clinician" if it has been merged
  into your base. Otherwise, use the ordering doctor and record that as a
  known limitation.
- **Clinical content.** Never invent reference intervals, critical
  thresholds, QC rules or escalation timetables. They are configuration with
  provenance, versions and effective dates, and they ship **empty**. A test
  with no approved reference interval shows "no reference interval" rather
  than "normal". A test with no approved critical policy never creates a
  critical task automatically.

## Build (blueprint 3.5, 3.8 and 4.3)

1. **Test catalogue.** Test definitions and panels carry stable codes (LOINC
   where licensed and appropriate), specimen requirements, container, the
   performing section, units and price linkage. Existing name-based
   order items are linked only where the match is certain; quarantine the
   rest.
2. **Specimens.** Each specimen has a unique accession or barcode, belongs to
   a patient, and records its collector, collection time, receipt time,
   specimen type, container and location. One specimen can serve several
   tests, and one order can need several specimens (a link table).
   - A custody trail records collected, sent, received and stored events.
   - Rejection needs a reason and a recollection task, and a rejected
     specimen can never count as collected.
   - Aliquots keep their parent/child lineage.
3. **Results.** Results are versioned, and each version keeps the raw value
   and the normalised value and unit, plus the method and the author. The
   analyzer run and QC record are stored too.
   - The lifecycle is: entered → technical review → authorized release. A QC
     failure or a repeat sends a result back to processing.
   - A writer must send the expected version (`If-Match`); answer 412 when it
     is stale, so two writers cannot overwrite each other.
   - Results for different tests on the same specimen can complete at the
     same time without losing the order's completion state.
4. **Reports.** A diagnostic report and its versions record the results
   included and a preliminary, final or amended status.
   - Only someone with that privilege can release a final report.
   - A correction creates an amended report that keeps the original and
     notifies the recipients.
   - **Unify the legacy report editor with this flow**, so there is exactly
     one writable report path. The old one becomes read-only or is
     redirected.
5. **Reference intervals and critical policies.** They are separate, versioned
   tables keyed by test, method, unit and age/sex context. Unit conversion is
   explicit and validated. Keep abnormal flags and critical flags apart.
6. **Critical results.** A verified critical finding, even a preliminary one,
   creates a durable task assigned to the responsible clinician or team.
   - Record each delivery attempt, who received it, the acknowledgement, the
     escalation timetable (configuration, empty by default), and the
     clinical action or documented closure.
   - Opening a report or sending a notification does not complete the task.
   - Discharge does not close it.
   - An amended critical result starts a new communication cycle.
7. **Analyzer adapter contract.** Version the message contract. Match the
   patient and specimen on the accession. Deduplicate incoming messages with
   `utils/inbox.js` `acceptOnce` in the same transaction. Results that cannot
   be matched go to a reconciliation queue. Imported results stay provisional
   until they are validated.
8. **Frontend.** Update the collection worklist with labels or barcodes,
   receipt and rejection, result entry with conflict handling, technical
   review, release, amended reports, the critical-result worklist with
   escalation and acknowledgement, and the doctor's result review.
   - Make missing reference intervals and QC failures visible.
   - Do not report success before the server confirms.

## Prove it

1. **Tests.** Write the blueprint 5.3 scenarios as e2e or integration tests:
   - **Specimens:** mismatch, rejection and recollection.
   - **Messages:** duplicate analyzer messages.
   - **Concurrency:** two writers on one result; analytes on one specimen
     completing at the same time.
   - **Quality:** QC failure, unit mismatch.
   - **Critical results:** a corrected critical result; the recipient
     unavailable; a missed acknowledgement leading to escalation (with a test
     timetable in fixtures, not in production configuration); discharge
     before the result is released; contacting the clinician again after an
     amendment.
   - Concurrency tests must use real PostgreSQL with several connections.
2. **Regression.** Run every existing suite (the two known IPD billing steps
   may still fail), `npm test`, the `HMS_TEST_DATABASE=true` integration test
   and `verify-migrations.sh`.
3. **Exit criteria.**
   - Multi-test specimens and multi-specimen orders work.
   - Concurrent result writes cannot overwrite each other.
   - Corrected reports keep the original.
   - Critical-result escalation and follow-up after discharge are
     demonstrated.
4. **Report.** Write `docs/phase4/README.md` with real evidence. Do **not**
   deploy to the shared Docker app; report to the owner. Commit in small
   steps on `phase4/laboratory`. Never claim a test pass, deployment or
   evidence file you have not checked.
