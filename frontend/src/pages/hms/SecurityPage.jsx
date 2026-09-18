import { useState, useEffect, useCallback } from 'react';
import Navbar from '../../components/Navbar';
import api from '../../api/axios';

// ─── Priority Badges ──────────────────────────────────
const PB = { Critical: '#ef4444', High: '#fbbf24', Medium: '#94a3b8' };

// ─── Sidebar Navigation Items ─────────────────────────
const NAV = [
  { id: 'center',       icon: '🛡️', label: 'Security Center',     section: 'Security' },
  { id: 'sessions',     icon: '🖥️', label: 'Session Manager',     section: 'Security' },
  { id: '2fa',          icon: '🔑', label: '2FA Management',      section: 'Security' },
  { id: 'ip-rules',     icon: '🌐', label: 'IP Whitelist/Blacklist', section: 'Security' },
  { id: 'audit',        icon: '📋', label: 'Audit Trail',         section: 'System' },
  { id: 'health',       icon: '💓', label: 'System Health',       section: 'System' },
  { id: 'backups',      icon: '📦', label: 'Backup & Recovery',   section: 'System' },
  { id: 'maintenance',  icon: '🔨', label: 'Maintenance Mode',    section: 'System' },
  { id: 'api-keys',     icon: '⚡', label: 'API Manager',         section: 'Integrations' },
  { id: 'integrations', icon: '🏥', label: 'Integration Hub',     section: 'Integrations' },
  { id: 'notifications',icon: '🔔', label: 'Notification Config',  section: 'Integrations' },
  { id: 'compliance',   icon: '📑', label: 'Compliance Center',   section: 'Compliance' },
  { id: 'data-gov',     icon: '📝', label: 'Data Governance',     section: 'Compliance' },
  { id: 'licenses',     icon: '🪪', label: 'License Manager',     section: 'Compliance' },
  { id: 'announcements',icon: '📢', label: 'Announcements',       section: 'Operations' },
  { id: 'error-logs',   icon: '🐛', label: 'Error Logs',          section: 'Operations' },
  { id: 'role-templates',icon: '🏷️', label: 'Role Templates',     section: 'Operations' },
];

// ─── Helper Components ─────────────────────────────────
function StatCard({ icon, label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color || 'var(--green)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: '1.4rem' }}>{icon}</span>
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
          {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, marginTop: 24 }}>{children}</div>;
}

// ═══════════════════════════════════════════════════════
// SECURITY CENTER PANEL
// ═══════════════════════════════════════════════════════
function SecurityCenterPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/security/center').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); }, []);
  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (!data) return <p>Failed to load.</p>;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🛡️ Security Center</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Real-time threat monitoring and access alerts</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard icon="🚨" label="Failed Logins Today" value={data.failed_logins_today} color={data.failed_logins_today > 0 ? '#ef4444' : 'var(--green)'} />
        <StatCard icon="📊" label="Failed This Week" value={data.failed_logins_week} color="#fbbf24" />
        <StatCard icon="🔒" label="Locked Accounts" value={data.locked_accounts} color={data.locked_accounts > 0 ? '#ef4444' : 'var(--green)'} />
        <StatCard icon="✅" label="Logins Today" value={data.logins_today} color="var(--green)" />
      </div>

      {data.suspicious_ips?.length > 0 && (
        <>
          <SectionTitle>⚠️ Suspicious IPs (3+ failures today)</SectionTitle>
          <div className="table-wrapper" style={{ marginBottom: 24 }}>
            <table><thead><tr><th>IP Address</th><th>Attempts</th><th>Status</th></tr></thead>
              <tbody>{data.suspicious_ips.map((ip, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{ip.IP_ADDRESS}</td>
                  <td><span className="badge badge-red">{ip.ATTEMPTS} attempts</span></td>
                  <td>{data.blocked_ips.includes(ip.IP_ADDRESS) ? <span className="badge badge-red">Blocked</span> : <span className="badge badge-amber">Monitoring</span>}</td>
                </tr>
              ))}</tbody></table>
          </div>
        </>
      )}

      <SectionTitle>Recent Failed Login Attempts</SectionTitle>
      <div className="table-wrapper" style={{ maxHeight: 400, overflowY: 'auto' }}>
        <table><thead><tr><th>User</th><th>IP Address</th><th>Time</th><th>Details</th></tr></thead>
          <tbody>
            {data.recent_failed?.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No failed login attempts. System is secure. ✅</td></tr>}
            {data.recent_failed?.map((log, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{log.USERNAME || log.USER_NAME || `User #${log.USER_ID}`}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.IP_ADDRESS || '—'}</td>
                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{log.CREATED_AT ? new Date(log.CREATED_AT).toLocaleString('en-IN') : '—'}</td>
                <td style={{ fontSize: '0.78rem' }}>{log.NEW_VALUE ? JSON.parse(log.NEW_VALUE)?.reason || JSON.parse(log.NEW_VALUE)?.attempts + ' attempts' : '—'}</td>
              </tr>
            ))}
          </tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SESSION MANAGER PANEL
// ═══════════════════════════════════════════════════════
function SessionManagerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => api.get('/security/sessions').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const forceLogout = async (userId) => {
    if (!confirm('Force logout this user? Their session will be terminated.')) return;
    try { await api.post(`/security/sessions/${userId}/force-logout`); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const now = new Date();
  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>🖥️ Session Manager</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Monitor and control active user sessions</p></div>
        <button className="btn btn-outline" onClick={load}>↻ Refresh</button>
      </div>

      <div className="table-wrapper">
        <table><thead><tr><th>User</th><th>Role</th><th>Last Active</th><th>Status</th><th>Failed</th><th>Actions</th></tr></thead>
          <tbody>{data?.sessions?.map(s => {
            const lastLogin = s.LAST_LOGIN ? new Date(s.LAST_LOGIN) : null;
            const isRecent = lastLogin && (now - lastLogin < 8 * 3600000);
            const isLocked = s.LOCKED_UNTIL && new Date(s.LOCKED_UNTIL) > now;
            return (
              <tr key={s.ID}>
                <td><div style={{ fontWeight: 600 }}>{s.NAME}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.USERNAME}</div></td>
                <td><span className={`badge badge-${s.ROLE === 'super_admin' ? 'red' : s.ROLE === 'doctor' ? 'blue' : 'green'}`}>{s.ROLE?.replace(/_/g, ' ')}</span></td>
                <td style={{ fontSize: '0.82rem' }}>{lastLogin ? lastLogin.toLocaleString('en-IN') : 'Never'}</td>
                <td>{isLocked ? <span className="badge badge-red">Locked</span> : isRecent ? <span className="badge badge-green">Active</span> : <span className="badge" style={{ background: 'var(--surface-3)' }}>Inactive</span>}</td>
                <td>{s.FAILED_ATTEMPTS > 0 ? <span className="badge badge-amber">{s.FAILED_ATTEMPTS}</span> : '0'}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  {isLocked
                    ? <button className="btn btn-sm btn-outline" onClick={async () => { await api.post(`/security/users/${s.ID}/unlock`); load(); }}>🔓 Unlock</button>
                    : <button className="btn btn-sm btn-ghost" style={{ color: '#ef4444' }} onClick={() => forceLogout(s.ID)}>⛔ End</button>}
                </td>
              </tr>
            );
          })}</tbody></table>
      </div>

      <SectionTitle>Session Timeout Config (minutes)</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        {Object.entries(data?.timeout_settings || {}).map(([role, mins]) => (
          <div key={role} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>{role.replace(/_/g, ' ')}</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{mins} min</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// 2FA MANAGEMENT PANEL
// ═══════════════════════════════════════════════════════
function TwoFAPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enforced, setEnforced] = useState([]);
  useEffect(() => { api.get('/security/2fa').then(r => { setData(r.data.data); setEnforced(r.data.data.enforced_roles || []); }).catch(console.error).finally(() => setLoading(false)); }, []);

  const toggleRole = (role) => {
    setEnforced(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };
  const save = async () => {
    try { await api.put('/security/2fa', { enforced_roles: enforced }); alert('2FA settings saved!'); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const roles = data?.role_breakdown || [];
  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🔑 Two-Factor Authentication</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Enforce 2FA per role to strengthen authentication</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard icon="👥" label="Total Active Users" value={data?.total_users || 0} color="var(--blue)" />
        <StatCard icon="🔐" label="2FA Enforced Roles" value={enforced.length} color={enforced.length > 0 ? 'var(--green)' : '#ef4444'} />
        <StatCard icon="📈" label="Compliance" value={data?.total_users > 0 ? Math.round((enforced.length / (roles.length || 1)) * 100) + '%' : '0%'} color="var(--teal)" />
      </div>

      <SectionTitle>Enforce 2FA by Role</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        {roles.map(r => {
          const isOn = enforced.includes(r.ROLE);
          return (
            <div key={r.ROLE} onClick={() => toggleRole(r.ROLE)} style={{
              background: isOn ? 'rgba(16,185,129,0.08)' : 'var(--surface)',
              border: `2px solid ${isOn ? 'var(--green)' : 'var(--border)'}`,
              borderRadius: 12, padding: '16px 20px', cursor: 'pointer', transition: 'all 0.2s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{r.ROLE?.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{r.CNT || r.cnt} users</div>
                </div>
                <div style={{
                  width: 44, height: 24, borderRadius: 12, padding: 2,
                  background: isOn ? 'var(--green)' : 'var(--surface-3)', transition: 'all 0.2s',
                  display: 'flex', alignItems: isOn ? 'center' : 'center', justifyContent: isOn ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn btn-primary" onClick={save}>💾 Save 2FA Configuration</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// IP WHITELIST / BLACKLIST PANEL
// ═══════════════════════════════════════════════════════
function IPRulesPanel() {
  const [whitelist, setWhitelist] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [newWL, setNewWL] = useState('');
  const [newBL, setNewBL] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/security/ip-rules').then(r => { setWhitelist(r.data.data.whitelist); setBlacklist(r.data.data.blacklist); }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try { await api.put('/security/ip-rules', { whitelist, blacklist }); alert('IP rules saved!'); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🌐 IP Access Control</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Restrict login access to trusted networks</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Whitelist */}
        <div className="card" style={{ borderTop: '3px solid var(--green)' }}>
          <h3 style={{ color: 'var(--green)', marginBottom: 12 }}>✅ Whitelist ({whitelist.length})</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>Only these IPs can access the system (empty = allow all)</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="form-input" placeholder="e.g. 10.2.111.0/24" value={newWL} onChange={e => setNewWL(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={() => { if (newWL) { setWhitelist([...whitelist, newWL]); setNewWL(''); } }}>Add</button>
          </div>
          {whitelist.map((ip, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 6, marginBottom: 6, fontFamily: 'monospace', fontSize: '0.85rem' }}>
              {ip} <button className="btn btn-ghost btn-sm" onClick={() => setWhitelist(whitelist.filter((_, j) => j !== i))} style={{ color: '#ef4444', padding: '2px 6px' }}>✕</button>
            </div>
          ))}
        </div>
        {/* Blacklist */}
        <div className="card" style={{ borderTop: '3px solid #ef4444' }}>
          <h3 style={{ color: '#ef4444', marginBottom: 12 }}>🚫 Blacklist ({blacklist.length})</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>These IPs are permanently blocked from accessing the system</p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input className="form-input" placeholder="e.g. 192.168.1.100" value={newBL} onChange={e => setNewBL(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-sm" style={{ background: '#ef4444', color: '#fff' }} onClick={() => { if (newBL) { setBlacklist([...blacklist, newBL]); setNewBL(''); } }}>Block</button>
          </div>
          {blacklist.map((ip, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'rgba(239,68,68,0.05)', borderRadius: 6, marginBottom: 6, fontFamily: 'monospace', fontSize: '0.85rem', border: '1px solid rgba(239,68,68,0.15)' }}>
              {ip} <button className="btn btn-ghost btn-sm" onClick={() => setBlacklist(blacklist.filter((_, j) => j !== i))} style={{ color: 'var(--text-muted)', padding: '2px 6px' }}>✕</button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 20 }}><button className="btn btn-primary" onClick={save}>💾 Save IP Rules</button></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// AUDIT TRAIL PANEL
// ═══════════════════════════════════════════════════════
function AuditTrailPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', module: '', from_date: '', to_date: '', page: 1 });

  const load = useCallback(() => {
    setLoading(true);
    const q = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    api.get(`/security/audit-trail?${q}`).then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const actionColor = (a) => a === 'LOGIN' ? 'green' : a === 'LOGIN_FAILED' ? 'red' : a === 'CREATE' ? 'blue' : a === 'DELETE' ? 'red' : a === 'FORCE_LOGOUT' ? 'amber' : 'teal';

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>📋 Audit Trail</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Immutable log of every action — who, what, when, where</p>

      <div className="card" style={{ marginBottom: 20, padding: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 140 }}>
          <label className="form-label" style={{ fontSize: '0.7rem' }}>Action</label>
          <select className="form-select" value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value, page: 1 })}>
            <option value="">All Actions</option>
            {data?.filters?.actions?.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 140 }}>
          <label className="form-label" style={{ fontSize: '0.7rem' }}>Module</label>
          <select className="form-select" value={filters.module} onChange={e => setFilters({ ...filters, module: e.target.value, page: 1 })}>
            <option value="">All Modules</option>
            {data?.filters?.modules?.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
          <label className="form-label" style={{ fontSize: '0.7rem' }}>From</label>
          <input type="date" className="form-input" value={filters.from_date} onChange={e => setFilters({ ...filters, from_date: e.target.value, page: 1 })} />
        </div>
        <div className="form-group" style={{ margin: 0, minWidth: 140 }}>
          <label className="form-label" style={{ fontSize: '0.7rem' }}>To</label>
          <input type="date" className="form-input" value={filters.to_date} onChange={e => setFilters({ ...filters, to_date: e.target.value, page: 1 })} />
        </div>
        <button className="btn btn-outline" onClick={() => setFilters({ action: '', module: '', from_date: '', to_date: '', page: 1 })}>Clear</button>
      </div>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div> : (
        <>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Showing {data?.logs?.length} of {data?.total} records • Page {data?.page}/{data?.pages || 1}
          </div>
          <div className="table-wrapper" style={{ maxHeight: 500, overflowY: 'auto' }}>
            <table><thead><tr><th>User</th><th>Action</th><th>Module</th><th>IP Address</th><th>Details</th><th>Timestamp</th></tr></thead>
              <tbody>{data?.logs?.map((log, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{log.USERNAME || log.USER_NAME || `#${log.USER_ID}`}</td>
                  <td><span className={`badge badge-${actionColor(log.ACTION)}`}>{log.ACTION}</span></td>
                  <td>{log.MODULE || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.IP_ADDRESS || '—'}</td>
                  <td style={{ fontSize: '0.78rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.NEW_VALUE || '—'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{log.CREATED_AT ? new Date(log.CREATED_AT).toLocaleString('en-IN') : '—'}</td>
                </tr>
              ))}</tbody></table>
          </div>
          {data?.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-outline btn-sm" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>← Prev</button>
              <span style={{ padding: '6px 16px', fontSize: '0.85rem' }}>Page {data.page} of {data.pages}</span>
              <button className="btn btn-outline btn-sm" disabled={data.page >= data.pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SYSTEM HEALTH PANEL
// ═══════════════════════════════════════════════════════
function SystemHealthPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.get('/security/system-health').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); };
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, []);
  if (loading && !data) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const memPct = parseFloat(data?.memory?.usage_percent || 0);
  const memColor = memPct > 90 ? '#ef4444' : memPct > 70 ? '#fbbf24' : 'var(--green)';

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>💓 System Health</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Live server metrics — auto-refreshes every 15s</p></div>
        <button className="btn btn-outline" onClick={load}>↻ Refresh</button>
      </div>

      {/* Services Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 28 }}>
        {data?.services?.map(s => (
          <div key={s.name} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div><div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.name}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{s.uptime || s.response || ''}</div></div>
            <span className={`badge badge-${s.status === 'running' || s.status === 'healthy' || s.status === 'active' ? 'green' : 'red'}`}>{s.status}</span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Memory */}
        <div className="card">
          <SectionTitle>Memory Usage</SectionTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ position: 'relative', width: 100, height: 100 }}>
              <svg viewBox="0 0 36 36" style={{ width: 100, height: 100, transform: 'rotate(-90deg)' }}>
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="var(--border)" strokeWidth="3" />
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={memColor} strokeWidth="3" strokeDasharray={`${memPct}, 100`} strokeLinecap="round" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '1.1rem', color: memColor }}>{memPct}%</div>
            </div>
            <div style={{ fontSize: '0.85rem' }}>
              <div><strong>Total:</strong> {data?.memory?.total_gb} GB</div>
              <div><strong>Used:</strong> {data?.memory?.used_gb} GB</div>
              <div><strong>Free:</strong> {data?.memory?.free_gb} GB</div>
            </div>
          </div>
        </div>

        {/* Server Info */}
        <div className="card">
          <SectionTitle>Server Information</SectionTitle>
          <table style={{ width: '100%', fontSize: '0.85rem' }}><tbody>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>Uptime</td><td style={{ fontWeight: 600 }}>{data?.server?.uptime_human}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>Platform</td><td>{data?.server?.platform} ({data?.server?.arch})</td></tr>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>Node.js</td><td>{data?.server?.node_version}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>CPU Cores</td><td>{data?.cpu?.cores}</td></tr>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>DB Response</td><td style={{ color: data?.database?.response_time_ms > 200 ? '#ef4444' : 'var(--green)', fontWeight: 600 }}>{data?.database?.response_time_ms}ms</td></tr>
            <tr><td style={{ color: 'var(--text-muted)', padding: '4px 0' }}>DB Records</td><td>{data?.database?.total_users} users, {data?.database?.total_audit_logs} audit logs</td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// BACKUP & RECOVERY PANEL
// ═══════════════════════════════════════════════════════
function BackupPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const load = () => api.get('/security/backups').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const triggerBackup = async () => {
    setTriggering(true);
    try { await api.post('/security/backups/trigger'); load(); alert('Backup completed!'); } catch { alert('Backup failed'); }
    setTriggering(false);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>📦 Backup & Recovery</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Manage database backups and restore points</p></div>
        <button className="btn btn-primary" onClick={triggerBackup} disabled={triggering}>{triggering ? <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : '🔄 Trigger Manual Backup'}</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
        <StatCard icon="📅" label="Schedule" value={data?.schedule?.frequency} sub={`at ${data?.schedule?.time}`} color="var(--blue)" />
        <StatCard icon="🕐" label="Last Backup" value={data?.last_backup ? new Date(data.last_backup).toLocaleDateString() : 'Never'} color="var(--green)" />
        <StatCard icon="📁" label="Retention" value={`${data?.schedule?.retention_days} days`} color="var(--teal)" />
      </div>

      <SectionTitle>Backup History</SectionTitle>
      <div className="table-wrapper">
        <table><thead><tr><th>Date</th><th>Type</th><th>Size</th><th>Tables</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{data?.history?.map(b => (
            <tr key={b.id}>
              <td style={{ fontSize: '0.85rem' }}>{new Date(b.timestamp).toLocaleString('en-IN')}</td>
              <td><span className={`badge badge-${b.type === 'Manual' ? 'blue' : 'green'}`}>{b.type}</span></td>
              <td>{b.size}</td><td>{b.tables}</td>
              <td><span className="badge badge-green">{b.status}</span></td>
              <td><button className="btn btn-outline btn-sm">↩ Restore</button></td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAINTENANCE MODE PANEL
// ═══════════════════════════════════════════════════════
function MaintenancePanel() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/security/maintenance').then(r => { setEnabled(r.data.data.enabled); setMessage(r.data.data.message); }).finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try { await api.put('/security/maintenance', { enabled, message }); alert(`Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'}`); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🔨 Maintenance Mode</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 24 }}>Take the system offline for updates and show a downtime notice</p>

      <div className="card" style={{ maxWidth: 600, borderTop: `4px solid ${enabled ? '#ef4444' : 'var(--green)'}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>System Status</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Toggle maintenance mode on/off</div>
          </div>
          <div onClick={() => setEnabled(!enabled)} style={{
            width: 56, height: 28, borderRadius: 14, padding: 3, cursor: 'pointer', transition: 'all 0.3s',
            background: enabled ? '#ef4444' : 'var(--green)',
            display: 'flex', alignItems: 'center', justifyContent: enabled ? 'flex-end' : 'flex-start',
          }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,0.15)', transition: 'all 0.3s' }} />
          </div>
        </div>

        <div style={{
          padding: '16px 20px', borderRadius: 10, marginBottom: 20,
          background: enabled ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
          border: `1px solid ${enabled ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
          fontWeight: 600, textAlign: 'center', fontSize: '1rem',
          color: enabled ? '#ef4444' : 'var(--green)',
        }}>
          {enabled ? '⚠️ MAINTENANCE MODE IS ON — Users cannot access the system' : '✅ System is ONLINE — All users can access normally'}
        </div>

        <div className="form-group" style={{ marginBottom: 20 }}>
          <label className="form-label">Downtime Message</label>
          <textarea className="form-textarea" value={message} onChange={e => setMessage(e.target.value)} rows={3} />
        </div>

        <button className="btn btn-primary" onClick={save}>💾 Save Changes</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// API MANAGER PANEL
// ═══════════════════════════════════════════════════════
function APIManagerPanel() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPerms, setNewPerms] = useState(['read']);

  const load = () => api.get('/security/api-keys').then(r => setKeys(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName) return;
    try { await api.post('/security/api-keys', { name: newName, permissions: newPerms }); setNewName(''); setShowCreate(false); load(); } catch { alert('Failed'); }
  };

  const revoke = async (id) => {
    if (!confirm('Revoke this API key? This cannot be undone.')) return;
    try { await api.delete(`/security/api-keys/${id}`); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>⚡ API Manager</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Generate, manage, and revoke API keys</p></div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>+ Generate Key</button>
      </div>

      {showCreate && (
        <div className="card fade-up" style={{ marginBottom: 20, borderTop: '3px solid var(--blue)' }}>
          <div className="form-group"><label className="form-label">Key Name</label><input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Lab Machine Integration" /></div>
          <div className="form-group">
            <label className="form-label">Permissions</label>
            <div style={{ display: 'flex', gap: 12 }}>
              {['read', 'write', 'admin'].map(p => (
                <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', textTransform: 'capitalize' }}>
                  <input type="checkbox" checked={newPerms.includes(p)} onChange={() => setNewPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} /> {p}
                </label>
              ))}
            </div>
          </div>
          <button className="btn btn-primary" onClick={create}>Generate API Key</button>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 50 }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>🔑</div><h3>No API Keys</h3><p style={{ color: 'var(--text-muted)' }}>Generate your first API key to enable integrations.</p></div>
      ) : (
        <div className="table-wrapper">
          <table><thead><tr><th>Name</th><th>Key</th><th>Permissions</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>{keys.map(k => (
              <tr key={k.id}>
                <td style={{ fontWeight: 600 }}>{k.name}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.key?.substring(0, 20)}...</td>
                <td>{k.permissions?.map(p => <span key={p} className="badge badge-blue" style={{ marginRight: 4 }}>{p}</span>)}</td>
                <td style={{ fontSize: '0.82rem' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                <td><button className="btn btn-sm btn-ghost" style={{ color: '#ef4444' }} onClick={() => revoke(k.id)}>🗑 Revoke</button></td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANNOUNCEMENTS PANEL
// ═══════════════════════════════════════════════════════
function AnnouncementsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', message: '', severity: 'info', target_roles: ['all'] });

  const load = () => api.get('/security/announcements').then(r => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title || !form.message) return alert('Fill all fields');
    try { await api.post('/security/announcements', form); setForm({ title: '', message: '', severity: 'info', target_roles: ['all'] }); setShowForm(false); load(); } catch { alert('Failed'); }
  };

  const remove = async (id) => { if (!confirm('Delete?')) return; try { await api.delete(`/security/announcements/${id}`); load(); } catch { alert('Failed'); } };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const sevColor = { info: 'var(--blue)', warning: '#fbbf24', critical: '#ef4444' };

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>📢 Announcements</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Broadcast notices to users across the hospital</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ New Announcement</button>
      </div>

      {showForm && (
        <div className="card fade-up" style={{ marginBottom: 20, borderTop: '3px solid var(--blue)' }}>
          <div className="form-group"><label className="form-label">Title</label><input className="form-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Message</label><textarea className="form-textarea" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={3} /></div>
          <div className="form-group"><label className="form-label">Severity</label>
            <select className="form-select" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>
              <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
            </select>
          </div>
          <button className="btn btn-primary" onClick={create}>📤 Publish</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 50 }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>📭</div><h3>No Announcements</h3></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(a => (
            <div key={a.id} className="card" style={{ borderLeft: `4px solid ${sevColor[a.severity] || 'var(--border)'}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{a.title}</div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 6 }}>{a.message}</p>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>By {a.created_by} • {new Date(a.created_at).toLocaleString('en-IN')}</div>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(a.id)} style={{ color: '#ef4444' }}>🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ERROR LOGS PANEL
// ═══════════════════════════════════════════════════════
function ErrorLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.get('/security/error-logs').then(r => setLogs(r.data.data)).catch(console.error).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>🐛 Error Logs</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Application errors, stack traces, API failures</p></div>
        <button className="btn btn-outline" onClick={load}>↻ Refresh</button>
      </div>

      {logs.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 50 }}><div style={{ fontSize: '3rem', marginBottom: 12 }}>✅</div><h3>No Errors</h3><p style={{ color: 'var(--text-muted)' }}>System is running clean.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {logs.map(log => (
            <div key={log.id} style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '4px solid #ef4444',
              borderRadius: 8, padding: '12px 16px', fontFamily: 'monospace', fontSize: '0.78rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span className="badge badge-red">{log.level}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{new Date(log.timestamp).toLocaleString('en-IN')}</span>
              </div>
              <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{log.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// INTEGRATION HUB PANEL
// ═══════════════════════════════════════════════════════
function IntegrationHubPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => api.get('/security/integrations').then(r => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    try { await api.put(`/security/integrations/${id}/toggle`); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const catIcon = { EHR: '🏥', Insurance: '🛡️', Communication: '📧', Lab: '🔬', Billing: '💳' };

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🏥 Integration Hub</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Connect third-party systems — HL7/FHIR, insurance portals, lab machines, gateways</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {items.map(intg => (
          <div key={intg.id} className="card" style={{ borderLeft: `4px solid ${intg.status === 'active' ? 'var(--green)' : 'var(--border)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2rem' }}>{catIcon[intg.category] || '🔗'}</span>
                  <div style={{ fontWeight: 700 }}>{intg.name}</div>
                </div>
                <span className="badge" style={{ marginTop: 4, background: 'var(--surface-3)', fontSize: '0.68rem' }}>{intg.category}</span>
              </div>
              <div onClick={() => toggle(intg.id)} style={{
                width: 44, height: 24, borderRadius: 12, padding: 2, cursor: 'pointer', transition: 'all 0.2s',
                background: intg.status === 'active' ? 'var(--green)' : 'var(--surface-3)',
                display: 'flex', alignItems: 'center', justifyContent: intg.status === 'active' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 8, wordBreak: 'break-all' }}>{intg.endpoint}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <span>Last sync: {intg.last_sync ? new Date(intg.last_sync).toLocaleString('en-IN') : 'Never'}</span>
              <span>{intg.requests_today} reqs today</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// NOTIFICATION CONFIG PANEL
// ═══════════════════════════════════════════════════════
function NotificationConfigPanel() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ event: '', channel: 'Email', recipients: 'super_admin', threshold: 1 });

  const load = () => api.get('/security/notifications').then(r => setRules(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = async (id) => { try { await api.put(`/security/notifications/${id}/toggle`); load(); } catch { alert('Failed'); } };
  const create = async () => {
    if (!form.event) return;
    try { await api.post('/security/notifications', form); setForm({ event: '', channel: 'Email', recipients: 'super_admin', threshold: 1 }); setShowForm(false); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>🔔 Notification Config</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>System alert routing — who gets notified on failures, thresholds, escalations</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ New Rule</button>
      </div>

      {showForm && (
        <div className="card fade-up" style={{ marginBottom: 20, borderTop: '3px solid var(--blue)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Event</label><input className="form-input" value={form.event} onChange={e => setForm({ ...form, event: e.target.value })} placeholder="e.g. Server CPU > 90%" /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Channel</label>
              <select className="form-select" value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>
                <option>Email</option><option>SMS</option><option>SMS + Email</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Recipients</label><input className="form-input" value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Threshold</label><input type="number" className="form-input" value={form.threshold} onChange={e => setForm({ ...form, threshold: Number(e.target.value) })} /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={create}>Save Rule</button>
        </div>
      )}

      <div className="table-wrapper">
        <table><thead><tr><th>Event</th><th>Channel</th><th>Recipients</th><th>Threshold</th><th>Status</th><th>Toggle</th></tr></thead>
          <tbody>{rules.map(r => (
            <tr key={r.id}>
              <td style={{ fontWeight: 600 }}>{r.event}</td>
              <td><span className="badge badge-blue">{r.channel}</span></td>
              <td style={{ textTransform: 'capitalize' }}>{r.recipients?.replace(/_/g, ' ')}</td>
              <td>{r.threshold}</td>
              <td>{r.active ? <span className="badge badge-green">Active</span> : <span className="badge" style={{ background: 'var(--surface-3)' }}>Off</span>}</td>
              <td>
                <div onClick={() => toggle(r.id)} style={{
                  width: 44, height: 24, borderRadius: 12, padding: 2, cursor: 'pointer', transition: 'all 0.2s',
                  background: r.active ? 'var(--green)' : 'var(--surface-3)',
                  display: 'flex', alignItems: 'center', justifyContent: r.active ? 'flex-end' : 'flex-start',
                }}><div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} /></div>
              </td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// COMPLIANCE CENTER PANEL
// ═══════════════════════════════════════════════════════
function ComplianceCenterPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/security/compliance').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); }, []);
  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (!data) return <p>Failed to load.</p>;

  const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌' };
  const statusColor = { pass: 'var(--green)', warn: '#fbbf24', fail: '#ef4444' };
  const passCount = data.checks.filter(c => c.status === 'pass').length;
  const warnCount = data.checks.filter(c => c.status === 'warn').length;
  const failCount = data.checks.filter(c => c.status === 'fail').length;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>📑 Compliance Center</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>HIPAA/DPDP compliance status, data access policies, breach alerts</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 28 }}>
        <StatCard icon="📊" label="Compliance Score" value={`${data.overall_score}%`} color={data.overall_score >= 80 ? 'var(--green)' : data.overall_score >= 60 ? '#fbbf24' : '#ef4444'} />
        <StatCard icon="✅" label="Checks Passed" value={passCount} color="var(--green)" />
        <StatCard icon="⚠️" label="Warnings" value={warnCount} color="#fbbf24" />
        <StatCard icon="❌" label="Failed" value={failCount} color="#ef4444" />
      </div>

      {/* Score Bar */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontWeight: 700 }}>Overall Compliance</span>
          <span style={{ fontWeight: 700, color: data.overall_score >= 80 ? 'var(--green)' : '#fbbf24' }}>{data.overall_score}%</span>
        </div>
        <div style={{ height: 12, background: 'var(--surface-3)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${data.overall_score}%`, borderRadius: 6, background: data.overall_score >= 80 ? 'var(--green)' : data.overall_score >= 60 ? 'linear-gradient(90deg, #fbbf24, #f59e0b)' : 'linear-gradient(90deg, #ef4444, #f87171)', transition: 'width 0.5s' }} />
        </div>
      </div>

      <SectionTitle>Compliance Checks</SectionTitle>
      <div className="table-wrapper">
        <table><thead><tr><th>Check</th><th>Category</th><th>Status</th><th>Detail</th></tr></thead>
          <tbody>{data.checks.map((c, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{c.name}</td>
              <td><span className="badge" style={{ background: 'var(--surface-3)', fontSize: '0.72rem' }}>{c.category}</span></td>
              <td><span style={{ color: statusColor[c.status], fontWeight: 700 }}>{statusIcon[c.status]} {c.status.toUpperCase()}</span></td>
              <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{c.detail}</td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DATA GOVERNANCE PANEL
// ═══════════════════════════════════════════════════════
function DataGovernancePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => api.get('/security/data-governance').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggleMask = async (idx) => {
    try { await api.put(`/security/data-governance/pii/${idx}/toggle`); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (!data) return <p>Failed to load.</p>;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>📝 Data Governance</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Retention policies, PII masking rules, data purge schedules</p>

      <SectionTitle>Data Retention Policies</SectionTitle>
      <div className="table-wrapper" style={{ marginBottom: 28 }}>
        <table><thead><tr><th>Entity</th><th>Retention Period</th><th>Auto Purge</th><th>Last Purge</th></tr></thead>
          <tbody>{data.retention_policies?.map(p => (
            <tr key={p.id}>
              <td style={{ fontWeight: 600 }}>{p.entity}</td>
              <td>{p.retention}</td>
              <td>{p.auto_purge ? <span className="badge badge-green">Enabled</span> : <span className="badge" style={{ background: 'var(--surface-3)' }}>Off</span>}</td>
              <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{p.last_purge ? new Date(p.last_purge).toLocaleDateString() : 'Never'}</td>
            </tr>
          ))}</tbody></table>
      </div>

      <SectionTitle>PII Field Masking</SectionTitle>
      <div className="table-wrapper">
        <table><thead><tr><th>Table</th><th>Field</th><th>Masking Rule</th><th>Status</th><th>Toggle</th></tr></thead>
          <tbody>{data.pii_fields?.map((f, i) => (
            <tr key={i}>
              <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{f.table}</td>
              <td style={{ fontWeight: 600 }}>{f.field}</td>
              <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{f.masking_rule}</td>
              <td>{f.masked ? <span className="badge badge-green">Masked</span> : <span className="badge badge-amber">Exposed</span>}</td>
              <td>
                <div onClick={() => toggleMask(i)} style={{
                  width: 44, height: 24, borderRadius: 12, padding: 2, cursor: 'pointer', transition: 'all 0.2s',
                  background: f.masked ? 'var(--green)' : 'var(--surface-3)',
                  display: 'flex', alignItems: 'center', justifyContent: f.masked ? 'flex-end' : 'flex-start',
                }}><div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} /></div>
              </td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LICENSE MANAGER PANEL
// ═══════════════════════════════════════════════════════
function LicenseManagerPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', vendor: '', type: 'Subscription', expiry: '', seats: '' });

  const load = () => api.get('/security/licenses').then(r => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return;
    try { await api.post('/security/licenses', form); setForm({ name: '', vendor: '', type: 'Subscription', expiry: '', seats: '' }); setShowForm(false); load(); } catch { alert('Failed'); }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;

  const statusColor = { active: 'green', expiring_soon: 'amber', expired: 'red' };

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div><h2 style={{ marginBottom: 4 }}>🪪 License Manager</h2><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Track software licenses, module subscriptions, expiry alerts</p></div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ Add License</button>
      </div>

      {showForm && (
        <div className="card fade-up" style={{ marginBottom: 20, borderTop: '3px solid var(--blue)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Name</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Vendor</label><input className="form-input" value={form.vendor} onChange={e => setForm({ ...form, vendor: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Type</label>
              <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                <option>Subscription</option><option>Enterprise</option><option>Free</option><option>Internal</option>
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Expiry Date</label><input type="date" className="form-input" value={form.expiry} onChange={e => setForm({ ...form, expiry: e.target.value })} /></div>
            <div className="form-group" style={{ margin: 0 }}><label className="form-label">Seats / Capacity</label><input className="form-input" value={form.seats} onChange={e => setForm({ ...form, seats: e.target.value })} /></div>
          </div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={create}>Save License</button>
        </div>
      )}

      <div className="table-wrapper">
        <table><thead><tr><th>Software</th><th>Vendor</th><th>Type</th><th>Seats</th><th>Expiry</th><th>Status</th></tr></thead>
          <tbody>{items.map(l => (
            <tr key={l.id}>
              <td style={{ fontWeight: 600 }}>{l.name}</td>
              <td>{l.vendor}</td>
              <td><span className="badge" style={{ background: 'var(--surface-3)', fontSize: '0.72rem' }}>{l.type}</span></td>
              <td>{l.seats}</td>
              <td style={{ fontSize: '0.82rem' }}>{l.expiry}</td>
              <td><span className={`badge badge-${statusColor[l.status] || 'green'}`}>{l.status?.replace(/_/g, ' ')}</span></td>
            </tr>
          ))}</tbody></table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ROLE TEMPLATES PANEL
// ═══════════════════════════════════════════════════════
function RoleTemplatesPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editPerms, setEditPerms] = useState([]);

  const load = () => api.get('/security/role-templates').then(r => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const startEdit = (tmpl) => { setEditing(tmpl.id); setEditPerms([...tmpl.permissions]); };
  const cancelEdit = () => { setEditing(null); setEditPerms([]); };
  const saveEdit = async (id) => {
    try { await api.put(`/security/role-templates/${id}`, { permissions: editPerms }); setEditing(null); load(); } catch { alert('Failed'); }
  };
  const togglePerm = (p) => setEditPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>;
  if (!data) return <p>Failed to load.</p>;

  return (
    <div className="fade-up">
      <h2 style={{ marginBottom: 4 }}>🏷️ Role Templates</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>Pre-built permission sets for each role — Doctor, Nurse, Receptionist, Lab Tech, etc.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {data.templates?.map(tmpl => (
          <div key={tmpl.id} className="card" style={{ borderTop: `4px solid ${tmpl.color}`, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: tmpl.color, textTransform: 'capitalize' }}>{tmpl.label}</div>
              {editing === tmpl.id
                ? <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(tmpl.id)}>💾 Save</button>
                    <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                : <button className="btn btn-outline btn-sm" onClick={() => startEdit(tmpl)}>✏️ Edit</button>}
            </div>

            {editing === tmpl.id ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {data.all_permissions?.map(p => (
                  <div key={p} onClick={() => togglePerm(p)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem', cursor: 'pointer', transition: 'all 0.15s',
                    background: editPerms.includes(p) ? tmpl.color : 'var(--surface-3)',
                    color: editPerms.includes(p) ? '#fff' : 'var(--text-secondary)',
                    border: `1px solid ${editPerms.includes(p) ? tmpl.color : 'var(--border)'}`,
                  }}>{p.replace(/_/g, ' ')}</div>
                ))}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tmpl.permissions?.map(p => (
                  <span key={p} className="badge" style={{ background: `${tmpl.color}18`, color: tmpl.color, border: `1px solid ${tmpl.color}30`, fontSize: '0.7rem' }}>{p.replace(/_/g, ' ')}</span>
                ))}
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: '0.72rem', color: 'var(--text-muted)' }}>{tmpl.permissions?.length} permissions assigned</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN SECURITY PAGE
// ═══════════════════════════════════════════════════════
export default function SecurityPage() {
  const [activePanel, setActivePanel] = useState('center');

  const panels = {
    center: <SecurityCenterPanel />,
    sessions: <SessionManagerPanel />,
    '2fa': <TwoFAPanel />,
    'ip-rules': <IPRulesPanel />,
    audit: <AuditTrailPanel />,
    health: <SystemHealthPanel />,
    backups: <BackupPanel />,
    maintenance: <MaintenancePanel />,
    'api-keys': <APIManagerPanel />,
    integrations: <IntegrationHubPanel />,
    notifications: <NotificationConfigPanel />,
    compliance: <ComplianceCenterPanel />,
    'data-gov': <DataGovernancePanel />,
    licenses: <LicenseManagerPanel />,
    announcements: <AnnouncementsPanel />,
    'error-logs': <ErrorLogsPanel />,
    'role-templates': <RoleTemplatesPanel />,
  };

  const sections = [...new Set(NAV.map(n => n.section))];

  return (
    <>
      <Navbar />
      <div style={{ display: 'flex', minHeight: 'calc(100vh - 61px)' }}>
        {/* Sidebar */}
        <div style={{
          width: 260, background: 'var(--surface)', borderRight: '1px solid var(--border)',
          padding: '20px 0', overflowY: 'auto', flexShrink: 0,
        }}>
          <div style={{ padding: '0 20px 16px', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem' }}>🔐 Security</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>System Administration</div>
          </div>

          {sections.map(sec => (
            <div key={sec}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '12px 20px 4px' }}>{sec}</div>
              {NAV.filter(n => n.section === sec).map(n => (
                <div
                  key={n.id}
                  onClick={() => setActivePanel(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 20px', cursor: 'pointer', fontSize: '0.85rem',
                    background: activePanel === n.id ? 'var(--surface-3)' : 'transparent',
                    borderRight: activePanel === n.id ? '3px solid var(--green)' : '3px solid transparent',
                    color: activePanel === n.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontWeight: activePanel === n.id ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (activePanel !== n.id) e.currentTarget.style.background = 'var(--surface-2)'; }}
                  onMouseLeave={e => { if (activePanel !== n.id) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: '1rem', width: 24, textAlign: 'center' }}>{n.icon}</span>
                  {n.label}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Main Content */}
        <div style={{ flex: 1, padding: 32, overflowY: 'auto', background: 'var(--bg)' }}>
          {panels[activePanel] || <p>Panel not found</p>}
        </div>
      </div>
    </>
  );
}
