import { useState, useEffect, useMemo } from 'react';
import { Check, X, UserCheck, CalendarOff, RefreshCw } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

const LEAVE_TONE = { Pending: 'warning', Approved: 'success', Rejected: 'danger' };
const roleLabel = (r) => {
  const s = String(r || '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
};
const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');

export default function AttendanceLeavePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('roster');

  const load = () => {
    setLoading(true);
    api.get('/admin/attendance')
      .then((r) => setData(r.data.data))
      .catch(() => toast.error('Failed to load attendance'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleLeave = async (id, status) => {
    try {
      await api.put(`/admin/attendance/leave/${id}`, { status });
      toast.success(`Leave ${status.toLowerCase()}`);
      load();
    } catch { toast.error('Failed to update leave request'); }
  };

  const present = data?.present || [];
  const leaves = data?.leave_requests || [];
  const pendingLeaves = leaves.filter((l) => l.status === 'Pending').length;

  const rosterColumns = useMemo(() => [
    {
      id: 'name', header: 'Name', accessorFn: (s) => s.NAME || '',
      cell: ({ row }) => (
        <span className="cell-person">
          <span className="cell-avatar" aria-hidden="true">{(row.original.NAME || '?').charAt(0).toUpperCase()}</span>
          <span className="cell-primary">{row.original.NAME || '—'}</span>
        </span>
      ),
    },
    { id: 'role', header: 'Role', accessorFn: (s) => roleLabel(s.ROLE), meta: { width: 180 } },
    {
      id: 'login', header: 'Signed in at', accessorFn: (s) => (s.LAST_LOGIN ? new Date(s.LAST_LOGIN).getTime() : 0), meta: { width: 150 },
      cell: ({ row }) => <span className="tabular">{fmtTime(row.original.LAST_LOGIN)}</span>,
    },
    { id: 'status', header: 'Status', enableSorting: false, meta: { width: 120 }, cell: () => <span className="status status-success">Present</span> },
  ], []);

  const leaveColumns = useMemo(() => [
    {
      id: 'staff', header: 'Staff', accessorFn: (l) => l.staff_name || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.staff_name}</span>
          <span className="cell-secondary">{roleLabel(row.original.role)}</span>
        </span>
      ),
    },
    { id: 'type', header: 'Type', accessorFn: (l) => l.type || '', meta: { width: 140 } },
    {
      id: 'period', header: 'Period', accessorFn: (l) => l.from || '', meta: { width: 210 },
      cell: ({ row }) => <span className="tabular">{row.original.from} – {row.original.to}</span>,
    },
    { id: 'days', header: 'Days', accessorFn: (l) => Number(l.days) || 0, meta: { width: 80, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
    {
      id: 'reason', header: 'Reason', accessorFn: (l) => l.reason || '', enableSorting: false,
      cell: ({ getValue }) => <span style={{ color: 'var(--text-secondary)' }}>{getValue() || '—'}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (l) => l.status || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status status-${LEAVE_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 200, align: 'right' },
      cell: ({ row }) => {
        const lr = row.original;
        if (lr.status !== 'Pending') return <span className="muted">Resolved</span>;
        return (
          <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleLeave(lr.id, 'Approved')} aria-label={`Approve leave for ${lr.staff_name}`}>
              <Check size={14} aria-hidden="true" /> Approve
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => handleLeave(lr.id, 'Rejected')} aria-label={`Reject leave for ${lr.staff_name}`}>
              <X size={14} aria-hidden="true" /> Reject
            </button>
          </span>
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
          title="Attendance and leave"
          description="Who is on duty today, and staff leave requests waiting for a decision."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={load} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        {data && (
          <div className="kpi-strip">
            <div className="panel kpi"><div className="kpi-label">Total staff</div><div className="kpi-value">{data.total_staff}</div></div>
            <div className="panel kpi"><div className="kpi-label">Present today</div><div className="kpi-value">{data.present_count}</div></div>
            <div className="panel kpi">
              <div className="kpi-label">Absent today</div>
              <div className="kpi-value" style={{ color: data.absent_count > 0 ? 'var(--amber)' : undefined }}>{data.absent_count}</div>
            </div>
            <div className="panel kpi">
              <div className="kpi-label">Pending leave</div>
              <div className="kpi-value" style={{ color: pendingLeaves > 0 ? 'var(--amber)' : undefined }}>{pendingLeaves}</div>
            </div>
          </div>
        )}

        <section className="panel">
          <div className="tabs" role="tablist" aria-label="Attendance sections">
            <button type="button" role="tab" id="tab-roster" aria-selected={tab === 'roster'} aria-controls="panel-roster" className={`tab${tab === 'roster' ? ' is-active' : ''}`} onClick={() => setTab('roster')}>
              <UserCheck size={16} aria-hidden="true" /> Daily roster
            </button>
            <button type="button" role="tab" id="tab-leave" aria-selected={tab === 'leave'} aria-controls="panel-leave" className={`tab${tab === 'leave' ? ' is-active' : ''}`} onClick={() => setTab('leave')}>
              <CalendarOff size={16} aria-hidden="true" /> Leave requests
              {pendingLeaves > 0 && <span className="seg-count">{pendingLeaves}</span>}
            </button>
          </div>

          {tab === 'roster' ? (
            <div role="tabpanel" id="panel-roster" aria-labelledby="tab-roster">
              <DataTable
                columns={rosterColumns}
                data={present}
                loading={loading}
                getRowId={(s, i) => String(s.ID ?? i)}
                initialSorting={[{ id: 'login', desc: true }]}
                empty={<EmptyState icon={UserCheck} title="No staff signed in yet" description="Staff appear here once they sign in today." />}
              />
            </div>
          ) : (
            <div role="tabpanel" id="panel-leave" aria-labelledby="tab-leave">
              <DataTable
                columns={leaveColumns}
                data={leaves}
                loading={loading}
                getRowId={(l, i) => String(l.id ?? i)}
                empty={<EmptyState icon={CalendarOff} title="No leave requests" description="Leave requests from staff appear here." />}
              />
            </div>
          )}
        </section>
      </main>
    </>
  );
}
