import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BedDouble, CalendarDays, ChevronRight, CircleAlert, ClipboardList, LayoutGrid, Pill, Receipt, UserCog, Users,
} from 'lucide-react';
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

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const fmtDateTime = (v) => (v
  ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
  : '—');

const ADMISSION_TONE = { Active: 'info', Admitted: 'info', Discharged: 'success', 'Discharge Pending': 'warning', 'Pending Discharge': 'warning' };
const ADMISSION_LABEL = { Active: 'Admitted' };

// A KPI tile that opens a page or dialog: same look as a static tile, but a real button.

function Kpi({ label, value, sub, color, onClick, actionLabel }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </>
  );
  if (!onClick) return <div className="panel kpi">{body}</div>;
  return (
    <button type="button" className="panel kpi kpi-button" onClick={onClick} aria-label={`${label}: ${value}. ${actionLabel}`}>
      {body}
    </button>
  );
}

const QUICK_LINKS = [
  { label: 'Staff management', path: '/hms/admin/staff', icon: UserCog },
  { label: 'Patients', path: '/hms/admin/patients', icon: Users },
  { label: 'Appointments', path: '/hms/appointments', icon: CalendarDays },
  { label: 'Billing & finance', path: '/hms/admin/billing', icon: Receipt },
  { label: 'Pharmacy', path: '/hms/admin/pharmacy', icon: Pill },
  { label: 'Attendance & leave', path: '/hms/admin/attendance', icon: ClipboardList },
  { label: 'Bed management', path: '/hms/admin/bed-management', icon: BedDouble },
];

// Hospital admin home: today's operations, patient registrations and recent admissions.
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyticsMetric, setAnalyticsMetric] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/admin-ops').then(res => res.data.data).catch(() => null),
      api.get('/dashboard/super-admin').then(res => res.data.data).catch(() => null),
    ]).then(([opsData, saData]) => {
      setData(opsData);
      setAnalyticsData(saData);
    }).finally(() => setLoading(false));
  }, []);

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.PATIENT_NAME || '',
      cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span>,
    },
    { id: 'ward', header: 'Ward', accessorFn: (a) => a.WARD_NAME || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'bed', header: 'Bed', accessorFn: (a) => a.BED_NUMBER || '', meta: { width: 110 },
      cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.STATUS || '', meta: { width: 170 },
      cell: ({ getValue }) => <span className={`status status-${ADMISSION_TONE[getValue()] || 'info'}`}>{ADMISSION_LABEL[getValue()] || getValue() || '—'}</span>,
    },
    {
      id: 'admitted', header: 'Admitted', meta: { width: 160 },
      accessorFn: (a) => (a.ADMISSION_DATE ? new Date(a.ADMISSION_DATE).getTime() : 0),
      cell: ({ row }) => <span className="tabular">{fmtDateTime(row.original.ADMISSION_DATE)}</span>,
    },
  ], []);

  const show = (v) => (loading ? '—' : v);
  const occupancy = Number(data?.bed_occupancy || 0);
  const lowStock = Number(data?.low_stock || 0);
  const pendingDischarges = Number(data?.pending_discharges || 0);
  const admissions = data?.recent_admissions || [];

  const registrations = [
    { label: 'New patients today', value: analyticsData?.today_patients || 0, analytics: { kind: 'patients', scope: 'today', title: "Today's Patient Analytics" } },
    { label: 'New patients this week', value: analyticsData?.week_patients || 0, analytics: { kind: 'patients', scope: 'week', title: 'Weekly Patient Analytics' } },
    { label: 'New patients this month', value: analyticsData?.month_patients || 0, analytics: { kind: 'patients', scope: 'month', title: 'Monthly Patient Analytics' } },
    { label: 'Active users', value: analyticsData?.active_users || 0, analytics: { kind: 'users', scope: 'active', title: 'User Access Analytics' } },
  ];

  const attention = [
    { label: 'Pending discharges', value: pendingDischarges, color: pendingDischarges > 0 ? 'var(--amber)' : undefined },
    { label: 'Low stock medicines', value: lowStock, color: lowStock > 0 ? 'var(--amber)' : undefined, path: '/hms/admin/pharmacy' },
    { label: "Today's appointments", value: Number(data?.todays_appointments || 0), path: '/hms/appointments' },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user?.name)}`}
        description="Hospital operations for today: revenue, beds, patient flow and staff."
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/hms/admin/bed-management')}>
              <BedDouble size={16} aria-hidden="true" /> Bed management
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/admin/staff')}>
              <UserCog size={16} aria-hidden="true" /> Staff management
            </button>
          </>
        )}
      />

      {!loading && lowStock > 0 && (
        <div className="alert-strip alert-warning" role="status">
          <CircleAlert size={16} aria-hidden="true" />
          <span><strong>{lowStock} {lowStock === 1 ? 'medicine is' : 'medicines are'}</strong> at or below 10 units in stock.</span>
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/hms/admin/pharmacy')}>
            Review pharmacy
          </button>
        </div>
      )}

      <div className="kpi-strip">
        <Kpi
          label="Revenue today"
          value={show(inr(data?.revenue_today))}
          onClick={() => navigate('/hms/admin/billing')}
          actionLabel="Open billing & finance"
        />
        <Kpi
          label="Bed occupancy"
          value={show(`${occupancy}%`)}
          sub={loading ? undefined : `${data?.occupied_beds || 0} of ${data?.total_beds || 0} beds occupied`}
          color={occupancy > 80 ? 'var(--amber)' : undefined}
          onClick={() => navigate('/hms/admin/bed-management')}
          actionLabel="Open bed management"
        />
        <Kpi label="OPD / IPD" value={show(`${data?.opd_count || 0} / ${data?.ipd_count || 0}`)} sub="OPD tokens today, inpatients now" />
        <Kpi label="Staff on duty" value={show(data?.staff_on_duty || 0)} sub="Signed in today" />
      </div>

      {(loading || analyticsData) && (
        <div className="kpi-strip">
          {registrations.map((k) => (
            <Kpi
              key={k.label}
              label={k.label}
              value={show(k.value)}
              sub={analyticsData ? 'View analytics' : undefined}
              onClick={analyticsData ? () => setAnalyticsMetric(k.analytics) : undefined}
              actionLabel={`Open ${k.label.toLowerCase()} analytics`}
            />
          ))}
        </div>
      )}

      <div className="split-2" style={{ marginBottom: 16 }}>
        <section className="panel panel-pad">
          <h2 className="panel-title"><CircleAlert size={16} aria-hidden="true" /> Needs attention</h2>
          <ul className="list-rows">
            {attention.map((a) => {
              const content = (
                <>
                  <span>{a.label}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <strong className="tabular" style={{ color: a.color }}>{show(a.value)}</strong>
                    {a.path && <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />}
                  </span>
                </>
              );
              return (
                <li key={a.label}>
                  {a.path ? (
                    <button type="button" className="list-row" onClick={() => navigate(a.path)}>{content}</button>
                  ) : (
                    <div className="list-row list-row-static">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel panel-pad">
          <h2 className="panel-title"><LayoutGrid size={16} aria-hidden="true" /> Quick access</h2>
          <ul className="list-rows" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {QUICK_LINKS.map((ql) => {
              const Icon = ql.icon;
              return (
                <li key={ql.path}>
                  <button type="button" className="list-row" onClick={() => navigate(ql.path)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                      {ql.label}
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
          <h2 className="panel-title" style={{ margin: 0 }}><BedDouble size={16} aria-hidden="true" /> Recent admissions</h2>
        </div>
        <DataTable
          columns={columns}
          data={admissions}
          loading={loading}
          getRowId={(a, i) => String(a.ID ?? i)}
          pageSize={10}
          initialSorting={[{ id: 'admitted', desc: true }]}
          empty={<EmptyState icon={BedDouble} title="No recent admissions" description="New inpatient admissions appear here as soon as they are recorded." />}
        />
      </section>

      <PatientAnalyticsModal
        isOpen={!!analyticsMetric}
        onClose={() => setAnalyticsMetric(null)}
        data={analyticsData}
        metric={analyticsMetric}
      />
    </>
  );
}
