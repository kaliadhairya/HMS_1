# Clinical read exchange increment

The read-only `/api/fhir` boundary now declares all 15 primary resource types
from the clinical blueprint. New MedicationRequest identities identify exact
signed order **versions**; unsigned drafts cannot be read there. Dispense
lines and administration records retain their original identifiers, amounts,
authors and references. Linked administration corrections are included, with
entered-in-error and corrected occurrence time represented explicitly.
Local drug names, routes and units remain text when no approved standard
mapping exists; export does not invent SNOMED CT or UCUM codes.

Document endpoints:

| Endpoint under `/api/fhir` | Required source |
|---|---|
| `/documents/consultation/{encounterId}` | Finalized outpatient encounter |
| `/documents/prescription/{encounterId}` | Independently signed coded medication versions |
| `/documents/laboratory/{reportVersionId}` | Released immutable report version |
| `/documents/discharge/{signatureId}` | Digest-verified discharge signature and completed admission |

The clinical-document API adds `docType` and `admissionId` for discharge,
nursing assessment and care-plan drafts. Composite foreign keys ensure that
the admission/encounter belongs to the document's patient. Nurses author
nursing assessments/care plans only for patients currently under their named
nursing responsibility; doctors author discharge records. Signing requires
reviewed content and an expected revision. Amendments retain the original
signature and the recorded amendment reason.

`e2e/clinicalExchange.e2e.js` verifies the new mappings, draft refusal,
patient-context mismatch, self-contained prescriptions, active-admission
export refusal and immutable discharge amendment. Its three fixture bundles
passed the official HL7 validator 6.10.4 against R4/ndhm.in 6.5.0 with zero
errors. Validation was offline: terminology warnings, missing narrative
warnings and external code validation remain visible; this is structural
fixture validation, not ABDM sandbox certification or approval of clinical
content. The existing FHIR suite also passed with zero validator errors.

## Completion (B1)

- **Access.** Clinical FHIR resources are read only by the treating doctor or
  the responsible nurse with a current credential and the chart-read privilege
  (the v2 clinical check); laboratory staff read laboratory resources only; an
  administrator role alone reads no chart. Directory resources keep their rules.
- **ABDM delivery.** A finished visit's care context offers its Prescription
  when it has signed coded medication orders. A completed stay with a signed
  discharge document is its own care context (`IPD-<admission>`) offering the
  DischargeSummary; discovery and HIP-initiated linking include it. Under a
  consent for those types the push sends them as encrypted document bundles and
  records each; a consent without a type sends nothing of it.
- **Provenance.** Every exported document carries a Provenance entry naming
  its author, the hospital and the document's own time. Consent is enforced at
  use (B2) and every read and push is in the audit trail.

Evidence: `e2e/fhir.e2e.js` 8/8, `e2e/clinicalExchange.e2e.js` 8/8 (official
validator, zero errors, provenance asserted), `e2e/abdmDocuments.e2e.js` 4/4,
`e2e/abdm.e2e.js` 10/10, `e2e/abdmUse.e2e.js` 6/6. Mock gateway only: ABDM
sandbox certification remains external.

Sources: [FHIR R4 MedicationRequest](https://hl7.org/fhir/R4/medicationrequest.html),
[MedicationDispense](https://hl7.org/fhir/R4/medicationdispense.html),
[MedicationAdministration](https://hl7.org/fhir/R4/medicationadministration.html),
[ABDM PrescriptionRecord](https://nrces.in/ndhm/fhir/r4/StructureDefinition-PrescriptionRecord.html),
[ABDM DischargeSummaryRecord](https://nrces.in/ndhm/fhir/r4/StructureDefinition-DischargeSummaryRecord.html).
