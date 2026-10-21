# Phase 5: revenue cycle

Branch `phase5/revenue-cycle` (worktree `../HMS_1-phase5`), cut from
`integration/phase2-phase3` at 816367e. Migrations 0070–0076. **Not merged
and not deployed.** Plan: `PLAN.md`.

## What changed, in plain terms

- **Every episode has one billing account.** An OPD visit or an admission.
  Charges go to the episode they name; a patient's other visits are never
  guessed.
- **Charges are recorded when care happens**, not when someone opens a bill:
  - consultation: when the doctor finalizes the visit (any screen);
  - lab test: when it is ordered; cancelling it records a reversal;
  - dispensed medicine: when the pharmacy dispenses a coded order (Phase 3).
    **Prescription medicines are now billed**: before this they went out
    unbilled;
  - bed days: one charge per day, priced by the ward the patient was in at
    the start of that day, so transfers change the rate. Active admissions
    accrue as days complete; discharge charges the rest;
  - medicines and services added on the billing page.
  Each source is charged once (database uniqueness). Charges are never edited
  or deleted; a mistake is cancelled by a linked reversal.
- **The price list is versioned.** Version 1 holds today's prices: the rows
  of `hms_tariffs` and the fallbacks that were written in the code
  (consultation 200, lab test 100, ward rates 400/800). A new version is a
  draft until an administrator activates it; old charges keep their prices.
- **Packages** (versioned): what they include, what they exclude, and
  allowances by quantity or value. Covered charges stay on the account (so
  stock use is traceable) and are billed at no extra cost; exclusions and
  anything beyond the allowance are billed.
- **Invoices are immutable once issued.** A bill is prepared as a draft
  (discounts before issue need an administrator and a reason), then issued.
  After that, corrections are credit or debit notes; voiding is allowed only
  for an invoice nothing has been applied to. Inpatient accounts can have
  interim bills and a final bill.
- **A balanced journal** records every money event once (invoice, note,
  receipt, deposit use, refund, remittance, write-off). The database refuses
  an entry that does not balance and refuses any change to a posted one.
- **Deposits are held for the patient** until used or refunded, can be used
  partly, and never beyond their amount (row locks plus a database check).
  A credit note on an invoice already paid becomes credit the patient can use
  or have refunded.
- **Payments have an outcome.** Cash is received at once. A card/UPI/bank
  payment needs the provider's reference; if the terminal gives no answer it
  is recorded as Unknown, and **no second collection is possible** for that
  bill until someone confirms or fails it. A provider reference can be used
  only once.
- **Refunds** come from a real deposit or credit, are approved by a second
  person (an administrator who did not request it), and are paid out once.
- **Insurance**: payers, the patient's coverage, eligibility answers,
  pre-authorisation with every decision kept as a revision, the payer's
  share of each bill (co-pay percentage, capped by the approved amount),
  claims (Prepared → Submitted → Acknowledged → Adjudicated →
  Settled/Denied/Appealed), remittances, and a denials worklist (appeal,
  write off, or pass to the patient). No payer rules or prices are invented;
  staff enter what the payer documents say.
- **Reconciliation**: a cashier's drawer is counted against its cash
  receipts and refunds; statement lines from the bank, card/UPI provider or
  payer are matched to receipts and remittances; checks compare deposits,
  credits, receivables and receipts with the journal. Every problem becomes
  an exception with an owner and a resolution note. The checks also run every
  15 minutes (with bed-day accrual).
- **Old screens keep working.** `hms_bills`, `hms_bill_items` and
  `hms_payments` are now written from invoices and receipts, so the bill
  PDF, billing history, receptionist views and reports still read them.
  `/api/billing/*` keeps its contract on top of the new domain (for example a
  discount after issue becomes a credit note; "pay by advance" applies real
  deposits). Bills raised before Phase 5 keep the old payment path.
- **The pharmacy/IPD bill conflict is gone.** There is no "pending bill" that
  two paths write into; each charge is on exactly one invoice.
- **Retired:** the IPD draft-and-generate endpoints
  (`/api/ipd/admissions/:id/charges`, `/generate-bill`) answer 410
  `IPD_BILLING_MOVED`; `hms_ipd_draft_charges` takes no new rows (existing
  rows were carried over as charges).

## The two IPD billing failures (Phase 1 known issues), fixed

1. *Advance not applied*: an advance larger than what was payable was never
   used. Deposits are now applied partly; the rest stays with the patient.
2. *Billing history*: followed from 1; the IPD bill now appears with its
   totals and the deposit shows what is left.

## Screens

| Path | Who | What |
|---|---|---|
| `/ipd/billing/:admissionId` | admin, nurse | Admission account: charges, add medicines, prepare and issue interim/final bills, deposits |
| `/billing/accounts/:id` | admin, reception | Any account, with insurance (coverage, eligibility, pre-authorisation, payer) |
| `/billing/desk` | admin, reception | Worklists: payments awaiting an answer, refunds, returned-medicine credits, claims, denials, accounts |
| `/billing/reconciliation` | admin (reception: own drawer) | Cash drawer, statement lines, checks, exceptions |
| `/billing/price-list` | admin | Price-list versions, packages, payers |
| `/ipd/saved-bills` | admin, nurse | Admissions with charges not billed yet |

API: `/api/finance/*` (see `backend/routes/finance.js`). Every command needs
an `Idempotency-Key`.

## How it was verified

Run on 2026-10-14 against a fresh copy of the Docker backup
(`~/hms-backups/20261012-143017/hms.dump`) migrated with this branch, backend
on 5032, Vite on 5204, browser and runner on UTC (see open item 6):

- `verify-migrations.sh`: PASS, fresh and upgraded schemas identical (3,423 facts).
- Backend unit tests: 10 pass, 0 fail. Frontend build: passes.
- e2e (in this order): medication 20/20, medicationGuards 9/9,
  medicationFrontend 6/6, opd 20/20, pharmacy 18/18, lab 10/10, **ipd 13/13**
  (both Phase 1 billing failures fixed), admin 28/28, authorization 5/5,
  sessions 7/7, frontendReliability 2/2, ipdDrafts 3/3, patientIdentity 9/9,
  patientMerge 8/8, practitioners 8/8, scheduling 6/6, careTeam 10/10,
  triage 7/7, clinicalDocuments 8/8, adt 8/8, referrals 8/8, **finance
  15/15**, audit 7/7.
- idempotency and durability failed in that run because they still counted
  advances in `hms_patient_advances` and used the retired IPD draft endpoint;
  after updating those two checks they pass on a fresh copy: idempotency
  8/8, durability 11/11 (run after the medication suites, as before).

Suites changed for Phase 5 behaviour: `ipd` (billing steps), `ipdDrafts`
(now IPD charges on the account), `opd` (historical pharmacy bill step;
appointment date check uses the browser's day), `idempotency` (counts
deposit receipts), `durability` (charge visible across processes).

`e2e/finance.e2e.js` (15 steps) covers the blueprint 5.3 finance scenarios
against real PostgreSQL with concurrent requests:

- charge capture (consultation once, tests, cancelled test reversed, charges
  immutable);
- concurrent bill generation issues once; issued invoices and journal lines
  cannot be changed;
- duplicate partial-payment retry replays the same receipt; racing payments
  never exceed the balance;
- card payment with no answer blocks a second collection until confirmed;
  provider references are unique;
- settlements match by reference and amount; mismatches become exceptions;
- payment racing a credit note: every rupee is applied or held for the
  patient;
- IPD: bed days priced by ward across a transfer, interim bill, stale review
  refused, discharge charges the rest, deposit partly applied, oversized and
  racing deposit allocations refused;
- refund: second-person approval, replay of the payout returns the same
  refund, no second payout, nothing beyond the deposit;
- package inclusions, allowance and exclusions;
- payer split capped by pre-authorisation, claim, partial denial,
  remittance (not above approval, reference once), denial passed to the
  patient;
- roles; cash drawer variance; reconciliation agrees with the journal.

## Open items (owner decisions)

Updated 2026-10-14 (Phase 6 branch): items 2, 3 and 6 are resolved and
item 1 is narrowed; see "Resolved since" below.

1. **Prices.** Version 1 copies today's tariff table and the code's
   fallbacks. Review the price list before go-live; the fallbacks (200/100,
   400/800) were never approved prices. Coded lab tests are now priced by
   catalogue identity (migration 0097), not by name.
2. **Card/UPI gateways** are not integrated: staff record the terminal's
   answer and reference; settlement lines are entered by hand.
3. **Quick Consult** still writes free-text prescriptions the pharmacy cannot
   dispense (from the Phase 2/3 integration); medicines prescribed there are
   not charged until they go through a coded order.
4. Deploying needs a backup first (`scripts/backup-db.sh`) and the owner's
   approval.

### Resolved since

- **Bills raised before Phase 5** (was item 2): what was still owed is an
  opening patient receivable; payments and discounts on them through the old
  path post to the journal; the receivables check counts them (0098).
- **OTC counter sales** (was item 3): each sale posts one balanced entry at
  commit (cash/card-UPI/bank against pharmacy revenue and GST), earlier
  sales were posted at migration, and a "Counter sales posted" check compares
  them with the sale lines (0098).
- **Time-zone bug** (was item 6): service dates use the hospital's time zone
  (0096); the OPD suite no longer needs the browser on UTC.
- **Lab pricing by name**: coded tests use a price tied to the catalogue
  test, else the tariff the catalogue names (`tariff_id`), else the default
  (0097). Tests `accounts.e2e.js`, `labPricing.e2e.js`, `serviceDate.e2e.js`.
