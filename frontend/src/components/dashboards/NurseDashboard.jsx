import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, ChevronRight, ClipboardList, HeartPulse, LayoutGrid, RefreshCw, Users } from 'lucide-react';
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

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : null);
const admissionId = (adm) => adm.ID || adm.id;
const daysAdmitted = (adm) => Number(adm.DAYS_ADMITTED || 0);
const LONG_STAY_DAYS = 5;

// A KPI tile that opens a page: same look as a static tile, but a real button.

const QUICK_LINKS = [
  { label: 'Admission requests', to: '/ipd/requests', icon: ClipboardList },
  { label: 'Bed management', to: '/ipd/beds', icon: BedDouble },
  { label: 'Patient directory', to: '/ipd/patients', icon: Users },
];

// Nurse station: admitted patients, pending admission requests and the vitals round for this shift.
export default function NurseDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [admissions, setAdmissions] = useState([]);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [loading, setLoading] = useState(true);

  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    fetchNurseData();
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const fetchNurseData = () => {
    setLoading(true);
    Promise.all([
      api.get('/ipd/admissions?status=Active').then(res => setAdmissions(res.data.data || [])).catch(() => {}),
      api.get('/ipd/requests?status=Pending').then(res => setPendingRequests((res.data.data || []).length)).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  const recordVitals = useCallback(
    (adm) => navigate('/hms/vitals/entry', { state: { patient: { id: adm.PATIENT_ID, name: adm.PATIENT_NAME, uhid: adm.UHID, age: adm.AGE, gender: adm.GENDER } } }),
    [navigate],
  );

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.PATIENT_NAME || '',
      cell: ({ row }) => {
        const a = row.original;
        const demo = [a.GENDER?.[0], a.AGE ? `${a.AGE} y` : null].filter(Boolean).join(' / ');
        return (
          <span className="cell-stack">
            <span className="cell-primary">{a.PATIENT_NAME || '—'}</span>
            <span className="cell-secondary"><span className="mono">{a.UHID}</span>{demo ? ` · ${demo}` : ''}</span>
          </span>
        );
      },
    },
    {
      id: 'location', header: 'Ward / bed', accessorFn: (a) => `${a.WARD_NAME || ''} ${a.BED_NUMBER || ''}`,
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.WARD_NAME || '—'} / <span className="mono">{row.original.BED_NUMBER || '—'}</span></span>
          <span className="cell-secondary">Room {row.original.ROOM_NUMBER || '—'}</span>
        </span>
      ),
    },
    {
      id: 'doctor', header: 'Consultant', accessorFn: (a) => a.DOCTOR_NAME || '',
      cell: ({ getValue }) => (getValue() ? `Dr. ${getValue()}` : '—'),
    },
    {
      id: 'stay', header: 'Stay', accessorFn: daysAdmitted, meta: { width: 150 },
      cell: ({ row }) => {
        const d = daysAdmitted(row.original);
        const since = fmtDate(row.original.ADMISSION_DATE);
        return (
          <span className="cell-stack">
            {d > LONG_STAY_DAYS
              ? <span><span className="status status-warning">{d} days</span></span>
              : <span className="tabular">{d} {d === 1 ? 'day' : 'days'}</span>}
            {since && <span className="cell-secondary">Since {since}</span>}
          </span>
        );
      },
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 200, align: 'right' },
      cell: ({ row }) => (
        <span className="inline-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/ipd/patient/${admissionId(row.original)}`)} aria-label={`Open chart for ${row.original.PATIENT_NAME}`}>
            Chart
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => recordVitals(row.original)} aria-label={`Record vitals for ${row.original.PATIENT_NAME}`}>
            <HeartPulse size={14} aria-hidden="true" /> Vitals
          </button>
        </span>
      ),
    },
  ], [navigate, recordVitals]);

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  const show = (v) => (loading ? '—' : v);
  const longStays = admissions.filter((a) => daysAdmitted(a) > LONG_STAY_DAYS).length;

  return (
    <>
      <PageHeader
        title={`${greeting}, ${firstName(user?.name)}`}
        description="Your ward patients, pending admission requests and this shift's vitals round."
        meta={<span className="muted">{dateStr}</span>}
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchNurseData} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/ipd/requests')}>
              <ClipboardList size={16} aria-hidden="true" /> Admission requests
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/ipd/beds')}>
              <BedDouble size={16} aria-hidden="true" /> Bed management
            </button>
          </>
        )}
      />

      <div className="kpi-strip">
        <button
          type="button"
          className="panel kpi kpi-button"
          onClick={() => navigate('/ipd/patients')}
          aria-label={`Active inpatients: ${show(admissions.length)}. Open the patient directory`}
        >
          <div className="kpi-label">Active inpatients</div>
          <div className="kpi-value">{show(admissions.length)}</div>
        </button>
        <button
          type="button"
          className="panel kpi kpi-button"
          onClick={() => navigate('/ipd/requests')}
          aria-label={`Pending admission requests: ${show(pendingRequests)}. Open admission requests`}
        >
          <div className="kpi-label">Pending admission requests</div>
          <div className="kpi-value" style={{ color: !loading && pendingRequests > 0 ? 'var(--amber)' : undefined }}>{show(pendingRequests)}</div>
        </button>
        <div className="panel kpi">
          <div className="kpi-label">Stays over {LONG_STAY_DAYS} days</div>
          <div className="kpi-value">{show(longStays)}</div>
        </div>
      </div>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <h2 className="panel-title" style={{ margin: 0 }}>
            <BedDouble size={16} aria-hidden="true" /> Ward patients
            {!loading && <span className="status status-neutral">{admissions.length} active</span>}
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/ipd/patients')}>
            Patient directory <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
        <DataTable
          columns={columns}
          data={admissions}
          loading={loading}
          getRowId={(a, i) => String(admissionId(a) ?? i)}
          pageSize={15}
          empty={(
            <EmptyState
              icon={BedDouble}
              title="No active inpatients"
              description="Patients admitted from IPD requests appear here."
              action={(
                <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate('/ipd/requests')}>
                  <ClipboardList size={16} aria-hidden="true" /> View admission requests
                </button>
              )}
            />
          )}
        />
      </section>

      <div className="split-2">
        <section className="panel panel-pad">
          <h2 className="panel-title"><HeartPulse size={16} aria-hidden="true" /> Vitals round</h2>
          {loading ? <p className="muted">Loading…</p> : admissions.length === 0 ? (
            <p className="muted">No admitted patients on this shift's round.</p>
          ) : (
            <>
              <ul className="list-rows">
                {admissions.slice(0, 8).map((adm, i) => (
                  <li key={admissionId(adm) ?? i}>
                    <div className="list-row list-row-static">
                      <span className="cell-stack">
                        <span className="cell-primary">{adm.PATIENT_NAME}</span>
                        <span className="cell-secondary">{adm.WARD_NAME} / {adm.BED_NUMBER}</span>
                      </span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => recordVitals(adm)} aria-label={`Record vitals for ${adm.PATIENT_NAME}`}>
                        Record vitals
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {admissions.length > 8 && (
                <p className="muted" style={{ marginTop: 10 }}>
                  {admissions.length - 8} more {admissions.length - 8 === 1 ? 'patient' : 'patients'} in the ward patients list above.
                </p>
              )}
            </>
          )}
        </section>

        <section className="panel panel-pad">
          <h2 className="panel-title"><LayoutGrid size={16} aria-hidden="true" /> Quick navigation</h2>
          <ul className="list-rows">
            {QUICK_LINKS.map((a) => {
              const Icon = a.icon;
              return (
                <li key={a.to}>
                  <button type="button" className="list-row" onClick={() => navigate(a.to)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <Icon size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                      {a.label}
                    </span>
                    <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </>
  );
}
