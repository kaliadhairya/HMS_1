import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Barcode from 'react-barcode';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

const INITIAL_FORM_STATE = {
  patientType: 'other',
  name: '',
  first_name: '',
  last_name: '',
  age: '',
  gender: 'Male',
  blood_group: '',
  phoneNumber: '',
  alt_phone: '',
  email: '',
  emergency_contact_name: '',
  emergency_contact_relation: '',
  emergency_contact_phone: '',
  opdIndoor: 'OPD',
  testDate: new Date().toISOString().split('T')[0],
  registration_fee_paid: false,
  payment_mode: 'Cash',
};

export default function NewPatientPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('selection');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [registeredPatient, setRegisteredPatient] = useState(null);
  const printRef = useRef(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'first_name' || name === 'last_name') {
      const fn = name === 'first_name' ? value : formData.first_name;
      const ln = name === 'last_name' ? value : formData.last_name;
      setFormData(p => ({ ...p, [name]: value, name: `${fn} ${ln}`.trim() }));
    } else {
      setFormData(p => ({ ...p, [name]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/patients/hms', formData);
      setRegisteredPatient(res.data.data);
      toast.success('Patient registered successfully!');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to register patient');
      toast.error('Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open('', '', 'height=600,width=800');
    printWindow.document.write('<html><head><title>Registration Slip</title>');
    printWindow.document.write('<style>body{font-family:sans-serif;padding:40px;text-align:center} .slip{border:2px solid #000;padding:30px;border-radius:15px;display:inline-block;min-width:300px} h2{margin:0 0 10px 0} .uhid{font-size:1.5rem;font-weight:bold;margin:15px 0}</style>');
    printWindow.document.write('</head><body><div class="slip">');
    printWindow.document.write(printRef.current.innerHTML);
    printWindow.document.write('</div></body></html>');
    printWindow.document.close();
    printWindow.print();
  };

  if (registeredPatient) {
    return (
      <>
        <Navbar />
        <div className="container py-4">
          <div className="card hms-anim-1" style={{ maxWidth: 650, margin: '40px auto', textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: '4rem', marginBottom: 20, animation: 'hmsCountPop 0.6s ease both' }}>🎉</div>
            <h2 style={{ fontSize: '2rem', marginBottom: 12 }}>Registration Complete</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>
              The patient has been added to the master directory and a unique UHID has been issued.
            </p>

            <div ref={printRef} className="registration-slip" style={{
              marginBottom: 32,
              background: 'var(--surface-2)',
              padding: '30px',
              borderRadius: 20,
              border: '2px dashed var(--green-border)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Medical Record Identification</div>
              <h3 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800 }}>{registeredPatient.name}</h3>
              <div className="uhid" style={{
                margin: '10px 0',
                fontSize: '1.8rem',
                fontWeight: 900,
                color: 'var(--text-primary)',
                letterSpacing: '0.05em'
              }}>
                {registeredPatient.uhid}
              </div>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontWeight: 500 }}>
                {registeredPatient.age} Yrs • {registeredPatient.gender} • {registeredPatient.blood_group || 'N/A'}
              </p>
              <div style={{ marginTop: 15, background: '#fff', padding: 10, borderRadius: 8 }}>
                <Barcode value={registeredPatient.uhid} height={60} width={2} displayValue={false} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
              <button className="btn btn-primary btn-lg" onClick={handlePrint}>🖨️ Print Slip</button>
              <button className="btn btn-outline btn-lg" onClick={() => navigate(`/hms/patients/${registeredPatient.id}`)}>
                👤 View Profile
              </button>
              <button
                className="btn btn-ghost btn-lg"
                onClick={() => {
                  setRegisteredPatient(null);
                  setFormData(INITIAL_FORM_STATE);
                  setStep('selection');
                }}
              >
                + Register Another Patient
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (step === 'selection') {
    return (
      <>
        <Navbar />
        <div className="container py-4">
          <div className="hms-page-header">
            <div>
              <h1>
                <span
                  className="header-icon"
                  style={{
                    background: 'var(--blue-light)',
                    borderColor: 'var(--blue-border)',
                    color: 'var(--blue)',
                  }}
                >
                  📝
                </span>
                New Patient Intake
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
                Select the patient category to begin the registration process.
              </p>
            </div>
            <div className="header-actions">
              <button className="btn btn-ghost" onClick={() => navigate(-1)}>
                ← Back
              </button>
            </div>
          </div>

          <div style={{ maxWidth: 460, margin: '30px auto' }}>
            {/* General Patient (External) Card */}
            <div
              className="hms-stat-card hms-anim-1"
              style={{
                padding: '40px 32px',
                borderTop: '6px solid var(--blue)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                cursor: 'pointer',
                borderRadius: 16,
              }}
              onClick={() => {
                setFormData(p => ({ ...p, patientType: 'other' }));
                setStep('form');
              }}
            >
              <div
                style={{
                  fontSize: '3rem',
                  marginBottom: 24,
                  background: 'var(--blue-light)',
                  width: 100,
                  height: 100,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  border: '1px solid var(--blue-border)',
                }}
              >
                👨‍👩‍👧‍👦
              </div>
              <h3 style={{ fontSize: '1.6rem', marginBottom: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
                General Patient (External)
              </h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 30, fontSize: '1rem', lineHeight: 1.6 }}>
                Walk-in patients or external referrals. Requires basic contact information for registration.
              </p>
              <button
                type="button"
                className="btn btn-blue btn-full"
                style={{ height: 48, fontSize: '1rem', fontWeight: 700 }}
              >
                Begin General Registration →
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="hms-page-header">
          <div>
            <h1>
              <span
                className="header-icon"
                style={{
                  background: 'var(--blue-light)',
                  borderColor: 'var(--blue-border)',
                  color: 'var(--blue)',
                }}
              >
                👨‍👩‍👧‍👦
              </span>
              New Patient Intake
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Provide demographic and contact details for patient intake and medical record creation.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={() => setStep('selection')}>
              ← Change Category
            </button>
          </div>
        </div>

        {error && <div className="alert alert-error hms-anim-1" style={{ marginBottom: 24 }}>{error}</div>}

        <form onSubmit={handleSubmit} className="hms-anim-2">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap: 24, alignItems: 'start' }}>
            {/* Left Column: Demographics & Contact */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Demographics */}
              <div className="card" style={{ padding: 28 }}>
                <div className="card-section-title">Demographics & Identity</div>
                <div className="form-grid-2" style={{ marginBottom: 20 }}>
                  <div className="form-group">
                    <label className="form-label">First Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      name="first_name"
                      required
                      value={formData.first_name}
                      onChange={handleChange}
                      placeholder="e.g. Ramesh"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input
                      type="text"
                      className="form-input"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleChange}
                      placeholder="e.g. Kumar"
                    />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Age *</label>
                    <input
                      type="number"
                      className="form-input"
                      name="age"
                      required
                      value={formData.age}
                      onChange={handleChange}
                      min="0"
                      max="130"
                      placeholder="e.g. 35"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Gender *</label>
                    <select className="form-input" name="gender" required value={formData.gender} onChange={handleChange}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Blood Group</label>
                    <select className="form-input" name="blood_group" value={formData.blood_group} onChange={handleChange}>
                      <option value="">Unknown</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                        <option key={bg} value={bg}>
                          {bg}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Contact Information */}
              <div className="card" style={{ padding: 28 }}>
                <div className="card-section-title">Communication Details</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Primary Mobile *</label>
                    <input
                      type="tel"
                      className="form-input"
                      name="phoneNumber"
                      required
                      pattern="\d{10}"
                      value={formData.phoneNumber}
                      onChange={handleChange}
                      placeholder="10-digit mobile number"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Alternate Mobile</label>
                    <input
                      type="tel"
                      className="form-input"
                      name="alt_phone"
                      value={formData.alt_phone}
                      onChange={handleChange}
                      placeholder="Optional number"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email Address</label>
                    <input
                      type="email"
                      className="form-input"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="patient@example.com"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Emergency Contact */}
              <div className="card" style={{ padding: 30, borderLeft: '4px solid #ef4444' }}>
                <div className="card-section-title" style={{ color: '#ef4444' }}>Emergency Contact</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="form-group">
                    <label className="form-label">Guardian/Kin Name</label>
                    <input type="text" className="form-input" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Relationship</label>
                    <input type="text" className="form-input" name="emergency_contact_relation" value={formData.emergency_contact_relation} onChange={handleChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Emergency Phone</label>
                    <input type="tel" className="form-input" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} />
                  </div>
                </div>
              </div>

              {/* Registration Fee */}
              <div className="card" style={{ padding: 30, borderLeft: '4px solid #f59e0b' }}>
                <div className="card-section-title" style={{ color: '#f59e0b' }}>Registration Fee</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>₹ 150</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>One-time registration charge</div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
                    <div
                      onClick={() => setFormData(p => ({ ...p, registration_fee_paid: !p.registration_fee_paid }))}
                      style={{
                        width: 48, height: 26, borderRadius: 13,
                        background: formData.registration_fee_paid ? '#10b981' : '#cbd5e0',
                        position: 'relative', transition: 'background 0.25s', cursor: 'pointer',
                      }}
                    >
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%', background: '#fff',
                        position: 'absolute', top: 2,
                        left: formData.registration_fee_paid ? 24 : 2,
                        transition: 'left 0.25s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: formData.registration_fee_paid ? '#10b981' : 'var(--text-muted)' }}>
                      {formData.registration_fee_paid ? 'Paid' : 'Not Paid'}
                    </span>
                  </label>
                </div>
                {formData.registration_fee_paid && (
                  <div style={{ animation: 'hmsSlideDown 0.25s ease' }}>
                    <label className="form-label" style={{ marginBottom: 8 }}>Payment Mode</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {['Cash', 'UPI', 'Card'].map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setFormData(p => ({ ...p, payment_mode: mode }))}
                          style={{
                            flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 700, fontSize: '0.85rem',
                            cursor: 'pointer', transition: 'all 0.2s', border: '2px solid',
                            background: formData.payment_mode === mode ? (mode === 'Cash' ? 'rgba(16,185,129,0.08)' : mode === 'UPI' ? 'rgba(99,102,241,0.08)' : 'rgba(59,130,246,0.08)') : 'var(--surface-2)',
                            borderColor: formData.payment_mode === mode ? (mode === 'Cash' ? '#10b981' : mode === 'UPI' ? '#6366f1' : '#3b82f6') : 'var(--border)',
                            color: formData.payment_mode === mode ? (mode === 'Cash' ? '#10b981' : mode === 'UPI' ? '#6366f1' : '#3b82f6') : 'var(--text-muted)',
                          }}
                        >
                          {mode === 'Cash' ? '💵' : mode === 'UPI' ? '📱' : '💳'} {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Section */}
              <div className="card" style={{ padding: 30, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 20, textAlign: 'center' }}>
                  By clicking Register, you confirm that all provided information is accurate to the best of your knowledge.
                </p>
                <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={loading} style={{ height: 60, fontSize: '1.1rem' }}>
                  {loading ? <span className="spinner" /> : 'Complete Registration'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}
