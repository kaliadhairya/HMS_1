import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCheck, Inbox, Send, TriangleAlert } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

const STATUS_TONE = { Pending: 'warning', Acknowledged: 'info', Completed: 'success', Closed: 'neutral' };
const URGENCY_LABEL = { routine: 'Routine', urgent: 'Urgent', emergency: 'Emergency' };
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Referrals: the receiving doctor accepts (joining the patient's care), records the
// outcome, or closes with a documented reason. Nothing is complete on sending.
export default function ReferralsPage() {
  const [box, setBox] = useState('incoming');
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async (which = box) => {
    setRows(null);
    try {
      const { data } = await api.get('/referrals', { params: { box: which } });
      setRows(data.data || []);
    } catch {
      setRows([]);
      toast.error('Could not load referrals.');
    }
  };
  useEffect(() => { load(box); }, [box]);

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      toast.success(success);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Referrals" description="A referral is complete only when the receiving clinician has accepted it and recorded the outcome, or it has been closed with a reason." />
        <section className="panel">
          <div className="tabs" role="tablist" aria-label="Referral lists">
            <button type="button" role="tab" aria-selected={box === 'incoming'} className={`tab${box === 'incoming' ? ' is-active' : ''}`} onClick={() => setBox('incoming')}><Inbox size={14} aria-hidden="true" /> Waiting for me</button>
            <button type="button" role="tab" aria-selected={box === 'outgoing'} className={`tab${box === 'outgoing' ? ' is-active' : ''}`} onClick={() => setBox('outgoing')}><Send size={14} aria-hidden="true" /> I sent</button>
          </div>
          <div className="panel-pad stack">
            {rows === null && <p className="muted">Loading…</p>}
            {rows && rows.length === 0 && <EmptyState icon={Inbox} title="Nothing here" description={box === 'incoming' ? 'No referrals are waiting for you.' : 'You have not sent any referrals.'} />}
            {rows && rows.map((r) => (
              <article key={r.id} className="panel panel-pad stack" aria-label={`Referral ${r.id}`}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <strong>{r.patient_name}</strong> <span className="mono muted">{r.uhid}</span>
                  <span className={`status status-${STATUS_TONE[r.status] || 'neutral'}`}>{r.status}</span>
                  <span className="tag">{URGENCY_LABEL[r.urgency] || r.urgency}</span>
                  {r.overdue && <span className="status status-danger"><TriangleAlert size={12} aria-hidden="true" /> Overdue</span>}
                  <span className="muted" style={{ marginLeft: 'auto' }}>Sent {fmt(r.created_at)}{r.due_at ? ` · due ${fmt(r.due_at)}` : ''}</span>
                </div>
                <p>{r.reason}</p>
                <p className="muted">To: {r.to_clinician || r.to_specialty || 'not stated'}</p>
                {r.outcome && <p><strong>Outcome:</strong> {r.outcome}</p>}
                {r.closed_reason && <p><strong>Closed:</strong> {r.closed_reason}</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {box === 'incoming' && r.status === 'Pending' && (
                    <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={() => act(() => api.post(`/referrals/${r.id}/acknowledge`), 'Accepted. The patient is now in your care.')}>
                      <CheckCheck size={16} aria-hidden="true" /> Accept
                    </button>
                  )}
                  {box === 'incoming' && r.status === 'Acknowledged' && (
                    <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={() => {
                      const outcome = window.prompt('What was the outcome of the referral?');
                      if (outcome) act(() => api.post(`/referrals/${r.id}/complete`, { outcome }), 'Outcome recorded');
                    }}>Record outcome</button>
                  )}
                  {box === 'outgoing' && (r.status === 'Pending' || r.status === 'Acknowledged') && (
                    <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={() => {
                      const reason = window.prompt('Why is this referral closed without the receiving action?');
                      if (reason) act(() => api.post(`/referrals/${r.id}/close`, { reason }), 'Referral closed with a reason');
                    }}>Close with a reason</button>
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
