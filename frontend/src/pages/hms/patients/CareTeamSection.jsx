import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { UserPlus, Users } from 'lucide-react';
import api from '../../../api/axios';
import EmptyState from '../../../components/ui/EmptyState';

const ADMINS = ['super_admin', 'admin'];
const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');

// Who is caring for this patient. Doctors not on the team cannot open the record
// (break-glass exists for emergencies and is reviewed).
export default function CareTeamSection({ patientId, role }) {
  const [team, setTeam] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const canAdd = ['super_admin', 'admin', 'receptionist'].includes(role);

  const load = async () => {
    try {
      const { data } = await api.get(`/patients/hms/${patientId}/care-team`);
      setTeam(data.data || []);
    } catch {
      setTeam([]);
    }
  };
  useEffect(() => { load(); }, [patientId]);
  useEffect(() => {
    if (!canAdd) return;
    api.get('/practitioners').then((r) => setDoctors(r.data.data || [])).catch(() => setDoctors([]));
  }, [canAdd]);

  const add = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await api.post(`/patients/hms/${patientId}/care-team`, { practitionerUserId: Number(pick), role: 'consulting' });
      toast.success('Added to the care team');
      setPick('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not add to the care team.');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (a) => {
    const reason = window.prompt(`Why does ${a.practitioner_name} leave this patient's care team?`);
    if (!reason) return;
    setBusy(true);
    try {
      await api.post(`/patients/hms/${patientId}/care-team/${a.id}/end`, { reason });
      toast.success('Removed from the care team');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not remove from the care team.');
    } finally {
      setBusy(false);
    }
  };

  if (team === null) return <p className="muted">Loading the care team…</p>;
  const current = team.filter((a) => !a.valid_to);
  return (
    <div className="stack">
      <h2 className="panel-subtitle" style={{ marginTop: 0 }}>Care team</h2>
      {current.length === 0 ? <EmptyState icon={Users} title="No one on the care team" description="Clinicians appear here when they start work with this patient." /> : (
        <table className="mini-table">
          <thead><tr><th>Clinician</th><th>Role</th><th>Since</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {current.map((a) => (
              <tr key={a.id}>
                <td>{a.practitioner_name}</td>
                <td>{a.role}</td>
                <td className="tabular">{fmt(a.valid_from)}</td>
                <td className="text-right">{ADMINS.includes(role) && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => remove(a)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAdd && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="form-group"><label className="form-label" htmlFor="ct-pick">Add a doctor</label>
            <select id="ct-pick" className="form-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a doctor</option>
              {doctors.map((d) => <option key={d.user_id} value={d.user_id}>{d.display_name}</option>)}
            </select></div>
          <button type="button" className="btn btn-secondary btn-md" disabled={!pick || busy} onClick={add}><UserPlus size={16} aria-hidden="true" /> Add to care team</button>
        </div>
      )}
    </div>
  );
}
