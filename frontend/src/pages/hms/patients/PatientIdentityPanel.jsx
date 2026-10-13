import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, CircleSlash, IdCard, TriangleAlert, UserPlus, Users } from 'lucide-react';
import api from '../../../api/axios';
import EmptyState from '../../../components/ui/EmptyState';

const SYSTEM_LABEL = {
  UHID: 'UHID',
  ABHA_NUMBER: 'ABHA number',
  ABHA_ADDRESS: 'ABHA address',
  TEMPORARY: 'Temporary ID',
  EXTERNAL_MRN: 'External record no.',
  EMPLOYEE: 'Employee no.',
  PASSPORT: 'Passport',
};
const MANUAL_SYSTEMS = ['ABHA_NUMBER', 'ABHA_ADDRESS', 'EXTERNAL_MRN', 'EMPLOYEE', 'PASSPORT'];
const REGISTRATION_ROLES = ['super_admin', 'admin', 'receptionist'];
const fmt = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Shown above the tabs while a patient has only a temporary identity.
export function ConfirmIdentityBanner({ patient, onConfirmed }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', gender: 'Male', age: patient.age ?? '', dob: '', phoneNumber: '' });
  const [saving, setSaving] = useState(false);
  if (patient.identity_status !== 'temporary') return null;
  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.post(`/patients/hms/${patient.id}/confirm-identity`, {
        ...form, age: Number(form.age), dob: form.dob || undefined, phoneNumber: form.phoneNumber || undefined,
      });
      toast.success('Identity confirmed');
      setOpen(false);
      onConfirmed();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not confirm the identity.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="panel panel-pad" role="status" style={{ marginBottom: 16 }}>
      <div className="alert-strip alert-warning" style={{ marginBottom: open ? 12 : 0 }}>
        <TriangleAlert size={16} aria-hidden="true" />
        <span><strong>Temporary identity.</strong> This patient was registered without a confirmed name. Confirm the identity when it is known; the UHID and all records stay the same.</span>
        {!open && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Confirm identity</button>}
      </div>
      {open && (
        <form className="split-2" onSubmit={submit}>
          <div className="form-group"><label className="form-label" htmlFor="ci-name">Full name</label>
            <input id="ci-name" className="form-input" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ci-gender">Gender</label>
            <select id="ci-gender" className="form-input" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
              <option>Male</option><option>Female</option><option>Other</option></select></div>
          <div className="form-group"><label className="form-label" htmlFor="ci-age">Age (years)</label>
            <input id="ci-age" className="form-input" type="number" min="0" max="130" required value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ci-dob">Date of birth (if known)</label>
            <input id="ci-dob" className="form-input" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
          <div className="form-group"><label className="form-label" htmlFor="ci-phone">Phone (optional)</label>
            <input id="ci-phone" className="form-input" inputMode="numeric" maxLength={10} value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-md" disabled={saving}>{saving ? 'Saving…' : 'Confirm identity'}</button>
          </div>
        </form>
      )}
    </section>
  );
}

// Identity tab: identifiers (with verification) and related persons.
export default function PatientIdentityPanel({ patientId, role }) {
  const [identifiers, setIdentifiers] = useState(null);
  const [people, setPeople] = useState(null);
  const [failed, setFailed] = useState(false);
  const [idForm, setIdForm] = useState({ system: 'ABHA_NUMBER', value: '', issuer: '' });
  const [personForm, setPersonForm] = useState({ name: '', relationship: '', phone: '', isGuardian: false, isEmergencyContact: true });
  const [busy, setBusy] = useState(false);
  const canVerify = REGISTRATION_ROLES.includes(role);

  const load = async () => {
    try {
      const [ids, rel] = await Promise.all([
        api.get(`/patients/hms/${patientId}/identifiers`),
        api.get(`/patients/hms/${patientId}/related-persons`),
      ]);
      setIdentifiers(ids.data.data || []);
      setPeople(rel.data.data || []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => { load(); }, [patientId]);

  const run = async (action, success) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 6000 });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addIdentifier = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/patients/hms/${patientId}/identifiers`, { ...idForm, issuer: idForm.issuer || undefined }), 'Identifier recorded (unverified)');
    if (ok) setIdForm({ ...idForm, value: '', issuer: '' });
  };
  const addPerson = async (e) => {
    e.preventDefault();
    const ok = await run(() => api.post(`/patients/hms/${patientId}/related-persons`, { ...personForm, phone: personForm.phone || undefined }), 'Related person added');
    if (ok) setPersonForm({ name: '', relationship: '', phone: '', isGuardian: false, isEmergencyContact: true });
  };
  // A clash with another patient's verified identifier is answered 202: not
  // verified, and both records go to the possible-duplicates review.
  const verify = async (identifier) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/patients/hms/${patientId}/identifiers/${identifier.id}/verify`);
      if (data.verified === false) toast(data.message, { icon: '⚠️', duration: 8000 });
      else toast.success('Identifier verified');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'That did not work.', { duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const retire = (identifier) => {
    const reason = window.prompt(`Why is this ${SYSTEM_LABEL[identifier.system]} no longer valid?`);
    if (reason) run(() => api.post(`/patients/hms/${patientId}/identifiers/${identifier.id}/retire`, { reason }), 'Identifier retired');
  };

  if (failed) return <div className="panel-pad"><div className="alert-strip alert-warning" role="status"><TriangleAlert size={16} aria-hidden="true" /> Identity details could not be loaded, or your role cannot view them.</div></div>;
  if (!identifiers || !people) return <p className="muted panel-pad">Loading…</p>;

  return (
    <div className="panel-pad stack">
      <h2 className="panel-subtitle" style={{ marginTop: 0 }}>Identifiers</h2>
      <table className="mini-table">
        <thead><tr><th>Type</th><th>Value</th><th>Issued by</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {identifiers.map((i) => (
            <tr key={i.id} style={i.valid_to ? { opacity: 0.6 } : undefined}>
              <td>{SYSTEM_LABEL[i.system] || i.system}</td>
              <td className="mono">{i.value}</td>
              <td>{i.issuer}</td>
              <td>
                {i.valid_to
                  ? <span className="status status-neutral"><CircleSlash size={12} aria-hidden="true" /> Retired {fmt(i.valid_to)}</span>
                  : i.verification_status === 'verified'
                    ? <span className="status status-success"><BadgeCheck size={12} aria-hidden="true" /> Verified</span>
                    : <span className="status status-warning">Not verified</span>}
              </td>
              <td className="text-right">
                {!i.valid_to && canVerify && i.verification_status !== 'verified' && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => verify(i)}>Verify</button>
                )}
                {!i.valid_to && canVerify && i.system !== 'UHID' && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => retire(i)}>Retire</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={addIdentifier} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="form-group"><label className="form-label" htmlFor="id-system">Type</label>
          <select id="id-system" className="form-input" value={idForm.system} onChange={(e) => setIdForm({ ...idForm, system: e.target.value })}>
            {MANUAL_SYSTEMS.map((s) => <option key={s} value={s}>{SYSTEM_LABEL[s]}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label" htmlFor="id-value">Value</label>
          <input id="id-value" className="form-input" required maxLength={120} value={idForm.value} onChange={(e) => setIdForm({ ...idForm, value: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="id-issuer">Issued by{idForm.system.startsWith('ABHA') ? ' (default ABDM)' : ''}</label>
          <input id="id-issuer" className="form-input" maxLength={120} required={!idForm.system.startsWith('ABHA')} value={idForm.issuer} onChange={(e) => setIdForm({ ...idForm, issuer: e.target.value })} /></div>
        <button type="submit" className="btn btn-secondary btn-md" disabled={busy}><IdCard size={16} aria-hidden="true" /> Add identifier</button>
      </form>

      <h2 className="panel-subtitle">Guardians and contacts</h2>
      {people.length === 0 ? <EmptyState icon={Users} title="No related persons" description="Guardians and emergency contacts appear here." /> : (
        <table className="mini-table">
          <thead><tr><th>Name</th><th>Relationship</th><th>Phone</th><th>Role</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {people.map((r) => (
              <tr key={r.id} style={r.valid_to ? { opacity: 0.6 } : undefined}>
                <td>{r.name}{r.related_patient_uhid && <span className="mono muted"> ({r.related_patient_uhid})</span>}</td>
                <td>{r.relationship}</td>
                <td className="tabular">{r.phone || '—'}</td>
                <td>{[r.is_guardian && 'Guardian', r.is_emergency_contact && 'Emergency contact'].filter(Boolean).join(', ') || '—'}{r.valid_to && ` (ended ${fmt(r.valid_to)})`}</td>
                <td className="text-right">
                  {!r.valid_to && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => api.post(`/patients/hms/${patientId}/related-persons/${r.id}/end`), 'Relationship ended')}>End</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={addPerson} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="form-group"><label className="form-label" htmlFor="rp-name">Name</label>
          <input id="rp-name" className="form-input" required maxLength={100} value={personForm.name} onChange={(e) => setPersonForm({ ...personForm, name: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="rp-rel">Relationship</label>
          <input id="rp-rel" className="form-input" required maxLength={50} value={personForm.relationship} onChange={(e) => setPersonForm({ ...personForm, relationship: e.target.value })} /></div>
        <div className="form-group"><label className="form-label" htmlFor="rp-phone">Phone</label>
          <input id="rp-phone" className="form-input" inputMode="numeric" maxLength={10} value={personForm.phone} onChange={(e) => setPersonForm({ ...personForm, phone: e.target.value })} /></div>
        <label className="check-row"><input type="checkbox" checked={personForm.isGuardian} onChange={(e) => setPersonForm({ ...personForm, isGuardian: e.target.checked })} /> Guardian</label>
        <label className="check-row"><input type="checkbox" checked={personForm.isEmergencyContact} onChange={(e) => setPersonForm({ ...personForm, isEmergencyContact: e.target.checked })} /> Emergency contact</label>
        <button type="submit" className="btn btn-secondary btn-md" disabled={busy}><UserPlus size={16} aria-hidden="true" /> Add</button>
      </form>
    </div>
  );
}
