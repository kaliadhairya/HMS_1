import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, UserRound, Stethoscope, FlaskConical, Pill, BedDouble, Receipt, CircleCheck, FileText, ChevronDown, ExternalLink, Route,
} from 'lucide-react';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';

const getPatientTypeLabel = (type) => (type === 'corporate_employee' ? 'Corporate beneficiary' : 'General');

// Each event type gets an icon and a status tone; colour is never the only cue (the type is always written).
const EVENT_TYPES = {
  Registration: { icon: UserRound, tone: 'neutral' },
  'OPD Visit': { icon: Stethoscope, tone: 'info' },
  'Lab Report': { icon: FlaskConical, tone: 'warning' },
  Prescription: { icon: Pill, tone: 'info' },
  Admission: { icon: BedDouble, tone: 'danger' },
  Bill: { icon: Receipt, tone: 'neutral' },
  Payment: { icon: CircleCheck, tone: 'success' },
  Document: { icon: FileText, tone: 'neutral' },
};
const FILTERS = ['All', 'OPD Visit', 'Prescription', 'Lab Report', 'Bill', 'Document'];

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const billLink = (b) => {
  const admissionId = b.ADMISSION_ID || b.admission_id;
  const encounterId = b.ENCOUNTER_ID || b.encounter_id;
  if ((b.BILL_TYPE || b.bill_type) === 'IPD' && admissionId) return `/ipd/billing/${admissionId}`;
  if (encounterId) return `/billing/opd/${encounterId}`;
  return `/billing/patient/${b.PATIENT_ID || b.patient_id}`;
};

export default function PatientJourneyPage() {
  const { patientId } = useParams();
  const navigate = useNavigate();
  const [patient, setPatient] = useState(null);
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);

  const fetchJourney = useCallback(async () => {
    setLoading(true);
    try {
      const pRes = await api.get(`/patients/hms/${patientId}`);
      const p = pRes.data.data;
      setPatient(p);

      const timeline = [];
      if (p) {
        timeline.push({
          id: 'reg',
          type: 'Registration',
          date: p.createdAt,
          summary: `Registered as ${getPatientTypeLabel(p.patientType)}`,
          details: { UHID: p.uhid, name: p.name, age: p.age, gender: p.gender, blood_group: p.blood_group },
        });
      }

      // Each source is optional: a role without access to one still sees the rest.
      const [encRes, rxRes, visitRes, docRes, billRes] = await Promise.allSettled([
        api.get(`/hms/encounters/patient/${patientId}`),
        api.get(`/hms/prescriptions/patient/${patientId}`),
        api.get(`/patients/hms/${patientId}/visits`),
        api.get(`/patients/hms/${patientId}/documents`),
        api.get(`/billing/patient/${patientId}`),
      ]);
      const listOf = (r) => {
        if (r.status !== 'fulfilled') return [];
        const d = r.value.data;
        return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
      };

      listOf(encRes).forEach((e) => {
        const dept = typeof e.department === 'object' ? e.department?.name : e.department;
        timeline.push({
        id: `enc-${e.id}`,
        type: 'OPD Visit',
        date: e.encounter_date || e.created_at,
        summary: `${e.encounter_type || 'OPD'} visit with Dr. ${(e.doctor?.name || e.doctor_name || 'N/A').replace(/^Dr\.?\s*/i, '')}${dept ? ` (${dept})` : ''}`,
        details: { complaint: e.chief_complaint, status: e.status },
        link: `/hms/prescription-slip?patientId=${patientId}&encounterId=${e.id}`,
        });
      });

      listOf(rxRes).forEach((rx) => timeline.push({
        id: `rx-${rx.id}`,
        type: 'Prescription',
        date: rx.created_at,
        summary: `Prescription, ${rx.items?.length || 0} ${rx.items?.length === 1 ? 'medicine' : 'medicines'}`,
        details: { medicines: rx.items?.map((i) => i.medicine_name).join(', ') || 'N/A' },
        link: `/hms/prescription-slip?patientId=${patientId}&encounterId=${rx.encounter_id}`,
      }));

      listOf(visitRes).filter((v) => v.type === 'Lab Test').forEach((lab) => timeline.push({
        id: `lab-${lab.reference_id}`,
        type: 'Lab Report',
        date: lab.date,
        summary: `Lab report, ${lab.department || 'Pathology'}`,
        details: { status: lab.status, department: lab.department },
        link: `/report/${lab.reference_id}`,
      }));

      listOf(docRes).forEach((doc) => timeline.push({
        id: `doc-${doc.id}`,
        type: 'Document',
        date: doc.uploaded_at,
        summary: `${doc.doc_type || 'File'}: ${doc.file_name}`,
        details: { type: doc.doc_type, filename: doc.file_name },
        link: doc.file_url?.startsWith('http') ? doc.file_url : `${api.defaults.baseURL}${doc.file_url}`,
        external: true,
      }));

      listOf(billRes).forEach((b) => timeline.push({
        id: `bill-${b.ID || b.id}`,
        type: 'Bill',
        date: b.CREATED_AT || b.created_at,
        summary: `Bill ${b.BILL_NUMBER || b.bill_number}, ₹${Number(b.NET_PAYABLE || b.net_payable || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${b.STATUS || b.status})`,
        details: { bill_type: b.BILL_TYPE || b.bill_type, status: b.STATUS || b.status },
        link: billLink(b),
      }));

      timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      setEvents(timeline);
    } catch {
      toast.error('Failed to load the patient journey');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchJourney(); }, [fetchJourney]);

  const counts = useMemo(() => {
    const c = { All: events.length };
    events.forEach((e) => { c[e.type] = (c[e.type] || 0) + 1; });
    return c;
  }, [events]);
  const visible = filter === 'All' ? events : events.filter((e) => e.type === filter);

  const toggleExpand = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  const backButton = (
    <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(`/hms/patients/${patientId}`)}>
      <ArrowLeft size={16} aria-hidden="true" /> Patient profile
    </button>
  );

  if (loading) {
    return (<><Navbar /><main className="app-page"><p className="muted">Loading patient journey…</p></main></>);
  }
  if (!patient) {
    return (
      <>
        <Navbar />
        <main className="app-page">
          <h1 className="sr-only">Patient journey</h1>
          <section className="panel"><EmptyState icon={UserRound} title="Patient not found" description="The patient may have been removed, or the link is wrong." /></section>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title={`${patient.name}: patient journey`}
          description="Every registration, visit, prescription, lab report, document and bill, newest first."
          meta={(
            <span className="muted">
              <span className="mono">{patient.uhid}</span>
              {patient.age ? ` · ${patient.age} y` : ''}{patient.gender ? ` · ${patient.gender}` : ''}
              {patient.blood_group ? ` · Blood group ${patient.blood_group}` : ''}
            </span>
          )}
          actions={backButton}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Filter events">
              {FILTERS.map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
                  {f === 'All' ? 'All' : `${f}s`.replace('OPD Visits', 'Visits')} <span className="seg-count">{counts[f] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState icon={Route} title="No events" description={filter === 'All' ? 'Nothing has been recorded for this patient yet.' : 'No events of this type.'} />
          ) : (
            <ol className="timeline">
              {visible.map((evt) => {
                const et = EVENT_TYPES[evt.type] || { icon: FileText, tone: 'neutral' };
                const Icon = et.icon;
                const isOpen = Boolean(expanded[evt.id]);
                const detailId = `evt-${evt.id}-details`;
                return (
                  <li key={evt.id} className="timeline-item">
                    <span className={`timeline-dot tone-${et.tone}`} aria-hidden="true"><Icon size={14} /></span>
                    <div className="timeline-card">
                      <button type="button" className="timeline-head" onClick={() => toggleExpand(evt.id)} aria-expanded={isOpen} aria-controls={detailId}>
                        <span className={`status status-${et.tone}`}>{evt.type}</span>
                        <span className="timeline-summary">{evt.summary}</span>
                        <span className="cell-secondary tabular" style={{ whiteSpace: 'nowrap' }}>{fmtDate(evt.date)}</span>
                        <ChevronDown size={16} aria-hidden="true" className={`timeline-chevron${isOpen ? ' is-open' : ''}`} />
                      </button>
                      {isOpen && (
                        <div id={detailId} className="timeline-details">
                          <dl className="facts">
                            {Object.entries(evt.details || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
                              <div key={k}>
                                <dt className="fact-label">{k.replace(/_/g, ' ')}</dt>
                                <dd className="fact-value" style={{ margin: 0 }}>{String(v)}</dd>
                              </div>
                            ))}
                          </dl>
                          {evt.link && (
                            evt.external ? (
                              <a href={evt.link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }}>
                                <ExternalLink size={14} aria-hidden="true" /> Open file
                              </a>
                            ) : (
                              <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => navigate(evt.link)}>
                                Open
                              </button>
                            )
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}
