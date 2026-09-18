import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Barcode from 'react-barcode';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

const PATIENT_CATEGORY_CONFIG = {
  corporate_employee: {
    icon: '🏢',
    formTitle: 'Corporate Beneficiary Registration',
    title: 'Corporate Employee / Dependent',
    accent: 'var(--green)',
    accentBg: 'var(--green-light)',
    accentBorder: 'var(--green-border)',
  },
  cisf_employee: {
    icon: '🛡️',
    logo: '/cisf-logo.svg',
    formTitle: 'CISF Employee Registration',
    title: 'CISF Employee',
    accent: 'var(--red)',
    accentBg: 'var(--red-light)',
    accentBorder: 'var(--red-border)',
  },
  other: {
    icon: '👨‍⚕️',
    formTitle: 'General Patient Registration',
    title: 'General Patient (External)',
    accent: 'var(--blue)',
    accentBg: 'var(--blue-light)',
    accentBorder: 'var(--blue-border)',
  },
};

export default function NewPatientPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('selection'); // 'selection' or 'form'

  // Registration Form State
  const [formData, setFormData] = useState({
    patientType: 'other',
    name: '', first_name: '', last_name: '', age: '', gender: 'Male',
    blood_group: '', phoneNumber: '', alt_phone: '', email: '',
    house_no: '', street: '', city: '', state: '', pin: '', country: 'India',
    emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '',
    empNumber: '', relationship: 'Self',
    opdIndoor: 'OPD', testDate: new Date().toISOString().split('T')[0],
    registration_fee_paid: false, payment_mode: 'Cash'
  });

  const [registeredPatient, setRegisteredPatient] = useState(null);
  const printRef = useRef(null);

  // Corporate Dependents Auto-Fill
  const [dependents, setDependents] = useState([]);
  const [isSearchingDependents, setIsSearchingDependents] = useState(false);
  const lastFetchedEmpRef = useRef('');

  const fetchDependents = async (empNum, force = false) => {
    if (!empNum || !empNum.trim()) return;
    const trimmed = empNum.trim();
    // Don't re-fetch if same emp number (prevents onBlur resetting the selected dependent)
    if (!force && lastFetchedEmpRef.current === trimmed) return;
    lastFetchedEmpRef.current = trimmed;
    setIsSearchingDependents(true);
    setDependents([]);
    try {
      const { data } = await api.get(`/patients/hms/emp/${encodeURIComponent(trimmed)}`);
      if (data.success && data.data.length > 0) {
        setDependents(data.data);
        toast.success(`Found ${data.data.length} profiles — please select who to register`);
      } else {
        toast('No dependents found for this employee number', { icon: 'ℹ️' });
      }
    } catch (err) {
      console.error('Error fetching dependents:', err);
      toast.error('Failed to fetch dependents');
    } finally {
      setIsSearchingDependents(false);
    }
  };

  const selectDependent = (dep) => {
    const nameParts = (dep.name || '').trim().split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    setFormData(f => ({
      ...f,
      first_name: firstName,
      last_name: lastName,
      name: dep.name || '',
      age: dep.age ? String(dep.age) : '',
      gender: dep.gender || 'Male',
      relationship: dep.relationship || 'Self',
    }));
    toast.success(`${dep.relationship === 'Self' ? 'Employee' : dep.relationship} details auto-filled!`);
  };

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
              <button className="btn btn-ghost btn-lg" onClick={() => {
                  setRegisteredPatient(null);
                  setStep('selection');
                  setFormData(p => ({...p, first_name: '', last_name: '', name: '', age: '', phoneNumber: '', empNumber: '', relationship: 'Self', aadhaar: ''}));
                }}>
                New Registration
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
                <span className="header-icon">📝</span>
                New Patient Intake
              </h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
                Select the patient category to begin the registration process.
              </p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginTop: '10px' }}>
            {/* Corporate Employee Card */}
            <div className="hms-stat-card hms-anim-1" style={{
              padding: 40,
              borderTop: '6px solid var(--green)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              minHeight: 380
            }}
            onClick={() => {
              setFormData(p => ({ ...p, patientType: 'corporate_employee' }));
              setStep('form');
            }}
            >
              <div style={{
                marginBottom: 24,
                background: '#fff',
                width: 100, height: 100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                border: '3px solid rgba(16,185,129,0.35)',
                boxShadow: '0 8px 24px rgba(16,185,129,0.25)',
                overflow: 'hidden',
              }}>
                <img src="/logo.png" alt="HMS Logo" style={{ width: 72, height: 72, objectFit: 'contain' }} />
              </div>
              <h3 style={{ fontSize: '1.6rem', marginBottom: 12, fontWeight: 800 }}>Corporate Employee / Dependent</h3>
              <p style={{ color: 'var(--text-secondary)', flex: 1, marginBottom: 30, fontSize: '1rem', lineHeight: 1.6 }}>
                Full medical coverage benefits for corporate partnered employees and their registered family members.
              </p>
              <button className="btn btn-primary btn-full">
                Begin Corporate Registration →
              </button>
            </div>

            {/* CISF Employee Card */}
            <div className="hms-stat-card hms-anim-2" style={{
              padding: 40,
              borderTop: '6px solid var(--red)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              minHeight: 380
            }}
            onClick={() => {
              setFormData(p => ({ ...p, patientType: 'cisf_employee', empNumber: '', relationship: 'Self', registration_fee_paid: false }));
              setStep('form');
            }}
            >
              <div style={{
                marginBottom: 24,
                background: '#fff',
                width: 100, height: 100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                border: '1px solid var(--red-border)',
                overflow: 'hidden'
              }}>
                <img src="/cisf-logo.svg" alt="CISF Logo" style={{ width: 78, height: 78, objectFit: 'contain' }} />
              </div>
              <h3 style={{ fontSize: '1.6rem', marginBottom: 12, fontWeight: 800 }}>CISF Employee</h3>
              <p style={{ color: 'var(--text-secondary)', flex: 1, marginBottom: 30, fontSize: '1rem', lineHeight: 1.6 }}>
                Dedicated registration for CISF employees using the same manual intake workflow and contact details.
              </p>
              <button className="btn btn-full" style={{ background: 'var(--red)', color: 'var(--text-inverse)', borderColor: 'var(--red)' }}>
                Begin CISF Registration →
              </button>
            </div>

            {/* Other Patient Card */}
            <div className="hms-stat-card hms-anim-3" style={{
              padding: 40,
              borderTop: '6px solid var(--blue)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              minHeight: 380
            }}
            onClick={() => {
              setFormData(p => ({ ...p, patientType: 'other', empNumber: '', relationship: 'Self' }));
              setStep('form');
            }}
            >
              <div style={{
                fontSize: '3rem',
                marginBottom: 24,
                background: 'var(--blue-light)',
                width: 100, height: 100,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%',
                border: '1px solid var(--blue-border)'
              }}>👨‍👩‍👧‍👦</div>
              <h3 style={{ fontSize: '1.6rem', marginBottom: 12, fontWeight: 800 }}>General Patient (External)</h3>
              <p style={{ color: 'var(--text-secondary)', flex: 1, marginBottom: 30, fontSize: '1rem', lineHeight: 1.6 }}>
                Walk-in patients or external referrals. Requires basic contact information for registration.
              </p>
              <button className="btn btn-blue btn-full">
                Begin General Registration →
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const isCorporate = formData.patientType === 'corporate_employee';
  const isCISF = formData.patientType === 'cisf_employee';
  const isGeneral = formData.patientType === 'other';
  const categoryConfig = PATIENT_CATEGORY_CONFIG[formData.patientType] || PATIENT_CATEGORY_CONFIG.other;

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon" style={{ background: categoryConfig.accentBg, borderColor: categoryConfig.accentBorder }}>
                {categoryConfig.logo ? (
                  <img src={categoryConfig.logo} alt="" style={{ width: 30, height: 30, objectFit: 'contain' }} />
                ) : categoryConfig.icon}
              </span>
              {categoryConfig.formTitle}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Please provide accurate demographic and contact details for medical record keeping.
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
          {/* Corporate Search Section */}
          {isCorporate && (
            <div className="card" style={{ marginBottom: 24, borderLeft: '5px solid var(--green)', padding: 30 }}>
              <div className="card-section-title" style={{ color: 'var(--green)', marginBottom: 20 }}>
                Employment Verification & Auto-Fill
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', marginBottom: dependents.length > 0 ? '24px' : '0' }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Employee Service Number *</label>
                  <input
                    type="text" className="form-input" name="empNumber" required
                    value={formData.empNumber} onChange={handleChange}
                    placeholder="e.g. 10190"
                    onBlur={(e) => fetchDependents(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        fetchDependents(e.target.value);
                      }
                    }}
                    style={{ fontSize: '1.1rem', padding: '12px 18px' }}
                  />
                </div>
                <button
                  type="button" className="btn btn-primary"
                  style={{ height: '52px', padding: '0 25px' }}
                  onClick={() => fetchDependents(formData.empNumber, true)}
                  disabled={isSearchingDependents}
                >
                  {isSearchingDependents ? 'Searching...' : '🔍 Fetch Dependents'}
                </button>
              </div>

              {dependents.length > 0 && (
                <div className="hms-anim-3" style={{
                  marginTop: 20, padding: 24, background: 'var(--surface-2)',
                  borderRadius: 16, border: '1px solid var(--green-border)'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--green)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Select a profile to auto-fill demographic data:
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                    {dependents.map((dep, idx) => (
                      <div
                        key={idx}
                        onClick={() => selectDependent(dep)}
                        className="hms-action-btn"
                        style={{ padding: '15px 20px', borderLeft: '4px solid var(--green)' }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{dep.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            {dep.relationship} • {dep.age}Y • {dep.gender}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Demographics */}
              <div className="card" style={{ padding: 30 }}>
                <div className="card-section-title">Demographics & Identity</div>
                <div className="form-grid-2" style={{ marginBottom: 20 }}>
                  <div className="form-group">
                    <label className="form-label">First Name *</label>
                    <input type="text" className="form-input" name="first_name" required value={formData.first_name} onChange={handleChange} readOnly={isCorporate} style={{ backgroundColor: isCorporate ? 'var(--surface-2)' : '' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name</label>
                    <input type="text" className="form-input" name="last_name" value={formData.last_name} onChange={handleChange} readOnly={isCorporate} style={{ backgroundColor: isCorporate ? 'var(--surface-2)' : '' }} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Age *</label>
                    <input type="number" className="form-input" name="age" required value={formData.age} onChange={handleChange} min="0" readOnly={isCorporate} style={{ backgroundColor: isCorporate ? 'var(--surface-2)' : '' }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Gender *</label>
                    <select className="form-input" name="gender" required value={formData.gender} onChange={handleChange} style={{ pointerEvents: isCorporate ? 'none' : 'auto', backgroundColor: isCorporate ? 'var(--surface-2)' : '' }}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Blood Group</label>
                    <select className="form-input" name="blood_group" value={formData.blood_group} onChange={handleChange}>
                      <option value="">Unknown</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  </div>
                  {isCorporate && (
                    <div className="form-group">
                      <label className="form-label">Relationship *</label>
                      <select className="form-input" name="relationship" required value={formData.relationship} onChange={handleChange} style={{ pointerEvents: isCorporate ? 'none' : 'auto', backgroundColor: isCorporate ? 'var(--surface-2)' : '' }}>
                        {['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Information */}
              <div className="card" style={{ padding: 30 }}>
                <div className="card-section-title">Communication Details</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Primary Mobile {isGeneral ? '*' : ''}</label>
                    <input type="tel" className="form-input" name="phoneNumber" required={isGeneral} pattern="\d{10}" value={formData.phoneNumber} onChange={handleChange} placeholder="10-digit number" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Alternate Mobile</label>
                    <input type="tel" className="form-input" name="alt_phone" value={formData.alt_phone} onChange={handleChange} />
                  </div>
                  {isCISF ? (
                    <div className="form-group">
                      <label className="form-label">Employee Number</label>
                      <input
                        type="text"
                        className="form-input"
                        name="empNumber"
                        value={formData.empNumber}
                        onChange={handleChange}
                        placeholder="CISF employee number"
                      />
                    </div>
                  ) : (
                    <div className="form-group">
                      <label className="form-label">Email Address</label>
                      <input type="email" className="form-input" name="email" value={formData.email} onChange={handleChange} />
                    </div>
                  )}
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

              {/* Registration Fee - General Patients Only */}
              {isGeneral && (
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
              )}

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
