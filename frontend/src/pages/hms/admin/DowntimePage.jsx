import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CloudOff, FileClock } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { useAuth } from '../../../context/AuthContext';
import WardMachinesPanel from './WardMachinesPanel';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const KINDS = [['order', 'Order'], ['administration', 'Dose given'], ['specimen', 'Specimen'], ['receipt', 'Payment receipt'], ['temporary_identity', 'Temporary identity'], ['other', 'Other']];
const nowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };

// Downtime (Phase 6I): the emergency summary kit, and getting paper records
// back into the system afterwards, each entered and then checked by someone
// else before the downtime can be closed.
export default function DowntimePage() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [status, setStatus] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [entry, setEntry] = useState({ kind: 'administration', patientId: '', paperReference: '', occurredAt: nowLocal(), summary: '' });
  const [busy, setBusy] = useState(false);
  const [kitVersion, setKitVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.get('/downtime/status'), api.get('/downtime/episodes')]);
      setStatus(s.data.data); setEpisodes(e.data.data);
    } catch (err) { toast.error(err.response?.data?.message || 'Could not load downtime.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { if (busy) return; setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); } catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 9000 }); } finally { setBusy(false); } };

  const open = status?.episode;
  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Downtime" description="Emergency summaries for when the system is unavailable, and entering paper records afterwards." />

        <section className="panel panel-pad stack-sm" aria-label="Downtime kit">
          <h2 className="panel-title"><FileClock size={16} aria-hidden="true" /> Emergency summary kit</h2>
          {!status ? null : !status.configured ? <p className="status status-warning">Not set up: DOWNTIME_KIT_DIR and DOWNTIME_KIT_KEY are not configured on the server.</p> : (
            <p>
              {status.last ? <>Last made <strong>{when(status.last.generated_at)}</strong> for {status.last.patient_count} admitted patient(s). </> : 'No kit made yet. '}
              {status.stale ? <span className="status status-danger">Out of date</span> : <span className="status status-success">Current</span>}
              <span className="cell-secondary"> · refreshed every {status.refresh_minutes} minutes; ward machines keep copies and open them with downtime-opener.html and the kit key.</span>
            </p>
          )}
          {isAdmin && status?.configured && <span className="inline-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => api.post('/downtime/snapshots', {}), 'Kit refreshed').then(() => setKitVersion((v) => v + 1))}>Refresh now</button>
          </span>}
        </section>

        {isAdmin && status?.configured && <WardMachinesPanel refreshKey={kitVersion} />}

        <section className="panel panel-pad stack-sm" aria-label="Current downtime" style={{ marginTop: 16 }}>
          <h2 className="panel-title"><CloudOff size={16} aria-hidden="true" /> {open ? (open.ended_at ? 'Downtime ended — paper records to enter' : 'DOWNTIME IN PROGRESS') : 'No downtime'}</h2>
          {isAdmin && !open && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => {
            const reason = window.prompt('Why is the system unavailable? (kept with the downtime record)');
            if (reason && reason.trim().length >= 5) run(() => api.post('/downtime/episodes', { reason }), 'Downtime declared');
          }}>Declare downtime</button>}
          {open && (
            <>
              <p className="cell-secondary">Started {when(open.started_at)}{open.ended_at ? `, ended ${when(open.ended_at)}` : ''}. Reason: {open.reason}</p>
              {isAdmin && !open.ended_at && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => { if (window.confirm('End the downtime? Paper records must then be entered and checked.')) run(() => api.post(`/downtime/episodes/${open.id}/end`, {}), 'Downtime ended'); }}>End downtime</button>}
              <form onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/downtime/episodes/${open.id}/entries`, { ...entry, patientId: entry.patientId ? Number(entry.patientId) : undefined, occurredAt: new Date(entry.occurredAt).toISOString() }), 'Paper record logged').then(() => setEntry({ ...entry, paperReference: '', summary: '' })); }}
                style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
                <h3 className="panel-subtitle" style={{ gridColumn: '1 / -1' }}>Log a paper record</h3>
                <div className="form-group"><label className="form-label" htmlFor="dt-kind">Kind</label><select id="dt-kind" className="form-select" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="form-group"><label className="form-label" htmlFor="dt-pt">Patient ID</label><input id="dt-pt" className="form-input" inputMode="numeric" value={entry.patientId} onChange={(e) => setEntry({ ...entry, patientId: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="dt-ref">Paper form number</label><input id="dt-ref" className="form-input" required value={entry.paperReference} onChange={(e) => setEntry({ ...entry, paperReference: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="dt-at">Time on the form</label><input id="dt-at" type="datetime-local" className="form-input" required value={entry.occurredAt} onChange={(e) => setEntry({ ...entry, occurredAt: e.target.value })} /></div>
                <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="form-label" htmlFor="dt-sum">What it records</label><input id="dt-sum" className="form-input" required value={entry.summary} onChange={(e) => setEntry({ ...entry, summary: e.target.value })} /></div>
                <button type="submit" className="btn btn-primary btn-md" disabled={busy}>Log</button>
              </form>
            </>
          )}
        </section>

        {episodes.map((ep) => (
          <section key={ep.id} className="panel" aria-label={`Downtime ${when(ep.started_at)}`} style={{ marginTop: 16 }}>
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}>{when(ep.started_at)} – {ep.ended_at ? when(ep.ended_at) : 'ongoing'} <span className="cell-secondary">({ep.declared_by_name})</span></h2>
              {ep.closed_at ? <span className="status status-success">Closed</span>
                : isAdmin && ep.ended_at && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`/downtime/episodes/${ep.id}/close`, {}), 'Downtime closed')}>Close downtime</button>}
            </div>
            <div className="dt-scroll">
              <table className="dt-table">
                <thead><tr><th>Paper record</th><th>Patient</th><th>Time</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {!(ep.entries || []).length && <tr><td colSpan={5} className="cell-secondary">No paper records logged.</td></tr>}
                  {(ep.entries || []).map((en) => (
                    <tr key={en.id}>
                      <td>{KINDS.find(([k]) => k === en.kind)?.[1]} <span className="mono">{en.paper_reference}</span><div className="cell-secondary">{en.summary}</div></td>
                      <td>{en.patient_name || '—'}</td>
                      <td className="cell-secondary">{when(en.occurred_at)}<div>logged by {en.logged_by_name}</div></td>
                      <td><span className={`status ${en.status === 'Reconciled' ? 'status-success' : en.status === 'Void' ? 'status-neutral' : 'status-warning'}`}>{en.status}</span>
                        {en.entered_as && <div className="cell-secondary">entered as {en.entered_as} by {en.entered_by_name}</div>}{en.reconciled_by_name && <div className="cell-secondary">checked by {en.reconciled_by_name}</div>}</td>
                      <td><span className="inline-actions">
                        {en.status === 'Logged' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                          const enteredAs = window.prompt('Identifier of the record you entered in the system (for a dose: the administration ID; for a temporary identity: the patient ID):');
                          if (enteredAs) run(() => api.post(`/downtime/entries/${en.id}/entered`, { enteredAs }), 'Linked');
                        }}>Entered</button>}
                        {en.status === 'Entered' && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => api.post(`/downtime/entries/${en.id}/reconcile`, {}), 'Checked')}>Check</button>}
                        {['Logged', 'Entered'].includes(en.status) && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
                          const note = window.prompt('Why is this paper record void?');
                          if (note && note.trim().length >= 5) run(() => api.post(`/downtime/entries/${en.id}/void`, { note }), 'Voided');
                        }}>Void</button>}
                      </span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
