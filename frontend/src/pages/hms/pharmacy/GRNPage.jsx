import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

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
    if (!prInput.trim()) return toast.error('Please enter a PR Number.');

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
        toast.error('PR not found.');
        setPrData(null);
        return;
      }

      if (data.status === 'Delivered') {
        toast.error('This PR has already been delivered.');
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

      toast.success(`PR ${data.prNumber} loaded! Review and click Generate GRN.`);
    } catch (err) {
      console.error(err);
      toast.error('PR not found or could not be fetched.');
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
    if (!form.supplierId) return toast.error('Please select a supplier or fetch a PR.');

    const validItems = items.filter(i => i.medicineId && i.batchNumber && i.quantity && i.purchaseRate);
    if (validItems.length === 0) return toast.error('Please add at least one valid item.');

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
        throw new Error('All rows are marked for return to vendor. At least one received item is required.');
      }

      const res = await api.post('/pharmacy/grn', payload);
      toast.success(`✅ GRN Generated Successfully! PO ID: ${res.data.purchaseOrderId}`);
      clearPR();
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Failed to submit GRN.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2>📥 Goods Receipt Note (GRN)</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Inward stock from Purchase Requests or direct purchases.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 24 }}>

        {/* PR Fetch Section */}
        <div style={{ padding: 20, background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(16,185,129,0.08))', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 24 }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>📋 Fetch from Purchase Request</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, maxWidth: 300 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: '0.9rem' }}>PR Number (e.g. PR-2026-001 or just the ID)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter PR Number..."
                value={prInput}
                onChange={e => setPrInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchPR(); } }}
                style={{ width: '100%' }}
              />
            </div>
            <button type="button" className="btn btn-primary" onClick={fetchPR} disabled={prLoading} style={{ padding: '10px 24px' }}>
              {prLoading ? 'Fetching...' : '🔍 Fetch PR'}
            </button>
            {prData && (
              <button type="button" className="btn btn-outline" onClick={clearPR} style={{ padding: '10px 20px' }}>
                ✕ Clear
              </button>
            )}
          </div>

          {/* PR Info Card */}
          {prData && (
            <div style={{ marginTop: 16, padding: 16, background: 'rgba(16,185,129,0.1)', border: '1px solid var(--green)', borderRadius: 8, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              <div>
                <strong style={{ color: 'var(--green)', fontSize: '1.1rem' }}>✅ {prData.prNumber}</strong>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  Status: <span style={{ fontWeight: 600 }}>{prData.status}</span> | Date: {prData.date}
                </div>
              </div>
              <div>
                <strong>Supplier:</strong> {prData.supplier?.name}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  UID: {prData.supplier?.supplierNumber} | Ph: {prData.supplier?.phone}
                </div>
              </div>
              <div>
                <strong>Items:</strong> {prData.items?.length || 0}
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  PR Value: ₹{Number(prData.totalAmount || 0).toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Only show supplier/invoice fields if no PR is linked */}
          {!prData && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Supplier *</label>
                <select required value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="form-input" style={{ width: '100%' }}>
                  <option value="">Select Supplier</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Invoice No.</label>
                <input type="text" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} className="form-input" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Invoice Date</label>
                <input type="date" value={form.invoiceDate} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} className="form-input" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          {prData && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Invoice No. (Optional)</label>
                <input type="text" value={form.invoiceNumber} onChange={e => setForm({ ...form, invoiceNumber: e.target.value })} className="form-input" style={{ width: '100%' }} placeholder="Enter vendor invoice number..." />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Invoice Date</label>
                <input type="date" value={form.invoiceDate} onChange={e => setForm({ ...form, invoiceDate: e.target.value })} className="form-input" style={{ width: '100%' }} />
              </div>
            </div>
          )}

          <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" id="partial" checked={form.isPartialDelivery} onChange={e => setForm({ ...form, isPartialDelivery: e.target.checked })} />
            <label htmlFor="partial" style={{ fontWeight: 500 }}>Mark as Partial Delivery (PR remains Open)</label>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '24px 0' }} />
          <h4 style={{ marginBottom: 16 }}>Items Received</h4>

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.9rem', marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch / Expiry</th>
                  <th>Qty</th>
                  <th>PR (₹)</th>
                  <th>MRP (₹)</th>
                  <th>GST %</th>
                  <th style={{ width: 100 }}>Return?</th>
                  <th>Total (₹)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const r = calcRowAmount(item);
                  return (
                    <tr key={item.id} style={{ opacity: item.returnToVendor ? 0.6 : 1 }}>
                      <td style={{ position: 'relative', width: 220 }}>
                        <input
                          type="text" required placeholder="Search medicine..."
                          value={item.medicineSearch || ''}
                          onChange={e => handleItemChange(index, 'medicineSearch', e.target.value)}
                          className="form-input" style={{ width: '100%' }}
                          readOnly={!!prData}
                        />
                        {item.suggestions?.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-1)', border: '1px solid var(--border)', zIndex: 10, borderRadius: 4, maxHeight: 200, overflowY: 'auto' }}>
                            {item.suggestions.map(med => (
                              <div key={med.id} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => selectMedicine(index, med)}>
                                {med.genericName} - {med.strength} {med.strengthUnit}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <input required type="text" placeholder="Batch" value={item.batchNumber} onChange={e => handleItemChange(index, 'batchNumber', e.target.value)} className="form-input" style={{ width: 120, marginBottom: 4 }} />
                        <input required type="date" value={item.expiryDate} onChange={e => handleItemChange(index, 'expiryDate', e.target.value)} className="form-input" style={{ width: 140 }} />
                      </td>
                      <td>
                        <input required type="number" min="1" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} className="form-input" style={{ width: 70 }} />
                      </td>
                      <td>
                        <input required type="number" step="0.01" value={item.purchaseRate} onChange={e => handleItemChange(index, 'purchaseRate', e.target.value)} className="form-input" style={{ width: 90 }} />
                      </td>
                      <td>
                        <input required type="number" step="0.01" value={item.mrp} onChange={e => handleItemChange(index, 'mrp', e.target.value)} className="form-input" style={{ width: 90 }} />
                      </td>
                      <td>
                        <select value={item.gstRate} onChange={e => handleItemChange(index, 'gstRate', e.target.value)} className="form-input" style={{ padding: '8px 4px' }}>
                          <option value="0">0%</option>
                          <option value="5">5%</option>
                          <option value="12">12%</option>
                          <option value="18">18%</option>
                        </select>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={item.returnToVendor} onChange={e => handleItemChange(index, 'returnToVendor', e.target.checked)} style={{ transform: 'scale(1.5)' }} />
                      </td>
                      <td style={{ fontWeight: 600, color: item.returnToVendor ? 'var(--amber)' : 'inherit' }}>
                        {item.returnToVendor ? 'RETURN' : r.total.toFixed(2)}
                      </td>
                      <td>
                        <button type="button" className="btn btn-outline" style={{ padding: '4px 8px', color: 'var(--red)', borderColor: 'var(--red)' }} onClick={() => removeItem(index)}>×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!prData && (
            <button type="button" className="btn btn-outline" onClick={addItem} style={{ marginBottom: 24 }}>+ Add Row</button>
          )}

          <div style={{ background: 'var(--surface-2)', padding: 20, borderRadius: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 32 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Subtotal: ₹{totals.subtotal.toFixed(2)}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>GST Amount: ₹{totals.gst.toFixed(2)}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 4 }}>Grand Total: ₹{totals.grandTotal.toFixed(2)}</div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '12px 24px', fontSize: '1.1rem' }} disabled={loading}>
              {loading ? 'Processing...' : '✅ Generate GRN'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}
