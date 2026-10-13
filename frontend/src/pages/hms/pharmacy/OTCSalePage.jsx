import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Printer, ShoppingCart, Trash2 } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import { SaveStatus, MedicationLinks, useCommand } from './MedicationUI';

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 10, maxHeight: 220, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer',
};

const emptyRow = () => ({ id: Date.now() + Math.random(), medicineId: '', medicineSearch: '', batchId: '', quantity: 1, mrp: 0, gstRate: 0, suggestions: [], batches: [] });

export default function OTCSalePage() {
  const [reviewAcknowledged, setReviewAcknowledged] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [patientId, setPatientId] = useState('');
  const [patientError, setPatientError] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [items, setItems] = useState([emptyRow()]);
  const [loading, setLoading] = useState(false);
  const [receiptData, setReceiptData] = useState(null);
  const command = useCommand((response, attempt) => {
    setReceiptData({ billNumber:response.billNumber,totalAmount:response.totalAmount,gstAmount:response.gstAmount,
      paymentMode:attempt.body.paymentMode,patientUhid:attempt.body.patientId,date:new Date().toLocaleString(),
      items:(response.items||[]).map(i=>({name:i.medicineName,quantity:i.quantity,rate:i.rate,gstAmount:i.gstAmount,amount:i.amount})) });
  }, '/pharmacy');

  // Immutable row updates: the old handler mutated rows in place and raced with its own async search.
  const patchRow = (rowId, patch) => setItems((prev) => prev.map((it) => (it.id === rowId ? { ...it, ...patch } : it)));

  const handleSearch = async (rowId, value) => {
    // Typing again clears the medicine that was picked before.
    patchRow(rowId, { medicineSearch: value, medicineId: '', batchId: '', batches: [], mrp: 0, gstRate: 0, suggestions: [] });
    if (value.trim().length <= 2) return;
    try {
      const res = await api.get(`/medicines/search?q=${encodeURIComponent(value.trim())}`);
      // Ignore answers for text the user has since changed.
      setItems((prev) => prev.map((it) => (it.id === rowId && it.medicineSearch === value ? { ...it, suggestions: res.data || [] } : it)));
    } catch (e) {
      console.error(e);
    }
  };

  const selectMedicine = async (rowId, medicine) => {
    patchRow(rowId, { medicineId: medicine.id, medicineSearch: medicine.genericName, gstRate: medicine.gstRate || 0, suggestions: [] });

    // In-stock, unexpired batches for this medicine, earliest expiry first. (The consolidated /pharmacy/stock list has
    // one row per medicine with no batch ID or batch quantity, so batches could never be found there.)
    try {
      const batchRes = await api.get(`/pharmacy/medicines/${medicine.id}/batches`);
      const medBatches = (batchRes.data.data || []).map(b => ({
        BATCH_ID: b.id ?? b.ID,
        BATCH_NUMBER: b.batchNumber ?? b.BATCH_NUMBER,
        QUANTITY: Number(b.quantity ?? b.QUANTITY ?? 0),
        MRP: b.mrp ?? b.MRP,
      })).filter(b => b.QUANTITY > 0);
      patchRow(rowId, {
        batches: medBatches,
        batchId: medBatches.length > 0 ? medBatches[0].BATCH_ID : '',
        mrp: medBatches.length > 0 ? medBatches[0].MRP : 0,
      });
    } catch (e) {
      console.error(e);
      toast.error('Could not load batches for this medicine');
    }
  };

  const selectBatch = (rowId, value) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== rowId) return it;
      const batch = it.batches.find((b) => String(b.BATCH_ID) === String(value));
      return { ...it, batchId: batch?.BATCH_ID || '', mrp: batch?.MRP ?? 0 };
    }));
  };

  const addItem = () => {
    setItems((prev) => [...prev, emptyRow()]);
  };

  const removeItem = (rowId) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.id !== rowId)));
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
    setPatientError('');
    for (const [i, it] of items.entries()) {
      if (it.medicineSearch && !it.medicineId) return toast.error(`Row ${i + 1}: pick the medicine from the list`);
      if (it.medicineId && !it.batchId) return toast.error(`Row ${i + 1}: ${it.medicineSearch} has no stock to sell`);
      const q = Number(it.quantity);
      if (it.medicineId && (!Number.isInteger(q) || q <= 0)) return toast.error(`Row ${i + 1}: enter a whole-number quantity`);
      const batch = it.batches.find((b) => String(b.BATCH_ID) === String(it.batchId));
      if (batch && q > batch.QUANTITY) return toast.error(`Row ${i + 1}: only ${batch.QUANTITY} left in batch ${batch.BATCH_NUMBER}`);
    }
    const validItems = items.filter(i => i.medicineId && i.batchId && Number(i.quantity) > 0);
    if (validItems.length === 0) return toast.error('Add at least one medicine with a batch selected');

    try {
      setLoading(true);
      const payload = {
        patientId: patientId.trim() || null,
        paymentMode,
        clinicalReviewAcknowledged: reviewAcknowledged,
        clinicalReviewReason: reviewReason,
        items: validItems.map(i => ({
          medicineId: i.medicineId,
          batchId: i.batchId,
          quantity: parseInt(i.quantity, 10)
        }))
      };

      const result = await command.run('/otc', payload);
      if (!result) return;
      toast.success('Sale completed');
      // Reset
      setItems([emptyRow()]);
      setPatientId('');
      setReviewAcknowledged(false);
      setReviewReason('');
    } catch (err) {
      const message = err.response?.data?.message || 'The sale could not be completed';
      if (/patient/i.test(message) && err.response?.status === 400) setPatientError(message);
      toast.error(message);
      if (!err.response || err.response.status >= 500) console.error(err);
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
              {receiptData.patientUhid && <div><strong>UHID:</strong> {receiptData.patientUhid}</div>}
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

          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, color: 'var(--text-secondary)' }}>
            <span>GST included:</span>
            <span>₹{Number(receiptData.gstAmount || 0).toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
            <span>Total Amount:</span>
            <span>₹{Number(receiptData.totalAmount || 0).toFixed(2)}</span>
          </div>

          <div style={{ textAlign: 'center', marginTop: 40, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Thank you for visiting.
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

      <MedicationLinks />
      <SaveStatus value={command.status} />
      <form onSubmit={handleSubmit} className="stack">
        <section className="card" style={{padding:16}}>
          <h2>Pharmacist counter-sale review</h2>
          <p>Only products with explicit formulary permission may be sold without an order. Clinical coverage remains incomplete. Known ingredient allergies and controlled drugs require the coded prescribing workflow. A counter-sale receipt does not authorize an inpatient dose.</p>
          <label><input type="checkbox" required checked={reviewAcknowledged} onChange={e=>setReviewAcknowledged(e.target.checked)} /> I reviewed counter-sale permission and incomplete patient context.</label>
          <label htmlFor="otc-review-reason">Pharmacist review reason / source</label>
          <input id="otc-review-reason" className="form-input" required value={reviewReason} onChange={e=>setReviewReason(e.target.value)} />
        </section>
        <section className="panel panel-pad">
          <h2 className="panel-title">Customer and payment</h2>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="otc-patient">Patient UHID (optional)</label>
              <input
                id="otc-patient" className="form-input" type="text" placeholder="e.g. HOSP-2026-000123" value={patientId}
                onChange={e => { setPatientId(e.target.value); setPatientError(''); }}
                aria-describedby="otc-patient-hint" aria-invalid={patientError ? 'true' : undefined}
              />
              {patientError
                ? <p className="form-hint" id="otc-patient-hint" role="alert" style={{ color: 'var(--red)' }}>{patientError}</p>
                : <p className="form-hint" id="otc-patient-hint">Leave blank for walk-in customers.</p>}
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
                          onChange={e => handleSearch(item.id, e.target.value)}
                        />
                        {item.suggestions?.length > 0 && (
                          <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                            {item.suggestions.map(med => (
                              <button key={med.id} type="button" role="option" aria-selected="false" style={suggestionItem} onClick={() => selectMedicine(item.id, med)}>
                                {med.genericName} <span className="cell-secondary">{[med.strength, med.strengthUnit].filter(Boolean).join(' ')}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 200 }}>
                        <label className="sr-only" htmlFor={`otc-batch-${item.id}`}>Batch for row {index + 1}</label>
                        <select id={`otc-batch-${item.id}`} className="form-select" required disabled={!item.batches || item.batches.length === 0} value={item.batchId} onChange={e => selectBatch(item.id, e.target.value)}>
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
                        <input id={`otc-qty-${item.id}`} className="form-input" required type="number" min="1" step="1" value={item.quantity} onChange={e => patchRow(item.id, { quantity: e.target.value })} />
                      </td>
                      <td className="text-right tabular">{(parseFloat(item.mrp) || 0).toFixed(2)}</td>
                      <td className="text-right tabular" style={{ fontWeight: 600 }}>{r.total.toFixed(2)}</td>
                      <td className="text-right">
                        <button type="button" className="icon-btn" aria-label={`Remove row ${index + 1}`} onClick={() => removeItem(item.id)} disabled={items.length === 1}>
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
