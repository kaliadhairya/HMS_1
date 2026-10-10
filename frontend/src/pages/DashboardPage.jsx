import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Droplet, FlaskConical, BarChart3 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import api from '../api/axios';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// Laboratory home: live workload for lab technicians.
export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lab/dashboard')
      .then((res) => setStats(res.data.data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  const byDept = useMemo(() => {
    const rows = Object.entries(stats?.testTypes || {}).map(([name, count]) => ({ name, value: Number(count) || 0 }));
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.sort((a, b) => b.value - a.value).map((r) => ({ ...r, pct: (r.value / max) * 100 }));
  }, [stats]);

  const kpi = (v) => (loading ? '—' : (v ?? 0));
  const critical = Number(stats?.criticalAlerts || 0);
  const delayed = Number(stats?.collectionDelayed || 0);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title={`${greeting()}, ${user?.name?.split(' ')[0] || 'there'}`}
          description="Laboratory workload for today."
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/lab/samples')}>
                <Droplet size={16} aria-hidden="true" /> Collect sample
              </button>
              <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/lab/queue')}>
                <FlaskConical size={16} aria-hidden="true" /> Open test queue
              </button>
            </>
          )}
        />

        {critical > 0 && (
          <div className="alert-strip alert-danger" role="status">
            <strong>{critical} critical {critical === 1 ? 'value' : 'values'}</strong> outside the reference range. Review and notify the doctor.
          </div>
        )}

        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Awaiting results</div><div className="kpi-value">{kpi(stats?.pendingQueue)}</div></div>
          <div className="panel kpi"><div className="kpi-label">Reports completed today</div><div className="kpi-value">{kpi(stats?.completedToday)}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Critical values</div>
            <div className="kpi-value" style={{ color: critical ? 'var(--red)' : undefined }}>{kpi(stats?.criticalAlerts)}</div>
          </div>
          <div className="panel kpi">
            <div className="kpi-label">Samples delayed</div>
            <div className="kpi-value" style={{ color: delayed ? 'var(--amber)' : undefined }}>{kpi(stats?.collectionDelayed)}</div>
          </div>
        </div>

        <section className="panel panel-pad">
          <h2 className="panel-title"><BarChart3 size={16} aria-hidden="true" /> Tests by department today</h2>
          {loading ? <p className="muted">Loading…</p> : byDept.length === 0 ? (
            <p className="muted">No tests recorded today.</p>
          ) : (
            <ul className="bar-list">
              {byDept.map((d) => (
                <li key={d.name}>
                  <div className="bar-row"><span style={{ textTransform: 'capitalize' }}>{d.name}</span><strong className="tabular">{d.value}</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${d.pct}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
