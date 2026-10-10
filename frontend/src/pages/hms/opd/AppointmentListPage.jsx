import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CalendarPlus, CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Search, UserRound, UserX, XCircle, LogIn,
} from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

const STATUSES = ['Scheduled', 'Checked-in', 'Completed', 'No Show', 'Cancelled'];
const STATUS_TONE = { Scheduled: 'info', 'Checked-in': 'warning', Completed: 'success', 'No Show': 'neutral', Cancelled: 'danger' };

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
const withDr = (name) => (!name ? '—' : /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`);
const slotLabel = (a) => (a.slot_end ? `${a.slot_start} – ${a.slot_end}` : a.slot_start || '—');

export default function AppointmentListPage() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(localYmd());
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/hms/appointments?date=${filterDate}`);
      setAppointments(res.data.data || []);
    } catch {
      toast.error('Could not load appointments');
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [filterDate]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

  const updateStatus = async (appt, status, extra = {}) => {
    try {
      await api.put(`/hms/appointments/${appt.id}`, { status, ...extra });
      toast.success(`${appt.patient?.name || 'Appointment'}: ${status.toLowerCase()}`);
      fetchAppointments();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update appointment');
      return false;
    }
  };

  const confirmCancel = async () => {
    const ok = await updateStatus(cancelTarget, 'Cancelled', cancelReason.trim() ? { cancellation_reason: cancelReason.trim() } : {});
    if (ok) { setCancelTarget(null); setCancelReason(''); }
  };

  const counts = useMemo(() => {
    const c = { all: appointments.length };
    STATUSES.forEach((s) => { c[s] = appointments.filter((a) => a.status === s).length; });
    return c;
  }, [appointments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return appointments.filter((a) => {
      if (statusFilter && a.status !== statusFilter) return false;
      if (!q) return true;
      return [a.patient?.name, a.patient?.uhid, a.patient?.phoneNumber, a.doctor?.name, a.department?.name]
        .some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [appointments, statusFilter, query]);

  const openPatient = (a) => { if (a.patient?.id) navigate(`/hms/patients/${a.patient.id}`); };

  const columns = useMemo(() => [
    {
      id: 'slot', header: 'Time', accessorFn: (a) => a.slot_start || '', meta: { width: 140 },
      cell: ({ row }) => <span className="tabular" style={{ fontWeight: 600 }}>{slotLabel(row.original)}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.patient?.name || '',
      cell: ({ row }) => {
        const p = row.original.patient || {};
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{p.name || '—'}</span>
              <span className="cell-secondary"><span className="mono">{p.uhid || 'No UHID'}</span>{p.phoneNumber ? ` · ${p.phoneNumber}` : ''}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'doctor', header: 'Doctor', accessorFn: (a) => a.doctor?.name || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{withDr(row.original.doctor?.name)}</span>
          {row.original.department?.name && <span className="cell-secondary">{row.original.department.name}</span>}
        </span>
      ),
    },
    { id: 'type', header: 'Visit', accessorFn: (a) => a.appt_type || '', meta: { width: 120 }, cell: ({ getValue }) => (getValue() ? getValue().charAt(0).toUpperCase() + getValue().slice(1) : '—') },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.status || '', meta: { width: 130 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 150, align: 'right' },
      cell: ({ row }) => {
        const a = row.original;
        const open = a.status === 'Scheduled';
        return (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
            {open && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); updateStatus(a, 'Checked-in'); }}>
                <LogIn size={14} aria-hidden="true" /> Check in
              </button>
            )}
            <RowMenu
              label={`Actions for ${a.patient?.name || 'appointment'} at ${a.slot_start}`}
              items={[
                { label: 'Open patient', icon: UserRound, onSelect: () => openPatient(a), hidden: !a.patient?.id },
                { label: 'Mark no-show', icon: UserX, onSelect: () => updateStatus(a, 'No Show'), hidden: !open },
                {
                  label: 'Cancel appointment', icon: XCircle, danger: true, separator: true,
                  onSelect: () => { setCancelReason(''); setCancelTarget(a); },
                  hidden: a.status === 'Cancelled' || a.status === 'Completed',
                },
              ]}
            />
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [fetchAppointments]);

  const isToday = filterDate === localYmd();

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Appointments"
          description="Booked OPD slots for the day. Check patients in as they arrive."
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/appointments/book')}>
              <CalendarPlus size={16} aria-hidden="true" /> Book appointment
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="date-stepper" role="group" aria-label="Appointment date">
              <button type="button" className="icon-btn" onClick={() => setFilterDate((d) => shiftDay(d, -1))} aria-label="Previous day"><ChevronLeft size={18} /></button>
              <label className="sr-only" htmlFor="appt-date">Date</label>
              <input id="appt-date" type="date" className="form-input" value={filterDate} onChange={(e) => e.target.value && setFilterDate(e.target.value)} />
              <button type="button" className="icon-btn" onClick={() => setFilterDate((d) => shiftDay(d, 1))} aria-label="Next day"><ChevronRight size={18} /></button>
              {!isToday && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilterDate(localYmd())}>Today</button>}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search appointments</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, phone or doctor" />
            </label>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchAppointments} aria-label="Refresh appointments">
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>

          <div className="toolbar toolbar-sub">
            <span className="toolbar-caption"><CalendarDays size={15} aria-hidden="true" /> {longDate(filterDate)}</span>
            <div className="segmented" role="tablist" aria-label="Filter by status">
              <button type="button" role="tab" aria-selected={!statusFilter} className={!statusFilter ? 'is-active' : ''} onClick={() => setStatusFilter('')}>
                All <span className="seg-count">{counts.all}</span>
              </button>
              {STATUSES.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={statusFilter === s} className={statusFilter === s ? 'is-active' : ''} onClick={() => setStatusFilter(s)}>
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
            onRowClick={openPatient}
            rowLabel={(a) => `Open ${a.patient?.name || 'patient'}`}
            initialSorting={[{ id: 'slot', desc: false }]}
            pageSize={50}
            empty={appointments.length > 0 ? (
              <EmptyState icon={Search} title="No appointments match" description="Clear the search or pick another status." />
            ) : (
              <EmptyState
                icon={CalendarDays}
                title="No appointments booked"
                description={`Nothing is booked for ${longDate(filterDate)}.`}
                action={<button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/appointments/book')}><CalendarPlus size={16} aria-hidden="true" /> Book appointment</button>}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this appointment?"
        description={cancelTarget ? `${cancelTarget.patient?.name || 'Patient'} with ${withDr(cancelTarget.doctor?.name)}, ${slotLabel(cancelTarget)}` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setCancelTarget(null)}>Keep appointment</button>
            <button type="button" className="btn btn-danger btn-md" onClick={confirmCancel}>Cancel appointment</button>
          </>
        )}
      >
        <div className="form-group">
          <label className="form-label" htmlFor="cancel-reason">Reason (optional)</label>
          <textarea id="cancel-reason" className="form-textarea" rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Patient requested a later date" />
        </div>
      </Modal>
    </>
  );
}
