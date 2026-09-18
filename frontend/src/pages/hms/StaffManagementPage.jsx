import { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLE_COLORS = {
  doctor: '#60a5fa', nurse: '#f472b6', receptionist: '#a855f7',
  pharmacist: '#2dd4bf', lab_technician: '#34d399',
};

export default function StaffManagementPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editStaffId, setEditStaffId] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '', email: '', role: 'doctor', isActive: true });

  const load = () => {
    setLoading(true);
    api.get('/admin/staff')
      .then(r => setStaff(r.data.data))
      .catch(() => toast.error('Failed to load staff'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const filtered = staff.filter(s => {
    const matchName = !filter || s.NAME?.toLowerCase().includes(filter.toLowerCase()) || s.USERNAME?.toLowerCase().includes(filter.toLowerCase());
    const matchRole = !roleFilter || s.ROLE === roleFilter;
    return matchName && matchRole;
  });

  const openAddModal = () => {
    setEditStaffId(null);
    setForm({ username: '', password: '', name: '', phone: '', email: '', role: 'doctor', isActive: true });
    setShowModal(true);
  };

  const openEditModal = (s) => {
    setEditStaffId(s.ID);
    setForm({ username: s.USERNAME, password: '', name: s.NAME, phone: s.PHONE, email: s.EMAIL, role: s.ROLE, isActive: s.IS_ACTIVE === 1 });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editStaffId) {
        const payload = { ...form, isActive: form.isActive ? 1 : 0 };
        if (!payload.password) delete payload.password; // Don't override hash with blank
        await api.put(`/users/${editStaffId}`, payload);
        toast.success('Staff updated successfully');
      } else {
        if (!form.username || !form.password || !form.name || !form.role) {
          return toast.error('Please fill required fields.');
        }
        await api.post('/users', { ...form, isActive: form.isActive ? 1 : 0 });
        toast.success('Staff added successfully');
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save staff');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you absolutely sure you want to delete this staff member? This cannot be undone.')) return;
    try {
      await api.delete(`/users/${editStaffId}`);
      toast.success('Staff deleted successfully');
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cannot delete staff. Deactivate them instead.');
    }
  };

  const roles = [...new Set(staff.map(s => s.ROLE))];
  const now = new Date();

  return (
    <>
      <Navbar />
      <div className="page-wrapper fade-up">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>👥 Staff Management</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              View and manage operational staff — doctors, nurses, receptionists, pharmacists, lab technicians
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={openAddModal}>➕ Add New Staff</button>
            <span className="badge badge-blue" style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
              {staff.length} Total Staff
            </span>
          </div>
        </div>

        {/* Filters */}
        <div className="card" style={{ padding: 16, marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ margin: 0, flex: 1, minWidth: 200 }}>
            <label className="form-label" style={{ fontSize: '0.7rem' }}>Search</label>
            <input className="form-input" placeholder="Search by name or username..." value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <div className="form-group" style={{ margin: 0, minWidth: 160 }}>
            <label className="form-label" style={{ fontSize: '0.7rem' }}>Role</label>
            <select className="form-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
              <option value="">All Roles</option>
              {roles.map(r => <option key={r} value={r}>{r?.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <button className="btn btn-outline" onClick={() => { setFilter(''); setRoleFilter(''); }}>Clear</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const isLocked = s.LOCKED_UNTIL && new Date(s.LOCKED_UNTIL) > now;
                  const lastLogin = s.LAST_LOGIN ? new Date(s.LAST_LOGIN) : null;
                  const isRecent = lastLogin && (now - lastLogin < 8 * 3600000);

                  return (
                    <tr key={s.ID} style={{ opacity: s.IS_ACTIVE ? 1 : 0.5 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.NAME}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.USERNAME}</div>
                      </td>
                      <td>
                        <span className="badge" style={{
                          background: `${ROLE_COLORS[s.ROLE] || '#94a3b8'}20`,
                          color: ROLE_COLORS[s.ROLE] || '#94a3b8',
                          border: `1px solid ${ROLE_COLORS[s.ROLE] || '#94a3b8'}40`,
                          textTransform: 'capitalize',
                        }}>{s.ROLE?.replace(/_/g, ' ')}</span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.82rem' }}>{s.PHONE || '—'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.EMAIL || '—'}</div>
                      </td>
                      <td>
                        {isLocked
                          ? <span className="badge badge-red">Locked</span>
                          : s.IS_ACTIVE
                            ? <span className="badge badge-green">Active</span>
                            : <span className="badge" style={{ background: 'var(--surface-3)' }}>Inactive</span>}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                        {lastLogin ? (
                          <>
                            {isRecent && <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', marginRight: 6 }} />}
                            {lastLogin.toLocaleString('en-IN')}
                          </>
                        ) : 'Never'}
                      </td>
                      <td>
                        <button className="btn btn-outline btn-sm" onClick={() => openEditModal(s)}>✏️ Edit</button>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No staff found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setShowModal(false)}>
          <div className="card" style={{ width: 440, maxHeight: '90vh', overflowY: 'auto', padding: 28 }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 20 }}>{editStaffId ? '✏️ Edit Staff' : '➕ Create New Staff'}</h2>
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Username *</label>
                <input className="form-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">{editStaffId ? 'New Password (leave blank to keep current)' : 'Temporary Password *'}</label>
                <input className="form-input" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} {...(!editStaffId && { required: true })} />
              </div>
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Role *</label>
                <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="receptionist">Receptionist</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="lab_technician">Lab Technician</option>
                </select>
              </div>
              <div className="form-grid-2">
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input className="form-input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
              {editStaffId && (
                <div className="form-group" style={{ marginBottom: 4 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
                    <input type="checkbox" checked={form.isActive} onChange={e => setForm(f => ({ ...f, isActive: e.target.checked }))} /> Account is Active
                  </label>
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>{editStaffId ? 'Save Changes' : 'Create Staff'}</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
              {editStaffId && (
                 <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
                   <button type="button" className="btn btn-outline" style={{ color: 'var(--red)', borderColor: 'var(--red)', width: '100%' }} onClick={handleDelete}>
                     🗑️ Delete Staff
                   </button>
                 </div>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
