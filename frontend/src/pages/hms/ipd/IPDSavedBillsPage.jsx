import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FileText, Plus, ArrowRight } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function IPDSavedBillsPage() {
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/ipd/billing/saved-drafts')
      .then(res => setDrafts(res.data.data || []))
      .catch(() => toast.error('Could not load saved drafts'))
      .finally(() => setLoading(false));
  }, []);

  const openDraft = (draft) => navigate(`/ipd/billing/${draft.ID}`);

  const columns = useMemo(() => [
    {
      id: 'patient', header: 'Patient', accessorFn: (d) => d.PATIENT_NAME || '',
      cell: ({ row }) => {
        const d = row.original;
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(d.PATIENT_NAME || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{d.PATIENT_NAME || '—'}</span>
              <span className="cell-secondary mono">{d.UHID || 'No UHID'}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'location', header: 'Location', accessorFn: (d) => `${d.WARD_NAME || ''} ${d.BED_NUMBER || ''}`,
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.WARD_NAME || '—'}</span>
          <span className="cell-secondary">Bed {row.original.BED_NUMBER || '—'}</span>
        </span>
      ),
    },
    {
      id: 'items', header: 'Items', accessorFn: (d) => Number(d.itemCount || 0), meta: { width: 100, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{getValue()}</span>,
    },
    {
      id: 'total', header: 'Draft total', accessorFn: (d) => Number(d.draftTotal || 0), meta: { width: 150, align: 'right' },
      cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{inr(getValue())}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 170, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); openDraft(row.original); }}>
          Review and finalize <ArrowRight size={14} aria-hidden="true" />
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Saved billing drafts"
          description="IPD bills saved as drafts. Open one to edit items or finalize the bill."
          meta={!loading && <span className="muted">{drafts.length} {drafts.length === 1 ? 'draft' : 'drafts'}</span>}
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/ipd/billing')}>
              <Plus size={16} aria-hidden="true" /> New bill entry
            </button>
          )}
        />

        <section className="panel">
          <DataTable
            columns={columns}
            data={drafts}
            loading={loading}
            getRowId={(d) => String(d.ID)}
            onRowClick={openDraft}
            rowLabel={(d) => `Open draft for ${d.PATIENT_NAME || 'patient'}`}
            initialSorting={[{ id: 'patient', desc: false }]}
            empty={(
              <EmptyState
                icon={FileText}
                title="No saved drafts"
                description="Drafts appear here when you save charges for an admitted patient in IPD billing."
                action={<button type="button" className="btn btn-secondary btn-md" onClick={() => navigate('/ipd/billing')}>Go to IPD billing</button>}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
