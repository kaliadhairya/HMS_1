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
const inr = (v) => `₹${Number(v || 0).toFixed(2)}`;
// Batches come from the MedicineBatch model (camelCase); older payloads used snake_case.
const batchRate = (b) => b?.sale_price ?? b?.mrp ?? 0;
const batchNo = (b) => b?.batch_number || b?.batchNumber || b?.id;
const batchExpiry = (b) => b?.expiry_date || b?.expiryDate || b?.EXPIRY_DATE;

// Why a line is not being dispensed. The first applicable reason is preselected.
const NOT_DISPENSED_REASONS = ['Not in catalogue', 'Out of stock', 'Patient declined', 'Other'];

// Doctor names are often stored with the title already ("Dr. Ramesh Kumar").
const drName = (name) => (/^dr\.?\s/i.test(String(name || '')) ? name : `Dr. ${name || '—'}`);

const dosageText = (rx) => [
  [rx.dose, rx.dose_unit].filter(Boolean).join(' '),
  rx.frequency,
  rx.duration_days ? `${rx.duration_days} ${Number(rx.duration_days) === 1 ? 'day' : 'days'}` : null,
].filter(Boolean).join(' · ');

export default function DispensePage() {
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPrescription, setSelectedPrescription] = useState(null);
  const [dispensing, setDispensing] = useState(false);
  const [slipData, setSlipData] = useState(null);
  const socket = useSocket();

  // One row per prescription line
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

      // 2. For each item, fetch the batches that can be dispensed (in stock, not expired, earliest expiry first)
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
        const unavailableReason = !rxItem.medicine_id ? 'Not in catalogue' : batches.length === 0 ? 'Out of stock' : null;
        return {
          id: rxItem.id,
          medicineId: rxItem.medicine_id,
          medicineName: rxItem.medicine_name || rxItem.medicine?.name || 'Unknown',
          dosage: dosageText(rxItem),
          dispenseQty: '',
          availableBatches: batches,
          selectedBatchId: batches.length > 0 ? String(batches[0].id) : '',
          selectedBatch: batches.length > 0 ? batches[0] : null,
          rate: batches.length > 0 ? batchRate(batches[0]) : 0,
          inStock: batches.reduce((sum, b) => sum + (b.quantity || 0), 0),
          unavailableReason,
          notDispensed: false,
          reason: unavailableReason || 'Patient declined',
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
    setDispenseItems((prev) => prev.map((item, i) => {
      if (i !== index) return item;
      if (field === 'selectedBatchId') {
        const batch = item.availableBatches.find((b) => String(b.id) === String(value)) || null;
        return { ...item, selectedBatchId: value, selectedBatch: batch, rate: batchRate(batch) };
      }
      return { ...item, [field]: value };
    }));
  };

  const handleDispense = async () => {
    if (!selectedPrescription || dispenseItems.length === 0) return;

    const toDispense = dispenseItems.filter((item) => !item.notDispensed);
    // Validation: every line is either dispensed from a batch with enough stock, or marked as not dispensed.
    for (const item of toDispense) {
      if (!item.selectedBatchId) {
        toast.error(`Select a batch for ${item.medicineName}, or mark it as not dispensed`);
        return;
      }
      const qty = Number(item.dispenseQty);
      // Prescription items carry no quantity, so the pharmacist must enter one; never send an empty quantity.
      if (!Number.isInteger(qty) || qty <= 0) {
        toast.error(`Enter the quantity to dispense for ${item.medicineName}`);
        return;
      }
      if (qty > Number(item.selectedBatch?.quantity || 0)) {
        toast.error(`Not enough stock in the selected batch for ${item.medicineName}`);
        return;
      }
    }
    if (toDispense.length === 0) {
      toast.error('Nothing to dispense. At least one medicine must be dispensed from stock.');
      return;
    }

    try {
      setDispensing(true);

      // Rates and amounts are worked out by the server from the batch MRP.
      const payload = {
        prescriptionId: selectedPrescription.PRESCRIPTION_ID,
        items: toDispense.map((item) => ({
          prescriptionItemId: item.id,
          medicineId: item.medicineId,
          batchId: Number(item.selectedBatchId),
          quantity: Number(item.dispenseQty),
          medicineName: item.medicineName,
        })),
        notDispensed: dispenseItems.filter((item) => item.notDispensed).map((item) => ({
          prescriptionItemId: item.id,
          medicineName: item.medicineName,
          reason: item.reason,
        })),
      };

      const res = await api.post('/pharmacy/dispense', payload);

      // /pharmacy/dispense answers { success: true }; the legacy namespace answered { status: 'success' }.
      if (res.data.success || res.data.status === 'success') {
        const data = res.data;
        toast.success(data.notDispensed?.length ? data.message : 'Medicines dispensed and added to the bill');

        setSlipData({
          id: data.dispensingRecordId,
          dispensedAt: data.dispensedAt || new Date().toISOString(),
          patientName: selectedPrescription.PATIENT_NAME,
          patientUhid: selectedPrescription.UHID,
          billNumber: data.billNumber,
          totalAmount: data.totalAmount,
          isIpd: data.billType === 'IPD',
          items: data.items || [],
          notDispensed: data.notDispensed || [],
        });

        fetchQueue();
        setSelectedPrescription(null);
        setDispenseItems([]);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Dispensing failed');
      // Someone else dispensed it first: drop it from the screen and the queue.
      if (err.response?.status === 409) {
        setSelectedPrescription(null);
        setDispenseItems([]);
        fetchQueue();
      }
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
                <span className="cell-secondary"><span className="mono">{item.UHID}</span> · {drName(item.DOCTOR_NAME)}</span>
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
        <section className="panel" style={{ flex: '1 1 320px', maxWidth: 400 }} aria-label="Pending prescriptions">
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
            <div style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, overflowY: 'auto' }} className="print-area" role="region" aria-label="Dispensing slip">
              <h2 style={{ marginBottom: 8, color: 'var(--success)' }}>Rx Dispensed</h2>
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
                    {slipData.isIpd && <div style={{ color: 'var(--primary)', fontWeight: 600, marginTop: 4 }}>[IPD Patient - Sent to Central Billing]</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div><strong>Record ID:</strong> #{slipData.id}</div>
                    {slipData.billNumber && <div><strong>Bill:</strong> {slipData.billNumber}</div>}
                  </div>
                </div>

                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-3)' }}>
                      <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Medicine</th>
                      <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Batch</th>
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
                        </td>
                        <td style={{ padding: 8, borderBottom: '1px dashed var(--border)' }} className="mono">
                          {item.batchNumber}{item.expiryDate ? ` (exp ${fmtDate(item.expiryDate)})` : ''}
                        </td>
                        <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>
                          {item.quantity}
                        </td>
                        <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px dashed var(--border)' }}>{inr(item.rate)}</td>
                        <td style={{ padding: 8, textAlign: 'right', borderBottom: '1px dashed var(--border)' }}>{inr(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {slipData.notDispensed.length > 0 && (
                  <div style={{ marginBottom: 24 }}>
                    <strong>Not dispensed</strong>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                      {slipData.notDispensed.map((n) => (
                        <li key={n.prescriptionItemId}>{n.medicineName} <span style={{ color: 'var(--text-secondary)' }}>({n.reason})</span></li>
                      ))}
                    </ul>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 700 }}>
                  <span>Total Amount:</span>
                  <span>{inr(slipData.totalAmount)}</span>
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
                    UHID <span className="mono">{selectedPrescription.UHID}</span> · Prescribed by {drName(selectedPrescription.DOCTOR_NAME)}
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
                          <th style={{ width: 110 }}>Dispense qty</th>
                          <th style={{ minWidth: 190 }}>Not dispensed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dispenseItems.map((di, idx) => {
                          const stock = di.selectedBatch ? di.selectedBatch.quantity : di.inStock;
                          const off = di.notDispensed;
                          return (
                            <tr key={di.id} style={off ? { opacity: 0.75 } : undefined}>
                              <td>
                                <span className="cell-stack">
                                  <span className="cell-primary">{di.medicineName}</span>
                                  {di.dosage && <span className="cell-secondary">{di.dosage}</span>}
                                  {di.unavailableReason && (
                                    <span><span className={`status ${di.medicineId ? 'status-danger' : 'status-warning'}`}>{di.unavailableReason}</span></span>
                                  )}
                                </span>
                              </td>
                              <td style={{ minWidth: 200 }}>
                                <label className="sr-only" htmlFor={`disp-batch-${di.id}`}>Batch for {di.medicineName}</label>
                                <select
                                  id={`disp-batch-${di.id}`}
                                  className="form-select"
                                  value={di.selectedBatchId}
                                  disabled={off || di.availableBatches.length === 0}
                                  onChange={e => updateDispenseItem(idx, 'selectedBatchId', e.target.value)}
                                >
                                  <option value="">{di.availableBatches.length === 0 ? 'No stock' : 'Select batch'}</option>
                                  {di.availableBatches.map(b => (
                                    <option key={b.id} value={String(b.id)}>
                                      {batchNo(b)} (exp {fmtDate(batchExpiry(b))}) · {inr(batchRate(b))}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="text-right tabular" style={{ fontWeight: 600, color: Number(stock || 0) <= 0 ? 'var(--red)' : undefined }}>
                                {stock}
                              </td>
                              <td>
                                <label className="sr-only" htmlFor={`disp-qty-${di.id}`}>Quantity to dispense for {di.medicineName}</label>
                                <input
                                  id={`disp-qty-${di.id}`}
                                  type="number"
                                  min="1"
                                  step="1"
                                  className="form-input"
                                  value={di.dispenseQty ?? ''}
                                  disabled={off}
                                  onChange={e => updateDispenseItem(idx, 'dispenseQty', e.target.value)}
                                />
                              </td>
                              <td>
                                <div className="stack-sm" style={{ gap: 6 }}>
                                  <label className="check-row" htmlFor={`disp-skip-${di.id}`} style={{ margin: 0 }}>
                                    <input
                                      type="checkbox"
                                      id={`disp-skip-${di.id}`}
                                      checked={off}
                                      onChange={e => updateDispenseItem(idx, 'notDispensed', e.target.checked)}
                                      aria-label={`Not dispensed: ${di.medicineName}`}
                                    />
                                    <span>Not dispensed</span>
                                  </label>
                                  {off && (
                                    <>
                                      <label className="sr-only" htmlFor={`disp-reason-${di.id}`}>Reason {di.medicineName} is not dispensed</label>
                                      <select
                                        id={`disp-reason-${di.id}`}
                                        className="form-select"
                                        value={di.reason}
                                        onChange={e => updateDispenseItem(idx, 'reason', e.target.value)}
                                      >
                                        {NOT_DISPENSED_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                      </select>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {dispenseItems.length === 0 && (
                          <tr><td colSpan={5} className="muted">This prescription has no medicines.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
                {dispenseItems.some((d) => d.unavailableReason && !d.notDispensed) && (
                  <div className="alert-strip alert-warning" role="note" style={{ marginBottom: 0 }}>
                    <Info size={16} aria-hidden="true" />
                    <span>Some medicines cannot be supplied from stock. Mark them as not dispensed to dispense the rest; they are listed on the slip.</span>
                  </div>
                )}
                <div className="alert-strip alert-info" role="note" style={{ marginBottom: 0 }}>
                  <Info size={16} aria-hidden="true" />
                  <span>Each line is charged at the batch MRP. For inpatients, dispensing adds the cost to their IPD bill. No cash is collected here.</span>
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
