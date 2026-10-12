# Schema drift: code vs. databases

Two HMS databases exist on the development machine, and neither matches the
code exactly. The schema has no single definition: `backend/init_database.js`
creates missing tables on every Docker start, and `backend/server.js` alters
tables at startup. A database's shape depends on which of those last ran
against it.

| | Local PostgreSQL 18 (`backend/.env`) | Docker PostgreSQL 16 (`docker compose`) |
|---|---|---|
| Tables | 45 | 46 |
| `hms_discharge_summaries` | **missing**, so discharge summaries fail (`routes/ipd.js:621`) | present, no model |
| `hms_suppliers.supplier_number` | **missing**, so the Supplier model breaks | present |
| `hms_referrals` | present, no model | present, no model |
| Foreign keys / check constraints | 0 / 0 | 0 / 0 |
| Versioned migrations | none | none |

Phase 1 replaces this with versioned migrations run as a deployment step.
Regenerate the detail below with `node backend/scripts/schema-report.js`.

---

# Schema report: `hms` (PostgreSQL 18.6 (Ubuntu 18.6-1.pgdg24.04+2))

Generated 2026-10-12T06:47:49.309Z by `backend/scripts/schema-report.js`.

| Measure | Value |
|---|---:|
| Tables in database | 45 |
| Sequelize models | 44 |
| Primary keys | 45 |
| Foreign keys | 0 |
| Unique constraints | 5 |
| Check constraints | 0 |
| Exclusion constraints | 0 |
| Versioned migrations directory | no |

## Models whose table is missing
- None

## Model columns missing from the database
Queries through these models fail or silently lose data.

- `hms_suppliers.supplier_number` (model Supplier)

## Tables used in hand-written SQL that do not exist
- `hms_discharge_summaries` — routes/ipd.js:621, routes/ipd.js:676, routes/ipd.js:695

## Database tables with no model
Only reachable through hand-written SQL.

- `hms_referrals`

## Database columns not declared on their model
Informational: usually read through hand-written SQL.

- `hms_users.created_at`
- `hms_users.updated_at`
- `hms_audit_logs.idempotency_key`
- `hms_departments.created_at`
- `hms_doctors.created_at`
- `hms_appointments.created_at`
- `hms_tokens.created_at`
- `hms_patient_documents.uploaded_at`
- `hms_allergies.noted_at`
- `hms_chronic_conditions.created_at`
- `hms_encounters.created_at`
- `hms_encounters.updated_at`
- `hms_diagnoses.updated_at`
- `hms_diagnoses.created_at`
- `hms_prescriptions.created_at`
- `hms_prescriptions.updated_at`
- `hms_prescription_items.created_at`
- `hms_prescription_items.updated_at`
- `hms_investigation_orders.updated_at`
- `hms_investigation_order_items.updated_at`
- `hms_investigation_order_items.created_at`
- `hms_medicines.created_at`
- `hms_medicines.updated_at`
- `hms_purchase_orders.created_at`


---

# Schema report: `hms` (PostgreSQL 16.15)

Generated 2026-10-12T06:47:49.752Z by `backend/scripts/schema-report.js`.

| Measure | Value |
|---|---:|
| Tables in database | 46 |
| Sequelize models | 44 |
| Primary keys | 46 |
| Foreign keys | 0 |
| Unique constraints | 6 |
| Check constraints | 0 |
| Exclusion constraints | 0 |
| Versioned migrations directory | no |

## Models whose table is missing
- None

## Model columns missing from the database
Queries through these models fail or silently lose data.

- None

## Tables used in hand-written SQL that do not exist
- None

## Database tables with no model
Only reachable through hand-written SQL.

- `hms_discharge_summaries`
- `hms_referrals`

## Database columns not declared on their model
Informational: usually read through hand-written SQL.

- `hms_users.created_at`
- `hms_users.updated_at`
- `hms_departments.created_at`
- `hms_doctors.created_at`
- `hms_appointments.created_at`
- `hms_tokens.created_at`
- `hms_patient_documents.uploaded_at`
- `hms_allergies.noted_at`
- `hms_chronic_conditions.created_at`
- `hms_encounters.updated_at`
- `hms_encounters.created_at`
- `hms_diagnoses.created_at`
- `hms_diagnoses.updated_at`
- `hms_prescriptions.created_at`
- `hms_prescriptions.updated_at`
- `hms_prescription_items.created_at`
- `hms_prescription_items.updated_at`
- `hms_investigation_orders.updated_at`
- `hms_investigation_order_items.created_at`
- `hms_investigation_order_items.updated_at`
- `hms_medicines.created_at`
- `hms_medicines.updated_at`
- `hms_purchase_orders.created_at`

