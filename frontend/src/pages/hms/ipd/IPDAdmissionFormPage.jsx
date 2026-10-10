import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ClipboardList, NotebookPen, Send, ShieldPlus, TriangleAlert, UserRound } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';

const Field = ({ label, htmlFor, children, span, required }) => (
  <div className="form-group" style={span ? { gridColumn: `span ${span}` } : {}}>
    <label className="form-label" htmlFor={htmlFor}>
      {label}{required && <span style={{ color: 'var(--red)' }} aria-hidden="true"> *</span>}
      {required && <span className="sr-only"> (required)</span>}
    </label>
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
      toast.error('Could not load patient details');
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
      return toast.error('Fill in all required fields marked with *');
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
      toast.success('IPD admission request sent');
      navigate('/ipd/requests');
    } catch (err) {
      console.error(err);
      toast.error('Could not send IPD request');
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
      <main className="app-page">
        <PageHeader
          title="IPD admission request"
          description="Submit an inpatient admission request for review and bed assignment."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          )}
        />

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="stack">

            {/* Patient */}
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><UserRound size={16} aria-hidden="true" /> Patient</h2></div>
              <div className="panel-pad">
                {patientInfo ? (
                  <div className="facts">
                    {[
                      { label: 'Patient name', value: patientInfo.name },
                      { label: 'UHID', value: patientInfo.uhid || 'N/A', mono: true },
                      { label: 'Gender / age', value: `${patientInfo.gender}, ${patientInfo.age} yrs` },
                      { label: 'Employee no.', value: patientInfo.empNumber || 'N/A' },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="fact-label">{item.label}</div>
                        <div className={`fact-value${item.mono ? ' mono' : ''}`} style={{ fontWeight: 600 }}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="alert-strip alert-danger" role="alert" style={{ margin: 0 }}>
                    <TriangleAlert size={16} aria-hidden="true" /> No patient selected. Start the request from the doctor dashboard queue.
                  </div>
                )}
              </div>
            </section>

            {/* Admission details */}
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Admission details</h2></div>
              <div className="panel-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px 18px' }}>

                <Field label="Reason for admission" htmlFor="adm-reason" span={4} required>
                  <textarea
                    id="adm-reason"
                    name="reasonForAdmission"
                    className="form-textarea"
                    rows="3"
                    value={form.reasonForAdmission}
                    onChange={handleChange}
                    placeholder="e.g. Post-operative care following appendectomy, requires monitoring and IV antibiotics"
                  />
                </Field>

                <Field label="Primary diagnosis" htmlFor="adm-diagnosis" span={2} required>
                  <input id="adm-diagnosis" type="text" name="primaryDiagnosis" className="form-input" value={form.primaryDiagnosis} onChange={handleChange} placeholder="e.g. Acute appendicitis" />
                </Field>
                <Field label="ICD-10 code" htmlFor="adm-icd" span={2}>
                  <input id="adm-icd" type="text" name="icd10Code" className="form-input" value={form.icd10Code} onChange={handleChange} placeholder="e.g. K35.80" />
                </Field>

                <Field label="Ward preference" htmlFor="adm-ward" span={2} required>
                  <select id="adm-ward" name="wardPreference" className="form-select" value={form.wardPreference} onChange={handleChange}>
                    <option value="">Select ward</option>
                    <option value="General Ward">General Ward</option>
                    <option value="Semi-Private">Semi-Private</option>
                    <option value="Private">Private</option>
                    <option value="ICU">ICU</option>
                    <option value="Maternity">Maternity</option>
                  </select>
                </Field>
                <Field label="Urgency" htmlFor="adm-urgency" span={2} required>
                  <select id="adm-urgency" name="urgencyLevel" className="form-select" value={form.urgencyLevel} onChange={handleChange}>
                    <option value="">Select urgency</option>
                    <option value="Routine">Routine</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </Field>

                <Field label="Estimated duration" htmlFor="adm-duration">
                  <input id="adm-duration" type="number" name="estimatedDuration" className="form-input" value={form.estimatedDuration} onChange={handleChange} placeholder="e.g. 3" />
                </Field>
                <Field label="Duration unit" htmlFor="adm-unit">
                  <select id="adm-unit" name="durationUnit" className="form-select" value={form.durationUnit} onChange={handleChange}>
                    <option value="Days">Days</option>
                    <option value="Weeks">Weeks</option>
                    <option value="Months">Months</option>
                  </select>
                </Field>
                <Field label="Admitting doctor" htmlFor="adm-doctor">
                  <input id="adm-doctor" type="text" className="form-input" readOnly value={user?.name ? `Dr. ${user.name}` : ''} style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} />
                </Field>
                <Field label="Requested at" htmlFor="adm-requested">
                  <input id="adm-requested" type="text" className="form-input" readOnly value={currentDateTime} style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }} />
                </Field>

              </div>
            </section>

            {/* Special requirements */}
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><ShieldPlus size={16} aria-hidden="true" /> Special requirements</h2></div>
              <div className="panel-pad">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                  {Object.keys(specialRequirements).map(key => (
                    <label
                      key={key}
                      className="check-row"
                      style={{
                        padding: '10px 12px', borderRadius: 8,
                        background: specialRequirements[key] ? 'var(--primary-light)' : 'var(--surface)',
                        border: `1px solid ${specialRequirements[key] ? 'var(--primary-border)' : 'var(--border)'}`,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={specialRequirements[key]}
                        onChange={() => handleCheckbox(key)}
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                </div>
              </div>
            </section>

            {/* Initial orders */}
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><NotebookPen size={16} aria-hidden="true" /> Initial orders and instructions for nursing</h2></div>
              <div className="panel-pad">
                <label className="sr-only" htmlFor="adm-orders">Initial orders and instructions for nursing</label>
                <textarea
                  id="adm-orders"
                  name="initialOrders"
                  className="form-textarea"
                  rows="4"
                  value={form.initialOrders}
                  onChange={handleChange}
                  placeholder="e.g. Start IV fluids NS 100ml/hr, NPO until further notice, check BP every 4 hours"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Actions */}
              <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 10px 10px' }}>
                <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-md" disabled={submitting || !patientId}>
                  <Send size={16} aria-hidden="true" /> {submitting ? 'Sending…' : 'Send IPD request'}
                </button>
              </div>
            </section>

          </form>
        )}
      </main>
    </>
  );
}
