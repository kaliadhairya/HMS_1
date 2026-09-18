import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function ReceptionistAppointmentsPage() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterDoctor, setFilterDoctor] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  useEffect(() => {
    fetchAppointments();
  }, [filterDate]);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/hms/appointments?date=${filterDate}`);
      setAppointments(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    try {
      await api.put(`/hms/appointments/${id}`, { status: newStatus });
      fetchAppointments();
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = appointments.filter(a => {
    const doctorName = a.doctor?.name || a.doctor?.user?.name || '';
    if (filterDoctor && !doctorName.toLowerCase().includes(filterDoctor.toLowerCase())) return false;
    if (filterStatus && a.status !== filterStatus) return false;
    return true;
  });

  const statusColors = {
    Scheduled: { bg: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: 'rgba(59,130,246,0.25)' },
    'Checked-in': { bg: 'rgba(16,185,129,0.1)', color: '#10b981', border: 'rgba(16,185,129,0.25)' },
    Completed: { bg: 'rgba(16,185,129,0.12)', color: '#059669', border: 'rgba(5,150,105,0.25)' },
    Cancelled: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.25)' },
    'No Show': { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">📅</span>
              Appointment Management
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Book, reschedule, cancel, and manage all patient appointments.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/hms/appointments/book')}
              style={{ position: 'relative', overflow: 'hidden' }}
            >
              + Book New Appointment
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="hms-filter-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date:</label>
            <input type="date" className="form-input" value={filterDate} onChange={e => setFilterDate(e.target.value)} style={{ width: 180 }} />
          </div>
          <input type="text" className="form-input" placeholder="🔍 Filter by Doctor..." value={filterDoctor} onChange={e => setFilterDoctor(e.target.value)} style={{ width: 220 }} />
          <select className="form-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width: 180 }}>
            <option value="">All Statuses</option>
            <option>Scheduled</option>
            <option>Checked-in</option>
            <option>Completed</option>
            <option>Cancelled</option>
            <option>No Show</option>
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              padding: '5px 14px', borderRadius: 20,
              background: 'var(--green-light)', color: 'var(--green)',
              fontSize: '0.78rem', fontWeight: 700, border: '1px solid var(--green-border)',
            }}>
              {filtered.length} appointments
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading appointments...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24 }}>
              <span className="empty-icon">📭</span>
              <h3 style={{ fontSize: '1.15rem', marginBottom: 8 }}>No Appointments Found</h3>
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.88rem' }}>
                There are no appointments matching your criteria for this day.
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Doctor</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(a => {
                    const sc = statusColors[a.status] || statusColors.Scheduled;
                    return (
                      <tr key={a.id}>
                        <td><strong style={{ color: 'var(--blue)' }}>{a.appointment_time || a.slot_start || '—'}</strong></td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{a.patient?.name || 'Unknown'}</div>
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>{a.patient?.uhid}</div>
                        </td>
                        <td>{a.doctor?.name || a.doctor?.user?.name || '—'}</td>
                        <td>{a.department?.name || '—'}</td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center',
                            padding: '4px 12px', borderRadius: 20,
                            fontSize: '0.72rem', fontWeight: 700,
                            background: sc.bg, color: sc.color,
                            border: `1px solid ${sc.border}`,
                            letterSpacing: '0.03em',
                          }}>
                            {a.status}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {a.status === 'Scheduled' && (
                              <>
                                <button className="btn btn-sm btn-primary" onClick={() => handleStatusChange(a.id, 'Checked-in')}>Check In</button>
                                <button className="btn btn-sm btn-danger" onClick={() => handleStatusChange(a.id, 'Cancelled')}>Cancel</button>
                                <button className="btn btn-sm" style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.25)' }} onClick={() => handleStatusChange(a.id, 'No Show')}>No-Show</button>
                              </>
                            )}
                            {a.status === 'Checked-in' && (
                              <button className="btn btn-sm btn-primary" onClick={() => handleStatusChange(a.id, 'Completed')}>Complete</button>
                            )}
                            {(a.status === 'Completed' || a.status === 'Cancelled') && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
