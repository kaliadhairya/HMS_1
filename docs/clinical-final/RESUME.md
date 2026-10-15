# Active clinical completion checkpoint

Goal remains active: finish all 16 Codex-owned packages in
`docs/CLINICAL_COMPLETION.md`, against the Industrial HIS clinical blueprint.
Mission Control is excluded. No shared deployment or hospital pilot.

## Current state

Branch `completion/clinical-final`, reviewed code **9408731**. Earlier foundations
584e169; analyzer engineering 92765a8; recovery core a59850b. Migrations through
**0130** have been applied to private test databases. Never edit applied SQL;
continue in 0131–0149. Claude owns 0150–0169 and its separate worktree.

Read `API_V2.md`, `PROGRESS.md`, `DEVICES.md`, `RECOVERY.md` and the authoritative
checklist. B3 is DONE (ENGINEERING); the other Codex packages still have work.
The new clinical API supports patient/encounter/document identity, reads and
commands, shared immutable signing/amendments and generated contracts/client.
It is not the full blueprint 3.10 adapter surface yet.

Final focused checks on code 9408731: v2 core 8/8, v2 documents 7/7, legacy
clinical documents 8/8, consultation/API/browser 7/7, document recovery/browser
4/4; strict types, generation check, build and patch check pass. Registry SQL
5/5 and signature guards 7/7 previously passed each engine, with 5900 matching
legacy schema facts through 0130. C4 must still compare complete permissions,
function bodies and final fresh/upgrade schemas and run the full regression.

## Live private resources at this checkpoint

- Configuration `/home/kalmaf/.local/state/hms-clinical-final/verification.env`
  is mode 0600; do not print keys. Temporary config was cleared by the runtime.
- Current PG16 test copy `hms_p4_final_v2_20261015b` at 127.0.0.1:5434 is cloned
  from own `hms_p4_final_20261014a`. Shared database `hms` is never a target.
- API port 5064 (exec session 18579), Vite 5236 (84798). Verify their current
  handles/processes; never restart merely because an observation times out.
- Previous native PG18 resources under /tmp are no longer asserted live. Rebuild
  a private 55464 environment during required PG18/final verification as needed.
- Private build/log live under the same persistent state directory. Integration
  delivery and device listeners are off in this UI test configuration. New local
  test keys cannot validate old audit checkpoints; never re-sign old history.

## Continue complete Codex scope

1. Complete A3 scheduling/ADT, medication/dispense/e-MAR, laboratory, finance and
   event adapters. Use original UUID/snake_case body + If-Match in receipt hashing;
   lock/check the public aggregate version and call the existing authoritative
   service in the same transaction. Do not silently rebase native revisions.
2. Complete A2 facility/membership administration and switching, remaining
   clinical action/care boundaries and a real restricted runtime role. Preserve
   the production owner/superuser/BYPASSRLS refusal. Complete worker contexts.
3. Strengthen coherent multi-query read snapshots and all mutable clinical
   route scope, then A5 shared observations/nursing/continuity, A6 remaining
   unsafe writer/navigation/date/recovery work, B1 exchange scope and full B4
   departmental contracts, named-owner delivery and external-effect suppression.
4. Finish B5 historical audit key proofs; B6 durable job/protection/object-version
   integration; B8 compatible readiness/draining/releases and supervised workers.
   Complete A1 traceability, C1 full acceptance matrix, C4 regression, C5 hazard
   verifier, C7 rollout gates and C8 reviewed consolidation/handoff.

Claude's worktree `../HMS_1-claude-final` was last observed at **f7f73c2**.
Read only. Inspect its current handoff/commits before assuming package state.
No Claude completion commits have been merged here yet. Coordinate through
`docs/requests/`; the foundation follow-up includes the new v2/scoped-command
semantics to preserve during C2 and A8 integration. Do not edit their checkout.

Real hospital credentials/configuration, licensed content, sandbox approvals,
regional drills and clinical pilots remain genuine external gates; never fill
those with synthetic approval. Finish the authorized engineering work first.
