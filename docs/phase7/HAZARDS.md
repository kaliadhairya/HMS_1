# Hazard register

All dispositions start OPEN in assessment.template.json. Original F01–F18 priorities come from the owner-provided clinical blueprint; H01–H18 classifications are conservative engineering proposals for hospital review. Existing code mitigations do not constitute clinical acceptance.

| Hazard | Priority | Risk | Accountable hospital role | Controls/gates |
|---|---|---|---|---|
| F01 | P0 | Reset token or identity rejection accepted as a session | Privacy/security lead | G03 |
| F02 | P0 | Unauthorized chart/document access | Privacy/security lead | G04 |
| F03 | P0 | Schema drift or broken relationships | Engineering/operations lead | G02 |
| F04 | P0 | Destructive cleanup loses records/bed ownership | Medical director / clinical safety lead | G05 |
| F05 | P0 | Stale signing/order changes lose evidence | Medical director / clinical safety lead | G05 |
| F06 | P0 | Uncoded medication or ambiguous fulfillment | Pharmacy lead | G07 |
| F07 | P0 | Invented or unverified stock provenance | Pharmacy lead | G08 |
| F08 | P0 | Administration without verified patient/order/supply | Nursing lead | G20 |
| F09 | P0 | Specimen/result/release failure | Laboratory director | G09 |
| F10 | P0 | Deposit balance not properly consumed | Finance lead | G11 |
| F11 | P0 | Lost/conflicting episode charges | Finance lead | G11 |
| F12 | P0 | Unreliable transactional/access audit | Privacy/security lead | G13 |
| F13 | P0 | Backup indicators without recoverability | Engineering/operations lead | G14 |
| F14 | P0 | Unknown allergy state or unapproved CDS | Pharmacy lead | G07 |
| F15 | P1 | Overlapping appointments/reschedules | Medical director / clinical safety lead | G06 |
| F16 | P1 | Ambiguous patient/practitioner identity | Privacy/security lead | G04 |
| F17 | P1 | Stock/billing races or ungoverned controlled medicines | Pharmacy lead | G08 |
| F18 | P0 | Unsafe startup/readiness/deployment | Engineering/operations lead | G02, G14 |
| H01 | P0 | Missing policy owners or unapproved enabled scope | Medical director / clinical safety lead | G01 |
| H02 | P0 | Old/partial tests mistaken for release acceptance | Engineering/operations lead | G02 |
| H03 | P0 | Exposed/demo credentials or unverified key migration | Privacy/security lead | G03 |
| H04 | P1 | IST/UTC queue day mismatch | Medical director / clinical safety lead | G06 |
| H05 | P0 | Free-text Quick Consult cannot fulfill coded orders | Pharmacy lead | G07 |
| H06 | P0 | Legacy lab ordering/navigation bypass | Laboratory director | G09 |
| H07 | P0 | Unanswered critical results or handoffs | Laboratory director | G10 |
| H08 | P1 | Unapproved prices or incomplete opening journals | Finance lead | G11 |
| H09 | P0 | Unowned failures and unknown command outcomes | Engineering/operations lead | G12 |
| H10 | P0 | Mutable/missing remote checkpoints | Privacy/security lead | G13 |
| H11 | P0 | Unproven regional recovery, split writers or repeated effects | Engineering/operations lead | G14 |
| H12 | P0 | Stale/unavailable kit or unreconciled downtime | Nursing lead | G15 |
| H13 | P0 | Unrevoked consent, invalid exchange or unreviewed imports | Privacy/security lead | G16 |
| H14 | P0 | 6F breaks analyzer contract semantics | Laboratory director | G17 |
| H15 | P1 | Unusable clinical UI or unmeasured capacity | Medical director / clinical safety lead | G18 |
| H16 | P0 | Untrained/uncontrolled OPD pilot | Medical director / clinical safety lead | G19 |
| H17 | P0 | Unvalidated ward/bedside practice | Nursing lead | G20 |
| H18 | P1 | Expansion with unresolved hazards | Medical director / clinical safety lead | G21 |

## G01: Named owners and approved service scope

Owner: Medical director / clinical safety lead. Stages: OPD, WARD, EXPANSION.

Control: Named humans approve service/facility, enabled capabilities, exclusions and controlled policy versions.

Acceptance: Unapproved clinical rules stay disabled. Scope includes staffing, privileges, effective dates and escalation coverage.

Required evidence: CLINICAL_POLICY, OWNER_REVIEW.

Tests: Phase 6/new clinical or operational acceptance; evidence pending.

Procedure: [docs/phase7/ROLLOUT.md#scope-and-authorization](../../docs/phase7/ROLLOUT.md#scope-and-authorization).

## G02: Exact integrated release and independent acceptance

Owner: Engineering/operations lead. Stages: OPD, WARD, EXPANSION.

Control: Immutable candidate, checked schema/migrations, real multi-connection tests and independent review.

Acceptance: Integrate Phase 6 and all accepted fixes, then run the complete regression, fresh/upgrade migrations on PG16/18, frontend build and failure injection. Partial runs and old commits do not close this gate.

Required evidence: ENGINEERING_TEST, INDEPENDENT_REVIEW, OWNER_REVIEW.

Tests: [scripts/verify-clinical-final.cjs](../../scripts/verify-clinical-final.cjs), [backend/scripts/verify-migrations.sh](../../backend/scripts/verify-migrations.sh), [backend/tests/phase1.integration.test.js](../../backend/tests/phase1.integration.test.js)

Procedure: [docs/phase7/ACCEPTANCE.md#engineering-acceptance](../../docs/phase7/ACCEPTANCE.md#engineering-acceptance).

## G03: Credentials, sessions and encryption

Owner: Privacy/security lead. Stages: OPD, WARD, EXPANSION.

Control: Separate token purposes, authoritative validation, session/socket revocation and target secret controls.

Acceptance: Reject reset tokens and identity fallback; test revoked/deactivated sessions and sockets. Rotate exposed/demo credentials; validate TLS, cookie/CSRF/CORS and encryption key migration without logging secrets.

Required evidence: ENGINEERING_TEST, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [e2e/sessions.e2e.js](../../e2e/sessions.e2e.js), [e2e/authorization.e2e.js](../../e2e/authorization.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r01](../../docs/phase7/REHEARSALS.md#r01).

## G04: Patient scope and private documents

Owner: Privacy/security lead. Stages: OPD, WARD, EXPANSION.

Control: Explicit role, facility, patient, action and purpose with governed canonical identity.

Acceptance: Wrong role/facility/patient/credential and unauthorized document/export requests fail. Review broad demographic search, upload quarantine, private delivery, retention and legal holds on the target.

Required evidence: ENGINEERING_TEST, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [e2e/authorization.e2e.js](../../e2e/authorization.e2e.js), [e2e/careTeam.e2e.js](../../e2e/careTeam.e2e.js), [e2e/patientIdentity.e2e.js](../../e2e/patientIdentity.e2e.js), [e2e/practitioners.e2e.js](../../e2e/practitioners.e2e.js), [e2e/clinicalDocuments.e2e.js](../../e2e/clinicalDocuments.e2e.js), [e2e/historicalPrescriptionSafety.e2e.js](../../e2e/historicalPrescriptionSafety.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r01](../../docs/phase7/REHEARSALS.md#r01).

## G05: Identity, signing and corrections

Owner: Medical director / clinical safety lead. Stages: OPD, WARD, EXPANSION.

Control: Stable identities, reviewed merges and versioned signing/amendments preserve original evidence.

Acceptance: Test newborn/unknown patient, duplicate names/phone, corrected merge, two editors, autosave/signing race and stale writes. Staff demonstrate patient/encounter selection and linked amendments; no destructive cleanup.

Required evidence: ENGINEERING_TEST, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/patientIdentity.e2e.js](../../e2e/patientIdentity.e2e.js), [e2e/patientMerge.e2e.js](../../e2e/patientMerge.e2e.js), [e2e/clinicalDocuments.e2e.js](../../e2e/clinicalDocuments.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r02](../../docs/phase7/REHEARSALS.md#r02).

## G06: Scheduling and service-day boundaries

Owner: Medical director / clinical safety lead. Stages: OPD, WARD, EXPANSION.

Control: Database overlap protection and a validated hospital timezone across booking and queues.

Acceptance: At least 50 concurrent requests for one slot and overlapping reschedules use real PostgreSQL. Fix/test midnight–05:30 IST queue linkage using actual target timezone; staff demonstrate date-boundary handling.

Required evidence: ENGINEERING_TEST, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/scheduling.e2e.js](../../e2e/scheduling.e2e.js), [e2e/opd.e2e.js](../../e2e/opd.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r03](../../docs/phase7/REHEARSALS.md#r03).

## G07: Coded medication orders and approved CDS

Owner: Pharmacy lead. Stages: OPD, WARD, EXPANSION.

Control: Coded products/orders, explicit allergy-review state and approved clinical knowledge coverage.

Acceptance: Approve formulary, substitutions, CDS rules/coverage and overrides. Fix or restrict free-text Quick Consult/navigation; test unknown allergy/context, uncovered medicine, wrong strength, duplicate therapy, held/discontinued order and approved override.

Required evidence: CLINICAL_POLICY, ENGINEERING_TEST, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/medication.e2e.js](../../e2e/medication.e2e.js), [e2e/medicationGuards.e2e.js](../../e2e/medicationGuards.e2e.js), [e2e/medicationFrontend.e2e.js](../../e2e/medicationFrontend.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r04](../../docs/phase7/REHEARSALS.md#r04).

## G08: Lot provenance and stock reconciliation

Owner: Pharmacy lead. Stages: OPD, WARD, EXPANSION.

Control: Verified manufacturer lots, journalled movements and governed controlled-drug/witness practice.

Acceptance: Test absent-lot receipt races, duplicate GRN, multi-counter dispense, expired/quarantined/recalled stock, partial fill, return quarantine and fractional conversion. Quarantine unverified history; opening stock and ledger reconcile.

Required evidence: ENGINEERING_TEST, RECONCILIATION, OWNER_REVIEW.

Tests: [e2e/pharmacy.e2e.js](../../e2e/pharmacy.e2e.js), [e2e/medicationGuards.e2e.js](../../e2e/medicationGuards.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r04](../../docs/phase7/REHEARSALS.md#r04).

## G09: Governed laboratory loop

Owner: Laboratory director. Stages: OPD, WARD, EXPANSION.

Control: Coded catalogue, specimen custody, QC, credentialed release and report lineage.

Acceptance: Approve catalogue, specimen/method/unit requirements, reference/critical policies, QC and release grants. Integrate or restrict name-only ordering/navigation. Test mismatch/rejection/recollection, multi-specimen orders, result races, QC/unit failures and corrected critical reports.

Required evidence: CLINICAL_POLICY, ENGINEERING_TEST, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/laboratory.e2e.js](../../e2e/laboratory.e2e.js), [e2e/laboratoryGuards.e2e.js](../../e2e/laboratoryGuards.e2e.js), [e2e/laboratoryFrontend.e2e.js](../../e2e/laboratoryFrontend.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r05](../../docs/phase7/REHEARSALS.md#r05).

## G10: Critical results and owned handoffs

Owner: Laboratory director. Stages: OPD, WARD, EXPANSION.

Control: Durable accountable recipients, acknowledgment, escalation and post-discharge/amended-result follow-up.

Acceptance: Supervise escalation worker and validate actual routing/authorized identity. Rehearse unavailable recipient, missed acknowledgment, discharge-before-result and amended recontact; timings come from approved policy.

Required evidence: TARGET_VALIDATION, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/laboratoryWorker.e2e.js](../../e2e/laboratoryWorker.e2e.js), [e2e/referrals.e2e.js](../../e2e/referrals.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r06](../../docs/phase7/REHEARSALS.md#r06).

## G11: Approved prices and balanced episode finance

Owner: Finance lead. Stages: OPD, WARD, EXPANSION.

Control: Source-linked charges, exact reversal, immutable invoices and balanced journal with approved prices.

Acceptance: Approve coded lab pricing, tariffs/packages, payer/tax and refund authorities. Test replay/races, deposits, refunds, package exclusions/remittances. Reconcile historical/opening receivables, OTC, deposits, cash/provider settlement and explicit legacy/manual-payment dispositions.

Required evidence: CLINICAL_POLICY, ENGINEERING_TEST, RECONCILIATION, OWNER_REVIEW.

Tests: [e2e/finance.e2e.js](../../e2e/finance.e2e.js), [e2e/phase45.e2e.js](../../e2e/phase45.e2e.js), [e2e/ipdDrafts.e2e.js](../../e2e/ipdDrafts.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r07](../../docs/phase7/REHEARSALS.md#r07).

## G12: Durable outcomes and named failure owners

Owner: Engineering/operations lead. Stages: OPD, WARD, EXPANSION.

Control: Atomic command/audit/idempotency/outbox and durable owned reconciliation of failures.

Acceptance: Test commit-before-response crash, duplicate/out-of-order events, restart and failed downstream services. Assign actual people and deputies to enabled-interface worklists; role defaults alone are not named accountability.

Required evidence: ENGINEERING_TEST, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [e2e/idempotency.e2e.js](../../e2e/idempotency.e2e.js), [e2e/durability.e2e.js](../../e2e/durability.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r08](../../docs/phase7/REHEARSALS.md#r08).

## G13: Audit integrity and protected checkpoint completeness

Owner: Privacy/security lead. Stages: OPD, WARD, EXPANSION.

Control: Transactional mutation/access audit and complete independently protected checkpoint inventory.

Acceptance: Test tampering/deletion, absent/unshipped/late remote records and wrong test-database checkpoints. Validate actual immutable store, retention, separate administration, emergency-access review and complete current chain heads.

Required evidence: ENGINEERING_TEST, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [e2e/audit.e2e.js](../../e2e/audit.e2e.js), [scripts/verify-audit-protection.cjs](../../scripts/verify-audit-protection.cjs)

Procedure: [docs/phase7/REHEARSALS.md#r09](../../docs/phase7/REHEARSALS.md#r09).

## G14: Verified restore and fenced regional recovery

Owner: Engineering/operations lead. Stages: OPD, WARD, EXPANSION.

Control: Real artifacts/restores, bounded observed loss and old-writer/external-effect/security fencing.

Acceptance: Validate deployed WAL/base backup protection and actual artifact checksums. A real regional drill must demonstrate RPO ≤300s and RTO ≤3600s, old-writer fencing, revocations and delivered-effect reconciliation. Local container timings are mechanism evidence only.

Required evidence: ENGINEERING_TEST, REGIONAL_DRILL, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [scripts/backup-db.sh](../../scripts/backup-db.sh), [scripts/restore-check.sh](../../scripts/restore-check.sh), [e2e/recoveryDrill.e2e.js](../../e2e/recoveryDrill.e2e.js), [backend/tests/logicalBackup.integration.test.js](../../backend/tests/logicalBackup.integration.test.js)

Procedure: [docs/phase7/REHEARSALS.md#r10](../../docs/phase7/REHEARSALS.md#r10).

## G15: Usable downtime kit and paper reconciliation

Owner: Nursing lead. Stages: OPD, WARD, EXPANSION.

Control: Restricted encrypted read-only summaries, visible freshness and approved actual-time paper reconciliation.

Acceptance: Demonstrate kit/key distribution to actual ward equipment, stale-copy refusal, lost connectivity, approved paper forms and recovery of orders/doses/specimens/receipts/identities. Nothing becomes a second writable database.

Required evidence: TARGET_VALIDATION, STAFF_REHEARSAL, OWNER_REVIEW.

Tests: [e2e/downtime.e2e.js](../../e2e/downtime.e2e.js), [e2e/downtimeDrill.e2e.js](../../e2e/downtimeDrill.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r11](../../docs/phase7/REHEARSALS.md#r11).

## G16: Consent, terminology and real exchange

Owner: Privacy/security lead. Stages: OPD, WARD, EXPANSION.

Control: Licensed/versioned terminology, reviewed imports and consent checked at time of use.

Acceptance: Test FHIR/profile validation, approved mappings, expiry/revocation, patient scope and clinician-reviewed imports. Supply real approved sandbox/device exchange evidence for enabled integrations; mocks do not close real exchange.

Required evidence: ENGINEERING_TEST, REAL_EXCHANGE, CLINICAL_POLICY, OWNER_REVIEW.

Tests: [e2e/abdm.e2e.js](../../e2e/abdm.e2e.js), [e2e/abdmUse.e2e.js](../../e2e/abdmUse.e2e.js), [e2e/clinicalExchange.e2e.js](../../e2e/clinicalExchange.e2e.js)

Procedure: [docs/phase7/REHEARSALS.md#r12](../../docs/phase7/REHEARSALS.md#r12).

## G17: 6F analyzer compatibility

Owner: Laboratory director. Stages: OPD, WARD, EXPANSION.

Control: Preserve contract v1 identity, dedupe, provisional-result, QC and authorized-release boundaries.

Acceptance: Review actual 6F source and tests against Phase 4, including multi-result identity, held analyzer outcomes, ACK/retry, actor audit, changed-payload replay and contract retirement. Resolve confirmed findings before scoped device enablement.

Required evidence: ENGINEERING_TEST, INDEPENDENT_REVIEW, OWNER_REVIEW.

Tests: [backend/services/laboratoryAnalyzer.js](../../backend/services/laboratoryAnalyzer.js), [e2e/devices.e2e.js](../../e2e/devices.e2e.js), [backend/tests/deviceScope.integration.test.js](../../backend/tests/deviceScope.integration.test.js)

Procedure: [docs/phase7/6F_REVIEW.md#review-procedure](../../docs/phase7/6F_REVIEW.md#review-procedure).

## G18: Clinical usability and measured capacity

Owner: Medical director / clinical safety lead. Stages: OPD, WARD, EXPANSION.

Control: Patient context, visible failure/conflict/stale/unknown states and usable target equipment.

Acceptance: Actual users perform keyboard workflows and multilingual printing, accessible alerts and chart-preserving save failures. Approve workload and stop thresholds before measurements; synthetic regression is not capacity/SLO evidence.

Required evidence: STAFF_REHEARSAL, TARGET_VALIDATION, OWNER_REVIEW.

Tests: [e2e/frontendReliability.e2e.js](../../e2e/frontendReliability.e2e.js), [e2e/medicationFrontend.e2e.js](../../e2e/medicationFrontend.e2e.js), [e2e/laboratoryFrontend.e2e.js](../../e2e/laboratoryFrontend.e2e.js)

Procedure: [docs/phase7/ACCEPTANCE.md#clinical-and-environment-acceptance](../../docs/phase7/ACCEPTANCE.md#clinical-and-environment-acceptance).

## G19: OPD staffing, competency and pilot decision

Owner: Medical director / clinical safety lead. Stages: OPD, WARD, EXPANSION.

Control: Bounded named OPD service with trained roles, support coverage, monitoring and rehearsed stop/handover.

Acceptance: Witnessed competency records cover each scoped role. Medical, privacy and operations owners review exact site/release/window, defects and all gates before a separate pilot authorization.

Required evidence: STAFF_REHEARSAL, CLINICAL_POLICY, OWNER_REVIEW.

Tests: Phase 6/new clinical or operational acceptance; evidence pending.

Procedure: [docs/phase7/ROLLOUT.md#opd-pilot](../../docs/phase7/ROLLOUT.md#opd-pilot).

## G20: Ward readiness and OPD pilot review

Owner: Nursing lead. Stages: WARD, EXPANSION.

Control: Traceable bedside practice, occupied-bed invariants, nursing handover and reviewed OPD observations.

Acceptance: Test at least 50 concurrent same-bed requests, transfer/discharge races, dirty/out-of-service refusal and eMAR wrong patient/product, duplicate/PRN/held/refused doses, witness and network loss after administration. Rehearse SBAR/actual-time corrections; review OPD incidents, stock/finance and workload before named-ward approval.

Required evidence: ENGINEERING_TEST, STAFF_REHEARSAL, PILOT_OBSERVATION, OWNER_REVIEW.

Tests: [e2e/adt.e2e.js](../../e2e/adt.e2e.js), [e2e/medication.e2e.js](../../e2e/medication.e2e.js), [e2e/medicationGuards.e2e.js](../../e2e/medicationGuards.e2e.js), [e2e/ipd.e2e.js](../../e2e/ipd.e2e.js)

Procedure: [docs/phase7/ROLLOUT.md#ward-pilot](../../docs/phase7/ROLLOUT.md#ward-pilot).

## G21: Expansion acceptance and complete reconciliation

Owner: Medical director / clinical safety lead. Stages: EXPANSION.

Control: Separate additional-service/facility decision after OPD and ward reviews.

Acceptance: No affected open P0 or hospital-wide-required P1 remains. All named leads review incidents/worklists, staffing, stock/finance, capacity and policy/device scope before expansion; one pilot is not fleet validation.

Required evidence: PILOT_OBSERVATION, CLINICAL_POLICY, OWNER_REVIEW.

Tests: Phase 6/new clinical or operational acceptance; evidence pending.

Procedure: [docs/phase7/ROLLOUT.md#expansion](../../docs/phase7/ROLLOUT.md#expansion).
