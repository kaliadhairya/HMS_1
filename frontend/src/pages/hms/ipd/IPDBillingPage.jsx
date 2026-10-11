import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ClipboardList, Minus, Pill, Plus, Printer, Receipt, Save, Search, Trash2, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

const money = (n) => Math.round(Number(n || 0) * 100) / 100;

// Advances are used whole, oldest first, while each fits in what is still payable (same rule as the server).
function applyAdvances(amounts, payable) {
  let left = money(payable);
  let used = 0;
  for (const a of amounts || []) {
    if (a > 0 && a <= left + 0.001) { used = money(used + a); left = money(left - a); }
  }
  return used;
}

// Bill shown in the preview: the one just generated, or the admission's existing bill when reopened.
function billFromRecord(b) {
  const items = b.items || [];
  const ward = items.find((i) => (i.ITEM_TYPE || i.item_type) === 'Ward');
  const meds = items.filter((i) => (i.ITEM_TYPE || i.item_type) === 'Medicine');
  return {
    billNumber: b.BILL_NUMBER,
    status: b.STATUS,
    createdAt: b.CREATED_AT,
    totalAmount: Number(b.TOTAL_AMOUNT || 0),
    discountAmount: Number(b.DISCOUNT_AMOUNT || 0),
    advanceAdjusted: Number(b.ADVANCE_ADJUSTED || 0),
    netPayable: Number(b.NET_PAYABLE || 0),
    wardTotal: Number(ward?.AMOUNT || 0),
    wardDays: Number(ward?.QUANTITY || 0),
    medicineTotal: money(meds.reduce((t, i) => t + Number(i.AMOUNT || 0), 0)),
    lines: meds.map((i) => ({ name: i.ITEM_NAME, quantity: Number(i.QUANTITY || 0), amount: Number(i.AMOUNT || 0) })),
  };
}

export default function IPDBillingPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState(null);
  const [charges, setCharges] = useState([]);
  const [wardInfo, setWardInfo] = useState({});
  const [medicineTotal, setMedicineTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
  const [advances, setAdvances] = useState([]);
  const [canDiscount, setCanDiscount] = useState(false);
  const [discount, setDiscount] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Print Preview Mode
  const [previewMode, setPreviewMode] = useState(false);
  const [generatedBill, setGeneratedBill] = useState(null);

  // Medicine search
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState(null);
  const [addQty, setAddQty] = useState(1);

  const fetchAdmission = useCallback(async () => {
    try {
      const res = await api.get(`/ipd/admissions/${admissionId}`);
      setAdmission(res.data.data);
    } catch { toast.error('Could not load admission'); }
  }, [admissionId]);

  const fetchCharges = useCallback(async () => {
    try {
      const res = await api.get(`/ipd/admissions/${admissionId}/charges`);
      const d = res.data.data;
      setCharges(d.charges || []);
      setWardInfo(d.wardInfo || {});
      setMedicineTotal(d.medicineTotal || 0);
      setGrandTotal(d.grandTotal || 0);
      setAdvances(d.advances || []);
      setCanDiscount(Boolean(d.canDiscount));
      // Already billed: show that bill instead of letting it be billed a second time.
      if (d.bill) {
        setGeneratedBill(billFromRecord(d.bill));
        setPreviewMode(true);
      }
    } catch { toast.error('Could not load charges'); }
  }, [admissionId]);

  useEffect(() => {
    Promise.all([fetchAdmission(), fetchCharges()]).finally(() => setLoading(false));
  }, [fetchAdmission, fetchCharges]);

  // Medicine search with debounce
  useEffect(() => {
    if (searchTerm.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/hms/medicines/search?q=${encodeURIComponent(searchTerm)}`);
        setSearchResults(Array.isArray(res.data) ? res.data : res.data.data || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const addCharge = async (med) => {
    try {
      await api.post(`/ipd/admissions/${admissionId}/charges`, {
        medicineId: med.id, medicineName: med.genericName,
        formulation: med.formulation, strength: med.strength, quantity: addQty,
      });
      toast.success(`${med.genericName} added`);
      setAddingId(null);
      setAddQty(1);
      setSearchTerm('');
      setSearchResults([]);
      fetchCharges();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not add item'); }
  };

  const updateQty = async (charge, newQty) => {
    if (newQty < 1) return;
    try {
      await api.patch(`/ipd/admissions/${admissionId}/charges/${charge.ID}`, { quantity: newQty });
      fetchCharges();
    } catch (err) { toast.error(err.response?.data?.message || 'Could not update quantity'); }
  };

  const removeCharge = async (charge) => {
    try {
      await api.delete(`/ipd/admissions/${admissionId}/charges/${charge.ID}`);
      toast.success('Item removed');
      fetchCharges();
    } catch { toast.error('Could not remove item'); }
  };

  const discountValue = money(discount);
  const discountError = discount !== '' && (!Number.isFinite(Number(discount)) || Number(discount) < 0)
    ? 'Enter zero or more.'
    : discountValue > money(grandTotal) ? 'The discount is more than the bill total.' : '';
  const advanceAdjusted = useMemo(
    () => applyAdvances(advances, money(grandTotal) - (discountError ? 0 : discountValue)),
    [advances, grandTotal, discountValue, discountError],
  );
  const advanceAvailable = money(advances.reduce((t, a) => t + a, 0));
  const netPayable = Math.max(0, money(grandTotal - (discountError ? 0 : discountValue) - advanceAdjusted));

  const generateBill = async () => {
    if (discountError) { toast.error(discountError); return; }
    setGenerating(true);
    try {
      // The items on screen are sent along: the server keeps unsaved items in memory only.
      const res = await api.post(`/ipd/admissions/${admissionId}/generate-bill`, {
        items: charges.map((c) => ({ medicineId: c.MEDICINE_ID, quantity: c.QUANTITY, strength: c.STRENGTH })),
        discountAmount: canDiscount ? discountValue : 0,
      });
      const d = res.data.data;
      toast.success(`Bill generated: ${d.billNumber}`);
      setGeneratedBill({
        ...d,
        createdAt: new Date().toISOString(),
        wardDays: wardInfo.daysAdmitted,
        lines: charges.map((c) => ({ name: `${c.MEDICINE_NAME} ${c.STRENGTH || ''}`.trim(), quantity: c.QUANTITY, amount: c.TOTAL_PRICE })),
      });
      setPreviewMode(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not generate bill');
      if (err.response?.status === 409) fetchCharges();
    } finally { setGenerating(false); }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (<><Navbar /><main className="app-page"><p className="muted">Loading…</p></main></>);
  }

  const summaryRow = { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.87rem' };
  // Amount of the bill after discount (advances are a payment against it, shown separately).
  const billAmount = money(Number(generatedBill?.totalAmount || 0) - Number(generatedBill?.discountAmount || 0));
  const summaryTotal = { ...summaryRow, borderTop: '1px dashed var(--border)', marginTop: 8, paddingTop: 8, fontWeight: 650 };

  return (
    <>
      {!previewMode && <Navbar />}
      
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-section, .print-section * { visibility: visible; }
          .print-section { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 20px; }
          .no-print { display: none !important; }
          @page { size: A4; margin: 20mm; }
        }
        .bill-preview-paper {
          background: white; color: black; max-width: 800px; margin: 0 auto; padding: 50px 40px; 
          box-shadow: 0 4px 20px rgba(0,0,0,0.1); font-family: 'Times New Roman', serif;
          border: 1px solid #ddd;
        }
      `}</style>

      {!previewMode ? (
        <main className="app-page">
          <PageHeader
            title="IPD billing"
            description={`Patient checkout · Admission ${admission?.ADMISSION_ID_FORMATTED || admissionId}`}
            actions={(
              <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/ipd/billing')}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to list
              </button>
            )}
          />

          {/* Patient and admission */}
          <section className="panel panel-pad" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <span className="cell-avatar" aria-hidden="true">{(admission?.PATIENT_NAME || '?').charAt(0).toUpperCase()}</span>
              <span className="cell-stack">
                <span className="cell-primary" style={{ fontSize: '1.05rem' }}>{admission?.PATIENT_NAME}</span>
                <span className="cell-secondary"><span className="mono">{admission?.UHID}</span> · {admission?.AGE} y / {admission?.GENDER?.[0]}</span>
              </span>
              {admission?.STATUS === 'Active'
                ? <span className="status status-info" style={{ marginLeft: 'auto' }}>In hospital</span>
                : <span className="status status-neutral" style={{ marginLeft: 'auto' }}>Discharged {admission?.DISCHARGE_DATE ? new Date(admission.DISCHARGE_DATE).toLocaleDateString('en-IN') : ''}</span>}
            </div>
            <div className="facts">
              <div>
                <div className="fact-label">Location</div>
                <div className="fact-value">{admission?.WARD_NAME} · Bed {admission?.BED_NUMBER} ({admission?.ROOM_NUMBER})</div>
              </div>
              <div>
                <div className="fact-label">Duration</div>
                <div className="fact-value">{wardInfo.daysAdmitted || 0} days <span className="cell-secondary">(since {new Date(admission?.ADMISSION_DATE).toLocaleDateString()})</span></div>
              </div>
              <div>
                <div className="fact-label">Consulting doctor</div>
                <div className="fact-value">{admission?.DOCTOR_NAME}</div>
              </div>
              <div>
                <div className="fact-label">Dept. / type</div>
                <div className="fact-value">{admission?.DEPARTMENT} / {admission?.ADMISSION_TYPE}</div>
              </div>
            </div>
          </section>

          {/* Main layout */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>

            {/* LEFT: Medicine selection */}
            <div className="stack" style={{ flex: '2 1 520px', minWidth: 0 }}>
              {/* Search */}
              <section className="panel panel-pad">
                <h2 className="panel-title"><Pill size={16} aria-hidden="true" /> Add medicines and consumables</h2>
                <label className="search-field" style={{ display: 'block' }}>
                  <Search size={17} aria-hidden="true" />
                  <span className="sr-only">Search medicines</span>
                  <input
                    placeholder="Search medicines by name"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </label>
                {searching && <p className="muted" style={{ marginTop: 8 }}>Searching…</p>}

                {/* Search results */}
                {searchResults.length > 0 && (
                  <ul className="list-rows" style={{ marginTop: 10, maxHeight: 300, overflowY: 'auto' }}>
                    {searchResults.map(med => (
                      <li key={med.id} className="list-row" style={{ cursor: 'default' }}>
                        <span className="cell-stack">
                          <span className="cell-primary">{med.genericName}</span>
                          <span className="cell-secondary">
                            {med.formulation}{med.strength ? ` · ${med.strength}${med.strengthUnit || ''}` : ''}{med.unitOfSale ? ` · ${med.unitOfSale}` : ''}
                          </span>
                        </span>

                        {addingId === med.id ? (
                          <span className="inline-actions">
                            <label className="sr-only" htmlFor={`qty-${med.id}`}>Quantity</label>
                            <input
                              id={`qty-${med.id}`}
                              className="form-input"
                              type="number" min="1" max="99" value={addQty}
                              onChange={e => setAddQty(Number(e.target.value))}
                              style={{ width: 70, height: 32, textAlign: 'center' }}
                            />
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => addCharge(med)}>Add</button>
                            <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => { setAddingId(null); setAddQty(1); }}>
                              <X size={16} aria-hidden="true" />
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingId(med.id)}>
                            <Plus size={14} aria-hidden="true" /> Select
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Charges */}
              <section className="panel">
                <div className="panel-head">
                  <h2 className="panel-title" style={{ margin: 0 }}><ClipboardList size={16} aria-hidden="true" /> Added items</h2>
                  <span className="cell-secondary">{charges.length} {charges.length === 1 ? 'item' : 'items'}</span>
                </div>

                {charges.length === 0 ? (
                  <EmptyState icon={Pill} title="No items added yet" description="Search above to add medicines and consumables to this bill." />
                ) : (
                  <div className="dt-scroll">
                    <table className="dt-table">
                      <thead>
                        <tr>
                          <th style={{ width: 44 }}>#</th>
                          <th>Medicine</th>
                          <th style={{ textAlign: 'center' }}>Qty</th>
                          <th style={{ textAlign: 'right' }}>Unit price (₹)</th>
                          <th style={{ textAlign: 'right' }}>Total (₹)</th>
                          <th style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {charges.map((c, i) => (
                          <tr key={c.ID}>
                            <td className="tabular cell-secondary">{i + 1}</td>
                            <td>
                              <span className="cell-stack">
                                <span className="cell-primary">{c.MEDICINE_NAME}</span>
                                <span className="cell-secondary">{c.FORMULATION}{c.STRENGTH ? ` · ${c.STRENGTH}` : ''}</span>
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                <button type="button" className="icon-btn" style={{ width: 28, height: 28, border: '1px solid var(--border)' }} onClick={() => updateQty(c, c.QUANTITY - 1)} disabled={c.QUANTITY <= 1} aria-label={`Decrease quantity of ${c.MEDICINE_NAME}`}>
                                  <Minus size={14} aria-hidden="true" />
                                </button>
                                <span className="tabular" style={{ minWidth: 28, textAlign: 'center', fontWeight: 600 }}>{c.QUANTITY}</span>
                                <button type="button" className="icon-btn" style={{ width: 28, height: 28, border: '1px solid var(--border)' }} onClick={() => updateQty(c, c.QUANTITY + 1)} aria-label={`Increase quantity of ${c.MEDICINE_NAME}`}>
                                  <Plus size={14} aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                            <td className="tabular" style={{ textAlign: 'right' }}>₹{(c.UNIT_PRICE || 0).toFixed(2)}</td>
                            <td className="tabular" style={{ textAlign: 'right', fontWeight: 600 }}>₹{(c.TOTAL_PRICE || 0).toFixed(2)}</td>
                            <td style={{ textAlign: 'right' }}>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeCharge(c)} aria-label={`Remove ${c.MEDICINE_NAME}`}>
                                <Trash2 size={14} aria-hidden="true" /> Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            {/* RIGHT: Bill summary */}
            <section className="panel" style={{ flex: '1 1 320px', position: 'sticky', top: 90 }}>
              <div className="panel-head">
                <div className="cell-stack">
                  <h2 className="panel-title" style={{ margin: 0 }}><Receipt size={16} aria-hidden="true" /> Bill summary</h2>
                  <span className="cell-secondary">{admission?.PATIENT_NAME || 'Patient'}</span>
                </div>
              </div>

              <div className="panel-pad stack-sm">
                {/* Ward charges */}
                <div>
                  <div className="fact-label" style={{ marginBottom: 6 }}>Ward charges</div>
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <div style={summaryRow}>
                      <span style={{ color: 'var(--text-secondary)' }}>{wardInfo.wardName || 'Ward'}</span>
                      <span className="tabular">₹{wardInfo.wardRate || 0}/day</span>
                    </div>
                    <div style={{ ...summaryRow, marginTop: 6 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                      <span className="tabular">{wardInfo.daysAdmitted || 1} day(s)</span>
                    </div>
                    <div style={summaryTotal}>
                      <span>Ward total</span>
                      <span className="tabular">₹{Number(wardInfo.wardTotal || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Medicine charges */}
                <div>
                  <div className="fact-label" style={{ marginBottom: 6 }}>Medicines and consumables</div>
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <div style={summaryRow}>
                      <span style={{ color: 'var(--text-secondary)' }}>Items</span>
                      <span className="tabular">{charges.length} item(s)</span>
                    </div>
                    <div style={summaryTotal}>
                      <span>Medicine total</span>
                      <span className="tabular">₹{Number(medicineTotal || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Total, discount, advance */}
                <div style={{ padding: '12px 14px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div style={summaryRow}>
                    <span style={{ color: 'var(--text-secondary)' }}>Bill total</span>
                    <span className="tabular">₹{Number(grandTotal || 0).toFixed(2)}</span>
                  </div>
                  {canDiscount ? (
                    <div className="form-group" style={{ marginTop: 10 }}>
                      <label className="form-label" htmlFor="bill-discount">Discount (₹)</label>
                      <input
                        id="bill-discount"
                        className="form-input"
                        type="number" min="0" step="0.01" inputMode="decimal"
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                        aria-invalid={Boolean(discountError)}
                        aria-describedby="bill-discount-hint"
                      />
                      <p className="form-hint" id="bill-discount-hint" style={discountError ? { color: 'var(--red)' } : undefined}>
                        {discountError || 'Approved by you as administrator.'}
                      </p>
                    </div>
                  ) : (
                    <p className="form-hint" style={{ marginTop: 8 }}>Discounts are approved by an administrator.</p>
                  )}
                  <div style={{ ...summaryRow, marginTop: 6 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Advance adjusted</span>
                    <span className="tabular">− ₹{advanceAdjusted.toFixed(2)}</span>
                  </div>
                  {advanceAvailable > advanceAdjusted && (
                    <p className="form-hint">₹{money(advanceAvailable - advanceAdjusted).toFixed(2)} of advance stays with the patient for refund or adjustment at the cash desk.</p>
                  )}
                </div>

                {/* Net payable */}
                <div style={{
                  padding: '14px 16px', borderRadius: 8,
                  background: 'var(--primary-light)', border: '1px solid var(--primary-border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 650 }}>Net payable</span>
                  <span className="tabular" style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '1.3rem' }}>₹{netPayable.toFixed(2)}</span>
                </div>

                {/* Save draft */}
                <button
                  type="button"
                  className="btn btn-secondary btn-md"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    toast.success('Billing progress saved as draft');
                    navigate('/ipd/saved-bills');
                  }}
                >
                  <Save size={16} aria-hidden="true" /> Save progress
                </button>

                {/* Generate bill */}
                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={generateBill}
                  disabled={generating || Boolean(discountError)}
                >
                  <Receipt size={16} aria-hidden="true" /> {generating ? 'Generating…' : 'Generate IPD bill'}
                </button>
              </div>
            </section>
          </div>
        </main>
      ) : (
        <div style={{ padding: '20px', background: 'var(--surface-3)', minHeight: '100vh' }}>
          <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
            <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate('/ipd/billing')}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to admissions
            </button>
            <button type="button" className="btn btn-primary btn-md" onClick={handlePrint}>
              <Printer size={16} aria-hidden="true" /> Print bill
            </button>
          </div>
          
          <div className="print-section bill-preview-paper">
            {/* Header */}
            <div style={{ display: 'flex', position: 'relative', borderBottom: '2px solid #000', paddingBottom: 15, marginBottom: 20 }}>
              <img src="/logo.png" alt="Hospital Logo" style={{ width: 90, height: 90, position: 'absolute', left: 0, top: 0, objectFit: 'contain' }} />
              <div style={{ flex: 1, textAlign: 'center', padding: '0 210px 0 100px' }}>
                <h2 style={{ margin: '0 0 5px', fontSize: '20px', fontWeight: 'bold' }}>HMS HOSPITAL</h2>
                <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 'bold' }}>HOSPITAL MANAGEMENT SYSTEM</h2>
                <h3 style={{ margin: '0 0 5px', fontSize: '16px', textDecoration: 'underline', textTransform: 'uppercase' }}>
                  HOSPITAL BILL OF {admission?.WARD_TYPE === 'Maternity' ? 'MATERNITY' : 'IPD'} PATIENT
                </h3>
              </div>
              <div style={{ position: 'absolute', right: 0, top: 0, textAlign: 'right', fontSize: '12px', border: '1px solid #000', padding: '6px', background: '#fff', maxWidth: '200px' }}>
                <div style={{ marginBottom: 4 }}>Receipt No. : <strong style={{ marginLeft: 4 }}>{generatedBill?.billNumber}</strong></div>
                <div style={{ marginBottom: 4 }}>Final Bill Amt : <strong style={{ marginLeft: 4 }}>Rs {billAmount.toFixed(2)}/-</strong></div>
                <div>Date : <strong style={{ marginLeft: 4 }}>{new Date(generatedBill?.createdAt || Date.now()).toLocaleDateString('en-IN')}</strong></div>
              </div>
            </div>

            {/* Patient Details */}
            <div style={{ lineHeight: '2.2', fontSize: '15px', marginBottom: '25px' }}>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1 }}>Name: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.PATIENT_NAME}</strong></div>
                <div style={{ flex: 1 }}>Registration No.: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px', whiteSpace: 'nowrap' }}>{admission?.UHID || `ID-${admission?.PATIENT_ID}`}</strong></div>
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1 }}>Address: <span style={{ display: 'inline-block', width: '85%', borderBottom: '1px dotted #000' }}>&nbsp;</span></div>
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1.2 }}>Dt. of Admn: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.ADMISSION_DATE ? new Date(admission.ADMISSION_DATE).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '-'}</strong></div>
                <div style={{ flex: 1.2 }}>Dt. of Disch: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{new Date(admission?.DISCHARGE_DATE || Date.now()).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</strong></div>
                <div style={{ flex: 0.8 }}>Ward: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.WARD_NAME || admission?.WARD_TYPE || 'General'}</strong></div>
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1 }}>Diagnosis: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.DIAGNOSIS || '__________________'}</strong></div>
              </div>
              <div style={{ display: 'flex', marginTop: 5 }}>
                <div style={{ flex: 1 }}>Routine admission: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>Yes</strong></div>
                <div style={{ flex: 1 }}>Duration: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{generatedBill?.wardDays || wardInfo?.daysAdmitted || 1} days</strong></div>
              </div>
            </div>

            {/* Charges Summary */}
            <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '15px 0', marginBottom: '25px', display: 'flex' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '60%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '15px' }}>
                      <span>Stay charges</span>
                      <span>{Number(generatedBill?.wardTotal || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '15px' }}>
                      <span>Medicines</span>
                      <span>{Number(generatedBill?.medicineTotal || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', marginTop: '10px', paddingTop: '10px', fontWeight: 'bold', fontSize: '16px' }}>
                      <span>Total</span>
                      <span>{Number(generatedBill?.totalAmount || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '15px' }}>
                      <span>Less discount</span>
                      <span>{Number(generatedBill?.discountAmount || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: '15px' }}>
                      <span>Less advance adjusted</span>
                      <span>{Number(generatedBill?.advanceAdjusted || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', marginTop: '10px', paddingTop: '10px', fontWeight: 'bold', fontSize: '16px' }}>
                      <span>Net payable</span>
                      <span>{Number(generatedBill?.netPayable || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Medicines List */}
            <div style={{ display: 'flex', gap: '50px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '15px', fontSize: '15px' }}>Hospital Medicines<br/><span style={{ fontWeight: 'normal' }}>अस्पताल दवाईयां</span></div>
                <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(generatedBill?.lines || []).map((c, i) => (
                      <tr key={i}>
                        <td style={{ padding: '4px 0' }}>{c.name}</td>
                        <td style={{ padding: '4px 0', textAlign: 'center' }}>- {c.quantity} -</td>
                        <td style={{ padding: '4px 0', textAlign: 'right' }}>{Number(c.amount || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan="2" style={{ borderTop: '1px solid #000', textAlign: 'right', padding: '8px 10px 0 0', fontWeight: 'bold' }}>Total</td>
                      <td style={{ borderTop: '1px solid #000', textAlign: 'right', padding: '8px 0 0 0', fontWeight: 'bold' }}>{Number(generatedBill?.medicineTotal || 0).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'bold', marginBottom: '15px', fontSize: '15px' }}>Own Medicines<br/><span style={{ fontWeight: 'normal' }}>अपनी दवाईयां</span></div>
                {/* Placeholder lines for own medicines */}
                <div style={{ borderBottom: '1px dotted #999', height: '24px', marginBottom: '8px' }}></div>
                <div style={{ borderBottom: '1px dotted #999', height: '24px', marginBottom: '8px' }}></div>
                <div style={{ borderBottom: '1px dotted #999', height: '24px', marginBottom: '8px' }}></div>
                <div style={{ borderBottom: '1px dotted #999', height: '24px', marginBottom: '8px' }}></div>
                <div style={{ borderBottom: '1px dotted #999', height: '24px', marginBottom: '8px' }}></div>
              </div>
            </div>

            {/* Footer Signatures */}
            <div style={{ marginTop: '60px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <div style={{ fontSize: '16px' }}>
                Approved for Rs. <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px', fontSize: '18px' }}>{billAmount.toFixed(2)} /-</strong><br/>
                धन की स्वीकृति
              </div>
              <div style={{ textAlign: 'center', fontSize: '15px' }}>
                <div style={{ borderBottom: '1px dotted #000', width: '200px', marginBottom: '10px' }}></div>
                Chief Medical Officer<br/>
                मुख्य चिकित्सा अधिकारी
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

