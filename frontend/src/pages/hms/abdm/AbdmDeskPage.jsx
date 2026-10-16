import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, Link2, QrCode } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import IntegrationReadinessPanel from './IntegrationReadinessPanel';
import PatientPicker from './PatientPicker';
import { useAuth } from '../../../context/AuthContext';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const STATUS = { Verified: 'status-success', Linked: 'status-success', Mismatch: 'status-warning', Conflict: 'status-warning', Linking: 'status-info', OtpSent: 'status-info', Failed: 'status-danger', Expired: 'status-neutral', NotLinked: 'status-neutral' };
const err = (e, fallback) => toast.error(e.response?.data?.message || fallback, { duration: 8000 });

// ABDM at the front desk (Phase 6C/6D): verify or create a patient's ABHA
// with ABDM, take profiles patients share from their ABHA app, and make
// finished visits available to the patient's ABHA.
export default function AbdmDeskPage() {
  const { user } = useAuth();
  const [patient, setPatient] = useState(null);
  const [abha, setAbha] = useState(null);
  const [visits, setVisits] = useState([]);
  const [contexts, setContexts] = useState([]);
  const [shares, setShares] = useState([]);
  const [form, setForm] = useState({ purpose: 'verify', method: 'abha_otp', loginHint: '', aadhaar: '' });
  const [pending, setPending] = useState(null);
  const [otp, setOtp] = useState('');
  const [mobile, setMobile] = useState('');
  const [chosen, setChosen] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadShares = useCallback(async () => {
    try { setShares((await api.get('/abdm/shares')).data.data); } catch (e) { err(e, 'Could not load shared profiles.'); }
  }, []);
  const loadPatient = useCallback(async () => {
    if (!patient) return;
    try {
      const [a, v, c] = await Promise.all([api.get(`/abdm/patients/${patient.id}/abha`), api.get(`/patients/hms/${patient.id}/visits`), api.get(`/abdm/patients/${patient.id}/care-contexts`)]);
      setAbha(a.data.data); setVisits((v.data.data || []).filter((x) => x.type !== 'Lab Test' && x.status === 'Finalized')); setContexts(c.data.data);
    } catch (e) { err(e, 'Could not load the patient.'); }
  }, [patient]);
  useEffect(() => { loadShares(); }, [loadShares]);
  useEffect(() => { setAbha(null); setVisits([]); setContexts([]); setPending(null); setChosen([]); loadPatient(); }, [loadPatient]);

  const run = async (fn) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const sendOtp = (e) => { e.preventDefault(); run(async () => {
    try {
      const r = await api.post(`/abdm/patients/${patient.id}/abha/otp`, form);
      setPending(r.data.data); setOtp(''); toast.success('OTP sent by ABDM to the patient.');
    } catch (x) { err(x, 'ABDM could not send the OTP.'); }
  }); };
  const verify = (e) => { e.preventDefault(); run(async () => {
    try {
      const r = (await api.post(`/abdm/abha/verifications/${pending.id}/verify`, { otp, mobile: mobile || undefined })).data.data;
      setPending(null);
      if (r.status === 'Verified') toast.success('ABHA verified with ABDM.');
      else if (r.status === 'Mismatch') toast.error(`Not attached: ABDM details differ (${(r.differences || []).map((d) => d.field).join(', ')}). It is on the worklist.`, { duration: 10000 });
      else toast.error('Not attached: this ABHA is already on another chart. Both are in possible duplicates.', { duration: 10000 });
      loadPatient();
    } catch (x) { err(x, 'Could not verify the OTP.'); }
  }); };
  const linkVisits = () => run(async () => {
    try { await api.post(`/abdm/patients/${patient.id}/care-contexts/link`, { encounterIds: chosen }); toast.success('Sent to ABDM. The visits show as linked when ABDM confirms.'); setChosen([]); loadPatient(); }
    catch (x) { err(x, 'Could not link the visits.'); }
  });
  const handleShare = (s, action) => run(async () => {
    try {
      const r = (await api.post(`/abdm/shares/${s.id}/${action}`, action === 'link' ? { patientId: patient?.id } : {})).data.data;
      if (action === 'link' && r.status !== 'Linked') toast.error(r.status === 'Mismatch' ? 'Details differ from the chart; not linked.' : 'This ABHA is on another chart; not linked.', { duration: 9000 });
      else toast.success(action === 'link' ? 'Profile linked to the chart.' : 'Dismissed.');
      loadShares(); loadPatient();
    } catch (x) { err(x, 'That did not work.'); }
  });

  const verified = abha?.verified?.number;
  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="ABDM" description="Verify ABHA with ABDM, take profiles shared at the counter, and make finished visits available to the patient's ABHA." />
        {['super_admin', 'admin'].includes(user?.role) && <IntegrationReadinessPanel />}

        <section className="panel" aria-label="Shared at the counter">
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><QrCode size={16} aria-hidden="true" /> Shared at the counter</h2></div>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>Token</th><th>Name in ABHA</th><th>ABHA</th><th>Received</th><th /></tr></thead>
              <tbody>
                {!shares.length && <tr><td colSpan={5} className="cell-secondary">No one is waiting.</td></tr>}
                {shares.map((s) => (
                  <tr key={s.id}>
                    <td className="tabular"><strong>{s.token_number}</strong></td>
                    <td>{s.profile?.name}<div className="cell-secondary">{s.profile?.gender} · born {s.profile?.yearOfBirth}</div></td>
                    <td className="mono">{s.abha_address}<div className="cell-secondary">{s.abha_number}</div></td>
                    <td className="cell-secondary">{when(s.received_at)}</td>
                    <td><span className="inline-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !patient} title={patient ? '' : 'Choose the chart below first'} onClick={() => handleShare(s, 'link')}>Link to {patient ? (patient.name || patient.patient_name) : 'chosen patient'}</button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => handleShare(s, 'dismiss')}>Dismiss</button>
                    </span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel panel-pad stack-sm" aria-label="Patient" style={{ marginTop: 16 }}>
          <PatientPicker value={patient} onChange={setPatient} />
          {patient && abha && (
            <>
              <h2 className="panel-title"><BadgeCheck size={16} aria-hidden="true" /> ABHA</h2>
              {verified
                ? <p><span className="status status-success">Verified by ABDM</span> <span className="mono">{verified}</span> {abha.verified.address && <span className="mono cell-secondary">· {abha.verified.address}</span>}</p>
                : <p className="cell-secondary">No ABHA verified by ABDM. A number typed in registration is not verified until ABDM confirms it here.</p>}
              {!pending ? (
                <form onSubmit={sendOtp} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
                  <div className="form-group"><label className="form-label" htmlFor="ab-purpose">What to do</label>
                    <select id="ab-purpose" className="form-select" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value, method: e.target.value === 'enrol' ? 'aadhaar_otp' : 'abha_otp' })}>
                      <option value="verify">Verify an existing ABHA</option><option value="enrol">Create a new ABHA (Aadhaar OTP)</option>
                    </select></div>
                  {form.purpose === 'verify' ? (
                    <>
                      <div className="form-group"><label className="form-label" htmlFor="ab-method">OTP to</label>
                        <select id="ab-method" className="form-select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                          <option value="abha_otp">Mobile linked to the ABHA</option><option value="aadhaar_otp">Aadhaar-linked mobile</option><option value="mobile_otp">Mobile number (find ABHA)</option>
                        </select></div>
                      <div className="form-group"><label className="form-label" htmlFor="ab-hint">{form.method === 'mobile_otp' ? 'Mobile number' : 'ABHA number or address'}</label>
                        <input id="ab-hint" className="form-input" required value={form.loginHint} onChange={(e) => setForm({ ...form, loginHint: e.target.value })} /></div>
                    </>
                  ) : (
                    <div className="form-group"><label className="form-label" htmlFor="ab-aadhaar">Aadhaar number (not stored)</label>
                      <input id="ab-aadhaar" className="form-input" inputMode="numeric" pattern="\d{12}" required autoComplete="off" value={form.aadhaar} onChange={(e) => setForm({ ...form, aadhaar: e.target.value.replace(/\D/g, '').slice(0, 12) })} /></div>
                  )}
                  <button type="submit" className="btn btn-primary btn-md" disabled={busy}>Send OTP</button>
                </form>
              ) : (
                <form onSubmit={verify} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
                  <div className="form-group"><label className="form-label" htmlFor="ab-otp">OTP the patient received</label>
                    <input id="ab-otp" className="form-input" inputMode="numeric" pattern="\d{6}" required autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} /></div>
                  {pending && form.purpose === 'enrol' && <div className="form-group"><label className="form-label" htmlFor="ab-mobile">Mobile for the new ABHA</label><input id="ab-mobile" className="form-input" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>}
                  <span className="inline-actions"><button type="submit" className="btn btn-primary btn-md" disabled={busy}>Verify</button>
                    <button type="button" className="btn btn-secondary btn-md" onClick={() => setPending(null)}>Cancel</button></span>
                </form>
              )}
              {!!abha.verifications?.length && (
                <details><summary className="cell-secondary">Earlier attempts ({abha.verifications.length})</summary>
                  <ul className="stack-sm" style={{ paddingLeft: 16 }}>{abha.verifications.map((v) => (
                    <li key={v.id}><span className={`status ${STATUS[v.status] || 'status-neutral'}`}>{v.status}</span> {v.purpose} · {v.login_hint} · {when(v.requested_at)}
                      {v.differences && <span className="cell-secondary"> — differs: {v.differences.map((d) => `${d.field} (chart ${d.chart}, ABDM ${d.abdm})`).join('; ')}</span>}</li>))}</ul>
                </details>
              )}

              <h2 className="panel-title"><Link2 size={16} aria-hidden="true" /> Visits available to the ABHA</h2>
              <div className="dt-scroll">
                <table className="dt-table">
                  <thead><tr><th /><th>Visit</th><th>Records</th><th>Status</th></tr></thead>
                  <tbody>
                    {!visits.length && <tr><td colSpan={4} className="cell-secondary">No finished visits.</td></tr>}
                    {visits.map((v) => {
                      const id = v.reference_id;
                      const cc = contexts.find((c) => c.encounter_id === id);
                      return (
                        <tr key={id}>
                          <td><input type="checkbox" aria-label={`Link visit ${id}`} disabled={!verified || cc?.link_status === 'Linked' || cc?.link_status === 'Linking'} checked={chosen.includes(id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, id] : chosen.filter((x) => x !== id))} /></td>
                          <td>{cc?.display || `Visit ${id}`}<div className="cell-secondary">{when(v.date)} · {v.doctor}</div></td>
                          <td className="cell-secondary">{cc ? cc.hi_types.join(', ') : '—'}</td>
                          <td><span className={`status ${STATUS[cc?.link_status || 'NotLinked']}`}>{cc?.link_status || 'Not linked'}</span>{cc?.last_error && <div className="cell-secondary">{cc.last_error}</div>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div><button type="button" className="btn btn-primary btn-sm" disabled={busy || !chosen.length || !verified} onClick={linkVisits}>Link {chosen.length || ''} visit{chosen.length === 1 ? '' : 's'} to the ABHA</button></div>
            </>
          )}
        </section>
      </main>
    </>
  );
}
