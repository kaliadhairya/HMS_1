import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Ban, ClipboardList, CreditCard, FileCheck2, Pill, Plus, Printer, Receipt, Search, Wallet, X } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import EmptyState from '../ui/EmptyState';
import InvoicePaper, { inr } from './InvoicePaper';

const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const ADMIN = ['super_admin', 'admin'];
const DESK = [...ADMIN, 'receptionist'];
const METHODS = ['Cash', 'Card', 'UPI', 'BankTransfer', 'Cheque'];
const INVOICE_TONE = { Draft: 'neutral', Issued: 'info', PartiallyCredited: 'warning', Credited: 'neutral', Void: 'danger' };
const errorText = (err, fallback) => err.response?.data?.message || fallback;

// One episode's billing account: charges recorded as care happens, the bill
// being prepared, issued invoices, payments, deposits and refunds.
// Props: episode = { admissionId } | { encounterId }, or accountId.
export default function AccountWorkspace({ episode, accountId, medicineSearch = false, onLoaded }) {
  const { user } = useAuth();
  const isAdmin = ADMIN.includes(user?.role);
  const isDesk = DESK.includes(user?.role);
  const [acc, setAcc] = useState(null);
  const [draft, setDraft] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [discount, setDiscount] = useState({ amount: '', reason: '' });
  const [applyDeposits, setApplyDeposits] = useState(true);
  const [payment, setPayment] = useState(null);
  const [deposit, setDeposit] = useState({ amount: '', method: 'Cash', reference: '' });
  const [refund, setRefund] = useState(null);
  const [manual, setManual] = useState({ category: 'Procedure', description: '', unitPrice: '', quantity: 1, reason: '' });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState(1);

  const load = useCallback(async () => {
    try {
      const url = accountId ? `/finance/accounts/${accountId}`
        : `/finance/accounts/by-episode?${episode.admissionId ? `admissionId=${episode.admissionId}` : `encounterId=${episode.encounterId}`}`;
      const { data } = await api.get(url);
      setAcc(data.data);
      setLoadError('');
      onLoaded?.(data.data);
      const d = data.data.invoices.find((i) => i.status === 'Draft');
      if (d) setDraft((await api.get(`/finance/invoices/${d.id}`)).data.data);
      else setDraft(null);
      return data.data;
    } catch (err) {
      setLoadError(errorText(err, 'Could not load the billing account.'));
      return null;
    }
  }, [accountId, episode?.admissionId, episode?.encounterId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!medicineSearch || search.length < 2) { setResults([]); return undefined; }
    const t = setTimeout(async () => {
      try {
        const res = await api.get(`/hms/medicines/search?q=${encodeURIComponent(search)}`);
        setResults(Array.isArray(res.data) ? res.data : res.data.data || []);
      } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search, medicineSearch]);

  const act = async (request, success, after) => {
    if (busy) return null;
    setBusy(true);
    try {
      const res = await request();
      if (success) toast.success(typeof success === 'function' ? success(res.data.data) : success);
      const fresh = await load();
      if (after) await after(res.data.data, fresh);
      return res.data.data;
    } catch (err) {
      toast.error(errorText(err, 'That did not work.'), { duration: 8000 });
      if (err.response?.status === 409) await load();
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openInvoice = async (id) => {
    try { setPreview((await api.get(`/finance/invoices/${id}`)).data.data); }
    catch (err) { toast.error(errorText(err, 'Could not open the invoice.')); }
  };

  const unbilled = useMemo(() => (acc?.charges || []).filter((c) => !c.invoice_number && c.source_type !== 'reversal' && !c.reversed), [acc]);
  const wardDays = useMemo(() => (acc?.charges || []).filter((c) => c.source_type === 'ward_day' && !c.reversed), [acc]);
  const issued = (acc?.invoices || []).filter((i) => i.status !== 'Draft');
  const funds = (acc?.funds || []).filter((f) => Number(f.balance) > 0);

  if (loadError) return <section className="panel panel-pad"><p role="alert">{loadError}</p></section>;
  if (!acc) return <p className="muted">Loading billing account…</p>;

  const prepare = () => act(() => api.post(`/finance/accounts/${acc.id}/invoices/draft`), null, async (inv) => setDraft(inv));
  const issue = () => act(
    () => api.post(`/finance/invoices/${draft.id}/issue`, { revision: draft.revision, applyDeposits }),
    (inv) => `Bill generated: ${inv.invoice_number}`,
    async (inv) => { setDraft(null); setPreview(inv); },
  );
  const saveDiscount = (e) => {
    e.preventDefault();
    act(() => api.put(`/finance/invoices/${draft.id}/discount`, { amount: Number(discount.amount || 0), reason: discount.reason, revision: draft.revision }),
      'Discount applied', async (inv) => setDraft(inv));
  };
  const addMedicine = (med) => act(() => api.post(`/finance/accounts/${acc.id}/charges`, { medicineId: med.id, quantity: Number(qty) }),
    `${med.genericName} added`, async () => { setPicked(null); setQty(1); setSearch(''); setResults([]); if (draft) setDraft((await api.get(`/finance/invoices/${draft.id}`)).data.data); });
  const addManual = (e) => {
    e.preventDefault();
    act(() => api.post(`/finance/accounts/${acc.id}/charges`, { ...manual, unitPrice: Number(manual.unitPrice), quantity: Number(manual.quantity) }),
      'Charge added', async () => setManual({ category: 'Procedure', description: '', unitPrice: '', quantity: 1, reason: '' }));
  };
  const cancelCharge = (c) => {
    const reason = window.prompt(`Why is "${c.description}" cancelled? (at least 5 characters)`);
    if (reason && reason.trim().length >= 5) act(() => api.post(`/finance/charges/${c.id}/reverse`, { reason }), 'Charge cancelled');
  };
  const pay = (e) => {
    e.preventDefault();
    act(() => api.post('/finance/payments', {
      invoiceId: payment.invoiceId, amount: Number(payment.amount), method: payment.method,
      providerReference: payment.reference || undefined, outcome: payment.outcome,
    }), (r) => (r.receipt ? `Payment received: ${r.receipt.receipt_number}` : `Payment recorded as ${r.intent.state.toLowerCase()}`),
    async () => setPayment(null));
  };
  const takeDeposit = (e) => {
    e.preventDefault();
    act(() => api.post('/finance/payments', { accountId: acc.id, amount: Number(deposit.amount), method: deposit.method, providerReference: deposit.reference || undefined }),
      (r) => `Deposit received: ${r.receipt?.receipt_number || r.intent.state}`, async () => setDeposit({ amount: '', method: 'Cash', reference: '' }));
  };
  const resolvePayment = (p, outcome) => {
    const body = {};
    if (outcome === 'confirm' && !['Cash', 'Cheque'].includes(p.method)) {
      body.providerReference = p.provider_reference || window.prompt('Transaction reference from the terminal, UPI app or bank:');
      if (!body.providerReference) return;
    }
    if (outcome === 'fail') { body.reason = window.prompt('Why did the payment fail?'); if (!body.reason) return; }
    act(() => api.post(`/finance/payments/${p.id}/${outcome}`, body), outcome === 'confirm' ? 'Payment confirmed' : 'Payment marked failed');
  };
  const voidInvoice = (inv) => {
    const reason = window.prompt(`Void invoice ${inv.invoice_number}? Give the reason (at least 5 characters).`);
    if (reason && reason.trim().length >= 5) act(() => api.post(`/finance/invoices/${inv.id}/void`, { reason }), 'Invoice voided');
  };
  const creditNote = (inv) => {
    const amount = Number(window.prompt(`Credit note on ${inv.invoice_number}: amount to credit (before GST)`));
    if (!(amount > 0)) return;
    const reason = window.prompt('Reason for the credit note (at least 5 characters):');
    if (!reason || reason.trim().length < 5) return;
    act(() => api.post(`/finance/invoices/${inv.id}/notes`, { kind: 'credit', reason, lines: [{ category: 'Service', description: reason.slice(0, 200), amount }] }), 'Credit note issued');
  };
  const requestRefund = (e) => {
    e.preventDefault();
    act(() => api.post('/finance/refunds', { fundId: refund.fundId, amount: Number(refund.amount), method: refund.method, reason: refund.reason }),
      'Refund requested; an administrator approves it', async () => setRefund(null));
  };
  const applyFund = (f) => {
    const target = issued.find((i) => Number(i.patient_due) > 0);
    if (!target) { toast.error('No issued invoice has anything due.'); return; }
    act(() => api.post(`/finance/funds/${f.id}/allocate`, { invoiceId: target.id }), `Applied to ${target.invoice_number}`);
  };

  const t = acc.totals || {};
  const admissionDone = acc.episode_type === 'admission' && acc.admission_status !== 'Active';

  return (
    <div className="stack">
      <div className="kpi-strip">
        <div className="panel kpi"><div className="kpi-label">Charges recorded</div><div className="kpi-value">{inr(t.charges)}</div></div>
        <div className="panel kpi"><div className="kpi-label">Invoiced</div><div className="kpi-value">{inr(t.invoiced)}</div></div>
        <div className="panel kpi"><div className="kpi-label">Patient owes</div><div className="kpi-value" style={{ color: t.patientDue > 0 ? 'var(--red)' : undefined }}>{inr(t.patientDue)}</div></div>
        <div className="panel kpi"><div className="kpi-label">Deposits and credit held</div><div className="kpi-value" style={{ color: 'var(--primary)' }}>{inr(t.fundsAvailable)}</div></div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div className="stack" style={{ flex: '2 1 520px', minWidth: 0 }}>
          {medicineSearch && acc.status === 'Open' && (
            <section className="panel panel-pad">
              <h2 className="panel-title"><Pill size={16} aria-hidden="true" /> Add medicines and consumables</h2>
              <label className="search-field" style={{ display: 'block' }}>
                <Search size={17} aria-hidden="true" />
                <span className="sr-only">Search medicines</span>
                <input placeholder="Search medicines by name" value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              {results.length > 0 && (
                <ul className="list-rows" style={{ marginTop: 10, maxHeight: 280, overflowY: 'auto' }}>
                  {results.map((med) => (
                    <li key={med.id} className="list-row" style={{ cursor: 'default' }}>
                      <span className="cell-stack">
                        <span className="cell-primary">{med.genericName}</span>
                        <span className="cell-secondary">{med.formulation}{med.strength ? ` · ${med.strength}${med.strengthUnit || ''}` : ''}</span>
                      </span>
                      {picked === med.id ? (
                        <span className="inline-actions">
                          <label className="sr-only" htmlFor={`qty-${med.id}`}>Quantity</label>
                          <input id={`qty-${med.id}`} className="form-input" type="number" min="1" max="999" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 70, height: 32, textAlign: 'center' }} />
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => addMedicine(med)}>Add</button>
                          <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setPicked(null)}><X size={16} aria-hidden="true" /></button>
                        </span>
                      ) : (
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicked(med.id)}><Plus size={14} aria-hidden="true" /> Select</button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="form-hint">Priced at the MRP of the batch the pharmacy would issue first. Medicines dispensed against orders are charged automatically.</p>
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Charges</h2>
              <span className="cell-secondary">{acc.account_number}{acc.legacy_bill_number ? ` · earlier bill ${acc.legacy_bill_number}` : ''}</span>
            </div>
            {acc.charges.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No charges yet" description="Consultations, tests, bed days and dispensed medicines appear here as they happen." />
            ) : (
              <div className="dt-scroll">
                <table className="dt-table">
                  <thead><tr><th>When</th><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {acc.charges.map((c) => (
                      <tr key={c.id}>
                        <td className="cell-secondary tabular">{fmt(c.service_at)}</td>
                        <td><span className="cell-stack"><span className="cell-primary">{c.description}</span><span className="cell-secondary">{c.category}{c.reason && c.source_type !== 'ward_day' ? ` · ${c.reason}` : ''}</span></span></td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{Number(Number(c.quantity).toFixed(3))}</td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{inr(Number(c.amount) + Number(c.gst_amount))}</td>
                        <td>
                          {c.source_type === 'reversal' ? <span className="status status-neutral">Cancellation</span>
                            : c.reversed ? <span className="status status-neutral">Cancelled</span>
                              : c.invoice_number ? <span className="status status-success">On {c.invoice_number}</span>
                                : <span className="status status-warning">Not billed yet</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!c.invoice_number && !c.reversed && c.source_type !== 'reversal' && (isAdmin || ['manual', 'ipd_draft'].includes(c.source_type)) && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => cancelCharge(c)} aria-label={`Cancel ${c.description}`}>
                              <Ban size={14} aria-hidden="true" /> Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {acc.needs_credit?.length > 0 && (
              <div className="panel-pad">
                <h3 className="panel-subtitle">Cancelled after billing</h3>
                {acc.needs_credit.map((r) => (
                  <div key={r.reversal_id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{r.description} on {r.invoice_number} ({inr(Number(r.amount) + Number(r.gst_amount))})</span>
                    {isAdmin
                      ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/charges/${r.reversal_id}/credit`), 'Credit note issued')}>Issue credit note</button>
                      : <span className="muted">An administrator issues the credit note.</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {isAdmin && acc.status === 'Open' && (
            <section className="panel panel-pad">
              <h2 className="panel-title">Service priced by hand</h2>
              <form onSubmit={addManual} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', alignItems: 'end' }}>
                <div className="form-group"><label className="form-label" htmlFor="m-cat">Category</label>
                  <select id="m-cat" className="form-select" value={manual.category} onChange={(e) => setManual({ ...manual, category: e.target.value })}>
                    {['Procedure', 'Service', 'Lab', 'Medicine', 'Consultation'].map((c) => <option key={c}>{c}</option>)}
                  </select></div>
                <div className="form-group"><label className="form-label" htmlFor="m-desc">Description</label>
                  <input id="m-desc" className="form-input" required maxLength={200} value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="m-price">Price (₹)</label>
                  <input id="m-price" className="form-input" required type="number" min="0" step="0.01" value={manual.unitPrice} onChange={(e) => setManual({ ...manual, unitPrice: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="m-qty">Qty</label>
                  <input id="m-qty" className="form-input" required type="number" min="1" step="1" value={manual.quantity} onChange={(e) => setManual({ ...manual, quantity: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="m-why">Why priced by hand</label>
                  <input id="m-why" className="form-input" required minLength={5} maxLength={500} value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} /></div>
                <button type="submit" className="btn btn-secondary btn-md" disabled={busy}><Plus size={14} aria-hidden="true" /> Add charge</button>
              </form>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><FileCheck2 size={16} aria-hidden="true" /> Invoices</h2></div>
            {issued.length === 0 ? <p className="muted panel-pad">No invoice issued yet.</p> : (
              <div className="dt-scroll">
                <table className="dt-table">
                  <thead><tr><th>Invoice</th><th>Issued</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Patient owes</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {issued.map((inv) => (
                      <tr key={inv.id}>
                        <td className="mono">{inv.invoice_number}{inv.kind === 'interim' ? ' (interim)' : ''}</td>
                        <td className="cell-secondary">{fmt(inv.issued_at)}</td>
                        <td><span className={`status status-${INVOICE_TONE[inv.status] || 'info'}`}>{inv.status}</span></td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{inr(inv.total)}{Number(inv.payer_amount) > 0 ? ` (payer ${inr(inv.payer_amount)})` : ''}</td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{inr(Math.max(0, Number(inv.patient_due)))}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openInvoice(inv.id)}><Printer size={14} aria-hidden="true" /> View</button>
                          {isDesk && Number(inv.patient_due) > 0 && inv.status !== 'Void' && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPayment({ invoiceId: inv.id, number: inv.invoice_number, amount: money(inv.patient_due), method: 'Cash', reference: '', outcome: 'confirmed' })}>
                              <CreditCard size={14} aria-hidden="true" /> Take payment
                            </button>
                          )}
                          {isAdmin && ['Issued', 'PartiallyCredited'].includes(inv.status) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => creditNote(inv)}>Credit note</button>}
                          {isAdmin && inv.status === 'Issued' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => voidInvoice(inv)}>Void</button>}
                          {isDesk && Number(inv.payer_amount) > 0 && !['Void'].includes(inv.status) && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(() => api.post(`/finance/invoices/${inv.id}/claim`), (c) => `Claim ${c.claim_number} prepared`)}>Claim</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {payment && (
            <section className="panel panel-pad" aria-label="Take payment">
              <h2 className="panel-title"><CreditCard size={16} aria-hidden="true" /> Payment on {payment.number}</h2>
              <form onSubmit={pay} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end' }}>
                <div className="form-group"><label className="form-label" htmlFor="p-amt">Amount received (₹)</label>
                  <input id="p-amt" className="form-input" type="number" min="0.01" step="0.01" required value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="p-method">Payment mode</label>
                  <select id="p-method" className="form-select" value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value, outcome: 'confirmed' })}>
                    {METHODS.map((m) => <option key={m} value={m}>{m === 'BankTransfer' ? 'Bank transfer' : m}</option>)}
                  </select></div>
                {!['Cash', 'Cheque'].includes(payment.method) && (
                  <>
                    <div className="form-group"><label className="form-label" htmlFor="p-ref">Transaction reference</label>
                      <input id="p-ref" className="form-input" value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="p-out">Terminal answer</label>
                      <select id="p-out" className="form-select" value={payment.outcome} onChange={(e) => setPayment({ ...payment, outcome: e.target.value })}>
                        <option value="confirmed">Approved</option><option value="pending">Waiting for the answer</option><option value="unknown">No answer (check later)</option>
                      </select></div>
                  </>
                )}
                <span className="inline-actions">
                  <button type="submit" className="btn btn-primary btn-md" disabled={busy}>Record payment</button>
                  <button type="button" className="btn btn-ghost btn-md" onClick={() => setPayment(null)}>Cancel</button>
                </span>
              </form>
            </section>
          )}

          {acc.open_payments?.length > 0 && (
            <section className="panel panel-pad" aria-label="Payments awaiting an answer">
              <h2 className="panel-title">Payments awaiting an answer</h2>
              <p className="form-hint">Do not collect again while one of these is open: confirm it with the provider's reference, or mark it failed.</p>
              {acc.open_payments.map((p) => (
                <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                  <span>{p.method} {inr(p.amount)} · <span className="status status-warning">{p.state}</span> since {fmt(p.created_at)}</span>
                  {isDesk && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => resolvePayment(p, 'confirm')}>Confirm</button>}
                  {isDesk && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolvePayment(p, 'fail')}>Failed</button>}
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="stack" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <section className="panel">
            <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Receipt size={16} aria-hidden="true" /> Bill summary</h2></div>
            <div className="panel-pad stack-sm">
              {wardDays.length > 0 && (
                <p className="cell-secondary">Bed days so far: {wardDays.length} ({[...new Set(wardDays.map((d) => `${inr(d.unit_price)}/day`))].join(', ')})</p>
              )}
              {!draft && unbilled.length === 0 && <p className="muted">Everything charged so far is billed.</p>}
              {!draft && unbilled.length > 0 && (
                <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={prepare}>
                  Prepare {acc.episode_type === 'admission' && !admissionDone ? 'interim ' : ''}bill ({unbilled.length} {unbilled.length === 1 ? 'charge' : 'charges'})
                </button>
              )}
              {draft && (
                <>
                  <div className="mini-table-wrap">
                    {[['Charges', draft.subtotal], ['GST', draft.gst_amount], ['Discount', -Number(draft.discount_amount)], ['Bill total', draft.total],
                      ...(Number(draft.payer_amount) > 0 ? [['Payer pays', draft.payer_amount], ['Patient pays', draft.patient_amount]] : [])]
                      .map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontWeight: k === 'Bill total' ? 650 : 400 }}>
                          <span>{k}</span><span className="tabular">{inr(v)}</span>
                        </div>
                      ))}
                  </div>
                  {isAdmin ? (
                    <form onSubmit={saveDiscount} className="stack-sm">
                      <div className="form-group"><label className="form-label" htmlFor="d-amt">Discount (₹)</label>
                        <input id="d-amt" className="form-input" type="number" min="0" step="0.01" value={discount.amount} onChange={(e) => setDiscount({ ...discount, amount: e.target.value })} /></div>
                      <div className="form-group"><label className="form-label" htmlFor="d-why">Reason for the discount</label>
                        <input id="d-why" className="form-input" maxLength={500} value={discount.reason} onChange={(e) => setDiscount({ ...discount, reason: e.target.value })} /></div>
                      <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Apply discount</button>
                    </form>
                  ) : <p className="form-hint">Discounts are approved by an administrator before the bill is issued.</p>}
                  {funds.length > 0 && (
                    <label className="check-row"><input type="checkbox" checked={applyDeposits} onChange={(e) => setApplyDeposits(e.target.checked)} /> Apply deposits held ({inr(t.fundsAvailable)})</label>
                  )}
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--primary-light)', border: '1px solid var(--primary-border)', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 650 }}>Net payable</span>
                    <span className="tabular" style={{ fontWeight: 700, color: 'var(--primary)' }}>
                      {inr(Math.max(0, Number(draft.patient_amount) - (applyDeposits ? Number(t.fundsAvailable || 0) : 0)))}
                    </span>
                  </div>
                  <button type="button" className="btn btn-primary btn-md" disabled={busy || !isDesk} onClick={issue}>
                    <Receipt size={16} aria-hidden="true" /> {acc.episode_type === 'admission' ? (admissionDone ? 'Generate final bill' : 'Generate interim bill') : 'Generate bill'}
                  </button>
                  {!isDesk && <p className="form-hint">The billing desk issues the bill.</p>}
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Wallet size={16} aria-hidden="true" /> Deposits and credit</h2></div>
            <div className="panel-pad stack-sm">
              {(acc.funds || []).length === 0 && <p className="muted">No deposit taken.</p>}
              {(acc.funds || []).map((f) => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>{f.kind === 'deposit' ? 'Deposit' : 'Credit'} {f.receipt_number || f.note_number || '(earlier advance)'} · {inr(f.amount)}, <strong>{inr(f.balance)} left</strong></span>
                  {isDesk && Number(f.balance) > 0 && (
                    <span className="inline-actions">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => applyFund(f)}>Apply to bill</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefund({ fundId: f.id, amount: money(f.balance), method: 'Cash', reason: '' })}>Refund</button>
                    </span>
                  )}
                </div>
              ))}
              {refund && (
                <form onSubmit={requestRefund} className="stack-sm" aria-label="Request refund">
                  <div className="form-group"><label className="form-label" htmlFor="r-amt">Refund amount (₹)</label>
                    <input id="r-amt" className="form-input" type="number" min="0.01" step="0.01" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label" htmlFor="r-method">Refund by</label>
                    <select id="r-method" className="form-select" value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
                  <div className="form-group"><label className="form-label" htmlFor="r-why">Reason</label>
                    <input id="r-why" className="form-input" required minLength={5} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></div>
                  <span className="inline-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>Request refund</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefund(null)}>Cancel</button></span>
                </form>
              )}
              {isDesk && acc.status === 'Open' && (
                <form onSubmit={takeDeposit} className="stack-sm" aria-label="Take deposit">
                  <div className="form-group"><label className="form-label" htmlFor="dep-amt">Deposit amount (₹)</label>
                    <input id="dep-amt" className="form-input" type="number" min="1" step="0.01" required value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label" htmlFor="dep-method">Mode</label>
                    <select id="dep-method" className="form-select" value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></div>
                  {!['Cash', 'Cheque'].includes(deposit.method) && (
                    <div className="form-group"><label className="form-label" htmlFor="dep-ref">Transaction reference</label>
                      <input id="dep-ref" className="form-input" required value={deposit.reference} onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })} /></div>
                  )}
                  <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Take deposit</button>
                </form>
              )}
            </div>
          </section>

          {acc.payer && (
            <section className="panel panel-pad">
              <h2 className="panel-title">Payer</h2>
              <p>{acc.payer.payer_name} · policy {acc.payer.policy_number} · co-pay {Number(acc.payer.copay_percent)}%</p>
              <p className="cell-secondary">Pre-authorisation {acc.payer.preauth_status}: {inr(acc.payer.approved_amount)} approved</p>
            </section>
          )}
        </div>
      </div>

      {preview && (
        <section className="panel panel-pad" aria-label="Invoice preview">
          <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12 }}>
            <button type="button" className="btn btn-primary btn-md" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print bill</button>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setPreview(null)}>Close</button>
          </div>
          <InvoicePaper invoice={preview} />
        </section>
      )}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-section, .print-section * { visibility: visible; }
          .print-section { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 15mm; }
        }
        .bill-preview-paper { background: white; color: black; max-width: 820px; margin: 0 auto; padding: 36px 32px; border: 1px solid #ddd; }
      `}</style>
    </div>
  );
}
