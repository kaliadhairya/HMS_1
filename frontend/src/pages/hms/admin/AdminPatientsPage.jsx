import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';

export default function AdminPatientsPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/dashboard/admin-ops').catch(() => ({ data: { data: {} } })),
      api.get(`/patients/search?q=${search}&page=${page}&limit=20`).catch(() => ({ data: { data: { patients: [] } } })),
    ]).then(([statsRes, pRes]) => {
      setStats(statsRes.data.data);
      setPatients(pRes.data.data?.patients || pRes.data.data || []);
    }).finally(() => setLoading(false));
  }, [search, page]);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Premium Header */}
        <div className="hms-page-header hms-anim-1">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.25)' }}>🏥</span>
              Patient Overview
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Admissions, discharges, patient flow — operational oversight without clinical access
            </p>
          </div>
        </div>

        {/* KPIs */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginBottom: 30 }}>
          {[
            { icon: '🏥', label: 'OPD Today', value: stats?.opd_count || 0, color: 'var(--blue)' },
            { icon: '🛏️', label: 'IPD Admitted', value: stats?.ipd_count || 0, color: 'var(--green)' },
            { icon: '📋', label: 'Pending Discharges', value: stats?.pending_discharges || 0, color: 'var(--amber)' },
            { icon: '📊', label: 'Bed Occupancy', value: `${stats?.bed_occupancy || 0}%`, color: 'var(--teal)' },
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

        {/* Search & Actions */}
        <div className="card hms-anim-3" style={{ padding: 20, marginBottom: 30, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}>🔍</span>
            <input 
              className="form-input" 
              style={{ width: '100%', paddingLeft: 42, paddingRight: 16, fontSize: '0.95rem' }} 
              placeholder="Search patients by name, UHID, phone..." 
              value={search} 
              onChange={e => { setSearch(e.target.value); setPage(1); }} 
            />
          </div>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/ipd/beds')} style={{ padding: '0 24px' }}>
            🛏️ Bed Management
          </button>
        </div>

        {/* Recent Admissions */}
        <div className="card hms-anim-4" style={{ padding: 24 }}>
          <h3 style={{ marginBottom: 20, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '1.2rem' }}>📋</span> Recent Admissions
          </h3>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ maxHeight: 500, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr><th>Patient</th><th>Ward</th><th>Bed</th><th>Status</th><th>Date</th></tr>
                </thead>
                <tbody>
                  {(stats?.recent_admissions || []).map((a, i) => (
                    <tr key={i} style={{ animationDelay: `${i * 0.05}s` }}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.PATIENT_NAME || '—'}</td>
                      <td>{a.WARD_NAME || '—'}</td>
                      <td>{a.BED_NUMBER || '—'}</td>
                      <td>
                        <span className={`badge ${a.STATUS === 'Admitted' ? 'badge-green' : a.STATUS === 'Discharge Pending' ? 'badge-amber' : 'badge-blue'}`} style={{ padding: '4px 10px' }}>
                          {a.STATUS}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {a.ADMISSION_DATE ? new Date(a.ADMISSION_DATE).toLocaleString('en-IN') : '—'}
                      </td>
                    </tr>
                  ))}
                  {(!stats?.recent_admissions || stats.recent_admissions.length === 0) && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 30 }}>No recent admissions found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
