# HMS OPD / Appointment Service

The OPD Service owns appointment scheduling, token queues, doctor directory records, and department directory records. It runs independently on port `5103`, uses only its scoped Sequelize models, and receives a gateway-signed authentication context.

## Owned tables

- `HMS_APPOINTMENTS`
- `HMS_TOKENS`
- `HMS_DOCTORS`
- `HMS_DEPARTMENTS`

The service uses existing PostgreSQL sequences and keeps patient and identity data outside its database access. New appointment/token writes validate patient existence through Patient Service and doctor/user data through Identity contracts.

## Public compatibility paths

- `/api/hms/departments`
- `/api/hms/doctors`
- `/api/hms/appointments`
- `/api/hms/tokens`

The gateway routes these paths to OPD while encounter/diagnosis/prescription paths remain on the monolith until Clinical extraction.

## Correctness behavior

- Appointment slot selection and conflict checks use a PostgreSQL advisory transaction lock per doctor/date.
- Token numbering uses a PostgreSQL advisory transaction lock per doctor/day and existing `hms_token_seq` IDs.
- Legacy doctor references are accepted as either HMS doctor IDs or Identity user IDs and normalized to the owned doctor row.
- Legacy appointment rows with missing patient records remain visible with `patient: null`; new writes still require a valid Patient contract.

```bash
npm install
npm test
npm run check
npm start
```
