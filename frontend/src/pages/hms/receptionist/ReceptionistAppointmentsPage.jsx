import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarPlus, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search, LogIn, CircleCheck, UserX, XCircle,
} from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

const STATUSES = ['Scheduled', 'Checked-in', 'Completed', 'Cancelled', 'No Show'];
const STATUS_TONE = { Scheduled: 'info', 'Checked-in': 'warning', Completed: 'success', Cancelled: 'danger', 'No Show': 'neutral' };

// Local calendar date (not UTC), so the list matches the hospital's day.
const localYmd = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const shiftDay = (ymd, days) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return localYmd(new Date(y, m - 1, d + days));
};
const longDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};
const doctorName = (a) => a.doctor?.name || a.doctor?.user?.name || '';
const apptTime = (a) => a.appointment_time || a.slot_start || '';

export default function ReceptionistAppointmentsPage() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(localYmd());
  const [filterDoctor, setFilterDoctor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);

  useEffect(() => {
    fetchAppointments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDate]);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/hms/appointments?date=${filterDate}`);
      setAppointments(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Could not load appointments');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.put(`/hms/appointments/${id}`, { status: newStatus });
      toast.success(`Appointment marked ${newStatus.toLowerCase()}`);
      fetchAppointments();
      return true;
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to update appointment');
      return false;
    }
  };

  const confirmCancel = async () => {
    const ok = await handleStatusChange(cancelTarget.id, 'Cancelled');
    if (ok) setCancelTarget(null);
  };

  const byDoctor = useMemo(() => appointments.filter((a) => {
    if (filterDoctor && !doctorName(a).toLowerCase().includes(filterDoctor.toLowerCase())) return false;
    return true;
  }), [appointments, filterDoctor]);

  const counts = useMemo(() => {
    const c = { all: byDoctor.length };
    STATUSES.forEach((s) => { c[s] = byDoctor.filter((a) => a.status === s).length; });
    return c;
  }, [byDoctor]);

  const filtered = useMemo(() => byDoctor.filter((a) => !filterStatus || a.status === filterStatus), [byDoctor, filterStatus]);

  const columns = useMemo(() => [
    {
      id: 'time', header: 'Time', accessorFn: (a) => apptTime(a), meta: { width: 110 },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{getValue() || '—'}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.patient?.name || '',
      cell: ({ row }) => {
        const p = row.original.patient || {};
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{p.name || 'Unknown'}</span>
              <span className="cell-secondary mono">{p.uhid || 'No UHID'}</span>
            </span>
          </span>
        );
      },
    },
    { id: 'doctor', header: 'Doctor', accessorFn: (a) => doctorName(a), cell: ({ getValue }) => getValue() || '—' },
    { id: 'department', header: 'Department', accessorFn: (a) => a.department?.name || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.status || '', meta: { width: 130 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 170, align: 'right' },
      cell: ({ row }) => {
        const a = row.original;
        const who = a.patient?.name || 'appointment';
        return (
          <span className="inline-actions">
            {a.status === 'Scheduled' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleStatusChange(a.id, 'Checked-in')}>
                <LogIn size={14} aria-hidden="true" /> Check in
              </button>
            )}
            {a.status === 'Checked-in' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleStatusChange(a.id, 'Completed')}>
                <CircleCheck size={14} aria-hidden="true" /> Complete
              </button>
            )}
            <RowMenu
              label={`Actions for ${who}`}
              items={[
                { label: 'Mark no-show', icon: UserX, onSelect: () => handleStatusChange(a.id, 'No Show'), hidden: a.status !== 'Scheduled' },
                { label: 'Cancel appointment', icon: XCircle, danger: true, separator: true, onSelect: () => setCancelTarget(a), hidden: a.status !== 'Scheduled' },
              ]}
            />
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [filterDate]);

  const isToday = filterDate === localYmd();
  const bookButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/appointments/book')}>
      <CalendarPlus size={16} aria-hidden="true" /> Book appointment
    </button>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Appointments"
          description="Check patients in, and manage the day's booked appointments."
          actions={bookButton}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="date-stepper" role="group" aria-label="Appointment date">
              <button type="button" className="icon-btn" onClick={() => setFilterDate((d) => shiftDay(d, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
              <label className="sr-only" htmlFor="ra-date">Date</label>
              <input id="ra-date" type="date" className="form-input" value={filterDate} onChange={(e) => e.target.value && setFilterDate(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setFilterDate((d) => shiftDay(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
              {!isToday && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilterDate(localYmd())}>Today</button>}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Filter by doctor</span>
              <input value={filterDoctor} onChange={(e) => setFilterDoctor(e.target.value)} placeholder="Filter by doctor" />
            </label>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchAppointments}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>

          <div className="toolbar toolbar-sub">
            <span className="toolbar-caption"><CalendarDays size={15} aria-hidden="true" /> {longDate(filterDate)}</span>
            <div className="segmented" role="tablist" aria-label="Filter by status">
              <button type="button" role="tab" aria-selected={!filterStatus} className={!filterStatus ? 'is-active' : ''} onClick={() => setFilterStatus('')}>
                All <span className="seg-count">{counts.all}</span>
              </button>
              {STATUSES.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={filterStatus === s} className={filterStatus === s ? 'is-active' : ''} onClick={() => setFilterStatus(s)}>
                  {s} <span className="seg-count">{counts[s]}</span>
                </button>
              ))}
            </div>
          </div>

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(a) => String(a.id)}
            initialSorting={[{ id: 'time', desc: false }]}
            pageSize={50}
            empty={appointments.length > 0 ? (
              <EmptyState icon={Search} title="No appointments match" description="Clear the doctor filter or pick another status." />
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="No appointments booked"
                description={`Nothing is booked for ${longDate(filterDate)}.`}
                action={bookButton}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this appointment?"
        description={cancelTarget ? `${cancelTarget.patient?.name || 'Patient'}${doctorName(cancelTarget) ? ` with ${doctorName(cancelTarget)}` : ''}${apptTime(cancelTarget) ? `, ${apptTime(cancelTarget)}` : ''}` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setCancelTarget(null)}>Keep appointment</button>
            <button type="button" className="btn btn-danger btn-md" onClick={confirmCancel}>Cancel appointment</button>
          </>
        )}
      >
        <p className="muted">The appointment is marked as cancelled for this day.</p>
      </Modal>
    </>
  );
}
