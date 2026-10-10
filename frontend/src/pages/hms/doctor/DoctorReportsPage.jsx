import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

export default function DoctorReportsPage() {
  const [reports, setReports] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadReports = async () => {
    setLoading(true);
    try {
      const res = await api.get('/doctor/reports');
      setReports(res.data.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReports();
    const handleFocus = () => loadReports();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, []);

  const metricsCards = reports ? [
    { label: 'Patients seen this month', value: reports.monthly_patients },
    { label: 'Average consultation time', value: reports.avg_consultation_time },
    { label: 'Prescriptions written', value: reports.prescriptions_written },
    { label: 'Referrals made', value: reports.referrals_made },
    { label: 'IPD admissions', value: reports.ipd_admissions },
  ] : [];

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Performance metrics"
          description="Your consultation volumes and clinical activity for the current month."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={loadReports} disabled={loading}>
              <RefreshCw size={16} aria-hidden="true" /> {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
        />

        {loading && !reports ? (
          <p className="muted">Loading…</p>
        ) : !reports ? (
          <p className="muted">Metrics are not available right now. Try refreshing.</p>
        ) : (
          <div className="kpi-strip">
            {metricsCards.map((c) => (
              <div key={c.label} className="panel kpi">
                <div className="kpi-label">{c.label}</div>
                <div className="kpi-value">{c.value ?? '—'}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
