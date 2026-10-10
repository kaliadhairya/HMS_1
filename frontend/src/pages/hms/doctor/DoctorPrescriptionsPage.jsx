import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import { Download, FileText, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

const CONSULTED_STATUSES = new Set(['Consulted', 'Finalized']);

function isConsultedStatus(status) {
  return CONSULTED_STATUSES.has(status);
}

function isConsultedPrescription(rx) {
  return isConsultedStatus(rx.status) || Number(rx.medicine_count || 0) > 0;
}

function getPatientTypeMeta(type) {
  if (type === 'corporate_employee') return { label: 'Corporate', tone: 'info' };
  return { label: 'General', tone: 'neutral' };
}

const STATUS_TONE = { Consulted: 'success', Finalized: 'info' };

function getPrescriptionStatusLabel(rx) {
  if (rx.status === 'Finalized') return 'Finalized';
  if (isConsultedPrescription(rx)) return 'Consulted';
  return rx.status || 'Pending';
}

const DEFAULT_FILTERS = {
  patientName: '',
  empNo: '',
  phoneNo: '',
  fromDate: '',
  toDate: '',
  patientType: '',
  prescribedBy: '',
};

const PATIENT_TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'corporate_employee', label: 'Corporate employee or dependent' },
  { value: 'other', label: 'General patient' },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesFilter(value, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  return normalizeText(value).includes(normalizedQuery);
}

function getLocalDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getDoctorName(rx) {
  const name = rx.doctor_name || rx.doctor_username;
  if (name) return name;
  return rx.doctor_id ? 'Doctor #' + rx.doctor_id : '-';
}

export default function DoctorPrescriptionsPage() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? user?.ID;

  const fetchPrescriptions = () => {
    setLoading(true);
    api.get('/doctor/prescriptions?scope=all')
      .then(res => setPrescriptions(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPrescriptions();
  }, []);

  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Opens the confirmation dialog; the delete itself runs in confirmDelete.
  const handleDelete = (e, rx) => {
    if (e) e.stopPropagation();
    setPendingDelete(rx);
  };

  const confirmDelete = async () => {
    const rx = pendingDelete;
    if (!rx) return;
    setDeleting(true);
    try {
      await api.delete(`/doctor/prescriptions/${rx.id}`);
      toast.success('Prescription deleted.');
      setPendingDelete(null);
      fetchPrescriptions();
    } catch (err) {
      toast.error('Error deleting prescription.');
    } finally {
      setDeleting(false);
    }
  };

  const updateFilter = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const prescribedByOptions = useMemo(() => {
    const seen = new Map();
    prescriptions.forEach((rx) => {
      const doctorName = getDoctorName(rx);
      if (doctorName && doctorName !== '-') {
        seen.set(normalizeText(doctorName), doctorName);
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [prescriptions]);

  const filtered = useMemo(() => prescriptions.filter((rx) => {
    const rxDate = getLocalDateKey(rx.created_at);
    const search = normalizeText(searchQuery);
    const doctorName = getDoctorName(rx);
    if (search) {
      const searchable = [
        rx.patient_name,
        rx.uhid,
        rx.emp_number,
        rx.phone_number,
        doctorName,
        rx.diagnosis,
        rx.id ? 'rx-' + rx.id : '',
      ].map(normalizeText).join(' ');
      if (!searchable.includes(search)) return false;
    }
    if (!matchesFilter(rx.patient_name, filters.patientName)) return false;
    if (!matchesFilter(rx.emp_number, filters.empNo)) return false;
    if (!matchesFilter(rx.phone_number, filters.phoneNo)) return false;
    if (filters.patientType && rx.patient_type !== filters.patientType) return false;
    if (filters.prescribedBy && doctorName !== filters.prescribedBy) return false;
    if (filters.fromDate && (!rxDate || rxDate < filters.fromDate)) return false;
    if (filters.toDate && (!rxDate || rxDate > filters.toDate)) return false;
    return true;
  }), [prescriptions, searchQuery, filters]);

  const pendingCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Pending').length;
  const consultedCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Consulted').length;
  const finalizedCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Finalized').length;

  const exportToCSV = () => {
    if (filtered.length === 0) {
      toast.error('No data to export.');
      return;
    }

    const headers = [
      'Date', 'Rx ID', 'Patient Name', 'Patient Type', 'UHID', 'Emp Number',
      'Phone Number', 'Prescribed By', 'Diagnosis', 'Medicines Count', 'Status'
    ];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = filtered.map(rx => [
      escapeCSV(rx.created_at ? new Date(rx.created_at).toLocaleDateString('en-IN') : ''),
      escapeCSV('Rx-' + rx.id),
      escapeCSV(rx.patient_name),
      escapeCSV(getPatientTypeMeta(rx.patient_type).label),
      escapeCSV(rx.uhid),
      escapeCSV(rx.emp_number),
      escapeCSV(rx.phone_number),
      escapeCSV(getDoctorName(rx)),
      escapeCSV(rx.diagnosis),
      escapeCSV(rx.medicine_count || 0),
      escapeCSV(getPrescriptionStatusLabel(rx)),
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `Prescription_Hub_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} prescriptions to CSV`);
  };

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', meta: { width: 120 },
      accessorFn: (rx) => (rx.created_at ? new Date(rx.created_at).getTime() : 0),
      cell: ({ row }) => {
        const v = row.original.created_at;
        return (
          <span className="cell-stack tabular">
            <span>{v ? new Date(v).toLocaleDateString('en-GB') : '—'}</span>
            {v && <span className="cell-secondary">{new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>}
          </span>
        );
      },
    },
    { id: 'rx', header: 'Rx', accessorFn: (rx) => Number(rx.id || 0), meta: { width: 90 }, cell: ({ row }) => <span className="mono">Rx-{row.original.id}</span> },
    {
      id: 'patient', header: 'Patient', accessorFn: (rx) => rx.patient_name || '',
      cell: ({ row }) => {
        const rx = row.original;
        const typeMeta = getPatientTypeMeta(rx.patient_type);
        return (
          <span className="cell-stack">
            <span className="cell-primary">{rx.patient_name || '—'}</span>
            <span className="chip-row" style={{ gap: 6, alignItems: 'center' }}>
              <span className={`status status-${typeMeta.tone}`}>{typeMeta.label}</span>
              {rx.emp_number && <span className="cell-secondary">Emp {rx.emp_number}</span>}
              {rx.phone_number && <span className="cell-secondary tabular">Ph {rx.phone_number}</span>}
            </span>
          </span>
        );
      },
    },
    { id: 'doctor', header: 'Prescribed by', accessorFn: (rx) => getDoctorName(rx), meta: { width: 170 } },
    { id: 'uhid', header: 'UHID', accessorFn: (rx) => rx.uhid || '', meta: { width: 130 }, cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span> },
    {
      id: 'diagnosis', header: 'Diagnosis', accessorFn: (rx) => rx.diagnosis || '',
      cell: ({ getValue }) => (
        <span className="cell-secondary" title={getValue()} style={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getValue() || '—'}
        </span>
      ),
    },
    {
      id: 'meds', header: 'Meds', accessorFn: (rx) => Number(rx.medicine_count || 0), meta: { width: 80, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{getValue()}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (rx) => getPrescriptionStatusLabel(rx), meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'warning'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 120, align: 'right' },
      cell: ({ row }) => {
        const rx = row.original;
        const isOwnPrescription = String(rx.doctor_id || '') === String(currentUserId || '');
        return (
          <span className="inline-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/hms/prescription-slip?encounterId=${rx.encounter_id}&patientId=${rx.patient_id}`)}
            >
              <Pencil size={14} aria-hidden="true" /> Edit
            </button>
            <RowMenu
              label={`More actions for Rx-${rx.id}`}
              items={[
                { label: 'Delete prescription', icon: Trash2, danger: true, hidden: !isOwnPrescription, onSelect: () => handleDelete(null, rx) },
              ]}
            />
          </span>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [currentUserId, navigate]);

  const hasCriteria = Boolean(searchQuery) || activeFilterCount > 0;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Prescriptions"
          description="View, edit and manage all saved prescriptions."
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={exportToCSV}>
                <Download size={16} aria-hidden="true" /> Export CSV
              </button>
              <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/prescription-slip')}>
                <Plus size={16} aria-hidden="true" /> Write prescription
              </button>
            </>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi">
            <div className="kpi-label">Pending</div>
            <div className="kpi-value" style={{ color: pendingCount > 0 ? 'var(--amber)' : undefined }}>{pendingCount}</div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Consulted</div><div className="kpi-value">{consultedCount}</div></div>
          <div className="panel kpi"><div className="kpi-label">Finalized</div><div className="kpi-value">{finalizedCount}</div></div>
        </div>

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search prescriptions</span>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search patient, UHID, emp no., phone, doctor or Rx"
                autoFocus
              />
            </label>
            <button
              type="button"
              className={`btn btn-md ${showFilters || activeFilterCount ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setShowFilters(prev => !prev)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal size={16} aria-hidden="true" /> Filters
              {activeFilterCount > 0 && <span className="count-pill">{activeFilterCount}</span>}
            </button>
          </div>

          {showFilters && (
            <div className="filter-panel">
              <div className="filter-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-patient">Patient name</label>
                  <input id="rxf-patient" type="text" className="form-input" value={filters.patientName} onChange={e => updateFilter('patientName', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-emp">Employee number</label>
                  <input id="rxf-emp" type="text" className="form-input" value={filters.empNo} onChange={e => updateFilter('empNo', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-phone">Phone</label>
                  <input id="rxf-phone" type="text" className="form-input" inputMode="tel" value={filters.phoneNo} onChange={e => updateFilter('phoneNo', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-from">From date</label>
                  <input id="rxf-from" type="date" className="form-input" value={filters.fromDate} onChange={e => updateFilter('fromDate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-to">To date</label>
                  <input id="rxf-to" type="date" className="form-input" value={filters.toDate} onChange={e => updateFilter('toDate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-type">Patient type</label>
                  <select id="rxf-type" className="form-select" value={filters.patientType} onChange={e => updateFilter('patientType', e.target.value)}>
                    {PATIENT_TYPE_FILTERS.map(option => (
                      <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="rxf-doctor">Prescribed by</label>
                  <select id="rxf-doctor" className="form-select" value={filters.prescribedBy} onChange={e => updateFilter('prescribedBy', e.target.value)}>
                    <option value="">All doctors</option>
                    {prescribedByOptions.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="filter-actions">
                <button type="button" className="btn btn-ghost btn-md" onClick={() => setFilters(DEFAULT_FILTERS)} disabled={activeFilterCount === 0}>
                  Clear filters
                </button>
                <button type="button" className="btn btn-primary btn-md" onClick={() => setShowFilters(false)}>
                  Show results
                </button>
              </div>
            </div>
          )}

          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(rx) => String(rx.id)}
            initialSorting={[{ id: 'date', desc: true }]}
            empty={hasCriteria ? (
              <EmptyState icon={Search} title="No prescriptions match" description="No prescriptions match the current search or filters." />
            ) : (
              <EmptyState
                icon={FileText}
                title="No prescriptions yet"
                description="Saved prescriptions appear here."
                action={<button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/prescription-slip')}><Plus size={16} aria-hidden="true" /> Write prescription</button>}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDelete(null); }}
        title="Delete prescription"
        description={pendingDelete ? `Rx-${pendingDelete.id} for ${pendingDelete.patient_name || 'this patient'}. This permanently deletes the prescription and its medicines and cannot be undone.` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setPendingDelete(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete prescription'}
            </button>
          </>
        )}
      >
        <p className="muted">Only prescriptions you wrote can be deleted.</p>
      </Modal>
    </>
  );
}
