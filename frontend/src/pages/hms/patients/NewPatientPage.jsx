import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Barcode from 'react-barcode';
import api from '../../../api/axios';
import { ArrowLeft, ArrowRight, BadgeIndianRupee, CircleCheck, IdCard, Phone, Printer, ShieldAlert, UserPlus, UserRound, Users } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

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
      toast.success('Patient registered');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to register patient');
      toast.error('Registration failed');
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
        <main className="app-page">
          <PageHeader
            title="Registration complete"
            description="The patient has been added to the master directory and a unique UHID has been issued."
          />
          <section className="panel panel-pad" style={{ maxWidth: 650, margin: '0 auto', textAlign: 'center' }}>
            <div className="alert-strip alert-info" role="status" style={{ justifyContent: 'center' }}>
              <CircleCheck size={16} aria-hidden="true" /> Registered as {registeredPatient.uhid}
            </div>

            {/* Printed via handlePrint: markup inside printRef is copied into the print window unchanged. */}
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
              {/* Barcode keeps a white background so it stays scannable in dark mode and on paper. */}
              <div style={{ marginTop: 15, background: '#fff', padding: 10, borderRadius: 8 }}>
                <Barcode value={registeredPatient.uhid} height={60} width={2} displayValue={false} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-md" onClick={handlePrint}>
                <Printer size={16} aria-hidden="true" /> Print slip
              </button>
              <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate(`/hms/patients/${registeredPatient.id}`)}>
                <UserRound size={16} aria-hidden="true" /> View profile
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-md"
                onClick={() => {
                  setRegisteredPatient(null);
                  setFormData(INITIAL_FORM_STATE);
                  setStep('selection');
                }}
              >
                <UserPlus size={16} aria-hidden="true" /> Register another patient
              </button>
            </div>
          </section>
        </main>
      </>
    );
  }

  if (step === 'selection') {
    return (
      <>
        <Navbar />
        <main className="app-page">
          <PageHeader
            title="New patient intake"
            description="Choose the patient category to start registration."
            actions={(
              <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
                <ArrowLeft size={16} aria-hidden="true" /> Back
              </button>
            )}
          />

          <section
            className="panel panel-pad"
            style={{ maxWidth: 460, margin: '0 auto', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            onClick={() => {
              setFormData(p => ({ ...p, patientType: 'other' }));
              setStep('form');
            }}
          >
            <span className="empty-state-icon" aria-hidden="true"><Users size={22} strokeWidth={1.75} /></span>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 650 }}>General patient (external)</h2>
            <p className="muted" style={{ maxWidth: 360 }}>
              Walk-in patients or external referrals. Needs basic contact information to register.
            </p>
            <button type="button" className="btn btn-primary btn-md btn-full">
              Begin general registration <ArrowRight size={16} aria-hidden="true" />
            </button>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="New patient intake"
          description="Demographic and contact details for intake and medical record creation."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setStep('selection')}>
              <ArrowLeft size={16} aria-hidden="true" /> Change category
            </button>
          )}
        />

        {error && <div className="alert-strip alert-danger" role="alert">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="split-2" style={{ alignItems: 'start' }}>
            {/* Left column: demographics and contact */}
            <div className="stack">
              <section className="panel panel-pad">
                <h2 className="panel-title"><IdCard size={16} aria-hidden="true" /> Demographics and identity</h2>
                <div className="form-row-2" style={{ marginBottom: 14 }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-first-name">First name *</label>
                    <input
                      id="np-first-name"
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
                    <label className="form-label" htmlFor="np-last-name">Last name</label>
                    <input
                      id="np-last-name"
                      type="text"
                      className="form-input"
                      name="last_name"
                      value={formData.last_name}
                      onChange={handleChange}
                      placeholder="e.g. Kumar"
                    />
                  </div>
                </div>
                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-age">Age *</label>
                    <input
                      id="np-age"
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
                    <label className="form-label" htmlFor="np-gender">Gender *</label>
                    <select id="np-gender" className="form-select" name="gender" required value={formData.gender} onChange={handleChange}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-blood-group">Blood group</label>
                    <select id="np-blood-group" className="form-select" name="blood_group" value={formData.blood_group} onChange={handleChange}>
                      <option value="">Unknown</option>
                      {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((bg) => (
                        <option key={bg} value={bg}>
                          {bg}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="panel panel-pad">
                <h2 className="panel-title"><Phone size={16} aria-hidden="true" /> Contact details</h2>
                <div className="form-grid-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-phone">Primary mobile *</label>
                    <input
                      id="np-phone"
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
                    <label className="form-label" htmlFor="np-alt-phone">Alternate mobile</label>
                    <input
                      id="np-alt-phone"
                      type="tel"
                      className="form-input"
                      name="alt_phone"
                      value={formData.alt_phone}
                      onChange={handleChange}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-email">Email address</label>
                    <input
                      id="np-email"
                      type="email"
                      className="form-input"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="patient@example.com"
                    />
                  </div>
                </div>
              </section>
            </div>

            <div className="stack">
              <section className="panel panel-pad">
                <h2 className="panel-title"><ShieldAlert size={16} aria-hidden="true" /> Emergency contact</h2>
                <div className="stack-sm">
                  <div className="form-group">
                    <label className="form-label" htmlFor="np-ec-name">Guardian or next of kin</label>
                    <input id="np-ec-name" type="text" className="form-input" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} />
                  </div>
                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="np-ec-relation">Relationship</label>
                      <input id="np-ec-relation" type="text" className="form-input" name="emergency_contact_relation" value={formData.emergency_contact_relation} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="np-ec-phone">Emergency phone</label>
                      <input id="np-ec-phone" type="tel" className="form-input" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} />
                    </div>
                  </div>
                </div>
              </section>

              <section className="panel panel-pad">
                <h2 className="panel-title"><BadgeIndianRupee size={16} aria-hidden="true" /> Registration fee</h2>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div className="kpi-value" style={{ marginTop: 0 }}>₹ 150</div>
                    <div className="kpi-sub">One-time registration charge</div>
                  </div>
                  <span className={`status ${formData.registration_fee_paid ? 'status-success' : 'status-neutral'}`}>
                    {formData.registration_fee_paid ? 'Paid' : 'Not paid'}
                  </span>
                </div>
                <label className="check-row" htmlFor="np-fee-paid">
                  <input
                    id="np-fee-paid"
                    type="checkbox"
                    checked={formData.registration_fee_paid}
                    onChange={() => setFormData(p => ({ ...p, registration_fee_paid: !p.registration_fee_paid }))}
                  />
                  <span>Registration fee collected</span>
                </label>
                {formData.registration_fee_paid && (
                  <div className="form-group" style={{ marginTop: 14 }}>
                    <span className="form-label" id="np-payment-mode-label">Payment mode</span>
                    <div className="segmented" role="radiogroup" aria-labelledby="np-payment-mode-label">
                      {['Cash', 'UPI', 'Card'].map(mode => (
                        <button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={formData.payment_mode === mode}
                          className={formData.payment_mode === mode ? 'is-active' : ''}
                          onClick={() => setFormData(p => ({ ...p, payment_mode: mode }))}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="panel panel-pad" style={{ background: 'var(--surface-2)' }}>
                <p className="muted" style={{ marginBottom: 14 }}>
                  By registering, you confirm the information provided is accurate to the best of your knowledge.
                </p>
                <button type="submit" className="btn btn-primary btn-md btn-full" disabled={loading}>
                  {loading ? 'Registering…' : 'Complete registration'}
                </button>
              </section>
            </div>
          </div>
        </form>
      </main>
    </>
  );
}
