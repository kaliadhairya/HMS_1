import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const inputStyle = {
  width: '100%', padding: '10px 14px', fontSize: '0.9rem', fontWeight: 500,
  border: '1.5px solid #e2e8f0', borderRadius: '10px', outline: 'none',
  background: '#fff', color: '#1a202c', transition: 'border-color 0.2s',
  boxSizing: 'border-box',
};
const textareaStyle = { ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' };
const selectStyle = { ...inputStyle, cursor: 'pointer', appearance: 'auto' };
const sectionHeaderStyle = {
  fontSize: '0.82rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
  padding: '10px 16px', background: 'rgba(45,55,72,0.04)', borderRadius: '10px',
  marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
  color: '#2d3748', borderLeft: '3px solid #c6943e'
};
const sectionCardStyle = {
  border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px',
  background: '#fff',
};
const labelStyle = { display: 'block', marginBottom: '6px', fontWeight: 700, fontSize: '0.85rem', color: '#4a5568' };
const previewLabelStyle = { fontSize: '0.75rem', fontWeight: 700, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.04em' };
const previewValueStyle = { margin: '4px 0 0', fontSize: '0.9rem', color: '#1a202c' };

// Helper to render a 2-col info row in the print preview
const InfoRow = ({ label, value }) => (
  <div style={{ padding: '6px 0' }}>
    <div style={previewLabelStyle}>{label}</div>
    <div style={previewValueStyle}>{value || '—'}</div>
  </div>
);

// Dynamic row list for medications / investigations / follow-up
function DynamicTable({ columns, rows, setRows }) {
  const addRow = () => setRows([...rows, columns.reduce((o, c) => ({ ...o, [c.key]: '' }), {})]);
  const removeRow = (i) => setRows(rows.filter((_, idx) => idx !== i));
  const updateRow = (i, key, val) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], [key]: val };
    setRows(copy);
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <thead>
          <tr style={{ background: '#f7fafc' }}>
            {columns.map(c => <th key={c.key} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '0.75rem', fontWeight: 800, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid #e2e8f0' }}>{c.label}</th>)}
            <th style={{ width: 36, borderBottom: '1px solid #e2e8f0' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: '6px 8px' }}>
                  <input style={{ ...inputStyle, padding: '8px 10px', fontSize: '0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}
                    value={row[c.key]} onChange={e => updateRow(i, c.key, e.target.value)} placeholder={c.placeholder || ''} />
                </td>
              ))}
              <td style={{ textAlign: 'center', padding: '6px 4px' }}>
                <button type="button" onClick={() => removeRow(i)} style={{ background: 'none', border: 'none', color: '#e53e3e', cursor: 'pointer', fontSize: '1.2rem', fontWeight: 800, lineHeight: 1 }} title="Remove row">×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9' }}>
        <button type="button" onClick={addRow} style={{ background: '#f7fafc', border: '1px dashed #cbd5e0', borderRadius: 8, padding: '7px 20px', cursor: 'pointer', fontSize: '0.82rem', color: '#4a5568', fontWeight: 700, transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#edf2f7'; e.currentTarget.style.borderColor = '#a0aec0'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#f7fafc'; e.currentTarget.style.borderColor = '#cbd5e0'; }}
        >+ Add Row</button>
      </div>
    </div>
  );
}

export default function DischargeSummaryModal({ admission, onClose, onDischargeComplete, viewOnly = false }) {
  const [loading, setLoading] = useState(false);
  const [isPreview, setIsPreview] = useState(viewOnly);

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
        }).catch(() => toast.error('Failed to load discharge summary'));
    }
  }, [viewOnly, admission.ID]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (viewOnly) return;
    if (!window.confirm('Are you sure you want to finalize this discharge summary and discharge the patient?')) return;

    setLoading(true);
    try {
      const payload = {
        ...form,
        dischargeMedications: JSON.stringify(medications.filter(m => m.drug)),
        investigations: JSON.stringify(investigations.filter(i => i.test)),
        followUpAppointments: JSON.stringify(followUps.filter(f => f.department || f.date)),
      };
      await api.patch(`/ipd/admissions/${admission.ID}/discharge`, payload);
      toast.success('Patient discharged and summary saved!');
      if (onDischargeComplete) onDischargeComplete();
    } catch (err) {
      toast.error('Failed to process discharge');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => window.print();

  // Build address string
  const address = [admission.HOUSE_NO, admission.STREET, admission.CITY, admission.STATE, admission.PIN].filter(Boolean).join(', ');
  const nextOfKin = admission.EMERGENCY_CONTACT_NAME
    ? `${admission.EMERGENCY_CONTACT_NAME} (${admission.EMERGENCY_CONTACT_RELATION || 'Relative'})`
    : '—';

  return (
    <div className="ds-modal-overlay" style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '16px'
    }}>
      <div className="ds-modal-content" style={{
        background: '#fff', width: '100%', maxWidth: isPreview ? '900px' : '860px',
        maxHeight: '92vh', borderRadius: '16px', overflowY: 'auto',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column'
      }}>
        {/* TOOLBAR */}
        <div className="ds-toolbar" style={{ padding: '16px 24px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
            {viewOnly ? '📄 Discharge Summary' : '📋 Prepare Discharge Summary'}
          </h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            {!viewOnly && (
              <button className="btn btn-outline" onClick={() => setIsPreview(!isPreview)} style={{ fontSize: '0.85rem' }}>
                {isPreview ? '✏️ Edit' : '👁️ Preview'}
              </button>
            )}
            {isPreview && <button className="btn btn-primary" onClick={handlePrint} style={{ fontSize: '0.85rem' }}>🖨️ Print</button>}
            <button className="btn btn-outline" style={{ border: 'none', background: '#f7fafc', fontSize: '1rem', padding: '6px 12px' }} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* CONTENT */}
        <div style={{ padding: '24px', flex: 1 }}>
          {!isPreview ? (
            /* ═══════════════════ EDIT MODE ═══════════════════ */
            <form id="discharge-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Patient Info Banner */}
              <div style={{ padding: '18px 20px', background: 'linear-gradient(135deg, #f7fafc, #edf2f7)', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 4, color: '#1a202c' }}>{admission.PATIENT_NAME} ({admission.UHID})</div>
                <div style={{ fontSize: '0.85rem', color: '#718096' }}>
                  {admission.AGE} yrs / {admission.GENDER} &nbsp;·&nbsp; {admission.WARD_NAME} / Bed {admission.BED_NUMBER} &nbsp;·&nbsp; Dr. {admission.DOCTOR_NAME} &nbsp;·&nbsp; Admitted: {new Date(admission.ADMISSION_DATE).toLocaleDateString()}
                </div>
              </div>

              {/* ── CLINICAL INFORMATION ── */}
              <div style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>⚕️ CLINICAL INFORMATION</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={labelStyle}>Chief Complaint <span style={{ color: '#e53e3e' }}>*</span></label>
                    <input style={inputStyle} value={form.chiefComplaint} onChange={e => setForm({ ...form, chiefComplaint: e.target.value })} required placeholder="E.g., Fever, cough, breathlessness for 5 days" onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                  </div>
                  <div>
                    <label style={labelStyle}>Final Diagnosis <span style={{ color: '#e53e3e' }}>*</span></label>
                    <input style={inputStyle} value={form.finalDiagnosis} onChange={e => setForm({ ...form, finalDiagnosis: e.target.value })} required placeholder="E.g., Community-Acquired Pneumonia (CAP), Right lower lobe" onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <div>
                      <label style={labelStyle}>Comorbidities</label>
                      <input style={inputStyle} value={form.comorbidities} onChange={e => setForm({ ...form, comorbidities: e.target.value })} placeholder="E.g., Type 2 DM, Hypertension (comma-separated)" onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                    </div>
                    <div>
                      <label style={labelStyle}>Allergies</label>
                      <input style={inputStyle} value={form.allergies} onChange={e => setForm({ ...form, allergies: e.target.value })} placeholder="E.g., Penicillin — Rash (comma-separated)" onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>History of Present Illness</label>
                    <textarea style={textareaStyle} rows="4" value={form.historyOfIllness} onChange={e => setForm({ ...form, historyOfIllness: e.target.value })} placeholder="Detailed history..." onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                  </div>
                  <div>
                    <label style={labelStyle}>Condition at Discharge</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '14px' }}>
                      <select style={selectStyle} value={form.conditionAtDischarge} onChange={e => setForm({ ...form, conditionAtDischarge: e.target.value })}>
                        <option>Stable</option><option>Improved</option><option>Against Medical Advice (AMA)</option><option>Transferred</option><option>Deceased</option>
                      </select>
                      <textarea style={textareaStyle} rows="2" value={form.adviceOnDischarge} onChange={e => setForm({ ...form, adviceOnDischarge: e.target.value })} placeholder="Afebrile for 48 hrs, SpO2 97% on room air, tolerating orals well..." onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                    </div>
                  </div>
                </div>
              </div>

              {/* ── COURSE IN HOSPITAL ── */}
              <div style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>🏥 COURSE IN HOSPITAL</div>
                <textarea style={textareaStyle} rows="5" value={form.courseInHospital} onChange={e => setForm({ ...form, courseInHospital: e.target.value })} placeholder="Patient was managed with IV antibiotics, nebulisation, supplemental oxygen..." onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
              </div>

              {/* ── INVESTIGATIONS ── */}
              <div style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>🔬 INVESTIGATIONS SUMMARY</div>
                <DynamicTable
                  columns={[
                    { key: 'test', label: 'Test', placeholder: 'Hb' },
                    { key: 'admissionValue', label: 'Admission Value', placeholder: '11.2 g/dL' },
                    { key: 'dischargeValue', label: 'Discharge Value', placeholder: '12.4 g/dL' },
                    { key: 'reference', label: 'Reference', placeholder: '13–17' },
                  ]}
                  rows={investigations}
                  setRows={setInvestigations}
                />
              </div>

              {/* ── DISCHARGE MEDICATIONS ── */}
              <div style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>💊 DISCHARGE MEDICATIONS</div>
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
                />
              </div>

              {/* ── INSTRUCTIONS & FOLLOW-UP ── */}
              <div style={sectionCardStyle}>
                <div style={sectionHeaderStyle}>📋 DISCHARGE INSTRUCTIONS & FOLLOW-UP</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={labelStyle}>Diet & Lifestyle Advice</label>
                    <textarea style={textareaStyle} rows="3" value={form.dietLifestyle} onChange={e => setForm({ ...form, dietLifestyle: e.target.value })} placeholder="High-protein diet, adequate hydration, avoid cold food..." onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                  </div>
                  <div>
                    <label style={labelStyle}>Warning Signs — Return Immediately If</label>
                    <input style={inputStyle} value={form.warningSigns} onChange={e => setForm({ ...form, warningSigns: e.target.value })} placeholder="Fever >101°F, SpO2 <94%, Severe breathlessness (comma-separated)" onFocus={e => e.target.style.borderColor = '#c6943e'} onBlur={e => e.target.style.borderColor = '#e2e8f0'} />
                  </div>
                  <div>
                    <label style={labelStyle}>Follow-up Appointments</label>
                    <DynamicTable
                      columns={[
                        { key: 'department', label: 'Department', placeholder: 'Internal Medicine' },
                        { key: 'doctor', label: 'Doctor', placeholder: 'Dr. Sharma' },
                        { key: 'date', label: 'Date', placeholder: '29 Jun 2026' },
                        { key: 'purpose', label: 'Purpose', placeholder: 'Review, repeat CXR' },
                      ]}
                      rows={followUps}
                      setRows={setFollowUps}
                    />
                  </div>
                </div>
              </div>
            </form>
          ) : (
            /* ═══════════════════ PRINT PREVIEW ═══════════════════ */
            <div className="printable-summary-container" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif", color: '#1a202c' }}>
              {/* HOSPITAL HEADER */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2.5px solid #c6943e', paddingBottom: '16px', marginBottom: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <img src="/logo.png" alt="HMS Logo" style={{ height: '65px' }} />
                  <div>
                    <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 900, color: '#1a202c' }}>HOSPITAL MANAGEMENT SYSTEM</h1>
                    <h2 style={{ margin: '2px 0 0', fontSize: '0.95rem', color: '#4a5568', fontWeight: 600 }}>Main Hospital & Healthcare Center</h2>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ display: 'inline-block', padding: '6px 16px', background: '#c6943e', color: '#fff', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.05em' }}>Discharge Summary</span>
                  <div style={{ fontSize: '0.78rem', color: '#718096', marginTop: '6px' }}>IP No: {admission.ADMISSION_ID_FORMATTED || `IPD-${admission.ID}`}</div>
                </div>
              </div>

              {/* PATIENT DEMOGRAPHICS */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px' }}>
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>👤 PATIENT DEMOGRAPHICS</div>
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
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>🏥 ADMISSION & DISCHARGE</div>
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
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>⚕️ CLINICAL INFORMATION</div>
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
                        <span key={i} style={{ padding: '4px 14px', borderRadius: '16px', border: '1px solid #e53e3e', fontSize: '0.82rem', fontWeight: 600, color: '#e53e3e', background: 'rgba(229,62,62,0.05)' }}>⚠ {a.trim()}</span>
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
                  <div style={{ ...sectionHeaderStyle, margin: '0 0 10px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>🏥 COURSE IN HOSPITAL</div>
                  <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{form.courseInHospital}</p>
                </div>
              )}

              {/* INVESTIGATIONS */}
              {investigations.length > 0 && investigations.some(i => i.test) && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '20px' }}>
                  <div style={{ ...sectionHeaderStyle, margin: 0, borderRadius: 0, borderLeft: 'none', borderBottom: '1px solid #e2e8f0' }}>🔬 INVESTIGATIONS SUMMARY</div>
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
                  <div style={{ ...sectionHeaderStyle, margin: 0, borderRadius: 0, borderLeft: 'none', borderBottom: '1px solid #e2e8f0' }}>💊 DISCHARGE MEDICATIONS</div>
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
                  <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>📋 DISCHARGE INSTRUCTIONS & FOLLOW-UP</div>
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
                <div style={{ ...sectionHeaderStyle, margin: '0 0 14px', padding: '0 0 8px', background: 'none', borderLeft: 'none', borderBottom: '1px solid #e2e8f0', borderRadius: 0 }}>✍️ SIGNATURES</div>
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
          <div style={{ padding: '16px 24px', borderTop: '1px solid #e2e8f0', background: '#f7fafc', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button className="btn btn-outline" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" form="discharge-form" className="btn btn-primary" disabled={loading} style={{ fontWeight: 800 }}>
              {loading ? 'Processing...' : '✓ Confirm Discharge & Save Summary'}
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
  );
}
