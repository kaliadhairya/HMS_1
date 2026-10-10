import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Eye, FileText, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import DischargeSummaryModal from '../../../components/DischargeSummaryModal';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '');

export default function IPDDischargeSummariesPage() {
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openingId, setOpeningId] = useState(null);

  // Modal State
  const [selectedAdmission, setSelectedAdmission] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchSummaries();
  }, []);

  const fetchSummaries = async () => {
    try {
      const res = await api.get('/ipd/discharge-summaries');
      if (res.data.success) {
        setSummaries(res.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load discharge summaries');
    } finally {
      setLoading(false);
    }
  };

  const handleViewSummary = async (summary) => {
    setOpeningId(summary.ID);
    try {
      const res = await api.get(`/ipd/admissions/${summary.ADMISSION_ID}`);
      if (res.data.success) {
        setSelectedAdmission(res.data.data);
        setShowModal(true);
      } else {
        toast.error('Could not load admission details');
      }
    } catch (err) {
      toast.error('Could not load admission details');
    } finally {
      setOpeningId(null);
    }
  };

  const filtered = useMemo(() => summaries.filter(s => {
    const q = search.toLowerCase();
    return (s.PATIENT_NAME?.toLowerCase().includes(q) || s.UHID?.toLowerCase().includes(q) || String(s.ADMISSION_ID).includes(q) || s.FINAL_DIAGNOSIS?.toLowerCase().includes(q));
  }), [summaries, search]);

  const columns = useMemo(() => [
    {
      id: 'discharged', header: 'Discharged', accessorFn: (s) => (s.DISCHARGE_DATE ? new Date(s.DISCHARGE_DATE).getTime() : 0), meta: { width: 150 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="tabular" style={{ fontWeight: 600 }}>{fmtDate(row.original.DISCHARGE_DATE)}</span>
          <span className="cell-secondary">{fmtTime(row.original.DISCHARGE_DATE)}</span>
        </span>
      ),
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (s) => s.PATIENT_NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.PATIENT_NAME || '—'}</span>
          <span className="cell-secondary mono">{row.original.UHID || 'Legacy'}</span>
        </span>
      ),
    },
    {
      id: 'admission', header: 'Admission', accessorFn: (s) => Number(s.ADMISSION_ID || 0), meta: { width: 130 },
      cell: ({ row }) => <span className="mono">IPD-{row.original.ADMISSION_ID}</span>,
    },
    {
      id: 'diagnosis', header: 'Final diagnosis', accessorFn: (s) => s.FINAL_DIAGNOSIS || '',
      cell: ({ getValue }) => (
        <span title={getValue()} style={{ display: 'block', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {getValue() || '—'}
        </span>
      ),
    },
    { id: 'doctor', header: 'Consultant', accessorFn: (s) => s.DOCTOR_NAME || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 150, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={openingId === row.original.ID}
          onClick={() => handleViewSummary(row.original)}
        >
          <Eye size={14} aria-hidden="true" /> {openingId === row.original.ID ? 'Opening…' : 'View summary'}
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [openingId]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Discharge summaries"
          description="View and print saved discharge summaries for past admissions."
          meta={!loading && <span className="muted">{summaries.length} {summaries.length === 1 ? 'summary' : 'summaries'}</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/ipd/patients')}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to admissions
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search discharge summaries</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search UHID, patient name, admission ID or diagnosis"
                autoFocus
              />
            </label>
            {search && !loading && <span className="muted">{filtered.length} shown</span>}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(s) => String(s.ID)}
            initialSorting={[{ id: 'discharged', desc: true }]}
            empty={search ? (
              <EmptyState icon={Search} title="No summaries match" description="Try another name, UHID, admission ID or diagnosis." />
            ) : (
              <EmptyState icon={FileText} title="No discharge summaries yet" description="Summaries appear here once a patient is discharged with a saved summary." />
            )}
          />
        </section>
      </main>

      {showModal && selectedAdmission && (
        <DischargeSummaryModal
          admission={selectedAdmission}
          onClose={() => { setShowModal(false); setSelectedAdmission(null); }}
          viewOnly={true}
        />
      )}
    </>
  );
}
