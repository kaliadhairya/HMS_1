import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';

import api from '../api/axios';

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState('add'); // 'add' or 'edit'
  const [formData, setFormData] = useState({ id: null, username: '', password: '', name: '', role: 'lab_technician', isActive: 1 });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/users');
      if (res.data.success) {
        setUsers(res.data.data);
      } else {
        toast.error(res.data.message || 'Failed to fetch users');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setModalMode('add');
    setFormData({ id: null, username: '', password: '', name: '', role: 'lab_technician', isActive: 1 });
    setShowModal(true);
  };

  const openEditModal = (u) => {
    setModalMode('edit');
    setFormData({ id: u.id, username: u.username, password: '', name: u.name, role: u.role, isActive: u.isActive });
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      const url = modalMode === 'add' ? '/users' : `/users/${formData.id}`;
      const method = modalMode === 'add' ? 'post' : 'put';

      const payload = { ...formData };
      if (modalMode === 'edit' && !payload.password) {
        delete payload.password; // Do not send empty password if editing
      }

      const res = await api[method](url, payload);
      
      if (res.data.success) {
        toast.success(`User ${modalMode === 'add' ? 'created' : 'updated'} successfully`);
        fetchUsers();
        setShowModal(false);
      } else {
        toast.error(res.data.message || 'Action failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection error');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUserStatus = async (userToToggle) => {
    if (userToToggle.id === user.id) {
       toast.error("You cannot deactivate your own account.");
       return;
    }

    try {
      const newStatus = userToToggle.isActive ? 0 : 1;
      const res = await api.put(`/users/${userToToggle.id}`, { isActive: newStatus });
      
      if (res.data.success) {
        toast.success(`User ${newStatus ? 'activated' : 'deactivated'}`);
        fetchUsers();
      } else {
        toast.error(res.data.message || 'Action failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection error');
    }
  };

  const handleDelete = async (userId) => {
    if (userId === user.id) {
       toast.error("You cannot delete your own account.");
       return;
    }

    if (!window.confirm("Are you sure you want to permanently delete this user? This may fail if the user has existing reports. Consider deactivating instead.")) return;

    try {
      const res = await api.delete(`/users/${userId}`);
      
      if (res.data.success) {
        toast.success('User deleted permanently');
        fetchUsers();
      } else {
        toast.error(res.data.message || 'Action failed');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Connection error');
    }
  };

  return (
    <>
    <Navbar />
    <div className="page-wrapper">
      <div className="page-header fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 14 }}>
        <div>
          <h1>User Management</h1>
          <p>Admin panel to add, modify, and deactivate system access.</p>
        </div>
        <button className="btn btn-primary" onClick={openAddModal}>
          + Create New User
        </button>
      </div>

      <div className="card fade-up-2">
        <div className="table-wrapper">
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto 14px auto' }} />
              <div style={{ color: 'var(--text-secondary)' }}>Loading users...</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.6 }}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>#{u.id}</td>
                    <td style={{ fontWeight: 500 }}>{u.name} {user.id === u.id && <span style={{fontSize:'0.7rem', color:'var(--text-muted)'}}>(You)</span>}</td>
                    <td><span style={{ fontFamily: 'monospace', color: 'var(--teal)' }}>{u.username}</span></td>
                    <td>
                       <span className={`badge ${u.role === 'admin' ? 'badge-blue' : u.role === 'doctor' ? 'badge-amber' : 'badge-teal'}`}>
                          {u.role.replace('_', ' ')}
                       </span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'badge-green' : 'badge-red'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleUserStatus(u)}>
                          {u.isActive ? '🚫 Deactivate' : '✅ Activate'}
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditModal(u)}>
                          ✏️ Edit
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u.id)} style={{ padding: '4px 8px' }} title="Hard Delete">
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="6" style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, padding: 20
        }}>
          <div className="card fade-up" style={{ width: '100%', maxWidth: 500, padding: 0, overflow: 'hidden' }}>
            <div style={{ background: 'var(--surface-2)', padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{modalMode === 'add' ? '✨ Create New User' : '✏️ Edit User'}</h3>
              <button 
                onClick={handleCloseModal} 
                style={{ background:'none', border:'none', fontSize:'1.2rem', color:'var(--text-muted)', cursor:'pointer' }}
              >×</button>
            </div>
            
            <form onSubmit={handleSubmit} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input 
                  type="text" className="form-input" 
                  value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  required placeholder="e.g. Jane Doe"
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Username</label>
                <input 
                  type="text" className="form-input" 
                  value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})}
                  required placeholder="e.g. janedoe1"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Role</label>
                <select 
                  className="form-select" 
                  value={formData.role} 
                  onChange={e => setFormData({...formData, role: e.target.value})}
                >
                  <option value="lab_technician">Lab Technician</option>
                  <option value="doctor">Doctor</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="form-label">Password</label>
                  {modalMode === 'edit' && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Leave blank to keep unchanged</span>}
                </div>
                <input 
                  type="password" className="form-input" 
                  value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                  required={modalMode === 'add'} placeholder={modalMode === 'add' ? "Enter new password" : "••••••••"}
                />
              </div>

              {/* Status Toggle For Edit */}
              {modalMode === 'edit' && (
                <div className="form-group" style={{ marginTop: 8 }}>
                   <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                     <input 
                       type="checkbox" 
                       checked={formData.isActive === 1} 
                       onChange={(e) => setFormData({...formData, isActive: e.target.checked ? 1 : 0})}
                       style={{ width: 16, height: 16, accentColor: 'var(--green)' }}
                     />
                     Account is Active
                   </label>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button type="button" className="btn btn-ghost btn-full" onClick={handleCloseModal}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-full" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
