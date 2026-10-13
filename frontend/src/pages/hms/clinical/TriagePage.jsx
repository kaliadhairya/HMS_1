import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldAlert, Siren, TriangleAlert } from 'lucide-react';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

const ASSESS_ROLES = ['nurse', 'doctor', 'admin', 'super_admin'];
const DISPOSE_ROLES = ['doctor', 'admin', 'super_admin'];
const MODE = { walk_in: 'Walk-in', ambulance: 'Ambulance', referral: 'Referral', other: 'Other' };
const fmt = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');

// Emergency arrivals and triage. Triage is switched off until a clinician
// approves a protocol version; arrivals can always be recorded.
export default function TriagePage() {
  const { user } = useAuth();
  const canAssess = ASSESS_ROLES.includes(user?.role);
  const canDispose = DISPOSE_ROLES.includes(user?.role);
  const [board, setBoard] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [mode, setMode] = useState('walk_in');
  const [complaint, setComplaint] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [b, p] = await Promise.all([api.get('/triage/board'), api.get('/triage/protocols')]);
      setBoard(b.data.data || []);
      setEnabled(Boolean(p.data.triage_enabled));
    } catch {
      setBoard([]);
      toast.error('Could not load the triage board.');
    }
  };
  useEffect(() => { load(); }, []);

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

  const register = (e) => {
    e.preventDefault();
    act(async () => {
      await api.post('/triage/arrivals', { patientId: Number(patientId), arrivalMode: mode, chiefComplaint: complaint || undefined });
      setPatientId(''); setComplaint('');
    }, 'Arrival recorded');
  };
  const assess = (row) => {
    const acuity = window.prompt('Acuity level from 1 (most urgent) to 5 (least urgent):');
    if (!acuity) return;
    const minutes = window.prompt('Reassess within how many minutes (1–240)?', '30');
    if (!minutes) return;
    act(() => api.post(`/triage/arrivals/${row.id}/assessments`, {
      protocolKey: 'esi', protocolVersion: 5, acuityLevel: Number(acuity), reassessMinutes: Number(minutes),
    }), 'Assessment recorded');
  };
  const escalate = (row) => {
    const reason = window.prompt('Why is this being escalated?');
    if (!reason) return;
    const toRole = window.prompt('Escalate to: doctor, nurse or admin?', 'doctor');
    if (!toRole) return;
    act(() => api.post(`/triage/arrivals/${row.id}/escalate`, { reason, toRole: toRole.trim() }), 'Escalated');
  };
  const dispose = (row) => {
    const status = window.prompt('Where does the patient go? admitted, discharged, transferred or left', 'discharged');
    if (!status) return;
    const reason = window.prompt('What was decided?');
    if (!reason) return;
    act(() => api.post(`/triage/arrivals/${row.id}/disposition`, { status: status.trim(), reason }), 'Disposition recorded');
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Emergency arrivals and triage" description="The board shows open arrivals, most urgent first." />
        {!enabled && (
          <div className="alert-strip alert-warning" role="status" style={{ marginBottom: 16 }}>
            <ShieldAlert size={16} aria-hidden="true" /> Triage is switched off: no clinician has approved a triage protocol yet. Arrivals can still be recorded.
          </div>
        )}
        <section className="panel panel-pad" style={{ marginBottom: 16 }}>
          <h2 className="panel-subtitle" style={{ marginTop: 0 }}>Record an arrival</h2>
          <form onSubmit={register} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="form-group"><label className="form-label" htmlFor="ar-patient">Patient ID</label>
              <input id="ar-patient" className="form-input" required inputMode="numeric" value={patientId} onChange={(e) => setPatientId(e.target.value)} /></div>
            <div className="form-group"><label className="form-label" htmlFor="ar-mode">Arrived by</label>
              <select id="ar-mode" className="form-input" value={mode} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div className="form-group" style={{ flex: 1, minWidth: 200 }}><label className="form-label" htmlFor="ar-complaint">Chief complaint</label>
              <input id="ar-complaint" className="form-input" maxLength={500} value={complaint} onChange={(e) => setComplaint(e.target.value)} /></div>
            <button type="submit" className="btn btn-primary btn-md" disabled={busy}><Siren size={16} aria-hidden="true" /> Record arrival</button>
          </form>
        </section>
        <section className="panel">
          {board === null && <p className="muted panel-pad">Loading…</p>}
          {board && board.length === 0 && <EmptyState icon={Siren} title="No open arrivals" description="Arrivals appear here until they are discharged or moved." />}
          {board && board.length > 0 && (
            <table className="mini-table">
              <thead><tr><th>Acuity</th><th>Patient</th><th>Arrived</th><th>Complaint</th><th>Reassess</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.id}>
                    <td>{r.not_yet_assessed ? <span className="status status-neutral">Not assessed</span> : <strong>{r.acuity_level}</strong>}</td>
                    <td><span className="cell-primary">{r.patient_name}</span> <span className="mono muted">{r.uhid}</span></td>
                    <td className="tabular">{fmt(r.arrived_at)} · {MODE[r.arrival_mode]}</td>
                    <td>{r.chief_complaint || '—'}</td>
                    <td className="tabular">{r.reassessment_overdue ? <span className="status status-danger"><TriangleAlert size={12} aria-hidden="true" /> Overdue</span> : fmt(r.reassess_due_at)}</td>
                    <td>{r.open_escalations > 0 ? <span className="status status-warning">{r.open_escalations} escalation(s) open</span> : r.status.replace('_', ' ')}</td>
                    <td className="text-right" style={{ whiteSpace: 'nowrap' }}>
                      {canAssess && enabled && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => assess(r)}>Assess</button>}
                      {canAssess && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => escalate(r)}>Escalate</button>}
                      {canDispose && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => dispose(r)}>Disposition</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
