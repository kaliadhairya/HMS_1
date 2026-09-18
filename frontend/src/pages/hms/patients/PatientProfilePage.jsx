import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';

const PATIENT_TYPE_META = {
  corporate_employee: { label: 'Corporate Patient', fullLabel: 'Corporate Employee', bg: 'rgba(16,185,129,0.1)', color: '#059669', border: 'rgba(16,185,129,0.24)' },
  cisf_employee: { label: 'CISF Patient', fullLabel: 'CISF Employee', bg: 'rgba(99,102,241,0.1)', color: '#4f46e5', border: 'rgba(99,102,241,0.24)' },
  other: { label: 'General Patient', fullLabel: 'General', bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.24)' },
};

const getPatientTypeMeta = (type) => PATIENT_TYPE_META[type] || PATIENT_TYPE_META.other;

export default function PatientProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  const [patient, setPatient] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  // Tab Data
  const [visits, setVisits] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [conditions, setConditions] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [bills, setBills] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [vitals, setVitals] = useState([]);

  useEffect(() => {
    fetchProfile();
  }, [id]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/patients/hms/${id}`);
      setPatient(res.data.data);
      setAllergies(res.data.data.allergies || []);
      setConditions(res.data.data.chronic_conditions || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadTabData = async (tab) => {
    setActiveTab(tab);
    if (tab === 'visits' && visits.length === 0) {
      const res = await api.get(`/patients/hms/${id}/visits`);
      setVisits(res.data.data);
    }
    if (tab === 'documents' && documents.length === 0) {
      try { const res = await api.get(`/patients/hms/${id}/documents`); setDocuments(res.data.data); } catch {}
    }
    if (tab === 'billing' && bills.length === 0) {
      try { const res = await api.get(`/billing/patient/${id}`); setBills(res.data.data || []); } catch {}
    }
    if (tab === 'prescriptions' && prescriptions.length === 0) {
      try { const res = await api.get(`/hms/prescriptions/patient/${id}`); setPrescriptions(res.data || []); } catch {}
    }
    if (tab === 'vitals' && vitals.length === 0) {
      try { const res = await api.get(`/ipd/vitals/patient/${id}`); setVitals(res.data.data || []); } catch {}
    }
  };

  if (loading) return <><Navbar /><div className="page-wrapper" style={{textAlign: 'center', padding: 60}}><div className="spinner" /></div></>;
  if (!patient) return <><Navbar /><div className="page-wrapper"><h2>Patient not found</h2></div></>;

  const patientType = patient.patientType || patient.patient_type;
  const isCorporatePatient = patientType === 'corporate_employee';
  const patientTypeMeta = getPatientTypeMeta(patientType);
  const patientTypeLabel = patientTypeMeta.label;
  const headerIdLabel = isCorporatePatient ? 'EMP Number' : 'Phone';
  const headerIdValue = isCorporatePatient
    ? (patient.empNumber || patient.emp_number || '-')
    : (patient.phoneNumber || patient.phone_number || '-');

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      {/* ── Header Card ── */}
      <div className="card" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 24, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 6, background: 'var(--green)' }} />
        
        <div style={{ 
          width: 80, height: 80, borderRadius: '50%', background: 'var(--surface-3)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', 
          color: 'var(--text-secondary)', fontWeight: 'bold', shrink: 0 
        }}>
          {patient.name.charAt(0)}{patient.last_name ? patient.last_name.charAt(0) : ''}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
              <h1 style={{ margin: 0 }}>{patient.name}</h1>
              <span
                className="badge"
                style={{
                  fontSize: '0.78rem',
                  padding: '5px 11px',
                  borderRadius: 999,
                  background: patientTypeMeta.bg,
                  color: patientTypeMeta.color,
                  border: `1px solid ${patientTypeMeta.border}`,
                  textTransform: 'uppercase',
                }}
              >
                {patientTypeLabel}
              </span>
            </div>
            <div className="badge badge-teal" style={{ fontSize: '1rem', padding: '6px 14px' }}>
              {patient.uhid || 'Legacy Patient'}
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: '10px 24px', flexWrap: 'wrap', fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
            <div><strong>Age:</strong> {patient.age} Yrs</div>
            <div><strong>Gender:</strong> {patient.gender}</div>
            <div><strong>Blood Group:</strong> <span style={{ color: 'var(--red)', fontWeight: 'bold' }}>{patient.blood_group || 'Unknown'}</span></div>
            <div><strong>{headerIdLabel}:</strong> {headerIdValue}</div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {allergies.length > 0 && <span className="badge badge-red">Allergies ({allergies.length})</span>}
            {conditions.length > 0 && <span className="badge badge-amber">Chronic ({conditions.length})</span>}
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/hms/appointments/book', { state: { patient } })}>
              📅 Book Appointment
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => navigate('/hms/opd/token', { state: { patient } })}>
              🎫 Generate Token
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/patient/${id}/journey`)}>
              🗂️ Journey
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs Navigation ── */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
        {['overview', 'visits', 'documents', 'prescriptions', 'billing', 'clinical', 'vitals'].map(tab => (
          <button
            key={tab}
            onClick={() => loadTabData(tab)}
            style={{
              padding: '12px 24px',
              background: activeTab === tab ? 'var(--tab-bg-active)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '3px solid var(--green)' : '3px solid transparent',
              color: activeTab === tab ? 'var(--green)' : 'var(--text-secondary)',
              fontWeight: 600,
              textTransform: 'capitalize',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            {tab === 'clinical' ? 'Allergies & Conditions' : tab}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="card fade-up">
        
        {activeTab === 'overview' && (
          <div className="form-grid-2">
            <div>
              <div className="card-section-title">Demographics</div>
              <table className="test-table" style={{ border: 'none', boxShadow: 'none' }}>
                <tbody>
                  <tr><td className="label-cell">DOB</td><td>{patient.dob || '-'}</td></tr>
                  <tr><td className="label-cell">Patient Type</td><td>{patientTypeMeta.fullLabel}</td></tr>
                  <tr><td className="label-cell">Aadhaar (Masked)</td><td>{patient.aadhaar_masked || '-'}</td></tr>
                  <tr><td className="label-cell">Registration Date</td><td>{new Date(patient.createdAt).toLocaleDateString()}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="card-section-title">Address & Contact</div>
              <table className="test-table" style={{ border: 'none', boxShadow: 'none' }}>
                <tbody>
                  <tr><td className="label-cell">Email</td><td>{patient.email || '-'}</td></tr>
                  <tr><td className="label-cell">Address</td><td>{patient.house_no} {patient.street}, {patient.city}</td></tr>
                  <tr><td className="label-cell">Emergency Contact</td><td>{patient.emergency_contact_name || '-'} ({patient.emergency_contact_relation || '-'})</td></tr>
                  <tr><td className="label-cell">Emergency Phone</td><td>{patient.emergency_contact_phone || '-'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'visits' && (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Department</th>
                  <th>Doctor</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visits.length === 0 ? <tr><td colSpan="6" style={{textAlign: 'center'}}>No visits found.</td></tr> : visits.map((v, i) => (
                  <tr key={i}>
                    <td>{new Date(v.date).toLocaleDateString()}</td>
                    <td>{v.type}</td>
                    <td>{v.department}</td>
                    <td>{v.doctor}</td>
                    <td><span className={`badge badge-${v.status === 'final' ? 'green' : 'amber'}`}>{v.status}</span></td>
                    <td>
                      {v.type === 'Lab Test' && (
                        <button className="btn btn-outline btn-sm" onClick={() => navigate(`/report/${v.reference_id}`)}>View Report</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'clinical' && (
          <div className="form-grid-2">
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-section-title">Allergies</div>
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}>+ Add</button>
              </div>
              {allergies.length === 0 ? <p style={{color:'var(--text-muted)'}}>No known allergies.</p> : (
                <ul style={{ paddingLeft: 20, color: 'var(--red)' }}>
                  {allergies.map(a => <li key={a.id}><b>{a.allergen}</b> - {a.reaction} ({a.severity})</li>)}
                </ul>
              )}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-section-title">Chronic Conditions</div>
                <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px' }}>+ Add</button>
              </div>
              {conditions.length === 0 ? <p style={{color:'var(--text-muted)'}}>No chronic conditions reported.</p> : (
                <ul style={{ paddingLeft: 20 }}>
                  {conditions.map(c => <li key={c.id}><b>{c.condition_name}</b> (Since {c.since_when})</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'billing' && (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Bill No</th><th>Date</th><th>Type</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {bills.length === 0 ? <tr><td colSpan="6" style={{textAlign:'center'}}>No billing records.</td></tr> :
                  bills.map(b => (
                    <tr key={b.ID || b.id}>
                      <td><strong>{b.BILL_NUMBER || b.bill_number}</strong></td>
                      <td>{b.CREATED_AT ? new Date(b.CREATED_AT).toLocaleDateString() : ''}</td>
                      <td>{b.BILL_TYPE || b.bill_type}</td>
                      <td>Rs.{Number(b.NET_PAYABLE || b.net_payable || 0).toFixed(2)}</td>
                      <td><span className={`badge ${(b.STATUS || b.status) === 'Paid' ? 'badge-green' : 'badge-amber'}`}>{b.STATUS || b.status}</span></td>
                      <td>
                        {(b.STATUS || b.status) === 'Paid'
                          ? <button type="button" onClick={() => openAuthenticatedBlob(`/pdf/bill/${b.ID || b.id}`)} className="btn btn-outline btn-sm">View PDF</button>
                          : <button className="btn btn-primary btn-sm" onClick={() => navigate(`/billing/opd/${b.ENCOUNTER_ID || b.encounter_id}`)}>Pay Now</button>
                        }
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'prescriptions' && (
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Date</th><th>Doctor</th><th>Items</th><th>Action</th></tr></thead>
              <tbody>
                {prescriptions.length === 0 ? <tr><td colSpan="4" style={{textAlign:'center'}}>No prescriptions.</td></tr> :
                  prescriptions.map(p => (
                    <tr key={p.id}>
                      <td>{p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</td>
                      <td>{p.doctor_name || 'Doctor'}</td>
                      <td>{p.items?.length || 0} medicines</td>
                      <td>
                        <button 
                          className="btn btn-outline btn-sm" 
                          onClick={() => navigate(`/hms/prescription-slip?patientId=${id}&encounterId=${p.encounter_id}`)}
                        >
                          View Prescription
                        </button>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="table-wrapper">
             <table>
               <thead><tr><th>Type</th><th>File Name</th><th>Uploaded At</th><th>Action</th></tr></thead>
               <tbody>
                 {documents.length === 0 ? <tr><td colSpan="4" style={{textAlign:'center'}}>No documents uploaded yet.</td></tr> :
                   documents.map(doc => (
                     <tr key={doc.id}>
                       <td><span className="badge badge-teal">{doc.doc_type || 'File'}</span></td>
                       <td>{doc.file_name}</td>
                       <td>{doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : ''}</td>
                       <td>
                        <a 
                          href={doc.file_url.startsWith('http') ? doc.file_url : `${api.defaults.baseURL}${doc.file_url}`} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="btn btn-outline btn-sm"
                          style={{ textDecoration: 'none' }}
                        >
                          Open File
                        </a>
                       </td>
                     </tr>
                   ))
                 }
               </tbody>
             </table>
          </div>
        )}

        {activeTab === 'vitals' && (
          <div className="table-wrapper">
             <table className="table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
               <thead>
                 <tr style={{ borderBottom: '1px solid var(--border)' }}>
                   <th style={{ padding: 12 }}>Time & Shift</th>
                   <th style={{ padding: 12 }}>BP</th>
                   <th style={{ padding: 12 }}>Pulse</th>
                   <th style={{ padding: 12 }}>Temp</th>
                   <th style={{ padding: 12 }}>SpO2</th>
                   <th style={{ padding: 12 }}>Total In/Out (mL)</th>
                 </tr>
               </thead>
               <tbody>
                  {vitals.length === 0 ? <tr><td colSpan="6" style={{textAlign:'center', padding: 16}}>No vitals recorded.</td></tr> : vitals.map(v => (
                    <tr key={v.id || v.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                       <td style={{ padding: 12 }}>
                         {new Date(v.RECORDED_AT || v.recordedAt).toLocaleString()}
                         <br/><small>{v.SHIFT || v.shift}</small>
                       </td>
                       <td style={{ padding: 12, color: ((v.BP_SYSTOLIC||v.bpSystolic) > 140 || (v.BP_SYSTOLIC||v.bpSystolic) < 90) ? '#e53e3e' : 'inherit' }}>
                         {v.BP_SYSTOLIC || v.bpSystolic}/{v.BP_DIASTOLIC || v.bpDiastolic}
                       </td>
                       <td style={{ padding: 12, color: ((v.PULSE||v.pulse) > 100 || (v.PULSE||v.pulse) < 60) ? '#e53e3e' : 'inherit' }}>{v.PULSE || v.pulse}</td>
                       <td style={{ padding: 12, color: ((v.TEMPERATURE||v.temperature) > 99.5) ? '#e53e3e' : 'inherit' }}>{v.TEMPERATURE || v.temperature}</td>
                       <td style={{ padding: 12, color: ((v.SPO2||v.spo2) && (v.SPO2||v.spo2) < 95) ? '#e53e3e' : 'inherit' }}>{v.SPO2 || v.spo2}</td>
                       <td style={{ padding: 12 }}>In: {(v.INTAKE_ORAL_ML||v.intakeOralMl||0) + (v.INTAKE_IV_ML||v.intakeIvMl||0)} | Out: {(v.OUTPUT_URINE_ML||v.outputUrineMl||0) + (v.OUTPUT_DRAIN_ML||v.outputDrainMl||0)}</td>
                    </tr>
                  ))}
               </tbody>
             </table>
          </div>
        )}

      </div>
    </div>
    </>
  );
}
