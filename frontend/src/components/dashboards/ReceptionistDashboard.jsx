import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, Receipt, UserPlus } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../ui/PageHeader';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';

// First name, keeping a leading honorific ("Sister Mary", "Dr. Rao").
const firstName = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'there';
  if (parts.length > 1 && /^(dr|mr|mrs|ms|miss|sister|sr|prof)\.?$/i.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  return parts[0];
};

const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');

// A KPI tile that opens a page: same look as a static tile, but a real button.

function Kpi({ label, value, color, onClick, actionLabel }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={color ? { color } : undefined}>{value}</div>
    </>
  );
  if (!onClick) return <div className="panel kpi">{body}</div>;
  return (
    <button type="button" className="panel kpi kpi-button" onClick={onClick} aria-label={`${label}: ${value}. ${actionLabel}`}>
      {body}
    </button>
  );
}

// Front desk home: today's patient flow, unpaid OPD visits, beds and notifications.
export default function ReceptionistDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [unpaid, setUnpaid] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    Promise.all([
      api.get('/dashboard/receptionist').then(r => setData(r.data.data)).catch(() => {}),
      api.get('/billing/opd/unpaid-today').then(r => setUnpaid(r.data.data || [])).catch(() => {}),
      api.get('/receptionist/notifications').then(r => setNotifications((r.data.data || []).filter(n => !n.read))).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (u) => u.NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.NAME || '—'}</span>
          <span className="cell-secondary mono">{row.original.UHID}</span>
        </span>
      ),
    },
    {
      id: 'doctor', header: 'Doctor', accessorFn: (u) => u.DOCTOR_NAME || '',
      cell: ({ getValue }) => getValue() || '—',
    },
    {
      id: 'visit', header: 'Visit', meta: { width: 120 },
      accessorFn: (u) => (u.ENCOUNTER_DATE ? new Date(u.ENCOUNTER_DATE).getTime() : 0),
      cell: ({ row }) => <span className="tabular">{fmtTime(row.original.ENCOUNTER_DATE)}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 150, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => navigate(`/billing/opd/${row.original.ENCOUNTER_ID}`)}
          aria-label={`Generate bill for ${row.original.NAME}`}
        >
          <Receipt size={14} aria-hidden="true" /> Generate bill
        </button>
      ),
    },
  ], [navigate]);

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const timeStr = currentTime.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  const show = (v) => (loading ? '—' : v);
  const unpaidCount = unpaid.length;
  const pendingDischarges = Number(data?.pending_discharges || 0);

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName(user?.name)}`}
        description="Registrations, appointments, OPD billing and bed availability for the front desk."
        meta={<span className="muted tabular">{dateStr} · {timeStr}</span>}
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/hms/appointments/book')}>
              <CalendarDays size={16} aria-hidden="true" /> Book appointment
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/patients/new')}>
              <UserPlus size={16} aria-hidden="true" /> Register patient
            </button>
          </>
        )}
      />

      <div className="kpi-strip">
        <Kpi label="Tokens issued today" value={show(data?.token_queue || 0)} />
        <Kpi
          label="Today's appointments"
          value={show(data?.todays_appointments || 0)}
          onClick={() => navigate('/receptionist/appointments')}
          actionLabel="Open appointments"
        />
        <Kpi
          label="Unpaid OPD bills"
          value={show(unpaidCount)}
          color={!loading && unpaidCount > 0 ? 'var(--amber)' : undefined}
          onClick={() => navigate('/receptionist/billing')}
          actionLabel="Open billing and payments"
        />
        <Kpi
          label="Beds available"
          value={show(data?.bed_availability || 0)}
          onClick={() => navigate('/receptionist/ipd')}
          actionLabel="Open the IPD admission desk"
        />
      </div>

      <div className="kpi-strip">
        <Kpi
          label="Pending discharges"
          value={show(pendingDischarges)}
          color={!loading && pendingDischarges > 0 ? 'var(--amber)' : undefined}
          onClick={() => navigate('/receptionist/ipd')}
          actionLabel="Open the IPD admission desk"
        />
        <Kpi
          label="Unread alerts"
          value={show(notifications.length)}
          onClick={() => navigate('/receptionist/notifications')}
          actionLabel="Open front desk alerts"
        />
        <Kpi label="Walk-in / booked visits" value={show(`${data?.walk_in_count || 0} / ${data?.booked_count || 0}`)} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>
            <Receipt size={16} aria-hidden="true" /> Unpaid OPD visits today
            {!loading && unpaidCount > 0 && <span className="status status-warning">{unpaidCount}</span>}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/receptionist/billing')}>
            View all bills <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        <DataTable
          columns={columns}
          data={unpaid}
          loading={loading}
          getRowId={(u, i) => String(u.ENCOUNTER_ID ?? i)}
          pageSize={10}
          initialSorting={[{ id: 'visit', desc: true }]}
          empty={<EmptyState icon={Receipt} title="No unpaid visits today" description="Finalised OPD consultations without a bill appear here." />}
        />
      </section>
    </>
  );
}
