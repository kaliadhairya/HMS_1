import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';

const ACCENT = '#8b5cf6';
const USER_ACCENT = '#0d9488';
const PALETTE = {
  type: { corporate_employee: '#6366f1', cisf_employee: '#0d9488', other: '#94a3b8' },
  flow: { OPD: '#3b82f6', Indoor: '#f59e0b' },
  gender: { Male: '#60a5fa', Female: '#a78bfa', Other: '#94a3b8' },
};
const USER_COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6', '#94a3b8'];
const TYPE_LABELS = { corporate_employee: 'Corporate Employee', cisf_employee: 'CISF', other: 'Other' };

const SCOPE_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'prev_month', label: 'Previous Month' },
  { key: 'all', label: 'Last 30 Days' },
];

function fmtDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function roleLabel(role) {
  return String(role || 'Unknown')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function exportToCSV(scopeLabel, scoped, isUserMode, userAnalytics) {
  const rows = [];
  const timestamp = new Date().toLocaleString('en-IN');

  if (isUserMode) {
    rows.push(['User Access Analytics']);
    rows.push(['Exported', timestamp]);
    rows.push([]);
    rows.push(['Status', 'Count']);
    rows.push(['Active', userAnalytics?.active ?? 0]);
    rows.push(['Inactive', userAnalytics?.inactive ?? 0]);
    rows.push(['Total', userAnalytics?.total ?? 0]);
    rows.push([]);
    rows.push(['Role', 'Count']);
    Object.entries(userAnalytics?.by_role || {}).forEach(([role, count]) => {
      rows.push([roleLabel(role), count]);
    });
  } else {
    rows.push([`Patient Analytics — ${scopeLabel}`]);
    rows.push(['Exported', timestamp]);
    rows.push([]);

    // Summary
    const byType = scoped?.by_type || {};
    const byGender = scoped?.by_gender || {};
    const flow = scoped?.opd_vs_indoor || {};
    rows.push(['Total Patients', scoped?.total ?? 0]);
    rows.push([]);

    // By Type
    rows.push(['Patient Type', 'Count']);
    Object.keys(TYPE_LABELS).forEach(k => {
      rows.push([TYPE_LABELS[k], byType[k] || 0]);
    });
    rows.push([]);

    // OPD vs Indoor
    rows.push(['Flow', 'Count']);
    rows.push(['OPD', flow.OPD || 0]);
    rows.push(['Indoor', flow.Indoor || 0]);
    rows.push([]);

    // By Gender
    rows.push(['Gender', 'Count']);
    ['Male', 'Female', 'Other'].forEach(g => {
      rows.push([g, byGender[g] || 0]);
    });
    rows.push([]);

    // Daily Trend
    const trend = scoped?.trend || [];
    if (trend.length > 0) {
      rows.push(['Date', 'Registrations']);
      trend.forEach(t => rows.push([t.date, t.count]));
    }
  }

  const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
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

const tipBox = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.14)', fontSize: '0.8rem',
};

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tipBox}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>{fmtDay(label)}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
        {payload[0].value} {payload[0].value === 1 ? 'patient' : 'patients'}
      </div>
    </div>
  );
}

function NameValueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const name = p.payload?.name ?? p.name;
  return (
    <div style={tipBox}>
      <div style={{ color: 'var(--text-muted)' }}>{name}</div>
      <div style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{p.value}</div>
    </div>
  );
}

function SectionCard({ title, subtitle, children, span }) {
  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 16,
      padding: 18, gridColumn: span ? '1 / -1' : 'auto',
    }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.3 }}>
          {title}
        </div>
        {subtitle && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.35 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function LegendList({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', marginTop: 14, justifyContent: 'center' }}>
      {items.map(it => (
        <div key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: it.color, flexShrink: 0 }} />
          <span>{it.name}</span><span style={{ color: 'var(--text-muted)' }}>· {it.value}</span>
        </div>
      ))}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
      No data yet
    </div>
  );
}

function Donut({ data, colorFor, total, centerLabel = 'patients' }) {
  if (!data.length) return <Empty />;
  return (
    <div style={{ position: 'relative', width: '100%', height: 210 }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84}
            paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} animationDuration={650}>
            {data.map(d => <Cell key={d.name} fill={colorFor(d)} />)}
          </Pie>
          <Tooltip content={<NameValueTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{total}</div>
        <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 4 }}>{centerLabel}</div>
      </div>
    </div>
  );
}

export default function PatientAnalyticsModal({ isOpen, onClose, data, metric }) {
  const [activeScope, setActiveScope] = useState(null);

  if (!isOpen) return null;

  const selectedMetric = metric || { kind: 'patients', scope: 'all', title: 'Patient Analytics' };
  const isUserAnalytics = selectedMetric.kind === 'users';
  const currentScope = activeScope || selectedMetric.scope || 'all';
  const title = isUserAnalytics ? 'User Access Analytics' : 'Patient Analytics';
  const subtitle = isUserAnalytics
    ? 'Active users and role distribution'
    : 'Registration trends and patient breakdown';
  const headerIcon = isUserAnalytics ? '👥' : '📈';
  const headerAccent = isUserAnalytics ? USER_ACCENT : ACCENT;

  let summary = [];
  let body = null;

  if (isUserAnalytics) {
    const userAnalytics = data?.user_analytics || {};
    const activeUsers = Number(userAnalytics.active ?? data?.active_users ?? 0);
    const totalUsers = Number(userAnalytics.total ?? activeUsers);
    const inactiveUsers = Number(userAnalytics.inactive ?? Math.max(0, totalUsers - activeUsers));
    const roleData = Object.entries(userAnalytics.by_role || {})
      .map(([role, value], index) => ({
        name: roleLabel(role),
        value: Number(value || 0),
        color: USER_COLORS[index % USER_COLORS.length],
      }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value);
    const statusData = [
      { name: 'Active', value: activeUsers, color: USER_ACCENT },
      { name: 'Inactive', value: inactiveUsers, color: '#94a3b8' },
    ].filter(d => d.value > 0);

    summary = [
      { label: 'Total users', value: totalUsers },
      { label: 'Active', value: activeUsers },
      { label: 'Inactive', value: inactiveUsers },
      { label: 'Roles', value: roleData.length },
    ];

    body = (
      <>
        <SectionCard title="Active status" subtitle={activeUsers + ' active out of ' + totalUsers + ' users'}>
          <Donut data={statusData} total={totalUsers} colorFor={(d) => d.color} centerLabel="users" />
          {statusData.length > 0 && <LegendList items={statusData} />}
        </SectionCard>

        <SectionCard title="By role" subtitle={roleData.length + ' configured roles'}>
          {roleData.length === 0 ? <Empty /> : (
            <div style={{ width: '100%', height: 250 }}>
              <ResponsiveContainer>
                <BarChart data={roleData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" strokeOpacity={0.55} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <YAxis type="category" dataKey="name" width={126} tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} />
                  <Tooltip content={<NameValueTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.5 }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={32} animationDuration={650}>
                    {roleData.map(d => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </>
    );
  } else {
    const patientAnalytics = data?.patient_analytics || {};
    const scoped = patientAnalytics.scopes?.[currentScope] || patientAnalytics;
    const trend = scoped.trend || [];
    const byType = scoped.by_type || {};
    const flow = scoped.opd_vs_indoor || {};
    const byGender = scoped.by_gender || {};

    const typeData = Object.keys(TYPE_LABELS)
      .map(k => ({ key: k, name: TYPE_LABELS[k], value: byType[k] || 0 }))
      .filter(d => d.value > 0);
    const typeTotal = typeData.reduce((s, d) => s + d.value, 0);

    const flowData = ['OPD', 'Indoor'].map(k => ({ name: k, value: flow[k] || 0 })).filter(d => d.value > 0);
    const flowTotal = flowData.reduce((s, d) => s + d.value, 0);

    const genderData = ['Male', 'Female', 'Other'].map(k => ({ name: k, value: byGender[k] || 0 })).filter(d => d.value > 0);

    const periodTotal = Number(scoped.total ?? trend.reduce((s, d) => s + d.count, 0));
    const trendTitleByScope = {
      today: 'Registrations — today',
      week: 'Registrations — this week',
      month: 'Registrations — this month',
      prev_month: 'Registrations — previous month',
      all: 'Registrations — last 30 days',
    };

    summary = [
      { label: 'Selected total', value: periodTotal },
      { label: 'Corporate', value: byType.corporate_employee || 0 },
      { label: 'CISF', value: byType.cisf_employee || 0 },
      { label: 'Other', value: byType.other || 0 },
    ];

    body = (
      <>
        <SectionCard
          title={trendTitleByScope[currentScope] || 'Registrations'}
          subtitle={periodTotal + ' ' + (periodTotal === 1 ? 'registration' : 'registrations') + ' in this view'}
          span
        >
          <div style={{ width: '100%', height: 252 }}>
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="pa-trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                <XAxis dataKey="date" tickFormatter={fmtDay} minTickGap={28} tickLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} />
                <YAxis allowDecimals={false} width={34} tickLine={false} axisLine={false}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: ACCENT, strokeOpacity: 0.25, strokeWidth: 1 }} />
                <Area type="monotone" dataKey="count" stroke={ACCENT} strokeWidth={2} fill="url(#pa-trend)"
                  dot={false} activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }} animationDuration={750} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="By patient type" subtitle={typeTotal + ' registered'}>
          <Donut data={typeData} total={typeTotal} colorFor={(d) => PALETTE.type[d.key]} />
          {typeData.length > 0 && (
            <LegendList items={typeData.map(d => ({ name: d.name, value: d.value, color: PALETTE.type[d.key] }))} />
          )}
        </SectionCard>

        <SectionCard title="OPD vs Indoor" subtitle={flowTotal + ' registered'}>
          <Donut data={flowData} total={flowTotal} colorFor={(d) => PALETTE.flow[d.name]} />
          {flowData.length > 0 && (
            <LegendList items={flowData.map(d => ({ name: d.name, value: d.value, color: PALETTE.flow[d.name] }))} />
          )}
        </SectionCard>

        <SectionCard title="By gender">
          {genderData.length === 0 ? <Empty /> : (
            <div style={{ width: '100%', height: 210 }}>
              <ResponsiveContainer>
                <BarChart data={genderData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" strokeOpacity={0.55} />
                  <XAxis dataKey="name" tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} />
                  <YAxis allowDecimals={false} width={30} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                  <Tooltip content={<NameValueTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.5 }} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} maxBarSize={52} animationDuration={650}>
                    {genderData.map(d => <Cell key={d.name} fill={PALETTE.gender[d.name]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </>
    );
  }

  const scopeLabel = SCOPE_TABS.find(t => t.key === currentScope)?.label || currentScope;
  const patientAnalytics = data?.patient_analytics || {};
  const currentScoped = patientAnalytics.scopes?.[currentScope] || patientAnalytics;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999,
      animation: 'fadeIn 0.2s ease-out', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--surface)', width: '100%', maxWidth: 1040, maxHeight: '90vh',
        borderRadius: 20, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.35)', border: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 26px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <span style={{
              width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.3rem', background: headerAccent + '1f', border: '1px solid ' + headerAccent + '40', flexShrink: 0,
            }}>{headerIcon}</span>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>{title}</h2>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>{subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => exportToCSV(scopeLabel, currentScoped, isUserAnalytics, data?.user_analytics)}
              title="Export to Excel (CSV)"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 9,
                background: 'linear-gradient(135deg, #059669, #10b981)',
                color: '#fff', border: 'none', cursor: 'pointer',
                fontSize: '0.78rem', fontWeight: 700,
                boxShadow: '0 2px 8px rgba(5,150,105,0.25)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(5,150,105,0.35)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(5,150,105,0.25)'; }}
            >
              📥 Export Excel
            </button>
            <button onClick={onClose} aria-label="Close" style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)', width: 34, height: 34, borderRadius: 9,
              fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>×</button>
          </div>
        </div>

        {/* Scope Tabs (only for patient analytics, not user analytics) */}
        {!isUserAnalytics && (
          <div style={{
            display: 'flex', gap: 4, padding: '10px 26px', borderBottom: '1px solid var(--border)',
            background: 'var(--surface-2)', overflowX: 'auto',
          }}>
            {SCOPE_TABS.map(tab => {
              const isActive = currentScope === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveScope(tab.key)}
                  style={{
                    padding: '7px 16px', borderRadius: 8,
                    border: isActive ? '1px solid ' + ACCENT + '44' : '1px solid transparent',
                    background: isActive ? ACCENT + '18' : 'transparent',
                    color: isActive ? ACCENT : 'var(--text-secondary)',
                    fontWeight: isActive ? 700 : 600,
                    fontSize: '0.78rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surface-3)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Summary pills */}
        <div style={{
          display: 'flex', gap: 10, padding: '14px 26px', flexWrap: 'wrap',
          borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
        }}>
          {summary.map(s => (
            <div key={s.label} style={{
              flex: '1 1 120px', minWidth: 110, padding: '10px 14px', borderRadius: 12,
              background: 'var(--surface)', border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, lineHeight: 1.25 }}>{s.label}</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 2 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Charts body */}
        <div style={{
          padding: 22, overflowY: 'auto', display: 'grid', gap: 18,
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        }}>
          {body}
        </div>
      </div>
    </div>
  );
}
