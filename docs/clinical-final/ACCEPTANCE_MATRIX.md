# Blueprint acceptance matrix (completion C1)

Source: `HMS_1_Clinical_Architecture_Blueprint.md` section 5.3, the required
acceptance scenarios. Each row names suites whose step names match the scenario. "Step found" means a
matching step exists in a suite; it is not a reading of every assertion, so each
such row still needs a line-by-line check before the hospital release.
Suite pass results for the candidate are in the run recorded in
`CANDIDATE_RUN.md`. GAP rows have no matching step and are not claimed. Concurrency
rows run on real PostgreSQL with separate connections, as the blueprint requires.

| Area | Mandatory scenario | Suites | Status |
|---|---|---|---|
| Authentication | Reset token rejected as a session | failureModes | Step found (bearer, cookie, socket and event feed refused; session token cannot reset; reset token single use) |
| Authentication | Revoked sessions remain invalid | facilitySessions, sessions | Step found |
| Authentication | Deactivated users lose socket access | facilitySessions, sessions, eventScope | Step found |
| Authentication | Remote identity rejection cannot fall through | abdm, abdmUse | Step found (ABDM gateway token refusal) |
| Authorization | Wrong role, wrong facility, unrelated patient, missing credential | authorization, facilityLifecycle, careTeam, clinicalPrivilegesUi | Step found |
| Authorization | Unauthorized document/export access denied | documents, clinicalExchange | Step found |
| Identity | Newborn age zero | patientIdentity | Step found |
| Identity | Unconscious unknown patient | patientIdentity, downtime | Step found |
| Identity | Duplicate names / shared phone | patientIdentity, patientMerge | Step found |
| Identity | Reviewed and corrected merge history | patientMerge | Step found |
| Scheduling / beds | 50 simultaneous requests for one slot or bed | scheduling (50 slot requests), clinicalConcurrency (50 admissions) | Step found (real PostgreSQL) |
| Scheduling / beds | Overlapping reschedules | adt, scheduling | Step found |
| Scheduling / beds | Transfer against discharge | adt | Step found |
| Scheduling / beds | Dirty or out-of-service bed refusal | adt, ipd | Step found |
| Clinical documents | Autosave races with signing; two editors; stale versions | consultationNotes, v2Documents, v2DocumentsUi | Step found |
| Clinical documents | Amendment preserves the original | consultationNotes, clinicalDocuments, v2Documents | Step found |
| CDS / medication | Unknown allergy status | medicationGuards, consultationIntegration, opd | Step found |
| CDS / medication | Missing weight or context | medication, opd | Step found |
| CDS / medication | Wrong strength, duplicate therapy, approved override, uncovered medicine | medicationGuards, medication, pharmacy | Step found |
| CDS / medication | Discontinued or held order | medication, v2Medication | Step found |
| Inventory | Concurrent receipt of an absent lot; duplicate GRN | pharmacy, medication | Step found |
| Inventory | Multi-counter dispensing; partial fills | medication, v2Medication, pharmacy | Step found |
| Inventory | Expired, quarantined or recalled stock | pharmacy, medication | Step found |
| Inventory | Return quarantine; fractional unit conversion | pharmacy, medicationGuards | Step found |
| e-MAR | Wrong patient or product | medication, medicationGuards | Step found |
| e-MAR | Duplicate submission; PRN limits; held or refused dose | medication, medicationGuards, durability | Step found |
| e-MAR | Witness requirement; network failure after administration | medicationGuards, medicationFrontend, durability | Step found |
| Laboratory | Specimen rejection; duplicate analyzer message | laboratory, laboratoryWorker, devices | Step found |
| Laboratory | Two writers on one result; simultaneous completion | laboratory, phase45, phase45cf | Step found |
| Laboratory | QC failure; unit mismatch; corrected critical result | laboratoryGuards, laboratory, phase45cf | Step found |
| Critical follow-up | Recipient unavailable; missed acknowledgment; escalation | laboratoryWorker, laboratory, triage | Step found |
| Critical follow-up | Discharge before result release; amended-result recontact | adt, laboratory | Step found (named owner for pending results; amended critical finding restarts communication) |
| Finance | Duplicate partial-payment retry; concurrent credit | finance, billingControls | Step found |
| Finance | Oversized or partial deposit allocation; refund replay | finance | Step found |
| Finance | Package exclusions | billingControls, finance | Step found |
| Finance | Payer remittance; missing settlement | finance | Step found (payer split, claim, partial denial and remittance; settlement mismatch opens an owned exception) |
| Durability | Crash after commit before response | durability, idempotency | Step found |
| Durability | Duplicate and out-of-order events; worker restart | durability, eventScope, laboratoryWorker | Step found |
| Durability | Failed downstream service | failureModes, documents, interfaceOps, abdm | Step found (ABDM gateway failing during ABHA verification: refused cleanly, nothing half-recorded, retry works; virus scanner down: upload quarantined on the worklist; outbound delivery failure) |
| Durability | Reconciliation of unknown outcomes | idempotency, finance, consultationNotes | Step found |
| Privacy / audit | Emergency access review | careTeam, triage | Step found (break-glass needs a reason, lasts one hour, is audited and waits for review; expiry refuses again) |
| Privacy / audit | Consent revocation | abdm, abdmUse | Step found |
| Privacy / audit | Audit tampering or deletion; missing checkpoint | audit, auditWorm, documents | Step found |
| Privacy / audit | Retention hold; authorized export | documents, auditWorm, clinicalExchange | Step found |
| Recovery | Point-in-time restore | recoveryDrill, documents | Covered locally; target-region evidence external |
| Recovery | Regional failover | recoveryDrill (local fencing only) | Local only; target-region drill external |
| Recovery | Lost connectivity | failureModes, downtimeDrill, interfaceOps, medicationFrontend | Step found (answer lost after commit: same-key retry returns the original, one payment; live socket cut: missed events recovered from the cursor; offline kit) |
| Recovery | Stale downtime summary; paper-era reconciliation | downtimeDrill, downtime | Step found |
| UX / performance | Full keyboard workflow | clinicalUx, pharmacy, admin | Partly covered |
| UX / performance | Multilingual printing | clinicalUx, documents, finance | Step found (text review external) |
| UX / performance | Visible failed saves; stale-data warnings | clinicalUx, frontendReliability | Step found |
| UX / performance | Accessible critical alerts | clinicalUx | Step found |
| UX / performance | Workload-based latency measurement | `scripts/load` workload tool (C3), not a suite | Measured separately; target-environment figures external |

## Open gaps (not closed by this matrix)

- Keyboard-only completion of the full OPD journey is not one step (keyboard tabs, Ctrl+S and
  focus handling are tested in clinicalUx); add an end-to-end keyboard-only journey before the
  hospital release.
- "Step found" rows still need the line-by-line assertion review described above.
