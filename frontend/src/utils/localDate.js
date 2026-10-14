// Service dates belong to the hospital, regardless of the browser time zone.
let facilityTimezone = import.meta.env?.VITE_FACILITY_TZ || 'Asia/Kolkata';
export function setFacilityTimezone(timezone) {
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  facilityTimezone = timezone;
}
export function localYmd(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: facilityTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
export function nextLocalDate(d = new Date()) {
  const day = new Date(`${localYmd(d)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
