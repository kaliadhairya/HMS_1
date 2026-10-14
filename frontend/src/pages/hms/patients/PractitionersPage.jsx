import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, CircleSlash, ShieldAlert, Stethoscope } from 'lucide-react';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { localYmd } from '../../../utils/localDate';

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
  const [busy, setBusy] = useState(false);

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

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      toast.success(success);
      await loadDetail(selected);
      await loadList();
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const addCredential = (e) => {
    e.preventDefault();
    act(async () => {
      await api.post(`/practitioners/${selected}/credentials`, { ...form, validTo: form.validTo || undefined });
      setForm(EMPTY);
    }, 'Registration recorded (not yet verified)');
  };
  const endCredential = (c) => {
    const reason = window.prompt('Why does this registration end? (for example: lapsed, struck off, renewed under a new number)');
    if (reason) act(() => api.post(`/practitioners/${selected}/credentials/${c.id}/end`, { reason }), 'Registration ended');
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Practitioners" description="Doctors and their recorded medical registrations. An expired registration blocks starting or finishing consultations." />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', alignItems: 'start' }}>
          <section className="panel">
            {list === null && <p className="muted panel-pad">Loading…</p>}
            {list && list.length === 0 && <EmptyState icon={Stethoscope} title="No practitioners" description="Doctor accounts appear here." />}
            {list && list.map((p) => (
              <button key={p.id} type="button" className={`btn btn-ghost btn-md${selected === p.user_id ? ' is-active' : ''}`}
                style={{ width: '100%', justifyContent: 'space-between', borderRadius: 0 }} onClick={() => setSelected(p.user_id)}>
                <span>{p.display_name}</span>
                {p.registration_expired
                  ? <span className="status status-danger">Expired</span>
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
                  <div className="alert-strip alert-warning" role="status"><ShieldAlert size={16} aria-hidden="true" /> Every recorded registration has expired. Clinical work is blocked until one is renewed.</div>
                )}
                {detail.credentials.length === 0 && <p className="muted">No registration recorded yet. Clinical work is not blocked, but one should be recorded.</p>}
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
                            {c.verified_at ? <span className="status status-success"><BadgeCheck size={12} aria-hidden="true" /> Verified</span> : <span className="status status-warning">Not verified</span>}
                            {' '}<span className="muted">{c.status}</span>
                          </td>
                          <td className="text-right">
                            {canEdit && c.status === 'current' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => endCredential(c)}><CircleSlash size={14} aria-hidden="true" /> End</button>}
                            {canEdit && !c.verified_at && c.status !== 'expired' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/practitioners/${selected}/credentials/${c.id}/verify`), 'Registration verified')}>Verify</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {canEdit && (
                  <form onSubmit={addCredential} className="split-2">
                    <div className="form-group"><label className="form-label" htmlFor="pr-id">Registration number</label>
                      <input id="pr-id" className="form-input" required maxLength={80} value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-body">Issued by (council)</label>
                      <input id="pr-body" className="form-input" required maxLength={120} value={form.issuingBody} onChange={(e) => setForm({ ...form, issuingBody: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-from">Valid from</label>
                      <input id="pr-from" className="form-input" type="date" required value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></div>
                    <div className="form-group"><label className="form-label" htmlFor="pr-to">Valid to (blank if open)</label>
                      <input id="pr-to" className="form-input" type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></div>
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
