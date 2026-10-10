import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BedDouble, FileText, Search, RefreshCw } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const VIEWS = [
  { key: 'Active', label: 'Admitted' },
  { key: 'Discharged', label: 'Discharged' },
  { key: '', label: 'All' },
];
const STATUS_TONE = { Active: 'info', Discharged: 'success' };
const DAY_MS = 864e5;

const admissionId = (a) => a.ID || a.id;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const stayDays = (a) => {
  const n = Number(a.DAYS_ADMITTED);
  if (Number.isFinite(n)) return n;
  return a.ADMISSION_DATE ? Math.floor((Date.now() - new Date(a.ADMISSION_DATE).getTime()) / DAY_MS) : 0;
};
const withDr = (name) => (!name ? '—' : /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`);
const ageSex = (a) => [a.AGE ? `${a.AGE} y` : null, a.GENDER ? a.GENDER.charAt(0).toUpperCase() : null].filter(Boolean).join(' · ');

export default function IPDPatientListPage() {
  const navigate = useNavigate();
  const [admissions, setAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('Active');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchAdmissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/ipd/admissions?status=${statusFilter}`);
      setAdmissions(res.data.data || []);
    } catch {
      toast.error('Failed to fetch admissions');
      setAdmissions([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchAdmissions(); }, [fetchAdmissions]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return admissions;
    return admissions.filter((a) => [
      a.PATIENT_NAME, a.UHID, a.ADMISSION_ID_FORMATTED, a.DOCTOR_NAME, a.DEPARTMENT, a.WARD_NAME, a.BED_NUMBER, a.PRIMARY_DIAGNOSIS,
    ].some((v) => String(v || '').toLowerCase().includes(q)));
  }, [admissions, searchQuery]);

  const stats = useMemo(() => {
    const active = admissions.filter((a) => a.STATUS === 'Active');
    const now = Date.now();
    const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
    return {
      inpatients: active.length,
      last24h: active.filter((a) => a.ADMISSION_DATE && now - new Date(a.ADMISSION_DATE).getTime() < DAY_MS).length,
      avgStay: active.length ? (active.reduce((s, a) => s + stayDays(a), 0) / active.length).toFixed(1) : '0',
      dueDischarge: active.filter((a) => a.EXPECTED_DISCHARGE_DATE && new Date(a.EXPECTED_DISCHARGE_DATE) <= endOfToday).length,
    };
  }, [admissions]);

  const openChart = (a) => navigate(`/ipd/patient/${admissionId(a)}`);

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.PATIENT_NAME || '',
      cell: ({ row }) => {
        const a = row.original;
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(a.PATIENT_NAME || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{a.PATIENT_NAME || '—'}</span>
              <span className="cell-secondary"><span className="mono">{a.UHID || '—'}</span>{ageSex(a) ? ` · ${ageSex(a)}` : ''}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'admission', header: 'Admission', accessorFn: (a) => a.ADMISSION_ID_FORMATTED || '', meta: { width: 150 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="mono">{row.original.ADMISSION_ID_FORMATTED || `#${admissionId(row.original)}`}</span>
          {row.original.ADMISSION_TYPE && <span className="cell-secondary">{row.original.ADMISSION_TYPE}</span>}
        </span>
      ),
    },
    {
      id: 'bed', header: 'Ward / bed', accessorFn: (a) => `${a.WARD_NAME || ''} ${a.BED_NUMBER || ''}`.trim(), meta: { width: 170 },
      cell: ({ row }) => {
        const a = row.original;
        if (!a.WARD_NAME && !a.BED_NUMBER) return <span className="cell-secondary">Not assigned</span>;
        return (
          <span className="cell-stack">
            <span>{a.WARD_NAME || '—'}</span>
            <span className="cell-secondary">Bed {a.BED_NUMBER || '—'}{a.ROOM_NUMBER ? ` · Room ${a.ROOM_NUMBER}` : ''}</span>
          </span>
        );
      },
    },
    {
      id: 'diagnosis', header: 'Diagnosis', accessorFn: (a) => a.PRIMARY_DIAGNOSIS || a.DEPARTMENT || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.PRIMARY_DIAGNOSIS || '—'}</span>
          {row.original.DEPARTMENT && <span className="cell-secondary">{row.original.DEPARTMENT}</span>}
        </span>
      ),
    },
    { id: 'doctor', header: 'Consultant', accessorFn: (a) => a.DOCTOR_NAME || '', meta: { width: 170 }, cell: ({ getValue }) => withDr(getValue()) },
    {
      id: 'admitted', header: 'Admitted', accessorFn: (a) => (a.ADMISSION_DATE ? new Date(a.ADMISSION_DATE).getTime() : 0), meta: { width: 140 },
      cell: ({ row }) => {
        const a = row.original;
        const days = stayDays(a);
        return (
          <span className="cell-stack">
            <span className="tabular">{fmtDate(a.ADMISSION_DATE)}</span>
            {a.STATUS === 'Active' && <span className="cell-secondary tabular">Day {days + 1}</span>}
          </span>
        );
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.STATUS || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue() === 'Active' ? 'Admitted' : getValue() || '—'}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Inpatients"
          description="Admitted patients by ward and bed. Open a row to see the inpatient chart."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/ipd/discharge-summaries')}>
              <FileText size={16} aria-hidden="true" /> Discharge summaries
            </button>
          )}
        />

        {statusFilter === 'Active' && (
          <div className="kpi-strip">
            <div className="panel kpi"><div className="kpi-label">Inpatients</div><div className="kpi-value">{loading ? '—' : stats.inpatients}</div></div>
            <div className="panel kpi"><div className="kpi-label">Admitted, last 24 h</div><div className="kpi-value">{loading ? '—' : stats.last24h}</div></div>
            <div className="panel kpi"><div className="kpi-label">Average stay so far</div><div className="kpi-value">{loading ? '—' : `${stats.avgStay} d`}</div></div>
            <div className="panel kpi">
              <div className="kpi-label">Due for discharge today</div>
              <div className="kpi-value" style={{ color: stats.dueDischarge ? 'var(--amber)' : undefined }}>{loading ? '—' : stats.dueDischarge}</div>
            </div>
          </div>
        )}

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Admission status">
              {VIEWS.map((v) => (
                <button key={v.label} type="button" role="tab" aria-selected={statusFilter === v.key} className={statusFilter === v.key ? 'is-active' : ''} onClick={() => setStatusFilter(v.key)}>
                  {v.label}
                </button>
              ))}
            </div>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search inpatients</span>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search patient, UHID, admission no., ward, doctor or diagnosis" />
            </label>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchAdmissions}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(a) => String(admissionId(a))}
            onRowClick={openChart}
            rowLabel={(a) => `Open inpatient chart for ${a.PATIENT_NAME}`}
            initialSorting={[{ id: 'admitted', desc: true }]}
            empty={searchQuery ? (
              <EmptyState icon={Search} title="No admissions match" description={`Nothing matches “${searchQuery}”.`} />
            ) : (
              <EmptyState
                icon={BedDouble}
                title={statusFilter === 'Active' ? 'No patients admitted' : 'No admissions found'}
                description={statusFilter === 'Active' ? 'Admitted patients appear here once a bed is allocated.' : 'Try another status.'}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
