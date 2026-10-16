// Live-event rules (completion A8).
//
// An event is a pointer, not a copy of the record: it names what changed by
// identifier and the screen re-reads the details through the API, which
// applies the reader's access. So an event payload holds identifiers, codes,
// counts and flags only; never names, contact details or clinical text.
//
// Delivery follows the API's patient scope: a doctor receives a patient's
// events only while that patient is in their care (care team, admitting
// doctor or break-glass). Other roles are not limited by care, as on the API.

type Scalar = string | number | boolean | null;
type EventPayload = Record<string, Scalar | Scalar[]>;
type OutboxRow = {
  id: string | number; event_type: string; payload: unknown; created_at: unknown; delivery_sequence: string | number;
  patient_id?: number | string | null; schema_version?: number | string | null;
  aggregate_type?: string | null; aggregate_id?: string | null; request_id?: string | null;
};

const MAX_TEXT = 100;
// Keys that name an identifier are always allowed (order_id, patientId, ids).
const IDENTIFIER_KEY = /(^id$|_id$|Id$|_ids$|Ids$)/;
// Fragments of keys that would carry who the patient is or what is wrong.
const IDENTIFYING = ['name', 'uhid', 'abha', 'phone', 'mobile', 'email', 'address', 'dob', 'birth', 'diagnos',
  'reason', 'note', 'comment', 'text', 'complaint', 'history', 'finding', 'requirement', 'instruction', 'allerg', 'content', 'orders'];

function fail(message: string): never { throw Object.assign(new Error(message), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' }); }

function isScalar(v: unknown): v is Scalar {
  return v === null || typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= MAX_TEXT);
}

// Throws when a payload carries more than pointers. A programming error, so
// the command that published it fails rather than broadcasting patient data.
function assertMinimal(eventType: string, payload: unknown): EventPayload {
  if (payload === undefined || payload === null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) fail(`${eventType}: the payload must be an object of identifiers`);
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    // Words of the key (PATIENT_NAME, patientName -> patient, name): "orderStatus" is not "orders".
    const words = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (!IDENTIFIER_KEY.test(key) && words.some((word) => IDENTIFYING.some((part) => word.startsWith(part)))) fail(`${eventType}: "${key}" would publish patient details; send an identifier and let the screen re-read it`);
    const ok = Array.isArray(value) ? value.length <= 100 && value.every(isScalar) : isScalar(value);
    if (!ok) fail(`${eventType}: "${key}" must be an identifier, code, number or flag (at most ${MAX_TEXT} characters)`);
  }
  return payload as EventPayload;
}

// The patient an event concerns: stated explicitly, or read from the payload.
function patientOf(payload: EventPayload, explicit?: number | string | null): number | null {
  const raw = explicit ?? payload.patient_id ?? payload.patientId ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) fail(`patient ${String(raw)} is not a patient identifier`);
  return id;
}

// Whether a role must have the patient in care to receive the patient's events.
function needsCare(role: string | undefined): boolean { return role === 'doctor'; }

// What the browser receives: the payload plus the envelope.
function toClientEvent(row: OutboxRow): Record<string, unknown> {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {});
  return {
    ...payload,
    event_id: Number(row.id),
    event_type: row.event_type,
    schema_version: Number(row.schema_version ?? 1),
    delivery_sequence: Number(row.delivery_sequence),
    occurred_at: row.created_at,
    ...(row.patient_id != null ? { patient_id: Number(row.patient_id) } : {}),
    ...(row.aggregate_type ? { aggregate: { type: row.aggregate_type, id: row.aggregate_id } } : {}),
    ...(row.request_id ? { correlation_id: row.request_id } : {}),
  };
}

module.exports = { assertMinimal, patientOf, needsCare, toClientEvent };
