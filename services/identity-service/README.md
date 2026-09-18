# HMS Identity Service

The Identity Service owns authentication, account state, RBAC permissions, and audit persistence. It is an independently executable Node.js service and does not import the monolith runtime or another service's ORM models.

## Run

```bash
npm install
node src/migrate.js
npm start
```

It listens on `IDENTITY_PORT` (default `5101`). `GET /health` reports process health; `GET /ready` also verifies PostgreSQL. Production startup requires a 32-character `INTERNAL_SERVICE_SECRET` and a strong JWT secret.

## Contracts

Public compatibility endpoints are mounted under the existing paths:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `PUT /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/verify-otp`
- `POST /api/auth/reset-password`
- `GET /api/users`
- `GET /api/users/permissions`
- `GET|POST|PUT /api/admin/staff[/:id]`
- `POST /api/security/sessions/:userId/force-logout`
- `POST /api/security/users/:id/unlock`

Internal contracts require `x-internal-service-token` and are not public gateway routes:

- `POST /internal/v1/auth/validate` validates the bearer token and current account state.
- `POST /internal/v1/audit` records an idempotent audit event.
- `POST /internal/compat/doctors` provisions the identity account used by the legacy doctor profile flow.

The gateway verifies the client JWT, asks Identity to validate current state, and sends a short-lived HMAC-signed context downstream. Services must verify that signature and must not trust arbitrary identity headers.

## Owned tables

`HMS_USERS`, `HMS_PERMISSIONS`, and `HMS_AUDIT_LOGS` are Identity-owned. The migration adds an optional idempotency key and a partial unique index to the audit table without recreating or deleting existing data.

## Dependency policy

Identity directly accesses only its owned tables. Cross-service operations use HTTP contracts with request IDs and the configured internal service secret. Passwords, tokens, authorization headers, and context headers are redacted from logs.
