import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Cable, KeyRound } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { useAuth } from '../../../context/AuthContext';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const EMPTY = { system: 'analyzer:', protocol: 'hl7v2', description: '', provenance: '', serviceUserId: '', ownerRole: '', mllpPort: '', allowedHosts: '', codeMap: '' };

// Device contracts (Phase 6F): a device may send results only under an
// approved contract that names its interface manual and maps its codes to
// catalogue tests. One person drafts, another approves; the device key is
// shown once at approval.
export default function DeviceContractsPage() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [shownKey, setShownKey] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setContracts((await api.get('/devices')).data.data); } catch (e) { toast.error(e.response?.data?.message || 'Could not load device contracts.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (fn, ok) => { if (busy) return null; setBusy(true); try { const r = await fn(); if (ok) toast.success(ok); await load(); return r; } catch (e) { toast.error(e.response?.data?.message || 'That did not work.', { duration: 9000 }); return null; } finally { setBusy(false); } };

  // Code map typed one per line: DEVICE_CODE = CODE_SYSTEM|CODE|METHOD
  const parseMap = (text) => Object.fromEntries(text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [code, target] = l.split('=').map((x) => x.trim());
    const [labCodeSystem, labCode, method] = (target || '').split('|').map((x) => x.trim());
    return [code, { lab_code_system: labCodeSystem, lab_code: labCode, method }];
  }));

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Device interfaces" description="Analyzers and other devices connect only under an approved, versioned contract. Codes map to catalogue tests; nothing is matched by name." />
        {shownKey && (
          <section className="panel panel-pad" role="alert" style={{ borderColor: 'var(--amber-border)' }}>
            <p><KeyRound size={16} aria-hidden="true" /> <strong>Device key for {shownKey.system}</strong> — copy it into the device or interface engine now. It is not shown again.</p>
            <p className="mono" style={{ wordBreak: 'break-all' }}>{shownKey.key}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShownKey(null)}>I have stored it</button>
          </section>
        )}
        <section className="panel" aria-label="Contracts" style={{ marginTop: 16 }}>
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Cable size={16} aria-hidden="true" /> Contracts</h2></div>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>Device</th><th>Protocol</th><th>Codes</th><th>Based on</th><th>Status</th><th /></tr></thead>
              <tbody>
                {!contracts.length && <tr><td colSpan={6} className="cell-secondary">No devices yet.</td></tr>}
                {contracts.map((c) => (
                  <tr key={c.id}>
                    <td><span className="mono">{c.system}</span> v{c.version}<div className="cell-secondary">{c.description}</div></td>
                    <td>{c.protocol === 'hl7v2' ? 'HL7 v2' : 'ASTM'}{c.mllp_port && <div className="cell-secondary">MLLP port {c.mllp_port}</div>}</td>
                    <td className="cell-secondary">{Object.entries(c.code_map || {}).map(([k, v]) => `${k} → ${v.lab_code}`).join(', ') || '—'}</td>
                    <td className="cell-secondary">{c.provenance}<div>drafted by {c.created_by}{c.approved_by ? `, approved by ${c.approved_by} ${when(c.approved_at)}` : ''}</div></td>
                    <td><span className={`status ${c.status === 'Active' ? 'status-success' : c.status === 'Draft' ? 'status-warning' : 'status-neutral'}`}>{c.status}</span></td>
                    <td>
                      {c.status === 'Draft' && (c.created_by === user?.name
                        ? <span className="cell-secondary">Needs another approver</span>
                        : <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => {
                          if (!window.confirm(`Approve ${c.system} v${c.version}? Its results will reach the laboratory as provisional analyzer results.`)) return;
                          const r = await run(() => api.post(`/devices/${c.id}/approve`, {}), 'Contract approved');
                          if (r) setShownKey({ system: c.system, key: r.data.data.device_key });
                        }}>Approve</button>)}
                      {c.status === 'Active' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                        if (window.confirm(`Retire ${c.system} v${c.version}? The device can send nothing until a new version is approved.`)) run(() => api.post(`/devices/${c.id}/retire`, {}), 'Contract retired');
                      }}>Retire</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="panel-pad" onSubmit={(e) => {
            e.preventDefault();
            run(() => api.post('/devices', {
              system: form.system.trim(), protocol: form.protocol, description: form.description, provenance: form.provenance,
              serviceUserId: form.serviceUserId ? Number(form.serviceUserId) : undefined, ownerRole: form.ownerRole || undefined,
              mllpPort: form.mllpPort ? Number(form.mllpPort) : undefined, allowedHosts: form.allowedHosts.split(',').map((x) => x.trim()).filter(Boolean), codeMap: parseMap(form.codeMap),
            }), 'Draft saved; someone else must approve it').then((r) => r && setForm(EMPTY));
          }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
            <h3 className="panel-subtitle" style={{ gridColumn: '1 / -1' }}>Draft a contract (or a new version)</h3>
            <div className="form-group"><label className="form-label" htmlFor="dc-system">Device (kind:name)</label><input id="dc-system" className="form-input mono" required value={form.system} onChange={(e) => setForm({ ...form, system: e.target.value.toLowerCase() })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="dc-proto">Protocol</label>
              <select id="dc-proto" className="form-select" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}><option value="hl7v2">HL7 v2</option><option value="astm">ASTM E1394</option></select></div>
            <div className="form-group"><label className="form-label" htmlFor="dc-desc">Description</label><input id="dc-desc" className="form-input" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="dc-prov">Interface manual and version</label><input id="dc-prov" className="form-input" required minLength={5} value={form.provenance} onChange={(e) => setForm({ ...form, provenance: e.target.value })} /></div>
            {form.system.startsWith('analyzer:') && <div className="form-group"><label className="form-label" htmlFor="dc-svc">Analyzer account (user id, ANALYZER grant)</label><input id="dc-svc" className="form-input" inputMode="numeric" required value={form.serviceUserId} onChange={(e) => setForm({ ...form, serviceUserId: e.target.value.replace(/\D/g, '') })} /></div>}
            <div className="form-group"><label className="form-label" htmlFor="dc-port">MLLP port (optional)</label><input id="dc-port" className="form-input" inputMode="numeric" value={form.mllpPort} onChange={(e) => setForm({ ...form, mllpPort: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="dc-hosts">Allowed device addresses</label><input id="dc-hosts" className="form-input" placeholder="10.0.0.21, 10.0.0.22" value={form.allowedHosts} onChange={(e) => setForm({ ...form, allowedHosts: e.target.value })} /></div>
            {form.system.startsWith('analyzer:') && (
              <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label" htmlFor="dc-map">Test codes, one per line</label>
                <textarea id="dc-map" className="form-input mono" rows={3} placeholder="GLU = LOCAL-LAB|GLU-F|Hexokinase" value={form.codeMap} onChange={(e) => setForm({ ...form, codeMap: e.target.value })} />
                <p className="form-hint">DEVICE_CODE = catalogue code system|catalogue code|method (as in the device manual).</p></div>
            )}
            <button type="submit" className="btn btn-secondary btn-md" disabled={busy}>Save draft</button>
          </form>
        </section>
      </main>
    </>
  );
}
