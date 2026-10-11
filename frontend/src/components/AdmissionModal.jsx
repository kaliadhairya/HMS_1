import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { CircleCheck } from 'lucide-react';
import api from '../api/axios';
import Modal from './ui/Modal';

// Admit a patient straight into a bed from the bed board. If the patient has a pending admission
// request, the server links this admission to it and marks it Admitted.
// Patient search returns patient_name; the direct lookup returns name.
const nameOf = (p) => p?.name || p?.patient_name || [p?.first_name, p?.last_name].filter(Boolean).join(' ') || `Patient ${p?.id}`;

export default function AdmissionModal({ bedId, wardId, bedNumber, onSuccess, onClose }) {
  const [patients, setPatients] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [saving, setSaving] = useState(false);
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
    if (term.length >= 2 && !selectedPatient) {
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
    }
    setPatients([]);
    return undefined;
  }, [searchTerm, selectedPatient]);

  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setFormData((current) => ({ ...current, patientId: patient.id }));
    setSearchTerm(`${patient.uhid || `ID-${patient.id}`} - ${nameOf(patient)}`);
    setPatients([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.patientId) return toast.error('Select a patient');
    setSaving(true);
    try {
      const payload = { ...formData, bedId };
      const res = await api.post('/ipd/admissions', payload);
      toast.success(`Patient admitted: ${res.data.data.ADMISSION_ID_FORMATTED || res.data.data.admissionIdFormatted}`);
      onSuccess(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Admission failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open && !saving) onClose(); }}
      title={`Admit patient to bed ${bedNumber}`}
      description="Find the patient, choose the admitting doctor and confirm."
      size="md"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" form="bed-admission-form" className="btn btn-primary btn-md" disabled={!formData.patientId || saving}>
            <CircleCheck size={16} aria-hidden="true" /> {saving ? 'Admitting…' : 'Confirm admission'}
          </button>
        </>
      )}
    >
      <form id="bed-admission-form" onSubmit={handleSubmit} className="stack-sm" data-ward-id={wardId}>
        <div className="form-group">
          <label className="form-label" htmlFor="adm-patient">Patient</label>
          <input
            id="adm-patient"
            type="text"
            className="form-input"
            placeholder="Patient ID, UHID or name"
            autoComplete="off"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setSelectedPatient(null);
              setFormData((current) => ({ ...current, patientId: '' }));
            }}
          />
          {selectedPatient && (
            <div className="alert-strip alert-info" style={{ margin: '8px 0 0' }}>
              <CircleCheck size={16} aria-hidden="true" />
              <span>
                <strong>{nameOf(selectedPatient)}</strong>{' '}
                <span className="cell-secondary">{selectedPatient.uhid || `ID-${selectedPatient.id}`} · {selectedPatient.age || '—'} y · {selectedPatient.gender || '—'}</span>
              </span>
            </div>
          )}
          {patients.length > 0 && !formData.patientId && (
            <ul className="list-rows" role="listbox" aria-label="Matching patients" style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
              {patients.map(p => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected="false" className="list-row" onClick={() => selectPatient(p)}>
                    <span className="cell-stack">
                      <span className="cell-primary">{nameOf(p)}</span>
                      <span className="cell-secondary mono">{p.uhid || `ID-${p.id}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="adm-doctor-select">Admitting doctor</label>
            <select
              id="adm-doctor-select"
              className="form-select"
              value={formData.admittingDoctorId}
              onChange={e => setFormData({ ...formData, admittingDoctorId: e.target.value })}
              required
            >
              <option value="">Select doctor</option>
              {doctors.map(d => (
                <option key={d.id} value={d.user_id || d.user?.id || d.id}>
                  {d.user?.name || d.name || `Doctor ${d.id}`}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="adm-department">Department</label>
            <input
              id="adm-department"
              type="text"
              className="form-input"
              placeholder="Defaults to the doctor's department"
              value={formData.department}
              onChange={e => setFormData({ ...formData, department: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="adm-type">Admission type</label>
            <select
              id="adm-type"
              className="form-select"
              value={formData.admissionType}
              onChange={e => setFormData({ ...formData, admissionType: e.target.value })}
            >
              <option>Routine</option>
              <option>Emergency</option>
              <option>Transfer</option>
              <option>Maternity</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="adm-expected">Expected discharge date</label>
            <input
              id="adm-expected"
              type="date"
              className="form-input"
              value={formData.expectedDischargeDate}
              onChange={e => setFormData({ ...formData, expectedDischargeDate: e.target.value })}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
