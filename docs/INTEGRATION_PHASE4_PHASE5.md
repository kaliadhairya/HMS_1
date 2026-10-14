# Phase 4 / Phase 5 integration

Integrated laboratory and revenue-cycle implementations on `integration/phase4-phase5`
in `../HMS_1-phase4-phase5`. Both source branches are ancestors of the combined
branch. The remaining feature and go-live gaps belong to the owner. **No shared
application deployment or shared `hms` migration was performed.**

Source commits: Phase 4 `3eb076e`, Phase 5 `36a1fac`. Merge commits:
`5424925` and `44905ca`. Application regression commit: `247b8a2`; final verification tooling: `7f9c2eb`.
Only `AGENTS.md` conflicted; both phases' records were retained. Source
worktrees and the main checkout remain unchanged.

## Integration changes

The combined API mounts both laboratory and finance endpoints, keeps their
idempotency requirements, and starts the existing finance worker. Frontend
routes retain both sets of workspaces. Migration files 0050–0059 and
0070–0076 are preserved with their original checksums.

The finance acceptance fixtures now order approved synthetic coded laboratory
tests through the existing compatible ordering endpoint. Cancellation sends
the required order revision. The IPD charge test now owns its synthetic
patients, beds and admissions: the first full run exposed its assumption that
a restored admission had no previous charges. That run counted three charges,
not the expected two. The next run caught a synthetic identifier exceeding the
existing 20-character limit; shorter fixture identifiers pass. No clinical or
billing implementation was changed for these fixture corrections.

New `e2e/phase45.e2e.js` verifies eight combined scenarios: exact episode charge
capture and replay, rejection/recollection, concurrent result entry, release,
cancellation reversal deduplication, invoice inclusion, report amendment after
invoice issue, and payment/credit behavior without rewriting clinical evidence.
It checks source identities, invoice contents and journal balance. Synthetic
content and existing prices in these tests do not approve hospital content or
commercial pricing.

## Checked results

Full evidence, timestamps and log hashes: [verification.json](integration-phase45/verification.json).
Private logs and browser evidence: `/home/kalmaf/hms-verification/phase45-20261014T055852Z-7f9c2eb`.

| Check | Result |
|---|---|
| Combined regression, latest results | **All 32 suites have passing latest results**, including 300 named end-to-end steps |
| Original foundation transaction/failure scenarios | 16/16 pass |
| Backend unit tests | 10 pass; database suite skipped here and exercised separately above |
| Laboratory safety, guards, browser, worker | 21/21, 8/8, 6/6, 3/3 |
| Finance and cross-phase integration | 15/15 and 8/8 |
| IPD workflow and IPD charge concurrency | 13/13 and 3/3 |
| PostgreSQL 16 and 18 migrations through 0076 | Both pass; fresh/legacy schemas match across 4,092 facts per engine |
| Phase 4 database → combined | Clinical source IDs preserved; Phase 5 captures pre-existing sources once |
| Phase 5 database → combined | Clinical IDs and existing charges unchanged; unmapped legacy tests enter reconciliation |
| Frontend production build, syntax and whitespace | Pass |

The final full application run passed 31/32 suites: audit verification correctly
rejected checkpoint files left by earlier private database copies. The unchanged
audit suite was rerun on a new clean copy with its own checkpoint directory and
passes 7/7. The integration verifier now refuses a checkpoint directory whose
name does not match the test database; that rejection guard was exercised. All
32 suites therefore have passing latest results, using the full application run
and this targeted environment correction. Earlier failures and the complete
full-run results remain recorded; the stored full-run result is not relabeled
as a single 32/32 run.

The audit suite runs last and deliberately tampers with private history. Its post-test database is not a clean clinical
or demonstration environment.

## Remaining work reserved for the owner

| Area | Remaining gap |
|---|---|
| Clinical integration | Replace old name-only consultation lab ordering and free-text Quick Consult prescribing; finish doctor navigation |
| Clinical governance | Supply and validate approved laboratory/medication content and explicit release privileges; supervise escalation operations |
| Pricing | Replace name-based lab price lookup with governed coded tariff/source identity; approve legacy default prices before go-live |
| Accounting migration | Opening receivables for pre-Phase-5 bills; OTC counter sales journal integration |
| Payments | Actual card/UPI gateway integration and automated settlement feeds |
| Timezones | Resolve the existing IST/UTC appointment/queue day-boundary defect; browser tests use UTC |
| Operations | Deployment approval/backup, worker supervision, clinical go-live gates, and separate Mission Control/fleet recovery work |

Details remain in [Phase 4](phase4/README.md#review-and-integration-gates),
[Phase 5](phase5/README.md#open-items-owner-decisions), and the
[clinical navigation request](requests/phase4-clinical-navigation.md).

## Continue from this branch

Use this worktree and `integration/phase4-phase5` for the remaining fixes; avoid
starting again from either standalone phase branch. Nothing was switched in
another agent's checkout.

For verification, install locked dependencies in `backend`, `frontend` and
`e2e`; restore the newest protected backup into new `hms_p4_p5_*` copies;
apply migrations with `node migrate.js up` outside API startup. Use explicit
`HMS_TEST_DATABASE=true`, private matching authentication material, API 5042,
Vite 5214, `E2E_SECOND_PORT=15442`, a new `AUDIT_CHECKPOINT_DIR` whose final
path component is the test database name, and a separate idle foundation copy selected
by `PHASE4_FOUNDATION_DB_NAME`. Prepare free synthetic beds using
`backend/scripts/phase4-test-fixtures.js` on the throwaway copy. Start the API
with `TZ=UTC` and the frontend against that API. Then run:

```sh
# From backend/, with the isolated environment loaded:
node scripts/verify-phase45-upgrades.js
node scripts/verify-phase45.js
bash scripts/verify-migrations.sh
# Repeat migration verification against a separate PostgreSQL 18 instance.
# From frontend/:
npm run build -- --outDir /tmp/hms-phase45-build --emptyOutDir
```

The combined verifier refuses shared database names and other API/frontend
ports, and rejects a checkpoint directory not named after that database. Its
upgrade verifier creates only its own new throwaway databases and drops them
after the checks. Completed regression databases remain isolated;
all servers started for this integration are stopped after verification.
