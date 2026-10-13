# Phase 3 request: stable pharmacist dashboard keys

The existing `frontend/src/components/dashboards/PharmacistDashboard.jsx`
uses `GENERIC_NAME` as the React key for the lowest-stock rows (line 149 at
Phase 1 base). Two products with the same name and different strengths produce
React duplicate-key warnings. Use the stable medicine ID from `/pharmacy/stock/low`.

This component is outside Phase 3's owned directories, so its owner should
apply the one-line correction during integration. Phase 3 fixtures now use
unique display names; the clean medication browser workflow passes without
warnings. This request does not relax clinical product identity checks.
