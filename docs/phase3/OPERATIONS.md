# Medication and nursing operating workflow

These workflows require authorized clinical staff, approved local clinical
content and Phase 2 patient/care-team integration before clinical go-live.
The software does not infer clinical knowledge from a medicine display name.

## Catalogue and knowledge approval

1. Review the legacy reconciliation queue at `/medication/catalogue`. Its
   products are drafts, not approved medicines. Do not guess route, ingredient,
   concentration, pack conversion or controlled classification.
2. Enter the coded ingredient composition, product identity, concentration per
   base unit, quantity precision, provenance and effective timestamp. Approve
   only against verified source material. Historic signed versions retain their
   snapshots. Retire an identity instead of rewriting it.
3. Publish rule packs only from approved clinical content. Every declared
   covered check needs an applicable rule and provenance. Empty or unsupported
   coverage remains visible and requires independent pharmacist review.
4. Permission for sale without a prescription is an explicit, versioned
   formulary restriction (`otc_allowed`), false unless approved. It is not
   derived from the controlled-drug flag. A retail receipt cannot authorize
   an inpatient administration.

## Prescribing and verification

1. Use `/medication/orders` or the medication panel in consultation. Confirm the
   patient and encounter and supply the explicit admission for inpatient care.
2. Review allergies independently of the list. An empty list is not evidence of
   none known. Record the review state and coded substance where known.
3. Enter a coded product or ingredient, dose/unit, route, interval, start/end,
   and authorized supply. PRN orders also need indication, maximum dose, period
   and minimum interval. No dose is prefilled by the application.
4. Preview the assessment, review its inputs and declared coverage, then sign
   the exact version. Explain any permitted override. Missing context is not a
   successful check. Non-overridable blocks cannot be bypassed.
5. An independent pharmacist verifies that exact version or requests
   clarification. A change in allergy context requires prescriber review and a
   new version. Use separate hold, resume, discontinue and amend commands.
6. A 412 conflict preserves the draft: refresh and review the newer revision.
   An uncertain request retains its original key/body; reconcile it before
   requesting another mutation.

## Receiving, supply, returns and ward stock

- Receive against the supplier/invoice with the manufacturer lot, actual
  expiry and source document. Explicit pack conversion is retained with the
  original units; balances use the approved base unit.
- Undocumented legacy/opening lots are quarantined. Releasing a lot requires a
  verified lot/expiry source document and reason. Recalled lots cannot be
  relabelled through another disposition to become available.
- Fulfil the exact verified order version. FEFO selects available, unexpired
  stock, using the receiving location's business timezone. Partial supply
  retains the remaining authorization. Stock, supply and the immutable
  source-linked charge commit together.
- A controlled supply needs another authenticated clinician's attestation of
  the exact proposed action. Changing a product, quantity, location or time
  invalidates the attestation. An attestation expires after five minutes and
  cannot authorize another command.
- Patient returns enter the quarantine location. Their pending financial
  credit is separate; the original charge remains intact. Do not pick or sell
  returned stock as available stock.
- A nurse requests ward stock; another authorized actor approves it. Picked
  stock remains in transit until the requesting nurse acknowledges its receipt.
  A controlled pick attests the approved product, quantity and destination.
- Counter sales require an approved coded product, explicit formulary
  permission and a recorded pharmacist review of incomplete patient context.
  Administrators cannot provide that review. A known coded ingredient allergy
  requires the prescriber/override workflow; controlled products cannot use
  counter sales.

## Bedside administration and uncertain documentation

1. Generate scheduled occurrences only from verified versions. PRN occurrences
   are explicit requests, not an automatically generated routine schedule.
2. Select the actual supplied line. Confirm wristband/patient identifier and
   product barcode plus dose, route and scheduled time. When scanning fails,
   document why and positively confirm the patient and approved product.
3. Reserve the bedside documentation claim before physically giving a dose.
   The server rechecks active order, verification, current allergy context,
   product/lot, unused supplied quantity and the approved interval/PRN limits.
   Future routine occurrences cannot be claimed early.
4. Record GIVEN, HELD, REFUSED or OMITTED, actual time, and any required reason
   and witness. Recorded time comes from the server. Exceptions create tasks;
   PRN doses create reassessment tasks. An occurrence has one completed record.
5. If the response is lost after giving the dose, **do not administer again**.
   Keep the pending-documentation state and reconcile the original key/body.
   A new key cannot create a second administration for that occurrence.
6. If a hold/amendment/discontinuation happened after a dose was already given,
   submit the exact late-documentation request. The responsible prescriber
   reviews the original version, original authorization, actual time and
   clinical-state transition. Approval permits documentation of that prior
   dose; it does not authorize a new dose or resume future administration.
7. Corrections are linked records. The original is not overwritten or deleted.
   Time/notes/entered-in-error corrections create a review task. Dose or stock
   corrections require reconciliation; they do not silently replenish supply
   or reset PRN usage. Original usage remains counted conservatively.

## Controlled counts and handover

- Register supply, administration, return, wastage and transfer with an
  independent witness. Reconcile each shift count against the recorded balance.
  A mismatch opens a case; record investigation before closure. The case never
  silently changes the balance.
- Send SBAR and the specific outstanding tasks to the receiving nurse.
  Responsibility remains with the sender until that receiver acknowledges.
  The receipt transfers the linked tasks and records the new responsibility.
- Review exception/clarification/reassessment tasks explicitly. Notification
  delivery alone does not close a clinical task.

## Integration and cutover

Apply Phase 2 patient scope and practitioner mapping, retire the old free-text
MAR write handlers, and adopt the shared patient banner/navigation. Phase 5
must consume `hms_med_charges` once into the episode invoice and process return
credits separately. Keep these clinical go-live gates distinct from a passing
feature-branch test run. See `../requests/phase3-integration.md` and
`../requests/phase3-retire-old-mar.md`.
