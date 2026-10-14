// The readiness catalogue describes acceptance obligations, not clinical values.
// Hospital approvals and live evidence belong in a separate assessment record.
const owners = {
  clinical: 'Medical director / clinical safety lead',
  nursing: 'Nursing lead',
  pharmacy: 'Pharmacy lead',
  laboratory: 'Laboratory director',
  finance: 'Finance lead',
  privacy: 'Privacy/security lead',
  operations: 'Engineering/operations lead',
};
const stages = ['OPD', 'WARD', 'EXPANSION'];
const kinds = ['ENGINEERING_TEST', 'CLINICAL_POLICY', 'TARGET_VALIDATION',
  'STAFF_REHEARSAL', 'RECONCILIATION', 'REGIONAL_DRILL', 'REAL_EXCHANGE',
  'INDEPENDENT_REVIEW', 'PILOT_OBSERVATION', 'OWNER_REVIEW'];
const gates = [];
function add(id, title, owner, hazards, evidenceKinds, control, acceptance, tests, procedure, applies = stages) {
  gates.push({ id, title, owner, hazards, kinds: [...evidenceKinds, 'OWNER_REVIEW'],
    control, acceptance, tests, procedure, stages: [...applies] });
}
add('G01', 'Named owners and approved service scope', 'clinical', ['H01'], ['CLINICAL_POLICY'],
  'Named humans approve service/facility, enabled capabilities, exclusions and controlled policy versions.',
  'Unapproved clinical rules stay disabled. Scope includes staffing, privileges, effective dates and escalation coverage.',
  [], 'docs/phase7/ROLLOUT.md#scope-and-authorization');
add('G02', 'Exact integrated release and independent acceptance', 'operations', ['F03', 'F18', 'H02'], ['ENGINEERING_TEST', 'INDEPENDENT_REVIEW'],
  'Immutable candidate, checked schema/migrations, real multi-connection tests and independent review.',
  'Integrate Phase 6 and all accepted fixes, then run the complete regression, fresh/upgrade migrations on PG16/18, frontend build and failure injection. Partial runs and old commits do not close this gate.',
  ['backend/scripts/verify-phase45.js', 'backend/scripts/verify-migrations.sh', 'backend/tests/phase1.integration.test.js'], 'docs/phase7/ACCEPTANCE.md#engineering-acceptance');
add('G03', 'Credentials, sessions and encryption', 'privacy', ['F01', 'H03'], ['ENGINEERING_TEST', 'TARGET_VALIDATION'],
  'Separate token purposes, authoritative validation, session/socket revocation and target secret controls.',
  'Reject reset tokens and identity fallback; test revoked/deactivated sessions and sockets. Rotate exposed/demo credentials; validate TLS, cookie/CSRF/CORS and encryption key migration without logging secrets.',
  ['e2e/sessions.e2e.js', 'e2e/authorization.e2e.js'], 'docs/phase7/REHEARSALS.md#R01');
add('G04', 'Patient scope and private documents', 'privacy', ['F02', 'F16'], ['ENGINEERING_TEST', 'TARGET_VALIDATION'],
  'Explicit role, facility, patient, action and purpose with governed canonical identity.',
  'Wrong role/facility/patient/credential and unauthorized document/export requests fail. Review broad demographic search, upload quarantine, private delivery, retention and legal holds on the target.',
  ['e2e/authorization.e2e.js', 'e2e/careTeam.e2e.js', 'e2e/patientIdentity.e2e.js', 'e2e/practitioners.e2e.js', 'e2e/clinicalDocuments.e2e.js'], 'docs/phase7/REHEARSALS.md#R01');
add('G05', 'Identity, signing and corrections', 'clinical', ['F04', 'F05'], ['ENGINEERING_TEST', 'STAFF_REHEARSAL'],
  'Stable identities, reviewed merges and versioned signing/amendments preserve original evidence.',
  'Test newborn/unknown patient, duplicate names/phone, corrected merge, two editors, autosave/signing race and stale writes. Staff demonstrate patient/encounter selection and linked amendments; no destructive cleanup.',
  ['e2e/patientIdentity.e2e.js', 'e2e/patientMerge.e2e.js', 'e2e/clinicalDocuments.e2e.js'], 'docs/phase7/REHEARSALS.md#R02');
add('G06', 'Scheduling and service-day boundaries', 'clinical', ['F15', 'H04'], ['ENGINEERING_TEST', 'STAFF_REHEARSAL'],
  'Database overlap protection and a validated hospital timezone across booking and queues.',
  'At least 50 concurrent requests for one slot and overlapping reschedules use real PostgreSQL. Fix/test midnight–05:30 IST queue linkage using actual target timezone; staff demonstrate date-boundary handling.',
  ['e2e/scheduling.e2e.js', 'e2e/opd.e2e.js'], 'docs/phase7/REHEARSALS.md#R03');
add('G07', 'Coded medication orders and approved CDS', 'pharmacy', ['F06', 'F14', 'H05'], ['CLINICAL_POLICY', 'ENGINEERING_TEST', 'STAFF_REHEARSAL'],
  'Coded products/orders, explicit allergy-review state and approved clinical knowledge coverage.',
  'Approve formulary, substitutions, CDS rules/coverage and overrides. Fix or restrict free-text Quick Consult/navigation; test unknown allergy/context, uncovered medicine, wrong strength, duplicate therapy, held/discontinued order and approved override.',
  ['e2e/medication.e2e.js', 'e2e/medicationGuards.e2e.js', 'e2e/medicationFrontend.e2e.js'], 'docs/phase7/REHEARSALS.md#R04');
add('G08', 'Lot provenance and stock reconciliation', 'pharmacy', ['F07', 'F17'], ['ENGINEERING_TEST', 'RECONCILIATION'],
  'Verified manufacturer lots, journalled movements and governed controlled-drug/witness practice.',
  'Test absent-lot receipt races, duplicate GRN, multi-counter dispense, expired/quarantined/recalled stock, partial fill, return quarantine and fractional conversion. Quarantine unverified history; opening stock and ledger reconcile.',
  ['e2e/pharmacy.e2e.js', 'e2e/medicationGuards.e2e.js'], 'docs/phase7/REHEARSALS.md#R04');
add('G09', 'Governed laboratory loop', 'laboratory', ['F09', 'H06'], ['CLINICAL_POLICY', 'ENGINEERING_TEST', 'STAFF_REHEARSAL'],
  'Coded catalogue, specimen custody, QC, credentialed release and report lineage.',
  'Approve catalogue, specimen/method/unit requirements, reference/critical policies, QC and release grants. Integrate or restrict name-only ordering/navigation. Test mismatch/rejection/recollection, multi-specimen orders, result races, QC/unit failures and corrected critical reports.',
  ['e2e/laboratory.e2e.js', 'e2e/laboratoryGuards.e2e.js', 'e2e/laboratoryFrontend.e2e.js'], 'docs/phase7/REHEARSALS.md#R05');
add('G10', 'Critical results and owned handoffs', 'laboratory', ['H07'], ['TARGET_VALIDATION', 'STAFF_REHEARSAL'],
  'Durable accountable recipients, acknowledgment, escalation and post-discharge/amended-result follow-up.',
  'Supervise escalation worker and validate actual routing/authorized identity. Rehearse unavailable recipient, missed acknowledgment, discharge-before-result and amended recontact; timings come from approved policy.',
  ['e2e/laboratoryWorker.e2e.js', 'e2e/referrals.e2e.js'], 'docs/phase7/REHEARSALS.md#R06');
add('G11', 'Approved prices and balanced episode finance', 'finance', ['F10', 'F11', 'H08'], ['CLINICAL_POLICY', 'ENGINEERING_TEST', 'RECONCILIATION'],
  'Source-linked charges, exact reversal, immutable invoices and balanced journal with approved prices.',
  'Approve coded lab pricing, tariffs/packages, payer/tax and refund authorities. Test replay/races, deposits, refunds, package exclusions/remittances. Reconcile historical/opening receivables, OTC, deposits, cash/provider settlement and explicit legacy/manual-payment dispositions.',
  ['e2e/finance.e2e.js', 'e2e/phase45.e2e.js', 'e2e/ipdDrafts.e2e.js'], 'docs/phase7/REHEARSALS.md#R07');
add('G12', 'Durable outcomes and named failure owners', 'operations', ['H09'], ['ENGINEERING_TEST', 'TARGET_VALIDATION'],
  'Atomic command/audit/idempotency/outbox and durable owned reconciliation of failures.',
  'Test commit-before-response crash, duplicate/out-of-order events, restart and failed downstream services. Assign actual people and deputies to enabled-interface worklists; role defaults alone are not named accountability.',
  ['e2e/idempotency.e2e.js', 'e2e/durability.e2e.js'], 'docs/phase7/REHEARSALS.md#R08');
add('G13', 'Audit integrity and protected checkpoint completeness', 'privacy', ['F12', 'H10'], ['ENGINEERING_TEST', 'TARGET_VALIDATION'],
  'Transactional mutation/access audit and complete independently protected checkpoint inventory.',
  'Test tampering/deletion, absent/unshipped/late remote records and wrong test-database checkpoints. Validate actual immutable store, retention, separate administration, emergency-access review and complete current chain heads.',
  ['e2e/audit.e2e.js'], 'docs/phase7/REHEARSALS.md#R09');
add('G14', 'Verified restore and fenced regional recovery', 'operations', ['F13', 'F18', 'H11'], ['ENGINEERING_TEST', 'REGIONAL_DRILL', 'TARGET_VALIDATION'],
  'Real artifacts/restores, bounded observed loss and old-writer/external-effect/security fencing.',
  'Validate deployed WAL/base backup protection and actual artifact checksums. A real regional drill must demonstrate RPO ≤300s and RTO ≤3600s, old-writer fencing, revocations and delivered-effect reconciliation. Local container timings are mechanism evidence only.',
  ['scripts/backup-db.sh', 'scripts/restore-check.sh'], 'docs/phase7/REHEARSALS.md#R10');
add('G15', 'Usable downtime kit and paper reconciliation', 'nursing', ['H12'], ['TARGET_VALIDATION', 'STAFF_REHEARSAL'],
  'Restricted encrypted read-only summaries, visible freshness and approved actual-time paper reconciliation.',
  'Demonstrate kit/key distribution to actual ward equipment, stale-copy refusal, lost connectivity, approved paper forms and recovery of orders/doses/specimens/receipts/identities. Nothing becomes a second writable database.',
  [], 'docs/phase7/REHEARSALS.md#R11');
add('G16', 'Consent, terminology and real exchange', 'privacy', ['H13'], ['ENGINEERING_TEST', 'REAL_EXCHANGE', 'CLINICAL_POLICY'],
  'Licensed/versioned terminology, reviewed imports and consent checked at time of use.',
  'Test FHIR/profile validation, approved mappings, expiry/revocation, patient scope and clinician-reviewed imports. Supply real approved sandbox/device exchange evidence for enabled integrations; mocks do not close real exchange.',
  [], 'docs/phase7/REHEARSALS.md#R12');
add('G17', '6F analyzer compatibility', 'laboratory', ['H14'], ['ENGINEERING_TEST', 'INDEPENDENT_REVIEW'],
  'Preserve contract v1 identity, dedupe, provisional-result, QC and authorized-release boundaries.',
  'Review actual 6F source and tests against Phase 4, including multi-result identity, held analyzer outcomes, ACK/retry, actor audit, changed-payload replay and contract retirement. Resolve confirmed findings before scoped device enablement.',
  ['backend/services/laboratoryAnalyzer.js', 'e2e/laboratory.e2e.js', 'e2e/laboratoryGuards.e2e.js'], 'docs/phase7/6F_REVIEW.md#review-procedure');
add('G18', 'Clinical usability and measured capacity', 'clinical', ['H15'], ['STAFF_REHEARSAL', 'TARGET_VALIDATION'],
  'Patient context, visible failure/conflict/stale/unknown states and usable target equipment.',
  'Actual users perform keyboard workflows and multilingual printing, accessible alerts and chart-preserving save failures. Approve workload and stop thresholds before measurements; synthetic regression is not capacity/SLO evidence.',
  ['e2e/frontendReliability.e2e.js', 'e2e/medicationFrontend.e2e.js', 'e2e/laboratoryFrontend.e2e.js'], 'docs/phase7/ACCEPTANCE.md#clinical-and-environment-acceptance');
add('G19', 'OPD staffing, competency and pilot decision', 'clinical', ['H16'], ['STAFF_REHEARSAL', 'CLINICAL_POLICY'],
  'Bounded named OPD service with trained roles, support coverage, monitoring and rehearsed stop/handover.',
  'Witnessed competency records cover each scoped role. Medical, privacy and operations owners review exact site/release/window, defects and all gates before a separate pilot authorization.',
  [], 'docs/phase7/ROLLOUT.md#opd-pilot');
add('G20', 'Ward readiness and OPD pilot review', 'nursing', ['F08', 'H17'], ['ENGINEERING_TEST', 'STAFF_REHEARSAL', 'PILOT_OBSERVATION'],
  'Traceable bedside practice, occupied-bed invariants, nursing handover and reviewed OPD observations.',
  'Test at least 50 concurrent same-bed requests, transfer/discharge races, dirty/out-of-service refusal and eMAR wrong patient/product, duplicate/PRN/held/refused doses, witness and network loss after administration. Rehearse SBAR/actual-time corrections; review OPD incidents, stock/finance and workload before named-ward approval.',
  ['e2e/adt.e2e.js', 'e2e/medication.e2e.js', 'e2e/medicationGuards.e2e.js', 'e2e/ipd.e2e.js'], 'docs/phase7/ROLLOUT.md#ward-pilot', ['WARD', 'EXPANSION']);
add('G21', 'Expansion acceptance and complete reconciliation', 'clinical', ['H18'], ['PILOT_OBSERVATION', 'CLINICAL_POLICY'],
  'Separate additional-service/facility decision after OPD and ward reviews.',
  'No affected open P0 or hospital-wide-required P1 remains. All named leads review incidents/worklists, staffing, stock/finance, capacity and policy/device scope before expansion; one pilot is not fleet validation.',
  [], 'docs/phase7/ROLLOUT.md#expansion', ['EXPANSION']);
const historical = [
  'Reset token or identity rejection accepted as a session', 'Unauthorized chart/document access',
  'Schema drift or broken relationships', 'Destructive cleanup loses records/bed ownership',
  'Stale signing/order changes lose evidence', 'Uncoded medication or ambiguous fulfillment',
  'Invented or unverified stock provenance', 'Administration without verified patient/order/supply',
  'Specimen/result/release failure', 'Deposit balance not properly consumed',
  'Lost/conflicting episode charges', 'Unreliable transactional/access audit',
  'Backup indicators without recoverability', 'Unknown allergy state or unapproved CDS',
  'Overlapping appointments/reschedules', 'Ambiguous patient/practitioner identity',
  'Stock/billing races or ungoverned controlled medicines', 'Unsafe startup/readiness/deployment',
];
const current = [
  'Missing policy owners or unapproved enabled scope', 'Old/partial tests mistaken for release acceptance',
  'Exposed/demo credentials or unverified key migration', 'IST/UTC queue day mismatch',
  'Free-text Quick Consult cannot fulfill coded orders', 'Legacy lab ordering/navigation bypass',
  'Unanswered critical results or handoffs', 'Unapproved prices or incomplete opening journals',
  'Unowned failures and unknown command outcomes', 'Mutable/missing remote checkpoints',
  'Unproven regional recovery, split writers or repeated effects', 'Stale/unavailable kit or unreconciled downtime',
  'Unrevoked consent, invalid exchange or unreviewed imports', '6F breaks analyzer contract semantics',
  'Unusable clinical UI or unmeasured capacity', 'Untrained/uncontrolled OPD pilot',
  'Unvalidated ward/bedside practice', 'Expansion with unresolved hazards',
];
const hazards = [
  ...historical.map((title, i) => ({ id: `F${String(i + 1).padStart(2, '0')}`, title,
    priority: i >= 14 && i <= 16 ? 'P1' : 'P0', basis: 'Historical blueprint priority; current clinical disposition is still required.' })),
  ...current.map((title, i) => ({ id: `H${String(i + 1).padStart(2, '0')}`, title,
    priority: [3, 7, 14, 17].includes(i) ? 'P1' : 'P0', basis: 'Conservative engineering classification awaiting hospital review.' })),
].map(h => {
  const linked = gates.filter(g => g.hazards.includes(h.id));
  return { ...h, owner: linked[0].owner, gates: linked.map(g => g.id),
    stages: stages.filter(s => linked.some(g => g.stages.includes(s))) };
});
module.exports = { schema_version: 1, base: '2a07ca8', owners, stages, kinds, gates, hazards };
