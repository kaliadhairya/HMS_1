// Lists every Express endpoint and what it checks about the caller, as Markdown.
// Static source scan (no server or database needed):
//   public      no sign-in required
//   signed-in   any signed-in user, whatever their role
//   role        restrictTo/checkPermission, a req.user.role test in the handler,
//               or a call to a same-file helper that tests req.user.role
//   service     internal service token
// "role" means a role is checked somewhere; it does not prove the check is right.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

const mounts = [...server.matchAll(/app\.use\('([^']+)',\s*(require\('\.\/middleware\/auth'\)\.protect,\s*)?require\('\.\/(routes\/[^']+)'\)\)/g)]
  .map((m) => ({ prefix: m[1], mountProtect: Boolean(m[2]), file: `${m[3]}.js` }));

const ROLE_CHECK = /restrictTo\(|checkPermission\(/;
const rows = [];

for (const { prefix, mountProtect, file } of mounts) {
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // Inline guards defined as constants in the file, e.g.
  // const analyticsAccess = [protect, restrictTo('admin')];
  for (const [, name, value] of src.matchAll(/^const (\w+) = (\[?(?:protect|restrictTo|checkPermission)[^;]*);/gm)) {
    src = src.replace(new RegExp(`(router\\.\\w+\\([^)]*?)\\b${name}\\b`, 'g'), `$1${value}`);
  }
  // Helpers such as canReadPrescription(req) that test the caller's role.
  const roleHelpers = [...src.matchAll(/(?:function\s+(\w+)\s*\(req\b|const\s+(\w+)\s*=\s*\(req\b)[^]*?\n\}?;?\n/g)]
    .filter((m) => /req\.user\??\.role/.test(m[0]))
    .map((m) => m[1] || m[2]);
  const callsRoleHelper = (body) => roleHelpers.some((name) => new RegExp(`\\b${name}\\(req`).test(body));
  // router.use() only guards routes declared after it.
  const guards = [...src.matchAll(/router\.use\(([^;]*?)\);/g)].map((m) => ({
    at: m.index,
    protect: /\bprotect\b/.test(m[1]),
    role: ROLE_CHECK.test(m[1]),
    service: /x-internal-service-token/.test(m[1]),
  }));
  const decls = [...src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])(.+?)\2/g)];
  decls.forEach((d, i) => {
    const body = src.slice(d.index, i + 1 < decls.length ? decls[i + 1].index : src.length);
    const before = guards.filter((g) => g.at < d.index);
    const signedIn = mountProtect || before.some((g) => g.protect) || /\bprotect\b/.test(body.split(/=>|function/)[0]);
    const role = before.some((g) => g.role) || ROLE_CHECK.test(body.split(/async|=>/)[0]) || /req\.user\??\.role/.test(body) || callsRoleHelper(body);
    const service = before.some((g) => g.service);
    const access = service ? 'service' : !signedIn ? 'public' : role ? 'role' : 'signed-in';
    const line = src.slice(0, d.index).split('\n').length;
    rows.push({ method: d[1].toUpperCase(), path: `${prefix}${d[3] === '/' ? '' : d[3]}`, access, where: `${file}:${line}` });
  });
}

const count = (a) => rows.filter((r) => r.access === a).length;
const table = (list) => ['| Method | Path | Source |', '|---|---|---|', ...list.map((r) => `| ${r.method} | \`${r.path}\` | ${r.where} |`)].join('\n');

console.log(`# API access report

Generated ${new Date().toISOString()} by \`backend/scripts/api-report.js\` (static scan of ${mounts.length} mounted route files).

| Access | Endpoints |
|---|---:|
| Public (no sign-in) | ${count('public')} |
| Any signed-in user, no role check | ${count('signed-in')} |
| Role checked | ${count('role')} |
| Internal service token | ${count('service')} |
| **Total** | **${rows.length}** |

No endpoint checks facility, care-team or patient scope: a role check means
"any user with that role can act on any patient". This is a static scan; a
"no role check" endpoint may still limit rows in its query (for example a
doctor's own prescriptions).

## Public endpoints
${table(rows.filter((r) => r.access === 'public'))}

## Signed-in endpoints with no role check
Any signed-in account (for example a lab technician) can call these.

${table(rows.filter((r) => r.access === 'signed-in'))}

## Role-checked endpoints
${table(rows.filter((r) => r.access === 'role'))}
`);
