import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ShieldPlus } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import AccountWorkspace from '../../../components/billing/AccountWorkspace';
import { inr } from '../../../components/billing/InvoicePaper';
import { useAuth } from '../../../context/AuthContext';

const EMPTY_COVERAGE = { payerId: '', policyNumber: '', memberId: '', validFrom: '', validTo: '' };

// Insurance for one account: the patient's coverage, eligibility, the
// pre-authorisation and its decisions, and which payer shares the bills.
function InsurancePanel({ account, onChanged }) {
  const { user } = useAuth();
  const [payers, setPayers] = useState([]);
  const [coverages, setCoverages] = useState([]);
  const [preauths, setPreauths] = useState([]);
  const [form, setForm] = useState(EMPTY_COVERAGE);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c, pa] = await Promise.all([
        api.get('/finance/payers'), api.get(`/finance/coverages?patientId=${account.patient_id}`), api.get(`/finance/accounts/${account.id}/preauthorizations`),
      ]);
      setPayers(p.data.data); setCoverages(c.data.data); setPreauths(pa.data.data);
    } catch { /* the account page still works without insurance */ }
  }, [account.id, account.patient_id]);
  useEffect(() => { load(); }, [load]);

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try { await request(); toast.success(success); await load(); onChanged?.(); }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); }
    finally { setBusy(false); }
  };
  const ask = (q) => { const v = window.prompt(q); return v && v.trim() ? v.trim() : null; };

  return (
    <section className="panel panel-pad stack-sm" aria-label="Insurance">
      <h2 className="panel-title"><ShieldPlus size={16} aria-hidden="true" /> Insurance</h2>
      {coverages.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>{c.payer_name} · policy <span className="mono">{c.policy_number}</span> · member {c.member_id} · {c.valid_from?.slice(0, 10)} to {c.valid_to?.slice(0, 10)}</span>
          <span className="cell-secondary">{c.last_eligibility ? `Eligibility: ${c.last_eligibility.outcome}` : 'Eligibility not checked'}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const outcome = ask('Eligibility answer from the payer: Eligible, NotEligible or Unknown');
            if (outcome) act(() => api.post(`/finance/coverages/${c.id}/eligibility`, { outcome, accountId: account.id, responseReference: ask('Payer response reference (optional)') || undefined }), 'Eligibility recorded');
          }}>Record eligibility</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const amount = Number(window.prompt('Amount to request for pre-authorisation (₹):'));
            if (amount > 0) act(() => api.post(`/finance/accounts/${account.id}/preauthorizations`, { coverageId: c.id, requestedAmount: amount }), 'Pre-authorisation requested');
          }}>Request pre-authorisation</button>
        </div>
      ))}
      {preauths.map((pa) => (
        <div key={pa.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Pre-authorisation: {inr(pa.requested_amount)} requested · <strong>{pa.status}</strong>{Number(pa.approved_amount) > 0 ? ` · ${inr(pa.approved_amount)} approved` : ''} · revision {pa.revision}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const status = ask("Payer's decision: Approved, PartiallyApproved, Denied, Cancelled, or Requested (enhancement)");
            if (!status) return;
            const approvedAmount = ['Approved', 'PartiallyApproved'].includes(status) ? Number(window.prompt('Approved amount (₹):')) : undefined;
            const requestedAmount = status === 'Requested' ? Number(window.prompt('New amount requested (₹):')) : undefined;
            const payerReference = ['Approved', 'PartiallyApproved', 'Denied'].includes(status) ? ask("Payer's reference for the decision:") : undefined;
            act(() => api.post(`/finance/preauthorizations/${pa.id}/decision`, { status, approvedAmount, requestedAmount, payerReference }), 'Decision recorded');
          }}>Record decision</button>
          {['Approved', 'PartiallyApproved'].includes(pa.status) && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
              const copayPercent = Number(window.prompt('Patient co-pay (%):', '0'));
              if (copayPercent >= 0) act(() => api.put(`/finance/accounts/${account.id}/payer`, { coverageId: pa.coverage_id, preauthId: pa.id, copayPercent }), 'Payer set for this account');
            }}>Bill this payer</button>
          )}
        </div>
      ))}
      <form className="stack-sm" onSubmit={(e) => {
        e.preventDefault();
        act(() => api.post('/finance/coverages', { ...form, patientId: account.patient_id }), 'Coverage added').then(() => setForm(EMPTY_COVERAGE));
      }}>
        <h3 className="panel-subtitle">Add coverage</h3>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div className="form-group"><label className="form-label" htmlFor="cv-payer">Payer</label>
            <select id="cv-payer" className="form-select" required value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })}>
              <option value="">Choose…</option>{payers.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="form-group"><label className="form-label" htmlFor="cv-policy">Policy number</label>
            <input id="cv-policy" className="form-input" required value={form.policyNumber} onChange={(e) => setForm({ ...form, policyNumber: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="cv-member">Member ID</label>
            <input id="cv-member" className="form-input" required value={form.memberId} onChange={(e) => setForm({ ...form, memberId: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="cv-from">Valid from</label>
            <input id="cv-from" className="form-input" type="date" required value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="cv-to">Valid to</label>
            <input id="cv-to" className="form-input" type="date" required value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></div>
        </div>
        <button type="submit" className="btn btn-secondary btn-sm" disabled={busy || !payers.length}>Add coverage</button>
        {!payers.length && <p className="form-hint">{['super_admin', 'admin'].includes(user?.role) ? 'Add the payer on the Price list page first.' : 'An administrator adds payers.'}</p>}
      </form>
    </section>
  );
}

export default function BillingAccountPage() {
  const { accountId } = useParams();
  const [account, setAccount] = useState(null);
  const [version, setVersion] = useState(0);
  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title={account ? `${account.patient_name} · ${account.account_number}` : 'Billing account'}
          description={account ? `${account.episode_type === 'admission' ? `Admission ${account.admission_id}` : `OPD visit ${account.encounter_id}`} · UHID ${account.uhid}` : ''}
        />
        <AccountWorkspace key={version} accountId={accountId} onLoaded={setAccount} />
        {account && <div style={{ marginTop: 16 }}><InsurancePanel account={account} onChanged={() => setVersion((v) => v + 1)} /></div>}
      </main>
    </>
  );
}
