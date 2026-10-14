import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FileInput, Send } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { useAuth } from '../../../context/AuthContext';
import PatientPicker from './PatientPicker';

const PURPOSES = [['CAREMGT', 'Care management'], ['BTG', 'Emergency (break the glass)'], ['PATRQT', 'Requested by the patient'], ['PUBHLTH', 'Public health'], ['HPAYMT', 'Payment'], ['DSRCH', 'Research']];
const TYPES = ['OPConsultation', 'Prescription', 'DiagnosticReport', 'DischargeSummary', 'ImmunizationRecord', 'HealthDocumentRecord', 'WellnessRecord'];
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const err = (e, fallback) => toast.error(e.response?.data?.message || fallback, { duration: 8000 });

// Records from other facilities through ABDM (Phase 6E). The doctor asks for
// them with the patient's consent; what arrives is outside information to
// review. Accepting an item records that it was reviewed and is relevant; it
// never creates a local order or allergy.
export default function OutsideRecordsPage() {
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  const [requests, setRequests] = useState([]);
  const [imports, setImports] = useState([]);
  const [form, setForm] = useState({ purpose: 'CAREMGT', hiTypes: ['OPConsultation', 'Prescription', 'DiagnosticReport'], from: day(-365), to: day(0), expiresAt: day(7) });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!patient) return;
    try {
      const [r, i] = await Promise.all([api.get(`/abdm/patients/${patient.id}/consent-requests`), api.get(`/abdm/patients/${patient.id}/imports`)]);
      setRequests(r.data.data); setImports(i.data.data);
    } catch (e) { err(e, 'Could not load outside records.'); }
  }, [patient]);
  useEffect(() => { setRequests([]); setImports([]); load(); }, [load]);

  const run = async (fn, ok) => { if (busy) return; setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { err(e, 'That did not work.'); } finally { setBusy(false); } };
  const decide = (item, decision) => {
    const note = decision === 'Seen' ? undefined : window.prompt(`${decision === 'Accepted' ? 'Accept' : 'Reject'}: why? (kept with the record)`);
    if (decision !== 'Seen' && (!note || note.trim().length < 3)) return;
    run(() => api.post(`/abdm/import-items/${item.id}/decision`, { decision, note }), `Marked ${decision.toLowerCase()}`);
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Outside records" description="Records from other facilities through ABDM, with the patient's consent. They are shown as outside information and never become local orders or allergies by themselves." />
        <section className="panel panel-pad stack-sm" aria-label="Patient"><PatientPicker value={patient} onChange={setPatient} /></section>

        {patient && (
          <>
            <section className="panel panel-pad stack-sm" aria-label="Ask for records" style={{ marginTop: 16 }}>
              <h2 className="panel-title"><Send size={16} aria-hidden="true" /> Ask for records</h2>
              <p className="cell-secondary">The patient approves the request in their ABHA app. Records arrive only for what they approve, and are erased when the consent ends.</p>
              <form onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/abdm/patients/${patient.id}/consent-requests`, { ...form, from: new Date(form.from).toISOString(), to: new Date(`${form.to}T23:59:59`).toISOString(), expiresAt: new Date(`${form.expiresAt}T23:59:59`).toISOString() }), 'Request sent to the patient through ABDM'); }}
                style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
                <div className="form-group"><label className="form-label" htmlFor="or-purpose">Purpose</label>
                  <select id="or-purpose" className="form-select" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div className="form-group"><label className="form-label" htmlFor="or-from">Records from</label><input id="or-from" type="date" className="form-input" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="or-to">to</label><input id="or-to" type="date" className="form-input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="or-exp">Access until</label><input id="or-exp" type="date" className="form-input" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></div>
                <fieldset className="form-group" style={{ gridColumn: '1 / -1', border: 0, padding: 0, margin: 0 }}>
                  <legend className="form-label">Record types</legend>
                  <div className="inline-actions" style={{ flexWrap: 'wrap' }}>{TYPES.map((t) => (
                    <label key={t} className="cell-secondary"><input type="checkbox" checked={form.hiTypes.includes(t)} onChange={(e) => setForm({ ...form, hiTypes: e.target.checked ? [...form.hiTypes, t] : form.hiTypes.filter((x) => x !== t) })} /> {t.replace(/([a-z])([A-Z])/g, '$1 $2')}</label>
                  ))}</div>
                </fieldset>
                <button type="submit" className="btn btn-primary btn-md" disabled={busy || !form.hiTypes.length}>Send request</button>
              </form>
              {!!requests.length && (
                <ul className="stack-sm" style={{ paddingLeft: 16 }}>{requests.map((r) => (
                  <li key={r.id}><span className={`status ${r.status === 'Granted' ? 'status-success' : ['Denied', 'Revoked', 'Expired', 'Failed'].includes(r.status) ? 'status-neutral' : 'status-info'}`}>{r.status}</span> {r.purpose} · {r.hi_types.join(', ')} · asked {when(r.requested_at)}</li>
                ))}</ul>
              )}
            </section>

            <section className="panel" aria-label="Received records" style={{ marginTop: 16 }}>
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><FileInput size={16} aria-hidden="true" /> Received</h2></div>
              {!imports.length && <p className="panel-pad cell-secondary">Nothing received yet.</p>}
              {imports.map((imp) => (
                <div key={imp.id} className="panel-pad" style={{ borderTop: '1px solid var(--border)' }}>
                  <p><strong>From {imp.source_hip || 'another facility'}</strong> <span className="cell-secondary">· {imp.care_context_ref} · received {when(imp.received_at)}</span>{' '}
                    {imp.status === 'Withdrawn' && <span className="status status-neutral">Withdrawn {when(imp.withdrawn_at)}: consent ended, records erased</span>}</p>
                  {imp.status === 'Available' && (
                    <table className="dt-table">
                      <tbody>{imp.items.map((it) => (
                        <tr key={it.id}>
                          <td>{it.needs_review && <span className="status status-warning">Review</span>} {it.summary}</td>
                          <td>{it.decision ? <span className="cell-secondary">{it.decision}{it.decision_note ? `: ${it.decision_note}` : ''}</span>
                            : user?.role === 'doctor' && (
                              <span className="inline-actions">
                                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide(it, 'Accepted')}>Relevant</button>
                                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => decide(it, 'Rejected')}>Not relevant</button>
                                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => decide(it, 'Seen')}>Seen</button>
                              </span>)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </>
  );
}
