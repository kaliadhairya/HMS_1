import { useState, useEffect } from 'react';
import { Activity } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

export default function LabWorkloadPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lab/workload')
      .then(res => setStats(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // testsStarted: samples collected and waiting for a result (now). testsCompleted: results entered today.
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
          title="Workload"
          description="Today's test counts and turnaround for the whole laboratory."
          meta={<span className="status status-neutral">Shift: {loading ? 'Loading…' : (stats?.shift || 'Not available')}</span>}
        />

        {loading ? <p className="muted">Loading…</p> : !stats ? (
          <p className="muted">Workload figures are not available right now.</p>
        ) : (
          <>
            <div className="kpi-strip">
              <div className="panel kpi"><div className="kpi-label">Tests in progress</div><div className="kpi-value tabular">{started}</div></div>
              <div className="panel kpi"><div className="kpi-label">Completed today</div><div className="kpi-value tabular">{completed}</div></div>
              <div className="panel kpi">
                <div className="kpi-label">Average turnaround</div>
                <div className="kpi-value" style={{ color: undefined }}>{stats.avgTat}</div>
                <div className="kpi-sub">Order to authorized result, today. No approved turnaround target configured.</div>
              </div>
              <div className="panel kpi">
                <div className="kpi-label">Abnormal results today</div>
                <div className="kpi-value tabular" style={{ color: Number(stats.abnormalFlagged) > 0 ? 'var(--red)' : undefined }}>{stats.abnormalFlagged}</div>
                <div className="kpi-sub">Outside the reference range</div>
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
