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

Facility/privilege strengthening, consent/provenance coverage and linking
the new document types into the ABDM delivery workflow remain tracked in
the three-phase checklist. The entire exchange package is not closed yet.

Sources: [FHIR R4 MedicationRequest](https://hl7.org/fhir/R4/medicationrequest.html),
[MedicationDispense](https://hl7.org/fhir/R4/medicationdispense.html),
[MedicationAdministration](https://hl7.org/fhir/R4/medicationadministration.html),
[ABDM PrescriptionRecord](https://nrces.in/ndhm/fhir/r4/StructureDefinition-PrescriptionRecord.html),
[ABDM DischargeSummaryRecord](https://nrces.in/ndhm/fhir/r4/StructureDefinition-DischargeSummaryRecord.html).
