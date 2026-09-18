import { useState } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

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
      const res = await api.get(`/pharmacy/stock-ledger/${medicine.id}`);
      // Use existing stock endpoint or derive batches:
      const resStock = await api.get('/pharmacy/stock');
      const medBatches = resStock.data.data.filter(b => b.ID === medicine.id && b.QUANTITY > 0);
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
    if (validItems.length === 0) return toast.error('Please add at least one valid item with a batch selected.');

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
      toast.success('Sale completed successfully.');
      
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
      toast.error(err.response?.data?.message || 'OTC sale failed.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (receiptData) {
    return (
      <>
      <Navbar />
      <div className="page-wrapper fade-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
                  <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{item.rate?.toFixed(2)}</td>
                  <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{item.amount?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
            <span>Total Amount:</span>
            <span>₹{receiptData.totalAmount?.toFixed(2)}</span>
          </div>
          
          <div style={{ textAlign: 'center', marginTop: 40, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Thank you for visiting!
          </div>
        </div>

        <div style={{ marginTop: 24, display: 'flex', gap: 16 }} className="no-print">
          <button className="btn btn-outline" onClick={() => setReceiptData(null)}>New Sale</button>
          <button className="btn btn-primary" onClick={() => window.print()}>🖨️ Print Receipt</button>
        </div>

        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-area, .print-area * { visibility: visible; }
            .print-area { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
            .no-print { display: none !important; }
          }
        `}</style>
      </div>
      </>
    );
  }

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2>OTC Sale (Over The Counter)</h2>
      </div>

      <div className="card" style={{ padding: 24 }}>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Patient ID (Optional)</label>
              <input type="text" placeholder="Enter UHID if registered patient" value={patientId} onChange={e => setPatientId(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Payment Mode</label>
              <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}>
                <option value="Cash">Cash</option>
                <option value="Card">Card</option>
                <option value="UPI">UPI</option>
              </select>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '24px 0' }} />
          
          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: '0.9rem', marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Medicine Name</th>
                  <th>Batch (Stock)</th>
                  <th>Qty</th>
                  <th>Rate (₹)</th>
                  <th>Amount (₹)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const r = calcRowAmount(item);
                  return (
                    <tr key={item.id}>
                      <td style={{ position: 'relative', width: 300 }}>
                        <input 
                          type="text" 
                          required
                          placeholder="Search medicine..."
                          value={item.medicineSearch || ''}
                          onChange={e => handleItemChange(index, 'medicineSearch', e.target.value)}
                          style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid var(--border)' }}
                        />
                        {item.suggestions?.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface-1)', border: '1px solid var(--border)', zIndex: 10, borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto' }}>
                            {item.suggestions.map(med => (
                              <div 
                                key={med.id} 
                                style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                                onClick={() => selectMedicine(index, med)}
                              >
                                {med.genericName}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <select required disabled={!item.batches || item.batches.length === 0} value={item.batchId} onChange={e => {
                          const batch = item.batches.find(b => b.BATCH_ID.toString() === e.target.value);
                          handleItemChange(index, 'batchId', batch?.BATCH_ID || '');
                          if (batch) handleItemChange(index, 'mrp', batch.MRP);
                        }} style={{ width: '100%', padding: '8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                          <option value="">Select Batch</option>
                          {item.batches?.map(b => (
                            <option key={b.BATCH_ID} value={b.BATCH_ID}>
                              {b.BATCH_NUMBER} (Qty: {b.QUANTITY})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input required type="number" min="1" value={item.quantity} onChange={e => handleItemChange(index, 'quantity', e.target.value)} style={{ width: 80, padding: '8px', borderRadius: 4, border: '1px solid var(--border)' }} />
                      </td>
                      <td>
                        <input type="number" readOnly value={item.mrp} style={{ width: 80, padding: '8px', borderRadius: 4, border: 'none', background: 'transparent' }} />
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {r.total.toFixed(2)}
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

          <button type="button" className="btn btn-outline" onClick={addItem} style={{ marginBottom: 24 }}>+ Add Medicine</button>

          <div style={{ background: 'var(--surface-2)', padding: 20, borderRadius: 8, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 32 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 4 }}>Total Record: ₹{totals.grandTotal.toFixed(2)}</div>
            </div>
            <button type="submit" className="btn btn-primary" style={{ padding: '12px 24px', fontSize: '1.1rem' }} disabled={loading}>
              {loading ? 'Processing...' : 'Complete Sale'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </>
  );
}
