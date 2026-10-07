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
  const [hubFilter, setHubFilter] = useState('all'); // 'all' | 'inbound' | 'outbound_local' | 'outbound_outside'
  const [hubSearch, setHubSearch] = useState('');
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

  const outboundLocalList = referrals.outbound.filter(r => r.referral_type === 'Local');
  const outboundOutsideList = referrals.outbound.filter(r => r.referral_type !== 'Local');
  const totalCount = referrals.inbound.length + referrals.outbound.length;

  const getFilteredRegistryList = () => {
    let list = [];
    if (hubFilter === 'inbound') {
      list = referrals.inbound.map(r => ({ ...r, _category: 'INBOUND' }));
    } else if (hubFilter === 'outbound_local') {
      list = outboundLocalList.map(r => ({ ...r, _category: 'LOCAL' }));
    } else if (hubFilter === 'outbound_outside') {
      list = outboundOutsideList.map(r => ({ ...r, _category: 'OUTSIDE' }));
    } else {
      list = [
        ...referrals.inbound.map(r => ({ ...r, _category: 'INBOUND' })),
        ...outboundLocalList.map(r => ({ ...r, _category: 'LOCAL' })),
        ...outboundOutsideList.map(r => ({ ...r, _category: 'OUTSIDE' })),
      ];
    }

    if (!hubSearch.trim()) return list;
    const q = hubSearch.trim().toLowerCase();
    return list.filter(r => 
      (r.patient && String(r.patient).toLowerCase().includes(q)) ||
      (r.uhid && String(r.uhid).toLowerCase().includes(q)) ||
      (r.to_specialty && String(r.to_specialty).toLowerCase().includes(q)) ||
      (r.from_doctor && String(r.from_doctor).toLowerCase().includes(q)) ||
      (r.reason && String(r.reason).toLowerCase().includes(q)) ||
      (r.hospital && String(r.hospital).toLowerCase().includes(q))
    );
  };

  return (
    <>
      <Navbar />
      <div className="referral-hub-shell">
        {/* Header & Navigation */}
        <div className="referral-header-wrap">
          <div className="referral-title-group">
            <h1>
              <span className="referral-title-icon">🔄</span>
              Referrals Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', margin: '4px 0 0 56px' }}>
              Streamlined intra-hospital department transfers and specialist outward referrals.
            </p>
          </div>

          <div className="referral-nav-pill-container">
            <button
              type="button"
              className={`referral-nav-pill ${activeTab === 'hub' ? 'active' : ''}`}
              onClick={() => setActiveTab('hub')}
            >
              📋 Registry ({totalCount})
            </button>
            <button
              type="button"
              className={`referral-nav-pill ${activeTab === 'create' && referralType === 'Local' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('create');
                setReferralType('Local');
                setEditReferralId(null);
                setFormData(buildEmptyReferralForm('Local'));
                clearSelectedPatient();
              }}
            >
              {editReferralId && referralType === 'Local' ? '✏️ Edit Local Referral' : '🏥 + New Local Referral'}
            </button>
            <button
              type="button"
              className={`referral-nav-pill ${activeTab === 'create' && referralType === 'Outside' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('create');
                setReferralType('Outside');
                setEditReferralId(null);
                setFormData(buildEmptyReferralForm('Outside'));
                clearSelectedPatient();
              }}
            >
              {editReferralId && referralType === 'Outside' ? '✏️ Edit Outside Referral' : '🌐 + New Outside Referral'}
            </button>
          </div>
        </div>

        {/* Tab: Referral Registry */}
        {activeTab === 'hub' && (
          <div className="hms-anim-3">
            <div className="card" style={{ padding: '24px' }}>
              {/* Registry Toolbar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, marginBottom: 20 }}>
                <div className="referral-subnav-pills" style={{ margin: 0, padding: 0 }}>
                  <button
                    type="button"
                    className={`referral-subnav-btn ${hubFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setHubFilter('all')}
                  >
                    All Referrals ({totalCount})
                  </button>
                  <button
                    type="button"
                    className={`referral-subnav-btn ${hubFilter === 'inbound' ? 'active' : ''}`}
                    onClick={() => setHubFilter('inbound')}
                  >
                    📥 Inbound ({referrals.inbound.length})
                  </button>
                  <button
                    type="button"
                    className={`referral-subnav-btn ${hubFilter === 'outbound_local' ? 'active' : ''}`}
                    onClick={() => setHubFilter('outbound_local')}
                  >
                    🏥 Outbound Local ({outboundLocalList.length})
                  </button>
                  <button
                    type="button"
                    className={`referral-subnav-btn ${hubFilter === 'outbound_outside' ? 'active' : ''}`}
                    onClick={() => setHubFilter('outbound_outside')}
                  >
                    🌐 Outbound Outside ({outboundOutsideList.length})
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', width: 240 }}>
                    <input
                      type="search"
                      className="form-input"
                      placeholder="Search patient, UHID, specialty..."
                      value={hubSearch}
                      onChange={e => setHubSearch(e.target.value)}
                      style={{ height: 38, fontSize: '0.82rem', paddingLeft: 32 }}
                    />
                    <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.85rem' }}>🔍</span>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={fetchReferrals} title="Refresh referrals list">
                    ↻ Refresh
                  </button>
                </div>
              </div>

              {/* Table Content */}
              {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '60px 0', flexDirection: 'column', gap: 12 }}>
                  <div className="spinner" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading referral records...</span>
                </div>
              ) : getFilteredRegistryList().length === 0 ? (
                <div style={{
                  padding: '48px 24px', textAlign: 'center', borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px dashed var(--border)',
                  color: 'var(--text-secondary)'
                }}>
                  <span style={{ fontSize: '2.2rem', display: 'block', marginBottom: 12 }}>📭</span>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', marginBottom: 4 }}>No referrals found</div>
                  <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {hubSearch ? 'No referral matched your search criteria.' : 'No referrals currently match this filter category.'}
                  </p>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        setActiveTab('create');
                        setReferralType('Local');
                        setFormData(buildEmptyReferralForm('Local'));
                        clearSelectedPatient();
                      }}
                    >
                      🏥 New Local Referral
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setActiveTab('create');
                        setReferralType('Outside');
                        setFormData(buildEmptyReferralForm('Outside'));
                        clearSelectedPatient();
                      }}
                    >
                      🌐 New Outside Referral
                    </button>
                  </div>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th style={{ width: 110 }}>Date</th>
                        <th style={{ width: 110 }}>Category</th>
                        <th>Patient</th>
                        <th>Specialty / Consultant</th>
                        <th>Reason / Indication</th>
                        <th style={{ width: 110 }}>Status</th>
                        <th style={{ width: 190, textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getFilteredRegistryList().map((ref, idx) => (
                        <tr key={ref.id || idx}>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{idx + 1}</td>
                          <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{formatDate(ref.date)}</td>
                          <td>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 800,
                              background: ref._category === 'INBOUND' ? 'rgba(59,130,246,0.1)' : ref._category === 'LOCAL' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                              color: ref._category === 'INBOUND' ? '#2563eb' : ref._category === 'LOCAL' ? '#059669' : '#d97706',
                              border: `1px solid ${ref._category === 'INBOUND' ? 'rgba(59,130,246,0.2)' : ref._category === 'LOCAL' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                            }}>
                              {ref._category}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{ref.patient}</div>
                            {ref.uhid && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>UHID: {ref.uhid}</div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                              {ref._category === 'INBOUND' ? (ref.from_doctor || 'Unknown Doctor') : (ref.to_specialty || 'General')}
                            </div>
                            {ref.hospital && ref._category === 'OUTSIDE' && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>{ref.hospital}</div>
                            )}
                          </td>
                          <td style={{ maxWidth: 220 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.84rem' }}>
                              {ref.reason || '—'}
                            </div>
                          </td>
                          <td>{statusBadge(ref.status)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="btn btn-sm btn-outline" onClick={() => handlePreview(ref)} style={{ color: 'var(--blue)', borderColor: 'rgba(37,99,235,0.25)', padding: '4px 10px' }}>
                                Preview
                              </button>
                              {ref._category !== 'INBOUND' && (
                                <>
                                  <button className="btn btn-sm btn-outline" onClick={() => handleEditReferral(ref)} style={{ padding: '4px 10px' }}>
                                    Edit
                                  </button>
                                  <button className="btn btn-sm btn-outline" style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.25)', padding: '4px 10px' }} onClick={() => handleDeleteReferral(ref.id)}>
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Create Referral */}
        {activeTab === 'create' && (
          <div className="hms-anim-3 referral-workbench-grid">
            {/* Left: Main Form Card */}
            <div className="referral-form-card">
              <div className="referral-form-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="referral-title-icon" style={{
                    background: referralType === 'Local' ? 'rgba(59, 130, 246, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                    borderColor: referralType === 'Local' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(245, 158, 11, 0.25)'
                  }}>
                    {referralType === 'Local' ? '🏢' : '🏥'}
                  </div>
                  <div>
                    <h2 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {editReferralId
                        ? `Modify Referral Order #${editReferralId}`
                        : (referralType === 'Local' ? 'Internal Departmental Consultation' : 'External Facility Referral Order')}
                    </h2>
                    <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      {referralType === 'Local'
                        ? 'Direct clinical consultation order within Central Medical Center departments'
                        : 'Transfer patient to empaneled specialist hospital or tertiary medical center'}
                    </p>
                  </div>
                </div>
                <div>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background: referralType === 'Local' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                    color: referralType === 'Local' ? '#2563eb' : '#d97706',
                    border: `1px solid ${referralType === 'Local' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`
                  }}>
                    {referralType === 'Local' ? '● Intra-Hospital' : '● External Network'}
                  </span>
                </div>
              </div>

              <div className="referral-form-body">
                {/* 1. Patient Identification / Identity Card */}
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                      Patient Identification <span style={{ color: '#ef4444' }}>*</span>
                    </span>
                    {selectedPatient && (
                      <button
                        type="button"
                        onClick={clearSelectedPatient}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--blue, #3b82f6)',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        Change Patient
                      </button>
                    )}
                  </label>

                  {!selectedPatient ? (
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Search patient by name, UHID, or mobile phone..."
                        value={patientQuery}
                        onChange={(e) => {
                          setPatientQuery(e.target.value);
                          if (selectedPatient) clearSelectedPatient();
                        }}
                        onFocus={() => { if (patientResults.length) setShowPatientDropdown(true); }}
                        style={{ height: 44, paddingLeft: 40, fontSize: '0.9rem' }}
                      />
                      <span style={{
                        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--text-muted)', fontSize: '1rem', pointerEvents: 'none'
                      }}>🔍</span>

                      {searchingPatient && (
                        <div className="spinner" style={{
                          position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
                          width: 18, height: 18,
                        }} />
                      )}

                      {showPatientDropdown && patientResults.length > 0 && (
                        <div style={{
                          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60,
                          background: 'var(--surface, #fff)', border: '1.5px solid var(--border)',
                          borderRadius: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.12)', maxHeight: 240,
                          overflowY: 'auto'
                        }}>
                          {patientResults.map((p) => (
                            <div
                              key={p.id}
                              onMouseDown={() => handleSelectPatient(p)}
                              style={{
                                padding: '10px 16px',
                                cursor: 'pointer',
                                borderBottom: '1px solid var(--border-light, #f1f5f9)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                transition: 'background 0.15s'
                              }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{p.name}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                  UHID: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.uhid}</span> • {p.age || '—'}y • {p.gender || '—'}
                                </div>
                              </div>
                              {p.patientType === 'corporate_employee' ? (
                                <span style={{
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(5, 150, 105, 0.1)',
                                  color: '#059669',
                                  border: '1px solid rgba(5, 150, 105, 0.2)'
                                }}>
                                  Corporate #{p.empNumber || ''}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>General</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{
                      padding: '14px 18px',
                      borderRadius: 10,
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05), rgba(59, 130, 246, 0.05))',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '1.1rem',
                          flexShrink: 0,
                          boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)'
                        }}>
                          {selectedPatient.name ? selectedPatient.name.charAt(0).toUpperCase() : 'P'}
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                              {selectedPatient.name}
                            </span>
                            <span style={{
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              fontSize: '0.78rem',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: 'var(--surface-3)',
                              color: 'var(--text-secondary)'
                            }}>
                              {selectedPatient.uhid}
                            </span>
                            {selectedPatient.patientType === 'corporate_employee' && (
                              <span style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: 'rgba(16, 185, 129, 0.15)',
                                color: '#047857',
                                border: '1px solid rgba(16, 185, 129, 0.3)'
                              }}>
                                Corporate Member
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                            {selectedPatient.age} Years • {selectedPatient.gender} • Mobile: {selectedPatient.phone || selectedPatient.mobile || '—'}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={clearSelectedPatient}
                        className="btn btn-ghost"
                        style={{ height: 32, padding: '0 10px', fontSize: '0.78rem', gap: 4 }}
                        title="Remove patient selection"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  )}

                  {/* Corporate Dependent Details Banner */}
                  {selectedPatient?.patientType === 'corporate_employee' && (
                    <div style={{
                      marginTop: 10,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 12,
                      padding: '12px 16px',
                      background: 'rgba(16, 185, 129, 0.04)',
                      borderRadius: 8,
                      border: '1px solid rgba(16, 185, 129, 0.15)'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Employee ID
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '0.88rem', marginTop: 2, fontFamily: 'monospace' }}>
                          {formData.empNumber || selectedPatient.empNumber || '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Primary Employee
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: 2 }}>
                          {formData.empName || (formData.relationship === 'Self' ? selectedPatient.name : '—')}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Relationship
                        </div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', marginTop: 2 }}>
                          {formData.relationship || 'Self'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Destination / Clinical Specialty Routing */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'flex-start' }}>
                  {/* Specialty Selector */}
                  <div>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 8 }}>
                      Target Specialty <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <select
                      className="form-input"
                      style={{ height: 42, fontSize: '0.88rem' }}
                      value={SPECIALTY_OPTIONS.includes(formData.toSpecialty) ? formData.toSpecialty : (formData.toSpecialty ? 'Other' : '')}
                      onChange={e => setFormData({ ...formData, toSpecialty: e.target.value })}
                    >
                      <option value="">Select clinical department...</option>
                      {SPECIALTY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>

                    {(formData.toSpecialty === 'Other' || (formData.toSpecialty && !SPECIALTY_OPTIONS.includes(formData.toSpecialty))) && (
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Specify custom department or sub-specialty..."
                        value={formData.toSpecialty === 'Other' ? '' : formData.toSpecialty}
                        onChange={e => setFormData({ ...formData, toSpecialty: e.target.value || 'Other' })}
                        autoFocus
                        style={{ marginTop: 8, height: 40 }}
                      />
                    )}
                  </div>

                  {/* Priority Toggle Buttons */}
                  <div>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 700, marginBottom: 8 }}>
                      <span>Clinical Priority</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                        {formData.priority === 'Emergency' ? 'Immediate SLA' : formData.priority === 'Urgent' ? '4-6h SLA' : '24-48h SLA'}
                      </span>
                    </label>
                    <div className="referral-priority-group">
                      {PRIORITY_OPTIONS.map(p => {
                        const isActive = formData.priority === p;
                        const activeClass = isActive
                          ? (p === 'Emergency' ? 'active-emergency' : p === 'Urgent' ? 'active-urgent' : 'active-routine')
                          : '';
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setFormData({ ...formData, priority: p })}
                            className={`referral-priority-btn ${activeClass}`}
                          >
                            <span>{p === 'Emergency' ? '🔴' : p === 'Urgent' ? '🟡' : '🟢'}</span>
                            <span>{p}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 3. Destination Routing Card: Local (Intra-Hospital) vs Outside Facility */}
                {referralType === 'Local' ? (
                  <div style={{
                    padding: '14px 18px',
                    borderRadius: 10,
                    background: 'rgba(59, 130, 246, 0.05)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14
                  }}>
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: 8,
                      background: 'rgba(59, 130, 246, 0.12)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.2rem',
                      flexShrink: 0
                    }}>
                      🏢
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        Intra-Hospital Consultation Destination: <span style={{ color: '#2563eb' }}>HMS Central Hospital</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                        Consultation request will immediately route to duty doctors in {formData.toSpecialty || 'the selected department'}. Patient history and vitals sync automatically.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 8 }}>
                      External Referral Center / Hospital <span style={{ color: '#ef4444' }}>*</span>
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
                        placeholder="Search empaneled hospitals (e.g. AIIMS Delhi, PGI Chandigarh, DMC Ludhiana)..."
                        required
                        style={{ height: 42, paddingLeft: 40, fontSize: '0.88rem' }}
                        autoComplete="off"
                      />
                      <span style={{
                        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                        color: 'var(--text-muted)', fontSize: '0.95rem', pointerEvents: 'none'
                      }}>🏥</span>

                      {/* Hospital Autocomplete Dropdown */}
                      {showHospitalDropdown && (hospitalResults.length > 0 || searchingHospital || formData.hospital.trim().length >= 2) && (
                        <div style={{
                          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                          background: 'var(--surface, #fff)', border: '1.5px solid var(--border)',
                          borderRadius: 10, zIndex: 60, boxShadow: '0 12px 30px rgba(0,0,0,0.12)',
                          maxHeight: 250, overflowY: 'auto'
                        }}>
                          {searchingHospital ? (
                            <div style={{ padding: 14, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                              Searching network hospitals...
                            </div>
                          ) : (
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
                                      padding: '10px 16px', borderBottom: '1px solid var(--border-light, #f1f5f9)',
                                      cursor: 'pointer', transition: 'background 0.15s'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  >
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{hospitalLabel}</div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                      {isCustomized ? 'Type custom hospital name in field' : (hosp.place || 'Empaneled Facility')}
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
                                    padding: '10px 16px',
                                    cursor: 'pointer',
                                    background: 'rgba(37, 99, 235, 0.05)',
                                    borderTop: '1px solid rgba(37, 99, 235, 0.15)'
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(37, 99, 235, 0.1)'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(37, 99, 235, 0.05)'}
                                >
                                  <div style={{ fontWeight: 700, color: '#1d4ed8', fontSize: '0.88rem' }}>Use Custom Facility</div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Use "{formData.hospital.trim()}" as outside hospital</div>
                                </li>
                              )}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. Reason for Referral with Presets */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <label className="form-label" style={{ fontWeight: 700, margin: 0 }}>
                      Indication / Reason for Referral <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Click chip for quick reason</span>
                  </div>

                  {/* Preset Reason Chips */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {[
                      'Diagnostic Workup & Advanced Imaging',
                      'Super-Specialty Consultation',
                      'Emergency Surgical Intervention',
                      'ICU / High Dependency Transfer',
                      'Specialized Chemotherapy / Oncology',
                      'Coronary Angiography / Cath Lab',
                      'Pediatric Intensive Care',
                      'Neurosurgical Evaluation'
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setFormData(prev => ({
                            ...prev,
                            reason: prev.reason ? `${prev.reason}; ${preset}` : preset
                          }));
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          fontSize: '0.76rem',
                          fontWeight: 600,
                          background: 'var(--surface-2)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'var(--surface-3)';
                          e.currentTarget.style.borderColor = 'var(--green-border)';
                          e.currentTarget.style.color = 'var(--text-primary)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'var(--surface-2)';
                          e.currentTarget.style.borderColor = 'var(--border)';
                          e.currentTarget.style.color = 'var(--text-secondary)';
                        }}
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>

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
                      placeholder="Specify primary diagnostic indication, clinical suspicion, or purpose of transfer..."
                      style={{ resize: 'vertical', fontSize: '0.88rem' }}
                      required
                    />

                    {showReasonDropdown && formData.reason && formData.reason.length > 0 && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                        background: 'var(--surface, #fff)', border: '1.5px solid var(--border)',
                        borderRadius: 10, zIndex: 60, boxShadow: '0 12px 30px rgba(0,0,0,0.12)',
                        maxHeight: 180, overflowY: 'auto'
                      }}>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {reasonSuggestions.filter(r => r.toLowerCase().includes((formData.reason || '').toLowerCase())).map((reason, idx) => (
                            <li
                              key={idx}
                              onMouseDown={() => {
                                setFormData(prev => ({ ...prev, reason }));
                                setShowReasonDropdown(false);
                              }}
                              style={{
                                padding: '9px 14px', borderBottom: '1px solid var(--border-light, #f1f5f9)',
                                cursor: 'pointer', transition: 'background 0.15s', fontSize: '0.84rem'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.08)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* 5. Clinical Summary / Case Notes */}
                <div>
                  <label className="form-label" style={{ fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Clinical Summary & Relevant Findings</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--text-muted)' }}>Vitals, labs, provisional diagnosis</span>
                  </label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.clinicalNotes}
                    onChange={e => setFormData({ ...formData, clinicalNotes: e.target.value })}
                    placeholder="Brief history of illness, current medications administered, diagnostic test results, and provisional diagnosis..."
                    style={{ resize: 'vertical', fontSize: '0.88rem' }}
                  />
                </div>

                {/* 6. Outside Referral Extended Authorizations (Only for Outside) */}
                {referralType === 'Outside' && (
                  <div style={{
                    padding: '20px',
                    borderRadius: 12,
                    background: 'rgba(245, 158, 11, 0.04)',
                    border: '1px solid rgba(245, 158, 11, 0.22)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: '1.1rem' }}>📋</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#b45309' }}>
                          Outside Referral Authorizations & Transport Logistics
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Required for official billing clearance and emergency transport dispatch
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Treatment Given at HMS Hospital</label>
                        <textarea
                          className="form-input"
                          rows="2"
                          value={formData.treatmentHospital}
                          onChange={e => setFormData({ ...formData, treatmentHospital: e.target.value })}
                          placeholder="Therapies, injections, oxygen, or monitoring performed here..."
                          style={{ resize: 'vertical', fontSize: '0.84rem' }}
                        />
                      </div>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Prior Outside Treatments</label>
                        <textarea
                          className="form-input"
                          rows="2"
                          value={formData.treatmentLocal}
                          onChange={e => setFormData({ ...formData, treatmentLocal: e.target.value })}
                          placeholder="Treatments already received from outside specialists..."
                          style={{ resize: 'vertical', fontSize: '0.84rem' }}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Estimated Period of Treatment</label>
                      <input
                        type="text"
                        className="form-input"
                        value={formData.treatmentPeriod}
                        onChange={e => setFormData({ ...formData, treatmentPeriod: e.target.value })}
                        placeholder="e.g. 1-2 weeks in-patient / Outpatient review in 3 days"
                        style={{ height: 38, fontSize: '0.86rem' }}
                      />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                      <div>
                        <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Medical Escort Authorized?</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {['Yes', 'No'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setFormData({
                                ...formData,
                                escortAllowed: val,
                                escortCount: val === 'Yes' ? (formData.escortCount || '1') : ''
                              })}
                              style={{
                                flex: 1,
                                height: 38,
                                borderRadius: 8,
                                border: '1.5px solid',
                                borderColor: formData.escortAllowed === val ? '#10b981' : 'var(--border)',
                                background: formData.escortAllowed === val ? 'rgba(16, 185, 129, 0.12)' : 'var(--surface)',
                                color: formData.escortAllowed === val ? '#059669' : 'var(--text-secondary)',
                                fontWeight: 700,
                                fontSize: '0.84rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {val === 'Yes' ? '✓ Yes' : '✕ No'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {formData.escortAllowed === 'Yes' && (
                        <div>
                          <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Number of Escorts</label>
                          <input
                            type="number"
                            min="1"
                            max="4"
                            className="form-input"
                            value={formData.escortCount}
                            onChange={e => setFormData({ ...formData, escortCount: e.target.value })}
                            placeholder="e.g. 1"
                            style={{ height: 38 }}
                          />
                        </div>
                      )}

                      <div>
                        <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>Hospital Ambulance Authorized?</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {['Yes', 'No'].map(val => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => setFormData({ ...formData, ambulanceAllowed: val })}
                              style={{
                                flex: 1,
                                height: 38,
                                borderRadius: 8,
                                border: '1.5px solid',
                                borderColor: formData.ambulanceAllowed === val ? '#10b981' : 'var(--border)',
                                background: formData.ambulanceAllowed === val ? 'rgba(16, 185, 129, 0.12)' : 'var(--surface)',
                                color: formData.ambulanceAllowed === val ? '#059669' : 'var(--text-secondary)',
                                fontWeight: 700,
                                fontSize: '0.84rem',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              {val === 'Yes' ? '🚑 Yes' : '✕ No'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {(formData.ambulanceAllowed === 'Yes' || formData.escortAllowed === 'Yes') && (
                      <div>
                        <label className="form-label" style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                          Justification for Ambulance / Escort Authorization <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <textarea
                          className="form-input"
                          rows="2"
                          value={formData.ambulanceEscortJustification}
                          onChange={e => setFormData({ ...formData, ambulanceEscortJustification: e.target.value })}
                          placeholder="Clinical reason (e.g., patient hemodynamically unstable, requiring continuous oxygen/cardiac monitoring in transit)..."
                          style={{ resize: 'vertical', fontSize: '0.84rem' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Form Footer */}
              <div className="referral-form-footer">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setFormData(buildEmptyReferralForm(referralType));
                    clearSelectedPatient();
                    setEditReferralId(null);
                    setActiveTab('hub');
                  }}
                  style={{ height: 42, padding: '0 20px', fontSize: '0.88rem' }}
                >
                  Discard & Back to Registry
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting}
                  onClick={handleCreateReferral}
                  style={{ minWidth: 200, height: 42, fontSize: '0.9rem', fontWeight: 700, gap: 8 }}
                >
                  {submitting ? (
                    <>
                      <div className="spinner" style={{ width: 16, height: 16 }} />
                      <span>{editReferralId ? 'Updating...' : 'Submitting...'}</span>
                    </>
                  ) : (
                    <>
                      <span>{editReferralId ? '💾' : '🚀'}</span>
                      <span>{editReferralId ? 'Update Referral Order' : (referralType === 'Local' ? 'Dispatch Internal Referral' : 'Authorize Outside Referral')}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Right: Contextual Clinical Sidebar */}
            <div style={{ position: 'sticky', top: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
              {selectedPatient ? (
                /* Patient History Panel */
                <div className="card" style={{ padding: '20px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>🕒</span> Patient Referral History
                    </h3>
                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                      {patientHistory.length} total
                    </span>
                  </div>

                  {loadingHistory ? (
                    <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                      <div className="spinner" style={{ margin: '0 auto 10px', width: 22, height: 22 }} />
                      <div style={{ fontSize: '0.84rem' }}>Loading patient dossier...</div>
                    </div>
                  ) : patientHistory.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', paddingRight: 4 }}>
                      {patientHistory.map((h) => (
                        <div
                          key={h.id}
                          style={{
                            padding: '12px 14px',
                            background: 'var(--surface-1)',
                            border: '1px solid var(--border)',
                            borderRadius: 8,
                            borderLeft: `4px solid ${h.status === 'Completed' ? '#10b981' : h.status === 'Declined' ? '#ef4444' : h.status === 'Accepted' ? '#3b82f6' : '#f59e0b'}`,
                            transition: 'transform 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                              {formatDate(h.date)}
                            </div>
                            <div style={{ transform: 'scale(0.85)', transformOrigin: 'right center' }}>
                              {statusBadge(h.status)}
                            </div>
                          </div>
                          <div style={{ fontWeight: 700, fontSize: '0.86rem', color: 'var(--text-primary)', marginBottom: 4 }}>
                            {h.to_specialty} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>→</span> {h.hospital}
                          </div>
                          {h.reason && (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 6 }}>
                              "{h.reason}"
                            </div>
                          )}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span>👨‍⚕️</span> Dr. {h.doctor_name || 'Staff Physician'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)', background: 'var(--surface-1)', borderRadius: 8, border: '1px dashed var(--border)' }}>
                      <span style={{ fontSize: '1.8rem', display: 'block', marginBottom: 8, opacity: 0.6 }}>📋</span>
                      <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>No Prior Referrals</div>
                      <div style={{ fontSize: '0.78rem', marginTop: 4 }}>This patient has no recorded prior departmental or external referrals.</div>
                    </div>
                  )}
                </div>
              ) : (
                /* Protocol & SLA Matrix when no patient selected */
                <div className="card" style={{ padding: '20px', border: '1px solid var(--border)' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '0.96rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>⚡</span> Clinical Referral Protocol
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'rgba(16, 185, 129, 0.06)',
                      border: '1px solid rgba(16, 185, 129, 0.2)'
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#047857', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🟢 Routine Priority (SLA: 24–48h)</span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                        Standard inter-departmental consultation. Patient will be seen during scheduled specialty OPD clinic hours.
                      </div>
                    </div>

                    <div style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'rgba(245, 158, 11, 0.06)',
                      border: '1px solid rgba(245, 158, 11, 0.2)'
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#b45309', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🟡 Urgent Priority (SLA: 4–6h)</span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                        Prompt evaluation required for deteriorating symptoms or diagnostic clarification prior to procedure.
                      </div>
                    </div>

                    <div style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.06)',
                      border: '1px solid rgba(239, 68, 68, 0.2)'
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🔴 Emergency / STAT (Immediate)</span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                        Critical care triage. Direct phone handover to receiving specialist and rapid transit activation required.
                      </div>
                    </div>

                    <div style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      background: 'var(--surface-1)',
                      border: '1px solid var(--border)'
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>🛡️ Outside Referral Memo Policy</span>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
                        Official printable referral memos generate bilingual (English & Hindi) headers with corporate employee authorization seals.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
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
