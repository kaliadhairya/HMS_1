# Shared medication authority and native API increment

Clinical blueprint 3.10; no Mission Control features. A2/A3/A6 remain partial.

Migrations 0131–0133 add immutable fulfillment projections, exact order fulfillment
review versions, and occurrence review changes when bedside claims change. The
legacy clinical content revision is retained for compatibility. Public commands
compare the locked public aggregate version before calling the same domain
service used by legacy clients, within their receipt/audit/outbox transaction.

The native API covers order creation/read/sign/hold/resume/discontinue/amend and
pharmacist verification; dispensing and reads; interval schedule generation,
occurrence reads/preparation, administration recording and reads. It requires
canonical UUIDs, snake_case fields and string decimal quantities. Existing
allergy, independent review, physical stock, witness, time, bedside claim,
late-documentation and duplicate-dose checks remain authoritative.

The legacy router also requires current professional approval and action/chart
privileges; order/e-MAR/task/handover worklists use the verified facility. Native
medication authorization runs before receipt lookup, so a revoked professional
cannot recover chart data through a previous successful response.

Observed on disposable PG16 database `hms_p4_final_v2_20261015b`, API 5064:

- `e2e/v2Medication.e2e.js`: **9/9**, including canonical relationships, exact
  retries, legacy/native conflicts, wrong version/location denial, fractional
  fulfillment, immutable signed content, bedside claims, duplicate dose denial,
  missing professional approval and revocation of receipt access.
- `e2e/medication.e2e.js`: **20/20**, including existing medication, inventory,
  e-MAR, PRN, controlled witnesses, handover and late-documentation workflows.
- Strict TypeScript and generated contract consistency checks pass.

Still required: medication browser migration, complete facility/care/action review
of remaining operations, final PG18/fresh/upgrade checks and consolidated release
regression. These synthetic results are not hospital content approval or go-live.
