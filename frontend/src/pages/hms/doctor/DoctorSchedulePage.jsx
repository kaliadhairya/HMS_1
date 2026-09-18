import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function DoctorSchedulePage() {
  const [schedule, setSchedule] = useState({ availability: [], leaves: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/doctor/schedule')
      .then(res => setSchedule(res.data.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🗓️</span>
              My Schedule
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Manage your OPD sessions, max patient limits, and apply for leaves.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24, alignItems: 'start' }}>
          {/* OPD Availability */}
          <div className="card hms-anim-2" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
            }}>
              <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(59,130,246,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📅</span>
                OPD Availability
              </h3>
              <button className="btn btn-sm btn-ghost" disabled title="Doctor self-service timing edits are not implemented in this build.">
                Timings are read-only
              </button>
            </div>

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
                <div className="spinner" style={{ width: 28, height: 28 }} />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading schedule...</span>
              </div>
            ) : schedule.availability.length === 0 ? (
              <div className="hms-empty-state" style={{ margin: 24, border: 'none' }}>
                <span className="empty-icon">📅</span>
                <h3>No Schedule Data</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  No upcoming appointments are scheduled, so no live availability pattern can be derived.
                </p>
              </div>
            ) : (
              <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
                <table>
                  <thead>
                    <tr><th>Day</th><th>Session Timing</th><th>Upcoming Dates</th><th>Max Patients</th></tr>
                  </thead>
                  <tbody>
                    {schedule.availability.map((av, idx) => (
                      <tr key={idx}>
                        <td><strong>{av.day}</strong></td>
                        <td>
                          <span style={{
                            padding: '3px 10px', borderRadius: 8,
                            background: 'rgba(59,130,246,0.08)', color: '#2563eb',
                            fontSize: '0.82rem', fontWeight: 600,
                          }}>
                            {av.slots}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {(av.upcoming_dates || []).join(', ') || '—'}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'rgba(16,185,129,0.1)', color: '#059669',
                            fontWeight: 800, fontSize: '0.85rem', border: '1px solid rgba(16,185,129,0.2)',
                          }}>
                            {av.max_patients}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Upcoming Leaves */}
          <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '18px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
            }}>
              <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245,158,11,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>🏖️</span>
                Upcoming Leaves
              </h3>
              <button className="btn btn-sm btn-ghost" disabled title="Leave application is handled from the admin attendance workflow.">
                Apply via Admin
              </button>
            </div>

            <div style={{ padding: '16px 20px' }}>
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                  <div className="spinner" />
                </div>
              ) : schedule.leaves.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center' }}>
                  <span style={{ fontSize: '2rem', display: 'block', marginBottom: 8 }}>✅</span>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No upcoming leaves scheduled.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {schedule.leaves.map((l, idx) => (
                    <div key={idx} className="hms-stat-card" style={{
                      padding: '14px 18px', cursor: 'default',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      animation: `hmsSlideRight 0.4s ${0.1 + idx * 0.06}s cubic-bezier(0.16,1,0.3,1) both`,
                    }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{new Date(l.date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>{l.reason}</div>
                      </div>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                        background: l.status === 'Approved' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                        color: l.status === 'Approved' ? '#059669' : '#d97706',
                        border: `1px solid ${l.status === 'Approved' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                      }}>
                        {l.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
