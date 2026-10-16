// What each ABDM gateway callback must contain before it is processed
// (completion B2). The handlers in services/abdm.js read these fields; a
// callback missing one is refused with ABDM's error code and recorded as
// refused, instead of failing part-way through with a generic error.
// One of several paths may satisfy a requirement (written "a|b").

type Body = Record<string, unknown>;

const REQUIRED: Record<string, string[]> = {
  'patient-share': ['profile.patient|patient'],
  discover: ['transactionId', 'patient'],
  'link-init': ['transactionId', 'patient'],
  'link-confirm': ['confirmation.linkRefNumber', 'confirmation.token'],
  'on-generate-token': ['response.requestId', 'linkToken|error'],
  'on-carecontext': ['response.requestId'],
  'consent-hip-notify': ['notification.status', 'notification.consentId|notification.consentDetail.consentId'],
  'hi-request': ['transactionId', 'hiRequest.consent.id', 'hiRequest.dateRange.from', 'hiRequest.dateRange.to', 'hiRequest.dataPushUrl', 'hiRequest.keyMaterial'],
  'consent-on-init': ['response.requestId', 'consentRequest.id|error'],
  'consent-hiu-notify': ['notification.status', 'notification.consentRequestId'],
  'consent-on-fetch': ['consent.consentDetail|error', 'consent.status|error'],
  'hi-on-request': ['response.requestId', 'hiRequest.transactionId|error'],
  'data-push': ['transactionId', 'entries', 'keyMaterial'],
};

function at(body: unknown, path: string): unknown {
  let v: unknown = body;
  for (const part of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = (v as Body)[part];
  }
  return v;
}
const present = (v: unknown): boolean => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

// The requirements a callback body does not meet (empty when it is complete).
function missing(type: string, body: unknown): string[] {
  const rules = REQUIRED[type];
  if (!rules) return [`unknown callback type ${type}`];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['a JSON object body'];
  return rules.filter((rule) => !rule.split('|').some((path) => present(at(body, path))));
}

module.exports = { missing, REQUIRED };
