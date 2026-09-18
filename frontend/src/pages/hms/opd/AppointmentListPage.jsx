import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function AppointmentListPage() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchAppointments();
  }, [filterDate]);

  const fetchAppointments = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/hms/appointments?date=${filterDate}`);
      setAppointments(res.data.data);
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
      alert('Failed to update status');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'Scheduled': return 'blue';
      case 'Checked-in': return 'green';
      case 'Completed': return 'teal';
      case 'Cancelled': return 'red';
      default: return 'blue';
    }
  };

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>Appointments Calendar</h1>
          <p>Manage booked OPD slots and reschedules.</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/hms/appointments/book')}>
          + Book New
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20, padding: 16, display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>Filter:</div>
        <input 
          type="date" 
          className="form-input" 
          value={filterDate} 
          onChange={e => setFilterDate(e.target.value)} 
          style={{ width: 200 }} 
        />
        <button className="btn btn-ghost" onClick={() => fetchAppointments()}>↻ Refresh</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div>
      ) : appointments.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--bg-secondary, rgba(0,0,0,0.02))', border: '2px dashed var(--border-color, rgba(0,0,0,0.1))', borderRadius: 12 }}>
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: 16, opacity: 0.8 }}>🗓️</span>
          <h3 style={{ fontSize: '1.25rem', marginBottom: 8, color: 'var(--text-primary, #333)' }}>No Appointments Found</h3>
          <p style={{ color: 'var(--text-secondary, #666)', margin: 0 }}>No slots are booked for {filterDate}.</p>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="test-table">
            <thead>
              <tr>
                <th>Time Slot</th>
                <th>Patient</th>
                <th>Doctor</th>
                <th>Department</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600, color: 'var(--blue)' }}>{a.slot_start}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{a.patient?.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{a.patient?.uhid || 'Legacy'} • {a.patient?.phoneNumber || '-'}</div>
                  </td>
                  <td>Dr. {a.doctor?.user?.name}</td>
                  <td>{a.department?.name}</td>
                  <td>
                    <span className={`badge badge-${getStatusColor(a.status)}`}>{a.status}</span>
                  </td>
                  <td>
                    {a.status === 'Scheduled' && (
                      <button className="btn btn-outline btn-sm" onClick={() => handleStatusChange(a.id, 'Checked-in')}>
                        Check-in
                      </button>
                    )}
                    {a.status !== 'Cancelled' && a.status !== 'Completed' && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', marginLeft: 8 }} onClick={() => handleStatusChange(a.id, 'Cancelled')}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </>
  );
}
