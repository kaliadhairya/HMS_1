import { useEffect, useState } from 'react';
import api from '../../../api/axios';

// Finds a patient by name, UHID or phone (the registration search).
export default function PatientPicker({ value, onChange, label = 'Patient' }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  useEffect(() => {
    if (value || q.trim().length < 3) { setFound([]); return undefined; }
    const h = setTimeout(async () => {
      try { setFound(((await api.get(`/patients/hms/search?q=${encodeURIComponent(q.trim())}`)).data.data || []).slice(0, 8)); } catch { setFound([]); }
    }, 350);
    return () => clearTimeout(h);
  }, [q, value]);
  if (value) {
    return (
      <div className="inline-actions" style={{ alignItems: 'center' }}>
        <span><strong>{value.name || value.patient_name}</strong> <span className="mono cell-secondary">{value.uhid}</span></span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }
  return (
    <div className="form-group" style={{ position: 'relative', maxWidth: 420 }}>
      <label className="form-label" htmlFor="pp-q">{label}</label>
      <input id="pp-q" className="form-input" placeholder="Name, UHID or phone" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      {!!found.length && (
        <ul className="panel" role="listbox" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 4, listStyle: 'none' }}>
          {found.map((p) => (
            <li key={p.id}><button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => onChange(p)}>
              {p.name || p.patient_name} <span className="mono cell-secondary">&nbsp;{p.uhid}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
