# HMS Patient Service

Patient Service owns patient records and patient-owned metadata. It is independently executable on port `5102`, uses its own Sequelize definitions, validates the gateway’s HMAC-signed identity context, and never imports monolith routes/models.

## Owned tables

- `HMS_PATIENTS`
- `HMS_ALLERGIES`
- `HMS_CHRONIC_CONDITIONS`
- `HMS_PATIENT_DOCUMENTS`

The service uses the existing PostgreSQL sequences and preserves the existing schema/data. Patient deletion transactionally removes only these owned child records. Cross-domain records are handled through explicit compatibility contracts until Lab/Clinical/IPD extraction is complete.

## API compatibility

The gateway preserves the existing public paths under `/api/patients`:

- registration: `POST /api/patients`, `POST /api/patients/hms`
- list/search: `GET /api/patients`, `GET /api/patients/hms/search`
- profile: `GET /api/patients/:id`, `GET /api/patients/hms/:id`
- patient-owned metadata: documents, allergies, chronic conditions
- update/delete: `PUT /api/patients/:id`, `DELETE /api/patients/:id`
- Corporate employee lookup and today/pending lists

Visits remain on the monolith’s Clinical/Lab aggregation path until those bounded contexts are extracted. Patient registration temporarily calls the protected monolith compatibility contract `/internal/compat/test-reports` to initialize the existing lab report and preserve the frontend’s `reportId` workflow; this is HTTP-only, documented, and contains no cross-service ORM import.

## Run and test

```bash
npm install
npm test
npm run check
npm start
```

`GET /health` is process health and `GET /ready` verifies PostgreSQL. Public API traffic must arrive through the gateway; direct API calls without a trusted signed context receive 401.
