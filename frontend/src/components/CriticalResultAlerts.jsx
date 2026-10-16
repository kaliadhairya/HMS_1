import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';

const CLINICAL = ['doctor', 'nurse'];

// Critical laboratory results for the signed-in clinician (completion C2).
// The laboratory sends a live event to the clinician it is trying to reach;
// until now no screen listened, so the alert never appeared. This banner
// stays until the result is acknowledged in Critical follow-up (it is not a
// toast that fades), says CRITICAL in words and with an icon rather than
// colour alone, and is announced by screen readers. It also shows results
// still waiting from before this sign-in.
export default function CriticalResultAlerts() {
  const { user } = useAuth();
  const socket = useSocket();
  const [open, setOpen] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!user || !CLINICAL.includes(user.role)) return;
    try {
      const tasks = (await api.get('/laboratory/critical-tasks')).data?.data || [];
      const mine = tasks.filter((t) => t.state === 'OPEN' && Number(t.assigned_user_id) === Number(user.id));
      const withPatients = await Promise.all(mine.map(async (t) => {
        try {
          const p = (await api.get(`/patients/hms/${t.patient_id}`)).data;
          const patient = p?.data || p;
          return { ...t, patient_name: patient?.name, uhid: patient?.uhid };
        } catch { return t; }
      }));
      setOpen(withPatients);
    } catch { /* the laboratory workspace remains the authoritative list */ }
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const onCritical = () => load();
    socket.on('lab_critical_result', onCritical);
    return () => socket.off('lab_critical_result', onCritical);
  }, [socket, load]);
  useEffect(() => {
    if (!open.length) return undefined;
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [open.length, load]);

  const shown = open.filter((t) => !hidden.has(t.id));
  if (!shown.length) return null;
  return (
    <div role="alert" aria-label="Critical laboratory results" className="critical-alerts"
      style={{ position: 'relative', zIndex: 60, background: 'var(--red, #b91c1c)', color: '#fff', padding: '10px 16px', display: 'grid', gap: 6 }}>
      {shown.map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Siren size={18} aria-hidden="true" />
          <strong>CRITICAL RESULT</strong>
          <span>
            {t.patient_name ? `${t.patient_name}${t.uhid ? ` (${t.uhid})` : ''}` : `Patient ${t.patient_id}`}
            {' '}— reported {new Date(t.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}. Review and acknowledge it now.
          </span>
          <Link to="/lab/governed?tab=critical" className="btn btn-sm" style={{ background: '#fff', color: '#7f1d1d', fontWeight: 700 }}>Open critical follow-up</Link>
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: '#fff' }} onClick={() => setHidden((h) => new Set(h).add(t.id))}
            aria-label={`Hide this alert for ${t.patient_name || `patient ${t.patient_id}`} until the next sign-in (the result stays open)`}>Hide</button>
        </div>
      ))}
    </div>
  );
}
