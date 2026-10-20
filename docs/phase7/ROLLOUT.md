# Controlled hospital rollout

## Scope and authorization

Engineering completion and the owner's local Docker update are not clinical
go-live authorization. The hospital supplies named medical, nursing, pharmacy,
laboratory, finance, privacy and operations leads and deputies. Record the
exact site/facility, release/images/schema, allowed services, excluded features,
policies, staffing, support hours, decision reference and observation window.
Unapproved terminology, rules, tariffs, devices and integrations stay disabled.
Keep all outstanding blockers visible in the assessment record.

## OPD pilot

Before the pilot, review applicable G01–G19 evidence and hazard dispositions,
complete role-specific rehearsal, reconcile opening records/stock/receivables,
prove downtime access and recovery, and agree workload and stop thresholds.
Only the named hospital authority records a pilot authorization. Begin with
the explicitly approved outpatient scope. Record failed/unknown commands,
worklist ownership, late results, patient identity corrections, clinical
incidents, support response and stock/financial reconciliation each shift.

## Ward pilot

G20 additionally requires the reviewed OPD observations, ward-specific bed and
transfer checks, nursing responsibility, SBAR acknowledgment, medication review,
bedside verification, missed/refused/late dose and witness rehearsals, signed
discharge and ownership of results pending after discharge. Name the ward and
its clinical/on-call coverage. Do not infer ward approval from OPD approval.

## Expansion

G21 additionally reviews both pilots, incidents and reconciliations, capacity,
staff competence, extra facilities/specialties and newly enabled rule/device
coverage. The hospital reviews every affected open P0/P1 and records a new
scope decision. One site's pilot is not multi-customer or regional validation.

## Stop, handover and return

Patient/order identity mismatch, uncontained unauthorized access, duplicated
clinical/financial effects, unavailable critical-result responsibility, unsafe
bedside practice, loss of the current writer or unverified recovery evidence
requires escalation to the named leads and containment of the affected scope.
Use the downtime kit and approved paper procedure, retain actual administration
times, and never acknowledge an unpersisted inbound message. Resume only after
named review, durable paper reconciliation, fresh access/security validation
and confirmation of stock, finance and outstanding clinical responsibilities.
Application rollback is separate from database recovery; never discard writes
made after cutover or promote while the old writer remains unfenced.
