import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  ClipboardList, Eye, FileText, FlaskConical, Hospital, LogOut, Pencil, Pill, Plus, Printer, Stethoscope, X,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Glyph from './ui/Glyph';
import Modal from './ui/Modal';

// Styles below are used by the print preview only (print layout kept as designed).
const sectionHeaderStyle = {
  fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
  padding: '10px 16px', background: 'rgba(45,55,72,0.04)', borderRadius: '10px',
  marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
  color: '#2d3748', borderLeft: '3px solid #c6943e'
};
const previewLabelStyle = { fontSize: '0.75rem', fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.04em' };
const previewValueStyle = { margin: '4px 0 0', fontSize: '0.9rem', color: '#1a202c' };

// Helper to render a 2-col info row in the print preview
const InfoRow = ({ label, value }) => (
  <div style={{ padding: '6px 0' }}>
    <div style={previewLabelStyle}>{label}</div>
    <div style={previewValueStyle}>{value || '—'}</div>
  </div>
);

// Section of the edit form.
const FormSection = ({ icon: Icon, title, children }) => (
  <section className="panel">
    <div className="panel-head"><h3 className="panel-title" style={{ margin: 0 }}><Icon size={16} aria-hidden="true" /> {title}</h3></div>
    <div className="panel-pad stack-sm">{children}</div>
  </section>
);

// Dynamic row list for medications / investigations / follow-up. Each input is labelled "<Column> <row>".
function DynamicTable({ columns, rows, setRows, addLabel }) {
  const addRow = () => setRows([...rows, columns.reduce((o, c) => ({ ...o, [c.key]: '' }), {})]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i, key, val) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], [key]: val };
    setRows(copy);
  };

  return (
    <div>
      <table className="mini-table">
        <thead>
          <tr>
            {columns.map(c => <th key={c.key}>{c.label}</th>)}
            <th style={{ width: 40 }}><span className="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key}>
                  <input
                    className="form-input"
                    aria-label={`${c.label} ${i + 1}`}
                    value={row[c.key]}
                    onChange={e => updateRow(i, c.key, e.target.value)}
                    placeholder={c.placeholder || ''}
                  />
                </td>
              ))}
              <td>
                <button type="button" className="icon-btn" onClick={() => removeRow(i)} aria-label={`Remove row ${i + 1}`}>
                  <X size={16} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-ghost btn-sm" onClick={addRow} style={{ marginTop: 8 }}>
        <Plus size={14} aria-hidden="true" /> {addLabel || 'Add row'}
      </button>
    </div>
  );
}

const Field = ({ id, label, required, children }) => (
  <div className="form-group">
    <label className="form-label" htmlFor={id}>
      {label}{required && <span style={{ color: 'var(--red)' }} aria-hidden="true"> *</span>}
    </label>
    {children}
  </div>
);

export default function DischargeSummaryModal({ admission, onClose, onDischargeComplete, viewOnly = false }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [isPreview, setIsPreview] = useState(viewOnly);
  const [confirming, setConfirming] = useState(false);

  // --- Form state ---
  const [form, setForm] = useState({
    chiefComplaint: (!viewOnly && admission.REASON_FOR_ADMISSION) ? admission.REASON_FOR_ADMISSION : '',
    finalDiagnosis: (!viewOnly && admission.PRIMARY_DIAGNOSIS) ? admission.PRIMARY_DIAGNOSIS : '',
    comorbidities: '',
    allergies: '',
    historyOfIllness: '',
    courseInHospital: '',
    conditionAtDischarge: 'Stable',
    adviceOnDischarge: '',
    dietLifestyle: '',
    warningSigns: '',
  });
  const [medications, setMedications] = useState([{ drug: '', dose: '', route: 'Oral', frequency: '', duration: '' }]);
  const [investigations, setInvestigations] = useState([{ test: '', admissionValue: '', dischargeValue: '', reference: '' }]);
  const [followUps, setFollowUps] = useState([{ department: '', doctor: '', date: '', purpose: '' }]);

  useEffect(() => {
    if (viewOnly) {
      api.get(`/ipd/admissions/${admission.ID}/discharge-summary`)
        .then(res => {
          if (res.data.success) {
            const d = res.data.data;
            setForm({
              chiefComplaint: d.CHIEF_COMPLAINT || '',
              finalDiagnosis: d.FINAL_DIAGNOSIS || '',
              comorbidities: d.COMORBIDITIES || '',
              allergies: d.ALLERGIES || '',
              historyOfIllness: d.HISTORY_OF_ILLNESS || '',
              courseInHospital: d.COURSE_IN_HOSPITAL || '',
              conditionAtDischarge: d.DISCHARGE_CONDITION || '',
              adviceOnDischarge: d.ADVICE_ON_DISCHARGE || '',
              dietLifestyle: d.DIET_LIFESTYLE || '',
              warningSigns: d.WARNING_SIGNS || '',
            });
            try { setMedications(JSON.parse(d.DISCHARGE_MEDICATIONS || '[]')); } catch { setMedications([]); }
            try { setInvestigations(JSON.parse(d.INVESTIGATIONS || '[]')); } catch { setInvestigations([]); }
            try { setFollowUps(JSON.parse(d.FOLLOW_UP_APPOINTMENTS || '[]')); } catch { setFollowUps([]); }
          }
        }).catch(() => toast.error('Could not load the discharge summary'));
    }
  }, [viewOnly, admission.ID]);

  // Submitting the form only asks for confirmation; the discharge itself happens in confirmDischarge.
  const handleSubmit = (e) => {
    e.preventDefault();
    if (viewOnly) return;
    setConfirming(true);
  };

  const confirmDischarge = async () => {
    setLoading(true);
    try {
      const payload = {
        ...form,
        dischargeMedications: JSON.stringify(medications.filter(m => m.drug)),
        investigations: JSON.stringify(investigations.filter(i => i.test)),
        followUpAppointments: JSON.stringify(followUps.filter(f => f.department || f.date)),
      };
      await api.patch(`/ipd/admissions/${admission.ID}/discharge`, payload);
      toast.success('Signed discharge summary saved and patient discharged');
      setConfirming(false);
      if (onDischargeComplete) onDischargeComplete();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not discharge the patient');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  // Build address string
  const address = [admission.HOUSE_NO, admission.STREET, admission.CITY, admission.STATE, admission.PIN].filter(Boolean).join(', ');
  const nextOfKin = admission.EMERGENCY_CONTACT_NAME
    ? `${admission.EMERGENCY_CONTACT_NAME} (${admission.EMERGENCY_CONTACT_RELATION || 'Relative'})`
    : '—';
  const title = viewOnly ? 'Discharge summary' : 'Prepare discharge summary';

  return (
    <>
    <div className="ds-modal-overlay dialog-overlay" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px' }}>
      <div
        className="ds-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-title"
        style={{
          background: 'var(--surface)', width: '100%', maxWidth: isPreview ? '900px' : '860px',
          maxHeight: '92vh', borderRadius: 12, overflowY: 'auto', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column'
        }}
      >
        {/* TOOLBAR */}
        <div className="ds-toolbar" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 10 }}>
          <h2 id="ds-title" className="dialog-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {viewOnly ? <FileText size={18} aria-hidden="true" /> : <ClipboardList size={18} aria-hidden="true" />} {title}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {!viewOnly && (
              <button type="button" className="btn btn-secondary btn-md" onClick={() => setIsPreview(!isPreview)}>
                {isPreview ? <><Pencil size={16} aria-hidden="true" /> Edit</> : <><Eye size={16} aria-hidden="true" /> Preview</>}
              </button>
            )}
            {isPreview && (
              <button type="button" className="btn btn-primary btn-md" onClick={handlePrint}>
                <Printer size={16} aria-hidden="true" /> Print
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} aria-hidden="true" /></button>
          </div>
        </div>

        {/* CONTENT */}
        <div style={{ padding: 20, flex: 1 }}>
          {!isPreview ? (
            /* ═══════════════════ EDIT MODE ═══════════════════ */
            <form id="discharge-form" onSubmit={handleSubmit} className="stack">
              <div className="alert-strip alert-info" style={{ margin: 0 }}>
                <span>
                  <strong>{admission.PATIENT_NAME}</strong> <span className="mono">({admission.UHID})</span>
                  <span className="cell-secondary"> · {admission.AGE} y / {admission.GENDER} · {admission.WARD_NAME} / bed {admission.BED_NUMBER} · {admission.DOCTOR_NAME} · admitted {new Date(admission.ADMISSION_DATE).toLocaleDateString('en-IN')}</span>
                </span>
              </div>

              <FormSection icon={Stethoscope} title="Clinical information">
                <Field id="ds-complaint" label="Chief complaint" required>
                  <input id="ds-complaint" className="form-input" value={form.chiefComplaint} onChange={set('chiefComplaint')} required placeholder="E.g. fever, cough, breathlessness for 5 days" />
                </Field>
                <Field id="ds-diagnosis" label="Final diagnosis" required>
                  <input id="ds-diagnosis" className="form-input" value={form.finalDiagnosis} onChange={set('finalDiagnosis')} required placeholder="E.g. community-acquired pneumonia, right lower lobe" />
                </Field>
                <div className="form-row-2">
                  <Field id="ds-comorbid" label="Comorbidities">
                    <input id="ds-comorbid" className="form-input" value={form.comorbidities} onChange={set('comorbidities')} placeholder="E.g. type 2 DM, hypertension (comma-separated)" />
                  </Field>
                  <Field id="ds-allergies" label="Allergies">
                    <input id="ds-allergies" className="form-input" value={form.allergies} onChange={set('allergies')} placeholder="E.g. penicillin, rash (comma-separated)" />
                  </Field>
                </div>
                <Field id="ds-history" label="History of present illness">
                  <textarea id="ds-history" className="form-textarea" rows="4" value={form.historyOfIllness} onChange={set('historyOfIllness')} />
                </Field>
                <div className="form-row-2">
                  <Field id="ds-condition" label="Condition at discharge">
                    <select id="ds-condition" className="form-select" value={form.conditionAtDischarge} onChange={set('conditionAtDischarge')}>
                      <option>Stable</option><option>Improved</option><option>Against Medical Advice (AMA)</option><option>Transferred</option><option>Deceased</option>
                    </select>
                  </Field>
                  <Field id="ds-condition-notes" label="Condition details">
                    <textarea id="ds-condition-notes" className="form-textarea" rows="2" value={form.adviceOnDischarge} onChange={set('adviceOnDischarge')} placeholder="Afebrile for 48 hours, SpO2 97% on room air, tolerating orals" />
                  </Field>
                </div>
              </FormSection>

              <FormSection icon={Hospital} title="Hospital course">
                <Field id="ds-course" label="Course in hospital">
                  <textarea id="ds-course" className="form-textarea" rows="5" value={form.courseInHospital} onChange={set('courseInHospital')} placeholder="Managed with IV antibiotics, nebulisation, supplemental oxygen" />
                </Field>
              </FormSection>

              <FormSection icon={FlaskConical} title="Investigations summary">
                <DynamicTable
                  columns={[
                    { key: 'test', label: 'Test', placeholder: 'Hb' },
                    { key: 'admissionValue', label: 'Admission value', placeholder: '11.2 g/dL' },
                    { key: 'dischargeValue', label: 'Discharge value', placeholder: '12.4 g/dL' },
                    { key: 'reference', label: 'Reference', placeholder: '13–17' },
                  ]}
                  rows={investigations}
                  setRows={setInvestigations}
                  addLabel="Add investigation"
                />
              </FormSection>

              <FormSection icon={Pill} title="Discharge medications">
                <DynamicTable
                  columns={[
                    { key: 'drug', label: 'Drug', placeholder: 'Tab. Azithromycin' },
                    { key: 'dose', label: 'Dose', placeholder: '500 mg' },
                    { key: 'route', label: 'Route', placeholder: 'Oral' },
                    { key: 'frequency', label: 'Frequency', placeholder: 'Once daily' },
                    { key: 'duration', label: 'Duration', placeholder: '3 days' },
                  ]}
                  rows={medications}
                  setRows={setMedications}
                  addLabel="Add medication"
                />
              </FormSection>

              <FormSection icon={ClipboardList} title="Discharge instructions and follow-up">
                <Field id="ds-diet" label="Diet and lifestyle advice">
                  <textarea id="ds-diet" className="form-textarea" rows="3" value={form.dietLifestyle} onChange={set('dietLifestyle')} placeholder="High-protein diet, adequate hydration" />
                </Field>
                <Field id="ds-warning" label="Warning signs (return immediately if)">
                  <input id="ds-warning" className="form-input" value={form.warningSigns} onChange={set('warningSigns')} placeholder="Fever above 101°F, SpO2 below 94%, severe breathlessness (comma-separated)" />
                </Field>
                <div className="form-group">
                  <span className="form-label">Follow-up appointments</span>
                  <DynamicTable
                    columns={[
                      { key: 'department', label: 'Department', placeholder: 'Internal Medicine' },
                      { key: 'doctor', label: 'Doctor', placeholder: 'Dr. Sharma' },
                      { key: 'date', label: 'Date', placeholder: '29 Jun 2026' },
                      { key: 'purpose', label: 'Purpose', placeholder: 'Review, repeat CXR' },
                    ]}
                    rows={followUps}
                    setRows={setFollowUps}
                    addLabel="Add follow-up"
                  />
                </div>
              </FormSection>
            </form>
          ) : (
            /* ═══════════════════ PRINT PREVIEW ═══════════════════ */
            <div className="printable-summary-container" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", color: '#1a202c' }}>
              {/* HOSPITAL HEADER */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2.5px solid #c6943e', paddingBottom: '16px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <img src="/logo.png" alt="Hospital Logo" style={{ height: '65px' }} />
                  <div>
                    <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: '#1a202c' }}>HMS HOSPITAL</h1>
                    <h2 style={{ margin: '2px 0 0', fontSize: '0.95rem', color: '#4a5568', fontWeight: 600 }}>Healthcare & Inpatient Services</h2>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'inline-block', padding: '6px 16px', background: '#c6943e', color: '#fff', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.05em' }}>Discharge Summary</span>
                  <div style={{ fontSize: '0.78rem', color: '#718096', marginTop: '6px' }}>IP No: {admission.ADMISSION_ID_FORMATTED || `IPD-${admission.ID}`}</div>
                </div>
              </div>

              {/* PATIENT DEMOGRAPHICS */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="👤" /> PATIENT DEMOGRAPHICS</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                  <InfoRow label="Full Name" value={admission.PATIENT_NAME} />
                  <InfoRow label="Age / Sex" value={`${admission.AGE} yrs / ${admission.GENDER}`} />
                  <InfoRow label="Date of Birth" value={admission.DOB ? new Date(admission.DOB).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
                  <InfoRow label="Blood Group" value={admission.BLOOD_GROUP} />
                  <InfoRow label="UHID" value={admission.UHID} />
                  <InfoRow label="Contact" value={admission.CONTACT_NUMBER ? `+91 ${admission.CONTACT_NUMBER}` : '—'} />
                  <InfoRow label="Address" value={address || '—'} />
                  <InfoRow label="Next of Kin" value={nextOfKin} />
                </div>
              </div>

              {/* ADMISSION & DISCHARGE */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="🏥" /> ADMISSION & DISCHARGE</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                  <InfoRow label="Date of Admission" value={new Date(admission.ADMISSION_DATE).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} />
                  <InfoRow label="Date of Discharge" value={admission.DISCHARGE_DATE ? new Date(admission.DISCHARGE_DATE).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} />
                  <InfoRow label="Length of Stay" value={`${admission.DAYS_ADMITTED || Math.ceil((new Date() - new Date(admission.ADMISSION_DATE)) / 86400000)} days`} />
                  <div style={{ padding: '6px 0' }}>
                    <div style={previewLabelStyle}>Discharge Type</div>
                    <div style={{ marginTop: '4px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 12px', borderRadius: '14px', fontSize: '0.8rem', fontWeight: 700, background: form.conditionAtDischarge === 'Improved' || form.conditionAtDischarge === 'Stable' ? 'rgba(72,187,120,0.1)' : 'rgba(237,137,54,0.1)', color: form.conditionAtDischarge === 'Improved' || form.conditionAtDischarge === 'Stable' ? '#38a169' : '#c05621' }}>
                        {(form.conditionAtDischarge === 'Improved' || form.conditionAtDischarge === 'Stable') && '✓'} {form.conditionAtDischarge}
                      </span>
                    </div>
                  </div>
                  <InfoRow label="Ward / Bed" value={`${admission.WARD_NAME || '—'} · Bed ${admission.BED_NUMBER || '—'} ${admission.ROOM_NUMBER ? `(${admission.ROOM_NUMBER})` : ''}`} />
                  <InfoRow label="Consultant" value={admission.DOCTOR_NAME} />
                </div>
              </div>

              {/* CLINICAL INFORMATION */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="⚕️" /> CLINICAL INFORMATION</div>
                {form.chiefComplaint && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={previewLabelStyle}>Chief Complaint</div>
                    <p style={{ margin: '6px 0 0', fontSize: '0.92rem', fontWeight: 600 }}>{form.chiefComplaint}</p>
                  </div>
                )}
                <div style={{ marginBottom: '16px' }}>
                  <div style={previewLabelStyle}>Diagnosis at Discharge</div>
                  <p style={{ margin: '6px 0 0', fontSize: '0.95rem', fontWeight: 700 }}>{form.finalDiagnosis}</p>
                </div>
                {form.comorbidities && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={previewLabelStyle}>Comorbidities</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {form.comorbidities.split(',').map((c, i) => (
                        <span key={i} style={{ padding: '4px 14px', borderRadius: '16px', border: '1px solid #c6943e', fontSize: '0.82rem', fontWeight: 600, color: '#c6943e' }}>{c.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
                {form.allergies && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={previewLabelStyle}>Allergies</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                      {form.allergies.split(',').map((a, i) => (
                        <span key={i} style={{ padding: '4px 14px', borderRadius: '16px', border: '1px solid #e53e3e', fontSize: '0.82rem', fontWeight: 600, color: '#e53e3e', background: 'rgba(229,62,62,0.05)' }}><Glyph icon="⚠" /> {a.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
                {form.historyOfIllness && (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={previewLabelStyle}>History of Present Illness</div>
                    <p style={{ margin: '6px 0 0', fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{form.historyOfIllness}</p>
                  </div>
                )}
                {form.adviceOnDischarge && (
                  <div>
                    <div style={previewLabelStyle}>Condition at Discharge</div>
                    <p style={{ margin: '6px 0 0', fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{form.adviceOnDischarge}</p>
                  </div>
                )}
              </div>

              {/* COURSE IN HOSPITAL */}
              {form.courseInHospital && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                  <div style={{ ...sectionHeaderStyle, margin: '0 0 10px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="🏥" /> COURSE IN HOSPITAL</div>
                  <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{form.courseInHospital}</p>
                </div>
              )}

              {/* INVESTIGATIONS */}
              {investigations.length > 0 && investigations.some(i => i.test) && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ ...sectionHeaderStyle, margin: 0, borderRadius: 0, borderLeft: 'none', borderBottom: '1px solid #e2e8f0' }}><Glyph icon="🔬" /> INVESTIGATIONS SUMMARY</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ background: '#f7fafc' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Test</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Admission Value</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Discharge Value</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Reference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {investigations.filter(i => i.test).map((inv, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '10px 16px', fontWeight: 700 }}>{inv.test}</td>
                          <td style={{ padding: '10px 16px' }}>{inv.admissionValue || '—'}</td>
                          <td style={{ padding: '10px 16px' }}>{inv.dischargeValue || '—'}</td>
                          <td style={{ padding: '10px 16px', color: '#718096' }}>{inv.reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* DISCHARGE MEDICATIONS */}
              {medications.length > 0 && medications.some(m => m.drug) && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ ...sectionHeaderStyle, margin: 0, borderRadius: 0, borderLeft: 'none', borderBottom: '1px solid #e2e8f0' }}><Glyph icon="💊" /> DISCHARGE MEDICATIONS</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                      <tr style={{ background: '#f7fafc' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Drug</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Dose</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Route</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Frequency</th>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {medications.filter(m => m.drug).map((med, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '10px 16px', fontWeight: 700 }}>{med.drug}</td>
                          <td style={{ padding: '10px 16px' }}>{med.dose}</td>
                          <td style={{ padding: '10px 16px' }}>{med.route}</td>
                          <td style={{ padding: '10px 16px' }}>{med.frequency}</td>
                          <td style={{ padding: '10px 16px' }}>{med.duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* DISCHARGE INSTRUCTIONS */}
              {(form.dietLifestyle || form.warningSigns || followUps.some(f => f.department)) && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                  <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="📋" /> DISCHARGE INSTRUCTIONS & FOLLOW-UP</div>
                  {form.dietLifestyle && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={previewLabelStyle}>Diet & Lifestyle</div>
                      <p style={{ margin: '6px 0 0', fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontWeight: 600 }}>{form.dietLifestyle}</p>
                    </div>
                  )}
                  {form.warningSigns && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={previewLabelStyle}>Warning Signs — Return Immediately If</div>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                        {form.warningSigns.split(',').map((w, i) => (
                          <span key={i} style={{ padding: '4px 14px', borderRadius: '16px', border: '1px solid #e53e3e', fontSize: '0.82rem', fontWeight: 600, color: '#e53e3e', background: 'rgba(229,62,62,0.05)' }}>{w.trim()}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {followUps.some(f => f.department || f.date) && (
                    <div>
                      <div style={previewLabelStyle}>Follow-up Appointments</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginTop: '8px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Department</th>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Doctor</th>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Date</th>
                            <th style={{ padding: '8px 0', textAlign: 'left', fontWeight: 700, fontSize: '0.78rem', color: '#718096' }}>Purpose</th>
                          </tr>
                        </thead>
                        <tbody>
                          {followUps.filter(f => f.department || f.date).map((fu, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid #f7fafc' }}>
                              <td style={{ padding: '8px 0', fontWeight: 700 }}>{fu.department}</td>
                              <td style={{ padding: '8px 0' }}>{fu.doctor}</td>
                              <td style={{ padding: '8px 0', fontWeight: 700, color: '#c6943e' }}>{fu.date}</td>
                              <td style={{ padding: '8px 0' }}>{fu.purpose}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* SIGNATURES */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px' }}>
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}><Glyph icon="✍️" /> SIGNATURES</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px', marginTop: '40px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ borderTop: '1.5px solid #2d3748', paddingTop: '10px' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{admission.DOCTOR_NAME}</div>
                      <div style={{ fontSize: '0.78rem', color: '#718096' }}>Consultant</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ borderTop: '1.5px solid #2d3748', paddingTop: '10px' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{admission.PATIENT_NAME}</div>
                      <div style={{ fontSize: '0.78rem', color: '#718096' }}>Patient / Guardian</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ borderTop: '1.5px solid #2d3748', paddingTop: '10px' }}>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Nurse In-Charge</div>
                      <div style={{ fontSize: '0.78rem', color: '#718096' }}>{admission.WARD_NAME || 'Ward'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* FOOTER ACTIONS */}
        {!isPreview && !viewOnly && (
          <div className="dialog-foot" style={{ position: 'sticky', bottom: 0 }}>
            <button type="button" className="btn btn-ghost btn-md" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" form="discharge-form" className="btn btn-primary btn-md" disabled={loading}>
              <LogOut size={16} aria-hidden="true" /> Discharge patient
            </button>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          @page { margin: 10mm; }
          html, body { overflow: visible !important; height: auto !important; margin: 0 !important; padding: 0 !important; }
          body * { visibility: hidden !important; }

          .ds-modal-overlay { 
            position: absolute !important; left: 0 !important; top: 0 !important;
            background: none !important; overflow: visible !important; 
            height: auto !important; padding: 0 !important; margin: 0 !important;
            display: block !important;
          }
          
          .ds-modal-content { 
            overflow: visible !important; box-shadow: none !important; 
            border: none !important; max-height: none !important; 
            height: auto !important; width: 100% !important; padding: 0 !important; margin: 0 !important;
            display: block !important;
          }

          .printable-summary-container, .printable-summary-container * { 
            visibility: visible !important; color: #000 !important; 
          }

          .printable-summary-container {
            position: static !important;
            width: 100% !important; padding: 0 !important; margin: 0 !important;
            background: #fff !important; 
            font-size: 0.85rem !important;
          }

          .ds-toolbar { display: none !important; }

          .printable-summary-container img { height: 60px !important; }
          .printable-summary-container h1 { font-size: 1.3rem !important; white-space: nowrap !important; margin-bottom: 2px !important; letter-spacing: normal !important; }
          .printable-summary-container h2 { font-size: 0.9rem !important; }
          
          .printable-summary-container > div { 
             page-break-inside: avoid !important; break-inside: avoid !important; 
             margin-bottom: 12px !important; 
             padding: 10px 14px !important;
          }
          
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>

    <Modal
      open={confirming}
      onOpenChange={(open) => { if (!open && !loading) setConfirming(false); }}
      title="Discharge this patient?"
      description="Your confirmation signs this exact discharge continuity record. The admission and bed change commit with the signature. Later corrections require a linked amendment."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirming(false)} disabled={loading}>Cancel</button>
          <button type="button" className="btn btn-primary btn-md" onClick={confirmDischarge} disabled={loading||user?.role!=='doctor'}>
            <LogOut size={16} aria-hidden="true" /> {loading ? 'Signing and discharging…' : 'Sign summary and discharge'}
          </button>
        </>
      )}
    >
      <div className="facts">
        <div><div className="fact-label">Patient</div><div className="fact-value">{admission.PATIENT_NAME}</div></div>
        <div><div className="fact-label">Final diagnosis</div><div className="fact-value">{form.finalDiagnosis || '—'}</div></div>
        <div><div className="fact-label">Condition</div><div className="fact-value">{form.conditionAtDischarge}</div></div>
      </div>
    </Modal>
    </>
  );
}
