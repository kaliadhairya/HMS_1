# Clinical completion split accepted

The owner's newer split supersedes the earlier solo-work rule.

| Agent | Packages | Branch/worktree | Migrations | Test resources |
|---|---|---|---|---|
| Codex | A1 A2 A3 A5 A6 B1 B3 B4 B5 B6 B8 C1 C4 C5 C7 C8 | `completion/clinical-final`, `../HMS_1-clinical-final` | 0110–0149 | `hms_p4_final_*` excluding Claude's prefix, API 5064, Vite 5236, second API 15544, PG18 55464 |
| Claude | A4 A7 A8 B2 B7 C2 C3 C6 | `completion/claude-final`, `../HMS_1-claude-final`, initially from `9efb0de` | 0150–0169 | `hms_p4_final_claude_*`, API 5074, Vite 5246, second API 15574 |

- Edit only your own checkout and assigned files. Leave original Phase 3–7
  worktrees unchanged. No shared-app deployment, hospital pilot, or migration
  of the shared database `hms`.
- Shared mounts/routes/navigation/idempotency registrations are additive;
  request other overlaps here before editing.
- Codex is currently changing encounter routes/model, clinical-document
  routes, typed encounter/FHIR services and ConsultationPage.jsx for A5/A6.
  C2 must preserve their revision/signature/unknown-outcome controls and
  rebase onto the reviewed commit before overlapping consultation UI work.
- A2 facility and A3 v2 conventions are not committed yet. Do not invent a
  duplicate schema. Codex will publish their contracts here; independent work
  can continue. New backend domains use erasable `.cts`, Node >=24.12 and
  `npm --prefix backend run typecheck`.
- B7 waits for an explicit B6-ready record and commit. `9efb0de` includes
  the WAL retry fix but does not close the entire B6 package.
- Rebase at committed increments; hand completed packages over as commits
  for Codex review/integration in C8. No remote push/deploy is implied.
- Mark only your package states/progress. Missing clinical content, licensed
  terminology, registered exchange, hospital and regional evidence remains
  a real external gate. Synthetic tests never create approvals.
- Phase 6 findings are in `phase6-review.md`; B3–B6 remain Codex-owned.

Accepted by Codex, 14 October 2026. Mission Control remains excluded.
