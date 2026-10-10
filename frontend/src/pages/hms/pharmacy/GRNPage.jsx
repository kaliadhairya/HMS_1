import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, PackageCheck, Plus, Search, Trash2, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer',
};

export default function GRNPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState({
    supplierId: '',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    isPartialDelivery: false
  });

  // PR Fetch
  const [prInput, setPrInput] = useState('');
  const [prData, setPrData] = useState(null);
  const [prLoading, setPrLoading] = useState(false);

  const [items, setItems] = useState([
    { id: 1, medicineId: '', medicineSearch: '', batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '', gstRate: 0, returnToVendor: false, suggestions: [] }
  ]);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/pharmacist_lms/suppliers').then(res => setSuppliers(res.data.data)).catch(console.error);
  }, []);

  // Fetch PR details
  const fetchPR = async () => {
    if (!prInput.trim()) return toast.error('Enter a PR number');

    // Extract numeric ID from PR number like "PR-2026-001" → 1, or just accept raw id
    let prId = prInput.trim();
    const match = prId.match(/PR-\d+-(\d+)/i);
    if (match) {
      prId = parseInt(match[1], 10);
    }

    setPrLoading(true);
    try {
      const res = await api.get(`/pharmacist_lms/purchase-orders/${prId}`);
      const data = res.data.data;

      if (!data) {
        toast.error('No purchase request with that number');
        setPrData(null);
        return;
      }

      if (data.status === 'Delivered') {
        toast.error('This purchase request has already been delivered');
        setPrData(null);
        return;
      }

      setPrData(data);

      // Auto-fill supplier
      if (data.supplier) {
        const supplierId = data.supplier.id;
        setForm(f => ({ ...f, supplierId: String(supplierId) }));
      }

      // Auto-fill items from PR
      const today = new Date();
      const oneYearLater = new Date(today);
      oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
      const expiryStr = oneYearLater.toISOString().split('T')[0];
      const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

      const prItems = data.items.map((item, idx) => ({
        id: Date.now() + idx,
        medicineId: item.medicineId,
        medicineSearch: item.genericName,
        batchNumber: `BATCH-${dateStr}-${idx + 1}`,
        expiryDate: expiryStr,
        quantity: item.quantity || 0,
        purchaseRate: item.purchaseRate || 0,
        mrp: item.purchaseRate || 0,
        gstRate: item.gstRate || 0,
        returnToVendor: false,
        suggestions: []
      }));

      setItems(prItems.length > 0 ? prItems : [{ id: 1, medicineId: '', medicineSearch: '', batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '', gstRate: 0, returnToVendor: false, suggestions: [] }]);

      toast.success(`${data.prNumber} loaded. Review the items, then generate the GRN.`);
    } catch (err) {
      console.error(err);
      toast.error('Could not load that purchase request');
      setPrData(null);
    } finally {
      setPrLoading(false);
    }
  };

  const clearPR = () => {
    setPrData(null);
    setPrInput('');
    setForm({ supplierId: '', invoiceNumber: '', invoiceDate: new Date().toISOString().split('T')[0], isPartialDelivery: false });
    setItems([{ id: 1, medicineId: '', medicineSearch: '', batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '', gstRate: 0, returnToVendor: false, suggestions: [] }]);
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;

    if (field === 'medicineSearch') {
      if (value.length > 1) {
        api.get(`/medicines/search?q=${value}`).then(res => {
          newItems[index].suggestions = res.data;
          setItems([...newItems]);
        });
      } else {
        newItems[index].suggestions = [];
      }
    }
    setItems(newItems);
  };

  const selectMedicine = (index, medicine) => {
    const newItems = [...items];
    newItems[index].medicineId = medicine.id;
    newItems[index].medicineSearch = medicine.genericName;
    newItems[index].gstRate = medicine.gstRate;
    newItems[index].suggestions = [];
    setItems(newItems);
  };

  const addItem = () => {
    setItems([...items, { id: Date.now(), medicineId: '', medicineSearch: '', batchNumber: '', expiryDate: '', quantity: '', purchaseRate: '', mrp: '', gstRate: 0, returnToVendor: false, suggestions: [] }]);
  };

  const removeItem = (index) => {
    if (items.length === 1) return;
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const calcRowAmount = (item) => {
    if (item.returnToVendor) return { base: 0, gstAmt: 0, total: 0 };
    const q = parseFloat(item.quantity) || 0;
    const pr = parseFloat(item.purchaseRate) || 0;
    const gstRate = parseFloat(item.gstRate) || 0;
    const base = q * pr;
    const gstAmt = (base * gstRate) / 100;
    return { base, gstAmt, total: base + gstAmt };
  };

  const totals = items.reduce((acc, item) => {
    const r = calcRowAmount(item);
    acc.subtotal += r.base;
    acc.gst += r.gstAmt;
    acc.grandTotal += r.total;
    return acc;
  }, { subtotal: 0, gst: 0, grandTotal: 0 });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.supplierId) return toast.error('Select a supplier or load a purchase request');

    const validItems = items.filter(i => i.medicineId && i.batchNumber && i.quantity && i.purchaseRate);
    if (validItems.length === 0) return toast.error('Add at least one complete item');

    try {
      setLoading(true);
      const payload = {
        supplierId: Number(form.supplierId),
        invoiceNumber: form.invoiceNumber,
        invoiceDate: form.invoiceDate,
        isPartialDelivery: form.isPartialDelivery,
        prId: prData ? prData.id : null,
        items: validItems
          .filter((item) => !item.returnToVendor)
          .map((item) => ({
            medicineId: Number(item.medicineId),
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            quantity: Number(item.quantity),
            purchaseRate: Number(item.purchaseRate),
            mrp: Number(item.mrp || 0),
            gstRate: Number(item.gstRate || 0),
          })),
      };

      if (payload.items.length === 0) {
        throw new Error('Every row is marked for return. At least one item must be received.');
      }

      const res = await api.post('/pharmacy/grn', payload);
      toast.success(`GRN recorded against purchase order ${res.data.purchaseOrderId}`);
      clearPR();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Could not record the GRN');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Goods receipt"
        description="Receive stock against a purchase request, or record a direct purchase from a supplier."
      />

      <div className="stack">
        {/* PR Fetch Section */}
        <section className="panel panel-pad">
          <h2 className="panel-title"><ClipboardList size={16} aria-hidden="true" /> Load a purchase request</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <label className="form-label" htmlFor="grn-pr">PR number</label>
              <input
                id="grn-pr"
                type="text"
                className="form-input"
                placeholder="PR-2026-001 or the request ID"
                value={prInput}
                onChange={e => setPrInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchPR(); } }}
              />
            </div>
            <button type="button" className="btn btn-secondary btn-md" onClick={fetchPR} disabled={prLoading}>
              <Search size={16} aria-hidden="true" /> {prLoading ? 'Loading…' : 'Load request'}
            </button>
            {prData && (
              <button type="button" className="btn btn-ghost btn-md" onClick={clearPR}>
                <X size={16} aria-hidden="true" /> Clear
              </button>
            )}
          </div>
          <p className="form-hint">Leave this empty to record a direct purchase.</p>

          {/* PR Info Card */}
          {prData && (
            <div className="facts" style={{ marginTop: 14, padding: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div>
                <div className="fact-label">Request</div>
                <div className="fact-value"><span className="mono">{prData.prNumber}</span> <span className="status status-info">{prData.status}</span></div>
                <div className="cell-secondary">Raised {prData.date}</div>
              </div>
              <div>
                <div className="fact-label">Supplier</div>
                <div className="fact-value">{prData.supplier?.name || '—'}</div>
                <div className="cell-secondary">{[prData.supplier?.supplierNumber, prData.supplier?.phone].filter(Boolean).join(' · ') || '—'}</div>
              </div>
              <div>
                <div className="fact-label">Items</div>
                <div className="fact-value tabular">{prData.items?.length || 0}</div>
                <div className="cell-secondary">Value ₹{Number(prData.totalAmount || 0).toLocaleString('en-IN')}</div>
              </div>
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="stack">
          <section className="panel panel-pad">
            <h2 className="panel-title">Invoice</h2>
            {/* Only show supplier/invoice fields if no PR is linked */}
            {!prData && (
              <div className="form-grid-3">
                <div className="form-group">
                  <label className="form-label" htmlFor="grn-supplier">Supplier</label>
                  <select id="grn-supplier" required value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="form-select">
                    <option value="">Select supplier</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="grn-invoice">Invoice number</label>
                  <input id="grn-invoice" type="text" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} className="form-input" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="grn-invoice-date">Invoice date</label>
                  <input id="grn-invoice-date" type="date" value={form.invoiceDate} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} className="form-input" />
                </div>
              </div>
            )}

            {prData && (
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="grn-invoice">Invoice number (optional)</label>
                  <input id="grn-invoice" type="text" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} className="form-input" placeholder="Supplier's invoice number" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="grn-invoice-date">Invoice date</label>
                  <input id="grn-invoice-date" type="date" value={form.invoiceDate} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} className="form-input" />
                </div>
              </div>
            )}

            <label className="check-row" htmlFor="partial" style={{ marginTop: 14 }}>
              <input type="checkbox" id="partial" checked={form.isPartialDelivery} onChange={e => setForm({ ...form, isPartialDelivery: e.target.checked })} />
              <span>Partial delivery. The purchase request stays open for the rest.</span>
            </label>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><PackageCheck size={16} aria-hidden="true" /> Items received</h2>
              {!prData && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>
                  <Plus size={14} aria-hidden="true" /> Add row
                </button>
              )}
            </div>

            <div style={{ overflowX: 'auto', padding: '4px 8px 8px' }}>
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Batch and expiry</th>
                    <th style={{ width: 90 }}>Qty</th>
                    <th style={{ width: 110 }}>Purchase rate (₹)</th>
                    <th style={{ width: 110 }}>MRP (₹)</th>
                    <th style={{ width: 90 }}>GST</th>
                    <th style={{ width: 70, textAlign: 'center' }}>Return</th>
                    <th className="text-right" style={{ width: 110 }}>Total (₹)</th>
                    <th style={{ width: 48 }}><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const r = calcRowAmount(item);
                    const n = index + 1;
                    return (
                      <tr key={item.id} style={{ opacity: item.returnToVendor ? 0.6 : 1 }}>
                        <td style={{ position: 'relative', minWidth: 220 }}>
                          <label className="sr-only" htmlFor={`grn-med-${item.id}`}>Medicine for row {n}</label>
                          <input
                            id={`grn-med-${item.id}`}
                            type="text" required placeholder="Search medicine" autoComplete="off"
                            value={item.medicineSearch || ''}
                            onChange={e => handleItemChange(index, 'medicineSearch', e.target.value)}
                            className="form-input"
                            readOnly={!!prData}
                          />
                          {item.suggestions?.length > 0 && (
                            <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                              {item.suggestions.map(med => (
                                <button key={med.id} type="button" role="option" aria-selected="false" style={suggestionItem} onClick={() => selectMedicine(index, med)}>
                                  {med.genericName} <span className="cell-secondary">{[med.strength, med.strengthUnit].filter(Boolean).join(' ')}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ minWidth: 150 }}>
                          <div className="stack-sm" style={{ gap: 4 }}>
                            <label className="sr-only" htmlFor={`grn-batch-${item.id}`}>Batch number for row {n}</label>
                            <input id={`grn-batch-${item.id}`} required type="text" placeholder="Batch" value={item.batchNumber} onChange={e => handleItemChange(index, 'batchNumber', e.target.value)} className="form-input" />
                            <label className="sr-only" htmlFor={`grn-exp-${item.id}`}>Expiry date for row {n}</label>
                            <input id={`grn-exp-${item.id}`} required type="date" value={item.expiryDate} onChange={e => handleItemChange(index, 'expiryDate', e.target.value)} className="form-input" />
                          </div>
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`grn-qty-${item.id}`}>Quantity for row {n}</label>
                          <input id={`grn-qty-${item.id}`} required type="number" min="1" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} className="form-input" />
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`grn-rate-${item.id}`}>Purchase rate for row {n}</label>
                          <input id={`grn-rate-${item.id}`} required type="number" step="0.01" value={item.purchaseRate} onChange={e => handleItemChange(index, 'purchaseRate', e.target.value)} className="form-input" />
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`grn-mrp-${item.id}`}>MRP for row {n}</label>
                          <input id={`grn-mrp-${item.id}`} required type="number" step="0.01" value={item.mrp} onChange={e => handleItemChange(index, 'mrp', e.target.value)} className="form-input" />
                        </td>
                        <td>
                          <label className="sr-only" htmlFor={`grn-gst-${item.id}`}>GST rate for row {n}</label>
                          <select id={`grn-gst-${item.id}`} value={item.gstRate} onChange={e => handleItemChange(index, 'gstRate', e.target.value)} className="form-select">
                            <option value="0">0%</option>
                            <option value="5">5%</option>
                            <option value="12">12%</option>
                            <option value="18">18%</option>
                          </select>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="checkbox" checked={item.returnToVendor}
                            onChange={e => handleItemChange(index, 'returnToVendor', e.target.checked)}
                            aria-label={`Return row ${n} to the supplier`}
                            style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                          />
                        </td>
                        <td className="text-right tabular" style={{ fontWeight: 600 }}>
                          {item.returnToVendor ? <span className="status status-warning">Return</span> : r.total.toFixed(2)}
                        </td>
                        <td className="text-right">
                          <button type="button" className="icon-btn" aria-label={`Remove row ${n}`} onClick={() => removeItem(index)} disabled={items.length === 1}>
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="toolbar toolbar-sub" style={{ borderBottom: 0, borderTop: '1px solid var(--border)', borderRadius: '0 0 10px 10px' }}>
              <span className="muted">
                Subtotal <span className="tabular">₹{totals.subtotal.toFixed(2)}</span> · GST <span className="tabular">₹{totals.gst.toFixed(2)}</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: '1.15rem', fontWeight: 650 }}>Total <span className="tabular">₹{totals.grandTotal.toFixed(2)}</span></span>
                <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
                  <PackageCheck size={16} aria-hidden="true" /> {loading ? 'Recording…' : 'Generate GRN'}
                </button>
              </span>
            </div>
          </section>
        </form>
      </div>
    </main>
    </>
  );
}
