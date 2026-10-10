import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { ArrowLeft, ClipboardList, Info, PackageCheck, Printer, RefreshCw } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { useSocket } from '../../../context/SocketContext';

const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
// Batches come from the MedicineBatch model (camelCase); older payloads used snake_case.
const batchRate = (b) => b?.sale_price ?? b?.mrp ?? 0;

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
      console.log('New prescription received:', data);
      toast('New prescription received', { id: 'new-prescription', duration: 4000 });
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
      toast.error('Could not load the dispense queue');
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
        // A free-text medicine that isn't in the catalogue has no medicine_id and no stock;
        // load the rest of the prescription instead of failing on it.
        let batches = [];
        if (rxItem.medicine_id) {
          try {
            const batchRes = await api.get(`/pharmacy/medicines/${rxItem.medicine_id}/batches`);
            batches = batchRes.data.data || [];
          } catch { batches = []; }
        }
        return {
          id: rxItem.id,
          medicineId: rxItem.medicine_id,
          medicineName: rxItem.medicine_name || rxItem.medicine?.name || 'Unknown',
          requestedQty: rxItem.quantity,
          dispenseQty: rxItem.quantity,
          availableBatches: batches,
          selectedBatchId: batches.length > 0 ? batches[0].id : '',
          selectedBatch: batches.length > 0 ? batches[0] : null,
          rate: batches.length > 0 ? batchRate(batches[0]) : 0,
          inStock: batches.reduce((sum, b) => sum + (b.quantity || 0), 0),
          isPartial: false
        };
      }));

      setDispenseItems(itemsWithBatches);
    } catch (err) {
      console.error('Error loading RX details:', err);
      toast.error('Could not load the prescription details');
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
      newItems[index].rate = batchRate(batch);
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
        toast.error(`Select a batch for ${item.medicineName}`);
        return;
      }
      // Prescription items carry no quantity, so the pharmacist must enter one; never send an empty quantity.
      if (!(parseInt(item.dispenseQty) > 0)) {
        toast.error(`Enter the quantity to dispense for ${item.medicineName}`);
        return;
      }
      if (item.dispenseQty > (item.selectedBatch?.quantity || 0)) {
        toast.error(`Not enough stock in the selected batch for ${item.medicineName}`);
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

      // /pharmacy/dispense answers { success: true }; the legacy namespace answered { status: 'success' }.
      if (res.data.success || res.data.status === 'success') {
        toast.success('Medicines dispensed and added to the bill');

        // Populate slip data from the response or local state
        setSlipData({
          id: 'D-' + Date.now(),
          dispensedAt: new Date().toISOString(),
          patientName: selectedPrescription.PATIENT_NAME,
          patientUhid: selectedPrescription.UHID,
          totalAmount: payload.items.reduce((sum, i) => sum + i.amount, 0),
          isIpd: String(selectedPrescription.UHID || '').includes('IPD'),
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
      toast.error(err.response?.data?.message || 'Dispensing failed');
    } finally {
      setDispensing(false);
    }
  };


  const printSlip = () => {
    window.print();
  };

  const queueList = loading && !selectedPrescription ? (
    <p className="muted" style={{ padding: 16 }}>Loading…</p>
  ) : queue.length === 0 ? (
    <EmptyState icon={ClipboardList} title="Queue is clear" description="Finalised prescriptions appear here as doctors complete them." />
  ) : (
    <ul className="list-rows" style={{ padding: 12 }}>
      {queue.map(item => {
        const isSelected = selectedPrescription?.PRESCRIPTION_ID === item.PRESCRIPTION_ID;
        return (
          <li key={item.PRESCRIPTION_ID}>
            <button
              type="button"
              className="list-row"
              aria-pressed={isSelected}
              onClick={() => handleSelectPrescription(item)}
              style={isSelected ? { borderColor: 'var(--primary)', background: 'var(--primary-light)' } : undefined}
            >
              <span className="cell-stack" style={{ minWidth: 0 }}>
                <span className="cell-primary">{item.PATIENT_NAME}</span>
                <span className="cell-secondary"><span className="mono">{item.UHID}</span> · Dr. {item.DOCTOR_NAME}</span>
              </span>
              <span className="cell-stack" style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                <span className="cell-secondary">{fmtTime(item.CREATED_AT)}</span>
                <span className="tag">{Number(item.MEDICINE_COUNT || 0)} {Number(item.MEDICINE_COUNT) === 1 ? 'item' : 'items'}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Dispense prescriptions"
        description="Pick a finalised prescription, choose batches and dispense. The cost is added to the patient's bill."
        actions={(
          <button type="button" className="btn btn-ghost btn-md" onClick={fetchQueue}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        )}
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Left Panel: Queue */}
        <section className="panel" style={{ flex: '1 1 320px', maxWidth: 400 }}>
          <div className="panel-head">
            <h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Pending prescriptions</h2>
            {!loading && <span className="muted tabular">{queue.length}</span>}
          </div>
          <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto' }}>
            {queueList}
          </div>
        </section>

        {/* Right Panel: Action Area */}
        <section className="panel" style={{ flex: '3 1 520px', minWidth: 0 }}>
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
                        <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>₹{Number(item.rate || 0).toFixed(2)}</td>
                        <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>₹{Number(item.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
                  <span>Total Amount:</span>
                  <span>₹{Number(slipData.totalAmount || 0).toFixed(2)}</span>
                </div>
              </div>

              <div style={{ marginTop: 24, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }} className="no-print">
                <button type="button" className="btn btn-ghost btn-md" onClick={() => setSlipData(null)}>
                  <ArrowLeft size={16} aria-hidden="true" /> Back to queue
                </button>
                <button type="button" className="btn btn-primary btn-md" onClick={printSlip}>
                  <Printer size={16} aria-hidden="true" /> Print slip
                </button>
                {slipData.isIpd && (
                  <button type="button" className="btn btn-secondary btn-md" disabled title="Open the IPD bill from the billing module">
                    View IPD bill
                  </button>
                )}
              </div>
            </div>
          ) : selectedPrescription ? (
            <>
              <div className="panel-head" style={{ flexWrap: 'wrap' }}>
                <div className="cell-stack">
                  <h2 style={{ fontSize: '1.1rem', fontWeight: 650 }}>{selectedPrescription.PATIENT_NAME}</h2>
                  <span className="cell-secondary">
                    UHID <span className="mono">{selectedPrescription.UHID}</span> · Prescribed by Dr. {selectedPrescription.DOCTOR_NAME}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  onClick={handleDispense}
                  disabled={dispensing || loading}
                >
                  <PackageCheck size={16} aria-hidden="true" /> {dispensing ? 'Dispensing…' : 'Confirm dispense'}
                </button>
              </div>

              <div className="panel-pad stack-sm">
                {loading ? <p className="muted">Loading prescription…</p> : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Prescribed medicine</th>
                          <th>Batch (expiry)</th>
                          <th className="text-right">In stock</th>
                          <th className="text-right">Requested</th>
                          <th style={{ width: 110 }}>Dispense qty</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dispenseItems.map((di, idx) => {
                          const stock = di.selectedBatch ? di.selectedBatch.quantity : di.inStock;
                          return (
                            <tr key={di.id}>
                              <td className="cell-primary">{di.medicineName}</td>
                              <td style={{ minWidth: 200 }}>
                                <label className="sr-only" htmlFor={`disp-batch-${di.id}`}>Batch for {di.medicineName}</label>
                                <select
                                  id={`disp-batch-${di.id}`}
                                  className="form-select"
                                  value={di.selectedBatchId}
                                  onChange={e => updateDispenseItem(idx, 'selectedBatchId', e.target.value)}
                                >
                                  <option value="">{di.availableBatches.length === 0 ? 'No stock' : 'Select batch'}</option>
                                  {di.availableBatches.map(b => (
                                    <option key={b.id} value={b.id}>
                                      {b.batch_number || b.batchNumber || b.id} (exp {fmtDate(b.expiry_date || b.expiryDate || b.EXPIRY_DATE)})
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="text-right tabular" style={{ fontWeight: 600, color: (di.selectedBatch?.quantity || 0) < di.requestedQty ? 'var(--red)' : 'var(--success)' }}>
                                {stock}
                              </td>
                              <td className="text-right tabular">{di.requestedQty ?? '—'}</td>
                              <td>
                                <label className="sr-only" htmlFor={`disp-qty-${di.id}`}>Quantity to dispense for {di.medicineName}</label>
                                <input
                                  id={`disp-qty-${di.id}`}
                                  type="number"
                                  min="1"
                                  className="form-input"
                                  value={di.dispenseQty ?? ''}
                                  onChange={e => updateDispenseItem(idx, 'dispenseQty', e.target.value)}
                                />
                              </td>
                              <td>
                                {di.isPartial ? <span className="status status-warning">Partial</span> : <span className="status status-success">Full</span>}
                              </td>
                            </tr>
                          );
                        })}
                        {dispenseItems.length === 0 && (
                          <tr><td colSpan={6} className="muted">This prescription has no medicines.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="alert-strip alert-info" role="note" style={{ marginBottom: 0 }}>
                  <Info size={16} aria-hidden="true" />
                  <span>For inpatients, dispensing adds the cost to their IPD bill. No cash is collected here.</span>
                </div>
              </div>
            </>
          ) : (
            <EmptyState icon={ClipboardList} title="Select a prescription" description="Choose a prescription from the queue to start dispensing." />
          )}
        </section>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; height: 100%; padding: 0 !important; background: white !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </main>
    </>
  );
}
