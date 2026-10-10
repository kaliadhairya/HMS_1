import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  Activity, BadgeCheck, Ban, BellRing, Bug, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, CreditCard,
  Database, DatabaseBackup, Globe, Hammer, Hospital, KeyRound, Link, LockOpen, LogOut, Mail, Megaphone, Microscope, Monitor,
  Network, Pencil, Plug, Plus, RefreshCw, RotateCcw, Save, ScrollText, Server, Shield, ShieldAlert, ShieldCheck, Tags, Trash2,
  Wrench, X, Zap,
} from 'lucide-react';
import Navbar from '../../components/Navbar';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import api from '../../api/axios';

// ─── Navigation: areas (tabs) and their sections ──────
const NAV = [
  { id: 'center',        icon: ShieldAlert,    label: 'Security center',        section: 'Security' },
  { id: 'sessions',      icon: Monitor,        label: 'Sessions',               section: 'Security' },
  { id: '2fa',           icon: KeyRound,       label: 'Two-factor auth',        section: 'Security' },
  { id: 'ip-rules',      icon: Globe,          label: 'IP allow and block',     section: 'Security' },
  { id: 'audit',         icon: ScrollText,     label: 'Audit trail',            section: 'System' },
  { id: 'health',        icon: Activity,       label: 'System health',          section: 'System' },
  { id: 'backups',       icon: DatabaseBackup, label: 'Backup and recovery',    section: 'System' },
  { id: 'maintenance',   icon: Hammer,         label: 'Maintenance mode',       section: 'System' },
  { id: 'api-keys',      icon: Zap,            label: 'API keys',               section: 'Integrations' },
  { id: 'integrations',  icon: Network,        label: 'Integration hub',        section: 'Integrations' },
  { id: 'notifications', icon: BellRing,       label: 'Notification rules',     section: 'Integrations' },
  { id: 'compliance',    icon: ClipboardCheck, label: 'Compliance',             section: 'Compliance' },
  { id: 'data-gov',      icon: Database,       label: 'Data governance',        section: 'Compliance' },
  { id: 'licenses',      icon: BadgeCheck,     label: 'Licenses',               section: 'Compliance' },
  { id: 'announcements', icon: Megaphone,      label: 'Announcements',          section: 'Operations' },
  { id: 'error-logs',    icon: Bug,            label: 'Error logs',             section: 'Operations' },
  { id: 'role-templates', icon: Tags,          label: 'Role templates',         section: 'Operations' },
];
const GROUP_ICON = { Security: Shield, System: Server, Integrations: Plug, Compliance: ClipboardCheck, Operations: Wrench };

// ─── Helpers ──────────────────────────────────────────
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN') : '—');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const human = (s) => String(s || '').replace(/_/g, ' ');
const sentence = (s) => { const h = human(s); return h ? h.charAt(0).toUpperCase() + h.slice(1) : '—'; };
const ROLE_TONE = { super_admin: 'danger', doctor: 'info' };

// Detail column for failed sign-ins; NEW_VALUE is JSON written by the backend, but never trust it to parse.
const failureDetail = (v) => {
  if (!v) return '—';
  try {
    const p = JSON.parse(v);
    return p?.reason || `${p?.attempts} attempts`;
  } catch {
    return String(v);
  }
};

function Loading() {
  return <section className="panel panel-pad"><p className="muted">Loading…</p></section>;
}

function LoadFailed() {
  return (
    <div className="alert-strip alert-danger" role="alert">
      <CircleAlert size={16} aria-hidden="true" /> This section could not be loaded. Refresh the page to try again.
    </div>
  );
}

function SubHead({ title, description, actions }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 650 }}>{title}</h2>
        {description && <p className="muted" style={{ marginTop: 2 }}>{description}</p>}
      </div>
      {actions && <div className="inline-actions">{actions}</div>}
    </div>
  );
}

function PanelHead({ icon: Icon, title, actions }) {
  return (
    <div className="panel-head">
      <h3 className="panel-title" style={{ margin: 0 }}>{Icon && <Icon size={16} aria-hidden="true" />} {title}</h3>
      {actions}
    </div>
  );
}

function Kpi({ label, value, tone, sub }) {
  const color = tone === 'danger' ? 'var(--red)' : tone === 'warning' ? 'var(--amber)' : undefined;
  return (
    <div className="panel kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

// Accessible on/off switch (button with role="switch").
function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      onClick={onChange}
      style={{
        width: 40, height: 22, borderRadius: 11, padding: 2, flexShrink: 0, cursor: 'pointer',
        border: `1px solid ${checked ? 'var(--primary)' : 'var(--border-dark)'}`,
        background: checked ? 'var(--primary)' : 'var(--surface-3)',
        display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start',
      }}
    >
      <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', boxShadow: 'var(--shadow-sm)' }} />
    </button>
  );
}

function ConfirmModal({ target, onClose, title, description, confirmLabel, cancelLabel = 'Cancel', onConfirm, children }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await onConfirm(target); } finally { setBusy(false); }
  };
  return (
    <Modal
      open={Boolean(target)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={title}
      description={description}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>{cancelLabel}</button>
          <button type="button" className="btn btn-danger btn-md" onClick={run} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
        </>
      )}
    >
      {children || <p className="muted">This cannot be undone.</p>}
    </Modal>
  );
}

const rowStyle = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)',
};

// ═══════════════════════════════════════════════════════
// SECURITY CENTER PANEL
// ═══════════════════════════════════════════════════════
function SecurityCenterPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/security/center').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); }, []);

  const columns = useMemo(() => [
    { id: 'user', header: 'User', accessorFn: (l) => l.USERNAME || l.USER_NAME || `User #${l.USER_ID}`, cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'ip', header: 'IP address', accessorFn: (l) => l.IP_ADDRESS || '', meta: { width: 160 }, cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span> },
    { id: 'time', header: 'Time', accessorFn: (l) => (l.CREATED_AT ? new Date(l.CREATED_AT).getTime() : 0), meta: { width: 200 }, cell: ({ row }) => <span className="tabular cell-secondary">{fmtDateTime(row.original.CREATED_AT)}</span> },
    { id: 'detail', header: 'Details', accessorFn: (l) => failureDetail(l.NEW_VALUE), enableSorting: false },
  ], []);

  if (loading) return <Loading />;
  if (!data) return <LoadFailed />;

  const blocked = data.blocked_ips || [];

  return (
    <div className="stack">
      <SubHead title="Security center" description="Failed sign-ins, locked accounts and suspicious addresses." />

      <div className="kpi-strip" style={{ marginBottom: 0 }}>
        <Kpi label="Failed sign-ins today" value={data.failed_logins_today} tone={data.failed_logins_today > 0 ? 'danger' : undefined} />
        <Kpi label="Failed this week" value={data.failed_logins_week} tone={data.failed_logins_week > 0 ? 'warning' : undefined} />
        <Kpi label="Locked accounts" value={data.locked_accounts} tone={data.locked_accounts > 0 ? 'danger' : undefined} />
        <Kpi label="Sign-ins today" value={data.logins_today} />
      </div>

      {data.suspicious_ips?.length > 0 && (
        <section className="panel">
          <PanelHead icon={ShieldAlert} title="Suspicious IP addresses (3 or more failures today)" />
          <div className="panel-pad">
            <table className="mini-table">
              <thead><tr><th>IP address</th><th>Attempts</th><th>Status</th></tr></thead>
              <tbody>
                {data.suspicious_ips.map((ip, i) => (
                  <tr key={i}>
                    <td className="mono">{ip.IP_ADDRESS}</td>
                    <td><span className="status status-danger">{ip.ATTEMPTS} attempts</span></td>
                    <td>{blocked.includes(ip.IP_ADDRESS) ? <span className="status status-danger">Blocked</span> : <span className="status status-warning">Monitoring</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="panel">
        <PanelHead icon={ScrollText} title="Recent failed sign-in attempts" />
        <DataTable
          columns={columns}
          data={data.recent_failed || []}
          getRowId={(l, i) => String(l.ID ?? i)}
          pageSize={15}
          initialSorting={[{ id: 'time', desc: true }]}
          empty={<EmptyState icon={ShieldCheck} title="No failed sign-ins" description="There have been no failed sign-in attempts recently." />}
        />
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SESSION MANAGER PANEL
// ═══════════════════════════════════════════════════════
function SessionManagerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [endTarget, setEndTarget] = useState(null);
  const load = () => api.get('/security/sessions').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const forceLogout = async (userId) => {
    try {
      await api.post(`/security/sessions/${userId}/force-logout`);
      setEndTarget(null);
      toast.success('Session ended');
      load();
    } catch { toast.error('Failed to end the session'); }
  };

  const unlock = async (userId) => {
    try {
      await api.post(`/security/users/${userId}/unlock`);
      toast.success('Account unlocked');
      load();
    } catch { toast.error('Failed to unlock the account'); }
  };

  const columns = useMemo(() => [
    {
      id: 'user', header: 'User', accessorFn: (s) => s.NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.NAME}</span>
          <span className="cell-secondary mono">{row.original.USERNAME}</span>
        </span>
      ),
    },
    {
      id: 'role', header: 'Role', accessorFn: (s) => s.ROLE || '', meta: { width: 160 },
      cell: ({ getValue }) => <span className={`status status-${ROLE_TONE[getValue()] || 'neutral'}`}>{sentence(getValue())}</span>,
    },
    {
      id: 'last', header: 'Last active', accessorFn: (s) => (s.LAST_LOGIN ? new Date(s.LAST_LOGIN).getTime() : 0), meta: { width: 200 },
      cell: ({ row }) => <span className="tabular">{row.original.LAST_LOGIN ? fmtDateTime(row.original.LAST_LOGIN) : 'Never'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (s) => s._state, meta: { width: 110 },
      cell: ({ getValue }) => {
        const st = getValue();
        if (st === 'Locked') return <span className="status status-danger">Locked</span>;
        if (st === 'Active') return <span className="status status-success">Active</span>;
        return <span className="status status-neutral">Inactive</span>;
      },
    },
    {
      id: 'failed', header: 'Failed', accessorFn: (s) => Number(s.FAILED_ATTEMPTS) || 0, meta: { width: 90, align: 'right' },
      cell: ({ getValue }) => (getValue() > 0 ? <span className="status status-warning">{getValue()}</span> : <span className="tabular">0</span>),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: ({ row }) => {
        const s = row.original;
        return s._state === 'Locked' ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => unlock(s.ID)}><LockOpen size={14} aria-hidden="true" /> Unlock</button>
        ) : (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setEndTarget(s)}><LogOut size={14} aria-hidden="true" /> End session</button>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const rows = useMemo(() => {
    const now = new Date();
    return (data?.sessions || []).map((s) => {
      const lastLogin = s.LAST_LOGIN ? new Date(s.LAST_LOGIN) : null;
      const isRecent = lastLogin && (now - lastLogin < 8 * 3600000);
      const isLocked = s.LOCKED_UNTIL && new Date(s.LOCKED_UNTIL) > now;
      return { ...s, _state: isLocked ? 'Locked' : isRecent ? 'Active' : 'Inactive' };
    });
  }, [data]);

  if (loading) return <Loading />;

  return (
    <div className="stack">
      <SubHead
        title="Sessions"
        description="Monitor and control active user sessions."
        actions={<button type="button" className="btn btn-ghost btn-md" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>}
      />

      <section className="panel">
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(s) => String(s.ID)}
          pageSize={50}
          empty={<EmptyState icon={Monitor} title="No sessions" description="User sessions appear here once staff sign in." />}
        />
      </section>

      <section className="panel">
        <PanelHead title="Session timeout (minutes)" />
        <div className="panel-pad">
          <div className="facts">
            {Object.entries(data?.timeout_settings || {}).map(([role, mins]) => (
              <div key={role}>
                <div className="fact-label">{human(role)}</div>
                <div className="fact-value tabular" style={{ fontWeight: 600 }}>{mins} min</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ConfirmModal
        target={endTarget}
        onClose={() => setEndTarget(null)}
        title="End this session?"
        description={endTarget ? `${endTarget.NAME} (${endTarget.USERNAME}) will be signed out.` : ''}
        confirmLabel="End session"
        onConfirm={(s) => forceLogout(s.ID)}
      >
        <p className="muted">Their session is terminated and they will need to sign in again.</p>
      </ConfirmModal>
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
  useEffect(() => { api.get('/security/2fa').then((r) => { setData(r.data.data); setEnforced(r.data.data.enforced_roles || []); }).catch(console.error).finally(() => setLoading(false)); }, []);

  const toggleRole = (role) => {
    setEnforced((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };
  const save = async () => {
    try { await api.put('/security/2fa', { enforced_roles: enforced }); toast.success('2FA settings saved'); } catch { toast.error('Failed to save 2FA settings'); }
  };

  if (loading) return <Loading />;

  const roles = data?.role_breakdown || [];
  return (
    <div className="stack">
      <SubHead
        title="Two-factor authentication"
        description="Require 2FA for a role to strengthen sign-in."
        actions={<button type="button" className="btn btn-primary btn-md" onClick={save}><Save size={16} aria-hidden="true" /> Save 2FA settings</button>}
      />

      <div className="kpi-strip" style={{ marginBottom: 0 }}>
        <Kpi label="Active users" value={data?.total_users || 0} />
        <Kpi label="Roles with 2FA required" value={enforced.length} tone={enforced.length > 0 ? undefined : 'warning'} />
        <Kpi label="Coverage" value={data?.total_users > 0 ? `${Math.round((enforced.length / (roles.length || 1)) * 100)}%` : '0%'} />
      </div>

      <section className="panel">
        <PanelHead icon={KeyRound} title="Require 2FA by role" />
        <div className="panel-pad">
          {roles.length === 0 ? <p className="muted">No roles found.</p> : (
            <ul className="list-rows">
              {roles.map((r) => {
                const isOn = enforced.includes(r.ROLE);
                return (
                  <li key={r.ROLE} style={rowStyle}>
                    <span className="cell-stack">
                      <span className="cell-primary">{sentence(r.ROLE)}</span>
                      <span className="cell-secondary">{r.CNT || r.cnt} users</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <span className={`status ${isOn ? 'status-success' : 'status-neutral'}`}>{isOn ? 'Required' : 'Optional'}</span>
                      <Switch checked={isOn} onChange={() => toggleRole(r.ROLE)} label={`Require 2FA for ${human(r.ROLE)}`} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
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
    api.get('/security/ip-rules')
      .then((r) => { setWhitelist(r.data.data.whitelist); setBlacklist(r.data.data.blacklist); })
      .catch((err) => { console.error(err); toast.error('Could not load IP rules'); })
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try { await api.put('/security/ip-rules', { whitelist, blacklist }); toast.success('IP rules saved'); } catch { toast.error('Failed to save IP rules'); }
  };

  if (loading) return <Loading />;

  return (
    <div className="stack">
      <SubHead
        title="IP access control"
        description="Restrict sign-in to trusted networks, and block known bad addresses."
        actions={<button type="button" className="btn btn-primary btn-md" onClick={save}><Save size={16} aria-hidden="true" /> Save IP rules</button>}
      />

      <div className="split-2" style={{ alignItems: 'start' }}>
        <section className="panel">
          <PanelHead icon={ShieldCheck} title={`Allow list (${whitelist.length})`} />
          <div className="panel-pad stack-sm">
            <p className="muted">Only these addresses can access the system. Leave empty to allow all.</p>
            <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (newWL) { setWhitelist([...whitelist, newWL]); setNewWL(''); } }}>
              <label className="sr-only" htmlFor="ip-allow">IP address or range to allow</label>
              <input id="ip-allow" className="form-input mono" placeholder="e.g. 192.168.1.0/24" value={newWL} onChange={(e) => setNewWL(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn btn-secondary btn-md"><Plus size={16} aria-hidden="true" /> Add</button>
            </form>
            {whitelist.length > 0 && (
              <ul className="list-rows">
                {whitelist.map((ip, i) => (
                  <li key={i} style={rowStyle}>
                    <span className="mono">{ip}</span>
                    <button type="button" className="icon-btn" aria-label={`Remove ${ip} from the allow list`} onClick={() => setWhitelist(whitelist.filter((_, j) => j !== i))}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="panel">
          <PanelHead icon={Ban} title={`Block list (${blacklist.length})`} />
          <div className="panel-pad stack-sm">
            <p className="muted">These addresses are always blocked from accessing the system.</p>
            <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (newBL) { setBlacklist([...blacklist, newBL]); setNewBL(''); } }}>
              <label className="sr-only" htmlFor="ip-block">IP address to block</label>
              <input id="ip-block" className="form-input mono" placeholder="e.g. 192.168.1.100" value={newBL} onChange={(e) => setNewBL(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn btn-danger btn-md"><Ban size={16} aria-hidden="true" /> Block</button>
            </form>
            {blacklist.length > 0 && (
              <ul className="list-rows">
                {blacklist.map((ip, i) => (
                  <li key={i} style={{ ...rowStyle, background: 'var(--red-light)', borderColor: 'var(--red-border)' }}>
                    <span className="mono">{ip}</span>
                    <button type="button" className="icon-btn" aria-label={`Remove ${ip} from the block list`} onClick={() => setBlacklist(blacklist.filter((_, j) => j !== i))}>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
      <p className="form-hint">Changes to either list take effect after you save.</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// AUDIT TRAIL PANEL
// ═══════════════════════════════════════════════════════
const ACTION_TONE = { LOGIN: 'success', LOGIN_FAILED: 'danger', CREATE: 'info', DELETE: 'danger', FORCE_LOGOUT: 'warning' };

function AuditTrailPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', module: '', from_date: '', to_date: '', page: 1 });

  const load = useCallback(() => {
    setLoading(true);
    const q = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('&');
    api.get(`/security/audit-trail?${q}`).then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const logs = data?.logs || [];

  return (
    <div className="stack">
      <SubHead title="Audit trail" description="A permanent log of every action: who, what, when and from where." />

      <section className="panel">
        <div className="toolbar" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
            <label className="form-label" htmlFor="at-action">Action</label>
            <select id="at-action" className="form-select" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value, page: 1 })}>
              <option value="">All actions</option>
              {data?.filters?.actions?.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 150 }}>
            <label className="form-label" htmlFor="at-module">Module</label>
            <select id="at-module" className="form-select" value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value, page: 1 })}>
              <option value="">All modules</option>
              {data?.filters?.modules?.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="at-from">From</label>
            <input id="at-from" type="date" className="form-input" value={filters.from_date} onChange={(e) => setFilters({ ...filters, from_date: e.target.value, page: 1 })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="at-to">To</label>
            <input id="at-to" type="date" className="form-input" value={filters.to_date} onChange={(e) => setFilters({ ...filters, to_date: e.target.value, page: 1 })} />
          </div>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setFilters({ action: '', module: '', from_date: '', to_date: '', page: 1 })}>Clear</button>
        </div>

        <div className="dt">
          <div className="dt-scroll" style={{ maxHeight: 560 }}>
            <table className="dt-table">
              <thead>
                <tr>
                  <th>User</th><th style={{ width: 160 }}>Action</th><th style={{ width: 120 }}>Module</th>
                  <th style={{ width: 150 }}>IP address</th><th>Details</th><th style={{ width: 190 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: 8 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="dt-skeleton-row" aria-hidden="true">
                    {Array.from({ length: 6 }).map((__, j) => <td key={j}><span className="skeleton" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}
                  </tr>
                ))}
                {!loading && logs.length === 0 && (
                  <tr><td colSpan={6} className="dt-empty-cell"><EmptyState icon={ScrollText} title="No audit records" description="No actions match these filters." /></td></tr>
                )}
                {!loading && logs.map((log, i) => (
                  <tr key={log.ID ?? i}>
                    <td className="cell-primary">{log.USERNAME || log.USER_NAME || `#${log.USER_ID}`}</td>
                    <td><span className={`status status-${ACTION_TONE[log.ACTION] || 'neutral'}`}>{log.ACTION}</span></td>
                    <td>{log.MODULE || '—'}</td>
                    <td className="mono">{log.IP_ADDRESS || '—'}</td>
                    <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={log.NEW_VALUE || ''}>{log.NEW_VALUE || '—'}</td>
                    <td className="tabular cell-secondary" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(log.CREATED_AT)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && data && (
            <div className="dt-footer">
              <span className="dt-count">Showing <strong>{logs.length}</strong> of <strong>{data.total}</strong> records</span>
              {data.pages > 1 && (
                <div className="dt-pager">
                  <button type="button" className="icon-btn" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })} aria-label="Previous page"><ChevronLeft size={16} /></button>
                  <span>Page {data.page} of {data.pages}</span>
                  <button type="button" className="icon-btn" disabled={data.page >= data.pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })} aria-label="Next page"><ChevronRight size={16} /></button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// SYSTEM HEALTH PANEL
// ═══════════════════════════════════════════════════════
function SystemHealthPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.get('/security/system-health').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); };
  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, []);
  if (loading && !data) return <Loading />;

  const memPct = parseFloat(data?.memory?.usage_percent || 0);
  const memColor = memPct > 90 ? 'var(--red)' : memPct > 70 ? 'var(--amber)' : 'var(--success)';
  const memLabel = memPct > 90 ? 'Critical' : memPct > 70 ? 'High' : 'Normal';
  const dbSlow = data?.database?.response_time_ms > 200;

  const facts = [
    { label: 'Uptime', value: data?.server?.uptime_human },
    { label: 'Platform', value: `${data?.server?.platform} (${data?.server?.arch})` },
    { label: 'Node.js', value: data?.server?.node_version },
    { label: 'CPU cores', value: data?.cpu?.cores },
    { label: 'DB records', value: `${data?.database?.total_users} users, ${data?.database?.total_audit_logs} audit logs` },
  ];

  return (
    <div className="stack">
      <SubHead
        title="System health"
        description="Live server metrics. Refreshes every 15 seconds."
        actions={<button type="button" className="btn btn-ghost btn-md" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {data?.services?.map((s) => {
          const ok = s.status === 'running' || s.status === 'healthy' || s.status === 'active';
          return (
            <div key={s.name} className="panel panel-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <span className="cell-stack">
                <span className="cell-primary">{s.name}</span>
                <span className="cell-secondary">{s.uptime || s.response || ''}</span>
              </span>
              <span className={`status ${ok ? 'status-success' : 'status-danger'}`}>{s.status}</span>
            </div>
          );
        })}
      </div>

      <div className="split-2">
        <section className="panel panel-pad">
          <h3 className="panel-title">Memory usage</h3>
          <div className="bar-row">
            <span>{memLabel}</span>
            <strong className="tabular" style={{ color: memColor }}>{memPct}%</strong>
          </div>
          <div className="bar-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={memPct} aria-label="Memory usage">
            <div className="bar-fill" style={{ width: `${Math.min(memPct, 100)}%`, background: memColor }} />
          </div>
          <div className="facts" style={{ marginTop: 16 }}>
            <div><div className="fact-label">Total</div><div className="fact-value tabular">{data?.memory?.total_gb} GB</div></div>
            <div><div className="fact-label">Used</div><div className="fact-value tabular">{data?.memory?.used_gb} GB</div></div>
            <div><div className="fact-label">Free</div><div className="fact-value tabular">{data?.memory?.free_gb} GB</div></div>
          </div>
        </section>

        <section className="panel panel-pad">
          <h3 className="panel-title">Server information</h3>
          <div className="facts">
            {facts.map((f) => (
              <div key={f.label}><div className="fact-label">{f.label}</div><div className="fact-value">{f.value ?? '—'}</div></div>
            ))}
            <div>
              <div className="fact-label">DB response</div>
              <div className="fact-value"><span className={`status ${dbSlow ? 'status-danger' : 'status-success'}`}>{data?.database?.response_time_ms} ms</span></div>
            </div>
          </div>
        </section>
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
  const load = () => api.get('/security/backups').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const triggerBackup = async () => {
    setTriggering(true);
    try { await api.post('/security/backups/trigger'); load(); toast.success('Backup completed'); } catch { toast.error('Backup failed'); }
    setTriggering(false);
  };

  if (loading) return <Loading />;

  return (
    <div className="stack">
      <SubHead
        title="Backup and recovery"
        description="Database backups and restore points."
        actions={(
          <button type="button" className="btn btn-primary btn-md" onClick={triggerBackup} disabled={triggering}>
            <DatabaseBackup size={16} aria-hidden="true" /> {triggering ? 'Backing up…' : 'Back up now'}
          </button>
        )}
      />

      <div className="kpi-strip" style={{ marginBottom: 0 }}>
        <Kpi label="Schedule" value={data?.schedule?.frequency} sub={`at ${data?.schedule?.time}`} />
        <Kpi label="Last backup" value={data?.last_backup ? fmtDate(data.last_backup) : 'Never'} tone={data?.last_backup ? undefined : 'warning'} />
        <Kpi label="Retention" value={`${data?.schedule?.retention_days} days`} />
      </div>

      <section className="panel">
        <PanelHead icon={DatabaseBackup} title="Backup history" />
        <div className="panel-pad">
          {(data?.history || []).length === 0 ? <p className="muted">No backups yet.</p> : (
            <table className="mini-table">
              <thead><tr><th>Date</th><th>Type</th><th>Size</th><th>Tables</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.history.map((b) => (
                  <tr key={b.id}>
                    <td className="tabular">{fmtDateTime(b.timestamp)}</td>
                    <td><span className={`status ${b.type === 'Manual' ? 'status-info' : 'status-neutral'}`}>{b.type}</span></td>
                    <td className="tabular">{b.size}</td>
                    <td className="tabular">{b.tables}</td>
                    <td><span className="status status-success">{b.status}</span></td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled title="Restore is not available from this screen yet">
                        <RotateCcw size={14} aria-hidden="true" /> Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
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
    api.get('/security/maintenance')
      .then((r) => { setEnabled(r.data.data.enabled); setMessage(r.data.data.message); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    try { await api.put('/security/maintenance', { enabled, message }); toast.success(`Maintenance mode ${enabled ? 'enabled' : 'disabled'}`); } catch { toast.error('Failed to save maintenance mode'); }
  };

  if (loading) return <Loading />;

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <SubHead title="Maintenance mode" description="Take the system offline for updates and show a downtime notice." />

      <section className="panel">
        <div className="panel-pad stack">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <div className="cell-primary" id="mm-label">Maintenance mode</div>
              <div className="muted">When on, staff cannot use the system.</div>
            </div>
            <Switch checked={enabled} onChange={() => setEnabled(!enabled)} label="Maintenance mode" />
          </div>

          {enabled ? (
            <div className="alert-strip alert-danger" role="status" style={{ marginBottom: 0 }}>
              <CircleAlert size={16} aria-hidden="true" /> Maintenance mode is on. Users cannot access the system.
            </div>
          ) : (
            <div className="alert-strip" role="status" style={{ marginBottom: 0, background: 'var(--success-light)', borderColor: 'var(--success-border)', color: 'var(--success)' }}>
              <CircleCheck size={16} aria-hidden="true" /> The system is online. All users can access it normally.
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="mm-message">Downtime message</label>
            <textarea id="mm-message" className="form-textarea" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
            <p className="form-hint">Shown to users while maintenance mode is on.</p>
          </div>

          <div><button type="button" className="btn btn-primary btn-md" onClick={save}><Save size={16} aria-hidden="true" /> Save changes</button></div>
        </div>
      </section>
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
  const [revokeTarget, setRevokeTarget] = useState(null);

  const load = () => api.get('/security/api-keys').then((r) => setKeys(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newName) return;
    try {
      await api.post('/security/api-keys', { name: newName, permissions: newPerms });
      setNewName(''); setShowCreate(false); load();
      toast.success('API key generated');
    } catch { toast.error('Failed to generate API key'); }
  };

  const revoke = async (id) => {
    try {
      await api.delete(`/security/api-keys/${id}`);
      setRevokeTarget(null);
      toast.success('API key revoked');
      load();
    } catch { toast.error('Failed to revoke API key'); }
  };

  const list = Array.isArray(keys) ? keys : [];

  const columns = useMemo(() => [
    { id: 'name', header: 'Name', accessorFn: (k) => k.name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'key', header: 'Key', accessorFn: (k) => k.key || '', enableSorting: false, cell: ({ row }) => <span className="mono">{row.original.key?.substring(0, 20)}…</span> },
    {
      id: 'perms', header: 'Permissions', accessorFn: (k) => (k.permissions || []).join(', '), enableSorting: false,
      cell: ({ row }) => <span className="chip-row">{(row.original.permissions || []).map((p) => <span key={p} className="tag">{p}</span>)}</span>,
    },
    { id: 'created', header: 'Created', accessorFn: (k) => (k.created_at ? new Date(k.created_at).getTime() : 0), meta: { width: 130 }, cell: ({ row }) => <span className="tabular">{fmtDate(row.original.created_at)}</span> },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 120, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setRevokeTarget(row.original)}>
          <Trash2 size={14} aria-hidden="true" /> Revoke
        </button>
      ),
    },
  ], []);

  if (loading) return <Loading />;

  const generateButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => setShowCreate(true)}>
      <Plus size={16} aria-hidden="true" /> Generate key
    </button>
  );

  return (
    <div className="stack">
      <SubHead title="API keys" description="Generate, manage and revoke keys for integrations." actions={generateButton} />

      <section className="panel">
        <DataTable
          columns={columns}
          data={list}
          getRowId={(k) => String(k.id)}
          empty={<EmptyState icon={KeyRound} title="No API keys" description="Generate a key to enable an integration." action={generateButton} />}
        />
      </section>

      <Modal
        open={showCreate}
        onOpenChange={setShowCreate}
        title="Generate API key"
        description="The key is shown in the list once it is generated."
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowCreate(false)}>Cancel</button>
            <button type="submit" form="apikey-form" className="btn btn-primary btn-md">Generate key</button>
          </>
        )}
      >
        <form id="apikey-form" onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="ak-name">Key name</label>
            <input id="ak-name" className="form-input" required value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lab machine integration" />
          </div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="form-label" style={{ marginBottom: 6 }}>Permissions</legend>
            <div style={{ display: 'flex', gap: 16 }}>
              {['read', 'write', 'admin'].map((p) => (
                <label key={p} className="check-row">
                  <input type="checkbox" checked={newPerms.includes(p)} onChange={() => setNewPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))} /> {sentence(p)}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </Modal>

      <ConfirmModal
        target={revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke this API key?"
        description={revokeTarget ? `${revokeTarget.name} will stop working immediately.` : ''}
        confirmLabel="Revoke key"
        cancelLabel="Keep key"
        onConfirm={(k) => revoke(k.id)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ANNOUNCEMENTS PANEL
// ═══════════════════════════════════════════════════════
const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' };
const EMPTY_ANNOUNCEMENT = { title: '', message: '', severity: 'info', target_roles: ['all'] };

function AnnouncementsPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_ANNOUNCEMENT);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = () => api.get('/security/announcements').then((r) => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title || !form.message) return toast.error('Enter a title and a message');
    try {
      await api.post('/security/announcements', form);
      setForm(EMPTY_ANNOUNCEMENT); setShowForm(false); load();
      toast.success('Announcement published');
    } catch { toast.error('Failed to publish announcement'); }
  };

  const remove = async (id) => {
    try {
      await api.delete(`/security/announcements/${id}`);
      setDeleteTarget(null);
      toast.success('Announcement deleted');
      load();
    } catch { toast.error('Failed to delete announcement'); }
  };

  const list = Array.isArray(items) ? items : [];

  const columns = useMemo(() => [
    {
      id: 'title', header: 'Announcement', accessorFn: (a) => a.title || '',
      cell: ({ row }) => (
        <span className="cell-stack" style={{ maxWidth: 620 }}>
          <span className="cell-primary">{row.original.title}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>{row.original.message}</span>
        </span>
      ),
    },
    {
      id: 'severity', header: 'Severity', accessorFn: (a) => a.severity || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${SEVERITY_TONE[getValue()] || 'neutral'}`}>{sentence(getValue())}</span>,
    },
    {
      id: 'posted', header: 'Posted', accessorFn: (a) => (a.created_at ? new Date(a.created_at).getTime() : 0), meta: { width: 210 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="tabular">{fmtDateTime(row.original.created_at)}</span>
          <span className="cell-secondary">By {row.original.created_by}</span>
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="icon-btn row-action" aria-label={`Delete announcement ${row.original.title}`} onClick={() => setDeleteTarget(row.original)}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ),
    },
  ], []);

  if (loading) return <Loading />;

  const newButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>
      <Plus size={16} aria-hidden="true" /> New announcement
    </button>
  );

  return (
    <div className="stack">
      <SubHead title="Announcements" description="Broadcast notices to users across the hospital." actions={newButton} />

      <section className="panel">
        <DataTable
          columns={columns}
          data={list}
          getRowId={(a) => String(a.id)}
          initialSorting={[{ id: 'posted', desc: true }]}
          empty={<EmptyState icon={Megaphone} title="No announcements" description="Publish an announcement to notify users." action={newButton} />}
        />
      </section>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="New announcement"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="announcement-form" className="btn btn-primary btn-md">Publish</button>
          </>
        )}
      >
        <form id="announcement-form" onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="an-title">Title</label>
            <input id="an-title" className="form-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="an-message">Message</label>
            <textarea id="an-message" className="form-textarea" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="an-severity">Severity</label>
            <select id="an-severity" className="form-select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              <option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option>
            </select>
          </div>
        </form>
      </Modal>

      <ConfirmModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this announcement?"
        description={deleteTarget ? `"${deleteTarget.title}" will no longer be shown to users.` : ''}
        confirmLabel="Delete announcement"
        cancelLabel="Keep announcement"
        onConfirm={(a) => remove(a.id)}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ERROR LOGS PANEL
// ═══════════════════════════════════════════════════════
function ErrorLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); api.get('/security/error-logs').then((r) => setLogs(r.data.data)).catch(console.error).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const columns = useMemo(() => [
    { id: 'level', header: 'Level', accessorFn: (l) => l.level || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="status status-danger">{getValue()}</span> },
    {
      id: 'message', header: 'Message', accessorFn: (l) => l.message || '', enableSorting: false,
      cell: ({ getValue }) => <span className="mono" style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{getValue()}</span>,
    },
    { id: 'time', header: 'Time', accessorFn: (l) => (l.timestamp ? new Date(l.timestamp).getTime() : 0), meta: { width: 200 }, cell: ({ row }) => <span className="tabular cell-secondary">{fmtDateTime(row.original.timestamp)}</span> },
  ], []);

  return (
    <div className="stack">
      <SubHead
        title="Error logs"
        description="Application errors and failed API calls."
        actions={<button type="button" className="btn btn-ghost btn-md" onClick={load}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>}
      />
      <section className="panel">
        <DataTable
          columns={columns}
          data={Array.isArray(logs) ? logs : []}
          loading={loading}
          getRowId={(l, i) => String(l.id ?? i)}
          pageSize={50}
          empty={<EmptyState icon={CircleCheck} title="No errors" description="No application errors have been recorded." />}
        />
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// INTEGRATION HUB PANEL
// ═══════════════════════════════════════════════════════
const CATEGORY_ICON = { EHR: Hospital, Insurance: ShieldCheck, Communication: Mail, Lab: Microscope, Billing: CreditCard };

function IntegrationHubPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = () => api.get('/security/integrations').then((r) => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    try { await api.put(`/security/integrations/${id}/toggle`); load(); } catch { toast.error('Failed to change the integration'); }
  };

  if (loading) return <Loading />;

  const list = Array.isArray(items) ? items : [];

  return (
    <div className="stack">
      <SubHead title="Integration hub" description="Third-party systems: HL7/FHIR, insurance portals, lab machines and gateways." />

      {list.length === 0 ? (
        <section className="panel"><EmptyState icon={Network} title="No integrations" description="Configured integrations appear here." /></section>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {list.map((intg) => {
            const Icon = CATEGORY_ICON[intg.category] || Link;
            const active = intg.status === 'active';
            return (
              <section key={intg.id} className="panel panel-pad stack-sm">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <span className="cell-person">
                    <span className="cell-avatar" aria-hidden="true"><Icon size={16} /></span>
                    <span className="cell-stack">
                      <span className="cell-primary">{intg.name}</span>
                      <span className="cell-secondary">{intg.category}</span>
                    </span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className={`status ${active ? 'status-success' : 'status-neutral'}`}>{active ? 'Active' : 'Off'}</span>
                    <Switch checked={active} onChange={() => toggle(intg.id)} label={`${intg.name} integration`} />
                  </span>
                </div>
                <div className="mono" style={{ color: 'var(--text-muted)', wordBreak: 'break-all' }}>{intg.endpoint}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  <span>Last sync: {intg.last_sync ? fmtDateTime(intg.last_sync) : 'Never'}</span>
                  <span className="tabular">{intg.requests_today} requests today</span>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// NOTIFICATION CONFIG PANEL
// ═══════════════════════════════════════════════════════
const EMPTY_RULE = { event: '', channel: 'Email', recipients: 'super_admin', threshold: 1 };

function NotificationConfigPanel() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_RULE);

  const load = () => api.get('/security/notifications').then((r) => setRules(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggle = async (id) => { try { await api.put(`/security/notifications/${id}/toggle`); load(); } catch { toast.error('Failed to change the rule'); } };
  const create = async () => {
    if (!form.event) return;
    try {
      await api.post('/security/notifications', form);
      setForm(EMPTY_RULE); setShowForm(false); load();
      toast.success('Rule saved');
    } catch { toast.error('Failed to save the rule'); }
  };

  const columns = useMemo(() => [
    { id: 'event', header: 'Event', accessorFn: (r) => r.event || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'channel', header: 'Channel', accessorFn: (r) => r.channel || '', meta: { width: 140 }, cell: ({ getValue }) => <span className="tag">{getValue()}</span> },
    { id: 'recipients', header: 'Recipients', accessorFn: (r) => human(r.recipients), cell: ({ getValue }) => sentence(getValue()) },
    { id: 'threshold', header: 'Threshold', accessorFn: (r) => Number(r.threshold) || 0, meta: { width: 110, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
    {
      id: 'active', header: 'Status', accessorFn: (r) => (r.active ? 1 : 0), meta: { width: 150 },
      cell: ({ row }) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={row.original.active} onChange={() => toggle(row.original.id)} label={`Rule: ${row.original.event}`} />
          <span className={`status ${row.original.active ? 'status-success' : 'status-neutral'}`}>{row.original.active ? 'Active' : 'Off'}</span>
        </span>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  if (loading) return <Loading />;

  const newButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>
      <Plus size={16} aria-hidden="true" /> New rule
    </button>
  );

  return (
    <div className="stack">
      <SubHead title="Notification rules" description="Who is alerted about failures, thresholds and escalations." actions={newButton} />

      <section className="panel">
        <DataTable
          columns={columns}
          data={Array.isArray(rules) ? rules : []}
          getRowId={(r) => String(r.id)}
          empty={<EmptyState icon={BellRing} title="No rules" description="Add a rule to route system alerts." action={newButton} />}
        />
      </section>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="New notification rule"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="rule-form" className="btn btn-primary btn-md">Save rule</button>
          </>
        )}
      >
        <form id="rule-form" onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="nr-event">Event</label>
            <input id="nr-event" className="form-input" required value={form.event} onChange={(e) => setForm({ ...form, event: e.target.value })} placeholder="e.g. Server CPU > 90%" />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="nr-channel">Channel</label>
              <select id="nr-channel" className="form-select" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                <option>Email</option><option>SMS</option><option>SMS + Email</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="nr-threshold">Threshold</label>
              <input id="nr-threshold" type="number" className="form-input" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: Number(e.target.value) })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="nr-recipients">Recipients</label>
            <input id="nr-recipients" className="form-input" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} />
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// COMPLIANCE CENTER PANEL
// ═══════════════════════════════════════════════════════
const CHECK_STATUS = { pass: { tone: 'success', label: 'Pass' }, warn: { tone: 'warning', label: 'Warning' }, fail: { tone: 'danger', label: 'Fail' } };

function ComplianceCenterPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/security/compliance').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false)); }, []);
  if (loading) return <Loading />;
  if (!data) return <LoadFailed />;

  const checks = data.checks || [];
  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const score = data.overall_score;
  const scoreTone = score >= 80 ? undefined : score >= 60 ? 'warning' : 'danger';
  const scoreColor = score >= 80 ? 'var(--success)' : score >= 60 ? 'var(--amber)' : 'var(--red)';

  return (
    <div className="stack">
      <SubHead title="Compliance" description="HIPAA and DPDP compliance status, data access policies and breach alerts." />

      <div className="kpi-strip" style={{ marginBottom: 0 }}>
        <Kpi label="Compliance score" value={`${score}%`} tone={scoreTone} />
        <Kpi label="Checks passed" value={passCount} />
        <Kpi label="Warnings" value={warnCount} tone={warnCount > 0 ? 'warning' : undefined} />
        <Kpi label="Failed" value={failCount} tone={failCount > 0 ? 'danger' : undefined} />
      </div>

      <section className="panel panel-pad">
        <div className="bar-row">
          <span>Overall compliance</span>
          <strong className="tabular" style={{ color: scoreColor }}>{score}%</strong>
        </div>
        <div className="bar-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Overall compliance" style={{ height: 10, borderRadius: 5 }}>
          <div className="bar-fill" style={{ width: `${score}%`, background: scoreColor }} />
        </div>
      </section>

      <section className="panel">
        <PanelHead icon={ClipboardCheck} title="Compliance checks" />
        <div className="panel-pad">
          <table className="mini-table">
            <thead><tr><th>Check</th><th>Category</th><th>Status</th><th>Detail</th></tr></thead>
            <tbody>
              {checks.map((c, i) => {
                const st = CHECK_STATUS[c.status] || { tone: 'neutral', label: c.status };
                return (
                  <tr key={i}>
                    <td className="cell-primary">{c.name}</td>
                    <td><span className="tag">{c.category}</span></td>
                    <td><span className={`status status-${st.tone}`}>{st.label}</span></td>
                    <td style={{ color: 'var(--text-secondary)' }}>{c.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DATA GOVERNANCE PANEL
// ═══════════════════════════════════════════════════════
function DataGovernancePanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = () => api.get('/security/data-governance').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const toggleMask = async (idx) => {
    try { await api.put(`/security/data-governance/pii/${idx}/toggle`); load(); } catch { toast.error('Failed to change masking'); }
  };

  if (loading) return <Loading />;
  if (!data) return <LoadFailed />;

  return (
    <div className="stack">
      <SubHead title="Data governance" description="Retention policies, PII masking rules and purge schedules." />

      <section className="panel">
        <PanelHead icon={Database} title="Data retention policies" />
        <div className="panel-pad">
          <table className="mini-table">
            <thead><tr><th>Entity</th><th>Retention period</th><th>Auto purge</th><th>Last purge</th></tr></thead>
            <tbody>
              {data.retention_policies?.map((p) => (
                <tr key={p.id}>
                  <td className="cell-primary">{p.entity}</td>
                  <td>{p.retention}</td>
                  <td>{p.auto_purge ? <span className="status status-success">On</span> : <span className="status status-neutral">Off</span>}</td>
                  <td className="tabular cell-secondary">{p.last_purge ? fmtDate(p.last_purge) : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <PanelHead icon={ShieldCheck} title="PII field masking" />
        <div className="panel-pad">
          <table className="mini-table">
            <thead><tr><th>Table</th><th>Field</th><th>Masking rule</th><th>Status</th><th><span className="sr-only">Masking on or off</span></th></tr></thead>
            <tbody>
              {data.pii_fields?.map((f, i) => (
                <tr key={i}>
                  <td className="mono">{f.table}</td>
                  <td className="cell-primary">{f.field}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{f.masking_rule}</td>
                  <td>{f.masked ? <span className="status status-success">Masked</span> : <span className="status status-warning">Exposed</span>}</td>
                  <td className="text-right"><Switch checked={f.masked} onChange={() => toggleMask(i)} label={`Mask ${f.table}.${f.field}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// LICENSE MANAGER PANEL
// ═══════════════════════════════════════════════════════
const LICENSE_TONE = { active: 'success', expiring_soon: 'warning', expired: 'danger' };
const EMPTY_LICENSE = { name: '', vendor: '', type: 'Subscription', expiry: '', seats: '' };

function LicenseManagerPanel() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_LICENSE);

  const load = () => api.get('/security/licenses').then((r) => setItems(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.name) return;
    try {
      await api.post('/security/licenses', form);
      setForm(EMPTY_LICENSE); setShowForm(false); load();
      toast.success('License added');
    } catch { toast.error('Failed to add license'); }
  };

  const columns = useMemo(() => [
    { id: 'name', header: 'Software', accessorFn: (l) => l.name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'vendor', header: 'Vendor', accessorFn: (l) => l.vendor || '' },
    { id: 'type', header: 'Type', accessorFn: (l) => l.type || '', meta: { width: 130 }, cell: ({ getValue }) => <span className="tag">{getValue()}</span> },
    { id: 'seats', header: 'Seats', accessorFn: (l) => l.seats || '', meta: { width: 100 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    { id: 'expiry', header: 'Expiry', accessorFn: (l) => l.expiry || '', meta: { width: 130 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (l) => l.status || '', meta: { width: 140 },
      cell: ({ getValue }) => <span className={`status status-${LICENSE_TONE[getValue()] || 'success'}`}>{sentence(getValue())}</span>,
    },
  ], []);

  if (loading) return <Loading />;

  const addButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>
      <Plus size={16} aria-hidden="true" /> Add license
    </button>
  );

  return (
    <div className="stack">
      <SubHead title="Licenses" description="Software licenses, module subscriptions and expiry dates." actions={addButton} />

      <section className="panel">
        <DataTable
          columns={columns}
          data={Array.isArray(items) ? items : []}
          getRowId={(l) => String(l.id)}
          empty={<EmptyState icon={BadgeCheck} title="No licenses" description="Add a license to track its expiry." action={addButton} />}
        />
      </section>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="Add license"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="license-form" className="btn btn-primary btn-md">Save license</button>
          </>
        )}
      >
        <form id="license-form" onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="lc-name">Name</label>
              <input id="lc-name" className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="lc-vendor">Vendor</label>
              <input id="lc-vendor" className="form-input" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="lc-type">Type</label>
              <select id="lc-type" className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option>Subscription</option><option>Enterprise</option><option>Free</option><option>Internal</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="lc-expiry">Expiry date</label>
              <input id="lc-expiry" type="date" className="form-input" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="lc-seats">Seats or capacity</label>
            <input id="lc-seats" className="form-input" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
          </div>
        </form>
      </Modal>
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

  const load = () => api.get('/security/role-templates').then((r) => setData(r.data.data)).catch(console.error).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const startEdit = (tmpl) => { setEditing(tmpl.id); setEditPerms([...tmpl.permissions]); };
  const cancelEdit = () => { setEditing(null); setEditPerms([]); };
  const saveEdit = async (id) => {
    try { await api.put(`/security/role-templates/${id}`, { permissions: editPerms }); setEditing(null); load(); toast.success('Role template saved'); } catch { toast.error('Failed to save role template'); }
  };
  const togglePerm = (p) => setEditPerms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  if (loading) return <Loading />;
  if (!data) return <LoadFailed />;

  return (
    <div className="stack">
      <SubHead title="Role templates" description="Ready-made permission sets for each role: doctor, nurse, receptionist, lab technician and more." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {data.templates?.map((tmpl) => {
          const isEditing = editing === tmpl.id;
          return (
            <section key={tmpl.id} className="panel">
              <PanelHead
                title={sentence(tmpl.label)}
                actions={isEditing ? (
                  <span className="inline-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => saveEdit(tmpl.id)}><Save size={14} aria-hidden="true" /> Save</button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(tmpl)}><Pencil size={14} aria-hidden="true" /> Edit</button>
                )}
              />
              <div className="panel-pad">
                {isEditing ? (
                  <div className="chip-row" role="group" aria-label={`Permissions for ${tmpl.label}`}>
                    {data.all_permissions?.map((p) => {
                      const on = editPerms.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={on}
                          onClick={() => togglePerm(p)}
                          className="tag"
                          style={{
                            cursor: 'pointer', font: 'inherit', fontSize: '0.78rem',
                            background: on ? 'var(--primary-light)' : 'var(--surface-2)',
                            borderColor: on ? 'var(--primary)' : 'var(--border)',
                            color: on ? 'var(--primary)' : 'var(--text-secondary)',
                            fontWeight: on ? 600 : 400,
                          }}
                        >
                          {human(p)}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="chip-row">
                    {tmpl.permissions?.map((p) => <span key={p} className="tag">{human(p)}</span>)}
                  </div>
                )}
                <p className="muted" style={{ marginTop: 12, fontSize: '0.8rem' }}>
                  {isEditing ? editPerms.length : tmpl.permissions?.length} permissions assigned
                </p>
              </div>
            </section>
          );
        })}
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

  const sections = [...new Set(NAV.map((n) => n.section))];
  const activeSection = NAV.find((n) => n.id === activePanel)?.section || sections[0];
  const sectionItems = NAV.filter((n) => n.section === activeSection);
  const activeItem = NAV.find((n) => n.id === activePanel);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Security and system" description="Access control, audit, system health, integrations and compliance." />

        <div className="tabs" role="tablist" aria-label="Areas">
          {sections.map((sec) => {
            const Icon = GROUP_ICON[sec] || Shield;
            const isActive = sec === activeSection;
            return (
              <button
                key={sec}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`tab${isActive ? ' is-active' : ''}`}
                onClick={() => { if (!isActive) setActivePanel(NAV.find((n) => n.section === sec).id); }}
              >
                <Icon size={16} aria-hidden="true" /> {sec}
              </button>
            );
          })}
        </div>

        <div className="segmented" role="tablist" aria-label={`${activeSection} sections`} style={{ marginBottom: 20 }}>
          {sectionItems.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                role="tab"
                id={`sec-tab-${n.id}`}
                aria-selected={activePanel === n.id}
                aria-controls="sec-panel"
                className={activePanel === n.id ? 'is-active' : ''}
                onClick={() => setActivePanel(n.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Icon size={15} aria-hidden="true" /> {n.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id="sec-panel" aria-labelledby={activeItem ? `sec-tab-${activeItem.id}` : undefined}>
          {panels[activePanel] || <p className="muted">Section not found.</p>}
        </div>
      </main>
    </>
  );
}
