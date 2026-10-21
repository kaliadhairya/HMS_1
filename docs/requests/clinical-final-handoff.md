# Completion handoff checkpoints

## `392ff47`: consultation UI overlap available for Claude C2

Rebase `completion/claude-final` onto `completion/clinical-final` at
`392ff47` before changing the overlapping clinical note, consultation or
Quick Consult UI. Preserve these controls:

- Encounter saves/signing send the reviewed `If-Match` revision.
- A lost response retains its request key and snapshot until reconciliation.
- A 412 preserves the draft; comparison is explicit before using a newer
  revision. Successful refresh must not overwrite unrelated order drafts.
- Signed clinical content and linked amendments remain immutable versions.
- Quick Consult uses the loaded revision and separate stable save/sign keys;
  it closes the chart only after the signature is confirmed.
- Initial encounter signing occurs through the encounter command; subsequent
  linked amendments use the clinical-document API.

Checks: consultation save/sign 7/7, generic documents 8/8, coded consultation
UI 5/5, exchange 8/8 with zero official fixture validator errors, existing
FHIR 8/8, patient merge 8/8, frontend build, TypeScript check and fresh/legacy
PG16/PG18 migration equality through 0112 (4727 facts). This is an increment;
A5/B1 and full final-candidate regression remain open.

The runtime artifacts now target Node 24 and PostgreSQL 18 using distinct
new data volumes. Read `docs/clinical-final/RUNTIME_UPGRADE.md` before using
them. No deployment occurred. Do not mount an old PG16 volume into PG18.

## B6 / B7 boundary

**B6 database core ready for B7 engineering: `a757ac5`.** Encrypted logical
export/restore acceptance passes 7/7 on PG16 and PG18. Full-invariant physical
PITR/standby drills pass on both engines. See `docs/clinical-final/RECOVERY.md`
for evidence and actual measurements. Claude may now rebase and build B7 on
these committed scripts. B6 package sign-off remains open for A4 document
verification and final-candidate integration; database-only evidence does
not approve protected regional recovery or clinical go-live.

## A2 / A3 boundary

Facility/privilege and v2 UUID contracts are still in progress. Their
committed conventions will be published in `docs/requests/`. Coordinate
dependent schema/context work before editing shared authentication or DB
binding. Migration reservations remain Codex 0110–0149, Claude 0150–0169.
