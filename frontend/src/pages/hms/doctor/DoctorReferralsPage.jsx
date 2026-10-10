import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ChevronDown, CircleCheck, Eye, FilePlus2, History, Inbox, ListChecks, Pencil, Plus, Printer,
  RefreshCw, Save, Search, Send, Stethoscope, Trash2, X,
} from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import Modal from '../../../components/ui/Modal';

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
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);
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

  // Opens the confirmation dialog; the delete itself runs in confirmDeleteReferral.
  const handleDeleteReferral = (id) => {
    setPendingDeleteId(id);
  };

  const confirmDeleteReferral = async () => {
    const id = pendingDeleteId;
    if (id == null) return;
    setDeleting(true);
    try {
      await api.delete(`/doctor/referrals/${id}`);
      toast.success('Referral deleted successfully');
      setPendingDeleteId(null);
      fetchReferrals();
    } catch {
      toast.error('Failed to delete referral');
    } finally {
      setDeleting(false);
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

  const STATUS_TONE = { Pending: 'warning', Accepted: 'success', Completed: 'info', Declined: 'danger' };
  const statusBadge = (status) => (
    <span className={`status status-${STATUS_TONE[status] || 'warning'}`}>{status || 'Pending'}</span>
  );

  const HISTORY_ACCENT = { Completed: 'var(--success)', Declined: 'var(--red)', Accepted: 'var(--primary)' };

  const dropdownStyle = {
    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 4,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    boxShadow: 'var(--shadow-md)', overflowY: 'auto',
  };
  const dropdownItemStyle = { padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: '0.86rem' };
  const hoverOn = (e) => { e.currentTarget.style.background = 'var(--surface-2)'; };
  const hoverOff = (e) => { e.currentTarget.style.background = 'transparent'; };

  const outsideReferrals = referrals.outbound.filter(r => r.referral_type !== 'Local');
  const localReferrals = referrals.outbound.filter(r => r.referral_type === 'Local');
  const pendingDeleteRef = pendingDeleteId != null ? referrals.outbound.find(r => r.id === pendingDeleteId) : null;

  const collapsibleHead = (open, toggle, title, subtitle, count, controlsId, extra) => (
    <div className="panel-head" style={{ padding: 0, borderBottom: open ? '1px solid var(--border)' : 0 }}>
      <h2 style={{ flex: 1, margin: 0, fontSize: 'inherit' }}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={controlsId}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
            padding: '14px 16px', background: 'none', border: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span className="panel-title" style={{ margin: 0 }}>{title}</span>
            <span className="muted">{subtitle}</span>
            <span className="count-pill">{count}</span>
          </span>
          <ChevronDown size={18} aria-hidden="true" style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
      </h2>
      {extra}
    </div>
  );

  const outboundTable = (list, isLocal) => (
    <div style={{ overflowX: 'auto' }}>
      <table className="mini-table">
        <thead>
          <tr><th>Date</th><th>Patient</th><th>Specialty</th><th>Reason</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {list.map((ref, idx) => (
            <tr key={idx}>
              <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{formatDate(ref.date)}</td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {ref.referral_type && <span className="tag">{isLocal ? 'Local' : 'Outside'}</span>}
                  <span className="cell-primary">{ref.patient}</span>
                </span>
              </td>
              <td>{ref.to_specialty}</td>
              <td style={{ maxWidth: isLocal ? 260 : 200 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ref.reason || '-'}</div>
                {isLocal && ref.clinical_notes && (
                  <div
                    className="cell-secondary"
                    style={{ marginTop: 4, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    title={ref.clinical_notes}
                  >
                    <strong>Clinical:</strong> {ref.clinical_notes}
                  </div>
                )}
              </td>
              <td>{statusBadge(ref.status)}</td>
              <td className="text-right">
                <span className="inline-actions" style={{ flexWrap: 'nowrap' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handlePreview(ref)}>
                    <Eye size={14} aria-hidden="true" /> Preview
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleEditReferral(ref)}>
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  <button type="button" className="icon-btn" onClick={() => handleDeleteReferral(ref.id)} aria-label={`Delete referral for ${ref.patient}`} title="Delete">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Navbar />
      <main className="app-page" style={{ maxWidth: 1240 }}>
        <PageHeader
          title="Referrals"
          description="Refer patients to specialists outside or within the hospital, and review referrals sent to you."
          actions={activeTab === 'hub' && (
            <button type="button" className="btn btn-ghost btn-md" onClick={() => fetchReferrals()}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        {/* Tabs */}
        <div className="tabs" role="tablist" aria-label="Referral views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'hub'}
            className={`tab${activeTab === 'hub' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('hub')}
          >
            <ListChecks size={16} aria-hidden="true" /> Referral list
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create' && referralType === 'Outside'}
            className={`tab${activeTab === 'create' && referralType === 'Outside' ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab('create');
              setReferralType('Outside');
              setEditReferralId(null);
              setFormData(buildEmptyReferralForm('Outside'));
              clearSelectedPatient();
            }}
          >
            {editReferralId && referralType === 'Outside'
              ? <><Pencil size={16} aria-hidden="true" /> Edit outside referral</>
              : <><Plus size={16} aria-hidden="true" /> Create outside referral</>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'create' && referralType === 'Local'}
            className={`tab${activeTab === 'create' && referralType === 'Local' ? ' is-active' : ''}`}
            onClick={() => {
              setActiveTab('create');
              setReferralType('Local');
              setEditReferralId(null);
              setFormData(buildEmptyReferralForm('Local'));
              clearSelectedPatient();
            }}
          >
            {editReferralId && referralType === 'Local'
              ? <><Pencil size={16} aria-hidden="true" /> Edit local referral</>
              : <><Plus size={16} aria-hidden="true" /> Create local referral</>}
          </button>
        </div>

        {/* Tab: Referral list */}
        {activeTab === 'hub' && (
          <div className="stack">
            {/* Inbound */}
            <section className="panel">
              {collapsibleHead(
                inboundOpen,
                () => setInboundOpen(!inboundOpen),
                <><Inbox size={16} aria-hidden="true" /> Inbound referrals</>,
                'To you',
                referrals.inbound.length,
                'ref-inbound',
              )}
              {inboundOpen && (
                <div id="ref-inbound" className="panel-pad">
                  {loading ? (
                    <p className="muted">Loading…</p>
                  ) : referrals.inbound.length === 0 ? (
                    <p className="muted">No inbound referrals at this time.</p>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table className="mini-table">
                        <thead>
                          <tr><th>Date</th><th>Patient</th><th>From doctor</th><th>Reason</th><th><span className="sr-only">Actions</span></th></tr>
                        </thead>
                        <tbody>
                          {referrals.inbound.map((ref, idx) => (
                            <tr key={idx}>
                              <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{formatDate(ref.date)}</td>
                              <td className="cell-primary">{ref.patient}</td>
                              <td>{ref.from_doctor}</td>
                              <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {ref.reason || '-'}
                              </td>
                              <td className="text-right"><button type="button" className="btn btn-secondary btn-sm">Review</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Outbound - Outside */}
            <section className="panel">
              {collapsibleHead(
                outboundOpen,
                () => setOutboundOpen(!outboundOpen),
                <><Send size={16} aria-hidden="true" /> Outbound referrals, outside</>,
                'By you',
                outsideReferrals.length,
                'ref-outside',
              )}
              {outboundOpen && (
                <div id="ref-outside" className="panel-pad">
                  {loading ? (
                    <p className="muted">Loading…</p>
                  ) : outsideReferrals.length === 0 ? (
                    <p className="muted">No outside outbound referrals yet.</p>
                  ) : outboundTable(outsideReferrals, false)}
                </div>
              )}
            </section>

            {/* Outbound - Local */}
            <section className="panel">
              {collapsibleHead(
                outboundLocalOpen,
                () => setOutboundLocalOpen(!outboundLocalOpen),
                <><Send size={16} aria-hidden="true" /> Outbound referrals, local</>,
                'By you',
                localReferrals.length,
                'ref-local',
              )}
              {outboundLocalOpen && (
                <div id="ref-local" className="panel-pad">
                  {loading ? (
                    <p className="muted">Loading…</p>
                  ) : localReferrals.length === 0 ? (
                    <p className="muted">No local outbound referrals yet.</p>
                  ) : outboundTable(localReferrals, true)}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Tab: Create referral */}
        {activeTab === 'create' && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 16, maxWidth: selectedPatient ? 1140 : 760, margin: '0 auto',
            alignItems: 'flex-start',
          }}>
            <section className="panel" style={{ flex: '2 1 480px', minWidth: 0 }}>
              <div className="panel-head">
                <div>
                  <h2 className="panel-title" style={{ margin: 0 }}>
                    {editReferralId ? <Pencil size={16} aria-hidden="true" /> : <FilePlus2 size={16} aria-hidden="true" />}
                    {editReferralId ? `Edit ${referralType.toLowerCase()} referral` : `New ${referralType.toLowerCase()} referral`}
                  </h2>
                  <p className="muted" style={{ margin: '2px 0 0' }}>
                    {editReferralId ? `Update the details for this ${referralType.toLowerCase()} referral.` : `Fill in the details to refer a patient to ${referralType === 'Local' ? 'another department' : 'an outside specialist'}.`}
                  </p>
                </div>
              </div>
              <div className="panel-pad">

              <form id="referral-form" onSubmit={handleCreateReferral} className="stack">
                {/* Patient search */}
                <div className="form-group">
                  <label className="form-label" htmlFor="ref-patient">
                    Patient <span style={{ color: 'var(--red)' }} aria-hidden="true">*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="ref-patient"
                      type="text"
                      className="form-input"
                      placeholder="Search by name, UHID or phone"
                      value={patientQuery}
                      onChange={(e) => {
                        setPatientQuery(e.target.value);
                        if (selectedPatient) clearSelectedPatient();
                      }}
                      onFocus={() => { if (patientResults.length) setShowPatientDropdown(true); }}
                      style={{ paddingRight: selectedPatient || searchingPatient ? 96 : 12 }}
                      autoComplete="off"
                    />
                    {searchingPatient && (
                      <span className="muted" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                        Searching…
                      </span>
                    )}
                    {selectedPatient && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={clearSelectedPatient}
                        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                        aria-label="Clear patient"
                        title="Clear patient"
                      ><X size={16} aria-hidden="true" /></button>
                    )}

                    {showPatientDropdown && patientResults.length > 0 && !selectedPatient && (
                      <div style={{ ...dropdownStyle, zIndex: 50, maxHeight: 220 }}>
                        {patientResults.map((p) => (
                          <div
                            key={p.id}
                            onMouseDown={() => handleSelectPatient(p)}
                            style={dropdownItemStyle}
                            onMouseEnter={hoverOn}
                            onMouseLeave={hoverOff}
                          >
                            <div className="cell-primary">{p.name}</div>
                            <div className="cell-secondary" style={{ marginTop: 2 }}>
                              <span className="mono">{p.uhid}</span> · {p.age}y · {p.gender}
                              {p.empNumber && <span> · Emp {p.empNumber}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected patient */}
                  {selectedPatient && (
                    <div style={{
                      marginTop: 8, padding: '10px 14px', borderRadius: 8,
                      background: 'var(--success-light)', border: '1px solid var(--border)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                    }}>
                      <div className="cell-stack">
                        <span className="cell-primary">{selectedPatient.name}</span>
                        <span className="cell-secondary">
                          <span className="mono">{selectedPatient.uhid}</span> · {selectedPatient.age}y / {selectedPatient.gender}
                          {selectedPatient.patientType === 'corporate_employee' && (
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}> · Corporate</span>
                          )}
                        </span>
                      </div>
                      <CircleCheck size={18} aria-label="Patient selected" style={{ color: 'var(--success)', flexShrink: 0 }} />
                    </div>
                  )}
                </div>

                {/* Dependent info (auto-filled) */}
                {selectedPatient?.patientType === 'corporate_employee' && (
                  <div className="facts" style={{ padding: '14px 16px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div>
                      <div className="fact-label">Employee number</div>
                      <div className="fact-value">{formData.empNumber || '—'}</div>
                    </div>
                    <div>
                      <div className="fact-label">Employee name</div>
                      <div className="fact-value">{formData.empName || (formData.relationship === 'Self' ? selectedPatient.name : '—')}</div>
                    </div>
                    <div>
                      <div className="fact-label">Relation</div>
                      <div className="fact-value">{formData.relationship || '—'}</div>
                    </div>
                  </div>
                )}

                {/* Specialty and priority */}
                <div className="form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="ref-specialty">Target specialty</label>
                    <select
                      id="ref-specialty"
                      className="form-select"
                      value={SPECIALTY_OPTIONS.includes(formData.toSpecialty) ? formData.toSpecialty : (formData.toSpecialty ? 'Other' : '')}
                      onChange={e => setFormData({ ...formData, toSpecialty: e.target.value })}
                    >
                      <option value="">Select specialty</option>
                      {SPECIALTY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {(formData.toSpecialty === 'Other' || (formData.toSpecialty && !SPECIALTY_OPTIONS.includes(formData.toSpecialty))) && (
                      <input
                        type="text"
                        className="form-input"
                        aria-label="Specify specialty"
                        placeholder="Specify the specialty"
                        value={formData.toSpecialty === 'Other' ? '' : formData.toSpecialty}
                        onChange={e => setFormData({ ...formData, toSpecialty: e.target.value || 'Other' })}
                        autoFocus
                        style={{ marginTop: 8 }}
                      />
                    )}
                  </div>
                  <div className="form-group">
                    <span className="form-label" id="ref-priority-label">Priority</span>
                    <div className="segmented" role="radiogroup" aria-labelledby="ref-priority-label">
                      {PRIORITY_OPTIONS.map(p => (
                        <button
                          key={p}
                          type="button"
                          role="radio"
                          aria-checked={formData.priority === p}
                          className={formData.priority === p ? 'is-active' : ''}
                          onClick={() => setFormData({ ...formData, priority: p })}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Hospital */}
                <div className="form-group">
                  <label className="form-label" htmlFor="ref-hospital">
                    Referral hospital <span style={{ color: 'var(--red)' }} aria-hidden="true">*</span>
                  </label>
                  <div style={{ position: 'relative' }}>
                    <input
                      id="ref-hospital"
                      type="text"
                      className="form-input"
                      value={formData.hospital}
                      onChange={handleHospitalChange}
                      onFocus={() => {
                        if (formData.hospital && formData.hospital.length >= 2) setShowHospitalDropdown(true);
                      }}
                      onBlur={() => setTimeout(() => setShowHospitalDropdown(false), 200)}
                      placeholder="e.g. PGI Chandigarh, AIIMS Delhi, DMC Ludhiana"
                      required
                      style={{ paddingLeft: 36 }}
                      autoComplete="off"
                    />
                    <Search
                      size={16}
                      aria-hidden="true"
                      style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
                    />
                    {/* Hospital dropdown */}
                    {showHospitalDropdown && (hospitalResults.length > 0 || searchingHospital || formData.hospital.trim().length >= 2) && (
                      <div style={{ ...dropdownStyle, overflow: 'hidden' }}>
                        {searchingHospital ? (
                          <div className="muted" style={{ padding: 16, textAlign: 'center' }}>Searching…</div>
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
                                  style={dropdownItemStyle}
                                  onMouseEnter={hoverOn}
                                  onMouseLeave={hoverOff}
                                >
                                  <div className="cell-primary">{hospitalLabel}</div>
                                  <div className="cell-secondary">
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
                                style={{ ...dropdownItemStyle, borderBottom: 0, background: 'var(--primary-light)' }}
                              >
                                <div style={{ fontWeight: 650, color: 'var(--primary)' }}>Customized</div>
                                <div className="cell-secondary">Use &quot;{formData.hospital.trim()}&quot; as the referral hospital</div>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Reason */}
                <div className="form-group">
                  <label className="form-label" htmlFor="ref-reason">Reason for referral</label>
                  <div style={{ position: 'relative' }}>
                    <textarea
                      id="ref-reason"
                      className="form-textarea"
                      rows="3"
                      value={formData.reason}
                      onChange={e => {
                        setFormData({ ...formData, reason: e.target.value });
                        setShowReasonDropdown(true);
                      }}
                      onFocus={() => setShowReasonDropdown(true)}
                      onBlur={() => setTimeout(() => setShowReasonDropdown(false), 200)}
                      placeholder="e.g. Persistent chest pain not responding to initial management"
                    />
                    {showReasonDropdown && formData.reason && formData.reason.length > 0 && (
                      <div style={{ ...dropdownStyle, maxHeight: 200 }}>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {reasonSuggestions.filter(r => r.toLowerCase().includes((formData.reason || '').toLowerCase())).map((reason, idx) => (
                            <li
                              key={idx}
                              onMouseDown={() => {
                                setFormData(prev => ({ ...prev, reason: reason }));
                                setShowReasonDropdown(false);
                              }}
                              style={dropdownItemStyle}
                              onMouseEnter={hoverOn}
                              onMouseLeave={hoverOff}
                            >
                              {reason}
                            </li>
                          ))}
                          {reasonSuggestions.filter(r => r.toLowerCase().includes((formData.reason || '').toLowerCase())).length === 0 && (
                            <li className="muted" style={{ padding: '10px 14px', textAlign: 'center' }}>
                              Save the referral to use this new reason.
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                {/* Clinical notes */}
                <div className="form-group">
                  <label className="form-label" htmlFor="ref-notes">
                    Clinical notes <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <textarea
                    id="ref-notes"
                    className="form-textarea"
                    rows="2"
                    value={formData.clinicalNotes}
                    onChange={e => setFormData({ ...formData, clinicalNotes: e.target.value })}
                    placeholder="Relevant history, examination findings, investigation results"
                  />
                </div>

                {referralType === "Outside" && (
                  <div className="stack-sm" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-2)' }}>
                    <h3 className="toolbar-caption" style={{ margin: 0 }}>Outside referral details</h3>

                    <div className="form-row-2">
                      <div className="form-group">
                        <label className="form-label" htmlFor="ref-treat-hms">Treatment already given at HMS Hospital</label>
                        <textarea
                          id="ref-treat-hms"
                          className="form-textarea"
                          rows="2"
                          value={formData.treatmentHospital}
                          onChange={e => setFormData({ ...formData, treatmentHospital: e.target.value })}
                          placeholder="Treatment, medicines and investigations already given at HMS Hospital"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="ref-treat-local">Treatment already taken at a local hospital</label>
                        <textarea
                          id="ref-treat-local"
                          className="form-textarea"
                          rows="2"
                          value={formData.treatmentLocal}
                          onChange={e => setFormData({ ...formData, treatmentLocal: e.target.value })}
                          placeholder="Treatment already taken from a local hospital or specialist"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="ref-treat-period">Period of treatment</label>
                      <input
                        id="ref-treat-period"
                        type="text"
                        className="form-input"
                        value={formData.treatmentPeriod}
                        onChange={e => setFormData({ ...formData, treatmentPeriod: e.target.value })}
                        placeholder="e.g. 10 May 2026 to 18 May 2026 / 2 weeks"
                      />
                    </div>

                    <div className="form-row-2">
                      <div className="form-group">
                        <span className="form-label" id="ref-escort-label">Escort allowed</span>
                        <div className="segmented" role="radiogroup" aria-labelledby="ref-escort-label">
                          {["Yes", "No"].map(value => (
                            <button
                              key={value}
                              type="button"
                              role="radio"
                              aria-checked={formData.escortAllowed === value}
                              className={formData.escortAllowed === value ? 'is-active' : ''}
                              onClick={() => setFormData({
                                ...formData,
                                escortAllowed: value,
                                escortCount: value === "Yes" ? formData.escortCount : "",
                              })}
                            >
                              {value}
                            </button>
                          ))}
                        </div>
                      </div>
                      {formData.escortAllowed === "Yes" && (
                        <div className="form-group">
                          <label className="form-label" htmlFor="ref-escort-count">Number of escorts</label>
                          <input
                            id="ref-escort-count"
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

                    <div className="form-group">
                      <span className="form-label" id="ref-ambulance-label">Ambulance allowed</span>
                      <div className="segmented" role="radiogroup" aria-labelledby="ref-ambulance-label">
                        {["Yes", "No"].map(value => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={formData.ambulanceAllowed === value}
                            className={formData.ambulanceAllowed === value ? 'is-active' : ''}
                            onClick={() => setFormData({ ...formData, ambulanceAllowed: value })}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="ref-justification">Justification for allowing ambulance or escorts</label>
                      <textarea
                        id="ref-justification"
                        className="form-textarea"
                        rows="2"
                        value={formData.ambulanceEscortJustification}
                        onChange={e => setFormData({ ...formData, ambulanceEscortJustification: e.target.value })}
                        placeholder="Medical justification for ambulance or escort permission"
                      />
                    </div>
                  </div>
                )}

                {/* Actions */}
              </form>
              </div>
              <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-md"
                  onClick={() => {
                    setFormData(buildEmptyReferralForm(referralType));
                    clearSelectedPatient();
                    setEditReferralId(null);
                    setActiveTab('hub');
                  }}
                >
                  Cancel
                </button>
                <button type="button" className="btn btn-primary btn-md" disabled={submitting}
                  onClick={handleCreateReferral}
                >
                  {submitting
                    ? (editReferralId ? 'Updating…' : 'Saving…')
                    : <><Save size={16} aria-hidden="true" /> {editReferralId ? 'Update referral' : 'Save referral'}</>}
                </button>
              </div>
            </section>

            {/* Right column: patient referral history */}
            {selectedPatient && (
              <aside style={{ minWidth: 280, flex: '1 1 300px' }}>
                <section className="panel panel-pad" style={{ position: 'sticky', top: 20 }}>
                  <h2 className="panel-title"><History size={16} aria-hidden="true" /> Referral history</h2>

                  {loadingHistory ? (
                    <p className="muted">Loading history…</p>
                  ) : patientHistory.length > 0 ? (
                    <ul className="list-rows" style={{ maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', paddingRight: 4 }}>
                      {patientHistory.map((h) => (
                        <li key={h.id} style={{
                          padding: '12px 14px',
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderLeft: `3px solid ${HISTORY_ACCENT[h.status] || 'var(--amber)'}`,
                          borderRadius: 8,
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                            <span className="cell-secondary tabular">{formatDate(h.date)}</span>
                            {statusBadge(h.status)}
                          </div>
                          <div className="cell-primary" style={{ lineHeight: 1.3, marginBottom: 4 }}>
                            {h.to_specialty} <span className="muted" style={{ fontWeight: 400 }}>at</span> {h.hospital}
                          </div>
                          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 8 }}>
                            &ldquo;{h.reason}&rdquo;
                          </div>
                          <div className="cell-secondary" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Stethoscope size={13} aria-hidden="true" /> Dr. {h.doctor_name}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No earlier referrals for this patient.</p>
                  )}
                </section>
              </aside>
            )}
          </div>
        )}
      </main>

      <Modal
        open={pendingDeleteId != null}
        onOpenChange={(open) => { if (!open && !deleting) setPendingDeleteId(null); }}
        title="Delete referral"
        description={pendingDeleteRef ? `Referral for ${pendingDeleteRef.patient} to ${pendingDeleteRef.to_specialty || 'a specialist'}. This cannot be undone.` : 'This cannot be undone.'}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setPendingDeleteId(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={confirmDeleteReferral} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete referral'}
            </button>
          </>
        )}
      >
        <p className="muted">The referral is removed from your outbound list.</p>
      </Modal>

      {/* ═══════════════ Referral Preview Modal ═══════════════ */}
      {previewReferral && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Referral memo preview"
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'var(--surface-3)',
            display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
            overflowY: 'auto', padding: '40px 20px'
          }}
          onClick={() => setPreviewReferral(null)}
        >
          <div style={{ maxWidth: 820, width: '100%' }} onClick={e => e.stopPropagation()}>
            {/* Controls */}
            <div className="no-print" style={{
              display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16
            }}>
              <button type="button" className="btn btn-ghost btn-md" style={{ background: 'var(--surface)' }} onClick={() => setPreviewReferral(null)}>
                <ArrowLeft size={16} aria-hidden="true" /> Close
              </button>
              <button type="button" className="btn btn-secondary btn-md" onClick={handleSavePreviewChanges} disabled={isPreviewSaving}>
                {isPreviewSaving ? 'Saving…' : <><Save size={16} aria-hidden="true" /> Save changes</>}
              </button>
              <button type="button" className="btn btn-primary btn-md" onClick={handlePrintReferral}>
                <Printer size={16} aria-hidden="true" /> Print referral memo
              </button>
            </div>
            {previewReferral.referral_type === 'Local' && (
              <p className="muted" style={{ textAlign: 'center', marginBottom: 12 }}>Click a dotted field on the memo to edit it before saving or printing.</p>
            )}

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
                    <img src="/logo.png" alt="Hospital Logo" style={{ width: 80, height: 80, objectFit: 'contain', marginRight: 20 }} />
                    <div style={{ textAlign: 'center' }}>
                      <h2 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>अस्पताल प्रबंधन प्रणाली (चिकित्सा विभाग)</h2>
                      <h3 style={{ margin: '5px 0', fontSize: 18 }}>(चिकित्सा परामर्श एवं संदर्भ विभाग)</h3>
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
                            <span style={{ marginRight: 10, whiteSpace: 'nowrap' }}>अस्पताल के आउटडोर/इनडोर केस के रूप में</span>
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
                  <img src="/logo.png" alt="Hospital Logo" style={{ position: 'absolute', left: 0, top: 0, width: 90, height: 90, objectFit: 'contain' }} />
                  <div style={{ fontSize: 16, fontWeight: 700 }}>केंद्रीय चिकित्सालय एवं परामर्श केंद्र</div>
                  <h1 style={{ margin: '2px 0', fontSize: 20, letterSpacing: 1 }}>HOSPITAL MANAGEMENT SYSTEM — CLINICAL REFERRAL</h1>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>चिकित्सा विभाग (Medical Referral Division)</div>
                </div>

                {/* ─── REF NO & DATE ─── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <div>संदर्भ संख्या : मेडि - (2)/एम/ <strong>{previewReferral.id || '____'}</strong></div>
                  <div>Ref. No.: Medi-(2)/M/ <strong>{previewReferral.id || '____'}</strong></div>
                  <div>दिनांक / Dated: <strong>{formatDate(previewReferral.date)}</strong></div>
                </div>

                {/* Doctor who created */}
                <div style={{ textAlign: 'right', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                  Referred by: Dr. {(previewReferral.doctor_name || user?.name || 'Doctor').replace(/^Dr\.?\s*/i, '')}
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
                  <span style={{ minWidth: 280, fontWeight: 600 }}>मुख्य अस्पताल से पहले लिए उपचार का विवरण:</span>
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
