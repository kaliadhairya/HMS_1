import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CreditCard, FileWarning, Inbox, ShieldPlus, Undo2, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { useAuth } from '../../../context/AuthContext';
import { inr } from '../../../components/billing/InvoicePaper';

const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const TABS = [
  ['payments', 'Payments awaiting an answer', CreditCard],
  ['refunds', 'Refunds', Wallet],
  ['returns', 'Returned medicines', Undo2],
  ['claims', 'Insurance claims', ShieldPlus],
  ['denials', 'Denials', FileWarning],
  ['accounts', 'Accounts', Inbox],
];

// Worklists of the billing desk (Phase 5). Every action here is a separate,
// authorised command; nothing is edited in place.
export default function FinanceDeskPage() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [tab, setTab] = useState('payments');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [patientId, setPatientId] = useState('');

  const load = useCallback(async (which = tab) => {
    setRows(null);
    const url = {
      payments: '/finance/payments?state=Initiated,Pending,Unknown',
      refunds: '/finance/refunds',
      returns: '/finance/medicine-returns',
      claims: '/finance/claims',
      denials: '/finance/denials',
      accounts: `/finance/accounts${patientId ? `?patientId=${Number(patientId)}` : ''}`,
    }[which];
    try { setRows((await api.get(url)).data.data || []); }
    catch (err) { setRows([]); toast.error(err.response?.data?.message || 'Could not load the list.'); }
  }, [tab, patientId]);
  useEffect(() => { load(tab); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try { await request(); toast.success(success); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); }
    finally { setBusy(false); }
  };
  const ask = (q, min = 3) => { const v = window.prompt(q); return v && v.trim().length >= min ? v.trim() : null; };

  const paymentActions = (p) => (
    <>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
        const providerReference = ['Cash', 'Cheque'].includes(p.method) ? undefined : (p.provider_reference || ask('Provider reference that confirms the payment:'));
        if (!['Cash', 'Cheque'].includes(p.method) && !providerReference) return;
        act(() => api.post(`/finance/payments/${p.id}/confirm`, { providerReference }), 'Payment confirmed');
      }}>Confirm</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
        const reason = ask('Why did the payment fail?');
        if (reason) act(() => api.post(`/finance/payments/${p.id}/fail`, { reason }), 'Payment marked failed');
      }}>Failed</button>
    </>
  );

  const refundActions = (r) => {
    if (r.state === 'Requested' && isAdmin) {
      return (
        <>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || r.requested_by === user?.id} title={r.requested_by === user?.id ? 'Someone else approves your request' : undefined}
            onClick={() => act(() => api.post(`/finance/refunds/${r.id}/approve`, {}), 'Refund approved')}>Approve</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const note = ask('Why is the refund rejected?');
            if (note) act(() => api.post(`/finance/refunds/${r.id}/reject`, { note }), 'Refund rejected');
          }}>Reject</button>
        </>
      );
    }
    if (r.state === 'Approved') {
      return <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/refunds/${r.id}/pay`, {}), r.method === 'Cash' ? 'Refund paid in cash' : 'Refund sent')}>Pay out</button>;
    }
    if (r.state === 'Submitted') {
      return (
        <>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
            const providerReference = r.provider_reference || ask('Bank or provider reference for the refund:');
            if (providerReference) act(() => api.post(`/finance/refunds/${r.id}/confirm`, { providerReference }), 'Refund confirmed');
          }}>Confirm</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => {
            const reason = ask('Why did the refund fail?');
            if (reason) act(() => api.post(`/finance/refunds/${r.id}/fail`, { reason }), 'Refund marked failed');
          }}>Failed</button>
        </>
      );
    }
    return null;
  };

  const claimActions = (c) => {
    if (c.status === 'Prepared') return <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/claims/${c.id}/submit`, { payerReference: ask('Payer claim reference (optional):', 0) || undefined }), 'Claim submitted')}>Submit</button>;
    if (c.status === 'Submitted') return <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/claims/${c.id}/acknowledge`, {}), 'Acknowledgement recorded')}>Acknowledged</button>;
    if (['Submitted', 'Acknowledged'].includes(c.status) || false) return null;
    if (['Adjudicated', 'Appealed'].includes(c.status)) {
      return <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
        const remittanceReference = ask('Remittance reference:');
        const amount = Number(window.prompt('Amount received (₹):'));
        if (remittanceReference && amount > 0) act(() => api.post(`/finance/claims/${c.id}/remittances`, { remittanceReference, amount }), 'Remittance recorded');
      }}>Record remittance</button>;
    }
    return null;
  };
  // Whole-claim adjudication from the list: approve all, or approve an amount
  // with the rest denied on the first line. Line-by-line detail is in the API.
  const adjudicate = async (c) => {
    const approved = Number(window.prompt(`Approved amount for ${c.claim_number} (claimed ${c.claimed_amount}):`, c.claimed_amount));
    if (!(approved >= 0)) return;
    const { data } = await api.get(`/finance/claims/${c.id}`);
    let left = approved;
    const reason = approved < Number(c.claimed_amount) ? ask("Payer's reason for the denied amount:") : null;
    if (approved < Number(c.claimed_amount) && !reason) return;
    const lines = data.data.lines.map((l) => {
      const ok = Math.min(Number(l.claimed_amount), left);
      left = Math.round((left - ok) * 100) / 100;
      return { claimLineId: l.id, approvedAmount: ok, denialReason: ok < Number(l.claimed_amount) ? reason : undefined };
    });
    act(() => api.post(`/finance/claims/${c.id}/adjudication`, { lines }), 'Adjudication recorded');
  };

  const denialActions = (d) => {
    const resolve = (action, label) => {
      const note = ask(`${label}: record what was decided (at least 5 characters).`, 5);
      if (note) act(() => api.post(`/finance/denials/${d.id}/resolve`, { action, note }), 'Denial updated');
    };
    return (
      <>
        {d.status === 'Open' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolve('appeal', 'Appeal')}>Appeal</button>}
        {d.status === 'Appealed' && isAdmin && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolve('recover', 'Payer will pay')}>Recovered</button>}
        {isAdmin && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolve('transfer', 'Patient pays')}>Patient pays</button>}
        {isAdmin && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => resolve('write_off', 'Write off')}>Write off</button>}
      </>
    );
  };

  const table = (head, body) => (
    <div className="dt-scroll"><table className="dt-table"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{body}</tbody></table></div>
  );

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Billing desk" description="Payments waiting for an answer, refunds, credits for returned medicine, insurance claims and denials." />
        <section className="panel">
          <div className="tabs" role="tablist" aria-label="Billing worklists">
            {TABS.map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} className={`tab${tab === key ? ' is-active' : ''}`} onClick={() => setTab(key)}>
                <Icon size={14} aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <div className="panel-pad">
            {tab === 'accounts' && (
              <form onSubmit={(e) => { e.preventDefault(); load('accounts'); }} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <label className="sr-only" htmlFor="acc-patient">Patient ID</label>
                <input id="acc-patient" className="form-input" inputMode="numeric" placeholder="Patient ID (optional)" value={patientId} onChange={(e) => setPatientId(e.target.value)} style={{ maxWidth: 220 }} />
                <button type="submit" className="btn btn-secondary btn-md">Show accounts</button>
              </form>
            )}
            {rows === null && <p className="muted">Loading…</p>}
            {rows && rows.length === 0 && <EmptyState icon={Inbox} title="Nothing here" description="This worklist is empty." />}
            {rows && rows.length > 0 && tab === 'payments' && table(['Started', 'Patient', 'Bill', 'Method', 'Amount', 'State', ''], rows.map((p) => (
              <tr key={p.id}><td>{fmt(p.created_at)}</td><td>{p.patient_name} <span className="mono muted">{p.uhid}</span></td><td className="mono">{p.invoice_number || 'Deposit'}</td>
                <td>{p.method}</td><td className="tabular">{inr(p.amount)}</td><td><span className="status status-warning">{p.state}</span></td><td style={{ whiteSpace: 'nowrap' }}>{paymentActions(p)}</td></tr>
            )))}
            {rows && rows.length > 0 && tab === 'refunds' && table(['Requested', 'Patient', 'Refund', 'From', 'Amount', 'State', ''], rows.map((r) => (
              <tr key={r.id}><td>{fmt(r.requested_at)}<div className="cell-secondary">by {r.requested_by_name}</div></td><td>{r.patient_name}</td><td className="mono">{r.refund_number}<div className="cell-secondary">{r.reason}</div></td>
                <td>{r.fund_kind} · {r.method}</td><td className="tabular">{inr(r.amount)}</td><td><span className="status status-info">{r.state}</span>{r.approved_by_name ? <div className="cell-secondary">approved by {r.approved_by_name}</div> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{refundActions(r)}</td></tr>
            )))}
            {rows && rows.length > 0 && tab === 'returns' && table(['Returned', 'Patient', 'Medicine', 'Quantity', 'Credit', ''], rows.map((r) => (
              <tr key={r.id}><td>{fmt(r.recorded_at)}</td><td>{r.patient_name} <span className="mono muted">{r.uhid}</span></td><td>{r.description}<div className="cell-secondary">{r.reason}</div></td>
                <td className="tabular">{Number(r.quantity)}</td><td className="tabular">{inr(r.amount)}{r.invoice_line_id ? ' (credit note)' : ''}</td>
                <td>{isAdmin ? <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/medicine-returns/${r.id}/credit`, {}), 'Credit recorded')}>Authorise credit</button> : <span className="muted">Administrator</span>}</td></tr>
            )))}
            {rows && rows.length > 0 && tab === 'claims' && table(['Claim', 'Patient', 'Payer', 'Claimed', 'Approved', 'Paid', 'Status', ''], rows.map((c) => (
              <tr key={c.id}><td className="mono">{c.claim_number}<div className="cell-secondary">{c.invoice_number}</div></td><td>{c.patient_name}</td><td>{c.payer_name}</td>
                <td className="tabular">{inr(c.claimed_amount)}</td><td className="tabular">{c.approved_amount == null ? '—' : inr(c.approved_amount)}</td><td className="tabular">{inr(c.paid_amount)}</td>
                <td><span className="status status-info">{c.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>{claimActions(c)}{['Submitted', 'Acknowledged'].includes(c.status) && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => adjudicate(c)}>Record adjudication</button>}</td></tr>
            )))}
            {rows && rows.length > 0 && tab === 'denials' && table(['Claim', 'Patient', 'Amount', 'Reason', 'Status', ''], rows.map((d) => (
              <tr key={d.id}><td className="mono">{d.claim_number}</td><td>{d.patient_name}</td><td className="tabular">{inr(d.amount)}</td><td>{d.code ? `${d.code}: ` : ''}{d.reason}</td>
                <td><span className="status status-warning">{d.status}</span>{d.resolution_note ? <div className="cell-secondary">{d.resolution_note}</div> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{['Open', 'Appealed'].includes(d.status) && denialActions(d)}</td></tr>
            )))}
            {rows && rows.length > 0 && tab === 'accounts' && table(['Account', 'Patient', 'Episode', 'Opened', 'Patient owes', ''], rows.map((a) => (
              <tr key={a.id}><td className="mono">{a.account_number}</td><td>{a.patient_name} <span className="mono muted">{a.uhid}</span></td>
                <td>{a.episode_type === 'admission' ? `Admission ${a.admission_id}` : `Visit ${a.encounter_id}`}</td><td>{fmt(a.opened_at)}</td>
                <td className="tabular">{inr(a.patient_due)}</td><td><Link className="btn btn-secondary btn-sm" to={`/billing/accounts/${a.id}`}>Open</Link></td></tr>
            )))}
          </div>
        </section>
      </main>
    </>
  );
}
