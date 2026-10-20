# Clinical release acceptance

## Engineering acceptance

Run the complete blueprint section 5.3 inventory on the exact candidate, with
real multi-connection PostgreSQL for races and a restricted runtime identity.
Record source/migration checksums, engine versions, build/image identifiers,
environment, failures and required skips. Check fresh and actual-source upgrade
paths on PG16/18, types/contracts, browser workflows, corruption/recovery,
worker restart and the declared workload. Old feature-branch reports and
passing subsets do not close release acceptance. Require a second reviewer
for the final hospital release decision; an agent cannot invent that review.

## Clinical and environment acceptance

The blueprint's initial envelope is 200 beds, 1,000 OPD visits/day and 200
concurrent users. Measure p95 common reads <250 ms, commands <500 ms and
worklist updates <2 seconds. The <1-second clinical-action target includes
the agreed hospital network; localhost observations do not establish it.
Record errors, contention, CPU/storage, backlog, freshness and environment
limits. Investigate failures rather than omitting slow/failed requests.

Each named lead validates their configured scope on the actual equipment:
clinical policies and credentials, formulary/CDS coverage, laboratory methods
and escalation, tariffs/insurance/tax, document scanning/privacy/retention,
exchange and device contracts, and operational recovery. Record multilingual
print review, accessibility/keyboard rehearsals, downtime drills and incident
contacts. A disabled or unconfigured capability is listed as such.

## Assessment records

Copy the empty assessment template to a site-specific protected evidence
directory. Supply real owner names, exact release/environment/site/scope,
dated reviews, expiry, decision references and relative artifact checksums.
Keep patient payloads and credentials out of the repository. Run
`node scripts/phase7/readiness.js --record <assessment> --stage OPD --json`,
then repeat for WARD/EXPANSION when applicable. BLOCKED is an honest pending
result. REVIEW_REQUIRED means a human decision is still needed, never that
the checker authorized clinical use. Invalid evidence cannot supersede a
previous failure. Preserve previous decisions and explicit supersession.
