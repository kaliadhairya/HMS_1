import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../api/axios';
import { useLaboratoryCommand } from '../lab/laboratoryCommand';

export default forwardRef(function CodedLabOrderPanel({ patientId, encounterId, onPendingChange }, ref) {
  const [catalogue, setCatalogue] = useState([]);
  const [selected, setSelected] = useState([]);
  const [priority, setPriority] = useState('Routine');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const command = useLaboratoryCommand(async () => setSelected([]));

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get('/laboratory/catalogue').then((response) => {
      if (active) { setCatalogue(response.data.data || []); setLoadError(''); }
    }).catch(() => {
      if (active) setLoadError('The approved test catalogue could not be loaded. Ordering is unavailable.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    onPendingChange?.(selected.length > 0 || command.busy || command.uncertain);
  }, [selected, command.busy, command.uncertain, onPendingChange]);

  async function submitPending() {
    if (command.busy || command.uncertain) return false;
    if (!selected.length) return true;
    const result = await command.send('/orders', {
      patient_id: Number(patientId), encounter_id: Number(encounterId),
      test_version_ids: selected, priority,
    });
    return Boolean(result);
  }
  useImperativeHandle(ref, () => ({ submitPending }));
  const disabled = loading || Boolean(loadError) || command.busy || command.uncertain;
  return (
    <section className="panel" aria-label="Coded laboratory ordering" style={{ padding: 16 }}>
      <h3 className="panel-subtitle">Order approved tests and panels</h3>
      {loadError && <p role="alert">{loadError}</p>}
      {loading && <p role="status">Loading the approved catalogue…</p>}
      {!loading && !loadError && !catalogue.length && <p role="status">No approved tests are available. Ask the laboratory to approve its catalogue.</p>}
      <form onSubmit={(event) => { event.preventDefault(); submitPending(); }}>
        <div className="form-group">
          <label className="form-label" htmlFor="consultation-coded-tests">Approved tests and panels</label>
          <select id="consultation-coded-tests" multiple className="form-select" disabled={disabled}
            value={selected} onChange={(event) => setSelected([...event.target.selectedOptions].map((option) => option.value))}>
            {catalogue.map((test) => <option key={test.id} value={test.id}>{test.code} · {test.name} · version {test.version}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="consultation-lab-priority">Priority</label>
          <select id="consultation-lab-priority" className="form-select" disabled={disabled} value={priority} onChange={(event) => setPriority(event.target.value)}>
            {['Routine', 'Urgent', 'STAT'].map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" disabled={disabled || !selected.length}>Send coded tests to laboratory</button>
      </form>
      {command.message && <p role={command.uncertain ? 'alert' : 'status'}>{command.message}</p>}
      {command.uncertain && <button type="button" className="btn btn-secondary" disabled={command.busy} onClick={command.reconcile}>Reconcile original lab order</button>}
      <Link to={`/lab/governed?patient_id=${encodeURIComponent(patientId)}`}>Review laboratory results and outstanding tasks</Link>
    </section>
  );
});
