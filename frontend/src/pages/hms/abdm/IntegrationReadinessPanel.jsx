import { useEffect, useState } from 'react';
import { PlugZap } from 'lucide-react';
import api from '../../../api/axios';

const TONE = { ok: 'status-success', warning: 'status-warning', blocked: 'status-danger', off: 'status-neutral' };
const WORD = { ok: 'Ready', warning: 'Check', blocked: 'Not ready', off: 'Off' };

// ABDM and terminology readiness for administrators (completion B2).
export default function IntegrationReadinessPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/integrations/readiness').then((r) => setData(r.data.data)).catch((e) => setError(e.response?.data?.message || 'Readiness could not be checked.'));
  }, []);
  return (
    <section className="panel panel-pad stack-sm" aria-label="Connection readiness" style={{ marginBottom: 16 }}>
      <h2 className="panel-title"><PlugZap size={16} aria-hidden="true" /> Connection readiness</h2>
      {error && <p className="alert-strip alert-danger" role="alert">{error}</p>}
      {data && (
        <>
          <div className="dt-scroll"><table className="dt-table">
            <thead><tr><th scope="col">Area</th><th scope="col">Check</th><th scope="col">State</th><th scope="col">Detail</th></tr></thead>
            <tbody>{data.checks.map((c) => (
              <tr key={`${c.area}:${c.item}`}><td>{c.area}</td><td>{c.item}</td><td><span className={`status ${TONE[c.status]}`}>{WORD[c.status]}</span></td><td className="cell-secondary">{c.detail}</td></tr>
            ))}</tbody>
          </table></div>
          <p className="cell-secondary">Outside HMS's control: {data.external_gates.join(' ')}</p>
        </>
      )}
    </section>
  );
}
