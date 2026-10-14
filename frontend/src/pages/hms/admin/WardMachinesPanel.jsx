import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Monitor } from 'lucide-react';
import api from '../../../api/axios';
import Modal from '../../../components/ui/Modal';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const TONE = { Current: 'status-success', Waiting: 'status-neutral', Behind: 'status-danger', Revoked: 'status-neutral' };
const EXPLAIN = {
  Current: 'Holds a kit that is not out of date.',
  Waiting: 'Registered recently; its first kit is due.',
  Behind: 'Has no current kit. Check the machine and its scheduled sync.',
  Revoked: 'Its token no longer works.',
};

// Ward machines that keep a copy of the downtime kit (completion C6). An
// administrator registers each machine and copies its token, shown once,
// into the machine's sync job; the list shows which machines hold a current kit.
export default function WardMachinesPanel({ refreshKey }) {
  const [machines, setMachines] = useState(null);
  const [form, setForm] = useState(null);
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setMachines((await api.get('/downtime/stations')).data.data); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not load ward machines.'); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  const register = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await api.post('/downtime/stations', form);
      setForm(null);
      setIssued(r.data.data);
      await load();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not register the machine.', { duration: 9000 }); }
    finally { setBusy(false); }
  };
  const revoke = async (m) => {
    const reason = window.prompt(`Why is "${m.name}" being revoked? (for example: machine replaced, lost or retired)`);
    if (!reason || reason.trim().length < 5) return;
    try { await api.post(`/downtime/stations/${m.id}/revoke`, { reason }); toast.success('Machine revoked'); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not revoke the machine.'); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(issued.token); toast.success('Token copied'); }
    catch { toast.error('Copy failed: select the token and copy it by hand.'); }
  };

  const active = (machines || []).filter((m) => m.state !== 'Revoked');
  const behind = active.filter((m) => m.state === 'Behind').length;
  return (
    <section className="panel panel-pad stack-sm" aria-label="Ward machines" style={{ marginTop: 16 }}>
      <div className="panel-head" style={{ padding: 0 }}>
        <h2 className="panel-title" style={{ margin: 0 }}><Monitor size={16} aria-hidden="true" /> Ward machines</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ name: '', location: '' })}>Register machine</button>
      </div>
      <p className="cell-secondary">Each ward machine keeps its own copy of the kit, so it can be opened and printed when the system is down. Run <span className="mono">downtime-sync.js</span> on the machine every 5 minutes.</p>
      {machines && (behind > 0
        ? <p className="status status-danger" role="alert">{behind} machine{behind > 1 ? 's have' : ' has'} no current kit.</p>
        : active.length > 0 && <p className="status status-success" role="status">Every registered machine holds a current kit.</p>)}
      {machines && (
        <div className="dt-scroll">
          <table className="dt-table">
            <thead><tr><th scope="col">Machine</th><th scope="col">State</th><th scope="col">Newest kit stored</th><th scope="col">Last contact</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {!machines.length && <tr><td colSpan={5} className="cell-secondary">No machines registered. Until one is, wards have no copy of the kit.</td></tr>}
              {machines.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}<div className="cell-secondary">{m.location}</div></td>
                  <td><span className={`status ${TONE[m.state]}`}>{m.state}</span><div className="cell-secondary">{m.state === 'Revoked' ? m.revoked_reason : EXPLAIN[m.state]}</div></td>
                  <td className="cell-secondary">{m.kit_generated_at ? <>made {when(m.kit_generated_at)}<div>stored {when(m.last_stored_at)}{m.last_opened ? ' · opening checked' : ''}</div></> : 'None yet'}</td>
                  <td className="cell-secondary">{when(m.last_pull_at)}</td>
                  <td>{m.state !== 'Revoked' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => revoke(m)} aria-label={`Revoke ${m.name}`}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)} title="Register a ward machine"
        description="The machine receives a token that lets it fetch the encrypted kit. It cannot read or change anything else."
        footer={<>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setForm(null)}>Cancel</button>
          <button type="submit" form="wm-form" className="btn btn-primary btn-md" disabled={busy}>Register</button>
        </>}>
        {form && (
          <form id="wm-form" onSubmit={register} className="stack-sm">
            <div className="form-group"><label className="form-label" htmlFor="wm-name">Machine name</label>
              <input id="wm-name" className="form-input" required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ward 3 nursing desk" /></div>
            <div className="form-group"><label className="form-label" htmlFor="wm-loc">Ward or department</label>
              <input id="wm-loc" className="form-input" required maxLength={80} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Ward 3" /></div>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(issued)} onOpenChange={(o) => !o && setIssued(null)} title={`Token for ${issued?.station?.name || ''}`}
        description="Shown once. Put it in the machine's sync configuration now; HMS cannot show it again."
        footer={<button type="button" className="btn btn-primary btn-md" onClick={() => setIssued(null)}>Done</button>}>
        {issued && (
          <div className="stack-sm">
            <label className="form-label" htmlFor="wm-token">Machine token</label>
            <input id="wm-token" className="form-input mono" readOnly value={issued.token} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>Copy token</button>
            <p className="cell-secondary">Set it as <span className="mono">DOWNTIME_STATION_TOKEN</span> for <span className="mono">downtime-sync.js</span>. If it is lost, revoke this machine and register it again.</p>
          </div>
        )}
      </Modal>
    </section>
  );
}
