import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
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
    toast.success(`${dep.relationship === 'Self' ? 'Employee' : dep.relationship} details auto-filled!`);
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
        toast.success('Patient updated successfully!');
        navigate(-1); // Go back to the report page where they clicked "Edit"
      } else {
        const { data } = await api.post('/patients', payload);
        toast.success('Patient registered successfully!');
        navigate(`/report/${data.reportId}`, { state: { patient: data.patient } });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || (isEditMode ? 'Update failed.' : 'Registration failed.'));
    } finally {
      setLoading(false);
    }
  };

  const accentColor = isCorporate ? 'var(--teal)' : 'var(--amber)';
  const accentBg = isCorporate ? 'rgba(0,180,160,0.1)' : 'rgba(245,158,11,0.08)';
  const accentBorder = isCorporate ? 'rgba(0,180,160,0.3)' : 'rgba(245,158,11,0.25)';

  if (initialLoading) {
    return (
      <>
        <Navbar />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-wrapper" style={{ maxWidth: 740 }}>
        {/* Back */}
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginBottom: 20 }}>
          ← Back
        </button>

        {/* Header */}
        <div className="page-header fade-up">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: accentBg, border: `1.5px solid ${accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
            }}>{isCorporate ? '🏢' : '🧑‍⚕️'}</div>
            <div>
              <h1 style={{ fontSize: '1.5rem' }}>
                {isEditMode ? 'Edit ' : 'Register '} <span style={{ color: accentColor }}>{isCorporate ? 'Corporate Employee' : 'Other Patient'}</span>
              </h1>
              <p>{isCorporate ? 'Corporate employee & dependent registration with employee number' : 'General patient registration with Phone Number identification'}</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="card fade-up-2">
          {/* ── Personal Details ─────────────────────────────── */}
          <div className="card-section">
            <div className="card-section-title">Personal Details</div>
            <div className="form-grid">
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Full Name *</label>
                <input className="form-input" placeholder="e.g. B.S Shergill" value={form.name} onChange={e => set('name', e.target.value)} />
                {errors.name && <span className="form-error">{errors.name}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Age (years) *</label>
                <input className="form-input" type="number" min="1" max="120" placeholder="e.g. 35" value={form.age} onChange={e => set('age', e.target.value)} />
                {errors.age && <span className="form-error">{errors.age}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Gender *</label>
                <select className="form-select" value={form.gender} onChange={e => set('gender', e.target.value)}>
                  <option value="">Select gender</option>
                  <option>Male</option>
                  <option>Female</option>
                  <option>Other</option>
                </select>
                {errors.gender && <span className="form-error">{errors.gender}</span>}
              </div>

              {/* Corporate ONLY fields */}
              {isCorporate && (
                <>
                  <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                      <div style={{ flex: 1 }}>
                        <label className="form-label">Employee Number *</label>
                        <input 
                          className="form-input" 
                          placeholder="e.g. EMP-12345" 
                          value={form.empNumber} 
                          onChange={e => set('empNumber', e.target.value)}
                          onBlur={(e) => fetchDependents(e.target.value)} 
                        />
                      </div>
                      <button 
                        type="button" 
                        className="btn btn-outline" 
                        style={{ height: '42px', padding: '0 20px', borderColor: accentBorder, color: accentColor }}
                        onClick={() => fetchDependents(form.empNumber)}
                        disabled={isSearchingDependents}
                      >
                        {isSearchingDependents ? 'Searching...' : 'Search Dependents'}
                      </button>
                    </div>
                    {errors.empNumber && <span className="form-error">{errors.empNumber}</span>}

                    {/* Dependents Selection UI */}
                    {dependents.length > 0 && (
                      <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px', border: '1px dashed rgba(0,0,0,0.1)' }}>
                        <label className="form-label" style={{ marginBottom: '10px' }}>Matched Profiles Found (Click to Auto-fill)</label>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                          {dependents.map((dep, idx) => (
                            <div 
                              key={idx}
                              onClick={() => selectDependent(dep)}
                              style={{
                                padding: '10px 16px',
                                background: '#fff',
                                border: `1.5px solid ${accentBorder}`,
                                borderRadius: '8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                flex: '1 1 calc(50% - 10px)',
                                minWidth: '200px'
                              }}
                              onMouseOver={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'; }}
                              onMouseOut={e => { e.currentTarget.style.borderColor = accentBorder; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                                {dep.name} <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 400 }}>({dep.age}y, {dep.gender})</span>
                              </div>
                              <div style={{ fontSize: '0.85rem', color: accentColor, fontWeight: 500, display: 'inline-block', background: accentBg, padding: '2px 8px', borderRadius: '12px' }}>
                                {dep.relationship}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Relationship to Employee</label>
                    <select className="form-select" value={form.relationship} onChange={e => set('relationship', e.target.value)}>
                      {RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  {form.relationship === 'Other' && (
                    <div className="form-group">
                      <label className="form-label">Specify Relationship *</label>
                      <input className="form-input" placeholder="e.g. Brother" value={form.relationshipOther} onChange={e => set('relationshipOther', e.target.value)} />
                      {errors.relationshipOther && <span className="form-error">{errors.relationshipOther}</span>}
                    </div>
                  )}
                </>
              )}

              {/* OTHERS ONLY */}
              {!isCorporate && (
                <div className="form-group">
                  <label className="form-label">Phone Number *</label>
                  <input
                    className="form-input" placeholder="10-digit Phone number"
                    value={form.phoneNumber}
                    onChange={e => set('phoneNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                    maxLength={10}
                  />
                  {errors.phoneNumber && <span className="form-error">{errors.phoneNumber}</span>}
                </div>
              )}
            </div>
          </div>

          {/* ── Visit Details ─────────────────────────────────── */}
          <div className="card-section">
            <div className="card-section-title">Visit Details</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">OPD / Indoor</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  {['OPD', 'Indoor'].map(opt => (
                    <button
                      key={opt} type="button"
                      onClick={() => set('opdIndoor', opt)}
                      style={{
                        flex: 1, padding: '10px', borderRadius: 8,
                        border: `1.5px solid ${form.opdIndoor === opt ? accentColor : 'var(--input-border)'}`,
                        background: form.opdIndoor === opt ? accentBg : 'var(--input-bg)',
                        color: form.opdIndoor === opt ? accentColor : 'var(--text-secondary)',
                        cursor: 'pointer', fontFamily: 'var(--font-body)',
                        fontWeight: form.opdIndoor === opt ? 600 : 400, fontSize: '0.875rem',
                        transition: 'all 0.2s',
                      }}
                    >{opt}</button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Ward</label>
                <select className="form-select" value={form.ward} onChange={e => set('ward', e.target.value)}>
                  {WARDS.map(w => <option key={w}>{w}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Test Date *</label>
                <input className="form-input" type="date" value={form.testDate} onChange={e => set('testDate', e.target.value)} />
                {errors.testDate && <span className="form-error">{errors.testDate}</span>}
              </div>

              <div className="form-group">
                <label className="form-label">Provisional Diagnosis</label>
                <select className="form-select" value={form.provDiagnosis} onChange={e => set('provDiagnosis', e.target.value)}>
                  <option value="">Select or leave blank</option>
                  {DIAGNOSES.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              
              {form.provDiagnosis === 'Other' && (
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Specify Diagnosis *</label>
                  <input className="form-input" placeholder="e.g. COVID-19" value={form.provDiagnosisOther} onChange={e => set('provDiagnosisOther', e.target.value)} />
                  {errors.provDiagnosisOther && <span className="form-error">{errors.provDiagnosisOther}</span>}
                </div>
              )}
            </div>
          </div>

          {/* ── Doctor & Department Assignment (NEW) ─────────── */}
          <div className="card-section">
            <div className="card-section-title">Doctor & Department Assignment</div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '16px' }}>
              Optionally assign this patient to a doctor and department for easier tracking
            </p>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Doctor</label>
                <select 
                  className="form-select" 
                  value={form.doctorId} 
                  onChange={e => set('doctorId', e.target.value)}
                  disabled={loadingOptions}
                >
                  <option value="">Select Doctor (Optional)</option>
                  {doctors.map(doc => (
                    <option key={doc.id} value={doc.id}>
                      {doc.user?.name || doc.user?.username} {doc.speciality ? `- ${doc.speciality}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Department</label>
                <select 
                  className="form-select" 
                  value={form.departmentId} 
                  onChange={e => set('departmentId', e.target.value)}
                  disabled={loadingOptions}
                >
                  <option value="">Select Department (Optional)</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name} {dept.short_code ? `(${dept.short_code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? (
                <><div className="spinner" style={{ width: 16, height: 16 }} /> {isEditMode ? 'Updating…' : 'Registering…'}</>
              ) : (
                isEditMode ? 'Update Patient ✓' : 'Register & Enter Test Results →'
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
