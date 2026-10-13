# Phase 3 integration requests

For the Phase 2 owner, after reviewed branch integration:
- Apply care-team/patient scope to `/api/medication` clinical endpoints. Current
  handlers use explicit roles and `hms_users.id` as agreed in PARALLEL_WORK.md.
- Add the new prescribing, pharmacist, nursing/ward supply and witness worklists
  to role navigation. Routes are `/medication/orders`, `/medication/pharmacy`,
  `/medication/nursing`, `/medication/stock`, `/medication/controlled` and
  `/medication/catalogue`. Existing owned pharmacy pages already link to them.
- Encounter note finalization must not sign free-text prescription status as a
  medication authorization. The legacy dispense namespaces now reject it.
- See phase3-retire-old-mar.md for the legacy eMAR write boundary.

For Phase 5 revenue work: `hms_med_charges` is an append-only, exact-decimal,
source-linked charge per dispense line and explicit encounter/admission. Consume
these charges once when issuing the episode invoice; do not infer an admission
from a patient or create a second IPD bill. Returns create quarantined inventory
and a separate pending credit referral, never a silent charge reversal.

No shared-app deployment or merge is authorized by these requests.

**Status (13 Oct, Claude):** patient scope on `/api/medication` and the MAR boundary are done on `integration/phase2-phase3`; see `docs/INTEGRATION_PHASE2_PHASE3.md`. Navigation entries for the medication screens are not added yet. The Phase 5 items stand.
