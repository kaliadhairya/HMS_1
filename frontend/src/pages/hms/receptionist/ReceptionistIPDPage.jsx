import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

function BedProgressBar({ pct, barColor }) {
  return (
    <div style={{ height: 7, background: 'var(--surface-3)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${pct}%`, background: barColor,
        borderRadius: 4,
        animation: 'hmsProgressFill 0.8s ease both',
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

export default function ReceptionistIPDPage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ admissions: [], beds: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('admissions');

  useEffect(() => {
    api.get('/receptionist/ipd-admissions')
      .then(res => setData(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const addAdvance = async (admission) => {
    const amountRaw = window.prompt(`Enter advance amount for ${admission.patient}`);
    if (!amountRaw) return;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount.');
      return;
    }

    try {
      await api.post('/billing/advance', {
        patientId: admission.patient_id,
        admissionId: admission.id,
        amount,
        paymentMode: 'Cash',
        notes: 'Collected from receptionist IPD desk',
      });
      toast.success('Advance recorded.');
      const res = await api.get('/receptionist/ipd-admissions');
      setData(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record advance.');
    }
  };

  const totalBeds = data.beds.reduce((s, w) => s + w.total, 0);
  const totalAvail = data.beds.reduce((s, w) => s + w.available, 0);
  const admittedCount = data.admissions.filter(a => a.status === 'Admitted').length;
  const dischargeCount = data.admissions.filter(a => a.status === 'Discharge Pending').length;

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🛏️</span>
              IPD Admission Desk
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              New admissions, bed allotment, advance deposits, and discharge initiation.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/ipd/beds')}>+ New Admission</button>
          </div>
        </div>

        {/* Bed Overview Grid */}
        <div className="hms-anim-2" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 14, marginBottom: 24,
        }}>
          {data.beds.map((w, i) => {
            const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
            const barColor = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
            return (
              <div key={w.ward} className="hms-stat-card" style={{
                padding: 18, cursor: 'default',
                animation: `hmsSlideUp 0.5s ${0.1 + i * 0.06}s cubic-bezier(0.16,1,0.3,1) both`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <strong style={{ fontSize: '0.88rem' }}>{w.ward}</strong>
                  <span style={{
                    padding: '2px 10px', borderRadius: 12,
                    background: `${barColor}15`, color: barColor,
                    fontSize: '0.72rem', fontWeight: 700,
                    border: `1px solid ${barColor}30`,
                  }}>
                    {w.available} free
                  </span>
                </div>
                <BedProgressBar pct={pct} barColor={barColor} />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{w.occupied}/{w.total} occupied</span>
                  <span style={{ fontWeight: 600, color: barColor }}>{pct}%</span>
                </div>
              </div>
            );
          })}
          {/* Total Summary Card */}
          <div className="hms-stat-card hms-anim-4" style={{
            padding: 18,
            borderLeft: '4px solid #8b5cf6',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            cursor: 'default',
          }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 6 }}>
              Total Available
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#8b5cf6' }}>
              {totalAvail} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ {totalBeds}</span>
            </div>
          </div>
        </div>

        {/* Tabs + Table */}
        <div className="card hms-anim-5" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
            <button
              className={`hms-tab-btn ${tab === 'admissions' ? 'active' : ''}`}
              onClick={() => setTab('admissions')}
              style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}
            >
              🏥 Active Admissions ({admittedCount})
            </button>
            <button
              className={`hms-tab-btn ${tab === 'discharge' ? 'active' : ''}`}
              onClick={() => setTab('discharge')}
              style={{ borderRadius: 0 }}
            >
              🚪 Discharge Pending ({dischargeCount})
            </button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading admissions...</span>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Adm. ID</th><th>Patient</th><th>UHID</th>
                    <th>Ward / Bed</th><th>Doctor</th><th>Adm. Date</th>
                    <th>Advance</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.admissions
                    .filter(a => tab === 'admissions' ? a.status === 'Admitted' : a.status === 'Discharge Pending')
                    .map(a => (
                    <tr key={a.id}>
                      <td><strong style={{ color: 'var(--blue)' }}>{a.id}</strong></td>
                      <td style={{ fontWeight: 600 }}>{a.patient}</td>
                      <td style={{ color: 'var(--green)', fontWeight: 500 }}>{a.uhid}</td>
                      <td>{a.ward} / {a.bed}</td>
                      <td>{a.doctor}</td>
                      <td style={{ fontSize: '0.83rem' }}>{new Date(a.admission_date).toLocaleDateString()}</td>
                      <td><span style={{ color: '#10b981', fontWeight: 700 }}>₹ {a.advance_paid?.toLocaleString()}</span></td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20,
                          fontSize: '0.7rem', fontWeight: 700,
                          background: a.status === 'Admitted' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                          color: a.status === 'Admitted' ? '#059669' : '#f59e0b',
                          border: `1px solid ${a.status === 'Admitted' ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'}`,
                        }}>
                          {a.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {a.status === 'Admitted' && (
                            <button className="btn btn-sm btn-outline" onClick={() => addAdvance(a)}>
                              💰 Add Advance
                            </button>
                          )}
                          {a.status === 'Discharge Pending' && (
                            <button className="btn btn-sm btn-primary" onClick={() => navigate(`/ipd/patient/${a.id}`)}>
                              Process Discharge
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.admissions.filter(a => tab === 'admissions' ? a.status === 'Admitted' : a.status === 'Discharge Pending').length === 0 && (
                    <tr>
                      <td colSpan={9}>
                        <div style={{ padding: 40, textAlign: 'center' }}>
                          <span style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }}>
                            {tab === 'admissions' ? '🎉' : '✅'}
                          </span>
                          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                            {tab === 'admissions' ? 'No active admissions.' : 'No pending discharges.'}
                          </p>
                        </div>
                      </td>
                    </tr>
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
