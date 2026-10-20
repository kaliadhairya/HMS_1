# Witnessed clinical and operational rehearsals

For every rehearsal record candidate/site/scope, actual staff and witness,
date, synthetic record references, expected/observed result, unresolved issue,
evidence checksum and hospital decision. Test fixtures are not qualifications
or approvals. Use approved clinical content; do not invent doses or thresholds.

## R01

Privacy/security lead: verify token purpose, session/socket revocation,
facility/patient/credential denial, private document quarantine/download,
retention/legal hold, purpose/access audit, credential rotation and target TLS.

## R02

Medical lead: register newborn/unknown patients, distinguish shared names and
phone numbers, review duplicate merges and corrections, race two note editors
against signing, preserve a lost-response draft and sign a linked amendment.

## R03

Front desk and clinical lead: book/reschedule overlapping slots, check in,
allocate queues across hospital midnight and verify doctor/patient encounter
selection. Review the real PostgreSQL 50-request slot-race evidence.

## R04

Pharmacy/nursing leads: review allergy/context/coverage, coded order sign/hold/
discontinue, partial fill, wrong product, lot expiry/quarantine/recall, GRN
replay, fractional stock, controlled witnesses, ward acknowledgment, return
quarantine and balances. Rehearse actual administration followed by a lost
network response; reconcile the original dose instead of administering again.

## R05

Laboratory lead: coded order and specimen barcode, mismatched/rejected specimen,
recollection, analyzer duplicate/held messages, QC/unit failure, independent
verification and release, then a linked amended report. Validate actual device
manuals, transport permissions and supported contract versions separately.

## R06

Laboratory/medical leads: unavailable recipient, missed acknowledgment,
escalation, discharge before result release, amended-result recontact and
receiving-service handoff. Record who owns the next action and its completion;
opening a report or sending a notification does not close follow-up.

## R07

Finance lead: source-linked charges, separate consultation/episode invoices,
deposits and partial allocations, payment/credit race, linked refund/return,
package exclusions, payer remittance and missing settlement. Reconcile the
journal, receipts and historical opening balances without rewriting invoices.

## R08

Operations lead: crash after commit, original-key reconciliation, duplicate/
out-of-order events, worker restart, provider failure and ambiguous delivery.
Assign a named owner/deputy to enabled failure worklists; provider evidence is
required before retrying an uncertain non-idempotent effect.

## R09

Privacy/operations leads: alter/remove an audit entry, omit a signed chain,
lose a pinned object, stop shipping and rotate keys. Verify that each case is
reported, old signed bytes remain verifiable and production storage retention
and administrative separation are independently established.

## R10

Operations/nursing leads: restore the selected logical/PITR artifact privately;
validate tenant/site binding, journals, stock, clinical links, audit proofs and
exact document versions. Reconcile revocations, consumed tokens and previously
delivered effects. Demonstrate old-writer fencing, then regional RPO ≤300 s and
RTO ≤3600 s on the actual target. Local container timings do not prove this.
Open the encrypted downtime kit on its intended ward machine, demonstrate a
stale/unavailable kit, record paper-era activity and reconcile it before return
to service. Record on-call contacts and the hospital's escalation decision.

## R11

Nursing/operations leads: distribute a signed encrypted read-only kit to each
approved ward machine, separate the decryption key, and verify machine/facility
binding, freshness, offline opening, expiry and missing-key refusal. Rehearse
paper recording of new patients, orders, actual doses, specimens and receipts.
On return, assign each reconciliation item to a named professional and retain
paper references and actual times; a kit never becomes another writable HMS.

## R12

Privacy/clinical leads: inspect licensed terminology provenance/editions and
second-person mapping approval, then exercise consented exchange in the real
registered sandbox. Revoke and expire consent before view, send and import
decisions. Verify source/provenance, patient matching and clinician review of
outside information; it must not silently become a local prescription/order.
Retain real M1/M2/M3/profile/certification evidence for the enabled scope.
