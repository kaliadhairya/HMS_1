import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { GitMerge, RefreshCw, ScanSearch, Undo2, UserX, Users } from 'lucide-react';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

const TABS = [['open', 'To review'], ['merged', 'Merged'], ['dismissed', 'Different people'], ['unmerged', 'Unmerged']];
const MERGE_ROLES = ['super_admin', 'admin'];
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function PatientCard({ patient, kept, merged }) {
  return (
    <div className="panel panel-pad" style={{ flex: 1, minWidth: 240, borderColor: kept ? 'var(--green)' : undefined }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <Link to={`/hms/patients/${patient.id}`} className="cell-primary">{patient.name}</Link>
        {kept && <span className="status status-success">Kept</span>}
        {merged && <span className="status status-neutral">Merged in</span>}
      </div>
      <dl className="facts" style={{ marginTop: 8 }}>
        <div><dt className="fact-label">UHID</dt><dd className="fact-value mono" style={{ margin: 0 }}>{patient.uhid}</dd></div>
        <div><dt className="fact-label">Sex / age</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.gender}, {patient.age}</dd></div>
        <div><dt className="fact-label">Date of birth</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.dob || '—'}</dd></div>
        <div><dt className="fact-label">Phone</dt><dd className="fact-value tabular" style={{ margin: 0 }}>{patient.phone || '—'}</dd></div>
        <div><dt className="fact-label">Visits</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.visits}{patient.admitted ? ' · currently admitted' : ''}</dd></div>
        <div><dt className="fact-label">Registered</dt><dd className="fact-value" style={{ margin: 0 }}>{fmt(patient.registered_at)}</dd></div>
      </dl>
    </div>
  );
}

// Possible duplicate patients: people decide. Front desk and admins mark
// pairs as different people; only admins merge, and merges can be undone.
export default function DuplicateReviewPage() {
  const { user } = useAuth();
  const canMerge = MERGE_ROLES.includes(user?.role);
  const [status, setStatus] = useState('open');
  const [cases, setCases] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async (which = status) => {
    setCases(null);
    try {
      const { data } = await api.get('/patients/duplicates', { params: { status: which } });
      setCases(data.data || []);
    } catch {
      setCases([]);
      toast.error('Could not load possible duplicates.');
    }
  };
  useEffect(() => { load(status); }, [status]);

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await request();
      toast.success(data.message || success);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (c) => {
    const reason = window.prompt('Why are these different people? (for example: twins, mother and daughter)');
    if (reason) act(() => api.post(`/patients/duplicates/${c.id}/dismiss`, { reason }), 'Marked as different people');
  };
  const merge = (c, keep) => {
    const other = keep.id === c.patient_a.id ? c.patient_b : c.patient_a;
    const reason = window.prompt(`Keep ${keep.name} (${keep.uhid}) and merge ${other.name} (${other.uhid}) into it?\n\nAll visits, bills and records move to the kept record. This can be undone.\n\nHow did you confirm they are the same person?`);
    if (reason) act(() => api.post(`/patients/duplicates/${c.id}/merge`, { survivorId: keep.id, reason }), 'Merged');
  };
  const unmerge = (c) => {
    const reason = window.prompt('Why was this merge wrong? Every moved record will go back.');
    if (reason) act(() => api.post(`/patients/duplicates/${c.id}/unmerge`, { reason }), 'Unmerged');
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Possible duplicates"
          description="Records that may belong to the same person. Nothing is merged automatically: check the evidence and decide."
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={() => load()}><RefreshCw size={16} aria-hidden="true" /> Refresh</button>
              <button type="button" className="btn btn-secondary btn-md" disabled={busy} onClick={() => act(() => api.post('/patients/duplicates/scan'), 'Scan finished')}>
                <ScanSearch size={16} aria-hidden="true" /> Scan all patients
              </button>
            </>
          )}
        />
        <section className="panel">
          <div className="tabs" role="tablist" aria-label="Duplicate cases">
            {TABS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={status === key} className={`tab${status === key ? ' is-active' : ''}`} onClick={() => setStatus(key)}>{label}</button>
            ))}
          </div>
          <div className="panel-pad stack">
            {cases === null && <p className="muted">Loading…</p>}
            {cases && cases.length === 0 && <EmptyState icon={Users} title="Nothing here" description={status === 'open' ? 'No possible duplicates are waiting for review.' : 'No cases in this list.'} />}
            {cases && cases.map((c) => (
              <article key={c.id} className="panel panel-pad stack" aria-label={`Case ${c.id}`}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <strong>Why flagged:</strong>
                  {c.evidence.map((e) => <span key={e} className="tag">{e}</span>)}
                  <span className="muted" style={{ marginLeft: 'auto' }}>Found {fmt(c.detected_at)}</span>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <PatientCard patient={c.patient_a} kept={c.survivor_id === c.patient_a.id && status === 'merged'} merged={c.merged_id === c.patient_a.id && status === 'merged'} />
                  <PatientCard patient={c.patient_b} kept={c.survivor_id === c.patient_b.id && status === 'merged'} merged={c.merged_id === c.patient_b.id && status === 'merged'} />
                </div>
                {c.decision_reason && <p className="muted">Decision by {c.decided_by_name || 'staff'} ({fmt(c.decided_at)}): {c.decision_reason}</p>}
                {c.unmerge_reason && <p className="muted">Unmerged {fmt(c.unmerged_at)}: {c.unmerge_reason}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {status === 'open' && (
                    <>
                      <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={() => dismiss(c)}><UserX size={16} aria-hidden="true" /> Different people</button>
                      {canMerge && [c.patient_a, c.patient_b].map((p) => (
                        <button key={p.id} type="button" className="btn btn-secondary btn-md" disabled={busy} onClick={() => merge(c, p)}>
                          <GitMerge size={16} aria-hidden="true" /> Keep {p.uhid}
                        </button>
                      ))}
                      {!canMerge && <span className="muted">Only an administrator can merge records.</span>}
                    </>
                  )}
                  {status === 'merged' && canMerge && (
                    <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={() => unmerge(c)}><Undo2 size={16} aria-hidden="true" /> Undo merge</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
