# ABDM and terminology: checks, consent at use, reconciliation (completion B2)

## What HMS now enforces

| Area | Behaviour | Where |
|---|---|---|
| **Callback contracts** | Every ABDM gateway callback is checked for the fields its handler needs (13 callback types) before any processing. An incomplete one is refused with `ABDM-1000`, its missing fields are named, and the refusal is recorded as a rejected interface message. Gateway signature checks are unchanged and come first. | `domain/abdmContracts.cts`, `routes/abdmBridge.js` |
| **Consent at use** | Outside records are checked against their consent every time they are viewed or decided on, not only when they arrived. If the consent expired a moment ago, was revoked (even when the revocation notice never reached HMS), or is unknown, the records are erased before the screen gets them. A decision under an invalid consent is refused (409). Every view of outside records is in the audit log. | `services/abdm.js` (`consentAtUse`, `decideItem`), `routes/abdm.js` |
| **Reconciliation** | Each imported allergy, medicine and condition is compared with the patient's chart: "Already in chart" or "Not in chart". An accepted outside allergy can be added to the allergy record. It goes in as **unconfirmed**, names the source facility, and moves the allergy review to "allergies recorded". Nothing else is copied into the chart: medicines need an order, and conditions need a diagnosis at a visit. | `services/abdm.js`, Outside records screen |
| **Readiness** | For administrators, on the ABDM screen: whether ABDM is configured completely; which environment the gateway is (mock, sandbox or production; a non-production gateway blocks readiness in production); a sandbox consent-manager ID on a production gateway; whether the callback address is public https; and, for each terminology system, the active release, flagged when it is synthetic test content rather than the licensed edition. No secret is ever returned. | `services/integrationReadiness.cts`, `GET /api/integrations/readiness` |

Terminology releases already record their source, the licence acceptance
and the file checksum (Phase 6A). Mappings take effect only after a second
reviewer approves them.

## Verified by (mock gateway; not ABDM)

- `e2e/abdmUse.e2e.js` 6/6:
  - incomplete callbacks refused and recorded;
  - chart reconciliation;
  - adding an outside allergy (only allergies, unconfirmed, with source);
  - revocation and expiry enforced at use;
  - readiness (mock environment, synthetic edition, no secrets, admin only);
  - both screens.
- `e2e/abdm.e2e.js` 10/10 (milestones M1–M3 against the mock).
- `backend/tests/abdmContracts.test.js` 4/4.

## External evidence HMS cannot produce

These are recorded here when they happen. Synthetic tests never stand in
for them.

| Gate | Needed | Record (date, environment, who, reference) |
|---|---|---|
| ABDM sandbox registration | HIP/HIU IDs and client credentials issued by ABDM for this hospital | |
| M1 in sandbox | ABHA verify/create with real sandbox OTPs | |
| M2 in sandbox | Care-context linking and a consented record sent | |
| M3 in sandbox | Consent requested, granted, records received and reviewed | |
| ABDM functional test / certification | As ABDM requires for production | |
| Licensed ICD-10 edition | Loaded from the hospital's licensed file (`scripts/terminology-load.js`), licence acceptance recorded | |
| SNOMED CT / LOINC (if used) | Same, with the national release licence | |

The mock gateway (`backend/scripts/abdm-mock-gateway.js`) proves HMS's own
rules. It does not prove conformance with ABDM's gateway, which only the
sandbox can show.
