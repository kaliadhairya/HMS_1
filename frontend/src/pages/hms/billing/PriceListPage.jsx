import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Building2, ListOrdered, Package } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { inr } from '../../../components/billing/InvoicePaper';

const CATEGORIES = ['Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service'];
const EMPTY_ITEM = { code: '', name: '', category: 'Procedure', unitPrice: '', gstRate: 0, wardType: '', matchName: '', labTestCode: '' };

// Price list (charge master), packages and payers (Phase 5). A price list is
// edited as a draft version and activated by an administrator; active and
// retired versions never change, so every charge keeps the price it had.
export default function PriceListPage() {
  const [versions, setVersions] = useState([]);
  const [packages, setPackages] = useState([]);
  const [payers, setPayers] = useState([]);
  const [item, setItem] = useState(EMPTY_ITEM);
  const [pkg, setPkg] = useState({ code: '', name: '', price: '', provenance: '', rules: 'include Lab qty 1\ninclude Consultation\nexclude Procedure' });
  const [payer, setPayer] = useState({ code: '', name: '', kind: 'insurer' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [v, p, y] = await Promise.all([api.get('/finance/charge-master'), api.get('/finance/packages'), api.get('/finance/payers')]);
      setVersions(v.data.data); setPackages(p.data.data); setPayers(y.data.data);
    } catch (err) { toast.error(err.response?.data?.message || 'Could not load the price list.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (request, success) => {
    if (busy) return;
    setBusy(true);
    try { await request(); toast.success(success); await load(); return true; }
    catch (err) { toast.error(err.response?.data?.message || 'That did not work.', { duration: 8000 }); return false; }
    finally { setBusy(false); }
  };

  const draft = versions.find((v) => v.status === 'Draft');
  const active = versions.find((v) => v.status === 'Active');
  const shown = draft || active;

  // Rules typed one per line: "include|exclude <Category> [code <CODE>] [qty <n>|amount <n>]".
  const parseRules = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [rule, category, ...rest] = l.split(/\s+/);
    const opt = {};
    for (let i = 0; i < rest.length; i += 2) opt[rest[i]] = rest[i + 1];
    return { rule, category, code: opt.code, allowanceQuantity: opt.qty ? Number(opt.qty) : undefined, allowanceAmount: opt.amount ? Number(opt.amount) : undefined };
  });

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Price list" description="Charge master versions, packages and insurance payers. Prices come from the hospital's approved tariff; record where they come from." />

        <section className="panel" aria-label="Charge master">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><ListOrdered size={16} aria-hidden="true" /> {shown ? `Version ${shown.version} (${shown.status})` : 'Price list'}</h2>
            <span className="inline-actions">
              {!draft && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => {
                const provenance = window.prompt('Where do the new prices come from? (for example the tariff circular and its date)');
                if (provenance && provenance.trim().length >= 5) act(() => api.post('/finance/charge-master/versions', { provenance }), 'Draft price list started');
              }}>Start new version</button>}
              {draft && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => {
                if (window.confirm(`Activate version ${draft.version}? New charges will use it; earlier charges keep their prices.`)) act(() => api.post(`/finance/charge-master/versions/${draft.id}/activate`, {}), 'Price list activated');
              }}>Activate version {draft.version}</button>}
            </span>
          </div>
          {shown && <p className="panel-pad cell-secondary" style={{ paddingBottom: 0 }}>{shown.provenance}</p>}
          <div className="dt-scroll">
            <table className="dt-table">
              <thead><tr><th>Code</th><th>Name</th><th>Category</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>GST %</th><th>Applies to</th></tr></thead>
              <tbody>
                {(shown?.items || []).map((i) => (
                  <tr key={i.id}><td className="mono">{i.code}</td><td>{i.name}</td><td>{i.category}</td><td className="tabular" style={{ textAlign: 'right' }}>{inr(i.unit_price)}</td>
                    <td className="tabular" style={{ textAlign: 'right' }}>{Number(i.gst_rate)}</td>
                    <td className="cell-secondary">{[i.ward_type && `ward ${i.ward_type}`, i.doctor_id && `doctor ${i.doctor_id}`, i.lab_code && `catalogue test ${i.lab_code_system}|${i.lab_code}`, i.match_name && `old orders named like "${i.match_name}"`].filter(Boolean).join(' · ') || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft && (
            <form className="panel-pad" onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => api.put(`/finance/charge-master/versions/${draft.id}/items/${encodeURIComponent(item.code)}`, {
                ...item, unitPrice: Number(item.unitPrice), gstRate: Number(item.gstRate), wardType: item.wardType || undefined, matchName: item.matchName || undefined, labTestCode: item.labTestCode || undefined,
              }), `Saved ${item.code}`)) setItem(EMPTY_ITEM);
            }} style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', alignItems: 'end' }}>
              <div className="form-group"><label className="form-label" htmlFor="it-code">Code</label><input id="it-code" className="form-input" required pattern="[A-Za-z0-9:_.\-]{1,60}" value={item.code} onChange={(e) => setItem({ ...item, code: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="it-name">Name</label><input id="it-name" className="form-input" required value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="it-cat">Category</label>
                <select id="it-cat" className="form-select" value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="form-group"><label className="form-label" htmlFor="it-price">Price (₹)</label><input id="it-price" className="form-input" type="number" min="0" step="0.01" required value={item.unitPrice} onChange={(e) => setItem({ ...item, unitPrice: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="it-gst">GST %</label><input id="it-gst" className="form-input" type="number" min="0" max="100" step="0.01" value={item.gstRate} onChange={(e) => setItem({ ...item, gstRate: e.target.value })} /></div>
              {item.category === 'Ward' && <div className="form-group"><label className="form-label" htmlFor="it-ward">Ward type</label><input id="it-ward" className="form-input" value={item.wardType} onChange={(e) => setItem({ ...item, wardType: e.target.value })} /></div>}
              {item.category === 'Lab' && <div className="form-group"><label className="form-label" htmlFor="it-test">Catalogue test (code system|code)</label><input id="it-test" className="form-input mono" placeholder="LOCAL-LAB|GLU-F" value={item.labTestCode} onChange={(e) => setItem({ ...item, labTestCode: e.target.value })} /></div>}
              {item.category === 'Lab' && <div className="form-group"><label className="form-label" htmlFor="it-match">Old orders: test name to match</label><input id="it-match" className="form-input" value={item.matchName} onChange={(e) => setItem({ ...item, matchName: e.target.value })} /></div>}
              <button type="submit" className="btn btn-secondary btn-md" disabled={busy}>Save item</button>
            </form>
          )}
        </section>

        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', marginTop: 16, alignItems: 'start' }}>
          <section className="panel panel-pad stack-sm" aria-label="Packages">
            <h2 className="panel-title"><Package size={16} aria-hidden="true" /> Packages</h2>
            {packages.map((p) => (
              <div key={p.version_id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <strong>{p.name}</strong> <span className="mono">{p.code}</span> v{p.version} · {inr(p.price)} · <span className="status status-info">{p.status}</span>
                <div className="cell-secondary">{p.rules.map((r) => `${r.rule} ${r.category}${r.code ? ` ${r.code}` : ''}${r.allowance_quantity ? ` up to ${Number(r.allowance_quantity)}` : ''}${r.allowance_amount ? ` up to ${inr(r.allowance_amount)}` : ''}`).join('; ')}</div>
                {p.status === 'Draft' && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => api.post(`/finance/packages/versions/${p.version_id}/activate`, {}), 'Package activated')}>Activate</button>}
              </div>
            ))}
            <form className="stack-sm" onSubmit={(e) => {
              e.preventDefault();
              act(() => api.post('/finance/packages', { ...pkg, price: Number(pkg.price), rules: parseRules(pkg.rules) }), 'Package saved as a draft');
            }}>
              <h3 className="panel-subtitle">New package or version</h3>
              <div className="form-group"><label className="form-label" htmlFor="pk-code">Code</label><input id="pk-code" className="form-input" required value={pkg.code} onChange={(e) => setPkg({ ...pkg, code: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="pk-name">Name</label><input id="pk-name" className="form-input" required value={pkg.name} onChange={(e) => setPkg({ ...pkg, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="pk-price">Price (₹)</label><input id="pk-price" className="form-input" type="number" min="0" step="0.01" required value={pkg.price} onChange={(e) => setPkg({ ...pkg, price: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="pk-src">Where the terms come from</label><input id="pk-src" className="form-input" required minLength={5} value={pkg.provenance} onChange={(e) => setPkg({ ...pkg, provenance: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="pk-rules">Rules, one per line</label>
                <textarea id="pk-rules" className="form-input" rows={4} value={pkg.rules} onChange={(e) => setPkg({ ...pkg, rules: e.target.value })} />
                <p className="form-hint">include|exclude Category [code CODE] [qty N | amount N]. An exclusion wins over an inclusion.</p></div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Save draft package</button>
            </form>
          </section>

          <section className="panel panel-pad stack-sm" aria-label="Payers">
            <h2 className="panel-title"><Building2 size={16} aria-hidden="true" /> Insurance payers</h2>
            {payers.map((p) => <div key={p.id}>{p.name} <span className="mono">{p.code}</span> · {p.kind}</div>)}
            <form className="stack-sm" onSubmit={async (e) => {
              e.preventDefault();
              if (await act(() => api.post('/finance/payers', payer), 'Payer added')) setPayer({ code: '', name: '', kind: 'insurer' });
            }}>
              <div className="form-group"><label className="form-label" htmlFor="py-code">Code</label><input id="py-code" className="form-input" required value={payer.code} onChange={(e) => setPayer({ ...payer, code: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="py-name">Name</label><input id="py-name" className="form-input" required value={payer.name} onChange={(e) => setPayer({ ...payer, name: e.target.value })} /></div>
              <div className="form-group"><label className="form-label" htmlFor="py-kind">Kind</label>
                <select id="py-kind" className="form-select" value={payer.kind} onChange={(e) => setPayer({ ...payer, kind: e.target.value })}>
                  <option value="insurer">Insurer</option><option value="tpa">TPA</option><option value="government">Government scheme</option><option value="corporate">Corporate</option>
                </select></div>
              <button type="submit" className="btn btn-secondary btn-sm" disabled={busy}>Add payer</button>
            </form>
          </section>
        </div>
      </main>
    </>
  );
}
