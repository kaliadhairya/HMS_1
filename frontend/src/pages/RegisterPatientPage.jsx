import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Check, ClipboardList, Search, Stethoscope, UserRound } from 'lucide-react';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import api from '../api/axios';

const WARDS = ['Medical', 'Surgical', 'Gynaecology', 'Private', 'N/A'];
const RELATIONSHIPS = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Other'];
const DIAGNOSES = [
  'Fever', 'Anaemia', 'Diabetes Mellitus', 'Hypertension', 'Renal Failure',
  'Liver Disease', 'Thyroid Disorder', 'Cardiac Disorder', 'Infection / Sepsis',
  'Jaundice', 'Urinary Tract Infection', 'Respiratory Infection', 'Malaria',
  'Typhoid', 'Dengue', 'Pre-operative Check-up', 'Routine Check-up', 'Other',
];

export default function RegisterPatientPage() {
  const { type, id } = useParams(); // 'ngl', 'other' for /register/:type, or id for /edit/:id
  const isEditMode = !!id;
  const navigate = useNavigate();

  const [isCorporate, setIsCorporate] = useState(type === 'corporate');
  
  const [form, setForm] = useState({
    name: '',
    empNumber: '',
    relationship: 'Self',
    relationshipOther: '',
    phoneNumber: '',
    age: '',
    gender: '',
    opdIndoor: 'OPD',
    ward: 'N/A',
    testDate: new Date().toISOString().split('T')[0],
    provDiagnosis: '',
    provDiagnosisOther: '',
    doctorId: '',
    departmentId: '',
  });
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEditMode);
  const [errors, setErrors] = useState({});
  const [doctors, setDoctors] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(true);

  const [dependents, setDependents] = useState([]);
  const [isSearchingDependents, setIsSearchingDependents] = useState(false);

  const fetchDependents = async (empNum) => {
    if (!empNum || !empNum.trim()) return;
    setIsSearchingDependents(true);
    setDependents([]);
    try {
      const { data } = await api.get(`/patients/hms/emp/${encodeURIComponent(empNum.trim())}`);
      if (data.success && data.data.length > 0) {
        setDependents(data.data);
      }
    } catch (err) {
      console.error('Error fetching dependents:', err);
    } finally {
      setIsSearchingDependents(false);
    }
  };

  const selectDependent = (dep) => {
    setForm(f => ({
      ...f,
      name: dep.name || '',
      age: dep.age ? String(dep.age) : '',
      gender: dep.gender || '',
      relationship: dep.relationship || 'Self',
      relationshipOther: ''
    }));
    toast.success(`${dep.relationship === 'Self' ? 'Employee' : dep.relationship} details filled in`);
  };

  useEffect(() => {
    if (isEditMode) {
      const fetchPatient = async () => {
        try {
          const { data } = await api.get(`/patients/${id}`);
          const p = data.patient;
          setIsCorporate(p.patientType === 'corporate_employee');
          
          let provDiagnosis = p.provDiagnosis || '';
          let provDiagnosisOther = '';
          if (provDiagnosis && !DIAGNOSES.includes(provDiagnosis)) {
            provDiagnosisOther = provDiagnosis;
            provDiagnosis = 'Other';
          }

          let relationship = p.relationship || 'Self';
          let relationshipOther = '';
          if (relationship && !RELATIONSHIPS.includes(relationship)) {
            relationshipOther = relationship;
            relationship = 'Other';
          }

          setForm({
            name: p.name || '',
            empNumber: p.empNumber || '',
            relationship,
            relationshipOther,
            phoneNumber: p.phoneNumber || '',
            age: p.age ? String(p.age) : '',
            gender: p.gender || '',
            opdIndoor: p.opdIndoor || 'OPD',
            ward: p.ward || 'N/A',
            testDate: p.testDate ? new Date(p.testDate).toISOString().split('T')[0] : '',
            provDiagnosis,
            provDiagnosisOther,
            doctorId: p.doctor_id ? String(p.doctor_id) : '',
            departmentId: p.department_id ? String(p.department_id) : '',
          });
        } catch (err) {
          toast.error('Failed to load patient data.');
          navigate('/dashboard');
        } finally {
          setInitialLoading(false);
        }
      };
      fetchPatient();
    }
  }, [id, navigate, isEditMode]);

  // Fetch doctors and departments for dropdowns
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [doctorsRes, deptRes] = await Promise.all([
          api.get('/doctor/list-doctors'),
          api.get('/doctor/list-departments'),
        ]);
        if (doctorsRes.data.success) setDoctors(doctorsRes.data.data);
        if (deptRes.data.success) setDepartments(deptRes.data.data);
      } catch (err) {
        console.error('Failed to fetch doctors/departments:', err);
        toast.error('Failed to load doctors or departments');
      } finally {
        setLoadingOptions(false);
      }
    };
    fetchOptions();
  }, []);

  const set = (field, value) => {
    setForm(f => ({ ...f, [field]: value }));
    if (errors[field]) setErrors(e => ({ ...e, [field]: '' }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.age || form.age < 1 || form.age > 120) e.age = 'Valid age required';
    if (!form.gender) e.gender = 'Gender is required';
    if (!form.testDate) e.testDate = 'Test date is required';
    if (isCorporate && !form.empNumber.trim()) e.empNumber = 'Employee number is required';
    if (isCorporate && form.relationship === 'Other' && !form.relationshipOther.trim()) e.relationshipOther = 'Please specify relationship';
    if (form.provDiagnosis === 'Other' && !form.provDiagnosisOther.trim()) e.provDiagnosisOther = 'Please specify diagnosis';
    if (!isCorporate) {
      if (!form.phoneNumber.trim()) e.phoneNumber = 'Phone number is required';
      else if (!/^\d{10}$/.test(form.phoneNumber.replace(/\s/g, ''))) e.phoneNumber = 'Phone number must be exactly 10 digits';
    }
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    try {
      const payload = {
        patientType: isCorporate ? 'corporate_employee' : 'other',
        name: form.name.trim(),
        age: Number(form.age),
        gender: form.gender,
        opdIndoor: form.opdIndoor,
        ward: form.ward,
        testDate: form.testDate,
        provDiagnosis: form.provDiagnosis === 'Other' ? form.provDiagnosisOther.trim() : form.provDiagnosis,
        doctorId: form.doctorId ? Number(form.doctorId) : null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
      };
      if (isCorporate) {
        payload.empNumber = form.empNumber.trim();
        payload.relationship = form.relationship === 'Other' ? form.relationshipOther.trim() : form.relationship;
      } else {
        payload.phoneNumber = form.phoneNumber.replace(/\s/g, '');
      }

      if (isEditMode) {
        await api.put(`/patients/${id}`, payload);
        toast.success('Patient updated');
        navigate(-1); // Go back to the report page where they clicked "Edit"
      } else {
        const { data } = await api.post('/patients', payload);
        toast.success('Patient registered');
        navigate(`/report/${data.reportId}`, { state: { patient: data.patient } });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || (isEditMode ? 'Update failed.' : 'Registration failed.'));
    } finally {
      setLoading(false);
    }
  };

  // Inline field error, announced to assistive tech and linked to its input.
  const fieldError = (field) => (errors[field]
    ? <span className="form-error" id={`rp-${field}-error`} role="alert">{errors[field]}</span>
    : null);
  const errorProps = (field) => (errors[field]
    ? { 'aria-invalid': true, 'aria-describedby': `rp-${field}-error` }
    : {});

  if (initialLoading) {
    return (
      <>
        <Navbar />
        <main className="app-page"><p className="muted">Loading…</p></main>
      </>
    );
  }

  const categoryLabel = isCorporate ? 'corporate beneficiary' : 'other patient';

  return (
    <>
      <Navbar />
      <main className="app-page" style={{ maxWidth: 820 }}>
        <PageHeader
          title={`${isEditMode ? 'Edit' : 'Register'} ${categoryLabel}`}
          description={isCorporate
            ? 'Corporate employee and dependent registration, identified by employee number.'
            : 'General patient registration, identified by phone number.'}
          meta={<span className={`status ${isCorporate ? 'status-info' : 'status-neutral'}`}>{isCorporate ? 'Corporate' : 'General'}</span>}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          )}
        />

        <form onSubmit={handleSubmit} className="stack">
          {/* Personal details */}
          <section className="panel panel-pad">
            <h2 className="panel-title"><UserRound size={16} aria-hidden="true" /> Personal details</h2>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" htmlFor="rp-name">Full name *</label>
                <input id="rp-name" className="form-input" placeholder="e.g. B.S Shergill" value={form.name} onChange={e => set('name', e.target.value)} {...errorProps('name')} />
                {fieldError('name')}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-age">Age (years) *</label>
                <input id="rp-age" className="form-input" type="number" min="1" max="120" placeholder="e.g. 35" value={form.age} onChange={e => set('age', e.target.value)} {...errorProps('age')} />
                {fieldError('age')}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-gender">Gender *</label>
                <select id="rp-gender" className="form-select" value={form.gender} onChange={e => set('gender', e.target.value)} {...errorProps('gender')}>
                  <option value="">Select gender</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
                {fieldError('gender')}
              </div>

              {/* Corporate employee fields */}
              {isCorporate && (
                <>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <label className="form-label" htmlFor="rp-emp">Employee number *</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        id="rp-emp"
                        className="form-input"
                        style={{ flex: '1 1 220px' }}
                        placeholder="e.g. EMP-12345"
                        value={form.empNumber}
                        onChange={e => set('empNumber', e.target.value)}
                        onBlur={(e) => fetchDependents(e.target.value)}
                        {...errorProps('empNumber')}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-md"
                        onClick={() => fetchDependents(form.empNumber)}
                        disabled={isSearchingDependents}
                      >
                        <Search size={16} aria-hidden="true" /> {isSearchingDependents ? 'Searching…' : 'Find dependents'}
                      </button>
                    </div>
                    {fieldError('empNumber')}

                    {/* Dependents selection */}
                    {dependents.length > 0 && (
                      <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                        <p className="form-label" style={{ marginBottom: 8 }}>Matching profiles. Select one to fill in the details.</p>
                        <ul className="list-rows" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                          {dependents.map((dep, idx) => (
                            <li key={idx}>
                              <button type="button" className="list-row" onClick={() => selectDependent(dep)}>
                                <span className="cell-stack">
                                  <span className="cell-primary">{dep.name}</span>
                                  <span className="cell-secondary">{dep.age} y · {dep.gender}</span>
                                </span>
                                <span className="tag">{dep.relationship}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="rp-relationship">Relationship to employee</label>
                    <select id="rp-relationship" className="form-select" value={form.relationship} onChange={e => set('relationship', e.target.value)}>
                      {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  {form.relationship === 'Other' && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="rp-relationship-other">Specify relationship *</label>
                      <input id="rp-relationship-other" className="form-input" placeholder="e.g. Brother" value={form.relationshipOther} onChange={e => set('relationshipOther', e.target.value)} {...errorProps('relationshipOther')} />
                      {fieldError('relationshipOther')}
                    </div>
                  )}
                </>
              )}

              {/* Other patients only */}
              {!isCorporate && (
                <div className="form-group">
                  <label className="form-label" htmlFor="rp-phone">Phone number *</label>
                  <input
                    id="rp-phone"
                    className="form-input" placeholder="10-digit phone number"
                    inputMode="numeric"
                    value={form.phoneNumber}
                    onChange={e => set('phoneNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    maxLength={10}
                    {...errorProps('phoneNumber')}
                  />
                  {fieldError('phoneNumber')}
                </div>
              )}
            </div>
          </section>

          {/* Visit details */}
          <section className="panel panel-pad">
            <h2 className="panel-title"><ClipboardList size={16} aria-hidden="true" /> Visit details</h2>
            <div className="form-grid">
              <div className="form-group">
                <span className="form-label" id="rp-opd-label">OPD or indoor</span>
                <div className="segmented" role="radiogroup" aria-labelledby="rp-opd-label">
                  {['OPD', 'Indoor'].map(opt => (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={form.opdIndoor === opt}
                      className={form.opdIndoor === opt ? 'is-active' : ''}
                      onClick={() => set('opdIndoor', opt)}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-ward">Ward</label>
                <select id="rp-ward" className="form-select" value={form.ward} onChange={e => set('ward', e.target.value)}>
                  {WARDS.map(w => <option key={w}>{w}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-test-date">Test date *</label>
                <input id="rp-test-date" className="form-input" type="date" value={form.testDate} onChange={e => set('testDate', e.target.value)} {...errorProps('testDate')} />
                {fieldError('testDate')}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-diagnosis">Provisional diagnosis</label>
                <select id="rp-diagnosis" className="form-select" value={form.provDiagnosis} onChange={e => set('provDiagnosis', e.target.value)}>
                  <option value="">Select or leave blank</option>
                  {DIAGNOSES.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>

              {form.provDiagnosis === 'Other' && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label" htmlFor="rp-diagnosis-other">Specify diagnosis *</label>
                  <input id="rp-diagnosis-other" className="form-input" placeholder="e.g. COVID-19" value={form.provDiagnosisOther} onChange={e => set('provDiagnosisOther', e.target.value)} {...errorProps('provDiagnosisOther')} />
                  {fieldError('provDiagnosisOther')}
                </div>
              )}
            </div>
          </section>

          {/* Doctor and department assignment */}
          <section className="panel panel-pad">
            <h2 className="panel-title" style={{ marginBottom: 4 }}><Stethoscope size={16} aria-hidden="true" /> Doctor and department</h2>
            <p className="muted" style={{ marginBottom: 14 }}>
              Optional. Assign the patient to a doctor and department for easier tracking.
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="rp-doctor">Doctor</label>
                <select
                  id="rp-doctor"
                  className="form-select"
                  value={form.doctorId}
                  onChange={e => set('doctorId', e.target.value)}
                  disabled={loadingOptions}
                >
                  <option value="">No doctor assigned</option>
                  {doctors.map(doc => (
                    <option key={doc.id} value={doc.id}>
                      {doc.user?.name || doc.user?.username} {doc.speciality ? `- ${doc.speciality}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="rp-department">Department</label>
                <select
                  id="rp-department"
                  className="form-select"
                  value={form.departmentId}
                  onChange={e => set('departmentId', e.target.value)}
                  disabled={loadingOptions}
                >
                  <option value="">No department assigned</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} {dept.short_code ? `(${dept.short_code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
              {loading ? (isEditMode ? 'Updating…' : 'Registering…') : isEditMode ? (
                <><Check size={16} aria-hidden="true" /> Update patient</>
              ) : (
                <>Register and enter test results <ArrowRight size={16} aria-hidden="true" /></>
              )}
            </button>
          </div>
        </form>
      </main>
    </>
  );
}
