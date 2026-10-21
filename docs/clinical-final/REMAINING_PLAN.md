# Remaining work plan (from the clinical completion plan)

**Status 21 October 2026: every item below is engineering-done; see `HANDOFF.md` for the owner
decisions and external gates that remain, and `EVIDENCE_INDEX.md` for the evidence.**

Source: `docs/CLINICAL_COMPLETION.md` (24 packages). Order below is the order of work.
Each item closes only when its code, its acceptance checks and its evidence exist.
Evidence means a clean full pass on the exact commit, in the stated configuration.

## Owner approval required before any of these (not done without it)

- Removing the fake test records from the shared database `hms` (one approved transaction,
  backup already at `~/hms-backups/cleanup-20261020/hms-before-cleanup.dump`).
- Merging to local `main`, pushing to GitHub, and updating the running Docker app.
- Applying the production compose change (runtime role) to the live stack.
- Any step that needs a hospital, a licence, a vendor or a regional environment (listed last).

## Phase 1 — A2 (DONE on `2f2c2a6`: standard pass 68/68; restricted-identity pass 67/68)

1. Ward machines under the restricted identity: the kit fetch and the confirmations read
   through narrow owner-rights functions, like the machine login (migration 0157 is the start).
   Exit: downtime drill passes with the API running as the restricted role.
2. Restricted-role full pass (production configuration). Triage each failure:
   admin reports (401/403), OPD diagnosis steps (ICD release pollution), terminology
   (release left active by an earlier suite). `abdmUse` expects a non-production gateway and
   is run only in the development configuration.
3. Standard owner-account full pass on the final candidate, clean. Then commit this round.
   Exit: A2 closed in `CLINICAL_COMPLETION.md` with the evidence commit.

## Phase 2 — A3 (finish the new API)

4. Admissions, transfers and discharge on the new API, with the same version and
   idempotency rules as scheduling (`services/appointmentV2.cts` is the pattern).
5. Laboratory orders and results on the new API.
6. Finance and billing on the new API (charges, payments, refunds with replay checks).
7. Live updates (events) scoped to the same facility and patient rules as the API.
8. Medication consumers: the browser screens move to the new medication calls.
   Exit: each area has a suite, passes on the restricted identity, and the v2 document
   lists no pending adapter.

## Phase 3 — A5, A6

9. A5: link shared observations into the signed discharge and handover flow, with
   tests that a discharge without the linked signed document is refused.
10. A6: confirm every legacy writer is retired (prescriptions, MAR, lab results, dispensing
    already return 410 or 409); remove the redirect-only screen once no route points to it.

## Phase 4 — A1, B6, B8

11. A1: requirement-to-test inventory (generated from the blueprint section 5.3 and the
    suite names), and CI running the end-to-end suites on the final commit.
12. B6: wire the document-version verifier into the restore path, with a test that a
    restore fails on an altered stored document.
13. B8: Docker stop grace period at least as long as the drain timeout; a supervised
    worker process; a documented rolling-release procedure with a rollback check.

## Phase 5 — C1, C4, C8

14. C1: tests for the three missing scenarios (reset token used as a session; a failed
    downstream service during a command; a connection cut mid-session), and the matrix
    updated to match what the tests prove.
15. C4: fresh and upgrade migrations on PostgreSQL 16 and 18, a full regression on the
    exact final commit, and the evidence index.
16. C8: the handoff report and the status table brought up to date with the evidence.

## Outside our control (listed in the plan, not worked on here)

- ABDM sandbox registration and certification; licensed terminology content.
- A real virus scanner deployment; target-region recovery drills (RPO/RTO).
- Hospital owner reviews, staff rehearsals, language review, supervised pilots.
