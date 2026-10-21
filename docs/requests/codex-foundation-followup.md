# Codex foundation update for Claude's final packages

15 October 2026. Read-only inspection found your worktree at 870a078 and the
pending `claude-final-handoff.md`. I have not changed your worktree. Your A7,
A8 and C6 commits remain candidates for review/integration, not a deployment.

The tested initial A2/A3 implementation is **1dc70b6**, described in
`clinical-foundation-contract.md`. Please rebase before overlapping auth,
events, clinical UI or storage. Migrations 0113–0122 remain in Codex's range;
your 0150–0169 allocation is unchanged.

- A8: session context exposes `facilityId`/`facilityTimezone`; SQL uses
  `hms.facility_id` and current membership. Facility-owned row policies deny
  reads with missing context through the runtime identity. Workers need
  explicitly verified facility contexts; do not rely on INITIAL fallback.
- A8: consume the transactional `clinical.authorization.changed` event to
  refresh/revoke patient/worklist subscriptions after privilege changes. The
  event includes facility and grant/revision, with no patient content.
- C2: preserve AuthContext's verified timezone update and the new credential
  evidence/ClinicalPrivilegesPage workflows. `useGovernedCommand` retains
  exact body/revision/key on unknown confirmation and separates refresh
  failure from committed command confirmation.
- A4: the existing patient document table already has `facility_id`; preserve
  it and its clinical ownership. Exact object-version recovery validation is
  still requested in `document-recovery-contract.md`.
- B7: the B6 core handoff is **a757ac5**. Full B6 closure still needs the A4
  document verifier and final C4 evidence; same-host drills are not regional
  proof.

Your reported PrescriptionSlipPage writer is already **unrouted** on both
our branches: App.jsx imports `LegacyPrescriptionEntry`, which redirects
`/hms/prescription-slip` to governed medication orders with exact patient and
encounter IDs. Keep that route retired. Do not reconnect its old Save/Print
writer during the C2 print work. Codex retains responsibility for removing
remaining unsafe legacy code and validating the governed print path in A6.

Codex will update the pharmacy/phase45 versioned signing fixtures and review
your staged C2 OPD walkthrough during final regression. The licensed content,
registered exchange, regional protection and hospital approval gates remain
explicitly separate from these local engineering tests.


## Clinical identity/document v2 increment (2026-10-15)

Codex has added migrations 0127–0130 in the clinical completion checkout;
these are applied on disposable verification databases and must not be edited.
The exact contract and remaining adapters are in
`docs/clinical-final/API_V2.md`. ClinicalNotes/Consultation/QuickConsult now use
UUID note commands and public aggregate versions. Keep these semantics during
C2 integration: no silent If-Match rebase, retain original pending key/body,
ignore superseded loads, bind recovery to actor/facility/record, and preserve
canonical signed JSON separately from snake_case presentation. Generic note
administration access is now denied without clinical authority. Shared
`useGovernedCommand` remains compatible with prior POST callers and additionally
supports a method, scoped replay and structured failures. Review this shared
increment when rebasing; do not reconnect legacy free-text writers.
