import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import {
  CalendarPlus, RefreshCw, Search, Stethoscope, Pill, Share2, BedSingle, FileBadge, FlaskConical, BedDouble,
  UserRound, Play, ListOrdered, History, Users,
} from 'lucide-react';
import ReferralTypeModal from '../ReferralTypeModal';
import PageHeader from '../ui/PageHeader';
import DataTable from '../ui/DataTable';
import EmptyState from '../ui/EmptyState';
import RowMenu from '../ui/RowMenu';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import api from '../../api/axios';

const COMPLETED_PRESCRIPTION_STATUSES = new Set(['Consulted', 'Finalized', 'Dispensed']);
const EXPIRES_AFTER_DAYS = 4;

const isSavedPrescription = (rx) => COMPLETED_PRESCRIPTION_STATUSES.has(rx.status) || Number(rx.medicine_count || 0) > 0;

function isSameLocalDate(value, date = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === date.getFullYear() && parsed.getMonth() === date.getMonth() && parsed.getDate() === date.getDate();
}

const categoryOf = (type) => (type === 'corporate_employee' ? { label: 'Corporate', tone: 'info' } : { label: 'General', tone: 'neutral' });
const norm = (v) => String(v ?? '').trim().toLowerCase();
const matchesSearch = (p, query) => {
  const q = norm(query);
  if (!q) return true;
  return [p?.name, p?.uhid, p?.empNumber, p?.phoneNumber, p?.mobile, p?.age, p?.gender, categoryOf(p?.patientType).label, p?.consulting_doctor_name]
    .map(norm).join(' ').includes(q);
};
const isPendingLabReview = (lab) => norm(lab?.status) !== 'completed';
const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const fmtDayTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const withoutDr = (name) => String(name || '').replace(/^Dr\.?\s*/i, '');

function PatientCell({ p }) {
  const meta = [p.uhid, p.age ? `${p.age} y` : null, p.gender ? p.gender.charAt(0).toUpperCase() : null, p.empNumber ? `Emp ${p.empNumber}` : null]
    .filter(Boolean).join(' · ');
  return (
    <span className="cell-person">
      <span className="cell-avatar" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
      <span className="cell-stack">
        <span className="cell-primary">{p.name}</span>
        <span className="cell-secondary">{meta}</span>
      </span>
    </span>
  );
}

// Doctor's clinical workspace: today's OPD queue, patients still waiting from previous days, and lab reviews.
export default function DoctorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const socket = useSocket();
  const [todayPatients, setTodayPatients] = useState([]);
  const [pendingPatients, setPendingPatients] = useState([]);
  const [doctorPrescriptions, setDoctorPrescriptions] = useState([]);
  const [doctorLabs, setDoctorLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [todaySearch, setTodaySearch] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingView, setPendingView] = useState('open');
  const [startingId, setStartingId] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [referralPatient, setReferralPatient] = useState(null);
  const pendingActionId = useRef(null);

  const fetchDoctorData = useCallback(async () => {
    const [todayRes, pendingRes, prescriptionsRes, labsRes] = await Promise.allSettled([
      api.get('/patients/hms/today-patients'),
      api.get('/patients/hms/pending-consultation'),
      api.get('/doctor/prescriptions'),
      api.get('/doctor/labs'),
    ]);
    const dataOf = (r) => (r.status === 'fulfilled' ? r.value.data?.data || [] : []);
    setTodayPatients(dataOf(todayRes));
    setPendingPatients(dataOf(pendingRes));
    setDoctorPrescriptions(dataOf(prescriptionsRes));
    setDoctorLabs(dataOf(labsRes));
    setLastRefreshedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchDoctorData(); }, [fetchDoctorData]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onLabReady = (data) => toast.success(`Lab result ready for item ${data.itemId}`, { duration: 5000 });
    const onLabStatus = (data) => { if (data.status === 'In Progress') toast(`Lab order ${data.orderId} is now in progress`); };
    const onDispensed = (data) => toast.success(`Prescription ${data.prescriptionId} has been dispensed`, { duration: 5000 });
    socket.on('lab_result_ready', onLabReady);
    socket.on('lab_status_change', onLabStatus);
    socket.on('prescription_dispensed', onDispensed);
    return () => {
      socket.off('lab_result_ready', onLabReady);
      socket.off('lab_status_change', onLabStatus);
      socket.off('prescription_dispensed', onDispensed);
    };
  }, [socket]);

  const startConsultation = async (patient) => {
    setStartingId(patient.id);
    try {
      await api.post('/hms/encounters', { patient_id: patient.id, department_id: null, encounter_type: 'OPD' });
      toast.success(`Consultation started for ${patient.name}`);
      pendingActionId.current = patient.id;
      setStatusFilter('all');
      await fetchDoctorData();
    } catch {
      toast.error('Failed to start the consultation');
    } finally {
      setStartingId(null);
    }
  };

  // After starting a consultation, open that patient's action menu so the doctor can pick the next step.
  useEffect(() => {
    const pid = pendingActionId.current;
    if (!pid) return;
    const patient = todayPatients.find((p) => p.id === pid);
    if (patient?.encounter_id) {
      pendingActionId.current = null;
      setMenuFor(pid);
    }
  }, [todayPatients]);

  const completedRxPatientIds = useMemo(() => new Set(
    doctorPrescriptions.filter((rx) => isSavedPrescription(rx) && isSameLocalDate(rx.created_at)).map((rx) => Number(rx.patient_id)).filter(Boolean),
  ), [doctorPrescriptions]);

  const statusOf = useCallback((p) => {
    if (p.encounter_status === 'Finalized' || completedRxPatientIds.has(Number(p.id))) return 'completed';
    return p.encounter_id ? 'consulting' : 'waiting';
  }, [completedRxPatientIds]);

  const counts = useMemo(() => {
    const c = { all: todayPatients.length, waiting: 0, consulting: 0, completed: 0 };
    todayPatients.forEach((p) => { c[statusOf(p)] += 1; });
    return c;
  }, [todayPatients, statusOf]);

  const visibleToday = useMemo(
    () => todayPatients.filter((p) => (statusFilter === 'all' || statusOf(p) === statusFilter) && matchesSearch(p, todaySearch)),
    [todayPatients, statusFilter, todaySearch, statusOf],
  );
  const isExpired = (p) => (Number(p.days_ago) || 0) >= EXPIRES_AFTER_DAYS;
  const openPending = useMemo(() => pendingPatients.filter((p) => !isExpired(p)), [pendingPatients]);
  const expiredPending = useMemo(() => pendingPatients.filter(isExpired), [pendingPatients]);
  const visiblePending = useMemo(
    () => (pendingView === 'open' ? openPending : expiredPending).filter((p) => matchesSearch(p, pendingSearch)),
    [pendingView, openPending, expiredPending, pendingSearch],
  );
  const pendingLabReviews = doctorLabs.filter(isPendingLabReview).length;

  const actionsFor = useCallback((p) => [
    { label: 'Open consultation', icon: Stethoscope, onSelect: () => navigate(`/hms/consultation/${p.encounter_id}`), hidden: !p.encounter_id },
    { label: 'Prescription', icon: Pill, onSelect: () => navigate(`/hms/prescription-slip?patientId=${p.id}&encounterId=${p.encounter_id || ''}`) },
    { label: 'Lab orders', icon: FlaskConical, onSelect: () => navigate(`/doctor/labs?patientId=${p.id}`) },
    { label: 'Referral', icon: Share2, onSelect: () => setReferralPatient(p) },
    { label: 'Rest form', icon: BedSingle, onSelect: () => navigate(`/doctor/rest-forms/new?patientId=${p.id}`) },
    { label: 'Medical certificate', icon: FileBadge, onSelect: () => navigate(`/doctor/medical-certificate?patientId=${p.id}`) },
    { label: 'Move to IPD', icon: BedDouble, onSelect: () => navigate(`/ipd/admission-form?patientId=${p.id}`), separator: true },
    { label: 'Patient profile', icon: UserRound, onSelect: () => navigate(`/hms/patients/${p.id}`) },
  ], [navigate]);

  const STATUS_META = {
    waiting: { label: 'Waiting', tone: 'warning' },
    consulting: { label: 'In consultation', tone: 'info' },
    completed: { label: 'Completed', tone: 'success' },
  };

  const todayColumns = useMemo(() => [
    { id: 'patient', header: 'Patient', accessorFn: (p) => p.name || '', cell: ({ row }) => <PatientCell p={row.original} /> },
    {
      id: 'category', header: 'Category', accessorFn: (p) => categoryOf(p.patientType).label, meta: { width: 120 },
      cell: ({ row }) => { const c = categoryOf(row.original.patientType); return <span className={`status status-${c.tone}`}>{c.label}</span>; },
    },
    {
      id: 'registered', header: 'Registered', accessorFn: (p) => (p.created_at ? new Date(p.created_at).getTime() : 0), meta: { width: 120 },
      cell: ({ row }) => <span className="tabular">{fmtTime(row.original.created_at)}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (p) => STATUS_META[statusOf(p)].label, meta: { width: 190 },
      cell: ({ row }) => {
        const p = row.original;
        const s = STATUS_META[statusOf(p)];
        const otherDoctor = p.encounter_id && String(p.consulting_doctor_id) !== String(user?.id) && p.consulting_doctor_name;
        return (
          <span className="cell-stack">
            <span className={`status status-${s.tone}`} style={{ alignSelf: 'flex-start' }}>{s.label}</span>
            {otherDoctor && statusOf(p) === 'consulting' && <span className="cell-secondary">with Dr. {withoutDr(p.consulting_doctor_name)}</span>}
          </span>
        );
      },
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 230, align: 'right' },
      cell: ({ row }) => {
        const p = row.original;
        if (!p.encounter_id) {
          return (
            <button type="button" className="btn btn-primary btn-sm" disabled={startingId === p.id} onClick={() => startConsultation(p)}>
              <Play size={14} aria-hidden="true" /> {startingId === p.id ? 'Starting…' : 'Start consultation'}
            </button>
          );
        }
        if (String(p.consulting_doctor_id) !== String(user?.id)) return <span className="cell-secondary">View only</span>;
        return (
          <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/hms/consultation/${p.encounter_id}`)}>
              <Stethoscope size={14} aria-hidden="true" /> Open
            </button>
            <RowMenu
              label={`More actions for ${p.name}`}
              items={actionsFor(p).filter((a) => a.label !== 'Open consultation')}
              open={menuFor === p.id}
              onOpenChange={(open) => setMenuFor(open ? p.id : null)}
            />
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [statusOf, startingId, menuFor, user?.id, actionsFor]);

  const pendingColumns = useMemo(() => [
    { id: 'patient', header: 'Patient', accessorFn: (p) => p.name || '', cell: ({ row }) => <PatientCell p={row.original} /> },
    {
      id: 'category', header: 'Category', accessorFn: (p) => categoryOf(p.patientType).label, meta: { width: 120 },
      cell: ({ row }) => { const c = categoryOf(row.original.patientType); return <span className={`status status-${c.tone}`}>{c.label}</span>; },
    },
    {
      id: 'registered', header: 'Registered', accessorFn: (p) => Number(p.days_ago) || 0, meta: { width: 190 },
      cell: ({ row }) => {
        const p = row.original;
        const days = Number(p.days_ago) || 0;
        const tone = days >= EXPIRES_AFTER_DAYS ? 'var(--red)' : days >= 3 ? 'var(--amber)' : undefined;
        return (
          <span className="cell-stack">
            <span style={{ fontWeight: 600, color: tone }}>{days === 1 ? 'Yesterday' : `${days} days ago`}</span>
            <span className="cell-secondary tabular">{fmtDayTime(p.created_at)}</span>
          </span>
        );
      },
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 170, align: 'right' },
      cell: ({ row }) => {
        const p = row.original;
        if ((Number(p.days_ago) || 0) >= EXPIRES_AFTER_DAYS) return <span className="status status-neutral">Expired</span>;
        return (
          <button type="button" className="btn btn-secondary btn-sm" disabled={startingId === p.id} onClick={() => startConsultation(p)}>
            <Play size={14} aria-hidden="true" /> {startingId === p.id ? 'Starting…' : 'Consult'}
          </button>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [startingId]);

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const doctorName = withoutDr(user?.name) || 'Doctor';

  const kpis = [
    { key: 'all', label: "Today's patients", value: counts.all },
    { key: 'waiting', label: 'Waiting', value: counts.waiting, attention: counts.waiting > 0 ? 'var(--amber)' : undefined },
    { key: 'consulting', label: 'In consultation', value: counts.consulting },
    { key: 'completed', label: 'Completed', value: counts.completed },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting}, Dr. ${doctorName}`}
        description={`${dateStr}. Your OPD queue, patients still waiting from earlier days, and lab reviews.`}
        meta={lastRefreshedAt && <span className="muted">Updated {fmtTime(lastRefreshedAt)}</span>}
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => { fetchDoctorData(); toast.success('Dashboard refreshed', { id: 'doc-refresh' }); }}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/appointments/book')}>
              <CalendarPlus size={16} aria-hidden="true" /> Book follow-up
            </button>
          </>
        )}
      />

      <div className="kpi-strip">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`panel kpi kpi-button${statusFilter === k.key ? ' is-selected' : ''}`}
            aria-pressed={statusFilter === k.key}
            onClick={() => setStatusFilter(k.key)}
          >
            <span className="kpi-label">{k.label}</span>
            <span className="kpi-value" style={{ color: k.attention }}>{loading ? '—' : k.value}</span>
          </button>
        ))}
        <button type="button" className="panel kpi kpi-button" onClick={() => navigate('/doctor/labs')}>
          <span className="kpi-label">Lab results to review</span>
          <span className="kpi-value" style={{ color: pendingLabReviews ? 'var(--amber)' : undefined }}>{loading ? '—' : pendingLabReviews}</span>
        </button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}><ListOrdered size={16} aria-hidden="true" /> Today's queue</h2>
        </div>
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Filter today's queue">
            {[['all', 'All'], ['waiting', 'Waiting'], ['consulting', 'In consultation'], ['completed', 'Completed']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={statusFilter === key} className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)}>
                {label} <span className="seg-count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search today's patients</span>
            <input value={todaySearch} onChange={(e) => setTodaySearch(e.target.value)} placeholder="Search patient, UHID or phone" />
          </label>
        </div>
        <DataTable
          columns={todayColumns}
          data={visibleToday}
          loading={loading}
          getRowId={(p) => String(p.id)}
          initialSorting={[{ id: 'registered', desc: false }]}
          pageSize={50}
          empty={todayPatients.length === 0 ? (
            <EmptyState icon={Users} title="No patients registered for you today" description="Patients appear here as soon as the front desk registers them for consultation." />
          ) : (
            <EmptyState icon={Search} title="No patients match" description="Clear the search or choose another status." />
          )}
        />
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>
            <History size={16} aria-hidden="true" /> Waiting from previous days
            {openPending.length > 0 && <span className="status status-warning">{openPending.length}</span>}
          </h2>
          <span className="muted">Registered but not yet seen. A visit expires after {EXPIRES_AFTER_DAYS - 1} days.</span>
        </div>
        {pendingPatients.length > 0 && (
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter earlier patients">
              <button type="button" role="tab" aria-selected={pendingView === 'open'} className={pendingView === 'open' ? 'is-active' : ''} onClick={() => setPendingView('open')}>
                Can still be seen <span className="seg-count">{openPending.length}</span>
              </button>
              <button type="button" role="tab" aria-selected={pendingView === 'expired'} className={pendingView === 'expired' ? 'is-active' : ''} onClick={() => setPendingView('expired')}>
                Expired <span className="seg-count">{expiredPending.length}</span>
              </button>
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search patients waiting from previous days</span>
              <input value={pendingSearch} onChange={(e) => setPendingSearch(e.target.value)} placeholder="Search patient or UHID" />
            </label>
          </div>
        )}
        <DataTable
          columns={pendingColumns}
          data={visiblePending}
          loading={loading}
          getRowId={(p) => String(p.id)}
          pageSize={10}
          empty={(pendingView === 'open' ? openPending : expiredPending).length === 0 ? (
            pendingView === 'open'
              ? <EmptyState icon={Stethoscope} title="Nobody is waiting from earlier days" description="Every patient registered for you in the last few days has been seen." />
              : <EmptyState icon={History} title="No expired visits" description="Visits that were never seen appear here once they expire." />
          ) : (
            <EmptyState icon={Search} title="No patients match" description="Try another name or UHID." />
          )}
        />
      </section>

      <p className="muted" style={{ textAlign: 'center', fontSize: '0.78rem', marginTop: 24 }}>
        Designed, developed and maintained by HMS IT Department © 2026.
      </p>

      <ReferralTypeModal isOpen={Boolean(referralPatient)} onClose={() => setReferralPatient(null)} patient={referralPatient} />
    </>
  );
}
