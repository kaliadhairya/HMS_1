// The hospital's calendar day (blueprint 3.2: service dates come from the
// facility time zone, initially Asia/Kolkata), not the server's UTC day.
// Between midnight and 05:30 IST the UTC date is still yesterday; using it
// put appointments and tokens booked then on the wrong day.
const facilityTz = () => process.env.FACILITY_TZ || 'Asia/Kolkata';

// 'YYYY-MM-DD' of the given instant in the facility's time zone.
const serviceDate = (at = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: facilityTz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

// The instant the given facility date ('YYYY-MM-DD') begins.
function facilityMidnight(ymd) {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: facilityTz(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(guess).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const asIfUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

module.exports = { facilityTz, serviceDate, facilityMidnight };
