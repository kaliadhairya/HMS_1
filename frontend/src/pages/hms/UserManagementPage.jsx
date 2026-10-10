import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Search, Pencil, Lock, LockOpen, History, Users } from 'lucide-react';
import Navbar from '../../components/Navbar';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import RowMenu from '../../components/ui/RowMenu';
import api from '../../api/axios';

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];
const ROLE_LABEL = {
  super_admin: 'Super admin', admin: 'Administrator', doctor: 'Doctor', lab_technician: 'Lab technician',
  receptionist: 'Receptionist', pharmacist: 'Pharmacist', nurse: 'Nurse',
};
const ROLE_TONE = { super_admin: 'danger', admin: 'warning', doctor: 'info' };
const EMPTY_FORM = { username: '', name: '', first_name: '', last_name: '', phone: '', role: 'lab_technician', password: '' };

const fullName = (u) => (u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.name || u.username);
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export default function UserManagementPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historyUser, setHistoryUser] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchUsers = () => {
    setLoading(true);
    api.get('/users')
      .then((res) => setUsers(res.data.data || []))
      .catch(() => toast.error('Could not load users'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const openAddModal = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
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
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user) => {
    try {
      const { data } = await api.patch(`/users/${user.id}/toggle-active`);
      toast.success(data.message);
      fetchUsers();
    } catch {
      toast.error('Failed to change status');
    }
  };

  const viewHistory = async (user) => {
    setHistoryUser(user);
    setLoginHistory([]);
    setHistoryLoading(true);
    try {
      const { data } = await api.get(`/users/${user.id}/login-history`);
      setLoginHistory(data.data || []);
    } catch {
      setLoginHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (!q) return true;
      return [fullName(u), u.username, u.phone].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [users, query, roleFilter]);

  const activeCount = users.filter((u) => u.isActive).length;

  const columns = useMemo(() => [
    {
      id: 'user', header: 'User', accessorFn: (u) => fullName(u),
      cell: ({ row }) => {
        const u = row.original;
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{fullName(u).charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{fullName(u)}</span>
              <span className="cell-secondary mono">{u.username}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'role', header: 'Role', accessorFn: (u) => ROLE_LABEL[u.role] || u.role, meta: { width: 170 },
      cell: ({ row }) => <span className={`status status-${ROLE_TONE[row.original.role] || 'neutral'}`}>{ROLE_LABEL[row.original.role] || row.original.role}</span>,
    },
    { id: 'phone', header: 'Phone', accessorFn: (u) => u.phone || '', meta: { width: 150 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: (u) => (u.isActive ? 'Active' : 'Inactive'), meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Active' ? 'status-success' : 'status-neutral'}`}>{getValue()}</span>,
    },
    {
      id: 'lastLogin', header: 'Last sign-in', accessorFn: (u) => (u.last_login ? new Date(u.last_login).getTime() : 0), meta: { width: 190 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDateTime(row.original.last_login)}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => {
        const u = row.original;
        return (
          <RowMenu
            label={`Actions for ${fullName(u)}`}
            items={[
              { label: 'Edit user', icon: Pencil, onSelect: () => openEditModal(u) },
              { label: 'Sign-in history', icon: History, onSelect: () => viewHistory(u) },
              { label: u.isActive ? 'Deactivate' : 'Activate', icon: u.isActive ? Lock : LockOpen, onSelect: () => toggleActive(u), danger: u.isActive, separator: true },
            ]}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Users & access"
          description="Staff accounts that can sign in to HMS, and the role each one has."
          meta={!loading && <span className="muted">{users.length} accounts · {activeCount} active</span>}
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={openAddModal}>
              <UserPlus size={16} aria-hidden="true" /> Add user
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search users</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, username or phone" />
            </label>
            <label className="sr-only" htmlFor="role-filter">Filter by role</label>
            <select id="role-filter" className="form-select" style={{ width: 200 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(u) => String(u.id)}
            onRowClick={openEditModal}
            rowLabel={(u) => `Edit ${fullName(u)}`}
            initialSorting={[{ id: 'user', desc: false }]}
            empty={users.length > 0 ? (
              <EmptyState icon={Search} title="No users match" description="Try another name, or clear the role filter." />
            ) : (
              <EmptyState
                icon={Users}
                title="No users yet"
                description="Create an account for each member of staff who needs to sign in."
                action={<button type="button" className="btn btn-primary btn-md" onClick={openAddModal}><UserPlus size={16} aria-hidden="true" /> Add user</button>}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editUser ? `Edit ${fullName(editUser)}` : 'Add user'}
        description={editUser ? 'Change details or role. Leave the password blank to keep the current one.' : 'The user signs in with this username and password.'}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" form="user-form" className="btn btn-primary btn-md" disabled={saving}>
              {saving ? 'Saving…' : editUser ? 'Save changes' : 'Create user'}
            </button>
          </>
        )}
      >
        <form id="user-form" onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="u-username">Username</label>
              <input id="u-username" className="form-input" autoComplete="off" value={form.username} onChange={(e) => setField('username', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="u-role">Role</label>
              <select id="u-role" className="form-select" value={form.role} onChange={(e) => setField('role', e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="u-name">Display name</label>
            <input id="u-name" className="form-input" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="u-first">First name</label>
              <input id="u-first" className="form-input" value={form.first_name} onChange={(e) => setField('first_name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="u-last">Last name</label>
              <input id="u-last" className="form-input" value={form.last_name} onChange={(e) => setField('last_name', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="u-phone">Phone</label>
            <input id="u-phone" className="form-input" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="u-password">{editUser ? 'New password' : 'Password'}</label>
            <input
              id="u-password" className="form-input" type="password" autoComplete="new-password"
              value={form.password} onChange={(e) => setField('password', e.target.value)} required={!editUser}
            />
            {editUser && <p className="form-hint">Leave blank to keep the current password.</p>}
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(historyUser)}
        onOpenChange={(open) => { if (!open) setHistoryUser(null); }}
        title="Sign-in history"
        description={historyUser ? `${fullName(historyUser)} · ${historyUser.username}` : ''}
        size="lg"
      >
        {historyLoading ? <p className="muted">Loading…</p> : loginHistory.length === 0 ? (
          <p className="muted">No sign-ins recorded for this user.</p>
        ) : (
          <table className="mini-table">
            <thead><tr><th>Event</th><th>IP address</th><th>Time</th></tr></thead>
            <tbody>
              {loginHistory.map((log, i) => (
                <tr key={log.id || i}>
                  <td><span className={`status ${log.action === 'LOGIN' ? 'status-success' : 'status-neutral'}`}>{log.action === 'LOGIN' ? 'Signed in' : log.action === 'LOGOUT' ? 'Signed out' : log.action}</span></td>
                  <td className="mono">{log.ip_address || '—'}</td>
                  <td className="tabular">{fmtDateTime(log.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
    </>
  );
}
