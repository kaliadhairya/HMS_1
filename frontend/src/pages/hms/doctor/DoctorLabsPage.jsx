import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function DoctorLabsPage() {
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');

  useEffect(() => {
    api.get('/doctor/labs')
      .then(res => setLabs(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const pending = labs.filter(l => l.status !== 'Completed');
  const completed = labs.filter(l => l.status === 'Completed');
  const displayed = tab === 'pending' ? pending : completed;

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🔬</span>
              Lab & Diagnostics
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Raise investigation requests and review completed test reports.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary">+ Request Investigation</button>
          </div>
        </div>

        {/* Summary */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #3b82f6', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Total Orders</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{labs.length}</div>
          </div>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #f59e0b', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Pending Review</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b' }}>{pending.length}</div>
          </div>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #10b981', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Completed</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981' }}>{completed.length}</div>
          </div>
        </div>

        {/* Tabs + Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            <button className={`hms-tab-btn ${tab === 'pending' ? 'active' : ''}`}
              onClick={() => setTab('pending')} style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}>
              ⏳ Pending Reviews ({pending.length})
            </button>
            <button className={`hms-tab-btn ${tab === 'completed' ? 'active' : ''}`}
              onClick={() => setTab('completed')} style={{ borderRadius: 0 }}>
              ✅ Completed ({completed.length})
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading lab data...</span>
            </div>
          ) : displayed.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
              <span className="empty-icon">{tab === 'pending' ? '🎉' : '📭'}</span>
              <h3>{tab === 'pending' ? 'All Caught Up!' : 'No Completed Tests'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                {tab === 'pending' ? 'No pending lab reports to review.' : 'No completed investigations yet.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th><th>Request ID</th><th>Patient</th>
                    <th>Investigation</th><th>Priority</th><th>Status</th><th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((lab, idx) => (
                    <tr key={idx}>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{new Date(lab.date).toLocaleDateString()}</td>
                      <td><strong style={{ color: 'var(--blue)' }}>{lab.id}</strong></td>
                      <td style={{ fontWeight: 600 }}>{lab.patient}</td>
                      <td>{lab.test}</td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                          background: lab.priority === 'Urgent' ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.1)',
                          color: lab.priority === 'Urgent' ? '#ef4444' : '#2563eb',
                          border: `1px solid ${lab.priority === 'Urgent' ? 'rgba(239,68,68,0.2)' : 'rgba(59,130,246,0.2)'}`,
                        }}>
                          {lab.priority === 'Urgent' ? '🔴' : '🔵'} {lab.priority}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                          background: lab.status === 'Completed' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                          color: lab.status === 'Completed' ? '#059669' : '#d97706',
                          border: `1px solid ${lab.status === 'Completed' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                        }}>
                          {lab.status}
                        </span>
                      </td>
                      <td>
                        {lab.status === 'Completed' ? (
                          <button className="btn btn-sm btn-primary">Review Report</button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>Awaiting...</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
