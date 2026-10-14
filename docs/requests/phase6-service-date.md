# Request (Phase 6 → Phase 3/4 owners): use the hospital's date, not UTC

Between 00:00 and 05:30 IST the UTC date is still yesterday. Phase 6 added
the hospital-date helpers (migration 0096, `utils/serviceDate.js`,
`frontend/src/utils/localDate.js`) and switched the Phase 2/5 code to them.
These lines in Phase 3/4 files still use the UTC day; please switch them when
convenient (no behaviour change outside that window):

| File | Line(s) | Today | Suggested |
|---|---|---|---|
| `backend/routes/lab.js` | 184, 202, 213 | `UPDATED_AT/CREATED_AT >= CURRENT_DATE` | `>= hms_service_day_start()` |
| `backend/routes/pharmacy.js` | 136, 224 | expiry `>= / < CURRENT_DATE` | `hms_service_today()` |
| `backend/routes/pharmacist_lms.js` | 14 uses | `CURRENT_DATE` | `hms_service_today()` for dates, `hms_service_day_start()` for timestamps |
| `backend/services/laboratoryResults.js` | 91–94 | age from `CURRENT_DATE` | `hms_service_today()` (age at the hospital's date) |
| `frontend/src/pages/hms/pharmacy/GRNPage.jsx` | 23, 115, 378 | `new Date().toISOString()` date | `localYmd()` |
| `frontend/src/pages/hms/pharmacy/PharmacyStockPage.jsx` | 236 | same | `localYmd()` |
| `frontend/src/pages/hms/pharmacy/MedicineMasterPage.jsx` | 507 | same (expiry `min`) | `localYmd()` |

Timestamps without a time zone in this schema hold UTC; `hms_service_date(ts)`
gives their hospital day.
