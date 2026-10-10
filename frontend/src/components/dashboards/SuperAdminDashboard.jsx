import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, ChevronRight, CircleAlert, ScrollText, Settings, ShieldCheck, Users } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import PatientAnalyticsModal from '../PatientAnalyticsModal';
import PageHeader from '../ui/PageHeader';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// First name, keeping a leading honorific ("Sister Mary", "Dr. Rao").
const firstName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  // Shared role accounts ("System Administrator") read oddly by first name alone.
  if (/admin|system/i.test(name)) return parts.join(' ');
  if (parts.length > 1 && /^(dr|mr|mrs|ms|miss|sister|sr|prof)\.?$/i.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
};

const fmtDateTime = (v) => (v
  ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  : '—');

// "LOGIN_FAILED" -> "Login failed"
const humanize = (s) => {
  const t = String(s || '').replace(/_/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};
const ACTION_TONE = { LOGIN: 'success', LOGIN_FAILED: 'danger' };

// A KPI tile that opens a page or dialog: same look as a static tile, but a real button.

const ADMIN_LINKS = [
  { label: 'User management', path: '/hms/admin/users', icon: Users },
  { label: 'Reports & analytics', path: '/reports', icon: BarChart3 },
  { label: 'System settings', path: '/admin/settings', icon: Settings },
];

// Super admin home: patient registrations, user access, system alerts and the audit trail.
export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsMetric, setAnalyticsMetric] = useState(null);

  useEffect(() => {
    api.get('/dashboard/super-admin')
      .then(res => setData(res.data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo(() => [
    {
      id: 'user', header: 'User', accessorFn: (l) => l.user || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    {
      id: 'action', header: 'Action', accessorFn: (l) => l.action || '', meta: { width: 200 },
      cell: ({ getValue }) => <span className={`status status-${ACTION_TONE[getValue()] || 'neutral'}`}>{humanize(getValue())}</span>,
    },
    { id: 'module', header: 'Module', accessorFn: (l) => l.module || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'time', header: 'Time', meta: { width: 160 },
      accessorFn: (l) => (l.created_at ? new Date(l.created_at).getTime() : 0),
      cell: ({ row }) => <span className="tabular">{fmtDateTime(row.original.created_at)}</span>,
    },
  ], []);

  const show = (v) => (loading ? '—' : v);
  const failedLogins = Number(data?.alerts?.failed_logins_today || 0);
  const lowStock = Number(data?.alerts?.low_stock_count || 0);
  const criticalLabs = Number(data?.alerts?.critical_lab_count || 0);

  const kpis = [
    { label: 'New patients today', value: data?.today_patients || 0, analytics: { kind: 'patients', scope: 'today', title: "Today's Patient Analytics" } },
    { label: 'New patients this week', value: data?.week_patients || 0, analytics: { kind: 'patients', scope: 'week', title: 'Weekly Patient Analytics' } },
    { label: 'New patients this month', value: data?.month_patients || 0, analytics: { kind: 'patients', scope: 'month', title: 'Monthly Patient Analytics' } },
    { label: 'Active users', value: data?.active_users || 0, analytics: { kind: 'users', scope: 'active', title: 'User Access Analytics' } },
  ];

  const alerts = [
    { label: 'Failed sign-ins today', value: failedLogins, color: failedLogins > 0 ? 'var(--amber)' : undefined },
    { label: 'Low stock items', value: lowStock, color: lowStock > 0 ? 'var(--amber)' : undefined },
    { label: 'Critical lab results', value: criticalLabs, color: criticalLabs > 0 ? 'var(--red)' : undefined },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name)}`}
        description="System-wide overview of patient registrations, user access and audit activity."
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/reports')}>
              <BarChart3 size={16} aria-hidden="true" /> Reports & analytics
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/admin/users')}>
              <Users size={16} aria-hidden="true" /> User management
            </button>
          </>
        )}
      />

      {!loading && criticalLabs > 0 && (
        <div className="alert-strip alert-danger" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span><strong>{criticalLabs} critical lab {criticalLabs === 1 ? 'result' : 'results'}</strong> reported. Make sure the treating doctors have been told.</span>
        </div>
      )}
      {!loading && failedLogins > 0 && (
        <div className="alert-strip alert-warning" role="status">
          <ShieldCheck size={16} aria-hidden="true" />
          <span><strong>{failedLogins} failed sign-in {failedLogins === 1 ? 'attempt' : 'attempts'}</strong> today. Check the audit log below for repeated attempts.</span>
        </div>
      )}

      <div className="kpi-strip">
        {kpis.map((k) => {
          const body = (
            <>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{show(k.value)}</div>
              {data && <div className="kpi-sub">View analytics</div>}
            </>
          );
          return data ? (
            <button
              key={k.label}
              type="button"
              className="panel kpi kpi-button"
              onClick={() => setAnalyticsMetric(k.analytics)}
              aria-label={`${k.label}: ${k.value}. Open ${k.label.toLowerCase()} analytics`}
            >
              {body}
            </button>
          ) : (
            <div key={k.label} className="panel kpi">{body}</div>
          );
        })}
      </div>

      <div className="split-2" style={{ marginBottom: 16 }}>
        <section className="panel panel-pad">
          <h2 className="panel-title"><CircleAlert size={16} aria-hidden="true" /> System alerts</h2>
          <ul className="list-rows">
            {alerts.map((a) => (
              <li key={a.label}>
                <div className="list-row list-row-static">
                  <span>{a.label}</span>
                  <strong className="tabular" style={{ color: a.color }}>{show(a.value)}</strong>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel panel-pad">
          <h2 className="panel-title"><Settings size={16} aria-hidden="true" /> Admin controls</h2>
          <ul className="list-rows">
            {ADMIN_LINKS.map((l) => {
              const Icon = l.icon;
              return (
                <li key={l.path}>
                  <button type="button" className="list-row" onClick={() => navigate(l.path)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                      {l.label}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}><ScrollText size={16} aria-hidden="true" /> Recent audit log</h2>
        </div>
        <DataTable
          columns={columns}
          data={data?.recent_audit || []}
          loading={loading}
          getRowId={(l, i) => String(l.id ?? i)}
          pageSize={10}
          initialSorting={[{ id: 'time', desc: true }]}
          empty={<EmptyState icon={ScrollText} title="No audit entries yet" description="Sign-ins and changes to records appear here as people use the system." />}
        />
      </section>

      <PatientAnalyticsModal
        isOpen={!!analyticsMetric}
        onClose={() => setAnalyticsMetric(null)}
        data={data}
        metric={analyticsMetric}
      />
    </>
  );
}
