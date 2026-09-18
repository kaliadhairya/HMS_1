import { useEffect, useState } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

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

  const loadSuppliers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/suppliers/all');
      setSuppliers(res.data.data || []);
    } catch (err) {
      toast.error('Failed to load suppliers.');
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
      toast.error('Supplier name is required.');
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        await api.put(`/suppliers/${editingId}`, form);
        toast.success('Supplier updated.');
      } else {
        await api.post('/suppliers', form);
        toast.success('Supplier created.');
      }
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
      await loadSuppliers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save supplier.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>🏭 Supplier Master</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Manage vendor directory and procurement contacts.</p>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Supplier</button>
        </div>

        {showForm && (
          <form className="card fade-up" style={{ padding: 24, marginBottom: 24 }} onSubmit={handleSubmit}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>{editingId ? 'Edit Supplier' : 'New Supplier'}</h3>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowForm(false)}>Close</button>
            </div>
            <div className="form-grid-2" style={{ marginBottom: 16 }}>
              <input className="form-input" placeholder="Supplier name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input className="form-input" placeholder="Contact person" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
              <input className="form-input" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              <input className="form-input" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="form-input" placeholder="GSTIN" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} />
              <select className="form-input" value={String(form.isActive)} onChange={(e) => setForm({ ...form, isActive: Number(e.target.value) })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
            <textarea className="form-input" placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={3} style={{ width: '100%', marginBottom: 16 }} />
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Supplier'}</button>
          </form>
        )}

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 24 }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Supplier Number</th>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>GSTIN</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => (
                    <tr key={supplier.id}>
                      <td><strong>{supplier.id}</strong></td>
                      <td><span className="badge badge-blue">{supplier.supplierNumber || '-'}</span></td>
                      <td style={{ fontWeight: 600 }}>{supplier.name}</td>
                      <td>{supplier.contactPerson || '-'}</td>
                      <td>{supplier.phone || '-'}</td>
                      <td>{supplier.email || '-'}</td>
                      <td>{supplier.gstin || '-'}</td>
                      <td>
                        <span className={`badge ${supplier.isActive ? 'badge-green' : 'badge-amber'}`}>
                          {supplier.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline" onClick={() => openEdit(supplier)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {suppliers.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No suppliers registered yet.</div>}
          </div>
        )}
      </div>
    </>
  );
}
