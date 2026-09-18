import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import toast from 'react-hot-toast';

const getPatientTypeLabel = (type) => {
  if (type === 'corporate_employee') return 'Corporate Employee';
  if (type === 'cisf_employee') return 'CISF Employee';
  return 'General';
};

const EVENT_TYPES = {
  Registration: { icon: '📋', color: '#48bb78' },
  'OPD Visit': { icon: '🩺', color: '#0f4c81' },
  'Lab Report': { icon: '🔬', color: '#d69e2e' },
  Prescription: { icon: '💊', color: '#9f7aea' },
  Admission: { icon: '🛏️', color: '#e53e3e' },
  Bill: { icon: '💰', color: '#38b2ac' },
  Payment: { icon: '✅', color: '#48bb78' },
};

export default function PatientJourneyPage() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJourney();
  }, [patientId]);

  const fetchJourney = async () => {
    try {
      // Fetch patient
      const pRes = await api.get(`/patients/hms/${patientId}`);
      setPatient(pRes.data.data);

      const timeline = [];

      // Registration event
      if (pRes.data.data) {
        const p = pRes.data.data;
        timeline.push({
          id: 'reg',
          type: 'Registration',
          date: p.createdAt,
          summary: `Patient registered as ${getPatientTypeLabel(p.patientType)} — UHID: ${p.uhid}`,
          details: { name: p.name, age: p.age, gender: p.gender, blood_group: p.blood_group },
        });
      }

      // Encounters (OPD visits)
      try {
        const eRes = await api.get(`/hms/encounters/patient/${patientId}`);
        const encounters = eRes.data || eRes.data?.data || [];
        if (Array.isArray(encounters)) {
          encounters.forEach(e => {
            timeline.push({
              id: `enc-${e.id}`,
              type: 'OPD Visit',
              date: e.encounter_date || e.created_at,
              summary: `${e.encounter_type || 'OPD'} visit — Dr. ${e.doctor?.name || e.doctor_name || 'N/A'} (${e.department || 'General'})`,
              details: { complaint: e.chief_complaint, status: e.status, encounterId: e.id },
              link: `/hms/prescription-slip?patientId=${patientId}&encounterId=${e.id}`,
            });
          });
        }
      } catch {}

      // Prescriptions
      try {
        const rxRes = await api.get(`/hms/prescriptions/patient/${patientId}`);
        const rxList = rxRes.data || [];
        if (Array.isArray(rxList)) {
          rxList.forEach(rx => {
            timeline.push({
              id: `rx-${rx.id}`,
              type: 'Prescription',
              date: rx.created_at,
              summary: `Prescription — ${rx.items?.length || 0} medicines`,
              details: { medicines: rx.items?.map(i => i.medicine_name).join(', ') || 'N/A' },
              link: `/hms/prescription-slip?patientId=${patientId}&encounterId=${rx.encounter_id}`,
              external: false,
            });
          });
        }
      } catch {}

      // Lab Reports (from visits)
      try {
        const vRes = await api.get(`/patients/hms/${patientId}/visits`);
        const visits = vRes.data?.data || [];
        visits.filter(v => v.type === 'Lab Test').forEach(lab => {
          timeline.push({
            id: `lab-${lab.reference_id}`,
            type: 'Lab Report',
            date: lab.date,
            summary: `Lab Report — ${lab.department || 'Pathology'}`,
            details: { status: lab.status, department: lab.department, reportId: lab.reference_id },
            link: `/report/${lab.reference_id}`,
            external: false,
          });
        });
      } catch {}

      // Uploaded Documents
      try {
        const dRes = await api.get(`/patients/hms/${patientId}/documents`);
        const docs = dRes.data?.data || [];
        docs.forEach(doc => {
          timeline.push({
            id: `doc-${doc.id}`,
            type: 'Document',
            date: doc.uploaded_at,
            summary: `${doc.doc_type || 'File'} — ${doc.file_name}`,
            details: { type: doc.doc_type, filename: doc.file_name },
            link: doc.file_url.startsWith('http') ? doc.file_url : `${api.defaults.baseURL}${doc.file_url}`,
            external: true,
          });
        });
      } catch {}

      // Bills
      try {
        const bRes = await api.get(`/billing/patient/${patientId}`);
        const bList = bRes.data?.data || [];
        bList.forEach(b => {
          timeline.push({
            id: `bill-${b.ID || b.id}`,
            type: 'Bill',
            date: b.CREATED_AT || b.created_at,
            summary: `Bill ${b.BILL_NUMBER || b.bill_number} — Rs.${Number(b.NET_PAYABLE || b.net_payable || 0).toFixed(0)} (${b.STATUS || b.status})`,
            details: { bill_type: b.BILL_TYPE || b.bill_type, amount: b.NET_PAYABLE || b.net_payable, encounterId: b.ENCOUNTER_ID },
            link: `/billing/opd/${b.ENCOUNTER_ID || b.encounter_id}`,
            external: false,
          });
        });
      } catch {}

      // Sort by date descending
      timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      setEvents(timeline);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load patient journey');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  if (loading) return <><Navbar /><div className="page-wrapper" style={{ textAlign: 'center', padding: 60 }}><div className="spinner" /></div></>;
  if (!patient) return <><Navbar /><div className="page-wrapper"><h2>Patient not found</h2></div></>;

  return (
    <>
      <Navbar />
      <div className="page-wrapper fade-up">
        
        {/* Patient Header Card */}
        <div className="card" style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 28, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 6, background: 'var(--green)' }} />
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--surface-3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem',
            fontWeight: 'bold', color: 'var(--text-secondary)', flexShrink: 0, marginLeft: 10,
          }}>
            {patient.name?.charAt(0)}
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>{patient.name}</h2>
            <div style={{ display: 'flex', gap: 20, fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: 6 }}>
              <span><strong>UHID:</strong> {patient.uhid}</span>
              <span><strong>Age:</strong> {patient.age}Y / {patient.gender}</span>
              <span><strong>Blood:</strong> <span style={{ color: 'var(--red)', fontWeight: 600 }}>{patient.blood_group || 'Unknown'}</span></span>
            </div>
          </div>
          <button className="btn btn-outline" onClick={() => navigate(`/hms/patients/${patientId}`)}>← Profile</button>
        </div>

        <h2 style={{ marginBottom: 20 }}>🗂️ Patient Journey Timeline</h2>

        {events.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ color: 'var(--text-secondary)' }}>No events found for this patient.</p>
          </div>
        ) : (
          <div style={{ position: 'relative', paddingLeft: 36 }}>
            {/* Vertical line */}
            <div style={{ position: 'absolute', left: 16, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />

            {events.map((evt, idx) => {
              const et = EVENT_TYPES[evt.type] || { icon: '📌', color: '#888' };
              const isOpen = expanded[evt.id];
              return (
                <div key={evt.id} className="fade-up" style={{ marginBottom: 20, position: 'relative', animationDelay: `${idx * 0.03}s` }}>
                  {/* Node dot */}
                  <div style={{
                    position: 'absolute', left: -28, top: 8, width: 24, height: 24,
                    borderRadius: '50%', background: et.color, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem',
                    boxShadow: `0 0 0 4px var(--bg)`, zIndex: 1,
                  }}>
                    {et.icon}
                  </div>

                  {/* Event card */}
                  <div className="card" style={{ padding: '16px 20px', cursor: 'pointer', transition: 'all 0.2s' }} onClick={() => toggleExpand(evt.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: 12,
                          fontSize: '0.72rem', fontWeight: 600, background: et.color + '20',
                          color: et.color, marginRight: 10,
                        }}>
                          {evt.type}
                        </span>
                        <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{evt.summary}</span>
                      </div>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {evt.date ? new Date(evt.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                      </span>
                    </div>

                    {/* Expanded details */}
                    {isOpen && evt.details && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {Object.entries(evt.details).map(([k, v]) => v && (
                          <div key={k} style={{ marginBottom: 4 }}>
                            <strong style={{ textTransform: 'capitalize' }}>{k.replace(/_/g, ' ')}:</strong> {String(v)}
                          </div>
                        ))}
                        {evt.link && (
                          evt.external
                            ? <a href={evt.link} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm" style={{ marginTop: 8, textDecoration: 'none' }}>Open</a>
                            : <button className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={(e) => { e.stopPropagation(); navigate(evt.link); }}>View Details</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
