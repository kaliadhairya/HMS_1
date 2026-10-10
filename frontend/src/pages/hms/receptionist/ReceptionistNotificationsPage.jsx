import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Bell, BellOff, CalendarDays, CheckCheck, CreditCard, BedDouble, Pin, ArrowRight, Check } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';

const TYPE_CONFIG = {
  appointment: { icon: CalendarDays, label: 'Appointment' },
  bill: { icon: CreditCard, label: 'Billing' },
  ipd: { icon: BedDouble, label: 'IPD' },
};
const GENERAL = { icon: Pin, label: 'General' };
const PRIORITY = {
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'warning', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
};

export default function ReceptionistNotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.get('/receptionist/notifications')
      .then((res) => setNotifications(res.data.data || []))
      .catch((err) => {
        console.error(err);
        toast.error('Could not load alerts');
      })
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id) => {
    try {
      await api.put(`/receptionist/notifications/${id}/read`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch (err) {
      toast.error('Failed to update notification.');
    }
  };

  const markAllRead = async () => {
    try {
      await Promise.all(notifications.filter((n) => !n.read).map((n) => api.put(`/receptionist/notifications/${n.id}/read`)));
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('All notifications marked as read.');
    } catch {
      toast.error('Failed to mark all notifications as read.');
    }
  };

  const filtered = notifications.filter((n) => {
    if (filter === 'unread') return !n.read;
    if (filter === 'appointment') return n.type === 'appointment';
    if (filter === 'bill') return n.type === 'bill';
    if (filter === 'ipd') return n.type === 'ipd';
    return true;
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filterTabs = [
    { key: 'all', label: 'All', count: notifications.length },
    { key: 'unread', label: 'Unread', count: unreadCount },
    { key: 'appointment', label: 'Appointments', count: notifications.filter((n) => n.type === 'appointment').length },
    { key: 'bill', label: 'Billing', count: notifications.filter((n) => n.type === 'bill').length },
    { key: 'ipd', label: 'IPD', count: notifications.filter((n) => n.type === 'ipd').length },
  ];

  const columns = useMemo(() => [
    {
      id: 'type', header: 'Type', accessorFn: (n) => (TYPE_CONFIG[n.type] || GENERAL).label, meta: { width: 150 },
      cell: ({ row }) => {
        const tc = TYPE_CONFIG[row.original.type] || GENERAL;
        const Icon = tc.icon;
        return <span className="tag" style={{ gap: 6 }}><Icon size={14} aria-hidden="true" /> {tc.label}</span>;
      },
    },
    {
      id: 'message', header: 'Alert', accessorFn: (n) => n.message || '', enableSorting: false,
      cell: ({ row }) => {
        const n = row.original;
        return (
          <span className="cell-stack">
            <span style={{ fontWeight: n.read ? 400 : 600, color: n.read ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{n.message}</span>
            {!n.read && <span className="cell-secondary" style={{ color: 'var(--primary)' }}>New</span>}
          </span>
        );
      },
    },
    {
      id: 'priority', header: 'Priority', accessorFn: (n) => n.priority || '', meta: { width: 110 },
      cell: ({ getValue }) => {
        const p = PRIORITY[getValue()];
        return p ? <span className={`status status-${p.tone}`}>{p.label}</span> : <span className="muted">—</span>;
      },
    },
    { id: 'time', header: 'Time', accessorFn: (n) => n.time || '', meta: { width: 110 }, cell: ({ getValue }) => <span className="tabular cell-secondary">{getValue() || '—'}</span> },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 200, align: 'right' },
      cell: ({ row }) => {
        const n = row.original;
        return (
          <span className="inline-actions">
            {!n.read && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); markRead(n.id); }}>
                <Check size={14} aria-hidden="true" /> Mark read
              </button>
            )}
            {(n.type === 'bill' || n.type === 'ipd') && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(n.type === 'bill' ? '/receptionist/billing' : '/receptionist/ipd');
                }}
              >
                Open <ArrowRight size={14} aria-hidden="true" />
              </button>
            )}
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
          title="Front desk alerts"
          description="Appointment reminders, billing follow-ups and IPD requests."
          meta={!loading && (
            unreadCount > 0
              ? <span className="status status-info">{unreadCount} unread</span>
              : <span className="muted">No unread alerts</span>
          )}
          actions={unreadCount > 0 && (
            <button type="button" className="btn btn-secondary btn-md" onClick={markAllRead}>
              <CheckCheck size={16} aria-hidden="true" /> Mark all as read
            </button>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter alerts">
              {filterTabs.map((f) => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'is-active' : ''} onClick={() => setFilter(f.key)}>
                  {f.label} <span className="seg-count">{f.count}</span>
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(n) => String(n.id)}
            onRowClick={(n) => { if (!n.read) markRead(n.id); }}
            rowLabel={(n) => (n.read ? n.message : `Mark as read: ${n.message}`)}
            pageSize={50}
            empty={notifications.length > 0 ? (
              <EmptyState icon={BellOff} title="Nothing in this view" description="No alerts match this filter." />
            ) : (
              <EmptyState icon={Bell} title="No alerts" description="Appointment reminders, billing follow-ups and IPD requests appear here." />
            )}
          />
        </section>
      </main>
    </>
  );
}
