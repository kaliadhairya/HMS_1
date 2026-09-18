# Sprint 5 — Clinical / EMR Inventory

Date: 2026-08-13
Status: INVENTORY COMPLETE; extraction not yet started

## Current routes

| Capability | Current route | Current owner |
|---|---|---|
| Encounter lifecycle | /api/hms/encounters | monolith backend/routes/hms/encounters.js |
| Patient encounter history | /api/hms/encounters/patient/:patient_id | monolith |
| Diagnosis add/delete | /api/hms/diagnoses | monolith backend/routes/hms/diagnoses.js |
| Prescription create/items/status/read | /api/hms/prescriptions | monolith backend/routes/hms/prescriptions.js |

All handlers use monolith authentication and Sequelize, enforcing the consultation read/write permission.

## Candidate Clinical-owned tables

- HMS_ENCOUNTERS (backend/models/Encounter.js)
- HMS_DIAGNOSES (backend/models/Diagnosis.js)
- HMS_PRESCRIPTIONS (backend/models/Prescription.js)
- HMS_PRESCRIPTION_ITEMS (backend/models/PrescriptionItem.js)

Clinical must read patient identity through Patient Service, doctor identity through Identity/OPD contracts, and medicine data through Pharmacy contracts. It must not import those services models.

## Cross-service workflows

1. OPD appointment/token to encounter.
2. Encounter to diagnoses and prescription.
3. Prescription to Pharmacy dispensing and stock decrement.
4. Prescription/bill interactions to Billing.
5. Clinical mutations to Identity audit and future realtime publication.

## Extraction gates

Build an independent Clinical service with scoped models, signed gateway context, validation, transactions, audit calls, health/readiness, tests, and explicit service clients. Verify encounter, diagnosis, and prescription HTTP responses plus database rows before routing paths away from the monolith.

## Known risks

- Legacy prescriptions may reference orphan patients or medicines; reads need compatibility handling while new writes remain strict.
- Prescription status and dispensing must be idempotent across the Pharmacy boundary.
- Encounter finalization must preserve permissions and audit behavior.
- Consultation and queue Socket.IO events remain monolith-owned until an explicit realtime bridge exists.
