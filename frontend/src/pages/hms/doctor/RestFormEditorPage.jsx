import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, ClipboardList, Plus, Save, TriangleAlert, UserRound, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import api from '../../../api/axios';
import toast from 'react-hot-toast';

const Field = ({ label, htmlFor, children }) => (
  <div className="form-group">
    <label className="form-label" htmlFor={htmlFor}>{label}</label>
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
      <main className="app-page">
        <PageHeader
          title={isEditing ? 'Edit rest form' : 'New rest and light duty form'}
          description="Issue a medical certificate advising rest or light duty."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/doctor/rest-forms')}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to rest forms
            </button>
          )}
        />

        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <form onSubmit={handleSubmit} className="stack">
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title" style={{ margin: 0 }}><UserRound size={16} aria-hidden="true" /> Patient</h2>
              </div>
              <div className="panel-pad">
                {patientInfo ? (
                  <div className="facts">
                    {[
                      { label: 'Patient name', value: patientInfo.name },
                      { label: 'Employee no.', value: patientInfo.empNumber || 'N/A' },
                      { label: 'Relationship', value: patientInfo.relationship || 'Self' },
                      { label: 'Gender / age', value: `${patientInfo.gender}, ${patientInfo.age} yrs` },
                    ].map(item => (
                      <div key={item.label}>
                        <div className="fact-label">{item.label}</div>
                        <div className="fact-value">{item.value}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="alert-strip alert-danger" role="alert" style={{ marginBottom: 0 }}>
                    <TriangleAlert size={16} aria-hidden="true" /> No patient selected. Start the rest form from the doctor dashboard queue.
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Certificate details</h2>
              </div>
              <div className="panel-pad stack">
                <div className="form-grid-3">
                  <Field label="Working as (designation)" htmlFor="rf-working-as">
                    <input id="rf-working-as" type="text" className="form-input" value={form.working_as} onChange={e => setForm({...form, working_as: e.target.value})} placeholder="e.g. C.M." />
                  </Field>
                  <Field label="Department" htmlFor="rf-department">
                    <input id="rf-department" type="text" className="form-input" value={form.department} onChange={e => setForm({...form, department: e.target.value})} placeholder="e.g. IT" />
                  </Field>
                  <Field label="Rest or light duty for" htmlFor="rf-advised-days">
                    <input id="rf-advised-days" type="text" className="form-input" value={form.advised_days} onChange={e => setForm({...form, advised_days: e.target.value})} placeholder="e.g. 2 days" required />
                  </Field>
                </div>
                <div className="form-row-2">
                  <Field label="Disease / suffering from" htmlFor="rf-disease">
                    <input id="rf-disease" type="text" className="form-input" value={form.disease} onChange={e => setForm({...form, disease: e.target.value})} required placeholder="e.g. Viral fever" />
                  </Field>
                  <Field label="Attended on" htmlFor="rf-attended">
                    <input id="rf-attended" type="datetime-local" className="form-input" value={form.attended_date} onChange={e => setForm({...form, attended_date: e.target.value})} required />
                  </Field>
                </div>
                <div className="form-grid-3">
                  <Field label="From date (w.e.f.)" htmlFor="rf-from">
                    <input id="rf-from" type="date" className="form-input" value={form.from_date} onChange={e => setForm({...form, from_date: e.target.value})} required />
                  </Field>
                  <Field label="To date (optional)" htmlFor="rf-to">
                    <input id="rf-to" type="date" className="form-input" value={form.to_date} onChange={e => setForm({...form, to_date: e.target.value})} />
                  </Field>
                  <Field label="Fit to join on (optional)" htmlFor="rf-fit">
                    <input id="rf-fit" type="date" className="form-input" value={form.fit_date} onChange={e => setForm({...form, fit_date: e.target.value})} />
                  </Field>
                </div>

                {/* Further extension (edit mode only) */}
                {isEditing && (
                  !showExtend ? (
                    <div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={handleExtendToggle}>
                        <Plus size={14} aria-hidden="true" /> Extend rest further
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: 16, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--amber-light)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <h3 className="toolbar-caption" style={{ color: 'var(--amber)' }}>
                          <CalendarPlus size={16} aria-hidden="true" /> Further extension
                        </h3>
                        <button type="button" className="icon-btn" onClick={handleExtendToggle} aria-label="Remove extension" title="Remove extension">
                          <X size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="form-row-2">
                        <Field label="Extended till" htmlFor="rf-extended">
                          <input
                            id="rf-extended"
                            type="date"
                            className="form-input"
                            value={form.extended_date}
                            onChange={e => setForm({ ...form, extended_date: e.target.value })}
                            min={form.to_date || form.from_date || undefined}
                          />
                        </Field>
                        <p className="form-hint" style={{ alignSelf: 'end', margin: 0 }}>
                          The serial number stays the same. The extension date appears on the printed form.
                        </p>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/doctor/rest-forms')}>Cancel</button>
                <button type="submit" className="btn btn-primary btn-md" disabled={!form.patient_id}>
                  <Save size={16} aria-hidden="true" /> {isEditing ? 'Update rest form' : 'Save and generate'}
                </button>
              </div>
            </section>
          </form>
        )}
      </main>
    </>
  );
}
