import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

const Field = ({ label, children, span }) => (
  <div className="form-group" style={span ? { gridColumn: `span ${span}` } : {}}>
    <label className="form-label">{label}</label>
    {children}
  </div>
);

export default function RestFormEditorPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const patientIdParams = searchParams.get('patientId');
  const navigate = useNavigate();
  const isEditing = !!id;
  const [loading, setLoading] = useState(isEditing);
  const [showExtend, setShowExtend] = useState(false);

  const [form, setForm] = useState({
    patient_id: patientIdParams || '',
    attended_date: new Date().toISOString().slice(0, 16),
    advised_days: '', from_date: new Date().toISOString().slice(0, 10),
    to_date: '', disease: '', fit_date: '', working_as: '', department: '',
    extended_date: '',
  });

  const [patientInfo, setPatientInfo] = useState(null);

  const loadPatientDetails = async (patId) => {
    if (!patId) return;
    try {
      const res = await api.get(`/patients/${patId}`);
      const p = res.data.patient || res.data;
      if (p) {
        setPatientInfo({
          name: p.name || p.NAME || '', empNumber: p.empNumber || p.EMPNUMBER || '',
          relationship: p.relationship || p.RELATIONSHIP || '',
          patientType: p.patientType || p.PATIENTTYPE || '',
          gender: p.gender || p.GENDER || '', age: p.age || p.AGE || '',
          department: p.department_name || '',
        });
        setForm(prev => ({ ...prev, patient_id: patId }));
      }
    } catch (e) { console.error('Failed to load patient:', e); toast.error('Failed to load patient details'); }
  };

  const loadRestForm = async () => {
    try {
      const res = await api.get(`/hms/rest-forms/${id}`);
      const data = res.data;
      const extDate = data.extended_date ? new Date(data.extended_date).toISOString().slice(0, 10) : '';
      setForm({
        patient_id: data.patient_id || '',
        attended_date: data.attended_date ? new Date(data.attended_date).toISOString().slice(0, 16) : '',
        advised_days: data.advised_days || '',
        from_date: data.from_date ? new Date(data.from_date).toISOString().slice(0, 10) : '',
        to_date: data.to_date ? new Date(data.to_date).toISOString().slice(0, 10) : '',
        disease: data.disease || '',
        fit_date: data.fit_date ? new Date(data.fit_date).toISOString().slice(0, 10) : '',
        working_as: data.working_as || '', department: data.department || '',
        extended_date: extDate,
      });
      if (extDate) setShowExtend(true);
      loadPatientDetails(data.patient_id);
    } catch (e) { toast.error('Failed to load rest form'); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (isEditing) loadRestForm();
    else if (patientIdParams) loadPatientDetails(patientIdParams);
  }, [id, patientIdParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.patient_id) return toast.error('Patient must be selected');
    try {
      if (isEditing) {
        await api.put(`/hms/rest-forms/${id}`, form);
        toast.success('Rest form updated');
        navigate('/doctor/rest-forms');
      } else {
        const res = await api.post('/hms/rest-forms', form);
        toast.success('Rest form created');
        navigate(`/doctor/rest-forms/print/${res.data.id || res.data.ID}`);
      }
    } catch (e) { console.error(e); toast.error('Failed to save rest form'); }
  };

  const handleExtendToggle = () => {
    if (showExtend) {
      // Removing extension
      setShowExtend(false);
      setForm(prev => ({ ...prev, extended_date: '' }));
    } else {
      setShowExtend(true);
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4">
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(139,92,246,0.1)', borderColor: 'rgba(139,92,246,0.25)' }}>🛏️</span>
              {isEditing ? 'Edit Rest Form' : 'New Rest & Light Duty Form'}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Generate a medical certificate for rest or light duty advisory.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/doctor/rest-forms')}>← Back to Hub</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80, gap: 12 }}>
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
                      { label: 'Employee No', value: patientInfo.empNumber || 'N/A' },
                      { label: 'Relationship', value: patientInfo.relationship || 'Self' },
                      { label: 'Gender / Age', value: `${patientInfo.gender}, ${patientInfo.age} yrs` },
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

            {/* Form Fields */}
            <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(139,92,246,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📋</span>
                <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Certificate Details</h3>
              </div>
              <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px 20px' }}>
                <Field label="Working As (Designation)">
                  <input type="text" className="form-input" value={form.working_as} onChange={e => setForm({...form, working_as: e.target.value})} placeholder="e.g. C.M." />
                </Field>
                <Field label="In (Department)">
                  <input type="text" className="form-input" value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder="e.g. IT" />
                </Field>
                <Field label="Rest/Light Duty For">
                  <input type="text" className="form-input" value={form.advised_days} onChange={e => setForm({...form, advised_days: e.target.value})} placeholder="e.g. 2 days" required />
                </Field>

                <Field label="Disease / Suffering From" span={2}>
                  <input type="text" className="form-input" value={form.disease} onChange={e => setForm({...form, disease: e.target.value})} required placeholder="e.g. Viral Fever" />
                </Field>
                <Field label="Attended On">
                  <input type="datetime-local" className="form-input" value={form.attended_date} onChange={e => setForm({...form, attended_date: e.target.value})} required />
                </Field>

                <Field label="From Date (w.e.f)">
                  <input type="date" className="form-input" value={form.from_date} onChange={e => setForm({...form, from_date: e.target.value})} required />
                </Field>
                <Field label="To Date (Optional)">
                  <input type="date" className="form-input" value={form.to_date} onChange={e => setForm({...form, to_date: e.target.value})} />
                </Field>
                <Field label="Fit to Join On (Optional)">
                  <input type="date" className="form-input" value={form.fit_date} onChange={e => setForm({...form, fit_date: e.target.value})} />
                </Field>
              </div>

              {/* ── Further Extend Section (Edit Mode Only) ── */}
              {isEditing && (
                <div style={{ padding: '0 24px 24px' }}>
                  {!showExtend ? (
                    <button
                      type="button"
                      onClick={handleExtendToggle}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '10px 22px', borderRadius: 10,
                        border: '2px dashed rgba(245,158,11,0.4)',
                        background: 'rgba(245,158,11,0.06)',
                        color: '#d97706', fontSize: '0.86rem', fontWeight: 700,
                        cursor: 'pointer', transition: 'all 0.25s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.12)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.6)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(245,158,11,0.06)'; e.currentTarget.style.borderColor = 'rgba(245,158,11,0.4)'; }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="16" />
                        <line x1="8" y1="12" x2="16" y2="12" />
                      </svg>
                      Further Extend Rest
                    </button>
                  ) : (
                    <div style={{
                      padding: '18px 22px', borderRadius: 12,
                      border: '2px solid rgba(245,158,11,0.3)',
                      background: 'rgba(245,158,11,0.04)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 26, height: 26, borderRadius: 7,
                            background: 'rgba(245,158,11,0.15)', color: '#d97706',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.8rem',
                          }}>📅</span>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 800,
                            textTransform: 'uppercase', letterSpacing: '0.1em',
                            color: '#d97706',
                          }}>
                            Further Extension
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={handleExtendToggle}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-muted)', fontSize: '1rem', padding: '2px 6px',
                            borderRadius: 6, transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
                          title="Remove Extension"
                        >
                          ✕
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <Field label="Extended Till Date">
                          <input
                            type="date"
                            className="form-input"
                            value={form.extended_date}
                            onChange={e => setForm({ ...form, extended_date: e.target.value })}
                            min={form.to_date || form.from_date || undefined}
                            style={{ borderColor: 'rgba(245,158,11,0.3)' }}
                          />
                        </Field>
                        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
                            The rest form serial number will remain the same.<br />
                            Extension date will appear on the printed form.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/doctor/rest-forms')}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-lg" disabled={!form.patient_id} style={{ minWidth: 180 }}>
                  {isEditing ? '💾 Update Rest Form' : '💾 Save & Generate'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
