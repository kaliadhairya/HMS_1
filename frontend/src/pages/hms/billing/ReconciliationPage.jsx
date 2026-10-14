import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, CircleCheck, CircleX, Landmark, ShieldAlert } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { inr } from '../../../components/billing/InvoicePaper';
import { useAuth } from '../../../context/AuthContext';
import { localYmd } from '../../../utils/localDate';

const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const KIND_LABEL = {
  unknown_payment: 'Payment outcome unknown', stale_pending_payment: 'Payment pending too long', cash_variance: 'Cash count differs',
  unmatched_settlement: 'Settlement with no matching receipt', unsettled_receipt: 'Receipt not settled by the bank', settlement_amount_mismatch: 'Settlement amount differs',
  journal_imbalance: 'Journal and ledgers disagree', fund_overused: 'Deposit used beyond its amount', invoice_overpaid: 'Invoice overpaid',
  uninvoiced_charges: 'Charges not invoiced after the episode ended', uncredited_reversal: 'Cancelled charge waiting for its credit note',
  receipt_unposted: 'Receipt missing from the journal', refund_unconfirmed: 'Refund not confirmed', claim_unpaid: 'Approved claim not paid',
};

// Reconciliation (Phase 5): the cashier's drawer, statement lines from the
// bank, card/UPI provider and payers, and the checks that compare receipts,
// deposits, receivables and the journal. Every problem becomes an owned
// exception that is resolved with a note.
export default function ReconciliationPage() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [drawer, setDrawer] = useState(null);
  const [checks, setChecks] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [status, setStatus] = useState('Open');
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState({ counted: '', note: '' });
  const [line, setLine] = useState({ source: 'card', statementReference: '', providerReference: '', amount: '', settledOn: localYmd() });

  const load = useCallback(async () => {
    try {
      const d = await api.get('/finance/cash-sessions/current');
      setDrawer(d.data.data);
      if (isAdmin) setExceptions((await api.get(`/finance/reconciliation/exceptions?status=${status}`)).data.data);
    } catch (err) { toast.error(err.response?.data?.message || 'Could not load reconciliation.'); }
  }, [status, isAdmin]);
  useEffect(() => { load(); }, [load]);

  const act = async (request, success, after) => {
    if (busy) return;
    setBusy(true);
    try { const r = await request(); toast.success(success); if (after) after(r.data.data); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Reconciliation" description="Cash drawer, bank and provider settlements, and checks of every receipt, deposit and receivable against the journal." />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
          <section className="panel panel-pad stack-sm" aria-label="Cash drawer">
            <h2 className="panel-title"><Banknote size={16} aria-hidden="true" /> My cash drawer</h2>
            {drawer?.open === false ? (
              <form onSubmit={(e) => { e.preventDefault(); act(() => api.post('/finance/cash-sessions', { openingFloat: Number(count.counted || 0) }), 'Drawer opened'); }} className="stack-sm">
                <div className="form-group"><label className="form-label" htmlFor="float">Opening float (₹)</label>
                  <input id="float" className="form-input" type="number" min="0" step="0.01" value={count.counted} onChange={(e) => setCount({ ...count, counted: e.target.value })} /></div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Open drawer</button>
              </form>
            ) : drawer && (
              <>
                <p>Open since {fmt(drawer.opened_at)} · float {inr(drawer.opening_float)} · {drawer.receipts.length} cash receipts · {drawer.refunds.length} cash refunds</p>
                <p><strong>Expected in the drawer: {inr(drawer.expected_now)}</strong></p>
                <form onSubmit={(e) => { e.preventDefault(); act(() => api.post(`/finance/cash-sessions/${drawer.id}/close`, { countedCash: Number(count.counted), note: count.note || undefined }), 'Drawer closed', () => setCount({ counted: '', note: '' })); }} className="stack-sm">
                  <div className="form-group"><label className="form-label" htmlFor="counted">Cash counted (₹)</label>
                    <input id="counted" className="form-input" type="number" min="0" step="0.01" required value={count.counted} onChange={(e) => setCount({ ...count, counted: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label" htmlFor="count-note">Note (needed if the count differs)</label>
                    <input id="count-note" className="form-input" value={count.note} onChange={(e) => setCount({ ...count, note: e.target.value })} /></div>
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Count and close</button>
                </form>
              </>
            )}
          </section>

          {isAdmin && <section className="panel panel-pad stack-sm" aria-label="Settlement line">
            <h2 className="panel-title"><Landmark size={16} aria-hidden="true" /> Statement line</h2>
            <form className="stack-sm" onSubmit={(e) => {
              e.preventDefault();
              act(() => api.post('/finance/settlements', { ...line, amount: Number(line.amount) }), 'Statement line recorded', (r) => toast(r.matched ? 'Matched to its receipt.' : 'Not matched: an exception was opened.'));
            }}>
              <div className="form-group"><label className="form-label" htmlFor="st-src">Source</label>
                <select id="st-src" className="form-select" value={line.source} onChange={(e) => setLine({ ...line, source: e.target.value })}>
                  <option value="card">Card provider</option><option value="upi">UPI provider</option><option value="bank">Bank</option><option value="payer">Insurance payer</option>
                </select></div>
              <div className="form-group"><label className="form-label" htmlFor="st-ref">Statement reference</label>
                <input id="st-ref" className="form-input" required value={line.statementReference} onChange={(e) => setLine({ ...line, statementReference: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="st-pref">Transaction or remittance reference</label>
                <input id="st-pref" className="form-input" value={line.providerReference} onChange={(e) => setLine({ ...line, providerReference: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="st-amt">Amount (₹)</label>
                <input id="st-amt" className="form-input" type="number" min="0.01" step="0.01" required value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="st-date">Settled on</label>
                <input id="st-date" className="form-input" type="date" required value={line.settledOn} onChange={(e) => setLine({ ...line, settledOn: e.target.value })} /></div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Record and match</button>
            </form>
          </section>}
        </div>

        {isAdmin && <section className="panel" style={{ marginTop: 16 }} aria-label="Checks">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><ShieldAlert size={16} aria-hidden="true" /> Checks</h2>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => api.post('/finance/reconciliation/run', {}), 'Checks run', setChecks)}>Run checks now</button>
          </div>
          {checks && (
            <div className="panel-pad">
              <table className="mini-table">
                <thead><tr><th>Ledger</th><th>Subledger</th><th>Journal</th><th>Agrees</th></tr></thead>
                <tbody>
                  {checks.comparisons.map((c) => (
                    <tr key={c.name}><td>{c.name}</td><td className="tabular">{inr(c.ledger)}</td><td className="tabular">{inr(c.journal)}</td>
                      <td>{c.ok ? <span className="status status-success"><CircleCheck size={12} aria-hidden="true" /> Yes</span> : <span className="status status-danger"><CircleX size={12} aria-hidden="true" /> No</span>}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="form-hint">{checks.found.length} problem{checks.found.length === 1 ? '' : 's'} found now; new ones are added to the exceptions below. The checks also run on their own every 15 minutes.</p>
            </div>
          )}
          <div className="tabs" role="tablist" aria-label="Exception status" style={{ padding: '0 16px' }}>
            {['Open', 'Resolved'].map((s) => <button key={s} type="button" role="tab" aria-selected={status === s} className={`tab${status === s ? ' is-active' : ''}`} onClick={() => setStatus(s)}>{s}</button>)}
          </div>
          <div className="panel-pad">
            {exceptions.length === 0 ? <EmptyState icon={CircleCheck} title={status === 'Open' ? 'No open exceptions' : 'None resolved yet'} description="Problems found by the checks appear here." /> : (
              <div className="dt-scroll">
                <table className="dt-table">
                  <thead><tr><th>Found</th><th>Problem</th><th>Details</th><th>Owner</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {exceptions.map((e) => (
                      <tr key={e.id}>
                        <td>{fmt(e.opened_at)}</td>
                        <td>{KIND_LABEL[e.kind] || e.kind}</td>
                        <td className="cell-secondary" style={{ maxWidth: 380 }}>{Object.entries(e.details || {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                        <td>{e.owner_name || '—'}{e.resolution ? <div className="cell-secondary">{e.resolution} ({e.resolved_by_name})</div> : null}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {e.status === 'Open' && (
                            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                              const resolution = window.prompt('How was it resolved? (at least 5 characters)');
                              if (resolution && resolution.trim().length >= 5) act(() => api.post(`/finance/reconciliation/exceptions/${e.id}/resolve`, { resolution }), 'Exception resolved');
                            }}>Resolve</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>}
      </main>
    </>
  );
}
