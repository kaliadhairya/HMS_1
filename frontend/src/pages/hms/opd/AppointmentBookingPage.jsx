import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function AppointmentBookingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPatient = location.state?.patient;

  const [patient, setPatient] = useState(initialPatient || null);
  const [doctors, setDoctors] = useState([]);

  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSlot, setSelectedSlot] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Quick Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Standard 15-minute appointment schedule slots
  const availableSlots = [
    '09:00', '09:15', '09:30', '09:45',
    '10:00', '10:15', '10:30', '10:45',
    '11:00', '11:15', '11:30', '11:45',
    '12:00', '12:15', '12:30', '12:45',
    '14:00', '14:15', '14:30', '14:45',
    '15:00', '15:15', '15:30', '15:45'
  ];

  // In a real app we would fetch the doctor's booked slots from backend
  const [bookedSlots, setBookedSlots] = useState([]);

  useEffect(() => { fetchDoctors(); }, []);

  // Refresh booked slots when doctor/date changes
  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      fetchBookedSlots(selectedDoctor, selectedDate);
    } else {
      setBookedSlots([]);
    }
  }, [selectedDoctor, selectedDate]);

  const fetchDoctors = async () => {
    try {
      const res = await api.get(`/hms/doctors`);
      setDoctors(res.data.data);
    } catch (err) { }
  };

  const fetchBookedSlots = async (doctorId, date) => {
    try {
      const res = await api.get(`/hms/appointments?doctor_id=${doctorId}&date=${date}`);
      const booked = (res.data.data || [])
        .filter((appointment) => !['Cancelled', 'Completed', 'No Show'].includes(appointment.status))
        .map((appointment) => appointment.slot_start)
        .filter(Boolean);
      setBookedSlots(booked);
    } catch (err) {
      setBookedSlots([]);
    }
  };

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (searchQuery.length > 2 && !patient && !initialPatient) {
        try {
          const res = await api.get(`/patients/hms/search?q=${searchQuery}`);
          setSearchResults(res.data.data);
        } catch (err) { }
      } else { setSearchResults([]); }
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery, patient, initialPatient]);

  const handleBook = async () => {
    if (!patient || !selectedDoctor || !selectedSlot) {
      setError('Please fill all required fields');
      return;
    }
    setLoading(true);
    setError('');

    // Auto-calculate 15 min end slot
    const [h, m] = selectedSlot.split(':').map(Number);
    const endTotalMins = h * 60 + m + 15;
    const endH = Math.floor(endTotalMins / 60).toString().padStart(2, '0');
    const endM = (endTotalMins % 60).toString().padStart(2, '0');
    const slot_end = `${endH}:${endM}`;

    try {
      await api.post('/hms/appointments', {
        patient_id: patient.id,
        department_id: 1, // Default dummy department since it's required by db
        doctor_id: selectedDoctor,
        appointment_date: selectedDate,
        slot_start: selectedSlot,
        slot_end
      });
      navigate('/hms/appointments'); // List view
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to book appointment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="page-wrapper fade-up">
        <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>Book Appointment</h1>
            <p>Schedule a future consultation slot.</p>
          </div>
          <button className="btn btn-outline" onClick={() => navigate('/hms/appointments')}>
            View All Appointments
          </button>
        </div>

        <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
          {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

          {/* 1. Patient */}
          <div className="card-section">
            <div className="card-section-title">1. Patient Selection</div>
            {patient ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div><strong>{patient.name}</strong> • UHID: {patient.uhid || 'Legacy'} • {patient.phoneNumber}</div>
                {!initialPatient && <button className="btn btn-ghost btn-sm" onClick={() => setPatient(null)}>Change</button>}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  type="text" className="form-input"
                  placeholder="Search Patient Name or UHID..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                />
                {searchResults.length > 0 && (
                  <div className="card" style={{ position: 'absolute', top: 45, left: 0, right: 0, zIndex: 10, padding: 0 }}>
                    {searchResults.map(p => (
                      <div key={p.id} style={{ padding: '12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setPatient(p); setSearchQuery(''); }}>
                        <strong>{p.name}</strong> ({p.uhid || 'Old'})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Provider */}
          <div className="card-section">
            <div className="card-section-title">2. Select Provider</div>
            <div className="form-group">
              <label className="form-label">Doctor</label>
              <select className="form-select" value={selectedDoctor} onChange={e => setSelectedDoctor(e.target.value)}>
                <option value="">-- Choose --</option>
                {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.user?.name} ({d.speciality})</option>)}
              </select>
            </div>
          </div>

          {/* 3. Slot */}
          <div className="card-section">
            <div className="card-section-title">3. Select Date & Slot</div>
            <div style={{ display: 'flex', gap: 24 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Date</label>
                <input type="date" className="form-input" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} min={new Date().toISOString().split('T')[0]} />
              </div>
            </div>

            {selectedDoctor && selectedDate && (
              <div style={{ marginTop: 24 }}>
                <label className="form-label">Available Slots</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 12, marginTop: 8 }}>
                  {availableSlots.map(slot => {
                    const isBooked = bookedSlots.includes(slot);
                    const isSelected = selectedSlot === slot;
                    let bg = 'var(--surface-3)';
                    let color = 'var(--text-primary)';
                    let border = '1px solid transparent';

                    if (isBooked) {
                      bg = 'var(--red-light)'; color = 'var(--red)'; border = '1px solid var(--red-border)';
                    } else if (isSelected) {
                      bg = 'var(--green)'; color = 'white'; border = '1px solid var(--green)';
                    }

                    return (
                      <button
                        key={slot}
                        className="btn"
                        style={{ background: bg, color, border, padding: '8px', fontSize: '0.8rem', justifyContent: 'center' }}
                        disabled={isBooked}
                        onClick={(e) => { e.preventDefault(); setSelectedSlot(slot); }}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary btn-lg btn-full"
            onClick={handleBook}
            disabled={loading || !patient || !selectedDoctor || !selectedSlot}
          >
            {loading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : 'Confirm Appointment'}
          </button>
        </div>
      </div>
    </>
  );
}
