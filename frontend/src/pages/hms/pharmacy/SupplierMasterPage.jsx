import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Factory, Pencil, Plus, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';

const emptyForm = {
  name: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  gstin: '',
  isActive: 1,
};

export default function SupplierMasterPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/suppliers/all');
      setSuppliers(res.data.data || []);
    } catch (err) {
      toast.error('Could not load suppliers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSuppliers();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (supplier) => {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name || '',
      contactPerson: supplier.contactPerson || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      gstin: supplier.gstin || '',
      isActive: supplier.isActive ?? 1,
    });
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Enter the supplier name');
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        await api.put(`/suppliers/${editingId}`, form);
        toast.success('Supplier updated');
      } else {
        await api.post('/suppliers', form);
        toast.success('Supplier added');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadSuppliers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save the supplier');
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const activeCount = suppliers.filter((s) => s.isActive).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (statusFilter === 'active' && !s.isActive) return false;
      if (statusFilter === 'inactive' && s.isActive) return false;
      if (!q) return true;
      return [s.name, s.supplierNumber, s.contactPerson, s.phone, s.email, s.gstin].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [suppliers, query, statusFilter]);

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Supplier', accessorFn: (s) => s.name || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.name}</span>
          <span className="cell-secondary mono">{row.original.supplierNumber || `ID ${row.original.id}`}</span>
        </span>
      ),
    },
    { id: 'contact', header: 'Contact person', accessorFn: (s) => s.contactPerson || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'phone', header: 'Phone', accessorFn: (s) => s.phone || '', meta: { width: 150 },
      cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span>,
    },
    { id: 'email', header: 'Email', accessorFn: (s) => s.email || '', cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'gstin', header: 'GSTIN', accessorFn: (s) => s.gstin || '', meta: { width: 170 },
      cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (s) => (s.isActive ? 'Active' : 'Inactive'), meta: { width: 110 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Active' ? 'status-success' : 'status-neutral'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => (
        <button
          type="button"
          className="icon-btn row-action"
          aria-label={`Edit ${row.original.name}`}
          onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}
        >
          <Pencil size={16} aria-hidden="true" />
        </button>
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const addButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={openCreate}>
      <Plus size={16} aria-hidden="true" /> Add supplier
    </button>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Suppliers"
          description="Vendors the pharmacy buys from, with their procurement contacts."
          meta={!loading && <span className="muted">{suppliers.length} suppliers · {activeCount} active</span>}
          actions={addButton}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search suppliers</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, number, contact, phone or GSTIN" />
            </label>
            <div className="segmented" role="tablist" aria-label="Filter by status">
              {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={statusFilter === key} className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(s) => String(s.id)}
            onRowClick={openEdit}
            rowLabel={(s) => `Edit ${s.name}`}
            initialSorting={[{ id: 'name', desc: false }]}
            empty={suppliers.length > 0 ? (
              <EmptyState icon={Search} title="No suppliers match" description="Try another search, or show all statuses." />
            ) : (
              <EmptyState icon={Factory} title="No suppliers yet" description="Add the vendors you buy medicines from so you can raise indents to them." action={addButton} />
            )}
          />
        </section>
      </main>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title={editingId ? `Edit ${form.name || 'supplier'}` : 'Add supplier'}
        description={editingId ? 'Change contact details or mark the supplier inactive.' : 'A supplier number is assigned automatically when you save.'}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="supplier-form" className="btn btn-primary btn-md" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add supplier'}
            </button>
          </>
        )}
      >
        <form id="supplier-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="sup-name">Supplier name</label>
            <input id="sup-name" className="form-input" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="sup-contact">Contact person</label>
              <input id="sup-contact" className="form-input" value={form.contactPerson} onChange={(e) => setField('contactPerson', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sup-phone">Phone</label>
              <input id="sup-phone" className="form-input" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="sup-email">Email</label>
              <input id="sup-email" className="form-input" inputMode="email" value={form.email} onChange={(e) => setField('email', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="sup-gstin">GSTIN</label>
              <input id="sup-gstin" className="form-input" value={form.gstin} onChange={(e) => setField('gstin', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="sup-address">Address</label>
            <textarea id="sup-address" className="form-textarea" rows={3} value={form.address} onChange={(e) => setField('address', e.target.value)} />
          </div>
          {editingId && (
            <div className="form-group">
              <label className="form-label" htmlFor="sup-status">Status</label>
              <select id="sup-status" className="form-select" value={String(form.isActive)} onChange={(e) => setField('isActive', Number(e.target.value))}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
              <p className="form-hint">Inactive suppliers stay on record but are not offered when raising an indent.</p>
            </div>
          )}
        </form>
      </Modal>
    </>
  );
}
