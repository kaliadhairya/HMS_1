import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BookOpen, GitCompareArrows, Upload } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { useAuth } from '../../../context/AuthContext';

const RELATIONSHIPS = [
  ['equivalent', 'Same meaning'],
  ['source-is-narrower-than-target', 'Local code is narrower'],
  ['source-is-broader-than-target', 'Local code is broader'],
  ['related-to', 'Related'],
];
const EMPTY_LOAD = { system: 'ICD10', version: '', format: 'tsv', releasedOn: '', source: '', licenceAck: '' };
const EMPTY_MAP = { sourceSystem: 'LOCAL-LAB', sourceCode: '', sourceDisplay: '', targetSystem: 'LOINC', targetCode: '', relationship: 'equivalent', provenance: '' };
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// Terminology releases and code mappings (Phase 6A). Releases come from the
// licensed files as published and never change; one release per system is
// active. A mapping from a local code to a standard one is used only after
// someone other than its proposer approves it.
export default function TerminologyPage() {
  const { user } = useAuth();
  const isAdmin = ['super_admin', 'admin'].includes(user?.role);
  const [systems, setSystems] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [filter, setFilter] = useState('Proposed');
  const [load, setLoad] = useState(EMPTY_LOAD);
  const [file, setFile] = useState(null);
  const [map, setMap] = useState(EMPTY_MAP);
  const [found, setFound] = useState([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.get('/terminology/systems'), api.get(`/terminology/mappings${filter ? `?status=${filter}` : ''}`)]);
      setSystems(s.data.data); setMappings(m.data.data);
    } catch (err) { toast.error(err.response?.data?.message || 'Could not load terminology.'); }
  }, [filter]);
  useEffect(() => { refresh(); }, [refresh]);

  const act = async (request, success) => {
    if (busy) return false;
    setBusy(true);
    try { await request(); toast.success(success); await refresh(); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); return false; }
    finally { setBusy(false); }
  };

  const findTarget = async (q) => {
    setMap((m) => ({ ...m, targetCode: q }));
    if (q.trim().length < 2) return setFound([]);
    try { setFound((await api.get(`/terminology/search?system=${map.targetSystem}&q=${encodeURIComponent(q)}&limit=8`)).data.data.concepts); }
    catch { setFound([]); }
  };

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Terminology" description="Code system releases (ICD-10, SNOMED CT, LOINC, UCUM) and reviewed mappings from local codes. Load only files the hospital is licensed to use." />

        <section className="panel" aria-label="Code systems">
          <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><BookOpen size={16} aria-hidden="true" /> Releases</h2></div>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>System</th><th>Release</th><th>Status</th><th style={{ textAlign: 'right' }}>Concepts</th><th>Source and licence</th><th>Loaded</th><th /></tr></thead>
              <tbody>
                {systems.map((s) => (s.releases.length ? s.releases : [null]).map((r, i) => (
                  <tr key={r?.id || s.id}>
                    <td>{i === 0 ? <><strong>{s.name}</strong><div className="cell-secondary mono">{s.uri}</div></> : ''}</td>
                    {r ? (
                      <>
                        <td>{r.version}{r.released_on && <div className="cell-secondary">{r.released_on}</div>}</td>
                        <td><span className={`status ${r.status === 'Active' ? 'status-success' : r.status === 'Loaded' ? 'status-warning' : 'status-neutral'}`}>{r.status}</span></td>
                        <td className="tabular" style={{ textAlign: 'right' }}>{Number(r.concept_count).toLocaleString('en-IN')}</td>
                        <td className="cell-secondary">{r.source}<div>{r.licence_ack}</div></td>
                        <td className="cell-secondary">{r.loaded_by}, {when(r.loaded_at)}<div className="mono" title={r.file_sha256}>{r.file_name} · {r.file_sha256.slice(0, 12)}…</div></td>
                        <td>{isAdmin && r.status === 'Loaded' && (
                          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
                            if (window.confirm(`Make ${s.name} ${r.version} the active release? New codes will come from it; earlier records keep their release.`)) act(() => api.post(`/terminology/releases/${r.id}/activate`, {}), `${s.name} ${r.version} is active`);
                          }}>Activate</button>
                        )}</td>
                      </>
                    ) : <td colSpan={6} className="cell-secondary">No release loaded. {s.licence}.</td>}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          {isAdmin && (
            <form className="panel-pad" onSubmit={async (e) => {
              e.preventDefault();
              if (!file) return toast.error('Choose the release file.');
              const body = new FormData();
              Object.entries(load).forEach(([k, v]) => v && body.append(k, v));
              body.append('file', file);
              if (await act(() => api.post('/terminology/releases', body), 'Release loaded. Check it, then activate it.')) { setLoad(EMPTY_LOAD); setFile(null); e.target.reset(); }
            }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
              <h3 className="panel-subtitle" style={{ gridColumn: '1 / -1' }}><Upload size={14} aria-hidden="true" /> Load a release (files over 50 MB: use <span className="mono">scripts/terminology-load.js</span> on the server)</h3>
              <div className="form-group"><label className="form-label" htmlFor="tl-system">System</label>
                <select id="tl-system" className="form-select" value={load.system} onChange={(e) => setLoad({ ...load, system: e.target.value })}>{systems.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-version">Version or edition</label><input id="tl-version" className="form-input" required value={load.version} onChange={(e) => setLoad({ ...load, version: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-date">Release date</label><input id="tl-date" type="date" className="form-input" value={load.releasedOn} onChange={(e) => setLoad({ ...load, releasedOn: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-format">File format</label>
                <select id="tl-format" className="form-select" value={load.format} onChange={(e) => setLoad({ ...load, format: e.target.value })}>
                  <option value="tsv">Code and name, tab separated</option><option value="loinc-csv">Loinc.csv</option><option value="snomed-rf2">SNOMED CT RF2 descriptions</option>
                </select></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-source">Where the file comes from</label><input id="tl-source" className="form-input" required minLength={5} value={load.source} onChange={(e) => setLoad({ ...load, source: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-licence">Licence accepted by</label><input id="tl-licence" className="form-input" required minLength={5} placeholder="Name, licence, date" value={load.licenceAck} onChange={(e) => setLoad({ ...load, licenceAck: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="tl-file">File</label><input id="tl-file" type="file" className="form-input" required onChange={(e) => setFile(e.target.files[0] || null)} /></div>
              <button type="submit" className="btn btn-secondary btn-md" disabled={busy}>Load release</button>
            </form>
          )}
        </section>

        <section className="panel" aria-label="Mappings" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><GitCompareArrows size={16} aria-hidden="true" /> Mappings from local codes</h2>
            <select className="form-select" aria-label="Show mappings" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="Proposed">Waiting for review</option><option value="Approved">Approved</option><option value="Rejected">Rejected</option><option value="Retired">Retired</option><option value="">All</option>
            </select>
          </div>
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>Local code</th><th>Maps to</th><th>Relationship</th><th>Based on</th><th>Proposed</th><th>Review</th></tr></thead>
              <tbody>
                {!mappings.length && <tr><td colSpan={6} className="cell-secondary">Nothing here.</td></tr>}
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td><span className="mono">{m.source_system} {m.source_code}</span><div>{m.source_display}</div></td>
                    <td><span className="mono">{m.target_system} {m.target_code}</span><div>{m.target_display}</div><div className="cell-secondary">release {m.target_version}</div></td>
                    <td>{RELATIONSHIPS.find(([k]) => k === m.relationship)?.[1]}</td>
                    <td className="cell-secondary">{m.provenance}</td>
                    <td className="cell-secondary">{m.proposed_by}, {when(m.proposed_at)}</td>
                    <td>
                      {m.status === 'Proposed' && (m.proposed_by_user_id === user?.id
                        ? <span className="cell-secondary">Needs another reviewer</span>
                        : <span className="inline-actions">
                          {['Approved', 'Rejected'].map((d) => (
                            <button key={d} type="button" className={`btn btn-sm ${d === 'Approved' ? 'btn-primary' : 'btn-secondary'}`} disabled={busy} onClick={() => {
                              const reason = window.prompt(`${d === 'Approved' ? 'Approve' : 'Reject'} this mapping. Reason:`);
                              if (reason && reason.trim().length >= 3) act(() => api.post(`/terminology/mappings/${m.id}/review`, { decision: d, reason }), `Mapping ${d.toLowerCase()}`);
                            }}>{d === 'Approved' ? 'Approve' : 'Reject'}</button>
                          ))}
                        </span>)}
                      {m.status !== 'Proposed' && <><span className="status status-neutral">{m.status}</span>{m.reviewed_by && <div className="cell-secondary">{m.reviewed_by}: {m.review_reason}</div>}</>}
                      {m.status === 'Approved' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                        if (window.confirm('Retire this mapping? It will no longer be used for exchange.')) act(() => api.post(`/terminology/mappings/${m.id}/review`, { decision: 'Retired' }), 'Mapping retired');
                      }}>Retire</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form className="panel-pad" onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => api.post('/terminology/mappings', map), 'Mapping proposed; someone else must review it')) { setMap(EMPTY_MAP); setFound([]); }
          }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', alignItems: 'end' }}>
            <h3 className="panel-subtitle" style={{ gridColumn: '1 / -1' }}>Propose a mapping</h3>
            <div className="form-group"><label className="form-label" htmlFor="mp-ss">Local code system</label><input id="mp-ss" className="form-input" required pattern="LOCAL-[A-Z0-9\-]{2,40}" value={map.sourceSystem} onChange={(e) => setMap({ ...map, sourceSystem: e.target.value.toUpperCase() })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="mp-sc">Local code</label><input id="mp-sc" className="form-input" required value={map.sourceCode} onChange={(e) => setMap({ ...map, sourceCode: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="mp-sd">Local name</label><input id="mp-sd" className="form-input" required value={map.sourceDisplay} onChange={(e) => setMap({ ...map, sourceDisplay: e.target.value })} /></div>
            <div className="form-group"><label className="form-label" htmlFor="mp-ts">Standard system</label>
              <select id="mp-ts" className="form-select" value={map.targetSystem} onChange={(e) => { setMap({ ...map, targetSystem: e.target.value, targetCode: '' }); setFound([]); }}>
                {systems.filter((s) => s.releases.some((r) => r.status === 'Active')).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select></div>
            <div className="form-group" style={{ position: 'relative' }}><label className="form-label" htmlFor="mp-tc">Standard code (search)</label>
              <input id="mp-tc" className="form-input" required autoComplete="off" value={map.targetCode} onChange={(e) => findTarget(e.target.value)} />
              {!!found.length && (
                <ul className="panel" role="listbox" style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, margin: 0, padding: 4, listStyle: 'none', maxHeight: 220, overflowY: 'auto' }}>
                  {found.map((c) => <li key={c.code}><button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }} disabled={!c.active} onClick={() => { setMap({ ...map, targetCode: c.code }); setFound([]); }}><span className="mono">{c.code}</span>&nbsp;{c.display}{!c.active && ' (inactive)'}</button></li>)}
                </ul>
              )}</div>
            <div className="form-group"><label className="form-label" htmlFor="mp-rel">Relationship</label>
              <select id="mp-rel" className="form-select" value={map.relationship} onChange={(e) => setMap({ ...map, relationship: e.target.value })}>{RELATIONSHIPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="form-group"><label className="form-label" htmlFor="mp-prov">Based on</label><input id="mp-prov" className="form-input" required minLength={5} value={map.provenance} onChange={(e) => setMap({ ...map, provenance: e.target.value })} /></div>
            <button type="submit" className="btn btn-secondary btn-md" disabled={busy}>Propose</button>
          </form>
        </section>
      </main>
    </>
  );
}
