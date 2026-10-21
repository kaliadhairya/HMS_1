# Phase 5: revenue cycle (plan)

Branch `phase5/revenue-cycle`, cut from `integration/phase2-phase3` (816367e).
Worktree `../HMS_1-phase5`. Migrations 0070–0089. Agent: Claude.
Tests: databases `hms_p5_*`, backend 5032, Vite 5204.

Sources: blueprint 3.6 (revenue entities and the fixed financial
interpretation), 3.7 (revenue ERD), 4.4 (revenue cycle and its state
machines), 5.1 (exit criteria), 5.3 (finance acceptance scenarios);
`docs/NEXT_PHASES_PROMPT.md` Phase 5.

## What is wrong today

- OPD bills are calculated when the desk clicks "generate"; charges are not
  recorded when the service happens. Lab prices are matched by name, with
  hidden defaults (consultation 200, lab test 100) in the code.
- IPD ward rates are a constant in `routes/ipd.js`; IPD medicines are
  typed in by hand as draft lines.
- Coded dispensing (Phase 3) writes `hms_med_charges`, which nothing reads,
  so prescription medicines go out unbilled.
- A bill is edited after it is raised (discounts rewrite `net_payable`,
  later charges are added to a pending bill).
- An advance is used only whole; an advance larger than the balance is not
  applied at all (one of the two failing IPD steps). Payment "by advance"
  only relabels the payment mode.
- There is no journal, no refund, no credit note, no insurance and no
  reconciliation.

## Design

One **billing account** per episode: an OPD encounter, or an admission
(medicine and lab orders raised during an admission go to the admission's
account). The legacy `hms_bills` / `hms_bill_items` / `hms_payments` rows
become a read projection written when an invoice is issued or a receipt is
taken, so existing reports, the bill PDF and the history page keep working.

| Part | Content | Migration |
|---|---|---|
| 1 | Billing accounts; versioned charge master (backfilled from `hms_tariffs` and the code constants, with provenance); charge events unique per source, immutable, reversed by a linked reversal event | 0070 |
| 2 | Charge capture: consultation on finalize, lab order items (database trigger, so Phase 4 files are untouched), coded dispense lines (trigger on `hms_med_charges`), ward days from bed occupancy intervals (one charge per interval-day, transfers included), manual service charges | 0071 |
| 3 | Invoices `Draft → Issued → PartiallyCredited/Credited`, `Void` by control; lines freeze price snapshots; issued invoices immutable; credit and debit notes; packages (versioned, inclusions/exclusions/allowances) | 0072 |
| 4 | Financial journal: chart of accounts, balanced append-only transactions, one posting per business source | 0073 |
| 5 | Deposits (liability), payment intents `Initiated → Pending → Confirmed/Failed/Unknown`, receipts, allocations under lock, refunds `Requested → Approved → Submitted → Confirmed/Failed` with separate approver | 0074 |
| 6 | Insurance: coverage, eligibility, pre-authorisation with revisions, claims `Prepared → Submitted → Acknowledged → Adjudicated → Settled/Denied/Appealed`, claim lines, remittance, denials worklist; patient/payer split | 0075 |
| 7 | Reconciliation: cash sessions, bank/provider settlements, exceptions worklist; continuous checks (charges vs invoices, deposits vs allocations, journal vs receipts) | 0076 |
| 8 | Switch writers: `/api/billing/*` and the IPD bill path use the new domain; old IPD draft charges retired; the two failing IPD steps fixed | — |
| 9 | Screens: episode account (charges, invoice, deposits, payments, credit notes, refunds), insurance worklist, reconciliation; OPD and IPD billing pages moved over | — |
| 10 | Acceptance tests (blueprint 5.3 finance row), full regression, `verify-migrations`, README | — |

Not in scope: OTC counter sales keep their own sale record (they are paid at
the counter and already billed); posting them to the journal is listed as a
follow-up.

## Ownership

Phase 5 owns `routes/billing.js`, the billing section of `routes/ipd.js`,
new `routes/finance*.js` and `services/billing*.js`,
`frontend/src/pages/hms/billing/*`, the IPD billing pages and
`ReceptionistBillingPage.jsx`, and the bill section of `routes/pdfRoutes.js`.
Charge capture from lab and medicine sources uses database triggers, so
Phase 3 and Phase 4 files are not edited. Phase 4 is asked (in
`docs/requests/phase5-lab-charges.md`) to keep the order-item charge source
when it changes the lab tables.
