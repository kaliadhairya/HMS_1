import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function IPDAdmissionRequestModal({ patient, onClose, onSuccess }) {
  const { user } = useAuth();
  
  const [formData, setFormData] = useState({
    reasonForAdmission: '',
    primaryDiagnosis: '',
    icd10Code: '',
    wardPreference: '',
    urgencyLevel: '',
    estimatedDuration: '',
    durationUnit: 'Days',
    specialRequirements: {
      'Oxygen support': false,
      'IV access': false,
      'Cardiac monitoring': false,
      'Isolation': false,
      'Fall risk protocol': false,
      'Dietitian consult': false
    },
    initialOrders: ''
  });

  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (req) => {
    setFormData(prev => ({
      ...prev,
      specialRequirements: {
        ...prev.specialRequirements,
        [req]: !prev.specialRequirements[req]
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.reasonForAdmission || !formData.primaryDiagnosis || !formData.wardPreference || !formData.urgencyLevel) {
      toast.error('Please fill in all required fields marked with *');
      return;
    }

    setLoading(true);
    try {
      const selectedReqs = Object.keys(formData.specialRequirements).filter(k => formData.specialRequirements[k]);
      
      await api.post('/ipd/requests', {
        patientId: patient.id || patient.ID,
        ...formData,
        specialRequirements: selectedReqs
      });
      
      toast.success('IPD Admission Request sent successfully!');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      console.error(err);
      toast.error('Failed to send IPD Request');
    } finally {
      setLoading(false);
    }
  };

  // Format Patient Info
  const pName = patient?.patient_name || patient?.PATIENT_NAME || patient?.name || patient?.NAME || 'Unknown';
  const uhid = patient?.uhid || patient?.UHID || '-';
  const age = patient?.age || patient?.AGE || '-';
  const gender = patient?.gender || patient?.GENDER || '-';
  const initials = pName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  const currentDateTime = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal-content hms-anim-3" style={{ maxWidth: 800, padding: 0, background: '#2C2C2E', color: '#FFF', border: '1px solid #444' }}>
        
        {/* Modal Header */}
        <div style={{ padding: '24px 32px', borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ color: '#aaa', fontSize: '0.8rem', margin: '0 0 4px 0' }}>Doctor Dashboard</p>
            <h2 style={{ margin: 0, fontSize: '1.6rem', color: '#FFF' }}>Admit to IPD</h2>
          </div>
          
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#1e3a8a', padding: '6px 12px', borderRadius: 8, gap: 12 }}>
              <div style={{ background: '#3b82f6', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                {initials}
              </div>
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{pName}</div>
                <div style={{ fontSize: '0.75rem', color: '#93c5fd' }}>MRN: {uhid} • {age}Y {gender[0]}</div>
              </div>
            </div>
            <button className="btn-close" onClick={onClose} style={{ color: '#FFF', fontSize: '1.5rem', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px 32px', maxHeight: '70vh', overflowY: 'auto' }}>
          <form id="ipd-request-form" onSubmit={handleSubmit}>
            
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Reason for admission <span style={{ color: '#ef4444' }}>*</span></label>
              <textarea 
                name="reasonForAdmission"
                value={formData.reasonForAdmission}
                onChange={handleChange}
                className="form-control" 
                rows="3" 
                placeholder="e.g. Post-operative care following appendectomy, requires monitoring and IV antibiotics..."
                style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Primary diagnosis <span style={{ color: '#ef4444' }}>*</span></label>
                <input 
                  type="text" 
                  name="primaryDiagnosis"
                  value={formData.primaryDiagnosis}
                  onChange={handleChange}
                  className="form-control" 
                  placeholder="e.g. Acute appendicitis"
                  style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                />
              </div>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>ICD-10 code</label>
                <input 
                  type="text" 
                  name="icd10Code"
                  value={formData.icd10Code}
                  onChange={handleChange}
                  className="form-control" 
                  placeholder="e.g. K35.80"
                  style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Ward preference <span style={{ color: '#ef4444' }}>*</span></label>
                <select 
                  name="wardPreference"
                  value={formData.wardPreference}
                  onChange={handleChange}
                  className="form-control" 
                  style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                >
                  <option value="">Select ward</option>
                  <option value="General Ward">General Ward</option>
                  <option value="Semi-Private">Semi-Private</option>
                  <option value="Private">Private</option>
                  <option value="ICU">ICU</option>
                  <option value="Maternity">Maternity</option>
                </select>
              </div>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Urgency level <span style={{ color: '#ef4444' }}>*</span></label>
                <select 
                  name="urgencyLevel"
                  value={formData.urgencyLevel}
                  onChange={handleChange}
                  className="form-control" 
                  style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                >
                  <option value="">Select urgency</option>
                  <option value="Routine">Routine</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Emergency">Emergency</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Estimated duration of stay</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <input 
                  type="number" 
                  name="estimatedDuration"
                  value={formData.estimatedDuration}
                  onChange={handleChange}
                  className="form-control" 
                  placeholder="e.g. 3"
                  style={{ width: 120, background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                />
                <select 
                  name="durationUnit"
                  value={formData.durationUnit}
                  onChange={handleChange}
                  className="form-control" 
                  style={{ flex: 1, background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
                >
                  <option value="Days">Days</option>
                  <option value="Weeks">Weeks</option>
                  <option value="Months">Months</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Special requirements</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {Object.keys(formData.specialRequirements).map(req => (
                  <label key={req} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#3A3A3C', padding: '8px 16px', borderRadius: 20, border: '1px solid #555', cursor: 'pointer', userSelect: 'none' }}>
                    <input 
                      type="checkbox" 
                      checked={formData.specialRequirements[req]}
                      onChange={() => handleCheckbox(req)}
                      style={{ accentColor: '#3b82f6' }}
                    />
                    <span style={{ fontSize: '0.9rem' }}>{req}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Initial orders / instructions for nurse</label>
              <textarea 
                name="initialOrders"
                value={formData.initialOrders}
                onChange={handleChange}
                className="form-control" 
                rows="3" 
                placeholder="e.g. Start IV fluids NS 100ml/hr, NPO until further notice, check BP every 4 hours..."
                style={{ background: '#3A3A3C', color: '#FFF', border: '1px solid #555' }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Admitting doctor</label>
                <input 
                  type="text" 
                  readOnly
                  className="form-control" 
                  value={user?.name ? `Dr. ${user.name}` : ''}
                  style={{ background: '#2C2C2E', color: '#FFF', border: '1px solid #555', opacity: 0.8 }}
                />
              </div>
              <div className="form-group">
                <label style={{ color: '#FFF', marginBottom: 8, display: 'block' }}>Date & time of request</label>
                <input 
                  type="text" 
                  readOnly
                  className="form-control" 
                  value={currentDateTime}
                  style={{ background: '#2C2C2E', color: '#FFF', border: '1px solid #555', opacity: 0.8 }}
                />
              </div>
            </div>

          </form>
        </div>

        {/* Modal Footer */}
        <div style={{ padding: '20px 32px', borderTop: '1px solid #444', display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
          <button type="button" className="btn btn-outline" onClick={onClose} style={{ color: '#FFF', borderColor: '#666' }} disabled={loading}>
            Cancel
          </button>
          <button type="submit" form="ipd-request-form" className="btn btn-primary" style={{ background: '#2563eb', border: 'none' }} disabled={loading}>
            {loading ? 'Sending...' : 'Send IPD Request'}
          </button>
        </div>

      </div>
    </div>
  );
}
