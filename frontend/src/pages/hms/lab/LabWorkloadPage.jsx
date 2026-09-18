import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';

export default function LabWorkloadPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    api.get('/lab/workload')
      .then(res => setStats(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📈 My Workload</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Personal daily stats and shift summary for {user?.name || 'Lab Tech'}.</p>
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'right' }}>Active Shift</div>
            <div style={{ fontWeight: 600, background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)' }}>
              {stats?.shift || 'Loading...'}
            </div>
          </div>
        </div>

        {loading ? <div className="spinner" /> : stats && (
          <div className="fade-up-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            
            {/* Shift Summary */}
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>Shift Summary</h3>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tests Started</div>
                  <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--blue)' }}>{stats.testsStarted}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tests Completed</div>
                  <div style={{ fontSize: '2rem', fontWeight: 600, color: 'var(--green)' }}>{stats.testsCompleted}</div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Completion Rate</span>
                  <span>{Math.round((stats.testsCompleted / stats.testsStarted) * 100)}%</span>
                </div>
                <div style={{ width: '100%', height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}>
                  <div style={{ height: '100%', width: `${(stats.testsCompleted / stats.testsStarted) * 100}%`, background: 'var(--green-mid)', borderRadius: 4 }} />
                </div>
              </div>
            </div>

            {/* Performance */}
            <div className="card" style={{ padding: 24 }}>
              <h3 style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>Performance Metrics</h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                    ⏱️
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Average Turnaround Time (TAT)</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{stats.avgTat}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target: {stats.targetTat}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>
                    ⚠️
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Critical Results Flagged</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 600 }}>{stats.criticalFlagged}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Requires immediate doctor review</div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </>
  );
}
