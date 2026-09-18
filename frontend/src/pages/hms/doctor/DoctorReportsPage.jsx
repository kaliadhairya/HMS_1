import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

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
    { icon: '👨‍⚕️', label: 'Patients Seen (Month)', value: reports.monthly_patients, color: '#3b82f6' },
    { icon: '⏱️', label: 'Avg Consultation Time', value: reports.avg_consultation_time, color: '#10b981' },
    { icon: '💊', label: 'Prescriptions Written', value: reports.prescriptions_written, color: '#8b5cf6' },
    { icon: '🔄', label: 'Referrals Made', value: reports.referrals_made, color: '#f59e0b' },
    { icon: '🛏️', label: 'IPD Admissions', value: reports.ipd_admissions, color: '#ec4899' },
  ] : [];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">📈</span>
              Performance Metrics
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Review your consultation metrics, patient volumes, and clinical activities.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={loadReports}>↻ Refresh</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80, gap: 12 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading metrics...</span>
          </div>
        ) : reports && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 20 }}>
            {metricsCards.map((c, i) => (
              <div key={c.label} className={`hms-stat-card hms-anim-${i + 1}`}
                style={{
                  borderLeft: `5px solid ${c.color}`,
                  padding: 28,
                  cursor: 'default',
                  textAlign: 'center',
                }}
              >
                <div style={{ position: 'absolute', top: -30, right: -30, width: 100, height: 100, borderRadius: '50%', background: `${c.color}06`, pointerEvents: 'none' }} />
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: `${c.color}12`, border: `1px solid ${c.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.6rem', margin: '0 auto 16px',
                }}>
                  {c.icon}
                </div>
                <div style={{
                  fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)',
                  lineHeight: 1, marginBottom: 8,
                  animation: 'hmsCountPop 0.6s 0.4s ease both',
                }}>
                  {c.value}
                </div>
                <div style={{
                  fontSize: '0.72rem', color: 'var(--text-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600,
                }}>
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
