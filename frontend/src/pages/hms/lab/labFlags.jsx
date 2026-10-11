// Reference-range flags for lab results. Mirrors abnormalFlag() in backend/routes/lab.js, which is
// the source of truth for saved results; this copy only drives the live preview while typing.
// Accepted ranges: "12-16", "3.5 - 5.1 mmol/L", "70 to 110", "<200", ">40". Ambiguous ranges
// (e.g. sex-specific "M: 12-16, F: 10-14") and non-numeric results give no flag.
const NUM = '[-+]?\\d+(?:\\.\\d+)?';
const RANGE_RE = new RegExp(`^\\s*(${NUM})\\s*(?:-|–|—|to)\\s*(${NUM})`, 'i');
const UPPER_RE = new RegExp(`^\\s*(?:<=?|≤|up\\s*to|below)\\s*(${NUM})`, 'i');
const LOWER_RE = new RegExp(`^\\s*(?:>=?|≥|above)\\s*(${NUM})`, 'i');
const SECOND_RANGE_RE = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}|[<>≤≥]`, 'i');
const VALUE_RE = new RegExp(`^\\s*(${NUM})\\s*(?:[a-zA-Zµ%][a-zA-Z0-9µ%/^.]*\\s*)?$`);

function parseReferenceRange(range) {
  const text = String(range || '').trim();
  if (!text) return null;
  let m = text.match(RANGE_RE);
  let bounds = null;
  if (m) bounds = { low: Number(m[1]), high: Number(m[2]) };
  else if ((m = text.match(UPPER_RE))) bounds = { low: null, high: Number(m[1]) };
  else if ((m = text.match(LOWER_RE))) bounds = { low: Number(m[1]), high: null };
  if (!bounds) return null;
  if (SECOND_RANGE_RE.test(text.slice(m[0].length))) return null;
  if (bounds.low !== null && bounds.high !== null && bounds.low > bounds.high) return null;
  return bounds;
}

export function abnormalFlag(resultValue, referenceRange) {
  const bounds = parseReferenceRange(referenceRange);
  if (!bounds) return null;
  const m = String(resultValue ?? '').match(VALUE_RE);
  if (!m) return null;
  const value = Number(m[1]);
  if (bounds.low !== null && value < bounds.low) return 'Low';
  if (bounds.high !== null && value > bounds.high) return 'High';
  return 'Normal';
}

export const isAbnormal = (flag) => flag === 'High' || flag === 'Low';

// Status pill for a result flag: "High" / "Low" (danger) or "In range" (success).
export function FlagTag({ flag }) {
  if (!flag) return null;
  return (
    <span className={`status status-${isAbnormal(flag) ? 'danger' : 'success'}`} title={isAbnormal(flag) ? `${flag}: outside the reference range` : 'Within the reference range'}>
      {isAbnormal(flag) ? flag : 'In range'}
    </span>
  );
}

export const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
