import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function AdmissionModal({ bedId, wardId, bedNumber, onSuccess, onClose }) {
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [formData, setFormData] = useState({
    patientId: '',
    admittingDoctorId: '',
    department: '',
    admissionType: 'Routine',
    expectedDischargeDate: ''
  });

  useEffect(() => {
    api.get('/hms/doctors')
      .then(res => setDoctors(res.data.data || []))
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length >= 2) {
      const delay = setTimeout(() => {
        const loadPatients = async () => {
          try {
            const results = [];
            if (/^\d+$/.test(term)) {
              try {
                const directRes = await api.get(`/patients/hms/${term}`);
                if (directRes.data?.success && directRes.data.patient) {
                  results.push(directRes.data.patient);
                }
              } catch (error) {
                if (error?.response?.status !== 404) throw error;
              }
            }

            const searchRes = await api.get(`/patients/hms/search?q=${encodeURIComponent(term)}`);
            const searchMatches = Array.isArray(searchRes.data?.data) ? searchRes.data.data : [];
            const merged = [...results, ...searchMatches].filter(
              (patient, index, array) => patient?.id && array.findIndex((entry) => entry.id === patient.id) === index
            );
            setPatients(merged);
          } catch (err) {
            console.error(err);
          }
        };

        loadPatients();
      }, 300);
      return () => clearTimeout(delay);
    } else {
      setPatients([]);
    }
  }, [searchTerm]);

  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setFormData((current) => ({ ...current, patientId: patient.id }));
    setSearchTerm(`${patient.uhid || `ID-${patient.id}`} - ${patient.name}`);
    setPatients([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.patientId) return toast.error('Please select a patient.');
    
    try {
      const payload = { ...formData, bedId };
      const res = await api.post('/ipd/admissions', payload);
      toast.success(`Patient admitted! ID: ${res.data.data.admissionIdFormatted}`);
      onSuccess(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Admission failed');
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content card slide-down" style={{ maxWidth: 600 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3>Admit Patient (Bed {bedNumber})</h3>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="form-group">
            <label>Confirm Patient *</label>
            <input 
              type="text" 
              placeholder="Enter patient ID, UHID, or name" 
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setSelectedPatient(null);
                setFormData((current) => ({ ...current, patientId: '' }));
              }}
              className="form-control"
            />
            {selectedPatient && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 6 }}>
                <strong>{selectedPatient.name}</strong>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {selectedPatient.uhid || `ID-${selectedPatient.id}`} • {selectedPatient.age || '-'} Yrs • {selectedPatient.gender || '-'}
                </div>
              </div>
            )}
            {patients.length > 0 && !formData.patientId && (
              <div style={{ background: 'var(--surface-color)', border: '1px solid var(--border)', borderRadius: 4, marginTop: 4, maxHeight: 150, overflowY: 'auto' }}>
                {patients.map(p => (
                  <div 
                    key={p.id} 
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                    onClick={() => selectPatient(p)}
                  >
                    <strong>{p.uhid || `ID-${p.id}`}</strong>: {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Admitting Doctor</label>
              <select 
                className="form-control" 
                value={formData.admittingDoctorId}
                onChange={e => setFormData({ ...formData, admittingDoctorId: e.target.value })}
                required
              >
                <option value="">Select Doctor</option>
                {doctors.map(d => (
                  <option key={d.id} value={d.user_id || d.user?.id || d.id}>
                    {d.user?.name || d.name || `Doctor ${d.id}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Department</label>
              <input 
                type="text" 
                className="form-control"
                value={formData.department}
                onChange={e => setFormData({ ...formData, department: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Admission Type</label>
              <select 
                className="form-control" 
                value={formData.admissionType}
                onChange={e => setFormData({ ...formData, admissionType: e.target.value })}
              >
                <option>Routine</option>
                <option>Emergency</option>
                <option>Transfer</option>
                <option>Maternity</option>
              </select>
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Expected Discharge Date</label>
              <input 
                type="date" 
                className="form-control"
                value={formData.expectedDischargeDate}
                onChange={e => setFormData({ ...formData, expectedDischargeDate: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!formData.patientId}>Confirm Admission</button>
          </div>
        </form>

        <style jsx>{`
          .modal-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5); z-index: 1000;
            display: flex; align-items: center; justify-content: center;
          }
        `}</style>
      </div>
    </div>
  );
}
