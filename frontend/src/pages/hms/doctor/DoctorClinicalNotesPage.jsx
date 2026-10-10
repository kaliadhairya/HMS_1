import { useState, useEffect, useMemo } from 'react';
import { FileText, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const NOTE_TYPES = [
  { value: 'SOAP Note', label: 'SOAP note', tone: 'info' },
  { value: 'Progress Note', label: 'Progress note', tone: 'success' },
  { value: 'Discharge Summary', label: 'Discharge summary', tone: 'warning' },
  { value: 'Operative Note', label: 'Operative note', tone: 'neutral' },
  { value: 'Emergency Note', label: 'Emergency note', tone: 'danger' },
];
const TYPE_META = Object.fromEntries(NOTE_TYPES.map((t) => [t.value, t]));
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function DoctorClinicalNotesPage() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');

  useEffect(() => {
    api.get('/doctor/clinical-notes')
      .then(res => setNotes(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = notes.filter(n => {
    if (filterType && n.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (n.patient || '').toLowerCase().includes(q) || String(n.id).toLowerCase().includes(q);
    }
    return true;
  });

  const columns = useMemo(() => [
    {
      id: 'date', header: 'Date', accessorFn: (n) => (n.date ? new Date(n.date).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDate(row.original.date)}</span>,
    },
    { id: 'id', header: 'Note', accessorFn: (n) => n.id || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="mono">{getValue()}</span> },
    { id: 'patient', header: 'Patient', accessorFn: (n) => n.patient || '', meta: { width: 200 }, cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    {
      id: 'type', header: 'Type', accessorFn: (n) => n.type || '', meta: { width: 160 },
      cell: ({ getValue }) => {
        const t = TYPE_META[getValue()];
        return <span className={`status status-${t?.tone || 'info'}`}>{t?.label || getValue()}</span>;
      },
    },
    {
      id: 'snippet', header: 'Preview', accessorFn: (n) => n.snippet || '', enableSorting: false,
      cell: ({ getValue }) => (
        <span className="cell-secondary" title={getValue()} style={{ display: 'block', maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {getValue()}
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 150, align: 'right' },
      cell: () => (
        <button type="button" className="btn btn-ghost btn-sm" disabled title="Open the consultation encounter to review the full note.">
          Encounter source
        </button>
      ),
    },
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Clinical notes"
          description="SOAP notes, progress notes and discharge summaries from your encounters."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" disabled title="Notes are created through the consultation encounter workflow.">
              Use consultation
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search clinical notes</span>
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search patient name or note ID" />
            </label>
            <label className="sr-only" htmlFor="note-type-filter">Filter by note type</label>
            <select id="note-type-filter" className="form-select" style={{ width: 210 }} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">All note types</option>
              {NOTE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <span className="count-pill">{filtered.length} notes</span>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(n) => String(n.id)}
            empty={notes.length > 0 ? (
              <EmptyState icon={Search} title="No notes match" description={searchQuery ? `No notes match "${searchQuery}". Try another name or clear the type filter.` : 'Choose another note type.'} />
            ) : (
              <EmptyState icon={FileText} title="No clinical notes yet" description="Notes recorded during consultations appear here." />
            )}
          />
        </section>
      </main>
    </>
  );
}
