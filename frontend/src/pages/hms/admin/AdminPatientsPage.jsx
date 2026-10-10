import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, ClipboardList, Search, Users } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import api from '../../../api/axios';

const ADMISSION_TONE = { Admitted: 'success', 'Discharge Pending': 'warning' };
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function AdminPatientsPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/dashboard/admin-ops').catch(() => ({ data: { data: {} } })),
      api.get(`/patients/search?q=${search}&page=${page}&limit=20`).catch(() => ({ data: { data: { patients: [] } } })),
    ]).then(([statsRes, pRes]) => {
      setStats(statsRes.data.data);
      setPatients(pRes.data.data?.patients || pRes.data.data || []);
    }).finally(() => setLoading(false));
  }, [search, page]);

  const admissions = stats?.recent_admissions || [];
  const patientRows = Array.isArray(patients) ? patients : [];

  const admissionColumns = useMemo(() => [
    { id: 'patient', header: 'Patient', accessorFn: (a) => a.PATIENT_NAME || '', cell: ({ getValue }) => <span className="cell-primary">{getValue() || '—'}</span> },
    { id: 'ward', header: 'Ward', accessorFn: (a) => a.WARD_NAME || '', cell: ({ getValue }) => getValue() || '—' },
    { id: 'bed', header: 'Bed', accessorFn: (a) => a.BED_NUMBER || '', meta: { width: 100 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.STATUS || '', meta: { width: 170 },
      cell: ({ getValue }) => <span className={`status status-${ADMISSION_TONE[getValue()] || 'info'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'date', header: 'Admitted', accessorFn: (a) => (a.ADMISSION_DATE ? new Date(a.ADMISSION_DATE).getTime() : 0), meta: { width: 190 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDateTime(row.original.ADMISSION_DATE)}</span>,
    },
  ], []);

  const patientColumns = useMemo(() => [
    {
      id: 'name', header: 'Patient', accessorFn: (p) => p.name || '',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{p.name || '—'}</span>
              <span className="cell-secondary mono">{p.uhid || 'No UHID'}</span>
            </span>
          </span>
        );
      },
    },
    { id: 'phone', header: 'Phone', accessorFn: (p) => p.phoneNumber || '', meta: { width: 160 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    { id: 'gender', header: 'Gender', accessorFn: (p) => p.gender || '', meta: { width: 110 }, cell: ({ getValue }) => getValue() || '—' },
    { id: 'age', header: 'Age', accessorFn: (p) => Number(p.age) || 0, meta: { width: 80, align: 'right' }, cell: ({ row }) => <span className="tabular">{row.original.age ?? '—'}</span> },
    {
      id: 'registered', header: 'Registered', accessorFn: (p) => (p.createdAt ? new Date(p.createdAt).getTime() : 0), meta: { width: 150 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDate(row.original.createdAt)}</span>,
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Patient overview"
          description="Admissions, discharges and patient flow, for operational oversight without clinical access."
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/ipd/beds')}>
              <BedDouble size={16} aria-hidden="true" /> Bed management
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">OPD today</div><div className="kpi-value">{stats?.opd_count || 0}</div></div>
          <div className="panel kpi"><div className="kpi-label">IPD admitted</div><div className="kpi-value">{stats?.ipd_count || 0}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Pending discharges</div>
            <div className="kpi-value" style={{ color: Number(stats?.pending_discharges) > 0 ? 'var(--amber)' : undefined }}>{stats?.pending_discharges || 0}</div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Bed occupancy</div><div className="kpi-value">{`${stats?.bed_occupancy || 0}%`}</div></div>
        </div>

        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Recent admissions</h2></div>
          <DataTable
            columns={admissionColumns}
            data={admissions}
            loading={loading}
            getRowId={(a, i) => String(a.ID ?? i)}
            pageSize={10}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={<EmptyState icon={BedDouble} title="No recent admissions" description="New IPD admissions appear here." />}
          />
        </section>

        <section className="panel">
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Users size={16} aria-hidden="true" /> Patients</h2></div>
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search patients</span>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search patients by name, UHID or phone"
              />
            </label>
          </div>
          <DataTable
            columns={patientColumns}
            data={patientRows}
            loading={loading}
            getRowId={(p, i) => String(p.id ?? i)}
            pageSize={20}
            empty={search.trim() ? (
              <EmptyState icon={Search} title="No patients match" description="Try another name, UHID or phone number." />
            ) : (
              <EmptyState icon={Users} title="No patients yet" description="Registered patients appear here." />
            )}
          />
        </section>
      </main>
    </>
  );
}
