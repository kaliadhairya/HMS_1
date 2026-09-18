import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

export default function ReceptionistNotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.get('/receptionist/notifications')
      .then(res => setNotifications(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const markRead = async (id) => {
    try {
      await api.put(`/receptionist/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      toast.error('Failed to update notification.');
    }
  };

  const markAllRead = async () => {
    try {
      await Promise.all(notifications.filter(n => !n.read).map(n => api.put(`/receptionist/notifications/${n.id}/read`)));
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      toast.success('All notifications marked as read.');
    } catch {
      toast.error('Failed to mark all notifications as read.');
    }
  };

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'appointment') return n.type === 'appointment';
    if (filter === 'bill') return n.type === 'bill';
    if (filter === 'ipd') return n.type === 'ipd';
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  const typeConfig = {
    appointment: { icon: '📅', color: '#3b82f6', label: 'Appointment' },
    bill: { icon: '💳', color: '#f59e0b', label: 'Billing' },
    ipd: { icon: '🛏️', color: '#8b5cf6', label: 'IPD' },
  };

  const priorityBorder = {
    high: '#ef4444',
    medium: '#f59e0b',
    low: 'var(--border)',
  };

  const filterTabs = [
    { key: 'all', label: `All (${notifications.length})`, icon: '📋' },
    { key: 'unread', label: `Unread (${unreadCount})`, icon: '🔴' },
    { key: 'appointment', label: 'Appointments', icon: '📅' },
    { key: 'bill', label: 'Billing', icon: '💳' },
    { key: 'ipd', label: 'IPD', icon: '🛏️' },
  ];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon" style={{ position: 'relative' }}>
                🔔
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 18, height: 18, borderRadius: '50%',
                    background: '#ef4444', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    animation: 'pulse-ring 2s infinite',
                    border: '2px solid var(--surface)',
                  }}>
                    {unreadCount}
                  </span>
                )}
              </span>
              Front Desk Alerts
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Appointment reminders, billing follow-ups, and IPD requests.
              {unreadCount > 0 && (
                <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: 6 }}>
                  — {unreadCount} unread
                </span>
              )}
            </p>
          </div>
          {unreadCount > 0 && (
            <div className="header-actions">
              <button className="btn btn-outline" onClick={markAllRead}>
                ✅ Mark All Read
              </button>
            </div>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="hms-anim-2" style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {filterTabs.map((f, i) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                padding: '8px 18px',
                borderRadius: 24,
                border: filter === f.key ? '1.5px solid var(--green-border)' : '1.5px solid var(--border)',
                background: filter === f.key ? 'var(--green-light)' : 'var(--surface)',
                color: filter === f.key ? 'var(--green)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-body)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                animation: `hmsSlideUp 0.4s ${0.1 + i * 0.05}s cubic-bezier(0.16,1,0.3,1) both`,
              }}
              onMouseEnter={e => {
                if (filter !== f.key) {
                  e.currentTarget.style.borderColor = 'var(--green-border)';
                  e.currentTarget.style.background = 'var(--surface-2)';
                }
              }}
              onMouseLeave={e => {
                if (filter !== f.key) {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.background = 'var(--surface)';
                }
              }}
            >
              <span style={{ fontSize: '0.85rem' }}>{f.icon}</span>
              {f.label}
            </button>
          ))}
        </div>

        {/* Notification List */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
            <div className="spinner" style={{ width: 28, height: 28 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading alerts...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="hms-empty-state">
            <span className="empty-icon">🎉</span>
            <h3 style={{ marginBottom: 8 }}>All Caught Up!</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>No notifications match your filter.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((n, i) => {
              const tc = typeConfig[n.type] || { icon: '📌', color: '#6b7280', label: 'General' };
              const borderColor = priorityBorder[n.priority] || 'var(--border)';
              return (
                <div
                  key={n.id}
                  className={`hms-notif-card ${n.read ? 'read' : 'unread'}`}
                  onClick={() => !n.read && markRead(n.id)}
                  style={{
                    borderLeftColor: n.read ? 'var(--border)' : borderColor,
                    animation: `hmsSlideRight 0.45s ${0.05 + i * 0.04}s cubic-bezier(0.16,1,0.3,1) both`,
                  }}
                >
                  <div style={{
                    fontSize: '1.4rem', padding: 12, borderRadius: 12,
                    background: `${tc.color}12`,
                    border: `1px solid ${tc.color}20`,
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {tc.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 12,
                        background: `${tc.color}12`, color: tc.color,
                        border: `1px solid ${tc.color}25`,
                        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em',
                      }}>
                        {tc.label}
                      </span>
                      <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{n.time}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--text-primary)' }}>
                      {n.message}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      {!n.read && (
                        <span style={{
                          fontSize: '0.68rem', padding: '2px 10px',
                          background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                          borderRadius: 12, border: '1px solid rgba(239,68,68,0.2)',
                          fontWeight: 700,
                        }}>
                          ● New
                        </span>
                      )}
                      {(n.type === 'bill' || n.type === 'ipd') && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(n.type === 'bill' ? '/receptionist/billing' : '/receptionist/ipd');
                          }}
                          style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                        >
                          Open →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
