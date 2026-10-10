import { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { Download } from 'lucide-react';
import Modal from './ui/Modal';

// Chart colours come from CSS tokens (styles/components.css), so they switch with the theme.
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'];
const NEUTRAL = 'var(--chart-neutral)';
const AXIS_TICK = { fontSize: 11, fill: 'var(--text-muted)' };
const TYPE_LABELS = { corporate_employee: 'Corporate', other: 'General' };

const SCOPE_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'prev_month', label: 'Previous month' },
  { key: 'all', label: 'Last 30 days' },
];

function fmtDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const roleLabel = (role) => String(role || 'Unknown').split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function exportToCSV(scopeLabel, scoped, isUserMode, userAnalytics) {
  const rows = [];
  const timestamp = new Date().toLocaleString('en-IN');
  if (isUserMode) {
    rows.push(['User access analytics'], ['Exported', timestamp], [], ['Status', 'Count']);
    rows.push(['Active', userAnalytics?.active ?? 0], ['Inactive', userAnalytics?.inactive ?? 0], ['Total', userAnalytics?.total ?? 0], []);
    rows.push(['Role', 'Count']);
    Object.entries(userAnalytics?.by_role || {}).forEach(([role, count]) => rows.push([roleLabel(role), count]));
  } else {
    const byType = scoped?.by_type || {};
    const byGender = scoped?.by_gender || {};
    const flow = scoped?.opd_vs_indoor || {};
    rows.push([`Patient analytics: ${scopeLabel}`], ['Exported', timestamp], [], ['Total patients', scoped?.total ?? 0], []);
    rows.push(['Patient type', 'Count']);
    Object.keys(TYPE_LABELS).forEach((k) => rows.push([TYPE_LABELS[k], byType[k] || 0]));
    rows.push([], ['Flow', 'Count'], ['OPD', flow.OPD || 0], ['Indoor', flow.Indoor || 0], []);
    rows.push(['Gender', 'Count']);
    ['Male', 'Female', 'Other'].forEach((g) => rows.push([g, byGender[g] || 0]));
    const trend = scoped?.trend || [];
    if (trend.length > 0) {
      rows.push([], ['Date', 'Registrations']);
      trend.forEach((t) => rows.push([t.date, t.count]));
    }
  }
  const csvContent = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = (isUserMode ? 'user_analytics' : `patient_analytics_${scopeLabel}`).replace(/\s+/g, '_').toLowerCase();
  link.download = `${safeName}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const n = payload[0].value;
  return (
    <div className="chart-tip">
      <div className="muted" style={{ fontSize: '0.78rem' }}>{fmtDay(label)}</div>
      <strong>{n} {n === 1 ? 'patient' : 'patients'}</strong>
    </div>
  );
}

function NameValueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tip">
      <div className="muted" style={{ fontSize: '0.78rem' }}>{p.payload?.name ?? p.name}</div>
      <strong>{p.value}</strong>
    </div>
  );
}

function ChartCard({ title, subtitle, span, children }) {
  return (
    <section className={`chart-card${span ? ' span-all' : ''}`}>
      <h3>{title}</h3>
      {subtitle && <p className="chart-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

const Legend = ({ items }) => (
  <ul className="chart-legend">
    {items.map((it) => (
      <li key={it.name}><span className="swatch" style={{ background: it.color }} aria-hidden="true" />{it.name}<span className="muted">{it.value}</span></li>
    ))}
  </ul>
);

const NoData = () => <p className="muted" style={{ height: 180, display: 'grid', placeItems: 'center' }}>No data for this period.</p>;

function Donut({ data, total, centerLabel = 'patients' }) {
  if (!data.length) return <NoData />;
  return (
    <div style={{ position: 'relative', width: '100%', height: 200 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={82} paddingAngle={2}
            stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip content={<NameValueTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
        <div>
          <div className="tabular" style={{ fontSize: '1.5rem', fontWeight: 650, lineHeight: 1 }}>{total}</div>
          <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>{centerLabel}</div>
        </div>
      </div>
    </div>
  );
}

function SingleSeriesBars({ data, horizontal = false, height = 220 }) {
  if (!data.length) return <NoData />;
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        {horizontal ? (
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} />
            <Tooltip content={<NameValueTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }} />
            <Bar dataKey="value" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={false} />
          </BarChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} />
            <YAxis allowDecimals={false} width={30} tickLine={false} axisLine={false} tick={AXIS_TICK} />
            <Tooltip content={<NameValueTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }} />
            <Bar dataKey="value" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// Patient registration and user access analytics, opened from the admin dashboards' KPI tiles.
export default function PatientAnalyticsModal({ isOpen, onClose, data, metric }) {
  const [activeScope, setActiveScope] = useState(null);

  const close = () => { setActiveScope(null); onClose(); };

  const selectedMetric = metric || { kind: 'patients', scope: 'all' };
  const isUserAnalytics = selectedMetric.kind === 'users';
  const currentScope = activeScope || selectedMetric.scope || 'all';
  const scopeLabel = SCOPE_TABS.find((t) => t.key === currentScope)?.label || currentScope;
  const patientAnalytics = data?.patient_analytics || {};
  const scoped = patientAnalytics.scopes?.[currentScope] || patientAnalytics;

  let summary = [];
  let body = null;

  if (isUserAnalytics) {
    const ua = data?.user_analytics || {};
    const activeUsers = Number(ua.active ?? data?.active_users ?? 0);
    const totalUsers = Number(ua.total ?? activeUsers);
    const inactiveUsers = Number(ua.inactive ?? Math.max(0, totalUsers - activeUsers));
    const roleData = Object.entries(ua.by_role || {})
      .map(([role, value]) => ({ name: roleLabel(role), value: Number(value || 0) }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    const statusData = [
      { name: 'Active', value: activeUsers, color: SERIES[0] },
      { name: 'Inactive', value: inactiveUsers, color: NEUTRAL },
    ].filter((d) => d.value > 0);

    summary = [
      { label: 'Total users', value: totalUsers },
      { label: 'Active', value: activeUsers },
      { label: 'Inactive', value: inactiveUsers },
      { label: 'Roles in use', value: roleData.length },
    ];
    body = (
      <>
        <ChartCard title="Active status" subtitle={`${activeUsers} of ${totalUsers} accounts can sign in`}>
          <Donut data={statusData} total={totalUsers} centerLabel="users" />
          {statusData.length > 0 && <Legend items={statusData} />}
        </ChartCard>
        <ChartCard title="Accounts by role" subtitle={`${roleData.length} roles in use`}>
          <SingleSeriesBars data={roleData} horizontal height={Math.max(160, roleData.length * 36)} />
        </ChartCard>
      </>
    );
  } else {
    const trend = scoped.trend || [];
    const byType = scoped.by_type || {};
    const flow = scoped.opd_vs_indoor || {};
    const byGender = scoped.by_gender || {};
    const typeData = Object.keys(TYPE_LABELS).map((k, i) => ({ name: TYPE_LABELS[k], value: byType[k] || 0, color: SERIES[i] })).filter((d) => d.value > 0);
    const flowData = ['OPD', 'Indoor'].map((k, i) => ({ name: k, value: flow[k] || 0, color: SERIES[i] })).filter((d) => d.value > 0);
    const genderData = ['Male', 'Female', 'Other'].map((k) => ({ name: k, value: byGender[k] || 0 })).filter((d) => d.value > 0);
    const periodTotal = Number(scoped.total ?? trend.reduce((s, d) => s + d.count, 0));
    const sum = (arr) => arr.reduce((s, d) => s + d.value, 0);

    summary = [
      { label: `Registrations, ${scopeLabel.toLowerCase()}`, value: periodTotal },
      { label: 'Corporate', value: byType.corporate_employee || 0 },
      { label: 'General', value: byType.other || 0 },
    ];
    body = (
      <>
        <ChartCard span title="Registrations per day" subtitle={`${periodTotal} ${periodTotal === 1 ? 'registration' : 'registrations'}, ${scopeLabel.toLowerCase()}`}>
          {trend.length === 0 ? <NoData /> : trend.length === 1 ? (
            <p className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>
              {trend[0].count} {trend[0].count === 1 ? 'registration' : 'registrations'} on {fmtDay(trend[0].date)}. Choose a longer period to see the trend.
            </p>
          ) : (
            <div style={{ width: '100%', height: 240 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={28} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tick={AXIS_TICK} />
                  <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false} tick={AXIS_TICK} />
                  <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1, strokeDasharray: '3 3' }} />
                  <Area type="monotone" dataKey="count" stroke={SERIES[0]} strokeWidth={2} fill={SERIES[0]} fillOpacity={0.12}
                    dot={false} activeDot={{ r: 4, fill: SERIES[0], stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
        <ChartCard title="By patient category" subtitle={`${sum(typeData)} registered`}>
          <Donut data={typeData} total={sum(typeData)} />
          {typeData.length > 0 && <Legend items={typeData} />}
        </ChartCard>
        <ChartCard title="OPD and indoor" subtitle={`${sum(flowData)} registered`}>
          <Donut data={flowData} total={sum(flowData)} />
          {flowData.length > 0 && <Legend items={flowData} />}
        </ChartCard>
        <ChartCard title="By gender" subtitle={`${sum(genderData)} registered`}>
          <SingleSeriesBars data={genderData} />
        </ChartCard>
      </>
    );
  }

  return (
    <Modal
      open={Boolean(isOpen)}
      onOpenChange={(open) => { if (!open) close(); }}
      size="xl"
      title={isUserAnalytics ? 'User access analytics' : 'Patient analytics'}
      description={isUserAnalytics ? 'Accounts that can sign in, and how they are spread across roles.' : 'Registration trend and patient mix for the selected period.'}
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={close}>Close</button>
          <button type="button" className="btn btn-secondary btn-md" onClick={() => exportToCSV(scopeLabel, scoped, isUserAnalytics, data?.user_analytics)}>
            <Download size={16} aria-hidden="true" /> Export CSV
          </button>
        </>
      )}
    >
      {!isUserAnalytics && (
        <div className="segmented" role="tablist" aria-label="Period" style={{ justifySelf: 'start' }}>
          {SCOPE_TABS.map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={currentScope === tab.key} className={currentScope === tab.key ? 'is-active' : ''} onClick={() => setActiveScope(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="kpi-strip" style={{ marginBottom: 0 }}>
        {summary.map((s) => (
          <div key={s.label} className="panel kpi"><div className="kpi-label">{s.label}</div><div className="kpi-value">{s.value}</div></div>
        ))}
      </div>
      <div className="chart-grid">{body}</div>
    </Modal>
  );
}
