# Departmental delivery authority (B4)

Engineering acceptance reviewed on 17 October 2026. This is the clinical
interface boundary, not Mission Control provisioning or SaaS policy.

## Implemented contract

Messages bind facility, system, type, version, stable external identity and a
canonical content fingerprint. Duplicate identities with different content are
rejected. Machine intake continues through the unchanged laboratory analyzer
contract v1 and retains its provisional-result/approved-account restrictions.

Outgoing workers claim bounded batches using PostgreSQL leases and monotonic
generations. Provider calls happen outside business transactions. Expired or
replaced workers cannot settle a newer attempt. The current writer and current
approved facility membership are checked before delivery. External effects are
disabled unless explicitly enabled for that environment.

Provider idempotence is an explicit configuration backed by its actual
contract, not an assumption based on an HTTP header. Uncertain non-idempotent
outcomes and messages from an old writer epoch are held for reconciliation.
Known pre-send failures may retry within the bounded budget. A failed series
is immutable; a reviewed retry creates one linked successor with the original
external/delivery identity. Attempt/review evidence is append-only.

Administrators review messages through Interface deliveries. Mutation requires
the observed generation (If-Match), a reason and provider evidence reference.
They can confirm delivery, confirm non-delivery and permit one further attempt,
or suppress replay. Current membership is mandatory even at the service layer.
Lists/mutation results exclude raw payloads. Problems have facility-scoped
worklist owners and can be assigned to named staff using the existing worklist.
Gateway callbacks use an explicit approved service account and facility; caller
headers cannot choose either, and temporary SQL context is restored or rolled
back. Rejected unauthenticated payloads are not stored as clinical messages.

0137/0138 depend on the recovery fence introduced by the parallel migration
range. Pinned dependency metadata preserves applied SQL checksums and orders
fresh/upgrade execution correctly rather than editing historical migrations.

## Verified checks

- Real PostgreSQL interface suite: 13 scenarios (14 tests including the parent),
  all passed; duplicates, 12 competing claimers, stale completions, unsupported
  contracts, immutable retry/review, restricted callback context, old epochs and
  revoked authority. No skips.
- Operator HTTP/browser flow: 5/5; ABDM synthetic gateway: 10/10; consent/readiness:
  6/6; HL7/ASTM/analyzer contract and MLLP: 12/12.
- Migration ordering and synthetic network guard: 3/3, including refusal of
  external/alternate-port targets and automatic redirects.
- Strict server/browser types, generated contracts and patch checks passed.
- Full fresh PG16 migration chain through 0138/0156 had already passed (95
  migrations). Final candidate PG16/18 upgrade/regression remains C4.

Saved browser/API evidence: evidence/interfaces/2026-10-17-local.json. The
gateway and scanner are explicitly synthetic fixtures. The harness permits only
its selected loopback HTTP services, disables redirects, and hashes untracked
source files in its evidence; no real provider or hospital approval is implied.

## Remaining release gates

Actual device manuals/validation and ABDM/provider contracts, registration,
credentials and sandbox approval remain external. B8 owns production worker
supervision/health/drain; C4 owns exact-candidate/full-engine acceptance. Test
gateway delivery evidence does not establish production provider idempotence.
