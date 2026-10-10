import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Printer, ShoppingCart, Trash2 } from 'lucide-react';
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

export default function OTCSalePage() {
  const [patientId, setPatientId] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [items, setItems] = useState([
    { id: 1, medicineId: '', batchId: '', quantity: 1, mrp: 0, gstRate: 0, suggestions: [], batches: [] }
  ]);
  const [loading, setLoading] = useState(false);
  const [receiptData, setReceiptData] = useState(null);

  const handleItemChange = async (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = value;

    // Autocomplete for medicines
    if (field === 'medicineSearch') {
      if (value.length > 2) {
        try {
          const res = await api.get(`/medicines/search?q=${value}`);
          newItems[index].suggestions = res.data;
        } catch (e) {
          console.error(e);
        }
      } else {
        newItems[index].suggestions = [];
      }
    }
    setItems(newItems);
  };

  const selectMedicine = async (index, medicine) => {
    const newItems = [...items];
    newItems[index].medicineId = medicine.id;
    newItems[index].medicineSearch = medicine.genericName;
    newItems[index].gstRate = medicine.gstRate || 0;
    newItems[index].suggestions = [];

    // Fetch batches for this medicine
    try {
      await api.get(`/pharmacy/stock-ledger/${medicine.id}`);
      // In-stock batches for this medicine, earliest expiry first. (The consolidated /pharmacy/stock list has one
      // row per medicine with no batch ID or batch quantity, so batches could never be found there.)
      const batchRes = await api.get(`/pharmacy/medicines/${medicine.id}/batches`);
      const medBatches = (batchRes.data.data || []).map(b => ({
        BATCH_ID: b.id ?? b.ID,
        BATCH_NUMBER: b.batchNumber ?? b.BATCH_NUMBER,
        QUANTITY: Number(b.quantity ?? b.QUANTITY ?? 0),
        MRP: b.mrp ?? b.MRP,
      })).filter(b => b.QUANTITY > 0);
      newItems[index].batches = medBatches;
      if (medBatches.length > 0) {
        newItems[index].batchId = medBatches[0].BATCH_ID;
        newItems[index].mrp = medBatches[0].MRP;
      }
    } catch (e) {
      console.error(e);
    }

    setItems(newItems);
  };

  const addItem = () => {
    setItems([...items, { id: Date.now(), medicineId: '', batchId: '', quantity: 1, mrp: 0, gstRate: 0, suggestions: [], batches: [] }]);
  };

  const removeItem = (index) => {
    if (items.length === 1) return;
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const calcRowAmount = (item) => {
    const q = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.mrp) || 0;
    const gstRate = parseFloat(item.gstRate) || 0;
    const base = q * rate;
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
    const validItems = items.filter(i => i.medicineId && i.batchId && i.quantity > 0);
    if (validItems.length === 0) return toast.error('Add at least one medicine with a batch selected');

    try {
      setLoading(true);
      const payload = {
        patientId: patientId || null,
        paymentMode,
        items: validItems.map(i => ({
          medicineId: i.medicineId,
          batchId: i.batchId,
          quantity: parseFloat(i.quantity)
        }))
      };

      const res = await api.post('/pharmacy/otc', payload);
      toast.success('Sale completed');

      // Receipt data
      setReceiptData({
        billNumber: res.data.billNumber,
        totalAmount: res.data.totalAmount,
        paymentMode,
        date: new Date().toLocaleString(),
        items: validItems.map(i => ({
          name: i.medicineSearch,
          quantity: i.quantity,
          rate: i.mrp,
          amount: calcRowAmount(i).total
        }))
      });

      // Reset
      setItems([{ id: Date.now(), medicineId: '', batchId: '', quantity: 1, mrp: 0, gstRate: 0, suggestions: [], batches: [] }]);
      setPatientId('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'The sale could not be completed');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (receiptData) {
    return (
      <>
      <Navbar />
      <main className="app-page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div className="card print-area" style={{ padding: 40, width: '100%', maxWidth: 600, marginTop: 20 }}>
          <div style={{ textAlign: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <h2>HMS Hospital Pharmacy</h2>
            <div>Cash Receipt</div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
            <div>
              <div><strong>Bill No:</strong> {receiptData.billNumber}</div>
              <div><strong>Date:</strong> {receiptData.date}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div><strong>Payment:</strong> {receiptData.paymentMode}</div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
            <thead>
              <tr style={{ background: 'var(--surface-3)' }}>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Item</th>
                <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Qty</th>
                <th style={{ padding: 8, textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Rate</th>
                <th style={{ padding: 8, textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {receiptData.items.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ padding: 8, borderBottom: '1px dashed var(--border)' }}>{item.name}</td>
                  <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>{item.quantity}</td>
                  <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{Number(item.rate || 0).toFixed(2)}</td>
                  <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{Number(item.amount || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
            <span>Total Amount:</span>
            <span>₹{Number(receiptData.totalAmount || 0).toFixed(2)}</span>
          </div>

          <div style={{ textAlign: 'center', marginTop: 40, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Thank you for visiting!
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 8 }} className="no-print">
          <button type="button" className="btn btn-secondary btn-md" onClick={() => setReceiptData(null)}>
            <Plus size={16} aria-hidden="true" /> New sale
          </button>
          <button type="button" className="btn btn-primary btn-md" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" /> Print receipt
          </button>
        </div>

        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
            .no-print { display: none !important; }
          }
        `}</style>
      </main>
      </>
    );
  }

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Counter sale"
        description="Sell medicines over the counter. Stock is taken from the batch you choose, earliest expiry first."
      />

      <form onSubmit={handleSubmit} className="stack">
        <section className="panel panel-pad">
          <h2 className="panel-title">Customer and payment</h2>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="otc-patient">Patient UHID (optional)</label>
              <input id="otc-patient" className="form-input" type="text" placeholder="e.g. HOSP-2026-000123" value={patientId} onChange={e => setPatientId(e.target.value)} aria-describedby="otc-patient-hint" />
              <p className="form-hint" id="otc-patient-hint">Leave blank for walk-in customers.</p>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="otc-payment">Payment mode</label>
              <select id="otc-payment" className="form-select" value={paymentMode} onChange={e => setPaymentMode(e.target.value)}>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="UPI">UPI</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><ShoppingCart size={16} aria-hidden="true" /> Items</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>
              <Plus size={14} aria-hidden="true" /> Add medicine
            </button>
          </div>
          <div style={{ overflowX: 'auto', padding: '4px 8px 8px' }}>
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Medicine</th>
                  <th>Batch (in stock)</th>
                  <th style={{ width: 100 }}>Qty</th>
                  <th className="text-right" style={{ width: 110 }}>Rate (₹)</th>
                  <th className="text-right" style={{ width: 120 }}>Amount (₹)</th>
                  <th style={{ width: 48 }}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const r = calcRowAmount(item);
                  return (
                    <tr key={item.id}>
                      <td style={{ position: 'relative', minWidth: 240 }}>
                        <label className="sr-only" htmlFor={`otc-med-${item.id}`}>Medicine for row {index + 1}</label>
                        <input
                          id={`otc-med-${item.id}`}
                          className="form-input"
                          type="text"
                          required
                          autoComplete="off"
                          placeholder="Search medicine"
                          value={item.medicineSearch || ''}
                          onChange={e => handleItemChange(index, 'medicineSearch', e.target.value)}
                        />
                        {item.suggestions?.length > 0 && (
                          <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                            {item.suggestions.map(med => (
                              <button key={med.id} type="button" role="option" aria-selected="false" style={suggestionItem} onClick={() => selectMedicine(index, med)}>
                                {med.genericName}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <label className="sr-only" htmlFor={`otc-batch-${item.id}`}>Batch for row {index + 1}</label>
                        <select id={`otc-batch-${item.id}`} className="form-select" required disabled={!item.batches || item.batches.length === 0} value={item.batchId} onChange={e => {
                          const batch = item.batches.find(b => b.BATCH_ID.toString() === e.target.value);
                          handleItemChange(index, 'batchId', batch?.BATCH_ID || '');
                          if (batch) handleItemChange(index, 'mrp', batch.MRP);
                        }}>
                          <option value="">{item.medicineId && item.batches?.length === 0 ? 'No stock' : 'Select batch'}</option>
                          {item.batches?.map(b => (
                            <option key={b.BATCH_ID} value={b.BATCH_ID}>
                              {b.BATCH_NUMBER} (qty {b.QUANTITY})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`otc-qty-${item.id}`}>Quantity for row {index + 1}</label>
                        <input id={`otc-qty-${item.id}`} className="form-input" required type="number" min="1" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} />
                      </td>
                      <td className="text-right tabular">{(parseFloat(item.mrp) || 0).toFixed(2)}</td>
                      <td className="text-right tabular" style={{ fontWeight: 600 }}>{r.total.toFixed(2)}</td>
                      <td className="text-right">
                        <button type="button" className="icon-btn" aria-label={`Remove row ${index + 1}`} onClick={() => removeItem(index)} disabled={items.length === 1}>
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
                {loading ? 'Completing…' : 'Complete sale'}
              </button>
            </span>
          </div>
        </section>
      </form>
    </main>
    </>
  );
}
