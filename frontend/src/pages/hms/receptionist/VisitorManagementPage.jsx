import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { IdCard, LogOut, Search, TriangleAlert, Users } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';

const WARDS = ['General-A', 'General-B', 'ICU', 'Maternity', 'Pediatric'];
const RELATIONS = ['Spouse', 'Father', 'Mother', 'Son', 'Daughter', 'Sibling', 'Friend', 'Other'];
const EMPTY_FORM = { patient: '', ward: '', bed: '', visitor: '', relation: '' };
const VIEWS = [
  { key: '', label: 'All' },
  { key: 'Active', label: 'Inside' },
  { key: 'Checked Out', label: 'Checked out' },
];

export default function VisitorManagementPage() {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('');
  const MAX_VISITORS = 5;

  useEffect(() => {
    fetchVisitors();
  }, []);

  const fetchVisitors = () => {
    api.get('/receptionist/visitor-log')
      .then((res) => setVisitors(res.data.data || []))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load the visitor log');
      })
      .finally(() => setLoading(false));
  };

  const handleIssuePass = async () => {
    if (!form.visitor || !form.patient) return;
    try {
      await api.post('/receptionist/visitor-log', form);
      toast.success('Visitor pass issued.');
      setShowForm(false);
      setForm(EMPTY_FORM);
      fetchVisitors();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to issue visitor pass.');
    }
  };

  const handleCheckout = async (numericId) => {
    try {
      await api.put(`/receptionist/visitor-log/${numericId}/checkout`);
      toast.success('Visitor checked out.');
      fetchVisitors();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to check out visitor.');
    }
  };

  const activeVisitors = visitors.filter((v) => v.status === 'Active');
  const checkedOut = visitors.filter((v) => v.status === 'Checked Out');

  const patientCounts = {};
  activeVisitors.forEach((v) => {
    patientCounts[v.patient] = (patientCounts[v.patient] || 0) + 1;
  });

  const limitReached = Boolean(form.patient) && patientCounts[form.patient] >= MAX_VISITORS;
  const viewCounts = { '': visitors.length, Active: activeVisitors.length, 'Checked Out': checkedOut.length };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visitors.filter((v) => {
      if (view && v.status !== view) return false;
      if (!q) return true;
      return [v.id, v.patient, v.visitor, v.ward, v.bed, v.relation].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }, [visitors, query, view]);

  const columns = useMemo(() => [
    { id: 'pass', header: 'Pass', accessorFn: (v) => v.numericId ?? v.id, meta: { width: 110 }, cell: ({ row }) => <span className="mono">{row.original.id}</span> },
    {
      id: 'visitor', header: 'Visitor', accessorFn: (v) => v.visitor || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.visitor}</span>
          {row.original.relation && <span className="cell-secondary">{row.original.relation}</span>}
        </span>
      ),
    },
    {
      id: 'patient', header: 'Visiting', accessorFn: (v) => v.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.patient}</span>
          <span className="cell-secondary">{row.original.ward || '—'} / {row.original.bed || '—'}</span>
        </span>
      ),
    },
    { id: 'in', header: 'Check-in', accessorFn: (v) => v.check_in || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    { id: 'out', header: 'Check-out', accessorFn: (v) => v.check_out || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="tabular cell-secondary">{getValue() || '—'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (v) => v.status || '', meta: { width: 130 },
      cell: ({ getValue }) => (getValue() === 'Active'
        ? <span className="status status-success">Inside</span>
        : <span className="status status-neutral">Checked out</span>),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 130, align: 'right' },
      cell: ({ row }) => {
        const v = row.original;
        if (v.status !== 'Active') return null;
        return (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCheckout(v.numericId)} aria-label={`Check out ${v.visitor}`}>
            <LogOut size={14} aria-hidden="true" /> Check out
          </button>
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const issueButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>
      <IdCard size={16} aria-hidden="true" /> Issue visitor pass
    </button>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Visitors"
          description={`Issue visitor passes and track check-in and check-out. Up to ${MAX_VISITORS} visitors per patient at a time.`}
          actions={issueButton}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Currently inside</div><div className="kpi-value">{activeVisitors.length}</div></div>
          <div className="panel kpi"><div className="kpi-label">Checked out today</div><div className="kpi-value">{checkedOut.length}</div></div>
          <div className="panel kpi"><div className="kpi-label">Patients with visitors</div><div className="kpi-value">{Object.keys(patientCounts).length}</div></div>
        </div>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><Users size={16} aria-hidden="true" /> Today's visitor log</h2>
            <span className="muted">{visitors.length} visitors</span>
          </div>
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search visitors</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search visitor, patient, pass or ward" />
            </label>
            <div className="segmented" role="tablist" aria-label="Filter by status">
              {VIEWS.map((v) => (
                <button key={v.key || 'all'} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? 'is-active' : ''} onClick={() => setView(v.key)}>
                  {v.label} <span className="seg-count">{viewCounts[v.key]}</span>
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(v) => String(v.id)}
            pageSize={50}
            empty={visitors.length > 0 ? (
              <EmptyState icon={Search} title="No visitors match" description="Clear the search or pick another status." />
            ) : (
              <EmptyState icon={Users} title="No visitors yet today" description="Issue a pass to start tracking visitors." action={issueButton} />
            )}
          />
        </section>
      </main>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="Issue visitor pass"
        description="The visitor is checked in as soon as the pass is issued."
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button
              type="submit"
              form="visitor-form"
              className="btn btn-primary btn-md"
              disabled={!form.visitor || !form.patient || limitReached}
            >
              Issue pass and check in
            </button>
          </>
        )}
      >
        <form id="visitor-form" onSubmit={(e) => { e.preventDefault(); handleIssuePass(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="vp-patient">Patient name</label>
            <input id="vp-patient" type="text" className="form-input" required value={form.patient} onChange={(e) => setForm({ ...form, patient: e.target.value })} />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="vp-ward">Ward</label>
              <select id="vp-ward" className="form-select" value={form.ward} onChange={(e) => setForm({ ...form, ward: e.target.value })}>
                <option value="">Select ward</option>
                {WARDS.map((w) => <option key={w}>{w}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vp-bed">Bed number</label>
              <input id="vp-bed" type="text" className="form-input" placeholder="e.g. B-12" value={form.bed} onChange={(e) => setForm({ ...form, bed: e.target.value })} />
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="vp-visitor">Visitor name</label>
              <input id="vp-visitor" type="text" className="form-input" required value={form.visitor} onChange={(e) => setForm({ ...form, visitor: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="vp-relation">Relation</label>
              <select id="vp-relation" className="form-select" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })}>
                <option value="">Select relation</option>
                {RELATIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
          </div>

          {limitReached && (
            <div className="alert-strip alert-danger" role="alert" style={{ marginBottom: 0 }}>
              <TriangleAlert size={16} aria-hidden="true" />
              {form.patient} already has {MAX_VISITORS} visitors inside. Check one out before issuing another pass.
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
