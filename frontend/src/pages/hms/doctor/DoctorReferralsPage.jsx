import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const PRIORITY_OPTIONS = ['Routine', 'Urgent', 'Emergency'];
const SPECIALTY_OPTIONS = [
  'Cardiology', 'Neurology', 'Orthopedics', 'ENT', 'Ophthalmology',
  'Dermatology', 'Gastroenterology', 'Pulmonology', 'Nephrology',
  'Urology', 'Oncology', 'Psychiatry', 'Pediatrics', 'Gynecology',
  'General Surgery', 'Endocrinology', 'Rheumatology', 'Other',
];

const isCustomizedHospitalOption = (name) => String(name || '').trim().toLowerCase() === 'other';
const getHospitalOptionLabel = (name) => isCustomizedHospitalOption(name) ? 'Customized' : name;

const buildEmptyReferralForm = (type = "Outside") => ({
  patientId: "",
  toSpecialty: "",
  priority: "Routine",
  hospital: type === "Local" ? "HMS Hospital" : "",
  reason: "",
  clinicalNotes: "",
  empName: "",
  empNumber: "",
  relationship: "",
  patientDepartment: "",
  caseType: "",
  referralType: type,
  treatmentHospital: "",
  treatmentLocal: "",
  treatmentPeriod: "",
  escortAllowed: "No",
  escortCount: "",
  ambulanceAllowed: "No",
  ambulanceEscortJustification: "",
});

export default function DoctorReferralsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const [referralType, setReferralType] = useState(location.state?.type || 'Outside');
  const [referrals, setReferrals] = useState({ outbound: [], inbound: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState((location.state?.autoSelectPatient || location.state?.type) ? 'create' : 'hub'); // 'hub' | 'create'
  const [editReferralId, setEditReferralId] = useState(null);
  const [previewReferral, setPreviewReferral] = useState(null);
  const [isPreviewSaving, setIsPreviewSaving] = useState(false);
  const [inboundOpen, setInboundOpen] = useState(false);
  const [outboundOpen, setOutboundOpen] = useState(false);
  const [outboundLocalOpen, setOutboundLocalOpen] = useState(false);
  const printRef = useRef(null);
  const previewDraftRef = useRef(null);

  const updatePreviewDraftField = (fieldKey, value) => {
    if (!fieldKey) return;
    const currentDraft = previewDraftRef.current || previewReferral || {};
    const nextDraft = { ...currentDraft, [fieldKey]: value };
    previewDraftRef.current = nextDraft;
    setPreviewReferral(nextDraft);
  };

  const EditableSpan = ({ value, fieldKey, style }) => (
    <span
      contentEditable
      suppressContentEditableWarning
      onBlur={e => updatePreviewDraftField(fieldKey, e.currentTarget.innerText)}
      style={{
        ...style,
        outline: 'none',
        cursor: 'text',
        transition: 'background 0.2s',
        borderRadius: 4,
        display: 'inline-block',
        minWidth: '60px',
      }}
      onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      onFocus={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'}
    >
      {value || ''}
    </span>
  );

  // Create form state
  const [formData, setFormData] = useState(() => buildEmptyReferralForm(location.state?.type || 'Outside'));
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [searchingPatient, setSearchingPatient] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const searchTimerRef = useRef(null);

  // Hospital autocomplete state
  const [hospitalResults, setHospitalResults] = useState([]);
  const [showHospitalDropdown, setShowHospitalDropdown] = useState(false);
  const [searchingHospital, setSearchingHospital] = useState(false);
  const hospitalTimerRef = useRef(null);

  // Reason autocomplete state
  const [reasonSuggestions, setReasonSuggestions] = useState(['Chest pain', 'Fever', 'Headache']);
  const [showReasonDropdown, setShowReasonDropdown] = useState(false);
  const [reasonsFetched, setReasonsFetched] = useState(false);

  // Patient History state
  const [patientHistory, setPatientHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Handle auto-select patient from navigation
  useEffect(() => {
    let triggered = false;
    
    if (location.state?.type) {
      setReferralType(location.state.type);
      setFormData(prev => ({ 
        ...prev, 
        referralType: location.state.type,
        hospital: location.state.type === 'Local' ? 'HMS Hospital' : ''
      }));
      setActiveTab('create');
      triggered = true;
    }

    if (location.state?.autoSelectPatient && !selectedPatient) {
      const p = location.state.autoSelectPatient;
      handleSelectPatient(p);
      setActiveTab('create');
      triggered = true;
    }
    
    if (triggered) {
      // Clear state so a refresh doesn't trigger it again
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  const fetchReferrals = () => {
    setLoading(true);
    return api.get('/doctor/referrals')
      .then(res => {
        const data = res.data.data || { outbound: [], inbound: [] };
        if (data.outbound) {
          data.outbound.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id);
        }
        if (data.inbound) {
          data.inbound.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime() || b.id - a.id);
        }
        setReferrals(data);
      })
      .catch(() => setReferrals({ outbound: [], inbound: [] }))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReferrals();
  }, []);

  useEffect(() => {
    if (!reasonsFetched) {
      api.get('/doctor/referrals/reasons').then(res => {
        if (res.data?.success && res.data?.data) {
          setReasonSuggestions(prev => Array.from(new Set([...prev, ...res.data.data])));
          setReasonsFetched(true);
        }
      }).catch(err => console.error(err));
    }
  }, [reasonsFetched]);

  // Patient search with debounce
  useEffect(() => {
    const q = patientQuery.trim();
    if (q.length < 2 || selectedPatient) {
      setPatientResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      setSearchingPatient(true);
      try {
        const res = await api.get(`/patients/hms/search?q=${encodeURIComponent(q)}`);
        setPatientResults(Array.isArray(res.data?.data) ? res.data.data.slice(0, 8) : []);
        setShowPatientDropdown(true);
      } catch {
        setPatientResults([]);
      } finally {
        setSearchingPatient(false);
      }
    }, 300);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [patientQuery, selectedPatient]);

  // Fetch patient history when selectedPatient changes
  useEffect(() => {
    if (selectedPatient) {
      setLoadingHistory(true);
      api.get(`/doctor/referrals/patient/${selectedPatient.id}`)
        .then(res => setPatientHistory(res.data?.data || []))
        .catch(err => {
          console.error(err);
          const msg = err.response?.data?.message || err.message;
          toast.error(`Error loading history: ${msg}`);
        })
        .finally(() => setLoadingHistory(false));
    } else {
      setPatientHistory([]);
    }
  }, [selectedPatient]);

  const handleSelectPatient = async (patient) => {
    setSelectedPatient(patient);
    setPatientQuery(`${patient.name} — ${patient.uhid}`);
    setShowPatientDropdown(false);
    setPatientResults([]);
    
    let empUpdate = {
      patientId: patient.id,
      empName: '',
      empNumber: '',
      relationship: ''
    };

    // Auto-fill employee details for dependents
    if (patient.patientType === 'corporate_employee') {
      empUpdate.empNumber = patient.empNumber || '';
      empUpdate.relationship = patient.relationship || 'Self';
      
      if (patient.relationship !== 'Self' && patient.empNumber) {
        try {
          const res = await api.get(`/patients/hms/emp/${encodeURIComponent(patient.empNumber)}`);
          const principal = res.data.data.find(d => d.relationship === 'Self');
          if (principal) {
            empUpdate.empName = principal.name;
          }
        } catch (err) {
          console.error("Failed to fetch principal employee name", err);
        }
      }
    }

    setFormData(prev => ({ ...prev, ...empUpdate }));
  };

  const clearSelectedPatient = () => {
    setSelectedPatient(null);
    setFormData(prev => ({ 
      ...prev, 
      patientId: '',
      empName: '',
      empNumber: '',
      relationship: ''
    }));
    setPatientQuery('');
  };

  const handleHospitalChange = (e) => {
    const val = e.target.value;
    setFormData(prev => ({ ...prev, hospital: val }));
    setShowHospitalDropdown(true);

    if (val.trim().length < 2) {
      setHospitalResults([]);
      return;
    }

    if (hospitalTimerRef.current) clearTimeout(hospitalTimerRef.current);
    hospitalTimerRef.current = setTimeout(async () => {
      setSearchingHospital(true);
      try {
        const res = await api.get(`/doctor/hospitals/search?q=${encodeURIComponent(val.trim())}`);
        setHospitalResults(Array.isArray(res.data?.data) ? res.data.data : []);
      } catch (err) {
        console.error("Failed to search hospital", err);
        setHospitalResults([]);
      } finally {
        setSearchingHospital(false);
      }
    }, 300);
  };

  const handleEditReferral = async (ref) => {
    setEditReferralId(ref.id);
    
    let fetchedEmpName = ref.patient_type === 'corporate_employee' && ref.relationship !== 'Self' ? '' : ref.patient;
    if (ref.patient_type === 'corporate_employee' && ref.relationship !== 'Self' && ref.emp_number) {
      try {
        const res = await api.get(`/patients/hms/emp/${encodeURIComponent(ref.emp_number)}`);
        const principal = res.data.data.find(d => d.relationship === 'Self');
        if (principal) fetchedEmpName = principal.name;
      } catch (err) {
        console.error('Failed to fetch employee name for edit', err);
      }
    }

    setFormData({
      patientId: ref.patient_id,
      toSpecialty: ref.to_specialty,
      priority: 'Routine', 
      hospital: ref.hospital || '', 
      reason: ref.reason || '',
      clinicalNotes: ref.clinical_notes || '',
      empNumber: ref.emp_number || '',
      relationship: ref.relationship || '',
      empName: ref.emp_name || fetchedEmpName || '',
      patientDepartment: ref.patient_department || '',
      caseType: ref.case_type || '',
      referralType: ref.referral_type || 'Outside',
      treatmentHospital: ref.treatment_hospital || '',
      treatmentLocal: ref.treatment_local || '',
      treatmentPeriod: ref.treatment_period || '',
      escortAllowed: ref.escort_allowed || 'No',
      escortCount: ref.escort_count || '',
      ambulanceAllowed: ref.ambulance_allowed || 'No',
      ambulanceEscortJustification: ref.ambulance_escort_justification || ''
    });
    setReferralType(ref.referral_type || 'Outside');
    setSelectedPatient({ id: ref.patient_id, name: ref.patient, uhid: ref.uhid || 'Unknown', age: '-', gender: '-' });
    setPatientQuery(`${ref.patient} — ${ref.uhid || 'Unknown'}`);
    setActiveTab('create');
  };

  const handleDeleteReferral = async (id) => {
    if (!window.confirm("Are you sure you want to delete this referral?")) return;
    try {
      await api.delete(`/doctor/referrals/${id}`);
      toast.success('Referral deleted successfully');
      fetchReferrals();
    } catch {
      toast.error('Failed to delete referral');
    }
  };

  const handlePreview = async (ref) => {
    // If it's a corporate employee, try to fetch the employee name for dependents
    let empName = '';
    if (ref.patient_type === 'corporate_employee' && ref.relationship && ref.relationship !== 'Self' && ref.emp_number) {
      try {
        const res = await api.get(`/patients/hms/emp/${encodeURIComponent(ref.emp_number)}`);
        const principal = res.data.data.find(d => d.relationship === 'Self');
        if (principal) empName = principal.name;
      } catch (err) {
        console.error('Failed to fetch employee name for preview', err);
      }
    }
    const nextPreview = {
      ...ref,
      empName: ref.emp_name || ref.empName || empName || '',
      patient_department: ref.patient_department || '',
      case_type: ref.case_type || '',
    };
    previewDraftRef.current = nextPreview;
    setPreviewReferral(nextPreview);
  };

  const handlePrintReferral = () => {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const win = window.open('', '_blank');
    win.document.write(`
      <html>
      <head>
        <title>Referral Memo - HMS Hospital</title>
        <style>
          @page { size: A4; margin: 15mm; }
          html, body { width: 100%; }
          body { font-family: 'Times New Roman', Georgia, serif; color: #000; margin: 0; padding: 0; font-size: 13px; background: #fff; }
          .memo-paper { width: 100%; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
          .outside-memo-header { min-height: 104px; padding-left: 112px !important; padding-right: 16px !important; box-sizing: border-box; break-inside: avoid; }
          .outside-memo-header img { left: 0 !important; top: 0 !important; width: 96px !important; height: 96px !important; }
          .outside-memo-header h1 { font-size: 18px !important; letter-spacing: 0.4px !important; line-height: 1.2 !important; white-space: nowrap; }
          .memo-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; position: relative; }
          .memo-header img { position: absolute; left: 0; top: 0; width: 100px; height: 100px; object-fit: contain; }
          .memo-header h1 { margin: 0; font-size: 20px; letter-spacing: 1px; }
          .memo-header h2 { margin: 2px 0; font-size: 16px; font-weight: 700; }
          .memo-header h3 { margin: 2px 0; font-size: 16px; font-weight: 600; }
          .memo-ref-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; }
          .memo-field { display: flex; gap: 6px; padding: 5px 0; font-size: 13px; }
          .memo-field .lbl { min-width: 240px; font-weight: 600; flex-shrink: 0; }
          .memo-field .val { flex: 1; border-bottom: 1px solid #000; min-height: 16px; padding-left: 4px; }
          .memo-field-inline { display: flex; gap: 16px; }
          .memo-field-inline .memo-field { flex: 1; }
          .memo-sig-row { display: flex; justify-content: space-between; margin-top: 50px; text-align: center; }
          .memo-sig-row div { width: 30%; }
          .memo-sig-row .sig-line { border-top: 1px solid #000; padding-top: 4px; font-weight: 600; font-size: 12px; }
          .memo-sig-row .sig-hindi { font-size: 11px; }
          .memo-footer { margin-top: 30px; border-top: 1px solid #aaa; padding-top: 10px; font-size: 12px; }
          .memo-approved { text-align: right; margin-top: 20px; font-weight: 600; }
        </style>
      </head>
      <body>${printContent}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  const handleCreateReferral = async (e) => {
    e.preventDefault();
    if (!formData.patientId) {
      toast.error('Please select a patient');
      return;
    }
    setSubmitting(true);
    try {
      if (editReferralId) {
        await api.put(`/doctor/referrals/${editReferralId}`, formData);
        toast.success('Referral updated successfully');
      } else {
        await api.post('/doctor/referrals', formData);
        toast.success('Referral created successfully');
      }
      
      // Optimistically add the new reason to suggestions
      if (formData.reason && !reasonSuggestions.some(r => r.toLowerCase() === formData.reason.trim().toLowerCase())) {
        setReasonSuggestions(prev => [...prev, formData.reason.trim()]);
      }

      setFormData(buildEmptyReferralForm(referralType));
      clearSelectedPatient();
      setEditReferralId(null);
      setActiveTab('hub');
      fetchReferrals();
    } catch {
      toast.error(editReferralId ? 'Failed to update referral' : 'Failed to create referral');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePreviewChanges = async () => {
    const draft = previewDraftRef.current || previewReferral;
    if (!draft) return;

    setIsPreviewSaving(true);
    try {
      const payload = {
        patientId: draft.patient_id,
        patientName: draft.patient,
        empNumber: draft.emp_number,
        toSpecialty: draft.to_specialty,
        reason: draft.reason,
        hospital: draft.hospital || 'HMS Hospital',
        referralType: draft.referral_type,
        clinicalNotes: draft.clinical_notes,
        empName: draft.empName || draft.emp_name || '',
        patientDepartment: draft.patient_department || '',
        caseType: draft.case_type || '',
      };

      const response = await api.put('/doctor/referrals/' + draft.id, payload);
      const savedReferral = response.data?.data;
      const nextPreview = savedReferral
        ? {
            ...draft,
            ...savedReferral,
            empName: savedReferral.emp_name || draft.empName || draft.emp_name || '',
          }
        : draft;

      previewDraftRef.current = nextPreview;
      setPreviewReferral(nextPreview);
      await fetchReferrals();
      toast.success('Referral changes saved successfully');
    } catch (error) {
      console.error('Failed to save referral preview changes:', error);
      toast.error(error.response?.data?.message || 'Failed to save referral changes');
    } finally {
      setIsPreviewSaving(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const statusBadge = (status) => {
    const styles = {
      Pending:   { bg: 'rgba(245,158,11,0.12)', color: '#d97706' },
      Accepted:  { bg: 'rgba(16,185,129,0.12)', color: '#059669' },
      Completed: { bg: 'rgba(59,130,246,0.12)', color: '#2563eb' },
      Declined:  { bg: 'rgba(239,68,68,0.12)',  color: '#dc2626' },
    };
    const s = styles[status] || styles.Pending;
    return (
      <span style={{
        padding: '3px 12px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700,
        background: s.bg, color: s.color, letterSpacing: '0.02em',
      }}>
        {status || 'Pending'}
      </span>
    );
  };

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: 1200 }}>
        {/* Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🔄</span>
              Referrals Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Send patients to specialists or manage inward referrals.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="hms-anim-2" style={{ display: 'flex', gap: 0, marginBottom: 24, borderBottom: '2px solid var(--border, #e2e8f0)' }}>
          <button
            className={`hms-tab-btn ${activeTab === 'hub' ? 'active' : ''}`}
            onClick={() => setActiveTab('hub')}
            style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}
          >
            📋 Referral List
          </button>
          <button
            className={`hms-tab-btn ${activeTab === 'create' && referralType === 'Outside' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('create');
              setReferralType('Outside');
              setEditReferralId(null);
              setFormData(buildEmptyReferralForm('Outside'));
              clearSelectedPatient();
            }}
            style={{ borderRadius: 0, borderRight: '1px solid var(--border)' }}
          >
            {editReferralId && referralType === 'Outside' ? '✏️ Edit Outside Referral' : '＋ Create Outside Referral'}
          </button>
          <button
            className={`hms-tab-btn ${activeTab === 'create' && referralType === 'Local' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('create');
              setReferralType('Local');
              setEditReferralId(null);
              setFormData(buildEmptyReferralForm('Local'));
              clearSelectedPatient();
            }}
            style={{ borderRadius: 0 }}
          >
            {editReferralId && referralType === 'Local' ? '✏️ Edit Local Referral' : '＋ Create Local Referral'}
          </button>
        </div>

        {/* Tab: Referral List */}
        {activeTab === 'hub' && (
          <div className="hms-anim-3" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Inbound */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setInboundOpen(!inboundOpen)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '18px 24px', background: 'var(--surface-2)', border: 'none',
                  borderBottom: inboundOpen ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3, rgba(0,0,0,0.04))'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📥 Inbound Referrals <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>(To You)</span></h3>
                  <span className="badge" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: '0.72rem', padding: '2px 8px' }}>{referrals.inbound.length}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    onClick={(e) => { e.stopPropagation(); fetchReferrals(); }}
                    style={{ fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}
                    title="Refresh"
                  >↻ Refresh</span>
                  <span style={{ fontSize: '1.1rem', transition: 'transform 0.25s', transform: inboundOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>▼</span>
                </div>
              </button>
              {inboundOpen && (
                <div style={{ padding: 24 }}>
                  {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
                  ) : referrals.inbound.length === 0 ? (
                    <div style={{
                      padding: '32px 24px', textAlign: 'center', borderRadius: 8,
                      background: 'rgba(0,0,0,0.03)', color: 'var(--text-secondary)',
                    }}>
                      <span style={{ fontSize: '1.6rem' }}>📭</span>
                      <p style={{ margin: '8px 0 0', fontSize: '0.875rem' }}>No inbound referrals at this time.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr><th>Date</th><th>Patient</th><th>From Doctor</th><th>Reason</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                          {referrals.inbound.map((ref, idx) => (
                            <tr key={idx}>
                              <td>{formatDate(ref.date)}</td>
                              <td><strong>{ref.patient}</strong></td>
                              <td>{ref.from_doctor}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ref.reason || '-'}
                              </td>
                              <td><button className="btn btn-sm btn-outline">Review</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Outbound - Outside */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setOutboundOpen(!outboundOpen)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '18px 24px', background: 'var(--surface-2)', border: 'none',
                  borderBottom: outboundOpen ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3, rgba(0,0,0,0.04))'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📤 Outbound Referrals (Outside) <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>(By You)</span></h3>
                  <span className="badge" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: '0.72rem', padding: '2px 8px' }}>
                    {referrals.outbound.filter(r => r.referral_type !== 'Local').length}
                  </span>
                </div>
                <span style={{ fontSize: '1.1rem', transition: 'transform 0.25s', transform: outboundOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>▼</span>
              </button>
              {outboundOpen && (
                <div style={{ padding: 24 }}>
                  {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
                  ) : referrals.outbound.filter(r => r.referral_type !== 'Local').length === 0 ? (
                    <div style={{
                      padding: '32px 24px', textAlign: 'center', borderRadius: 8,
                      background: 'rgba(0,0,0,0.03)', color: 'var(--text-secondary)',
                    }}>
                      <span style={{ fontSize: '1.6rem' }}>📬</span>
                      <p style={{ margin: '8px 0 0', fontSize: '0.875rem' }}>No outside outbound referrals yet.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr><th>Date</th><th>Patient</th><th>Specialty Target</th><th>Reason</th><th>Status</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                          {referrals.outbound.filter(r => r.referral_type !== 'Local').map((ref, idx) => (
                            <tr key={idx}>
                              <td>{formatDate(ref.date)}</td>
                              <td>
                                {ref.referral_type && (
                                  <span style={{ 
                                    display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, 
                                    background: 'rgba(245,158,11,0.1)',
                                    color: '#f59e0b',
                                    border: '1px solid rgba(245,158,11,0.2)',
                                    marginRight: '6px', verticalAlign: 'middle'
                                  }}>
                                    OUTSIDE
                                  </span>
                                )}
                                <strong>{ref.patient}</strong>
                              </td>
                              <td>{ref.to_specialty}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ref.reason || '-'}
                              </td>
                              <td>{statusBadge(ref.status)}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-sm btn-outline" onClick={() => handlePreview(ref)} style={{ color: '#2563eb', borderColor: 'rgba(37,99,235,0.2)' }}>Preview</button>
                                  <button className="btn btn-sm btn-outline" onClick={() => handleEditReferral(ref)}>Edit</button>
                                  <button className="btn btn-sm btn-outline" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }} onClick={() => handleDeleteReferral(ref.id)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Outbound - Local */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => setOutboundLocalOpen(!outboundLocalOpen)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '18px 24px', background: 'var(--surface-2)', border: 'none',
                  borderBottom: outboundLocalOpen ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer', transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3, rgba(0,0,0,0.04))'}
                onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📤 Outbound Referrals (Local) <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>(By You)</span></h3>
                  <span className="badge" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: '0.72rem', padding: '2px 8px' }}>
                    {referrals.outbound.filter(r => r.referral_type === 'Local').length}
                  </span>
                </div>
                <span style={{ fontSize: '1.1rem', transition: 'transform 0.25s', transform: outboundLocalOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>▼</span>
              </button>
              {outboundLocalOpen && (
                <div style={{ padding: 24 }}>
                  {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><div className="spinner" /></div>
                  ) : referrals.outbound.filter(r => r.referral_type === 'Local').length === 0 ? (
                    <div style={{
                      padding: '32px 24px', textAlign: 'center', borderRadius: 8,
                      background: 'rgba(0,0,0,0.03)', color: 'var(--text-secondary)',
                    }}>
                      <span style={{ fontSize: '1.6rem' }}>📬</span>
                      <p style={{ margin: '8px 0 0', fontSize: '0.875rem' }}>No local outbound referrals yet.</p>
                    </div>
                  ) : (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr><th>Date</th><th>Patient</th><th>Specialty Target</th><th>Reason</th><th>Status</th><th>Action</th></tr>
                        </thead>
                        <tbody>
                          {referrals.outbound.filter(r => r.referral_type === 'Local').map((ref, idx) => (
                            <tr key={idx}>
                              <td>{formatDate(ref.date)}</td>
                              <td>
                                {ref.referral_type && (
                                  <span style={{ 
                                    display: 'inline-block', padding: '2px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700, 
                                    background: 'rgba(59,130,246,0.1)',
                                    color: '#3b82f6',
                                    border: '1px solid rgba(59,130,246,0.2)',
                                    marginRight: '6px', verticalAlign: 'middle'
                                  }}>
                                    LOCAL
                                  </span>
                                )}
                                <strong>{ref.patient}</strong>
                              </td>
                              <td>{ref.to_specialty}</td>
                              <td style={{ maxWidth: 260 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.reason || '-'}</div>
                                {ref.clinical_notes && (
                                  <div
                                    style={{
                                      marginTop: 4,
                                      color: 'var(--text-muted)',
                                      fontSize: '0.75rem',
                                      lineHeight: 1.35,
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}
                                    title={ref.clinical_notes}
                                  >
                                    <strong>Clinical:</strong> {ref.clinical_notes}
                                  </div>
                                )}
                              </td>
                              <td>{statusBadge(ref.status)}</td>
                              <td>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-sm btn-outline" onClick={() => handlePreview(ref)} style={{ color: '#2563eb', borderColor: 'rgba(37,99,235,0.2)' }}>Preview</button>
                                  <button className="btn btn-sm btn-outline" onClick={() => handleEditReferral(ref)}>Edit</button>
                                  <button className="btn btn-sm btn-outline" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)' }} onClick={() => handleDeleteReferral(ref.id)}>Delete</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Create Referral */}
        {activeTab === 'create' && (
          <div className="hms-anim-3" style={{
            display: 'flex', gap: 24, maxWidth: selectedPatient ? 1140 : 760, margin: '0 auto',
            alignItems: 'flex-start', transition: 'max-width 0.3s ease'
          }}>
            <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ padding: '18px 28px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem' }}>
                  {editReferralId ? '✏️' : '📝'}
                </span>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.15rem' }}>
                    {editReferralId ? `Edit ${referralType} Referral` : `New ${referralType} Referral`}
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0 }}>
                    {editReferralId ? `Update the details for this ${referralType.toLowerCase()} referral.` : `Fill in the details to refer a patient to ${referralType === 'Local' ? 'another department' : 'an outside specialist'}.`}
                  </p>
                </div>
              </div>
              <div style={{ padding: '28px 28px 24px' }}>

              <form onSubmit={handleCreateReferral}>
                {/* Patient Search */}
                <div style={{ marginBottom: 20 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(59,130,246,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>👤</span>
                    Patient <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Search by name, UHID, or phone..."
                      value={patientQuery}
                      onChange={(e) => {
                        setPatientQuery(e.target.value);
                        if (selectedPatient) clearSelectedPatient();
                      }}
                      onFocus={() => { if (patientResults.length) setShowPatientDropdown(true); }}
                      style={{ paddingRight: selectedPatient ? 36 : 12 }}
                    />
                    {searchingPatient && (
                      <div className="spinner" style={{
                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                        width: 18, height: 18,
                      }} />
                    )}
                    {selectedPatient && (
                      <button
                        type="button"
                        onClick={clearSelectedPatient}
                        style={{
                          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                          background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem',
                          color: 'var(--text-muted)', lineHeight: 1,
                        }}
                        title="Clear patient"
                      >✕</button>
                    )}

                    {showPatientDropdown && patientResults.length > 0 && !selectedPatient && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                        background: 'var(--surface-1, #fff)', border: '1.5px solid var(--green-border, #10b981)',
                        borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,0.15)', maxHeight: 220,
                        animation: 'hmsScaleIn 0.2s ease both',
                        overflowY: 'auto',
                      }}>
                        {patientResults.map((p) => (
                          <div
                            key={p.id}
                            onMouseDown={() => handleSelectPatient(p)}
                            style={{
                              padding: '10px 14px', cursor: 'pointer', fontSize: '0.85rem',
                              borderBottom: '1px solid var(--border, #eee)',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                              {p.uhid} • {p.age}y • {p.gender}
                              {p.empNumber && <span> • Emp: {p.empNumber}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected Patient Card */}
                  {selectedPatient && (
                    <div style={{
                      marginTop: 10, padding: '10px 14px', borderRadius: 8,
                      background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{selectedPatient.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {selectedPatient.uhid} • {selectedPatient.age}y / {selectedPatient.gender}
                          {selectedPatient.patientType === 'corporate_employee' && (
                            <span style={{ color: '#059669', fontWeight: 600 }}> • Corporate</span>
                          )}
                        </div>
                      </div>
                      <span style={{ fontSize: '1.2rem' }}>✅</span>
                    </div>
                  )}
                </div>

                {/* Corporate Dependent Info (AUTO-FILLED) */}
                {selectedPatient?.patientType === 'corporate_employee' && (
                  <div className="hms-anim-2" style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(3, 1fr)', 
                    gap: 16, 
                    marginBottom: 20,
                    padding: '16px 20px',
                    background: 'rgba(16, 185, 129, 0.04)',
                    borderRadius: 12,
                    border: '1px solid rgba(16, 185, 129, 0.15)'
                  }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Employee Number
                      </label>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formData.empNumber || '—'}</div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Employee Name
                      </label>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formData.empName || (formData.relationship === 'Self' ? selectedPatient.name : '—')}</div>
                    </div>
                    <div>
                      <label style={{ display: 'block', marginBottom: 4, fontWeight: 600, fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Relation
                      </label>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{formData.relationship || '—'}</div>
                    </div>
                  </div>
                )}

                {/* Specialty & Priority row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 20 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 0 }}>
                      <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(139,92,246,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>🏥</span>
                      Target Specialty
                    </label>
                    <select
                      className="form-input"
                      value={SPECIALTY_OPTIONS.includes(formData.toSpecialty) ? formData.toSpecialty : (formData.toSpecialty ? 'Other' : '')}
                      onChange={e => setFormData({ ...formData, toSpecialty: e.target.value })}
                    >
                      <option value="">Select specialty...</option>
                      {SPECIALTY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(formData.toSpecialty === 'Other' || (formData.toSpecialty && !SPECIALTY_OPTIONS.includes(formData.toSpecialty))) && (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Please specify specialty..."
                        value={formData.toSpecialty === 'Other' ? '' : formData.toSpecialty}
                        onChange={e => setFormData({ ...formData, toSpecialty: e.target.value || 'Other' })}
                        autoFocus
                        style={{ animation: 'hmsScaleIn 0.2s ease both' }}
                      />
                    )}
                  </div>
                  <div>
                    <label className="form-label">
                      Priority
                    </label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      {PRIORITY_OPTIONS.map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setFormData({ ...formData, priority: p })}
                          style={{
                            flex: 1, padding: '8px 0', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem',
                            cursor: 'pointer', transition: 'all 0.2s', border: '1.5px solid',
                            background: formData.priority === p
                              ? (p === 'Emergency' ? 'rgba(239,68,68,0.12)' : p === 'Urgent' ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)')
                              : 'transparent',
                            borderColor: formData.priority === p
                              ? (p === 'Emergency' ? '#ef4444' : p === 'Urgent' ? '#f59e0b' : '#10b981')
                              : 'var(--border, #ddd)',
                            color: formData.priority === p
                              ? (p === 'Emergency' ? '#dc2626' : p === 'Urgent' ? '#d97706' : '#059669')
                              : 'var(--text-secondary)',
                          }}
                        >
                          {p === 'Emergency' ? '🔴' : p === 'Urgent' ? '🟡' : '🟢'} {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Hospital */}
                <div style={{ marginBottom: 20 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(245,158,11,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>🏥</span>
                    Referral Hospital <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="text"
                      className="form-input"
                      value={formData.hospital}
                      onChange={handleHospitalChange}
                      onFocus={() => {
                        if (formData.hospital && formData.hospital.length >= 2) setShowHospitalDropdown(true);
                      }}
                      onBlur={() => setTimeout(() => setShowHospitalDropdown(false), 200)}
                      placeholder="e.g. PGI Chandigarh, AIIMS Delhi, DMC Ludhiana..."
                      required
                      style={{ paddingLeft: 38 }}
                      autoComplete="off"
                    />
                    <span
                      style={{
                        position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                        fontSize: '1.05rem', cursor: 'pointer', color: 'var(--text-muted)',
                        transition: 'color 0.2s', userSelect: 'none', zIndex: 2,
                      }}
                    >
                      🔍
                    </span>
                    {/* Hospital Dropdown */}
                    {showHospitalDropdown && (hospitalResults.length > 0 || searchingHospital || formData.hospital.trim().length >= 2) && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: '#fff', border: '1px solid var(--border, #ddd)',
                        borderRadius: 8, marginTop: 4, zIndex: 10,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)', overflow: 'hidden'
                      }}>
                        {searchingHospital ? (
                          <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)' }}>Searching...</div>
                        ) : (
                          <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: 250, overflowY: 'auto' }}>
                            {hospitalResults.map((hosp, idx) => {
                              const hospitalLabel = getHospitalOptionLabel(hosp.name);
                              const isCustomized = isCustomizedHospitalOption(hosp.name);
                              return (
                                <li
                                  key={idx}
                                  onMouseDown={() => {
                                    setFormData(prev => ({ ...prev, hospital: isCustomized ? prev.hospital : hosp.name }));
                                    setShowHospitalDropdown(false);
                                  }}
                                  style={{
                                    padding: '12px 16px', borderBottom: '1px solid #f1f5f9',
                                    cursor: 'pointer', transition: 'background 0.2s',
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                  <div style={{ fontWeight: 600 }}>{hospitalLabel}</div>
                                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {isCustomized ? 'Type the desired hospital name in the field above' : hosp.place || 'Unknown location'}
                                  </div>
                                </li>
                              );
                            })}
                            {formData.hospital.trim().length >= 2 && !hospitalResults.some((hosp) => String(hosp.name || '').trim().toLowerCase() === formData.hospital.trim().toLowerCase()) && (
                              <li
                                key="custom-hospital"
                                onMouseDown={() => {
                                  setFormData(prev => ({ ...prev, hospital: prev.hospital.trim() }));
                                  setShowHospitalDropdown(false);
                                }}
                                style={{
                                  padding: '12px 16px',
                                  cursor: 'pointer',
                                  transition: 'background 0.2s',
                                  background: 'rgba(37, 99, 235, 0.04)',
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(37, 99, 235, 0.08)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(37, 99, 235, 0.04)'}
                              >
                                <div style={{ fontWeight: 700, color: '#1d4ed8' }}>Customized</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Use "{formData.hospital.trim()}" as referral hospital</div>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <div style={{ marginBottom: 20 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(239,68,68,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>📋</span>
                    Reason for Referral
                  </label>
                  <div style={{ position: 'relative' }}>
                    <textarea
                      className="form-input"
                      rows="3"
                      value={formData.reason}
                      onChange={e => {
                        setFormData({ ...formData, reason: e.target.value });
                        setShowReasonDropdown(true);
                      }}
                      onFocus={() => setShowReasonDropdown(true)}
                      onBlur={() => setTimeout(() => setShowReasonDropdown(false), 200)}
                      placeholder="e.g. Persistent chest pain not responding to initial management..."
                      style={{ resize: 'vertical' }}
                    />
                    {showReasonDropdown && formData.reason && formData.reason.length > 0 && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: '#fff', border: '1px solid var(--border, #ddd)',
                        borderRadius: 8, marginTop: 4, zIndex: 10,
                        boxShadow: '0 4px 20px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto'
                      }}>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {reasonSuggestions.filter(r => r.toLowerCase().includes((formData.reason || '').toLowerCase())).map((reason, idx) => (
                            <li
                              key={idx}
                              onMouseDown={() => {
                                setFormData(prev => ({ ...prev, reason: reason }));
                                setShowReasonDropdown(false);
                              }}
                              style={{
                                padding: '10px 14px', borderBottom: '1px solid #f1f5f9',
                                cursor: 'pointer', transition: 'background 0.2s',
                                fontSize: '0.85rem'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              {reason}
                            </li>
                          ))}
                          {reasonSuggestions.filter(r => r.toLowerCase().includes((formData.reason || '').toLowerCase())).length === 0 && (
                            <li style={{ padding: '10px 14px', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                              Press Enter or save to use this new reason.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Clinical Notes */}
                <div style={{ marginBottom: 28 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: 'rgba(59,130,246,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem' }}>📝</span>
                    Clinical Notes <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.78rem' }}>(optional)</span>
                  </label>
                  <textarea
                    className="form-input"
                    rows="2"
                    value={formData.clinicalNotes}
                    onChange={e => setFormData({ ...formData, clinicalNotes: e.target.value })}
                    placeholder="Relevant history, examination findings, investigation results..."
                    style={{ resize: 'vertical' }}
                  />
                </div>

                {referralType === "Outside" && (
                  <div style={{
                    marginBottom: 28,
                    padding: "18px 20px",
                    border: "1px solid rgba(245,158,11,0.22)",
                    borderRadius: 12,
                    background: "rgba(245,158,11,0.04)",
                  }}>
                    <div style={{
                      fontSize: "0.78rem",
                      fontWeight: 800,
                      color: "#b45309",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 16,
                    }}>
                      Outside Referral Details
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      <div>
                        <label className="form-label">Treatment already from HMS Hospital</label>
                        <textarea
                          className="form-input"
                          rows="2"
                          value={formData.treatmentHospital}
                          onChange={e => setFormData({ ...formData, treatmentHospital: e.target.value })}
                          placeholder="Treatment, medicines, investigations already given at HMS Hospital..."
                          style={{ resize: "vertical" }}
                        />
                      </div>
                      <div>
                        <label className="form-label">Treatment already from Local Hospital</label>
                        <textarea
                          className="form-input"
                          rows="2"
                          value={formData.treatmentLocal}
                          onChange={e => setFormData({ ...formData, treatmentLocal: e.target.value })}
                          placeholder="Treatment already taken from local hospital or specialist..."
                          style={{ resize: "vertical" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label className="form-label">Period of Treatment</label>
                      <input
                        type="text"
                        className="form-input"
                        value={formData.treatmentPeriod}
                        onChange={e => setFormData({ ...formData, treatmentPeriod: e.target.value })}
                        placeholder="e.g. 10 May 2026 to 18 May 2026 / 2 weeks"
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      <div>
                        <label className="form-label">Escort allowed</label>
                        <div style={{ display: "flex", gap: 8 }}>
                          {["Yes", "No"].map(value => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setFormData({
                                ...formData,
                                escortAllowed: value,
                                escortCount: value === "Yes" ? formData.escortCount : "",
                              })}
                              className="btn btn-outline"
                              style={{
                                flex: 1,
                                borderColor: formData.escortAllowed === value ? "var(--green)" : "var(--border)",
                                background: formData.escortAllowed === value ? "rgba(16,185,129,0.1)" : "var(--surface)",
                                color: formData.escortAllowed === value ? "var(--green)" : "var(--text-secondary)",
                              }}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                      {formData.escortAllowed === "Yes" && (
                        <div>
                          <label className="form-label">Number of escort</label>
                          <input
                            type="number"
                            min="1"
                            className="form-input"
                            value={formData.escortCount}
                            onChange={e => setFormData({ ...formData, escortCount: e.target.value })}
                            placeholder="e.g. 1"
                          />
                        </div>
                      )}
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <label className="form-label">Ambulance allowed</label>
                      <div style={{ display: "flex", gap: 8 }}>
                        {["Yes", "No"].map(value => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setFormData({ ...formData, ambulanceAllowed: value })}
                            className="btn btn-outline"
                            style={{
                              flex: 1,
                              borderColor: formData.ambulanceAllowed === value ? "var(--green)" : "var(--border)",
                              background: formData.ambulanceAllowed === value ? "rgba(16,185,129,0.1)" : "var(--surface)",
                              color: formData.ambulanceAllowed === value ? "var(--green)" : "var(--text-secondary)",
                            }}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="form-label">Justification for allowing Ambulance / Escorts</label>
                      <textarea
                        className="form-input"
                        rows="2"
                        value={formData.ambulanceEscortJustification}
                        onChange={e => setFormData({ ...formData, ambulanceEscortJustification: e.target.value })}
                        placeholder="Medical justification for ambulance or escort permission..."
                        style={{ resize: "vertical" }}
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
              </form>
              </div>
              <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setFormData(buildEmptyReferralForm(referralType));
                    clearSelectedPatient();
                    setEditReferralId(null);
                    setActiveTab('hub');
                  }}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={submitting} style={{ minWidth: 160 }}
                  onClick={handleCreateReferral}
                >
                  {submitting ? (editReferralId ? '⏳ Updating...' : '⏳ Saving...') : (editReferralId ? '💾 Update Referral' : '💾 Save Referral')}
                </button>
              </div>
            </div>

            {/* Right Column: Patient History Side Panel */}
            {selectedPatient && (
              <div style={{ width: 340, flexShrink: 0, animation: 'hmsFadeIn 0.3s ease' }}>
                <div className="card" style={{ padding: '20px', position: 'sticky', top: 20 }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>🕒</span> Patient History
                  </h3>
                  
                  {loadingHistory ? (
                    <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-muted)' }}>
                      <div className="spinner" style={{ margin: '0 auto 10px' }} />
                      <div style={{ fontSize: '0.85rem' }}>Loading history...</div>
                    </div>
                  ) : patientHistory.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: 4 }}>
                      {patientHistory.map((h) => (
                        <div key={h.id} style={{
                          padding: '12px 14px',
                          background: 'var(--surface-1)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          position: 'relative',
                          borderLeft: `4px solid ${h.status === 'Completed' ? '#10b981' : h.status === 'Declined' ? '#ef4444' : h.status === 'Accepted' ? '#3b82f6' : '#f59e0b'}`,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
                          transition: 'transform 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'translateX(2px)'}
                        onMouseLeave={e => e.currentTarget.style.transform = 'translateX(0)'}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              {formatDate(h.date)}
                            </div>
                            <div style={{ transform: 'scale(0.85)', transformOrigin: 'right top' }}>
                              {statusBadge(h.status)}
                            </div>
                          </div>
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 4, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                            {h.to_specialty} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>at</span> {h.hospital}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
                            "{h.reason}"
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>👨‍⚕️</span> Dr. {h.doctor_name}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', background: 'var(--surface-1)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                      <span style={{ fontSize: '2rem', display: 'block', marginBottom: 12, opacity: 0.5 }}>📝</span>
                      <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>No previous referrals</div>
                      <div style={{ fontSize: '0.8rem', marginTop: 4 }}>This patient has a clean slate.</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════ Referral Preview Modal ═══════════════ */}
      {previewReferral && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgb(100, 116, 139)',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          overflowY: 'auto', padding: '40px 20px'
        }} onClick={() => setPreviewReferral(null)}>
          <div style={{ maxWidth: 820, width: '100%' }} onClick={e => e.stopPropagation()}>
            {/* Controls */}
            <div className="no-print" style={{
              display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 16
            }}>
              <button className="btn btn-secondary" onClick={() => setPreviewReferral(null)}>← Close</button>
              <button className="btn btn-primary" onClick={handleSavePreviewChanges} disabled={isPreviewSaving}>
                {isPreviewSaving ? '⏳ Saving...' : '💾 Save Changes'}
              </button>
              <button className="btn btn-accent" onClick={handlePrintReferral}>🖨️ Print Referral Memo</button>
            </div>

            {/* Printable Memo */}
            <div ref={printRef} style={{
              background: '#fff', padding: '40px 48px', borderRadius: 4,
              fontFamily: "'Times New Roman', Georgia, serif", color: '#000',
              boxShadow: '0 8px 40px rgba(0,0,0,0.15)', minHeight: 1000,
              fontSize: 13
            }}>
              {previewReferral.referral_type === 'Local' ? (
                <div className="memo-paper local-memo" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {/* ─── HEADER ─── */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '2px solid #000', paddingBottom: 10, marginBottom: 20 }}>
                    <img src="/logo.png" alt="HMS" style={{ width: 80, height: 80, objectFit: 'contain', marginRight: 20 }} />
                    <div style={{ textAlign: 'center' }}>
                      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>अस्पताल प्रबंधन प्रणाली (एचएमएस)</h2>
                      <h3 style={{ margin: '5px 0', fontSize: 18 }}>(चिकित्सा विभाग)</h3>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 'bold' }}>ज्ञापन</h3>
                    </div>
                  </div>

                  {/* ─── REF NO & DATE ─── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30, fontSize: 16 }}>
                    <div>संदर्भ सं. मेडी-(2)/एम/ <strong>{previewReferral.local_ref_no ? String(previewReferral.local_ref_no).padStart(3, '0') : (previewReferral.id || '____')}</strong></div>
                    <div>तिथि.................. <strong>{formatDate(previewReferral.date)}</strong></div>
                  </div>

                  {/* ─── BODY ─── */}
                  <div style={{ lineHeight: 2.2, fontSize: 16 }}>
                    {(() => {
                      const r = previewReferral;
                      const isCorporate = r.patient_type === 'corporate_employee';
                      const isDependent = isCorporate && r.relationship && r.relationship !== 'Self';
                      const empNameDisplay = isDependent ? (r.empName || '') : '';
                      return (
                        <>
                          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 15 }}>
                            <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>श्री/श्रीमति/कुमारी</span>
                            <EditableSpan value={r.patient} fieldKey="patient" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center', fontWeight: 'bold' }} />
                            <span style={{ margin: '0 10px', whiteSpace: 'nowrap' }}>पुत्र/पुत्री/पत्नी/माता/बहन/भाई/पति</span>
                            <EditableSpan value={empNameDisplay} fieldKey="empName" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center', fontWeight: 'bold' }} />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 15 }}>
                            <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>ई० नं०</span>
                            <EditableSpan value={isCorporate ? (r.emp_number || '') : ''} fieldKey="emp_number" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center', fontWeight: 'bold' }} />
                            <span style={{ margin: '0 10px', whiteSpace: 'nowrap' }}>विभाग</span>
                            <EditableSpan value={r.patient_department || ''} fieldKey="patient_department" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center' }} />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 15 }}>
                            <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>अस्पताल प्रबंधन प्रणाली के आउटडोर/इनडोर केस के रूप में</span>
                            <EditableSpan value={r.case_type || ''} fieldKey="case_type" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center' }} />
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 15 }}>
                            <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>विभाग</span>
                            <EditableSpan value={r.to_specialty} fieldKey="to_specialty" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center', fontWeight: 'bold' }} />
                            <span style={{ marginLeft: 10, whiteSpace: 'nowrap' }}>में दिखाने के लिए अनुमति प्रदान की जाती है। वह</span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: r.clinical_notes ? 16 : 40 }}>
                            <EditableSpan value={r.reason} fieldKey="reason" style={{ flex: 1, borderBottom: '1px dotted #000', padding: '0 10px', textAlign: 'center', fontWeight: 'bold' }} />
                            <span style={{ marginLeft: 10, whiteSpace: 'nowrap' }}>से पीड़ित हैं।</span>
                          </div>

                          {r.clinical_notes && (
                            <div style={{ marginBottom: 36, lineHeight: 1.5 }}>
                              <div style={{ fontWeight: 'bold', marginBottom: 6 }}>Clinical Notes / चिकित्सीय टिप्पणी:</div>
                              <div 
                                contentEditable
                                suppressContentEditableWarning
                                onBlur={e => updatePreviewDraftField('clinical_notes', e.currentTarget.innerText)}
                                style={{ minHeight: 54, border: '1px dotted #000', padding: '8px 10px', whiteSpace: 'pre-wrap', fontWeight: 500, outline: 'none', cursor: 'text', transition: 'background 0.2s' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.08)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                onFocus={e => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.15)'}
                              >
                                {r.clinical_notes}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  {/* ─── SIGNATURES & COPIES ─── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 60, fontSize: 16 }}>
                    <div>
                      <div style={{ marginBottom: 10 }}>सेवा में,</div>
                      <div>प्रतिलिपि सेवा में : कर्मचारी</div>
                      <div>प्रतिलिपि सेवा में : कार्मिक विभाग</div>
                    </div>
                    <div style={{ textAlign: 'center', marginTop: 50 }}>
                      <div style={{ borderTop: '1px solid #000', paddingTop: 5 }}>अधिकृत हस्ता. कर्ता</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="memo-paper outside-memo">
                  {/* ─── HEADER ─── */}
                <div className="outside-memo-header" style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 12, marginBottom: 14, position: 'relative' }}>
                  <img src="/logo.png" alt="HMS" style={{ position: 'absolute', left: 0, top: 0, width: 100, height: 100, objectFit: 'contain' }} />
                  <div style={{ fontSize: 16, fontWeight: 700 }}>अस्पताल प्रबंधन प्रणाली</div>
                  <h1 style={{ margin: '2px 0', fontSize: 20, letterSpacing: 1 }}>HOSPITAL MANAGEMENT SYSTEM</h1>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>चिकित्सा विभाग (Medical Department)</div>
                </div>

                {/* ─── REF NO & DATE ─── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <div>संदर्भ संख्या : मेडि - (2)/एम/ <strong>{previewReferral.id || '____'}</strong></div>
                  <div>Ref. No.: Medi-(2)/M/ <strong>{previewReferral.id || '____'}</strong></div>
                  <div>दिनांक / Dated: <strong>{formatDate(previewReferral.date)}</strong></div>
                </div>

                {/* Doctor who created */}
                <div style={{ textAlign: 'right', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                  Referred by: Dr. {previewReferral.doctor_name || user?.name || 'Doctor'}
                </div>

                {/* ─── EMPLOYEE INFO ─── */}
                {(() => {
                  const r = previewReferral;
                  const isCorporate = r.patient_type === 'corporate_employee';
                  const isDependent = isCorporate && r.relationship && r.relationship !== 'Self';
                  const empNameDisplay = isDependent ? (r.empName || '_______________') : (isCorporate ? r.patient : '_______________');
                  return (
                    <>
                      <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                        <span style={{ minWidth: 280, fontWeight: 600 }}>कर्मचारी संख्या / E. No.:</span>
                        <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}>{isCorporate ? (r.emp_number || '') : ''}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                        <span style={{ minWidth: 280, fontWeight: 600 }}>कर्मचारी का नाम / Name of the Employee:</span>
                        <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}>{empNameDisplay}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0', flex: 1 }}>
                          <span style={{ minWidth: 160, fontWeight: 600 }}>पदनाम / Designation:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}></span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0', flex: 1 }}>
                          <span style={{ minWidth: 140, fontWeight: 600 }}>विभाग / Department:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}></span>
                        </div>
                      </div>

                      {/* ─── PATIENT INFO ─── */}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0', flex: 2 }}>
                          <span style={{ minWidth: 160, fontWeight: 600 }}>रोगी का नाम / Name of Patient:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4, fontWeight: 600 }}>{r.patient || ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0', flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>आयु / Age:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}>{r.patient_age || ''}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0', flex: 1 }}>
                          <span style={{ fontWeight: 600 }}>सम्पर्क / Contact:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}>{r.phone_number || ''}</span>
                        </div>
                      </div>
                      {isDependent && (
                        <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                          <span style={{ minWidth: 280, fontWeight: 600 }}>संबंध / Relation:</span>
                          <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}>{r.relationship}</span>
                        </div>
                      )}
                    </>
                  );
                })()}

                {/* ─── DISEASE & TREATMENT ─── */}
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ minWidth: 280, fontWeight: 600 }}>बीमारी का नाम / Nature of Disease:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.reason || ""}</span>
                </div>
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ minWidth: 280, fontWeight: 600 }}>एच.एम.एस. अस्पताल से पहले लिए उपचार का विवरण:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.treatment_hospital || ""}</span>
                </div>
                <div style={{ fontSize: 12, color: "#000", marginTop: -2, marginBottom: 2 }}>Treatment already taken from HMS Hospital :</div>
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ minWidth: 280, fontWeight: 600 }}>स्थानीय अस्पताल से पहले लिए उपचार का विवरण:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.treatment_local || ""}</span>
                </div>
                <div style={{ fontSize: 12, color: "#000", marginTop: -2, marginBottom: 2 }}>Treatment already taken from Local Hospital :</div>
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ minWidth: 280, fontWeight: 600 }}>उपचार की अवधि / Period of Treatment:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.treatment_period || ""}</span>
                </div>

                {/* ─── RECOMMENDATION ─── */}
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                    <span style={{ minWidth: 280, fontWeight: 600 }}>बाहर संदर्भित करने की संस्तुति (Recommendation):</span>
                    <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4 }}></span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                    <span style={{ minWidth: 280, fontWeight: 600 }}>Recommendation for outside reference to:</span>
                    <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4, fontWeight: 600 }}>{previewReferral.hospital || ''}</span>
                    <span>अस्पताल / Hospital</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, padding: '5px 0' }}>
                    <span style={{ minWidth: 280, fontWeight: 600 }}>के लिए / for:</span>
                    <span style={{ flex: 1, borderBottom: '1px solid #000', paddingLeft: 4, fontWeight: 600 }}>{previewReferral.to_specialty || ''}</span>
                    <span>उपचार / Treatment</span>
                  </div>
                </div>

                {/* ─── ESCORT & AMBULANCE ─── */}
                <div style={{ display: "flex", gap: 16 }}>
                  <div style={{ display: "flex", gap: 6, padding: "5px 0", flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>सहयोगी के लिए अनुमति / Escort Allowed:</span>
                    <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.escort_allowed || "No"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  <div style={{ display: "flex", gap: 6, padding: "5px 0", flex: 1 }}>
                    <span style={{ fontWeight: 600 }}>सहयोगियों की संख्या / No. of Escorts:</span>
                    <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.escort_allowed === "Yes" ? (previewReferral.escort_count || "") : ""}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ fontWeight: 600 }}>एम्बुलेंस के लिए अनुमति / Ambulance Allowed:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.ambulance_allowed || "No"}</span>
                </div>
                <div style={{ display: "flex", gap: 6, padding: "5px 0" }}>
                  <span style={{ fontWeight: 600 }}>एम्बुलेंस/सहयोगी भेजने के लिए औचित्य:</span>
                  <span style={{ flex: 1, borderBottom: "1px solid #000", paddingLeft: 4 }}>{previewReferral.ambulance_escort_justification || ""}</span>
                </div>
                <div style={{ fontSize: 12, color: "#000", marginTop: -2 }}>Justification for allowing Ambulance/Escorts (s):</div>

                {/* ─── APPROVED ─── */}
                <div style={{ textAlign: 'right', marginTop: 24, fontWeight: 600, fontSize: 14 }}>
                  अनुमोदित<br />(Approved)
                </div>

                {/* ─── SIGNATURE ROW ─── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 50, textAlign: 'center' }}>
                  <div style={{ width: '30%' }}>
                    <div style={{ borderTop: '1px solid #000', paddingTop: 6, fontWeight: 600, fontSize: 12 }}>
                      <div style={{ fontSize: 11 }}>मुख्य चिकित्साधिकारी</div>
                      Sr. Chief Medical Officer
                    </div>
                  </div>
                  <div style={{ width: '30%' }}>
                    <div style={{ borderTop: '1px solid #000', paddingTop: 6, fontWeight: 600, fontSize: 12 }}>
                      <div style={{ fontSize: 11 }}>मुख्य प्रबंधक (मानव संसाधन)</div>
                      Chief Manager (HR)
                    </div>
                  </div>
                  <div style={{ width: '30%' }}>
                    <div style={{ borderTop: '1px solid #000', paddingTop: 6, fontWeight: 600, fontSize: 12 }}>
                      <div style={{ fontSize: 11 }}>कार्यकारी निदेशक (प्रभारी)</div>
                      Executive Director (I/C)
                    </div>
                  </div>
                </div>

                {/* ─── FOOTER ─── */}
                  <div style={{ marginTop: 30, borderTop: '1px solid #aaa', paddingTop: 10, fontSize: 12 }}>
                    <div>सेवा में :</div>
                    <div style={{ marginLeft: 20 }}>संबंधित अधिकारी</div>
                    <div>To</div>
                    <div style={{ marginLeft: 20 }}>Concerned Employee</div>
                    <div style={{ marginTop: 10, fontWeight: 600 }}>
                      यह संदर्भित ज्ञापन केवल दस दिनों के लिए वैध है।<br />
                      This Reference Memo is valid only for 10 days.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
