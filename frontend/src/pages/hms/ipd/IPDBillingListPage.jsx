import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BedDouble, Search, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const daysAdmitted = (adm) => adm.DAYS_ADMITTED || Math.max(1, Math.ceil((Date.now() - new Date(adm.ADMISSION_DATE).getTime()) / 86400000));
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function IPDBillingListPage() {
  const navigate = useNavigate();
  const [admissions, setAdmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.get('/ipd/admissions?status=Active')
      .then(res => setAdmissions(res.data.data || []))
      .catch(() => toast.error('Could not load admissions'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return admissions;
    return admissions.filter((a) => [a.PATIENT_NAME, a.UHID, a.ADMISSION_ID_FORMATTED, a.WARD_NAME, a.BED_NUMBER, a.DOCTOR_NAME]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }, [admissions, query]);

  const openBilling = (adm) => navigate(`/ipd/billing/${adm.ID || adm.id}`);

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
              <span className="cell-secondary"><span className="mono">{a.UHID || 'No UHID'}</span>{a.ADMISSION_ID_FORMATTED ? ` · ${a.ADMISSION_ID_FORMATTED}` : ''}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'location', header: 'Location', accessorFn: (a) => `${a.WARD_NAME || ''} ${a.BED_NUMBER || ''}`,
      cell: ({ row }) => {
        const a = row.original;
        return (
          <span className="cell-stack">
            <span>{a.WARD_NAME || 'Ward'} · Bed {a.BED_NUMBER || '—'}</span>
            <span className="cell-secondary">Room {a.ROOM_NUMBER || '—'}</span>
          </span>
        );
      },
    },
    {
      id: 'admitted', header: 'Admitted', accessorFn: (a) => (a.ADMISSION_DATE ? new Date(a.ADMISSION_DATE).getTime() : 0), meta: { width: 160 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="tabular">{fmtDate(row.original.ADMISSION_DATE)}</span>
          <span className="cell-secondary">Day {daysAdmitted(row.original)}</span>
        </span>
      ),
    },
    { id: 'doctor', header: 'Primary physician', accessorFn: (a) => a.DOCTOR_NAME || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 160, align: 'right' },
      cell: ({ row }) => (
        <Link to={`/ipd/billing/${row.original.ID || row.original.id}`} className="btn btn-secondary btn-sm" onClick={(e) => e.stopPropagation()}>
          <Wallet size={14} aria-hidden="true" /> Manage billing
        </Link>
      ),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="IPD billing"
          description="Select an admitted patient to manage their charges and bill."
          meta={!loading && <span className="muted">{admissions.length} active {admissions.length === 1 ? 'admission' : 'admissions'}</span>}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search admissions</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, UHID, ward, bed or doctor" />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(a) => String(a.ID || a.id)}
            onRowClick={openBilling}
            rowLabel={(a) => `Manage billing for ${a.PATIENT_NAME || 'patient'}`}
            initialSorting={[{ id: 'admitted', desc: true }]}
            empty={admissions.length > 0 ? (
              <EmptyState icon={Search} title="No admissions match" description="Try another name, UHID or ward." />
            ) : (
              <EmptyState icon={BedDouble} title="No active admissions" description="There are no admitted patients to bill right now." />
            )}
          />
        </section>
      </main>
    </>
  );
}
