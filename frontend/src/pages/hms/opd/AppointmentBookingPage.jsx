import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarDays, CircleAlert, List, Search, Stethoscope, UserRound, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

// Local calendar date (not UTC), so "today" matches the hospital's day.
const localYmd = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// /patients/hms/search returns raw SQL aliases (patient_name, phone_number); map them to the
// field names the rest of this page uses.
const normalizePatient = (p) => ({ ...p, name: p.name || p.patient_name, phoneNumber: p.phoneNumber || p.phone_number });

export default function AppointmentBookingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPatient = location.state?.patient;

  const [patient, setPatient] = useState(initialPatient || null);
  const [doctors, setDoctors] = useState([]);

  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [selectedDate, setSelectedDate] = useState(localYmd());
  const [selectedSlot, setSelectedSlot] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Quick Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Mock slots for UI
  const availableSlots = [
    '09:00', '09:15', '09:30', '09:45',
    '10:00', '10:15', '10:30', '10:45',
    '11:00', '11:15', '11:30', '11:45',
    '12:00', '12:15', '12:30', '12:45',
    '14:00', '14:15', '14:30', '14:45',
    '15:00', '15:15', '15:30', '15:45',
  ];

  // In a real app we would fetch the doctor's booked slots from backend
  const [bookedSlots, setBookedSlots] = useState([]);

  useEffect(() => { fetchDoctors(); }, []);

  // Refresh booked slots when doctor/date changes; a slot picked for another doctor or day no longer applies.
  useEffect(() => {
    setSelectedSlot('');
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
    } catch (err) { /* doctor list stays empty */ }
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
          const res = await api.get(`/patients/hms/search?q=${encodeURIComponent(searchQuery)}`);
          setSearchResults(res.data.data);
        } catch (err) { /* ignore search errors */ }
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
        slot_end,
      });
      navigate('/hms/appointments'); // List view
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to book appointment');
    } finally {
      setLoading(false);
    }
  };

  const results = (Array.isArray(searchResults) ? searchResults : []).map(normalizePatient);
  const doctorList = Array.isArray(doctors) ? doctors : [];

  return (
    <>
      <Navbar />
      <main className="app-page">
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <PageHeader
            title="Book appointment"
            description="Schedule a consultation slot with a doctor."
            actions={(
              <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate('/hms/appointments')}>
                <List size={16} aria-hidden="true" /> View appointments
              </button>
            )}
          />

          {error && (
            <div className="alert-strip alert-danger" role="alert">
              <CircleAlert size={16} aria-hidden="true" /> {error}
            </div>
          )}

          <div className="stack">
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><UserRound size={16} aria-hidden="true" /> 1. Patient</h2></div>
              <div className="panel-pad">
                {patient ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <span className="cell-person">
                      <span className="cell-avatar" aria-hidden="true">{(patient.name || '?').charAt(0).toUpperCase()}</span>
                      <span className="cell-stack">
                        <span className="cell-primary">{patient.name}</span>
                        <span className="cell-secondary"><span className="mono">{patient.uhid || 'Legacy'}</span>{patient.phoneNumber ? ` · ${patient.phoneNumber}` : ''}</span>
                      </span>
                    </span>
                    {!initialPatient && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPatient(null)}>
                        <X size={14} aria-hidden="true" /> Change
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="stack-sm">
                    <label className="search-field">
                      <Search size={17} aria-hidden="true" />
                      <span className="sr-only">Search patient by name or UHID</span>
                      <input type="text" placeholder="Search patient name or UHID" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </label>
                    {results.length > 0 && (
                      <ul className="list-rows" aria-label="Matching patients" style={{ maxHeight: 240, overflowY: 'auto' }}>
                        {results.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="list-row" onClick={() => { setPatient(p); setSearchQuery(''); }}>
                              <span className="cell-stack">
                                <span className="cell-primary">{p.name}</span>
                                <span className="cell-secondary mono">{p.uhid || 'Old record'}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!searchQuery && <p className="form-hint" style={{ marginTop: 0 }}>Type at least 3 characters to search.</p>}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Stethoscope size={16} aria-hidden="true" /> 2. Doctor</h2></div>
              <div className="panel-pad">
                <div className="form-group">
                  <label className="form-label" htmlFor="book-doctor">Doctor</label>
                  <select id="book-doctor" className="form-select" value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
                    <option value="">Choose a doctor</option>
                    {doctorList.map((d) => <option key={d.id} value={d.id}>Dr. {d.user?.name} ({d.speciality})</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><CalendarDays size={16} aria-hidden="true" /> 3. Date and slot</h2></div>
              <div className="panel-pad stack">
                <div className="form-group" style={{ maxWidth: 240 }}>
                  <label className="form-label" htmlFor="book-date">Date</label>
                  <input id="book-date" type="date" className="form-input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} min={localYmd()} />
                </div>

                {selectedDoctor && selectedDate ? (
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="form-label" style={{ marginBottom: 8 }}>Available slots</legend>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
                      {availableSlots.map((slot) => {
                        const isBooked = bookedSlots.includes(slot);
                        const isSelected = selectedSlot === slot;
                        let style = { background: 'var(--surface)', color: 'var(--text-primary)', borderColor: 'var(--border-dark)' };
                        if (isBooked) {
                          style = { background: 'var(--surface-3)', color: 'var(--text-muted)', borderColor: 'var(--border)', textDecoration: 'line-through', cursor: 'not-allowed' };
                        } else if (isSelected) {
                          style = { background: 'var(--primary)', color: 'var(--text-inverse)', borderColor: 'var(--primary)' };
                        }

                        return (
                          <button
                            key={slot}
                            type="button"
                            className="btn btn-sm tabular"
                            style={{ ...style, justifyContent: 'center', height: 34 }}
                            disabled={isBooked}
                            aria-pressed={isSelected}
                            aria-label={isBooked ? `${slot}, booked` : slot}
                            onClick={(e) => { e.preventDefault(); setSelectedSlot(slot); }}
                          >
                            {slot}
                          </button>
                        );
                      })}
                    </div>
                    <p className="form-hint">Crossed-out slots are already booked. Each slot is 15 minutes.</p>
                  </fieldset>
                ) : (
                  <p className="muted">Choose a doctor to see available slots.</p>
                )}
              </div>
            </section>

            <button
              type="button"
              className="btn btn-primary btn-md"
              style={{ justifyContent: 'center', height: 42 }}
              onClick={handleBook}
              disabled={loading || !patient || !selectedDoctor || !selectedSlot}
            >
              <CalendarCheck size={16} aria-hidden="true" /> {loading ? 'Booking…' : 'Confirm appointment'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
