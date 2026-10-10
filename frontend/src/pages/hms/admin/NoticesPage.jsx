import { useState, useEffect, useMemo } from 'react';
import { Megaphone, Plus, Search, Trash2 } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

const DEPARTMENTS = ['All', 'OPD', 'IPD', 'Lab', 'Pharmacy', 'Nursing', 'Front Desk', 'Billing'];
const PRIORITIES = [
  { value: 'info', label: 'Info', tone: 'info' },
  { value: 'normal', label: 'Normal', tone: 'neutral' },
  { value: 'urgent', label: 'Urgent', tone: 'warning' },
  { value: 'critical', label: 'Critical', tone: 'danger' },
];
const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.value, p]));
const PRIORITY_RANK = { critical: 0, urgent: 1, normal: 2, info: 3 };
const EMPTY_FORM = { title: '', message: '', department: 'All', priority: 'normal' };
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function NoticesPage() {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    api.get('/admin/notices')
      .then((r) => setNotices(r.data.data))
      .catch(() => toast.error('Failed to load notices'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.title || !form.message) return toast.error('Enter a title and a message');
    try {
      await api.post('/admin/notices', form);
      setForm(EMPTY_FORM);
      setShowForm(false);
      toast.success('Notice published');
      load();
    } catch { toast.error('Failed to publish notice'); }
  };

  const remove = async (id) => {
    setDeleting(true);
    try {
      await api.delete(`/admin/notices/${id}`);
      setDeleteTarget(null);
      toast.success('Notice deleted');
      load();
    } catch {
      toast.error('Failed to delete notice');
    } finally {
      setDeleting(false);
    }
  };

  const list = Array.isArray(notices) ? notices : [];

  const counts = useMemo(() => {
    const c = { all: list.length };
    PRIORITIES.forEach((p) => { c[p.value] = list.filter((n) => n.priority === p.value).length; });
    return c;
  }, [list]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((n) => {
      if (priorityFilter && n.priority !== priorityFilter) return false;
      if (!q) return true;
      return [n.title, n.message, n.department, n.created_by].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [list, query, priorityFilter]);

  const columns = useMemo(() => [
    {
      id: 'notice', header: 'Notice', accessorFn: (n) => n.title || '',
      cell: ({ row }) => (
        <span className="cell-stack" style={{ maxWidth: 640 }}>
          <span className="cell-primary">{row.original.title}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{row.original.message}</span>
        </span>
      ),
    },
    { id: 'department', header: 'Department', accessorFn: (n) => n.department || '', meta: { width: 140 }, cell: ({ getValue }) => <span className="tag">{getValue() || 'All'}</span> },
    {
      id: 'priority', header: 'Priority', accessorFn: (n) => PRIORITY_RANK[n.priority] ?? 9, meta: { width: 120 },
      cell: ({ row }) => {
        const p = PRIORITY[row.original.priority];
        return <span className={`status status-${p?.tone || 'neutral'}`}>{p?.label || row.original.priority || '—'}</span>;
      },
    },
    {
      id: 'posted', header: 'Posted', accessorFn: (n) => (n.created_at ? new Date(n.created_at).getTime() : 0), meta: { width: 200 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="tabular">{fmtDateTime(row.original.created_at)}</span>
          <span className="cell-secondary">By {row.original.created_by || '—'}</span>
        </span>
      ),
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => (
        <button type="button" className="icon-btn row-action" aria-label={`Delete notice ${row.original.title}`} onClick={() => setDeleteTarget(row.original)}>
          <Trash2 size={16} aria-hidden="true" />
        </button>
      ),
    },
  ], []);

  const openForm = () => setShowForm(true);
  const newNoticeButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={openForm}>
      <Plus size={16} aria-hidden="true" /> New notice
    </button>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Notices"
          description="Department announcements and internal circulars for the notice board."
          actions={newNoticeButton}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search notices</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, message or department" />
            </label>
            <div className="segmented" role="tablist" aria-label="Filter by priority">
              <button type="button" role="tab" aria-selected={!priorityFilter} className={!priorityFilter ? 'is-active' : ''} onClick={() => setPriorityFilter('')}>
                All <span className="seg-count">{counts.all}</span>
              </button>
              {PRIORITIES.map((p) => (
                <button key={p.value} type="button" role="tab" aria-selected={priorityFilter === p.value} className={priorityFilter === p.value ? 'is-active' : ''} onClick={() => setPriorityFilter(p.value)}>
                  {p.label} <span className="seg-count">{counts[p.value]}</span>
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(n) => String(n.id)}
            initialSorting={[{ id: 'posted', desc: true }]}
            empty={list.length > 0 ? (
              <EmptyState icon={Search} title="No notices match" description="Clear the search or pick another priority." />
            ) : (
              <EmptyState
                icon={Megaphone}
                title="No notices yet"
                description="Publish a notice to share announcements with departments across the hospital."
                action={newNoticeButton}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="New notice"
        description="Published notices are visible to the selected department."
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="notice-form" className="btn btn-primary btn-md">Publish notice</button>
          </>
        )}
      >
        <form id="notice-form" onSubmit={(e) => { e.preventDefault(); create(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="notice-title">Title</label>
            <input id="notice-title" className="form-input" aria-required="true" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. OPD timing change" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="notice-message">Message</label>
            <textarea id="notice-message" className="form-textarea" aria-required="true" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={4} />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="notice-dept">Department</label>
              <select id="notice-dept" className="form-select" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="notice-priority">Priority</label>
              <select id="notice-priority" className="form-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete this notice?"
        description={deleteTarget ? `"${deleteTarget.title}" will be removed from the notice board.` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setDeleteTarget(null)}>Keep notice</button>
            <button type="button" className="btn btn-danger btn-md" disabled={deleting} onClick={() => remove(deleteTarget.id)}>
              {deleting ? 'Deleting…' : 'Delete notice'}
            </button>
          </>
        )}
      >
        <p className="muted">This cannot be undone.</p>
      </Modal>
    </>
  );
}
