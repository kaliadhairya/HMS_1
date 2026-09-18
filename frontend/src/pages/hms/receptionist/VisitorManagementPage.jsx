import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

export default function VisitorManagementPage() {
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ patient: '', ward: '', bed: '', visitor: '', relation: '' });
  const MAX_VISITORS = 5;

  useEffect(() => {
    fetchVisitors();
  }, []);

  const fetchVisitors = () => {
    api.get('/receptionist/visitor-log')
      .then(res => setVisitors(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  const handleIssuePass = async () => {
    if (!form.visitor || !form.patient) return;
    try {
      await api.post('/receptionist/visitor-log', form);
      toast.success('Visitor pass issued.');
      setShowForm(false);
      setForm({ patient: '', ward: '', bed: '', visitor: '', relation: '' });
      fetchVisitors();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to issue visitor pass.');
    }
  };

  const handleCheckout = async (numericId) => {
    try {
      await api.put(`/receptionist/visitor-log/${numericId}/checkout`);
      toast.success('Visitor checked out.');
      fetchVisitors();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to check out visitor.');
    }
  };

  const activeVisitors = visitors.filter(v => v.status === 'Active');
  const checkedOut = visitors.filter(v => v.status === 'Checked Out');

  const patientCounts = {};
  activeVisitors.forEach(v => {
    patientCounts[v.patient] = (patientCounts[v.patient] || 0) + 1;
  });

  const statsCards = [
    { icon: '🟢', label: 'Currently Inside', value: activeVisitors.length, color: '#10b981' },
    { icon: '🔵', label: 'Checked Out Today', value: checkedOut.length, color: '#3b82f6' },
    { icon: '🟣', label: 'Patients With Visitors', value: Object.keys(patientCounts).length, color: '#8b5cf6' },
  ];

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">👥</span>
              Visitor Management
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Issue visitor passes, track check-in/out, and enforce visitor limits (max {MAX_VISITORS} per patient).
            </p>
          </div>
          <div className="header-actions">
            <button
              className={`btn ${showForm ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => setShowForm(!showForm)}
              style={{ transition: 'all 0.3s ease' }}
            >
              {showForm ? '✕ Close Form' : '+ Issue Visitor Pass'}
            </button>
          </div>
        </div>

        {/* Issue Pass Form (Animated slide-down) */}
        <div style={{
          maxHeight: showForm ? 400 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease',
          opacity: showForm ? 1 : 0,
          marginBottom: showForm ? 24 : 0,
        }}>
          <div className="card" style={{
            padding: 0, overflow: 'hidden',
            borderLeft: '4px solid #3b82f6',
          }}>
            <div style={{
              padding: '16px 24px',
              background: 'var(--surface-2)',
              borderBottom: '1px solid var(--border)',
            }}>
              <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'rgba(59,130,246,0.1)', fontSize: '0.85rem',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  📋
                </span>
                New Visitor Pass
              </h3>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">Patient Name *</label>
                  <input type="text" className="form-input" placeholder="Patient name..."
                    value={form.patient} onChange={e => setForm({...form, patient: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Ward</label>
                  <select className="form-input" value={form.ward} onChange={e => setForm({...form, ward: e.target.value})}>
                    <option value="">Select Ward</option>
                    <option>General-A</option>
                    <option>General-B</option>
                    <option>ICU</option>
                    <option>Maternity</option>
                    <option>Pediatric</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Bed Number</label>
                  <input type="text" className="form-input" placeholder="e.g. B-12"
                    value={form.bed} onChange={e => setForm({...form, bed: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Visitor Name *</label>
                  <input type="text" className="form-input" placeholder="Full name..."
                    value={form.visitor} onChange={e => setForm({...form, visitor: e.target.value})} />
                </div>
                <div className="form-group">
                  <label className="form-label">Relation</label>
                  <select className="form-input" value={form.relation} onChange={e => setForm({...form, relation: e.target.value})}>
                    <option value="">Select Relation</option>
                    <option>Spouse</option>
                    <option>Father</option>
                    <option>Mother</option>
                    <option>Son</option>
                    <option>Daughter</option>
                    <option>Sibling</option>
                    <option>Friend</option>
                    <option>Other</option>
                  </select>
                </div>
              </div>

              {form.patient && patientCounts[form.patient] >= MAX_VISITORS && (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: 10,
                  marginBottom: 14,
                  color: '#ef4444',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  display: 'flex', alignItems: 'center', gap: 8,
                  animation: 'hmsSlideUp 0.3s ease both',
                }}>
                  <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                  Maximum visitor limit ({MAX_VISITORS}) reached for {form.patient}. Cannot issue more passes.
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={handleIssuePass}
                disabled={!form.visitor || !form.patient || (patientCounts[form.patient] >= MAX_VISITORS)}
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                ✅ Issue Pass & Check In
              </button>
            </div>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {statsCards.map((c, i) => (
            <div key={c.label} className={`hms-stat-card hms-anim-${i + 1}`} style={{
              padding: 20,
              borderLeft: `4px solid ${c.color}`,
              textAlign: 'center',
              cursor: 'default',
            }}>
              <div style={{ position: 'absolute', top: -15, right: -15, width: 60, height: 60, borderRadius: '50%', background: `${c.color}08`, pointerEvents: 'none' }} />
              <div style={{
                fontSize: '2rem', fontWeight: 800, color: c.color,
                lineHeight: 1, marginBottom: 6,
                animation: 'hmsCountPop 0.6s 0.4s ease both',
              }}>
                {c.value}
              </div>
              <div style={{
                fontSize: '0.72rem', color: 'var(--text-muted)',
                textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em',
              }}>
                {c.label}
              </div>
            </div>
          ))}
        </div>

        {/* Visitor Log Table */}
        <div className="card hms-anim-4" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '18px 24px',
            background: 'var(--surface-2)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
              <span style={{
                width: 28, height: 28, borderRadius: 8,
                background: 'rgba(16,185,129,0.1)', fontSize: '0.85rem',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                📖
              </span>
              Today's Visitor Log
            </h3>
            <span style={{
              padding: '4px 14px', borderRadius: 20,
              background: 'var(--green-light)', color: 'var(--green)',
              fontSize: '0.75rem', fontWeight: 700, border: '1px solid var(--green-border)',
            }}>
              {visitors.length} visitors
            </span>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading visitor log...</span>
            </div>
          ) : visitors.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
              <span className="empty-icon">📭</span>
              <h3>No Visitors Yet Today</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Issue a pass to start tracking.</p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Pass ID</th><th>Patient</th><th>Ward/Bed</th>
                    <th>Visitor</th><th>Relation</th><th>Check In</th>
                    <th>Check Out</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visitors.map(v => (
                    <tr key={v.id}>
                      <td><strong style={{ color: 'var(--blue)' }}>{v.id}</strong></td>
                      <td style={{ fontWeight: 600 }}>{v.patient}</td>
                      <td>
                        <span style={{ fontSize: '0.83rem' }}>{v.ward} / {v.bed}</span>
                      </td>
                      <td style={{ fontWeight: 500 }}>{v.visitor}</td>
                      <td>
                        <span style={{
                          padding: '2px 10px', borderRadius: 12,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          fontSize: '0.75rem', fontWeight: 500,
                        }}>
                          {v.relation}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.83rem', color: 'var(--green)', fontWeight: 500 }}>{v.check_in}</td>
                      <td style={{ fontSize: '0.83rem', color: 'var(--text-muted)' }}>{v.check_out || '—'}</td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: 20,
                          fontSize: '0.7rem', fontWeight: 700,
                          background: v.status === 'Active' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
                          color: v.status === 'Active' ? '#059669' : '#2563eb',
                          border: `1px solid ${v.status === 'Active' ? 'rgba(16,185,129,0.25)' : 'rgba(59,130,246,0.25)'}`,
                        }}>
                          {v.status === 'Active' ? '● Active' : '✓ Out'}
                        </span>
                      </td>
                      <td>
                        {v.status === 'Active' ? (
                          <button
                            className="btn btn-sm"
                            style={{
                              background: 'rgba(239,68,68,0.08)',
                              color: '#ef4444',
                              border: '1px solid rgba(239,68,68,0.2)',
                              transition: 'all 0.25s ease',
                            }}
                            onClick={() => handleCheckout(v.numericId)}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(239,68,68,0.15)';
                              e.currentTarget.style.transform = 'scale(1.04)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(239,68,68,0.08)';
                              e.currentTarget.style.transform = 'scale(1)';
                            }}
                          >
                            Check Out
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>Done</span>
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
