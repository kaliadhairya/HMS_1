import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';
import { useSocket } from '../../../context/SocketContext';

export default function DispensePage() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [dispensing, setDispensing] = useState(false);
  const [slipData, setSlipData] = useState(null);
  const socket = useSocket();

  // New states for Advanced Dispense
  const [dispenseItems, setDispenseItems] = useState([]);

  useEffect(() => {
    fetchQueue();
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('new_prescription', (data) => {
      console.log('💊 New prescription received:', data);
      toast('New Prescription Received!', { icon: '💊', duration: 4000 });
      fetchQueue();
    });
    return () => {
      socket.off('new_prescription');
    };
  }, [socket]);

  const fetchQueue = async () => {
    try {
      setLoading(true);
      const res = await api.get('/pharmacy/dispense-queue');
      setQueue(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load dispense queue.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectPrescription = async (item) => {
    setSelectedPrescription(item);
    setSlipData(null);
    setLoading(true);

    try {
      // 1. Fetch real prescription items
      const res = await api.get(`/hms/prescriptions/${item.PRESCRIPTION_ID}`);
      const rxItems = res.data.data.items || [];
      
      // 2. For each item, fetch available batches
      const itemsWithBatches = await Promise.all(rxItems.map(async (rxItem) => {
        const batchRes = await api.get(`/pharmacy/medicines/${rxItem.medicine_id}/batches`);
        const batches = batchRes.data.data || [];
        return {
          id: rxItem.id,
          medicineId: rxItem.medicine_id,
          medicineName: rxItem.medicine_name || rxItem.medicine?.name || 'Unknown',
          requestedQty: rxItem.quantity,
          dispenseQty: rxItem.quantity,
          availableBatches: batches,
          selectedBatchId: batches.length > 0 ? batches[0].id : '',
          selectedBatch: batches.length > 0 ? batches[0] : null,
          rate: batches.length > 0 ? batches[0].sale_price || 0 : 0,
          inStock: batches.reduce((sum, b) => sum + (b.quantity || 0), 0),
          isPartial: false
        };
      }));

      setDispenseItems(itemsWithBatches);
    } catch (err) {
      console.error('Error loading RX details:', err);
      toast.error('Failed to load prescription details.');
    } finally {
      setLoading(false);
    }
  };

  const updateDispenseItem = (index, field, value) => {
    const newItems = [...dispenseItems];
    
    if (field === 'selectedBatchId') {
      const batch = newItems[index].availableBatches.find(b => b.id == value);
      newItems[index].selectedBatchId = value;
      newItems[index].selectedBatch = batch;
      newItems[index].rate = batch?.sale_price || 0;
    } else {
      newItems[index][field] = value;
    }

    if (field === 'dispenseQty') {
      newItems[index].isPartial = parseInt(value) < newItems[index].requestedQty;
    }
    setDispenseItems(newItems);
  };

  const handleDispense = async () => {
    if (!selectedPrescription || dispenseItems.length === 0) return;
    
    // Validation: Ensure all items have a selected batch with enough stock
    for (const item of dispenseItems) {
      if (!item.selectedBatchId) {
        toast.error(`Please select a batch for ${item.medicineName}`);
        return;
      }
      if (item.dispenseQty > (item.selectedBatch?.quantity || 0)) {
        toast.error(`Insufficient stock in selected batch for ${item.medicineName}`);
        return;
      }
    }

    try {
      setDispensing(true);
      
      const payload = {
        prescriptionId: selectedPrescription.PRESCRIPTION_ID,
        items: dispenseItems.map(item => ({
          medicineId: item.medicineId,
          batchId: item.selectedBatchId,
          quantity: parseInt(item.dispenseQty),
          rate: item.rate,
          amount: parseFloat(item.rate) * parseInt(item.dispenseQty),
          medicineName: item.medicineName
        }))
      };

      const res = await api.post('/pharmacy/dispense', payload);
      
      if (res.data.status === 'success') {
        toast.success('Medicines dispensed and billed successfully.');
        
        // Populate slip data from the response or local state
        setSlipData({
          id: 'D-' + Date.now(),
          dispensedAt: new Date().toISOString(),
          patientName: selectedPrescription.PATIENT_NAME,
          patientUhid: selectedPrescription.UHID,
          totalAmount: payload.items.reduce((sum, i) => sum + i.amount, 0),
          isIpd: selectedPrescription.UHID.includes('IPD'),
          items: payload.items.map(i => ({
            medicineName: i.medicineName,
            quantity: i.quantity,
            rate: i.rate,
            amount: i.amount,
            isPartial: dispenseItems.find(di => di.medicineId === i.medicineId)?.isPartial
          }))
        });

        fetchQueue();
        setSelectedPrescription(null);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Dispensing failed.');
    } finally {
      setDispensing(false);
    }
  };


  const printSlip = () => {
    window.print();
  };

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up" style={{ display: 'flex', gap: 24, height: 'calc(100vh - 61px)' }}>
      {/* Left Panel: Queue */}
      <div className="card" style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: 20, borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <h3 style={{ margin: 0 }}>Pending Prescriptions</h3>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
          ) : queue.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Queue is empty.</div>
          ) : (
            queue.map(item => (
              <div 
                key={item.PRESCRIPTION_ID} 
                onClick={() => handleSelectPrescription(item)}
                style={{ 
                  padding: 16, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 12, cursor: 'pointer',
                  background: selectedPrescription?.PRESCRIPTION_ID === item.PRESCRIPTION_ID ? 'var(--primary-light)' : 'var(--surface-1)',
                  borderColor: selectedPrescription?.PRESCRIPTION_ID === item.PRESCRIPTION_ID ? 'var(--primary)' : 'var(--border)',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong style={{ fontSize: '1.05rem', color: 'var(--primary)' }}>{item.PATIENT_NAME}</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(item.CREATED_AT).toLocaleTimeString()}</span>
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  UHID: {item.UHID}
                </div>
                <div style={{ fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Dr. {item.DOCTOR_NAME}</span>
                  <span style={{ background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>{item.MEDICINE_COUNT} Items</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Panel: Action Area */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {slipData ? (
          <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, overflowY: 'auto' }} className="print-area">
            <h2 style={{ marginBottom: 8, color: 'var(--green)' }}>Rx Dispensed</h2>
            <div style={{ background: 'var(--surface-2)', padding: 32, borderRadius: 12, width: '100%', maxWidth: 700, marginTop: 24, border: '1px dashed var(--border)' }}>
              <div style={{ textAlign: 'center', marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0 }}>HMS Hospital Pharmacy Slip</h3>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 4 }}>
                  Date: {new Date(slipData.dispensedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                  <div><strong>Patient:</strong> {slipData.patientName}</div>
                  <div><strong>UHID:</strong> {slipData.patientUhid}</div>
                  {slipData.isIpd && <div style={{ color: 'var(--blue)', fontWeight: 600, marginTop: 4 }}>[IPD Patient - Sent to Central Billing]</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>Record ID:</strong> #{slipData.id}
                </div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
                <thead>
                  <tr style={{ background: 'var(--surface-3)' }}>
                    <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Medicine</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Qty</th>
                    <th style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Rate</th>
                    <th style={{ padding: 8, textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {slipData.items.map((item, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                        <strong>{item.medicineName}</strong>
                        {item.substitutedFor && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sub. for: {item.substitutedFor}</div>}
                        {item.isPartial && <span style={{ color: 'var(--amber)', fontSize: '0.75rem', marginLeft: 8 }}>(Partial)</span>}
                      </td>
                      <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>
                        {item.quantity}
                      </td>
                      <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>₹{item.rate?.toFixed(2)}</td>
                      <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{item.amount?.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
                <span>Total Amount:</span>
                <span>₹{slipData.totalAmount?.toFixed(2)}</span>
              </div>
            </div>

            <div style={{ marginTop: 24, display: 'flex', gap: 16 }} className="no-print">
              <button className="btn btn-outline" onClick={() => setSlipData(null)}>← Back to Queue</button>
              <button className="btn btn-primary" onClick={printSlip}>🖨️ Print Slip</button>
              {slipData.isIpd && <button className="btn btn-outline" style={{ borderColor: 'var(--blue)', color: 'var(--blue)' }}>View IPD Bill</button>}
            </div>
          </div>
        ) : selectedPrescription ? (
          <>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{selectedPrescription.PATIENT_NAME}</h2>
                  <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                    UHID: {selectedPrescription.UHID} • Prescribed by Dr. {selectedPrescription.DOCTOR_NAME}
                  </div>
                </div>
                <button 
                  className="btn btn-primary" 
                  onClick={handleDispense} 
                  disabled={dispensing}
                  style={{ padding: '12px 24px', fontSize: '1.1rem' }}
                >
                  {dispensing ? 'Processing...' : 'Confirm Dispense'}
                </button>
              </div>
            </div>
            
            <div style={{ padding: 24, flex: 1, overflowY: 'auto', background: 'var(--surface-1)' }}>
               <h4 style={{ marginBottom: 16 }}>Dispensing Items</h4>
               <div className="table-wrapper">
                 <table className="table" style={{ width: '100%' }}>
                   <thead>
                     <tr>
                       <th>Prescribed Medicine</th>
                       <th>Select Batch (Expiry)</th>
                       <th>Live Stock</th>
                       <th>Requested</th>
                       <th style={{ width: 100 }}>Dispense Qty</th>
                       <th>Status</th>
                     </tr>
                   </thead>
                   <tbody>
                     {dispenseItems.map((di, idx) => (
                       <tr key={di.id}>
                         <td style={{ fontWeight: 600 }}>{di.medicineName}</td>
                         <td>
                           <select 
                             className="form-select" 
                             value={di.selectedBatchId}
                             onChange={e => updateDispenseItem(idx, 'selectedBatchId', e.target.value)}
                             style={{ width: '100%', fontSize: '0.85rem' }} 
                           >
                             <option value="">-- Select Batch --</option>
                             {di.availableBatches.map(b => (
                               <option key={b.id} value={b.id}>
                                 {b.batch_number || b.id} (Exp: {new Date(b.expiry_date || b.EXPIRY_DATE).toLocaleDateString()})
                               </option>
                             ))}
                           </select>
                         </td>
                         <td>
                           <span style={{ color: (di.selectedBatch?.quantity || 0) < di.requestedQty ? 'var(--red)' : 'var(--green-mid)', fontWeight: 600 }}>
                             {di.selectedBatch ? di.selectedBatch.quantity : di.inStock}
                           </span>
                         </td>
                         <td style={{ textAlign: 'center' }}>{di.requestedQty}</td>
                         <td>
                           <input 
                             type="number" 
                             className="form-input" 
                             value={di.dispenseQty}
                             onChange={e => updateDispenseItem(idx, 'dispenseQty', e.target.value)}
                             style={{ width: '100%', textAlign: 'center' }} 
                           />
                         </td>
                         <td>
                           {di.isPartial ? <span className="badge badge-amber">Partial</span> : <span className="badge badge-green">Full</span>}
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
               <div style={{ marginTop: 24, padding: 16, background: 'var(--surface-2)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                 <div style={{ fontSize: '1.5rem' }}>💡</div>
                 <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                   <strong>IPD Billing Link Active:</strong> For inpatient UHIDs, confirming dispense will immediately route the cost to their central IPD bill. No cash collection required here.
                 </div>
               </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '4rem', marginBottom: 16, opacity: 0.5 }}>📝</div>
            <h3>Select a Prescription</h3>
            <p>Choose a prescription from the queue to process dispensing.</p>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; height: 100%; padding: 0 !important; background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
    </>
  );
}
