import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Building2, ClipboardList, Eye, Pill, Plus, Printer, Search, Send, Trash2 } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10, maxHeight: 240, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  width: '100%', textAlign: 'left', padding: '9px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer',
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
};

export default function RaiseIndentPage() {
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Form State
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const [notes, setNotes] = useState('');
  
  // Medicine Items
  const [items, setItems] = useState([]);
  const [medSearchQuery, setMedSearchQuery] = useState('');
  const [medSuggestions, setMedSuggestions] = useState([]);
  const [showMedSuggestions, setShowMedSuggestions] = useState(false);
  
  // Print Preview
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Fetch active suppliers
    api.get('/suppliers')
      .then(res => {
        setSuppliers(res.data.data || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Debounced Medicine Search
  useEffect(() => {
    if (medSearchQuery.length < 2) {
      setMedSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api.get(`/medicines/search?q=${encodeURIComponent(medSearchQuery)}`)
        .then(res => {
          setMedSuggestions(res.data || []);
        })
        .catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [medSearchQuery]);

  // Supplier handlers
  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setShowSuggestions(true);
    if (selectedSupplier && e.target.value !== selectedSupplier.supplierNumber) {
      setSelectedSupplier(null);
    }
  };

  const selectSupplier = (supplier) => {
    setSelectedSupplier(supplier);
    setSearchQuery(supplier.supplierNumber);
    setShowSuggestions(false);
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    (s.supplierNumber && s.supplierNumber.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Medicine Item Handlers
  const addMedicine = (med) => {
    // Check if already added
    if (items.some(item => item.id === med.id)) {
      toast.error('That medicine is already on the list');
      return;
    }
    
    setItems([...items, {
      id: med.id,
      genericName: med.genericName,
      unitOfSale: med.unitOfSale || 'Unit',
      qty: 1,
      unitPrice: 0,
      gstRate: med.gstRate || 0,
      total: 0
    }]);
    setMedSearchQuery('');
    setShowMedSuggestions(false);
  };

  const updateItem = (index, field, value) => {
    const newItems = [...items];
    newItems[index][field] = Number(value) >= 0 ? Number(value) : 0;
    
    // Recalculate total for this item
    const qty = newItems[index].qty;
    const price = newItems[index].unitPrice;
    const gst = newItems[index].gstRate;
    
    const baseAmount = qty * price;
    const taxAmount = baseAmount * (gst / 100);
    newItems[index].total = baseAmount + taxAmount;
    
    setItems(newItems);
  };

  const removeItem = (index) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  // Grand Total Calculation
  const grandTotal = items.reduce((sum, item) => sum + item.total, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSupplier) {
      toast.error('Select a supplier');
      return;
    }
    if (items.length === 0) {
      toast.error('Add at least one medicine to the request');
      return;
    }
    if (!expectedDelivery) {
      toast.error('Enter the expected delivery date');
      return;
    }

    try {
      setSubmitting(true);
      await api.post('/pharmacist_lms/purchase-orders', {
        supplierId: selectedSupplier.id,
        expectedDelivery,
        notes,
        items: items,
        grandTotal
      });
      toast.success('Purchase request created');
      navigate('/pharmacy/pos');
    } catch (err) {
      console.error(err);
      toast.error('Could not create the purchase request');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // If in print preview mode
  if (showPreview) {
    return (
      <div className="print-preview-container" style={{ background: '#fff', minHeight: '100vh', padding: '40px', color: '#000' }}>
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-preview-container, .print-preview-container * { visibility: visible; }
            .print-preview-container { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
            .no-print { display: none !important; }
          }
          .print-header { display: flex; align-items: center; border-bottom: 2px solid #2c3e50; padding-bottom: 20px; margin-bottom: 30px; }
          .print-logo { width: 80px; height: 80px; object-fit: contain; margin-right: 20px; }
          .print-title { flex: 1; text-align: center; }
          .print-title h1 { margin: 0; font-size: 24px; color: #2c3e50; text-transform: uppercase; letter-spacing: 1px; }
          .print-title h2 { margin: 5px 0 0 0; font-size: 18px; color: #34495e; }
          .print-title p { margin: 5px 0 0 0; font-size: 14px; color: #7f8c8d; }
          .print-meta { display: flex; justify-content: space-between; margin-bottom: 30px; font-size: 14px; }
          .print-meta-box { border: 1px solid #bdc3c7; padding: 15px; border-radius: 4px; width: 48%; }
          .print-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; font-size: 14px; }
          .print-table th, .print-table td { border: 1px solid #bdc3c7; padding: 10px; text-align: left; }
          .print-table th { background-color: #f8f9fa; font-weight: bold; color: #2c3e50; }
          .print-table td.num { text-align: right; }
          .print-table th.num { text-align: right; }
          .print-footer { display: flex; justify-content: space-between; margin-top: 50px; }
          .sign-box { text-align: center; width: 200px; }
          .sign-line { border-top: 1px solid #000; margin-top: 60px; padding-top: 10px; }
        `}</style>

        {/* Action Buttons (Hidden in actual print) */}
        <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: '30px', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-md" onClick={() => setShowPreview(false)}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to edit
          </button>
          <button type="button" className="btn btn-primary btn-md" onClick={handlePrint}>
            <Printer size={16} aria-hidden="true" /> Print request
          </button>
        </div>

        {/* Formal Document */}
        <div className="print-header">
          <img src="/logo.png" alt="Hospital Logo" className="print-logo" />
          <div className="print-title">
            <h1>HMS Hospital</h1>
            <h2>Hospital Management System</h2>
            <p>Pharmacy & Store Department</p>
          </div>
          <div style={{ width: '80px' }}></div> {/* Spacer to balance logo */}
        </div>

        <h3 style={{ textAlign: 'center', textDecoration: 'underline', marginBottom: '30px' }}>PURCHASE REQUEST (INDENT)</h3>

        <div className="print-meta">
          <div className="print-meta-box">
            <strong>To Supplier:</strong><br />
            {selectedSupplier?.name}<br />
            UID: {selectedSupplier?.supplierNumber}<br />
            Contact: {selectedSupplier?.contactPerson} ({selectedSupplier?.phone})<br />
            GSTIN: {selectedSupplier?.gstin || 'N/A'}
          </div>
          <div className="print-meta-box">
            <strong>PR Details:</strong><br />
            PR No: <strong>PR-{Date.now().toString().slice(-6)}</strong> (Draft)<br />
            Date: {new Date().toLocaleDateString()}<br />
            Expected Delivery: {expectedDelivery ? new Date(expectedDelivery).toLocaleDateString() : 'N/A'}<br />
            Generated By: Pharmacist
          </div>
        </div>

        <table className="print-table">
          <thead>
            <tr>
              <th width="5%">S.No</th>
              <th width="40%">Item Description</th>
              <th width="10%">UoM</th>
              <th width="10%" className="num">Qty</th>
              <th width="10%" className="num">Unit Price (₹)</th>
              <th width="10%" className="num">GST (%)</th>
              <th width="15%" className="num">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={idx}>
                <td>{idx + 1}</td>
                <td>{item.genericName}</td>
                <td>{item.unitOfSale}</td>
                <td className="num">{item.qty}</td>
                <td className="num">{item.unitPrice.toFixed(2)}</td>
                <td className="num">{item.gstRate}%</td>
                <td className="num">{item.total.toFixed(2)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan="6" style={{ textAlign: 'right', fontWeight: 'bold' }}>Grand Total (Incl. Taxes):</td>
              <td className="num" style={{ fontWeight: 'bold' }}>₹{grandTotal.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        {notes && (
          <div style={{ marginBottom: '30px', fontSize: '14px' }}>
            <strong>Remarks / Special Instructions:</strong><br />
            {notes}
          </div>
        )}

        <div className="print-footer">
          <div className="sign-box">
            <div className="sign-line">Prepared By (Pharmacist)</div>
          </div>
          <div className="sign-box">
            <div className="sign-line">Checked By (Medical Supt.)</div>
          </div>
          <div className="sign-box">
            <div className="sign-line">Approved By (Materials)</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Raise indent"
          description="Create a purchase request to a supplier with the medicines and quantities you need."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/pharmacy/pos')}>
              <ArrowLeft size={16} aria-hidden="true" /> Purchase requests
            </button>
          )}
        />

        {loading ? <p className="muted">Loading…</p> : (
          <form onSubmit={handleSubmit} className="stack">
            <div className="split-2">
              {/* Supplier */}
              <section className="panel panel-pad">
                <h2 className="panel-title"><Building2 size={16} aria-hidden="true" /> Supplier</h2>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label className="form-label" htmlFor="indent-supplier">Search supplier by name or number</label>
                  <input
                    id="indent-supplier"
                    type="text"
                    className="form-input"
                    placeholder="Start typing a name or SUP-001"
                    autoComplete="off"
                    value={searchQuery}
                    onChange={handleSearchChange}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                    required
                  />

                  {/* Autocomplete Dropdown */}
                  {showSuggestions && searchQuery.length >= 2 && (
                    <div style={suggestionBox} role="listbox" aria-label="Matching suppliers">
                      {filteredSuppliers.length > 0 ? (
                        filteredSuppliers.map(sup => (
                          <button key={sup.id} type="button" role="option" aria-selected={selectedSupplier?.id === sup.id} style={suggestionItem} onClick={() => selectSupplier(sup)}>
                            <span className="cell-primary">{sup.name}</span>
                            <span className="cell-secondary mono">{sup.supplierNumber || '—'}</span>
                          </button>
                        ))
                      ) : (
                        <p className="muted" style={{ padding: 12 }}>No suppliers match.</p>
                      )}
                    </div>
                  )}
                </div>

                {selectedSupplier && (
                  <div className="alert-strip alert-info" role="status" style={{ marginTop: 12, marginBottom: 0 }}>
                    <span className="cell-stack">
                      <strong>{selectedSupplier.name}</strong>
                      <span style={{ fontSize: '0.85rem' }}>
                        <span className="mono">{selectedSupplier.supplierNumber || '—'}</span>{selectedSupplier.phone ? ` · ${selectedSupplier.phone}` : ''}
                      </span>
                    </span>
                  </div>
                )}
              </section>

              {/* Request details */}
              <section className="panel panel-pad">
                <h2 className="panel-title"><ClipboardList size={16} aria-hidden="true" /> Request details</h2>
                <div className="stack-sm">
                  <div className="form-group">
                    <label className="form-label" htmlFor="indent-delivery">Expected delivery date</label>
                    <input
                      id="indent-delivery"
                      type="date"
                      className="form-input"
                      value={expectedDelivery}
                      onChange={e => setExpectedDelivery(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="indent-notes">Remarks (optional)</label>
                    <textarea
                      id="indent-notes"
                      className="form-textarea"
                      rows={2}
                      placeholder="Delivery or packing instructions"
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                    ></textarea>
                  </div>
                </div>
              </section>
            </div>

            {/* Medicine Items Section */}
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title" style={{ margin: 0 }}><Pill size={16} aria-hidden="true" /> Medicines</h2>
                <span className="tabular" style={{ fontWeight: 650 }}>Total ₹{grandTotal.toFixed(2)}</span>
              </div>

              <div className="panel-pad stack-sm">
                {/* Add Medicine Search */}
                <div className="form-group" style={{ position: 'relative', maxWidth: 420 }}>
                  <label className="form-label" htmlFor="indent-med">Add a medicine</label>
                  <div className="search-field" style={{ minWidth: 0 }}>
                    <Search size={17} aria-hidden="true" />
                    <input
                      id="indent-med"
                      type="text"
                      placeholder="Search medicine by name"
                      autoComplete="off"
                      value={medSearchQuery}
                      onChange={e => {
                        setMedSearchQuery(e.target.value);
                        setShowMedSuggestions(true);
                      }}
                      onFocus={() => setShowMedSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowMedSuggestions(false), 200)}
                    />
                  </div>

                  {/* Medicine Autocomplete */}
                  {showMedSuggestions && medSearchQuery.length >= 2 && (
                    <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                      {medSuggestions.length > 0 ? (
                        medSuggestions.map(med => (
                          <button key={med.id} type="button" role="option" aria-selected="false" style={suggestionItem} onClick={() => addMedicine(med)}>
                            <span className="cell-stack">
                              <span className="cell-primary">{med.genericName}</span>
                              <span className="cell-secondary">{med.formulation || '—'} · GST {med.gstRate ?? 0}%</span>
                            </span>
                            <Plus size={16} aria-hidden="true" />
                          </button>
                        ))
                      ) : (
                        <p className="muted" style={{ padding: 12 }}>No medicines match.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Items Table */}
                {items.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Medicine</th>
                          <th style={{ width: 110 }}>Qty</th>
                          <th style={{ width: 140 }}>Unit price (₹)</th>
                          <th style={{ width: 100 }}>GST (%)</th>
                          <th className="text-right" style={{ width: 120 }}>Total (₹)</th>
                          <th style={{ width: 48 }}><span className="sr-only">Remove</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={item.id}>
                            <td>
                              <span className="cell-stack">
                                <span className="cell-primary">{item.genericName}</span>
                                <span className="cell-secondary">per {item.unitOfSale}</span>
                              </span>
                            </td>
                            <td>
                              <label className="sr-only" htmlFor={`indent-qty-${item.id}`}>Quantity of {item.genericName}</label>
                              <input
                                id={`indent-qty-${item.id}`}
                                type="number"
                                className="form-input"
                                min="1"
                                value={item.qty}
                                onChange={(e) => updateItem(index, 'qty', e.target.value)}
                              />
                            </td>
                            <td>
                              <label className="sr-only" htmlFor={`indent-price-${item.id}`}>Unit price of {item.genericName}</label>
                              <input
                                id={`indent-price-${item.id}`}
                                type="number"
                                className="form-input"
                                min="0"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(e) => updateItem(index, 'unitPrice', e.target.value)}
                              />
                            </td>
                            <td>
                              <label className="sr-only" htmlFor={`indent-gst-${item.id}`}>GST rate of {item.genericName}</label>
                              <input
                                id={`indent-gst-${item.id}`}
                                type="number"
                                className="form-input"
                                min="0"
                                max="100"
                                value={item.gstRate}
                                onChange={(e) => updateItem(index, 'gstRate', e.target.value)}
                              />
                            </td>
                            <td className="text-right tabular" style={{ fontWeight: 600 }}>
                              {item.total.toFixed(2)}
                            </td>
                            <td className="text-right">
                              <button type="button" className="icon-btn" aria-label={`Remove ${item.genericName}`} onClick={() => removeItem(index)}>
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted" style={{ padding: '20px 0', textAlign: 'center' }}>
                    No medicines added yet. Search above to add the first one.
                  </p>
                )}
              </div>
            </section>

            <div className="inline-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/pharmacy/pos')}>Cancel</button>
              <button type="button" className="btn btn-secondary btn-md" onClick={() => {
                if (!selectedSupplier || items.length === 0 || !expectedDelivery) {
                  toast.error('Choose a supplier, a delivery date and at least one medicine before previewing');
                  return;
                }
                setShowPreview(true);
              }}>
                <Eye size={16} aria-hidden="true" /> Preview and print
              </button>
              <button type="submit" className="btn btn-primary btn-md" disabled={!selectedSupplier || items.length === 0 || submitting}>
                <Send size={16} aria-hidden="true" /> {submitting ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}
