import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, Pencil, Plus, Printer, Search, Trash2 } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-GB') : '—');

export default function RestFormHubPage() {
  const [restForms, setRestForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();

  const loadRestForms = async () => {
    try {
      const res = await api.get('/hms/rest-forms/doctor');
      setRestForms(res.data);
    } catch (error) {
      console.error(error);
      toast.error('Failed to load rest forms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRestForms();
  }, []);

  const handleDelete = async (id) => {
    setDeleting(true);
    try {
      await api.delete(`/hms/rest-forms/${id}`);
      toast.success('Rest form deleted');
      setPendingDelete(null);
      loadRestForms();
    } catch (e) {
      console.error(e);
      toast.error('Failed to delete rest form');
    } finally {
      setDeleting(false);
    }
  };

  const filteredForms = (restForms || []).filter(f =>
    (f.patient_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(f.emp_number || '').includes(searchQuery) ||
    String(f.book_no || '').includes(searchQuery)
  );

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', accessorFn: (f) => (f.created_at ? new Date(f.created_at).getTime() : 0), meta: { width: 120 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDate(row.original.created_at)}</span>,
    },
    { id: 'patient', header: 'Patient', accessorFn: (f) => f.patient_name || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'emp', header: 'Emp no.', accessorFn: (f) => f.emp_number || '', meta: { width: 120 }, cell: ({ getValue }) => <span className="mono">{getValue() || 'N/A'}</span> },
    { id: 'book', header: 'Book no.', accessorFn: (f) => f.book_no || '', meta: { width: 100 }, cell: ({ getValue }) => getValue() || '—' },
    { id: 'sr', header: 'Sr no.', accessorFn: (f) => f.sr_no || '', meta: { width: 100 }, cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span> },
    {
      id: 'disease', header: 'Disease', accessorFn: (f) => f.disease || '',
      cell: ({ getValue }) => (
        <span className="cell-secondary" title={getValue()} style={{ display: 'block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {getValue() || '—'}
        </span>
      ),
    },
    {
      id: 'days', header: 'Days', accessorFn: (f) => Number(f.advised_days || 0), meta: { width: 90, align: 'right' },
      cell: ({ row }) => <span className="tabular">{row.original.advised_days || '—'} days</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: ({ row }) => {
        const f = row.original;
        return (
          <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/doctor/rest-forms/print/${f.id}`)}>
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <RowMenu
              label={`Actions for rest form of ${f.patient_name || 'patient'}`}
              items={[
                { label: 'Edit', icon: Pencil, onSelect: () => navigate(`/doctor/rest-forms/edit/${f.id}`) },
                { label: 'Delete', icon: Trash2, onSelect: () => setPendingDelete(f), danger: true, separator: true },
              ]}
            />
          </span>
        );
      },
    },
  ], [navigate]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Rest forms"
          description="Rest and light duty certificates you have issued to patients."
          meta={!loading && <span className="muted">{restForms.length} rest forms</span>}
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/doctor/rest-forms/new')}>
              <Plus size={16} aria-hidden="true" /> Create rest form
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search rest forms</span>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search patient, emp no. or book no." />
            </label>
          </div>
          <DataTable
            columns={columns}
            data={filteredForms}
            loading={loading}
            getRowId={(f) => String(f.id)}
            empty={searchQuery ? (
              <EmptyState icon={Search} title="No forms match" description={`No forms match "${searchQuery}".`} />
            ) : (
              <EmptyState
                icon={BedDouble}
                title="No rest forms yet"
                description="Rest forms you create appear here for printing and editing."
                action={<button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/doctor/rest-forms/new')}><Plus size={16} aria-hidden="true" /> Create rest form</button>}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Delete rest form"
        description={pendingDelete ? `Rest form for ${pendingDelete.patient_name || 'this patient'}${pendingDelete.sr_no ? ` (${pendingDelete.sr_no})` : ''}. This cannot be undone.` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" disabled={deleting} onClick={() => handleDelete(pendingDelete.id)}>
              {deleting ? 'Deleting…' : 'Delete rest form'}
            </button>
          </>
        )}
      >
        <p className="muted">The form is removed from your list and can no longer be printed.</p>
      </Modal>
    </>
  );
}
