import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import api from '../api/axios'; // Or standard axios
import axios from 'axios';

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && user.role !== 'lab_technician') {
      if (user.role === 'doctor') navigate('/doctor/dashboard', { replace: true });
      else if (user.role === 'admin' || user.role === 'super_admin') navigate('/admin/dashboard', { replace: true });
      else navigate(`/${user.role}/dashboard`, { replace: true });
      return;
    }

    // Attempt to load from LIMS API
    api.get('/lab/dashboard')
      .then(res => setStats(res.data.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [user, navigate]);

  if (user && user.role !== 'lab_technician') {
    return null;
  }

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <>
      <Navbar />
      <div className="page-wrapper">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 'clamp(1.4rem,3vw,1.9rem)' }}>{greeting()}, <span style={{ color: 'var(--green-mid)' }}>{user?.name?.split(' ')[0]}</span></h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>Laboratory Information Management System (LIMS) Dashboard</p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn" onClick={() => navigate('/lab/samples')}>🩸 Collect Sample</button>
            <button className="btn btn-primary" onClick={() => navigate('/lab/queue')}>🧪 View Test Queue</button>
          </div>
        </div>

        {/* ── LIVE WORKLOAD KPI ────────────────────────────── */}
        {loading ? <div className="spinner" /> : stats && (
          <div className="fade-up-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
            <div className="card" style={{ padding: 20, borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Pending Queue</div>
              <div style={{ fontSize: '2.4rem', fontWeight: 700, color: '#f59e0b', lineHeight: 1 }}>{stats.pendingQueue}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 8 }}>Tests awaiting results</div>
            </div>
            
            <div className="card" style={{ padding: 20, borderLeft: '4px solid #10b981' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Completed Today</div>
              <div style={{ fontSize: '2.4rem', fontWeight: 700, color: '#10b981', lineHeight: 1 }}>{stats.completedToday}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 8 }}>Verified reports generated</div>
            </div>

            <div className="card" style={{ padding: 20, borderLeft: '4px solid #ef4444' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Critical Alerts</div>
              <div style={{ fontSize: '2.4rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>{stats.criticalAlerts}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 8 }}>Values outside reference range</div>
            </div>

            <div className="card" style={{ padding: 20, borderLeft: '4px solid #3b82f6' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>Collection Window</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#3b82f6', lineHeight: 1, marginTop: 4 }}>8:00 - 11:30 AM</div>
              <div style={{ fontSize: '0.8rem', color: '#ef4444', marginTop: 12 }}>{stats.collectionDelayed} samples delayed</div>
            </div>
          </div>
        )}

        {/* ── TODAY'S WORKLOAD BY DEPARTMENT ────────────────── */}
        <div className="card fade-up-3" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20 }}>Workload Distribution (Today)</h3>
          {stats?.testTypes && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              {Object.entries(stats.testTypes).map(([dept, count]) => (
                <div key={dept} style={{ padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'capitalize', marginBottom: 4 }}>{dept}</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{count}</div>
                  <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', marginTop: 8, borderRadius: 2 }}>
                    <div style={{ height: '100%', width: `${Math.min(count, 100)}%`, background: 'var(--green-mid)', borderRadius: 2 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
