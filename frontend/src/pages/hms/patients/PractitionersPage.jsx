import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, CircleSlash, ShieldAlert, Stethoscope } from 'lucide-react';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { localYmd } from '../../../utils/localDate';
import { useGovernedCommand } from '../../../hooks/useGovernedCommand';

const ADMINS = ['super_admin', 'admin'];
const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');
const EMPTY = { kind: 'medical_registration', identifier: '', issuingBody: '', validFrom: localYmd(), validTo: '' };

// Doctors and their recorded medical registrations. Administrators record,
// verify and end registrations; an expired registration blocks clinical work.
export default function PractitionersPage() {
  const { user } = useAuth();
  const canEdit = ADMINS.includes(user?.role);
  const [list, setList] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [verification, setVerification] = useState(null);

  const loadList = async () => {
    try {
      const { data } = await api.get('/practitioners');
      setList(data.data || []);
    } catch {
      setList([]);
      toast.error('Could not load practitioners.');
    }
  };
  const loadDetail = async (userId) => {
    setDetail(null);
    try {
      const { data } = await api.get(`/practitioners/${userId}`);
      setDetail(data.data);
    } catch {
      toast.error('Could not load this practitioner.');
    }
  };
  useEffect(() => { loadList(); }, []);
  useEffect(() => { if (selected) loadDetail(selected); }, [selected]);

  const command = useGovernedCommand(async () => { await loadDetail(selected); await loadList(); });
  const busy = command.busy || command.uncertain;
  const confirmed = (result) => {
    if (!result) return;
    if (result.path.endsWith('/credentials')) setForm(EMPTY);
    if (result.path.endsWith('/verify')) setVerification(null);
  };

  const addCredential = (e) => {
    e.preventDefault();
    command.send(`/practitioners/${selected}/credentials`, { ...form, validTo: form.validTo || undefined }).then(confirmed);
  };
  const endCredential = (c) => {
    const reason = window.prompt('Why does this registration end? (for example: lapsed, struck off, renewed under a new number)');
    if (reason) command.send(`/practitioners/${selected}/credentials/${c.id}/end`, { reason }).then(confirmed);
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Practitioners" description="Record professional qualifications, verify them independently, then approve separate facility-specific clinical privileges." />
        {command.message && <p role="status">{command.message}</p>}
        {command.uncertain && <button className="btn btn-secondary" disabled={command.busy} onClick={() => command.reconcile().then(confirmed)}>Reconcile original request</button>}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', alignItems: 'start' }}>
          <section className="panel">
            {list === null && <p className="muted panel-pad">Loading…</p>}
            {list && list.length === 0 && <EmptyState icon={Stethoscope} title="No practitioners" description="Doctor accounts appear here." />}
            {list && list.map((p) => (
              <button key={p.id} type="button" className={`btn btn-ghost btn-md${selected === p.user_id ? ' is-active' : ''}`}
                style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }} disabled={busy} onClick={() => { setSelected(p.user_id); setVerification(null); }}>
                <span>{p.display_name}</span>
                {p.registration_expired
                  ? <span className="status status-danger">Review required</span>
                  : Number(p.credential_count) === 0
                    ? <span className="status status-neutral">None recorded</span>
                    : <span className="status status-success">Current</span>}
              </button>
            ))}
          </section>

          <section className="panel panel-pad stack">
            {!selected && <EmptyState icon={Stethoscope} title="Choose a practitioner" description="Their registrations and status appear here." />}
            {selected && !detail && <p className="muted">Loading…</p>}
            {detail && (
              <>
                <h2 className="panel-subtitle" style={{ marginTop: 0 }}>{detail.display_name}</h2>
                {detail.registration_expired && (
                  <div className="alert-strip alert-warning" role="status"><ShieldAlert size={16} aria-hidden="true" /> Current independent verification is required. Clinical actions also require an approved facility privilege.</div>
                )}
                {detail.credentials.length === 0 && <p className="muted">No professional qualification is recorded. New clinical work remains blocked until credentials and privileges are approved.</p>}
                {detail.credentials.length > 0 && (
                  <table className="mini-table">
                    <thead><tr><th>Number</th><th>Issued by</th><th>Valid</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {detail.credentials.map((c) => (
                        <tr key={c.id}>
                          <td className="mono">{c.identifier}</td>
                          <td>{c.issuing_body}</td>
                          <td className="tabular">{fmt(c.valid_from)} – {c.valid_to ? fmt(c.valid_to) : 'open'}</td>
                          <td>
                            {c.status === 'current' ? <span className="status status-success"><BadgeCheck size={12} aria-hidden="true" /> Verified and current</span> : <span className="status status-warning">Review required</span>}
                            {' '}<span className="muted">{c.status}</span>
                          </td>
                          <td className="text-right">
                            {canEdit && c.status === 'current' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => endCredential(c)}><CircleSlash size={14} aria-hidden="true" /> End</button>}
                            {canEdit && c.status === 'unverified' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setVerification({id:c.id,reference:'',reason:''})}>Review verification</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {verification && <form className="stack" onSubmit={e => {e.preventDefault(); command.send(`/practitioners/${selected}/credentials/${verification.id}/verify`, {reference:verification.reference,reason:verification.reason}).then(confirmed);}}>
                  <p>The verifier must differ from the practitioner and the person who recorded the qualification.</p>
                  <label>Verification evidence reference<input className="form-input" required minLength={3} maxLength={256} disabled={busy} value={verification.reference} onChange={e => setVerification({...verification,reference:e.target.value})} /></label>
                  <label>Verification reason<textarea className="form-input" required minLength={10} maxLength={500} disabled={busy} value={verification.reason} onChange={e => setVerification({...verification,reason:e.target.value})} /></label>
                  <button className="btn btn-primary" disabled={busy}>Confirm independent verification</button>
                </form>}
                {canEdit && (
                  <form onSubmit={addCredential} className="split-2">
                    <label>Professional qualification kind<select className="form-input" disabled={busy} value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>
                      {['medical_registration','specialist_registration','nursing_registration','pharmacy_registration','laboratory_qualification','other'].map(kind=><option key={kind} value={kind}>{kind.replaceAll('_',' ')}</option>)}
                    </select></label>
                    <div className="form-group"><label className="form-label" htmlFor="pr-id">Registration number</label>
                      <input id="pr-id" className="form-input" disabled={busy} required maxLength={80} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-body">Issued by (council)</label>
                      <input id="pr-body" className="form-input" disabled={busy} required maxLength={120} value={form.issuingBody} onChange={(e) => setForm({ ...form, issuingBody: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-from">Valid from</label>
                      <input id="pr-from" className="form-input" disabled={busy} type="date" required value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-to">Valid to (blank if open)</label>
                      <input id="pr-to" className="form-input" disabled={busy} type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></div>
                    <button type="submit" className="btn btn-primary btn-md" disabled={busy}>Record registration</button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
