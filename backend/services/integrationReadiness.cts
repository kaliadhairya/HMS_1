// Readiness of the outside connections a hospital depends on (completion B2):
// the ABDM configuration (complete, which environment, callbacks verifiable)
// and the terminology content (which editions are active, and whether any
// of them is synthetic test content rather than the licensed release).
// It reports; it never changes configuration. Secrets are never returned.
const { sequelize } = require('../models/db');

type Status = 'ok' | 'warning' | 'blocked' | 'off';
type Check = { area: string; item: string; status: Status; detail: string };
const rows = (sql: string): Promise<any[]> => sequelize.query(sql, { type: 'SELECT' });

const SYNTHETIC = /synthetic|\btest\b|e2e|fixture|sample|demo/i;
const local = (url: string): boolean => /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(url);
const production = (): boolean => process.env.NODE_ENV === 'production';

// Which ABDM environment the gateway URL points at.
function abdmMode(url: string): 'mock' | 'sandbox' | 'production' {
  if (process.env.ABDM_MOCK_URL || local(url)) return 'mock';
  if (/sbx|sandbox|dev\.abdm|\.sbx\./i.test(url)) return 'sandbox';
  return 'production';
}

function abdm(): Check[] {
  const e = process.env;
  const area = 'ABDM';
  if (!e.ABDM_GATEWAY_URL && !e.ABDM_CLIENT_ID && !e.ABDM_CLIENT_SECRET) {
    return [{ area, item: 'Configuration', status: 'off', detail: 'ABDM is not configured; ABHA, consent and record exchange are unavailable.' }];
  }
  const out: Check[] = [];
  const missing = ['ABDM_GATEWAY_URL', 'ABDM_CLIENT_ID', 'ABDM_CLIENT_SECRET', 'ABDM_HIP_ID', 'ABDM_HIU_ID', 'ABDM_BRIDGE_PUBLIC_URL', 'ABDM_GATEWAY_JWKS_URL'].filter((k) => !e[k]);
  out.push(missing.length
    ? { area, item: 'Required settings', status: 'blocked', detail: `Missing: ${missing.join(', ')}.` }
    : { area, item: 'Required settings', status: 'ok', detail: 'Gateway, client, HIP/HIU IDs, bridge URL and gateway keys are set.' });
  const mode = abdmMode(e.ABDM_GATEWAY_URL || '');
  out.push({ area, item: 'Environment', status: mode === 'production' ? 'ok' : production() ? 'blocked' : 'warning',
    detail: mode === 'mock' ? 'A local mock gateway: exchanges are simulated, not with ABDM.'
      : mode === 'sandbox' ? 'The ABDM sandbox: registered test environment, not live patients.' : 'The ABDM production gateway.' });
  const cm = e.ABDM_CM_ID || 'sbx';
  if (mode === 'production' && cm === 'sbx') out.push({ area, item: 'Consent manager ID', status: 'blocked', detail: 'ABDM_CM_ID is the sandbox value (sbx) for a production gateway.' });
  const bridge = e.ABDM_BRIDGE_PUBLIC_URL || '';
  if (bridge) {
    const ok = mode === 'mock' || (/^https:\/\//i.test(bridge) && !local(bridge));
    out.push({ area, item: 'Callback address', status: ok ? 'ok' : 'blocked', detail: ok ? 'ABDM can reach the bridge at its public address.' : 'ABDM_BRIDGE_PUBLIC_URL must be a public https address for ABDM to call back.' });
  }
  if ((e.ABDM_CLIENT_SECRET || '').length && (e.ABDM_CLIENT_SECRET || '').length < 16 && mode !== 'mock') {
    out.push({ area, item: 'Client secret', status: 'warning', detail: 'The client secret is unusually short; check it is the one ABDM issued.' });
  }
  out.push({ area, item: 'Callback contracts', status: 'ok', detail: 'Incoming callbacks are checked for their required fields before processing (domain/abdmContracts.cts).' });
  return out;
}

async function terminology(): Promise<Check[]> {
  const area = 'Terminology';
  const systems = await rows(`SELECT s.code, s.name, r.version, r.source, r.licence_ack, r.activated_at
    FROM hms_term_systems s LEFT JOIN hms_term_releases r ON r.system_id = s.id AND r.status = 'Active' ORDER BY s.code`);
  const out: Check[] = systems.map((s) => {
    if (!s.version) {
      return { area, item: s.code, status: s.code === 'ICD10' ? 'warning' : 'off',
        detail: s.code === 'ICD10' ? 'No ICD-10 edition is active: diagnoses use the small built-in list and record no edition.' : `No ${s.name || s.code} release is active.` } as Check;
    }
    const synthetic = SYNTHETIC.test(`${s.version} ${s.source} ${s.licence_ack}`);
    return { area, item: s.code, status: synthetic ? (production() ? 'blocked' : 'warning') : 'ok',
      detail: synthetic ? `Active release ${s.version} is synthetic test content (${s.source}), not the licensed edition.`
        : `Release ${s.version} active since ${new Date(s.activated_at).toISOString().slice(0, 10)}; licence: ${s.licence_ack}.` } as Check;
  });
  const [m] = await rows("SELECT count(*) FILTER (WHERE status = 'Proposed')::int AS pending FROM hms_term_mappings");
  if (m?.pending) out.push({ area, item: 'Mappings', status: 'warning', detail: `${m.pending} mapping(s) wait for a second reviewer and are not used yet.` });
  return out;
}

async function readiness() {
  const checks = [...abdm(), ...await terminology()];
  const worst = checks.some((c) => c.status === 'blocked') ? 'blocked' : checks.some((c) => c.status === 'warning') ? 'warning' : 'ok';
  return {
    status: worst,
    checks,
    external_gates: [
      'ABDM sandbox registration and a recorded real exchange (milestones M1–M3) are evidence HMS cannot create.',
      'Licensed terminology content (ICD-10, SNOMED CT, LOINC) is loaded from the hospital\'s licensed files.',
    ],
  };
}

module.exports = { readiness, abdmMode };
