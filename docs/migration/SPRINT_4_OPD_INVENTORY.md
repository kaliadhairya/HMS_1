# Sprint 4 — OPD / Appointment Inventory

Status: INVENTORY COMPLETE — implementation pending.

## Candidate bounded context

OPD / Appointment Service owns appointment scheduling, token generation/queue state, doctor directory data, and department directory data. Encounters, diagnoses, prescriptions, vitals, and lab orders belong to Clinical/Lab and must not be imported into this service.

## Candidate owned tables

| Service | Tables |
|---|---|
| OPD / Appointment | `HMS_APPOINTMENTS`, `HMS_TOKENS`, `HMS_DOCTORS`, `HMS_DEPARTMENTS` |
| Patient dependency | `HMS_PATIENTS` through Patient Service API |
| Identity dependency | `HMS_USERS` through Identity contracts |
| Clinical dependency | `HMS_ENCOUNTERS` through a future Clinical API |

Foreign-key IDs remain stable across the shared PostgreSQL installation; OPD will validate referenced patient/user records over explicit HTTP rather than cross-importing their ORM models.

## Existing public contracts

- `/api/hms/appointments` — create, filter/list, reschedule/status update; slot conflict handling and 15-minute default slots.
- `/api/hms/tokens` — create daily doctor tokens, doctor queue, global queue, status update.
- `/api/hms/doctors` — directory/list, create, profile.
- `/api/hms/departments` — directory/list, create, department doctors.

The current appointment list and token queue responses enrich records with Patient and Identity names through monolith joins. The extracted service must replace these with Patient/Identity service calls or a documented read model before routing those paths.

## Current invariants to preserve

- Appointment slots cannot overlap for a doctor/date except the record being rescheduled.
- Appointment status normalization preserves Scheduled, Checked-in, Completed, Cancelled, and No Show values.
- Token number increments per doctor/date inside a transaction.
- Appointment/token IDs use existing PostgreSQL sequences (`hms_appt_seq`, `hms_token_seq`) and existing rows remain untouched.
- Doctor and department lookups preserve current frontend object shapes.
- Every mutating operation emits an audit event through Identity.

## Extraction plan

1. Add independent OPD service and scoped models for the four owned tables.
2. Add internal Patient lookup contract and Identity directory/context contracts.
3. Port slot conflict and token-number transaction logic without importing monolith code.
4. Route directory, appointment, and token paths through the gateway while leaving encounter paths on monolith.
5. Run isolated PostgreSQL create/list/reschedule/conflict/token/status tests, then live gateway/frontend queue checks.

No OPD route has been rerouted yet; the monolith remains the operational owner until the service passes that evidence gate.
