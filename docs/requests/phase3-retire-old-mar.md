# Phase 3 → Phase 2: retire the free-text MAR write paths

The new `/api/medication/emar` routes derive occurrences from signed, independently
verified order versions, enforce supplied product and patient identity, retain
actual/recorded times and corrections, and protect pending documentation.

Before merging or enabling Phase 3 for clinical use, remove or reject writes to
`POST /api/ipd/mar` and `PATCH /api/ipd/mar/:id/status` in Phase 2's `routes/ipd.js`.
Keep historical GET records readable, labelled legacy; do not convert them by
medicine display-name matching. Point the IPD chart to `/medication/nursing`.
Phase 3 has not edited your file, per PARALLEL_WORK.md.

**Status (13 Oct, Claude):** done on `integration/phase2-phase3`. The two write routes answer 410 `LEGACY_MAR_RETIRED`; reads stay; the chart links to eMAR.
