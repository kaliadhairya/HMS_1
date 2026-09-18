import { useState, useEffect } from 'react';
import Navbar from '../../components/Navbar';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [form, setForm] = useState({ username: '', name: '', first_name: '', last_name: '', phone: '', role: 'lab_technician', password: '' });

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users')
      .then(res => setUsers(res.data.data || []))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const openAddModal = () => {
    setEditUser(null);
    setForm({ username: '', name: '', first_name: '', last_name: '', phone: '', role: 'lab_technician', password: '' });
    setShowModal(true);
  };

  const openEditModal = (user) => {
    setEditUser(user);
    setForm({
      username: user.username, name: user.name,
      first_name: user.first_name || '', last_name: user.last_name || '',
      phone: user.phone || '', role: user.role, password: '',
    });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editUser) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editUser.id}`, payload);
        toast.success('User updated');
      } else {
        await api.post('/users', form);
        toast.success('User created');
      }
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Error saving user');
    }
  };

  const toggleActive = async (id) => {
    try {
      const { data } = await api.patch(`/users/${id}/toggle-active`);
      toast.success(data.message);
      fetchUsers();
    } catch (err) {
      toast.error('Failed to toggle status');
    }
  };

  const viewHistory = async (user) => {
    setHistoryModal(user);
    try {
      const { data } = await api.get(`/users/${user.id}/login-history`);
      setLoginHistory(data.data || []);
    } catch {
      setLoginHistory([]);
    }
  };

  const roleColors = {
    super_admin: 'badge-red', admin: 'badge-amber', doctor: 'badge-blue',
    lab_technician: 'badge-green', receptionist: 'badge-teal', pharmacist: 'badge-blue', nurse: 'badge-green',
  };

  return (
    <>
      <Navbar />
      <div className="page-wrapper">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1>👥 User Management</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 4 }}>Manage system users and their roles.</p>
          </div>
          <button className="btn btn-primary" onClick={openAddModal}>+ Add User</button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" style={{ width: 36, height: 36 }} />
          </div>
        ) : (
          <div className="fade-up-2 table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>
                      {u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.name}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{u.username}</td>
                    <td>
                      <span className={`badge ${roleColors[u.role] || 'badge-blue'}`}>
                        {u.role?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-green' : 'badge-red'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString('en-IN') : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEditModal(u)}>✏️</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(u.id)}>
                          {u.isActive ? '🔒' : '🔓'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => viewHistory(u)}>📋</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit Modal */}
        {showModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }} onClick={() => setShowModal(false)}>
            <div className="card" style={{ width: 440, maxHeight: '85vh', overflowY: 'auto', padding: 28 }}
              onClick={e => e.stopPropagation()}>
              <h2 style={{ marginBottom: 20 }}>{editUser ? '✏️ Edit User' : '➕ Add User'}</h2>
              <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="form-group">
                  <label className="form-label">Username</label>
                  <input className="form-input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Display Name</label>
                  <input className="form-input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">First Name</label>
                    <input className="form-input" value={form.first_name} onChange={e => setForm(f => ({ ...f, first_name: e.target.value }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input className="form-input" value={form.last_name} onChange={e => setForm(f => ({ ...f, last_name: e.target.value }))} />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input className="form-input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Role</label>
                  <select className="form-select" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">{editUser ? 'New Password (leave blank to keep current)' : 'Password'}</label>
                  <input className="form-input" type="password" value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    {...(!editUser && { required: true })} />
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                    {editUser ? 'Save Changes' : 'Create User'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Login History Modal */}
        {historyModal && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }} onClick={() => setHistoryModal(null)}>
            <div className="card" style={{ width: 520, maxHeight: '80vh', overflowY: 'auto', padding: 28 }}
              onClick={e => e.stopPropagation()}>
              <h2 style={{ marginBottom: 16 }}>📋 Login History — {historyModal.name}</h2>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr><th>Action</th><th>IP</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {loginHistory.map((log, i) => (
                      <tr key={i}>
                        <td>
                          <span className={`badge ${log.action === 'LOGIN' ? 'badge-green' : 'badge-red'}`}>
                            {log.action}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem' }}>{log.ip_address || '—'}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))}
                    {loginHistory.length === 0 && (
                      <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>No login history</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <button className="btn btn-ghost btn-full" style={{ marginTop: 16 }} onClick={() => setHistoryModal(null)}>Close</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
