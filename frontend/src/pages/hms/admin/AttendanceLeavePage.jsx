import { useState, useEffect } from 'react';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

export default function AttendanceLeavePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('roster');

  const load = () => {
    setLoading(true);
    api.get('/admin/attendance')
      .then(r => setData(r.data.data))
      .catch(() => toast.error('Failed to load attendance'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleLeave = async (id, status) => {
    try {
      await api.put(`/admin/attendance/leave/${id}`, { status });
      toast.success(`Leave ${status.toLowerCase()}`);
      load();
    } catch { toast.error('Failed'); }
  };

  const leaveColor = { Pending: 'amber', Approved: 'green', Rejected: 'red' };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(20,184,166,0.1)', borderColor: 'rgba(20,184,166,0.25)' }}>📝</span>
              Attendance & Leave
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Staff rosters, leave requests, and daily attendance tracking
            </p>
          </div>
        </div>

        {/* KPI Cards */}
        {data && (
          <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 30 }}>
            {[
              { icon: '👥', label: 'Total Staff', value: data.total_staff, color: 'var(--blue)' },
              { icon: '✅', label: 'Present Today', value: data.present_count, color: 'var(--green)' },
              { icon: '❌', label: 'Absent Today', value: data.absent_count, color: data.absent_count > 0 ? '#ef4444' : 'var(--green)' },
              { icon: '📋', label: 'Pending Leaves', value: data.leave_requests?.filter(l => l.status === 'Pending').length || 0, color: 'var(--amber)' },
            ].map((k, i) => (
              <div key={k.label} className={`hms-stat-card anim-${i + 1}`} style={{ borderTop: `4px solid ${k.color}`, padding: '20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: `${k.color}15`, color: k.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.5rem',
                }}>
                  {k.icon}
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{k.label}</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>{k.value}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="hms-anim-3" style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'var(--surface-2)', padding: 6, borderRadius: 12, width: 'fit-content' }}>
          {[{ id: 'roster', label: '📋 Daily Roster' }, { id: 'leave', label: '📝 Leave Requests' }].map(t => (
            <button 
              key={t.id} 
              className={`btn ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`} 
              style={{ padding: '8px 20px', borderRadius: 8, transition: 'all 0.2s' }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
        ) : (
          <div className="card hms-anim-4" style={{ padding: 24 }}>
            {tab === 'roster' ? (
              <>
                <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2rem' }}>✅</span> Staff Present Today
                </h3>
                <div className="table-wrapper hms-table-anim" style={{ maxHeight: 500, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Name</th><th>Role</th><th>Login Time</th><th>Status</th></tr></thead>
                    <tbody>
                      {(data?.present || []).map((s, i) => (
                        <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.NAME}</td>
                          <td><span className="badge badge-blue" style={{ textTransform: 'capitalize', padding: '4px 10px' }}>{s.ROLE?.replace(/_/g, ' ')}</span></td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {s.LAST_LOGIN ? new Date(s.LAST_LOGIN).toLocaleTimeString('en-IN') : '—'}
                          </td>
                          <td><span className="badge badge-green" style={{ padding: '4px 10px' }}>Present</span></td>
                        </tr>
                      ))}
                      {(data?.present || []).length === 0 && (
                        <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No staff logged in today yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1.2rem' }}>📝</span> Leave Requests
                </h3>
                <div className="table-wrapper hms-table-anim">
                  <table>
                    <thead><tr><th>Staff</th><th>Role</th><th>Type</th><th>Period</th><th>Days</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {(data?.leave_requests || []).map((lr, i) => (
                        <tr key={lr.id} style={{ animationDelay: `${i * 0.05}s` }}>
                          <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lr.staff_name}</td>
                          <td><span className="badge badge-blue" style={{ textTransform: 'capitalize', padding: '4px 10px' }}>{lr.role?.replace(/_/g, ' ')}</span></td>
                          <td><span style={{ fontWeight: 500 }}>{lr.type}</span></td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{lr.from} → {lr.to}</td>
                          <td style={{ fontWeight: 700 }}>{lr.days}</td>
                          <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{lr.reason}</td>
                          <td><span className={`badge badge-${leaveColor[lr.status] || 'blue'}`} style={{ padding: '4px 10px' }}>{lr.status}</span></td>
                          <td>
                            {lr.status === 'Pending' ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className="btn btn-sm" style={{ background: '#10b981', color: 'white', border: 'none', width: 32, height: 32, padding: 0, borderRadius: 6 }} onClick={() => handleLeave(lr.id, 'Approved')}>✓</button>
                                <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#ef4444', border: 'none', width: 32, height: 32, padding: 0, borderRadius: 6 }} onClick={() => handleLeave(lr.id, 'Rejected')}>✕</button>
                              </div>
                            ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Resolved</span>}
                          </td>
                        </tr>
                      ))}
                      {(data?.leave_requests || []).length === 0 && (
                        <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>No leave requests pending</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
