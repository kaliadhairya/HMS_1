import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BedDouble, ClipboardCheck, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const NEXT_STATUS = { Dirty: 'Cleaning', Cleaning: 'Available' };
const EMPTY_PLAN = { destination: '', instructions: '', pendingResults: '', resultsOwnerUserId: '', followUpOwnerUserId: '' };

// Beds, moves between beds, and discharge planning. Clinical readiness (the
// doctor) and financial clearance (billing) are recorded separately.
export default function AdmissionMovesPage() {
  const { user } = useAuth();
  const [wards, setWards] = useState([]);
  const [wardId, setWardId] = useState('');
  const [beds, setBeds] = useState([]);
  const [admissionId, setAdmissionId] = useState('');
  const [toBed, setToBed] = useState('');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState(null);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/ipd/wards').then((r) => setWards(r.data.data || [])).catch(() => toast.error('Could not load wards.'));
  }, []);
  useEffect(() => {
    if (!wardId) return;
    api.get('/ipd/beds', { params: { ward_id: wardId } }).then((r) => setBeds(r.data.data || [])).catch(() => setBeds([]));
  }, [wardId]);

  const reloadBeds = () => wardId && api.get('/ipd/beds', { params: { ward_id: wardId } }).then((r) => setBeds(r.data.data || []));

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try {
      await request();
      toast.success(success);
      await reloadBeds();
      if (admissionId) await loadPlan(admissionId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 7000 });
    } finally {
      setBusy(false);
    }
  };

  const loadPlan = async (id) => {
    try {
      const { data } = await api.get(`/adt/admissions/${id}/discharge-plan`);
      setPlan(data.data);
      setPlanForm(data.data ? {
        destination: data.data.destination || '', instructions: data.data.instructions || '',
        pendingResults: data.data.pending_results || '', resultsOwnerUserId: data.data.results_owner_user_id || '',
        followUpOwnerUserId: data.data.follow_up_owner_user_id || '',
      } : EMPTY_PLAN);
    } catch {
      toast.error('Could not load the discharge plan.');
    }
  };

  const transfer = (e) => {
    e.preventDefault();
    act(() => api.post(`/adt/admissions/${admissionId}/transfer`, { toBedId: Number(toBed), reason }), 'Patient moved');
    setReason('');
  };
  const savePlan = (e) => {
    e.preventDefault();
    act(() => api.put(`/adt/admissions/${admissionId}/discharge-plan`, {
      destination: planForm.destination || undefined, instructions: planForm.instructions || undefined,
      pendingResults: planForm.pendingResults || undefined,
      resultsOwnerUserId: planForm.resultsOwnerUserId ? Number(planForm.resultsOwnerUserId) : undefined,
      followUpOwnerUserId: planForm.followUpOwnerUserId ? Number(planForm.followUpOwnerUserId) : undefined,
    }), 'Discharge plan saved');
  };

  const canMoveBeds = ['super_admin', 'admin', 'nurse', 'doctor'].includes(user?.role);
  const canDoctorPlan = ['super_admin', 'admin', 'doctor'].includes(user?.role);
  const canClear = ['super_admin', 'admin', 'receptionist'].includes(user?.role);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Beds, moves and discharge" description="Moving a patient sends the old bed to cleaning. A bed becomes ready again only after cleaning." />
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'start' }}>
          <section className="panel panel-pad stack">
            <h2 className="panel-subtitle" style={{ marginTop: 0 }}><BedDouble size={16} aria-hidden="true" /> Beds</h2>
            <div className="form-group"><label className="form-label" htmlFor="adt-ward">Ward</label>
              <select id="adt-ward" className="form-input" value={wardId} onChange={(e) => setWardId(e.target.value)}>
                <option value="">Choose a ward</option>
                {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></div>
            {beds.length > 0 && (
              <table className="mini-table">
                <thead><tr><th>Bed</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {beds.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{b.bed_number || b.BED_NUMBER || b.id}</td>
                      <td>{b.status || b.STATUS}</td>
                      <td className="text-right">
                        {canMoveBeds && NEXT_STATUS[b.status || b.STATUS] && (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
                            onClick={() => act(() => api.post(`/adt/beds/${b.id}/status`, { status: NEXT_STATUS[b.status || b.STATUS] }), 'Bed updated')}>
                            Mark {NEXT_STATUS[b.status || b.STATUS].toLowerCase()}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canMoveBeds && (
              <form onSubmit={transfer} className="stack">
                <h3 className="panel-subtitle">Move a patient</h3>
                <div className="form-group"><label className="form-label" htmlFor="mv-adm">Admission ID</label>
                  <input id="mv-adm" className="form-input" required inputMode="numeric" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)} /></div>
                <div className="form-group"><label className="form-label" htmlFor="mv-bed">Move to bed ID</label>
                  <input id="mv-bed" className="form-input" required inputMode="numeric" value={toBed} onChange={(e) => setToBed(e.target.value)} /></div>
                <div className="form-group"><label className="form-label" htmlFor="mv-reason">Reason</label>
                  <input id="mv-reason" className="form-input" required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
                <button type="submit" className="btn btn-primary btn-md" disabled={busy}>Move patient</button>
              </form>
            )}
          </section>

          <section className="panel panel-pad stack">
            <h2 className="panel-subtitle" style={{ marginTop: 0 }}><ClipboardCheck size={16} aria-hidden="true" /> Discharge plan</h2>
            <div className="form-group"><label className="form-label" htmlFor="dp-adm">Admission ID</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="dp-adm" className="form-input" inputMode="numeric" value={admissionId} onChange={(e) => setAdmissionId(e.target.value)} />
                <button type="button" className="btn btn-secondary btn-md" onClick={() => admissionId && loadPlan(admissionId)}>Open</button>
              </div></div>
            {plan && (
              <p className="muted">
                Clinical readiness: {plan.clinical_ready_at ? `ready ${new Date(plan.clinical_ready_at).toLocaleString('en-IN')}` : 'not yet ready'} ·
                Financial clearance: {plan.financial_clearance === 'cleared' ? 'cleared' : 'pending'}
              </p>
            )}
            {canDoctorPlan && admissionId && (
              <form onSubmit={savePlan} className="stack">
                <div className="form-group"><label className="form-label" htmlFor="dp-dest">Destination</label>
                  <input id="dp-dest" className="form-input" maxLength={200} value={planForm.destination} onChange={(e) => setPlanForm({ ...planForm, destination: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="dp-instr">Instructions</label>
                  <textarea id="dp-instr" className="form-input" rows={3} maxLength={2000} value={planForm.instructions} onChange={(e) => setPlanForm({ ...planForm, instructions: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="dp-pending">Results pending after discharge</label>
                  <input id="dp-pending" className="form-input" maxLength={1000} value={planForm.pendingResults} onChange={(e) => setPlanForm({ ...planForm, pendingResults: e.target.value })} /></div>
                <div className="form-group"><label className="form-label" htmlFor="dp-owner">Owner of those results (user ID)</label>
                  <input id="dp-owner" className="form-input" inputMode="numeric" value={planForm.resultsOwnerUserId} onChange={(e) => setPlanForm({ ...planForm, resultsOwnerUserId: e.target.value })} /></div>
                <button type="submit" className="btn btn-secondary btn-md" disabled={busy}>Save plan</button>
              </form>
            )}
            {canDoctorPlan && admissionId && plan && !plan.clinical_ready_at && (
              <button type="button" className="btn btn-primary btn-md" disabled={busy}
                onClick={() => act(() => api.post(`/adt/admissions/${admissionId}/discharge-plan/clinically-ready`), 'Marked clinically ready')}>
                Mark clinically ready
              </button>
            )}
            {canClear && admissionId && plan && plan.financial_clearance !== 'cleared' && (
              <button type="button" className="btn btn-secondary btn-md" disabled={busy}
                onClick={() => act(() => api.post(`/adt/admissions/${admissionId}/discharge-plan/cleared`), 'Financial clearance recorded')}>
                <Wallet size={16} aria-hidden="true" /> Record financial clearance
              </button>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
