import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ListChecks } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { useAuth } from '../../../context/AuthContext';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const ROLE_NAMES = { super_admin: 'Security lead (super admin)', admin: 'Administration', doctor: 'Doctors', nurse: 'Nursing', lab_technician: 'Laboratory', pharmacist: 'Pharmacy', receptionist: 'Front desk' };

// Accountable worklist (Phase 6): problems the system could not finish by
// itself, such as an audit checkpoint that did not reach write-once storage
// or an interface message that failed. Each has an owner and stays open until
// someone resolves it and says what was done.
export default function WorklistPage() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('Open');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setItems((await api.get(`/worklist?status=${status}`)).data.data); }
    catch (err) { toast.error(err.response?.data?.message || 'Could not load the worklist.'); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try { await request(); toast.success(success); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Worklist" description={`Problems the system could not finish by itself. ${isAdmin ? 'All teams.' : `Items for ${ROLE_NAMES[user?.role] || 'your team'}.`}`} />
        <section className="panel" aria-label="Worklist items">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><ListChecks size={16} aria-hidden="true" /> {items.length} {status === 'Open' ? 'open' : status === 'Resolved' ? 'resolved' : ''} item{items.length === 1 ? '' : 's'}</h2>
            <select className="form-select" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
              <option value="Open">Open</option><option value="Resolved">Resolved</option><option value="all">All</option>
            </select>
          </div>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>Problem</th><th>Owner</th><th>Seen</th><th>Status</th><th /></tr></thead>
              <tbody>
                {!items.length && <tr><td colSpan={5} className="cell-secondary">Nothing here.</td></tr>}
                {items.map((w) => (
                  <tr key={w.id}>
                    <td><strong>{w.title}</strong><div className="cell-secondary mono">{w.kind}</div></td>
                    <td>{ROLE_NAMES[w.owner_role]}{w.assigned_to && <div className="cell-secondary">Taken by {w.assigned_to}</div>}</td>
                    <td className="cell-secondary">{when(w.opened_at)}{w.occurrences > 1 && <div>{w.occurrences} times, last {when(w.last_seen_at)}</div>}</td>
                    <td>{w.status === 'Open'
                      ? <span className="status status-warning">Open</span>
                      : <><span className="status status-success">Resolved</span><div className="cell-secondary">{w.resolved_by}, {when(w.resolved_at)}: {w.resolution}</div></>}</td>
                    <td>{w.status === 'Open' && (
                      <span className="inline-actions">
                        {!w.assigned_user_id && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/worklist/${w.id}/assign`, {}), 'Item taken')}>Take</button>}
                        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
                          const resolution = window.prompt('What was done? (This is kept with the item.)');
                          if (resolution && resolution.trim().length >= 5) act(() => api.post(`/worklist/${w.id}/resolve`, { resolution }), 'Item resolved');
                        }}>Resolve</button>
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
