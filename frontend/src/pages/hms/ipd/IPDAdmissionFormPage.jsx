import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const Field = ({ label, children, span, required }) => (
  <div className="form-group" style={span ? { gridColumn: `span ${span}` } : {}}>
    <label className="form-label">{label}{required && <span style={{ color: 'var(--red)' }}> *</span>}</label>
    {children}
  </div>
);

export default function IPDAdmissionFormPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const patientId = searchParams.get('patientId');
  const [patientInfo, setPatientInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    reasonForAdmission: '',
    primaryDiagnosis: '',
    icd10Code: '',
    wardPreference: '',
    urgencyLevel: '',
    estimatedDuration: '',
    durationUnit: 'Days',
    initialOrders: '',
  });

  const [specialRequirements, setSpecialRequirements] = useState({
    'Oxygen support': false,
    'IV access': false,
    'Cardiac monitoring': false,
    'Isolation': false,
    'Fall risk protocol': false,
    'Dietitian consult': false,
  });

  useEffect(() => {
    if (patientId) loadPatientDetails(patientId);
    else setLoading(false);
  }, [patientId]);

  const loadPatientDetails = async (pid) => {
    try {
      const res = await api.get(`/patients/${pid}`);
      const p = res.data.patient || res.data;
      if (p) {
        setPatientInfo({
          name: p.name || p.NAME || '',
          uhid: p.uhid || p.UHID || '',
          age: p.age || p.AGE || '',
          gender: p.gender || p.GENDER || '',
          empNumber: p.empNumber || p.EMPNUMBER || '',
          patientType: p.patientType || p.PATIENTTYPE || '',
        });
      }
    } catch (e) {
      console.error('Failed to load patient:', e);
      toast.error('Failed to load patient details');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckbox = (key) => {
    setSpecialRequirements(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.reasonForAdmission || !form.primaryDiagnosis || !form.wardPreference || !form.urgencyLevel) {
      return toast.error('Please fill in all required fields marked with *');
    }
    if (!patientId) return toast.error('No patient selected');

    setSubmitting(true);
    try {
      const selectedReqs = Object.keys(specialRequirements).filter(k => specialRequirements[k]);
      await api.post('/ipd/requests', {
        patientId,
        ...form,
        specialRequirements: selectedReqs,
      });
      toast.success('IPD Admission Request sent successfully!');
      navigate('/ipd/requests');
    } catch (err) {
      console.error(err);
      toast.error('Failed to send IPD request');
    } finally {
      setSubmitting(false);
    }
  };

  const currentDateTime = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });


  return (
    <>
      <Navbar />
      <div className="container py-4">
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(236,72,153,0.1)', borderColor: 'rgba(236,72,153,0.25)' }}>🏥</span>
              IPD Admission Request
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Submit an inpatient admission request for review and bed assignment.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={() => navigate(-1)}>← Back</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="spinner" style={{ width: 32, height: 32 }} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="hms-anim-2">

            {/* Patient Card */}
            <div className="card" style={{ marginBottom: 24, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>👤</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Patient Identification</h3>
              </div>
              <div style={{ padding: '18px 24px' }}>
                {patientInfo ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
                    {[
                      { label: 'Patient Name', value: patientInfo.name },
                      { label: 'UHID', value: patientInfo.uhid || 'N/A' },
                      { label: 'Gender / Age', value: `${patientInfo.gender}, ${patientInfo.age} yrs` },
                      { label: 'Employee No', value: patientInfo.empNumber || 'N/A' },
                    ].map(item => (
                      <div key={item.label}>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ padding: 20, textAlign: 'center', color: 'var(--red)', fontSize: '0.85rem' }}>
                    ⚠️ No patient selected. Please initiate from the Doctor Dashboard queue.
                  </div>
                )}
              </div>
            </div>

            {/* Admission Details */}
            <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(236,72,153,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📋</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Admission Details</h3>
              </div>
              <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '18px 20px' }}>

                <Field label="Reason for Admission" span={4} required>
                  <textarea
                    name="reasonForAdmission"
                    className="form-input"
                    rows="3"
                    value={form.reasonForAdmission}
                    onChange={handleChange}
                    placeholder="e.g. Post-operative care following appendectomy, requires monitoring and IV antibiotics..."
                    style={{ resize: 'vertical' }}
                  />
                </Field>

                <Field label="Primary Diagnosis" span={2} required>
                  <input type="text" name="primaryDiagnosis" className="form-input" value={form.primaryDiagnosis} onChange={handleChange} placeholder="e.g. Acute appendicitis" />
                </Field>
                <Field label="ICD-10 Code" span={2}>
                  <input type="text" name="icd10Code" className="form-input" value={form.icd10Code} onChange={handleChange} placeholder="e.g. K35.80" />
                </Field>

                <Field label="Ward Preference" span={2} required>
                  <select name="wardPreference" className="form-input" value={form.wardPreference} onChange={handleChange}>
                    <option value="">Select ward</option>
                    <option value="General Ward">General Ward</option>
                    <option value="Semi-Private">Semi-Private</option>
                    <option value="Private">Private</option>
                    <option value="ICU">ICU</option>
                    <option value="Maternity">Maternity</option>
                  </select>
                </Field>
                <Field label="Urgency Level" span={2} required>
                  <select name="urgencyLevel" className="form-input" value={form.urgencyLevel} onChange={handleChange}>
                    <option value="">Select urgency</option>
                    <option value="Routine">Routine</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </Field>

                <Field label="Estimated Duration">
                  <input type="number" name="estimatedDuration" className="form-input" value={form.estimatedDuration} onChange={handleChange} placeholder="e.g. 3" />
                </Field>
                <Field label="Duration Unit">
                  <select name="durationUnit" className="form-input" value={form.durationUnit} onChange={handleChange}>
                    <option value="Days">Days</option>
                    <option value="Weeks">Weeks</option>
                    <option value="Months">Months</option>
                  </select>
                </Field>
                <Field label="Admitting Doctor">
                  <input type="text" className="form-input" readOnly value={user?.name ? `Dr. ${user.name}` : ''} style={{ opacity: 0.7 }} />
                </Field>
                <Field label="Date & Time of Request">
                  <input type="text" className="form-input" readOnly value={currentDateTime} style={{ opacity: 0.7 }} />
                </Field>

              </div>
            </div>

            {/* Special Requirements */}
            <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
              <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245,158,11,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>⚕️</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Special Requirements</h3>
              </div>
              <div style={{ padding: '24px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                  {Object.keys(specialRequirements).map(key => (
                    <label key={key} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 18px', borderRadius: 12,
                      background: specialRequirements[key] ? 'rgba(59,130,246,0.08)' : 'var(--surface-2)',
                      border: `1px solid ${specialRequirements[key] ? 'rgba(59,130,246,0.3)' : 'var(--border)'}`,
                      cursor: 'pointer', userSelect: 'none', transition: 'all 0.2s',
                    }}>
                      <input
                        type="checkbox"
                        checked={specialRequirements[key]}
                        onChange={() => handleCheckbox(key)}
                        style={{ accentColor: 'var(--blue)', width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{key}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Initial Orders */}
            <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(13,148,136,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📝</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Initial Orders / Instructions for Nurse</h3>
              </div>
              <div style={{ padding: '24px' }}>
                <textarea
                  name="initialOrders"
                  className="form-input"
                  rows="4"
                  value={form.initialOrders}
                  onChange={handleChange}
                  placeholder="e.g. Start IV fluids NS 100ml/hr, NPO until further notice, check BP every 4 hours..."
                  style={{ resize: 'vertical', width: '100%' }}
                />
              </div>

              {/* Actions */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-lg" disabled={submitting || !patientId} style={{ minWidth: 200 }}>
                  {submitting ? '⏳ Sending...' : '📥 Send IPD Request'}
                </button>
              </div>
            </div>

          </form>
        )}
      </div>
    </>
  );
}
