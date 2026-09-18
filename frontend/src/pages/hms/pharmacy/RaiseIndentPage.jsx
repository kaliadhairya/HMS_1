import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import toast from 'react-hot-toast';

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
      toast.error('Medicine already added to the list.');
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
      toast.error('Please select a Supplier.');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one medicine to the request.');
      return;
    }
    if (!expectedDelivery) {
      toast.error('Please enter Expected Delivery Date.');
      return;
    }

    try {
      await api.post('/pharmacist_lms/purchase-orders', {
        supplierId: selectedSupplier.id,
        expectedDelivery,
        notes,
        items: items,
        grandTotal
      });
      toast.success('Purchase Request created successfully!');
      navigate('/pharmacy/pos');
    } catch (err) {
      console.error(err);
      toast.error('Failed to create Purchase Request.');
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
        <div className="no-print" style={{ display: 'flex', gap: '15px', marginBottom: '30px', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={() => setShowPreview(false)}>← Back to Edit</button>
          <button className="btn btn-primary" onClick={handlePrint}>🖨️ Print PR</button>
        </div>

        {/* Formal Document */}
        <div className="print-header">
          <img src="/logo.png" alt="HMS Logo" className="print-logo" />
          <div className="print-title">
            <h1>Hospital Management System</h1>
            <h2>Healthcare Excellence Center</h2>
            <p>Main Hospital & Operations</p>
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
      <div className="container py-4">
        <div className="fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1>📄 Raise Indent (PR)</h1>
            <p style={{ color: 'var(--text-secondary)' }}>Create a detailed Purchase Request with medicine items.</p>
          </div>
          <button 
            className="btn btn-outline" 
            onClick={() => navigate('/pharmacy/pos')}
          >
            ← Back to PRs
          </button>
        </div>

        {loading ? <div className="spinner" /> : (
          <div className="card fade-up-2" style={{ padding: 32, maxWidth: 1000, margin: '0 auto' }}>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gap: 24 }}>
                
                {/* Supplier & Top-Level Details */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                  <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
                    <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>1. Supplier Details</h3>
                    
                    <div className="form-group" style={{ marginBottom: 16, position: 'relative' }}>
                      <label>Search Supplier (Name or UID) <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input 
                        type="text" 
                        className="form-control" 
                        placeholder="Start typing name or SUP-XXX..." 
                        value={searchQuery}
                        onChange={handleSearchChange}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        required
                      />
                      
                      {/* Autocomplete Dropdown */}
                      {showSuggestions && searchQuery.length >= 2 && (
                        <div style={{ 
                          position: 'absolute', top: '100%', left: 0, right: 0, 
                          background: 'var(--surface-1)', border: '1px solid var(--border)', 
                          borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 200, overflowY: 'auto',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                        }}>
                          {filteredSuppliers.length > 0 ? (
                            filteredSuppliers.map(sup => (
                              <div 
                                key={sup.id} 
                                onClick={() => selectSupplier(sup)}
                                style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                <strong>{sup.name}</strong>
                                <span style={{ color: 'var(--text-muted)' }}>{sup.supplierNumber || '-'}</span>
                              </div>
                            ))
                          ) : (
                            <div style={{ padding: 12, color: 'var(--text-muted)' }}>No matches found.</div>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedSupplier && (
                      <div style={{ padding: 12, background: 'rgba(52, 211, 153, 0.1)', border: '1px solid var(--green)', borderRadius: 8, color: 'var(--text-primary)' }}>
                        <strong>✅ Supplier Selected: </strong> {selectedSupplier.name}
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                          UID: {selectedSupplier.supplierNumber} | Ph: {selectedSupplier.phone}
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
                    <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>2. Request Details</h3>
                    <div className="form-group" style={{ marginBottom: 16 }}>
                      <label>Expected Delivery Date <span style={{ color: 'var(--red)' }}>*</span></label>
                      <input 
                        type="date" 
                        className="form-control" 
                        value={expectedDelivery}
                        onChange={e => setExpectedDelivery(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Remarks / Notes</label>
                      <textarea 
                        className="form-control" 
                        rows={2} 
                        placeholder="Instructions..."
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                      ></textarea>
                    </div>
                  </div>
                </div>

                {/* Medicine Items Section */}
                <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>3. Medicine Items</h3>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--primary)' }}>
                      Total: ₹{grandTotal.toFixed(2)}
                    </div>
                  </div>

                  {/* Add Medicine Search */}
                  <div className="form-group" style={{ marginBottom: 20, position: 'relative', maxWidth: 400 }}>
                    <label>Add Medicine</label>
                    <input 
                      type="text" 
                      className="form-control" 
                      placeholder="Search medicine by name..." 
                      value={medSearchQuery}
                      onChange={e => {
                        setMedSearchQuery(e.target.value);
                        setShowMedSuggestions(true);
                      }}
                      onFocus={() => setShowMedSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowMedSuggestions(false), 200)}
                    />
                    
                    {/* Medicine Autocomplete */}
                    {showMedSuggestions && medSearchQuery.length >= 2 && (
                      <div style={{ 
                        position: 'absolute', top: '100%', left: 0, right: 0, 
                        background: 'var(--surface-1)', border: '1px solid var(--border)', 
                        borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 250, overflowY: 'auto',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                      }}>
                        {medSuggestions.length > 0 ? (
                          medSuggestions.map(med => (
                            <div 
                              key={med.id} 
                              onClick={() => addMedicine(med)}
                              style={{ padding: '10px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              <div>
                                <strong style={{ display: 'block' }}>{med.genericName}</strong>
                                <small style={{ color: 'var(--text-muted)' }}>{med.formulation} | GST: {med.gstRate}%</small>
                              </div>
                              <span style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>+</span>
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: 12, color: 'var(--text-muted)' }}>No medicines found.</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Items Table */}
                  {items.length > 0 ? (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th>Medicine Name</th>
                            <th width="10%">Qty</th>
                            <th width="15%">Unit Price (₹)</th>
                            <th width="10%">GST (%)</th>
                            <th width="15%">Total (₹)</th>
                            <th width="8%">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, index) => (
                            <tr key={index}>
                              <td style={{ fontWeight: 500 }}>{item.genericName}</td>
                              <td>
                                <input 
                                  type="number" 
                                  className="form-control" 
                                  min="1" 
                                  value={item.qty} 
                                  onChange={(e) => updateItem(index, 'qty', e.target.value)} 
                                  style={{ padding: '6px' }}
                                />
                              </td>
                              <td>
                                <input 
                                  type="number" 
                                  className="form-control" 
                                  min="0" 
                                  step="0.01"
                                  value={item.unitPrice} 
                                  onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} 
                                  style={{ padding: '6px' }}
                                />
                              </td>
                              <td>
                                <input 
                                  type="number" 
                                  className="form-control" 
                                  min="0" 
                                  max="100"
                                  value={item.gstRate} 
                                  onChange={(e) => updateItem(index, 'gstRate', e.target.value)} 
                                  style={{ padding: '6px' }}
                                />
                              </td>
                              <td style={{ fontWeight: 'bold' }}>
                                {item.total.toFixed(2)}
                              </td>
                              <td>
                                <button type="button" className="btn btn-sm" style={{ background: 'var(--red)', color: 'white', padding: '6px 12px' }} onClick={() => removeItem(index)}>
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ padding: '30px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 8, color: 'var(--text-muted)' }}>
                      No medicines added yet. Use the search bar above to add items.
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                  <button type="button" className="btn btn-outline" onClick={() => navigate('/pharmacy/pos')}>Cancel</button>
                  <button type="button" className="btn btn-secondary" onClick={() => {
                    if (!selectedSupplier || items.length === 0 || !expectedDelivery) {
                      toast.error('Please fill required details (Supplier, Date, Items) before previewing.');
                      return;
                    }
                    setShowPreview(true);
                  }}>
                    👁️ Preview & Print
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={!selectedSupplier || items.length === 0}>
                    Submit Purchase Request
                  </button>
                </div>

              </div>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
