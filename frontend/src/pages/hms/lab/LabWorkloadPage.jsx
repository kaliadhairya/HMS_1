import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
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

  // testsStarted counts tests still in progress; completed tests are counted separately.
  const started = Number(stats?.testsStarted || 0);
  const completed = Number(stats?.testsCompleted || 0);
  const total = started + completed;
  const completionPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const maxCount = Math.max(1, started, completed);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="My workload"
          description={`Daily test counts and shift summary for ${user?.name || 'the lab team'}.`}
          meta={<span className="status status-neutral">Shift: {loading ? 'Loading…' : (stats?.shift || 'Not available')}</span>}
        />

        {loading ? <p className="muted">Loading…</p> : !stats ? (
          <p className="muted">Workload figures are not available right now.</p>
        ) : (
          <>
            <div className="kpi-strip">
              <div className="panel kpi"><div className="kpi-label">Tests in progress</div><div className="kpi-value tabular">{started}</div></div>
              <div className="panel kpi"><div className="kpi-label">Tests completed</div><div className="kpi-value tabular">{completed}</div></div>
              <div className="panel kpi">
                <div className="kpi-label">Average turnaround</div>
                <div className="kpi-value">{stats.avgTat}</div>
                <div className="kpi-sub">Target {stats.targetTat}</div>
              </div>
              <div className="panel kpi">
                <div className="kpi-label">Critical results flagged</div>
                <div className="kpi-value tabular" style={{ color: Number(stats.criticalFlagged) > 0 ? 'var(--red)' : undefined }}>{stats.criticalFlagged}</div>
                <div className="kpi-sub">Needs immediate doctor review</div>
              </div>
            </div>

            <section className="panel panel-pad">
              <h2 className="panel-title"><Activity size={16} aria-hidden="true" /> Shift summary</h2>
              <ul className="bar-list">
                <li>
                  <div className="bar-row"><span>Completion rate</span><strong className="tabular">{completionPct}%</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${completionPct}%` }} /></div>
                </li>
                <li>
                  <div className="bar-row"><span>Completed</span><strong className="tabular">{completed}</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(completed / maxCount) * 100}%` }} /></div>
                </li>
                <li>
                  <div className="bar-row"><span>In progress</span><strong className="tabular">{started}</strong></div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${(started / maxCount) * 100}%` }} /></div>
                </li>
              </ul>
            </section>
          </>
        )}
      </main>
    </>
  );
}
