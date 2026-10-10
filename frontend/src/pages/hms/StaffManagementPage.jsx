import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Search, Pencil, Trash2, Users } from 'lucide-react';
import Navbar from '../../components/Navbar';
import PageHeader from '../../components/ui/PageHeader';
import DataTable from '../../components/ui/DataTable';
import EmptyState from '../../components/ui/EmptyState';
import Modal from '../../components/ui/Modal';
import RowMenu from '../../components/ui/RowMenu';
import api from '../../api/axios';

const STAFF_ROLES = ['doctor', 'nurse', 'receptionist', 'pharmacist', 'lab_technician'];
const ROLE_LABEL = {
  doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Receptionist', pharmacist: 'Pharmacist', lab_technician: 'Lab technician',
};
const EMPTY_FORM = { username: '', password: '', name: '', phone: '', role: 'doctor', isActive: true };
const ON_SHIFT_MS = 8 * 3600000;

const isActive = (s) => Number(s.IS_ACTIVE) === 1 || s.IS_ACTIVE === true;
const isLocked = (s) => s.LOCKED_UNTIL && new Date(s.LOCKED_UNTIL) > new Date();
const statusOf = (s) => (isLocked(s) ? 'Locked' : isActive(s) ? 'Active' : 'Inactive');
const STATUS_TONE = { Locked: 'danger', Active: 'success', Inactive: 'neutral' };
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');

export default function StaffManagementPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = () => {
    setLoading(true);
    api.get('/admin/staff')
      .then((r) => setStaff(r.data.data || []))
      .catch(() => toast.error('Failed to load staff'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const openAddModal = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (s) => {
    setEditing(s);
    setForm({ username: s.USERNAME, password: '', name: s.NAME, phone: s.PHONE || '', role: s.ROLE, isActive: isActive(s) });
    setShowModal(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, isActive: form.isActive ? 1 : 0 };
      if (editing) {
        if (!payload.password) delete payload.password;
        await api.put(`/users/${editing.ID}`, payload);
        toast.success('Staff member updated');
      } else {
        await api.post('/users', payload);
        toast.success('Staff member added');
      }
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const target = confirmDelete;
    try {
      await api.delete(`/users/${target.ID}`);
      toast.success(`${target.NAME} removed`);
      setConfirmDelete(null);
      setShowModal(false);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Cannot delete this account. Deactivate it instead.');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return staff.filter((s) => {
      if (roleFilter && s.ROLE !== roleFilter) return false;
      if (!q) return true;
      return [s.NAME, s.USERNAME, s.PHONE].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [staff, query, roleFilter]);

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      active: staff.filter(isActive).length,
      onShift: staff.filter((s) => s.LAST_LOGIN && now - new Date(s.LAST_LOGIN).getTime() < ON_SHIFT_MS).length,
      locked: staff.filter(isLocked).length,
      doctors: staff.filter((s) => s.ROLE === 'doctor' && isActive(s)).length,
    };
  }, [staff]);

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Staff member', accessorFn: (s) => s.NAME || '',
      cell: ({ row }) => {
        const s = row.original;
        return (
          <span className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(s.NAME || '?').replace(/^Dr\.?\s*/i, '').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{s.NAME}</span>
              <span className="cell-secondary mono">{s.USERNAME}</span>
            </span>
          </span>
        );
      },
    },
    {
      id: 'role', header: 'Role', accessorFn: (s) => ROLE_LABEL[s.ROLE] || s.ROLE, meta: { width: 160 },
      cell: ({ getValue }) => <span className="status status-neutral">{getValue()}</span>,
    },
    { id: 'phone', header: 'Phone', accessorFn: (s) => s.PHONE || '', meta: { width: 150 }, cell: ({ getValue }) => <span className="tabular">{getValue() || '—'}</span> },
    {
      id: 'status', header: 'Status', accessorFn: statusOf, meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()]}`}>{getValue()}</span>,
    },
    {
      id: 'lastLogin', header: 'Last sign-in', accessorFn: (s) => (s.LAST_LOGIN ? new Date(s.LAST_LOGIN).getTime() : 0), meta: { width: 170 },
      cell: ({ row }) => <span className="tabular cell-secondary">{fmtDateTime(row.original.LAST_LOGIN)}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => (
        <RowMenu
          label={`Actions for ${row.original.NAME}`}
          items={[
            { label: 'Edit', icon: Pencil, onSelect: () => openEditModal(row.original) },
            { label: 'Delete account', icon: Trash2, onSelect: () => setConfirmDelete(row.original), danger: true, separator: true },
          ]}
        />
      ),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Staff"
          description="Clinical and operational staff: doctors, nurses, front desk, pharmacy and laboratory."
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={openAddModal}>
              <UserPlus size={16} aria-hidden="true" /> Add staff member
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Active staff</div><div className="kpi-value">{loading ? '—' : counts.active}</div></div>
          <div className="panel kpi"><div className="kpi-label">Active doctors</div><div className="kpi-value">{loading ? '—' : counts.doctors}</div></div>
          <div className="panel kpi"><div className="kpi-label">Signed in, last 8 h</div><div className="kpi-value">{loading ? '—' : counts.onShift}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Locked accounts</div>
            <div className="kpi-value" style={{ color: counts.locked ? 'var(--red)' : undefined }}>{loading ? '—' : counts.locked}</div>
          </div>
        </div>

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search staff</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, username or phone" />
            </label>
            <label className="sr-only" htmlFor="staff-role">Filter by role</label>
            <select id="staff-role" className="form-select" style={{ width: 190 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="">All roles</option>
              {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(s) => String(s.ID)}
            onRowClick={openEditModal}
            rowLabel={(s) => `Edit ${s.NAME}`}
            initialSorting={[{ id: 'name', desc: false }]}
            empty={staff.length > 0 ? (
              <EmptyState icon={Search} title="No staff match" description="Try another name, or clear the role filter." />
            ) : (
              <EmptyState
                icon={Users}
                title="No staff yet"
                description="Add doctors, nurses and other staff so they can sign in."
                action={<button type="button" className="btn btn-primary btn-md" onClick={openAddModal}><UserPlus size={16} aria-hidden="true" /> Add staff member</button>}
              />
            )}
          />
        </section>
      </main>

      <Modal
        open={showModal}
        onOpenChange={setShowModal}
        title={editing ? `Edit ${editing.NAME}` : 'Add staff member'}
        description={editing ? 'Leave the password blank to keep the current one.' : 'Give them a temporary password and ask them to change it after first sign-in.'}
        footer={(
          <>
            {editing && (
              <button type="button" className="btn btn-ghost btn-md" style={{ color: 'var(--red)', marginRight: 'auto' }} onClick={() => setConfirmDelete(editing)}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowModal(false)}>Cancel</button>
            <button type="submit" form="staff-form" className="btn btn-primary btn-md" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add staff member'}
            </button>
          </>
        )}
      >
        <form id="staff-form" onSubmit={handleSave} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="s-name">Full name</label>
            <input id="s-name" className="form-input" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="s-role">Role</label>
              <select id="s-role" className="form-select" value={form.role} onChange={(e) => setField('role', e.target.value)} required>
                {STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="s-phone">Phone</label>
              <input id="s-phone" className="form-input" inputMode="tel" value={form.phone} onChange={(e) => setField('phone', e.target.value)} />
            </div>
          </div>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="s-username">Username</label>
              <input id="s-username" className="form-input" autoComplete="off" value={form.username} onChange={(e) => setField('username', e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="s-password">{editing ? 'New password' : 'Temporary password'}</label>
              <input
                id="s-password" className="form-input" type="password" autoComplete="new-password"
                value={form.password} onChange={(e) => setField('password', e.target.value)} required={!editing}
              />
            </div>
          </div>
          {editing && (
            <label className="check-row">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setField('isActive', e.target.checked)} />
              <span>Account is active <span className="form-hint" style={{ display: 'block', marginTop: 0 }}>Inactive accounts cannot sign in.</span></span>
            </label>
          )}
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}
        title="Delete this account?"
        description={confirmDelete ? `${confirmDelete.NAME} (${confirmDelete.USERNAME}) will no longer be able to sign in. This cannot be undone.` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={handleDelete}>Delete account</button>
          </>
        )}
      >
        <p className="muted">If this person has clinical records, deletion is blocked. Deactivate the account instead.</p>
      </Modal>
    </>
  );
}
