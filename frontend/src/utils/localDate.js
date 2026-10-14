// Today's date on the user's own calendar ('YYYY-MM-DD'). toISOString() gives
// the UTC date, which in India is still yesterday until 05:30 in the morning.
export function localYmd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
