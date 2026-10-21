// The published v2 contract matches what the API answers (completion A3). Every successful v2
// command recorded during the run (the idempotency store keeps its original response) is checked
// against its operation's response schema, and a sample of reads is fetched and checked too.
// Run it last in a regression, after the suites that exercise the commands.
const fs = require('fs');
const path = require('path');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'backend', 'contracts', 'v2.openapi.json'), 'utf8'));
const schemas = spec.components.schemas;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The subset of JSON Schema the generator emits: $ref, anyOf, enum, type (or a list of types),
// properties/required/additionalProperties, items and the uuid/date-time/date formats.
function problems(value, schema, at = '$') {
  if (schema.$ref) return problems(value, schemas[schema.$ref.split('/').pop()], at);
  if (schema.anyOf) {
    const each = schema.anyOf.map((s) => problems(value, s, at));
    return each.some((p) => p.length === 0) ? [] : each.reduce((a, b) => (a.length <= b.length ? a : b));
  }
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} not in ${JSON.stringify(schema.enum)}`];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length) {
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.some((t) => t === kind || (t === 'number' && kind === 'integer'));
    if (!ok) return [`${at}: ${kind} where ${types.join('|')} is documented`];
  }
  if (schema.format === 'uuid' && typeof value === 'string' && !UUID.test(value)) return [`${at}: not a uuid`];
  if ((schema.format === 'date-time' || schema.format === 'date') && typeof value === 'string' && Number.isNaN(Date.parse(value))) return [`${at}: not a ${schema.format}`];
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum) return [`${at}: below ${schema.minimum}`];
  const out = [];
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => out.push(...problems(v, schema.items, `${at}[${i}]`)));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${at}.${k}: missing`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) out.push(...problems(v, schema.properties[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${at}.${k}: not documented`);
      else if (typeof schema.additionalProperties === 'object') out.push(...problems(v, schema.additionalProperties, `${at}.${k}`));
    }
  }
  return out;
}

// The operation a recorded request path belongs to.
const operations = Object.entries(spec.paths).flatMap(([p, methods]) => Object.entries(methods).map(([method, op]) => ({
  method: method.toUpperCase(), op, pattern: new RegExp('^/api/v2' + p.replace(/\{[^}]+\}/g, '[^/]+') + '$'),
})));
const find = (method, url) => operations.find((o) => o.method === method && o.pattern.test(url.split('?')[0]));
const responseSchema = (op, status) => op.responses[status]?.content?.['application/json']?.schema;

(async () => {
  const { step, done } = runner('V2 contract conformance');

  await step('Every recorded successful v2 command answered in its documented shape', async () => {
    const recorded = await sql(`SELECT method, path, response_status, response_body FROM hms_idempotency_keys
      WHERE path LIKE '/api/v2/%' AND state = 'completed' AND response_status BETWEEN 200 AND 299`);
    const seen = new Set();
    const failures = [];
    for (const r of recorded) {
      const match = find(r.method, r.path);
      if (!match) { failures.push(`${r.method} ${r.path}: no documented operation`); continue; }
      const schema = responseSchema(match.op, r.response_status);
      if (!schema) { failures.push(`${match.op.operationId}: status ${r.response_status} is not documented`); continue; }
      seen.add(match.op.operationId);
      for (const p of problems(r.response_body, schema)) failures.push(`${match.op.operationId}: ${p}`);
    }
    assert(recorded.length > 0, 'no v2 command was recorded; run this after the v2 suites');
    assert(failures.length === 0, `${failures.length} contract mismatches, e.g. ${[...new Set(failures)].slice(0, 12).join(' | ')}`);
    console.log(`    checked ${recorded.length} responses of ${seen.size} commands`);
  });

  await step('Reads of recorded resources answer in their documented shape', async () => {
    const tokens = { desk: await apiLogin('receptionist'), nurse: await apiLogin('nurse'), doctor: await apiLogin('doctor') };
    const last = async (pattern) => (await sql(`SELECT response_body->'data'->>'id' AS id FROM hms_idempotency_keys
      WHERE path ~ $1 AND state = 'completed' AND response_status BETWEEN 200 AND 299 ORDER BY created_at DESC LIMIT 1`, [pattern]))[0]?.id;
    const reads = [
      ['/v2/appointments/' + await last('^/api/v2/appointments$'), tokens.desk],
      ['/v2/admissions/' + await last('^/api/v2/admissions$'), tokens.nurse],
      ['/v2/lab-orders/' + await last('^/api/v2/lab-orders$'), await apiLogin('lab_technician')],
      ['/v2/events', tokens.nurse],
      ['/v2/events?cursor=0', tokens.nurse],
    ];
    const [account] = await sql("SELECT response_body->'data'->>'account_id' AS id FROM hms_idempotency_keys WHERE path ~ '^/api/v2/billing-accounts/[^/]+/invoices$' AND response_status = 201 ORDER BY created_at DESC LIMIT 1");
    if (account?.id) reads.push(['/v2/billing-accounts/' + account.id, tokens.desk]);
    const failures = [];
    let checked = 0;
    for (const [url, token] of reads) {
      if (url.endsWith('/undefined')) continue;
      const res = await fetch(API + url, { headers: { authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => null);
      if (res.status !== 200) { failures.push(`${url}: ${res.status} ${JSON.stringify(body).slice(0, 120)}`); continue; }
      const match = find('GET', '/api' + url);
      if (!match) { failures.push(`${url}: no documented operation`); continue; }
      checked += 1;
      for (const p of problems(body, responseSchema(match.op, 200))) failures.push(`${match.op.operationId}: ${p}`);
    }
    assert(checked >= 3, `only ${checked} reads could be checked`);
    assert(failures.length === 0, failures.slice(0, 6).join(' | '));
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
