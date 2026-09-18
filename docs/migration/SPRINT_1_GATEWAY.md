# Sprint 1 — Gateway Foundation

Date: 2026-08-12

## Verdict

PASS. The API gateway is now the public backend entry point on port 5001. The working monolith remains intact on internal local port 5002 and still owns every domain route. This is a real strangler foundation, not a claimed domain extraction.

## Changes made

- Added an independently executable `services/api-gateway` package with its own manifest, lockfile, configuration, app entry point, logging, tests, and lifecycle.
- Used `http-proxy-middleware` so request and response streams are preserved; JSON, forms, multipart bodies, uploads, downloads, query strings, headers, and WebSocket upgrades are not manually reconstructed.
- Added `/health` for gateway process health and `/ready` for monolith dependency readiness.
- Added structured Pino request logs with authorization/token redaction.
- Added validated/generated request IDs and propagated `x-request-id` upstream and downstream.
- Added Helmet, CORS controls, public API rate limiting, and stricter auth-endpoint rate limiting.
- Strip all externally supplied identity/internal-service headers.
- Verify supplied JWTs at the gateway and reject invalid tokens while allowing missing tokens for public routes and monolith compatibility.
- Generate an HMAC-signed identity context for future extracted services. The current monolith continues independently verifying Bearer tokens and does not trust this context.
- Added structured 404 and upstream-unavailable errors with request IDs.
- Added HTTP/proxy timeouts and graceful SIGINT/SIGTERM shutdown.
- Added explicit Socket.IO upgrade routing to the monolith.
- Added configurable monolith `TRUST_PROXY`; local launcher restricts it to loopback.
- Added `npm run services:start`, which starts gateway and monolith together and shuts both down if either fails.
- Added `npm run services:test` for gateway contract tests.
- Added `INTERNAL_SERVICE_SECRET` configuration templates and generated a local ignored value.

## Files changed

Sprint-owned files:

- `.gitignore`
- `package.json`
- `backend/.env.template`
- `backend/server.js`
- `backend/routes/pharmacy.js`
- `backend/routes/pdfRoutes.js`
- `backend/smoke_critical_flows.js`
- `scripts/start-services.js`
- `services/api-gateway/**`
- `docs/migration/PHASE_0_BASELINE.md`
- `docs/migration/SPRINT_1_GATEWAY.md`

Other modified frontend/configuration files predated this migration and were preserved.

## Service extracted

API Gateway only. No business bounded context was extracted.

The gateway has:

- independent entry point and `package.json`;
- focused dependencies;
- independent environment/config validation;
- independent port;
- health and readiness endpoints;
- structured logging/errors;
- request correlation;
- JWT validation and signed downstream identity context;
- safe streaming HTTP proxy;
- WebSocket upgrade proxy;
- timeouts and graceful shutdown;
- four automated contract tests;
- zero imports from `backend/routes`, `backend/models`, `backend/middleware`, or `backend/server`.

## Tables owned

None. Gateway has no database dependency and owns no tables.

## Old monolith dependencies removed

No business dependency was removed in this sprint. All domain paths intentionally route to the monolith as the strangler fallback.

## Inter-service dependencies

```text
Frontend :4999
  -> API Gateway :5001
      -> Monolith :5002
          -> PostgreSQL hms
```

The gateway depends on monolith `/api/health` for readiness. It does not import or execute monolith code.

## Gateway route map for Sprint 1

| Public path | Current target |
|---|---|
| `/api/**` | monolith `:5002` unchanged path/query/body |
| `/uploads/**` | monolith static upload handler |
| `/socket.io/**` | monolith Socket.IO HTTP/WebSocket server |
| `/health`, `/api/gateway/health` | gateway process health |
| `/ready`, `/api/gateway/ready` | gateway + monolith readiness |

Future sprints will replace route targets one bounded context at a time. Unmigrated paths will continue reaching the monolith until their extraction passes.

## Authentication behavior

- Gateway strips forgeable `x-user-*`, `x-auth-context*`, and `x-internal-service` headers.
- Missing JWT is allowed through because login, reset, profile assets, and some compatibility endpoints are public; the monolith retains route-level enforcement.
- Invalid/expired supplied JWT is rejected at the gateway with 401.
- Valid JWT is still forwarded as the original Authorization header and revalidated by the monolith.
- A signed identity context is attached for future services using a distinct 32+ character internal secret.
- This does not yet solve Socket.IO role spoofing; socket authentication is deliberately deferred to Auth extraction rather than weakening frontend compatibility in this gateway-only sprint.

## Tests run

### Gateway automated tests

- gateway health versus upstream readiness: PASS;
- JSON bytes and query string preservation: PASS;
- multipart body preservation: PASS;
- invalid JWT rejection: PASS;
- external identity-header stripping: PASS;
- signed trusted context creation: PASS;
- structured upstream 503: PASS.

Result: 4 tests, 4 passed, 0 failed.

### Static checks

- gateway source syntax: PASS;
- changed backend/runner syntax: PASS;
- gateway search for monolith runtime imports: PASS, none found;
- Sprint-owned diff whitespace check: PASS.

A pre-existing trailing-space warning remains in `frontend/src/pages/hms/consultation/PrescriptionSlipPage.jsx`; it was not introduced or modified for gateway architecture.

## Runtime checks

- independent gateway start: PASS;
- monolith start on internal port 5002: PASS;
- one-command `npm run services:start`: PASS;
- gateway `/health`: 200;
- gateway `/ready`: 200 with upstream ready;
- existing `/api/health` through gateway: 200;
- existing frontend `/api/health` proxy through gateway: 200;
- request IDs present: PASS;
- authorization headers redacted in gateway logs: PASS;
- graceful gateway SIGINT shutdown: PASS.

## HTTP checks

- receptionist login through gateway: 200;
- authenticated patient search through gateway: 200;
- receptionist to super-admin dashboard: 403;
- invalid JWT: 401;
- full existing API path preservation: PASS in critical smoke;
- multipart hospital-logo upload: 200;
- uploaded file streamed back byte-for-byte: 200, 559,536 bytes;
- prescription PDF streaming: 200, valid `%PDF` payload;
- bill PDF streaming: 200, valid `%PDF` payload.

## Database checks

The full critical flow ran through an isolated gateway/monolith pair against temporary PostgreSQL database `hms_sprint1_test_20260812`.

Verified after the first flow:

- patient: 1;
- token: 1;
- appointment: 1;
- encounter: 1;
- prescription: 1;
- lab order: 1;
- dispensing record: 1;
- bill: 1;
- audit rows: 28;
- received batch quantity 5, post-dispense quantity 4;
- bill total 3.00;
- net payable 3.00.

The strengthened full smoke then passed again with prescription ID 2 and bill/PDF assertions included. The temporary database was dropped afterward; it contained only test data. The test upload was removed after byte comparison.

## Frontend checks

- Vite remained on port 4999.
- Its existing `/api` proxy reached the gateway on 5001.
- Existing login/session/API semantics were unchanged.
- A real Socket.IO client connected through gateway WebSocket transport and the monolith logged join/disconnect.
- No frontend source change was required for gateway introduction.
- Twelve hard-coded direct backend URLs remain and are documented for conversion before the monolith port becomes inaccessible outside local development.

## Failures and fixes during this sprint

1. Initial Socket.IO gateway test timed out because `/socket.io/` was absent from the proxy path filter. Added it and reran successfully.
2. Monolith rate limiting warned about forwarded addresses because proxy trust was unset. Added explicit configurable trust and used `loopback` locally.
3. Prescription PDF failed because it queried nonexistent `hms_users.department` and expected legacy uppercase raw result keys. Joined `hms_departments` correctly and normalized PostgreSQL rows.
4. Bill PDF failed because it queried nonexistent patient `phone`; corrected it to `phonenumber` and normalized rows.
5. Existing smoke checked only bill existence, allowing zero totals. It now asserts bill totals and both streamed PDFs.

All corrected stages were rerun successfully before marking the sprint complete.

## Remaining blockers / technical debt

- Socket.IO role joins are still unauthenticated in the monolith.
- Query-string JWT compatibility remains and should be removed after PDF/download clients use Authorization consistently.
- Gateway and monolith both rate-limit during transition; policy consolidation should occur once gateway deployment is stable.
- Monolith still binds its configured port normally; deployment must restrict 5002 to loopback/internal network.
- The 12 frontend hard-coded port-5001 URLs should become relative gateway URLs.
- Gateway signed-context verification middleware must be implemented in extracted services before any service trusts it.
- Upload authorization/access policy remains inherited from the monolith.
- No browser automation exists yet.

## Evidence record

Sprint: 1 — Gateway foundation

Changes made: independent gateway, secure streaming proxy, correlation/logging/errors/timeouts, one-command launcher, proxy trust, WebSocket routing, gateway tests, PDF/billing regression fixes.

Service extracted: API Gateway.

Tables owned: none.

Old monolith dependencies removed: invalid wrapper migration removed in Phase 0; gateway has no monolith code imports.

Inter-service dependencies: gateway -> monolith HTTP/WebSocket only.

Tests run: gateway contract tests, backend/gateway syntax checks, full critical smoke through isolated gateway, upload/download/PDF runtime tests.

Runtime checks: PASS.

HTTP checks: PASS.

DB checks: PASS.

Frontend checks: PASS for build/proxy/auth/API/realtime compatibility; browser automation remains pending.

Failures: all failures above were fixed and retested.

Remaining blockers: listed above; none block beginning Auth/Identity extraction.

Verdict: PASS.
