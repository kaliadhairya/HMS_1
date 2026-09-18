import React, { useState, useEffect } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

const EMPTY_STOCK_FORM = {
  medicineId: '', supplierId: '', batchNumber: '', expiryDate: '',
  quantity: '', purchaseRate: '', mrp: '', gstRate: '0', invoiceNumber: '',
  newMedName: '', newMedFormulation: 'Tablet', newMedStrength: '', newMedStrengthUnit: 'mg',
  newSupName: '',
};

export default function PharmacyStockPage() {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  
  // Ledger
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerData, setLedgerData] = useState([]);
  const [ledgerMedName, setLedgerMedName] = useState('');

  // Issued Meds
  const [issuedOpen, setIssuedOpen] = useState(false);
  const [issuedData, setIssuedData] = useState([]);
  const [issuedMedName, setIssuedMedName] = useState('');

  // Expanded batch details
  const [expandedMedId, setExpandedMedId] = useState(null);
  const [batchDetails, setBatchDetails] = useState([]);
  const [batchLoading, setBatchLoading] = useState(false);

  // Add Stock Modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_STOCK_FORM });
  const [medicines, setMedicines] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [medSearch, setMedSearch] = useState('');
  const [supSearch, setSupSearch] = useState('');
  const [medFocused, setMedFocused] = useState(false);
  const [supFocused, setSupFocused] = useState(false);

  // Edit Batch Modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({ quantity: '', mrp: '', purchaseRate: '' });
  const [editBatch, setEditBatch] = useState(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  useEffect(() => { fetchStock(); }, []);

  const fetchStock = async () => {
    try {
      setLoading(true);
      const res = await api.get('/pharmacy/stock');
      setStock(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load stock inventory.');
    } finally {
      setLoading(false);
    }
  };

  const fetchDropdowns = async () => {
    try {
      const [medRes, supRes] = await Promise.all([
        api.get('/medicines?search=').catch(() => ({ data: { data: [] } })),
        api.get('/suppliers').catch(() => ({ data: { data: [] } })),
      ]);
      setMedicines(medRes.data.data || []);
      setSuppliers(supRes.data.data || []);
    } catch (err) { console.error(err); }
  };

  // ─── EXPAND / COLLAPSE BATCHES ──────────────────────────────
  const getItemKey = (item) => `${item.GENERIC_NAME}|${item.FORMULATION || ''}|${item.STRENGTH || ''}|${item.STRENGTH_UNIT || ''}`;

  const toggleBatches = async (item) => {
    const key = getItemKey(item);
    if (expandedMedId === key) {
      setExpandedMedId(null);
      setBatchDetails([]);
      return;
    }
    setExpandedMedId(key);
    setBatchLoading(true);
    try {
      const params = new URLSearchParams({ name: item.GENERIC_NAME });
      if (item.FORMULATION) params.append('formulation', item.FORMULATION);
      if (item.STRENGTH) params.append('strength', item.STRENGTH);
      const res = await api.get(`/pharmacy/stock/batches-by-name?${params.toString()}`);
      setBatchDetails(res.data.data || []);
    } catch (err) {
      toast.error('Failed to load batch details.');
      setBatchDetails([]);
    } finally {
      setBatchLoading(false);
    }
  };

  // ─── ADD STOCK ──────────────────────────────────────────────
  const openAddModal = () => {
    setAddForm({ ...EMPTY_STOCK_FORM });
    setMedSearch('');
    setSupSearch('');
    fetchDropdowns();
    setAddModalOpen(true);
  };

  const filteredMedicines = medicines.filter(m =>
    m.genericName.toLowerCase().includes(medSearch.toLowerCase())
  );
  const isNewMedicine = medSearch.trim().length > 0 && !addForm.medicineId;

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supSearch.toLowerCase())
  );
  const isNewSupplier = supSearch.trim().length > 0 && !addForm.supplierId;

  const selectMedicine = (med) => {
    setAddForm({ ...addForm, medicineId: med.id, newMedName: '' });
    setMedSearch(`${med.genericName} (${med.formulation} ${med.strength || ''}${med.strengthUnit || ''})`);
    setMedFocused(false);
  };

  const selectSupplier = (sup) => {
    setAddForm({ ...addForm, supplierId: sup.id, newSupName: '' });
    setSupSearch(sup.name);
    setSupFocused(false);
  };

  const handleAddSubmit = async (e) => {
    e.preventDefault();
    if ((!addForm.medicineId && !medSearch.trim()) || !addForm.batchNumber || !addForm.expiryDate || !addForm.quantity) {
      toast.error('Please fill all required fields.');
      return;
    }
    setAddSubmitting(true);
    try {
      let finalMedicineId = addForm.medicineId;
      let finalSupplierId = addForm.supplierId;

      if (!finalMedicineId && medSearch.trim()) {
        const medRes = await api.post('/medicines', {
          genericName: medSearch.trim(), brandNames: [], category: 'Other',
          formulation: addForm.newMedFormulation || 'Tablet',
          strength: addForm.newMedStrength || '', strengthUnit: addForm.newMedStrengthUnit || 'mg',
          unitOfSale: 'Strip', hsnCode: '', gstRate: parseFloat(addForm.gstRate) || 0,
          isControlled: false, initialQuantity: 0, perUnitPrice: parseFloat(addForm.mrp) || 0,
        });
        finalMedicineId = medRes.data.data?.id;
        if (!finalMedicineId) throw new Error('Failed to create medicine.');
        toast.success(`New medicine "${medSearch.trim()}" created!`);
      }

      if (!finalSupplierId && supSearch.trim()) {
        const supRes = await api.post('/suppliers', { name: supSearch.trim() });
        finalSupplierId = supRes.data.data?.id;
        if (finalSupplierId) toast.success(`New supplier "${supSearch.trim()}" created!`);
      }

      await api.post('/pharmacy/grn', {
        supplierId: finalSupplierId || null,
        invoiceNumber: addForm.invoiceNumber || null,
        invoiceDate: new Date().toISOString().slice(0, 10),
        items: [{
          medicineId: parseInt(finalMedicineId),
          batchNumber: addForm.batchNumber, expiryDate: addForm.expiryDate,
          quantity: parseInt(addForm.quantity),
          purchaseRate: parseFloat(addForm.purchaseRate) || 0,
          mrp: parseFloat(addForm.mrp) || 0, gstRate: parseFloat(addForm.gstRate) || 0,
        }],
      });
      toast.success('Stock added successfully!');
      setAddModalOpen(false);
      fetchStock();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to add stock.');
    } finally { setAddSubmitting(false); }
  };

  // ─── EDIT BATCH ─────────────────────────────────────────────
  const openEditBatch = (batch, medName) => {
    setEditBatch({ ...batch, GENERIC_NAME: medName });
    setEditForm({
      quantity: String(batch.QUANTITY || 0),
      mrp: String(batch.MRP || 0),
      purchaseRate: String(batch.PURCHASE_RATE || 0),
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editBatch) return;
    setEditSubmitting(true);
    try {
      const oldQty = editBatch.QUANTITY || 0;
      const newQty = parseInt(editForm.quantity) || 0;
      const diff = newQty - oldQty;

      if (diff > 0) {
        await api.post('/pharmacy/return', {
          batchId: editBatch.BATCH_ID, quantity: diff, type: 'return', reason: 'Stock adjustment',
        });
      } else if (diff < 0) {
        await api.post('/pharmacy/return', {
          batchId: editBatch.BATCH_ID, quantity: Math.abs(diff), type: 'discard', reason: 'Stock adjustment',
        });
      }

      toast.success('Batch updated successfully!');
      setEditModalOpen(false);
      // Refresh both stock and expanded batches
      fetchStock();
      if (expandedMedId) toggleBatches(expandedMedId);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Failed to update batch.');
    } finally { setEditSubmitting(false); }
  };

  // ─── LEDGER ─────────────────────────────────────────────────
  const openLedger = async (e, medicineId, medicineName) => {
    e.stopPropagation();
    try {
      const res = await api.get(`/pharmacy/stock-ledger/${medicineId}`);
      setLedgerData(res.data.data || []);
      setLedgerMedName(medicineName);
      setLedgerOpen(true);
    } catch (err) { toast.error('Failed to fetch stock ledger.'); }
  };

  // ─── ISSUED MEDS ────────────────────────────────────────────
  const openIssuedMeds = async (e, item) => {
    e.stopPropagation();
    try {
      const params = new URLSearchParams({ name: item.GENERIC_NAME });
      if (item.FORMULATION) params.append('formulation', item.FORMULATION);
      if (item.STRENGTH) params.append('strength', item.STRENGTH);
      const res = await api.get(`/pharmacy/issued-meds?${params.toString()}`);
      setIssuedData(res.data.data || []);
      setIssuedMedName(item.GENERIC_NAME);
      setIssuedOpen(true);
    } catch (err) { toast.error('Failed to fetch issued medicines.'); }
  };

  // ─── HELPERS ────────────────────────────────────────────────
  const isExpiringSoon = (dateString) => {
    if (!dateString) return false;
    const diff = new Date(dateString) - new Date();
    return diff <= 30 * 24 * 60 * 60 * 1000 && diff > 0;
  };

  const isExpired = (dateString) => {
    if (!dateString) return false;
    return new Date(dateString) <= new Date();
  };

  const filteredStock = stock.filter(item => {
    const name = (item.GENERIC_NAME || '').toLowerCase();
    if (!name.includes(search.toLowerCase())) return false;
    if (filter === 'Expired/Critical') return isExpired(item.NEAREST_EXPIRY);
    if (filter === 'Expiring 30 Days') return isExpiringSoon(item.NEAREST_EXPIRY) || isExpired(item.NEAREST_EXPIRY);
    if (filter === 'Out of Stock') return item.TOTAL_QUANTITY === 0;
    return true;
  });

  const totalItems = filteredStock.length;
  const outOfStockCount = stock.filter(s => s.TOTAL_QUANTITY === 0).length;
  const lowStockCount = stock.filter(s => s.TOTAL_QUANTITY > 0 && s.TOTAL_QUANTITY <= 10).length;

  return (
    <>
    <Navbar />
    <div className="container py-4" style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="hms-page-header hms-anim-1" style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>
            <span className="header-icon" style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)' }}>📦</span>
            Pharmacy Stock & Inventory
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
            Consolidated view — one row per medicine. Click to expand batch details.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} className="form-input"
            style={{ width: 200, borderRadius: 12, fontWeight: 600, fontSize: '0.88rem', padding: '10px 16px', border: '2px solid var(--border)' }}>
            <option>All</option>
            <option>Expired/Critical</option>
            <option>Expiring 30 Days</option>
            <option>Out of Stock</option>
          </select>
          <button className="btn" onClick={fetchStock}
            style={{ fontWeight: 700, padding: '10px 20px', borderRadius: 12, background: 'var(--surface-2)', border: '2px solid var(--border)', color: 'var(--text-primary)' }}>
            ↻ Refresh
          </button>
          <button className="btn btn-primary" onClick={openAddModal}
            style={{ fontWeight: 700, padding: '12px 28px', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 10,
              background: 'linear-gradient(135deg, #059669, #10b981)', border: 'none', boxShadow: '0 4px 14px rgba(5,150,105,0.3)' }}>
            <span style={{ fontSize: '1.1rem' }}>+</span> Add Stock
          </button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="hms-anim-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Medicines', value: totalItems, icon: '📊', color: 'var(--green)', bg: 'rgba(16,185,129,0.1)' },
          { label: 'Out of Stock', value: outOfStockCount, icon: '🚫', color: outOfStockCount > 0 ? '#ef4444' : 'var(--text-primary)', bg: 'rgba(239,68,68,0.1)', border: 'var(--red)' },
          { label: 'Low Stock (≤10)', value: lowStockCount, icon: '⚠️', color: lowStockCount > 0 ? '#d97706' : 'var(--text-primary)', bg: 'rgba(245,158,11,0.1)', border: 'var(--amber)' },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14, borderLeft: `4px solid ${s.border || s.color}` }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="hms-anim-1" style={{ marginBottom: 24 }}>
        <div className="card" style={{ padding: '12px 24px', borderRadius: 40, boxShadow: 'var(--shadow-md)', border: '2.5px solid var(--border)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 16, transition: 'all 0.3s ease' }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--green)'}
          onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}>
          <span style={{ fontSize: '1.4rem', opacity: 0.6 }}>🔍</span>
          <input type="text" className="form-input"
            style={{ fontSize: '1.1rem', border: 'none', boxShadow: 'none', background: 'transparent', padding: '4px 0', flex: 1 }}
            placeholder="Search by medicine name..." value={search} onChange={e => setSearch(e.target.value)} />
          {loading && <div className="spinner" style={{ width: 20, height: 20 }} />}
        </div>
      </div>

      {/* ─── MAIN TABLE (Consolidated) ────────────────────────── */}
      <div className="card hms-anim-2" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)', borderRadius: 16 }}>
        <div className="table-wrapper" style={{ border: 'none' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th style={{ ...thS, paddingLeft: 24, width: 30 }}></th>
                <th style={thS}>MEDICINE NAME</th>
                <th style={thS}>FORM / STRENGTH</th>
                <th style={{ ...thS, textAlign: 'center' }}>BATCHES</th>
                <th style={{ ...thS, textAlign: 'center' }}>STOCK STATUS</th>
                <th style={thS}>NEAREST EXPIRY</th>
                <th style={{ ...thS, textAlign: 'right' }}>MRP (₹)</th>
                <th style={{ ...thS, textAlign: 'center', paddingRight: 24 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredStock.length === 0 && !loading ? (
                <tr>
                  <td colSpan="8" style={{ padding: 80, textAlign: 'center' }}>
                    <div style={{ fontSize: '3.5rem', marginBottom: 16, opacity: 0.2 }}>📦</div>
                    <h3 style={{ color: 'var(--text-secondary)' }}>No medicines found</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Try adjusting your search or filter.</p>
                  </td>
                </tr>
              ) : (
                filteredStock.map((item, i) => {
                  const outOfStock = item.TOTAL_QUANTITY === 0;
                  const expired = isExpired(item.NEAREST_EXPIRY);
                  const expiring = isExpiringSoon(item.NEAREST_EXPIRY);
                  const itemKey = getItemKey(item);
                  const isExpanded = expandedMedId === itemKey;
                  
                  let rowBg = i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)';
                  if (outOfStock) rowBg = 'rgba(156,163,175,0.08)';
                  else if (expired) rowBg = 'rgba(239,68,68,0.06)';
                  else if (expiring) rowBg = 'rgba(245,158,11,0.06)';

                  return (
                    <React.Fragment key={itemKey}>
                      {/* Medicine Row */}
                      <tr
                        onClick={() => toggleBatches(item)}
                        style={{
                          background: rowBg, borderBottom: isExpanded ? 'none' : '1px solid var(--border)',
                          cursor: 'pointer', transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { if (!outOfStock && !expired && !expiring) e.currentTarget.style.background = 'var(--surface-2)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
                      >
                        <td style={{ ...tdS, paddingLeft: 24, width: 30 }}>
                          <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', fontSize: '0.8rem', opacity: 0.5 }}>▶</span>
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{item.GENERIC_NAME}</div>
                        </td>
                        <td style={tdS}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{item.FORMULATION || '—'}</div>
                          {(item.STRENGTH || item.STRENGTH_UNIT) && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{item.STRENGTH} {item.STRENGTH_UNIT}</div>
                          )}
                        </td>
                        <td style={{ ...tdS, textAlign: 'center' }}>
                          <span style={{
                            display: 'inline-block', padding: '4px 12px', borderRadius: 20,
                            background: 'rgba(99,102,241,0.08)', color: '#6366f1', fontWeight: 800, fontSize: '0.9rem',
                            border: '1px solid rgba(99,102,241,0.15)',
                          }}>
                            {item.BATCH_COUNT || 0}
                          </span>
                        </td>
                        <td style={{ ...tdS, textAlign: 'center' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, minWidth: 130 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Total</span>
                              <span style={{
                                fontWeight: 900, fontSize: '1.05rem',
                                color: outOfStock ? '#ef4444' : item.TOTAL_QUANTITY <= 10 ? '#d97706' : '#10b981',
                              }}>{item.TOTAL_QUANTITY || 0}</span>
                            </div>
                            {(item.TOTAL_ISSUED > 0) && (
                              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#ef4444' }}>↓ {item.TOTAL_ISSUED} issued</span>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#2563eb' }}>= {(item.TOTAL_QUANTITY || 0)} rem.</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td style={tdS}>
                          {item.NEAREST_EXPIRY ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{new Date(item.NEAREST_EXPIRY).toLocaleDateString('en-IN')}</span>
                              {expired && <span className="badge badge-red" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>EXPIRED</span>}
                              {expiring && !expired && <span className="badge badge-amber" style={{ fontSize: '0.6rem', padding: '2px 6px' }}>EXPIRING</span>}
                            </div>
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right' }}>
                          <span style={{ fontWeight: 800, fontSize: '1rem' }}>₹{(item.MRP || 0).toFixed(2)}</span>
                        </td>
                        <td style={{ ...tdS, textAlign: 'center', paddingRight: 24 }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-sm" onClick={(e) => openLedger(e, item.ID, item.GENERIC_NAME)}
                              style={{ borderRadius: 10, padding: '6px 14px', fontWeight: 700, background: 'rgba(37,99,235,0.08)', color: '#2563eb', border: '1px solid rgba(37,99,235,0.15)' }}>
                              📋 Ledger
                            </button>
                            <button className="btn btn-sm" onClick={(e) => openIssuedMeds(e, item)}
                              style={{ borderRadius: 10, padding: '6px 14px', fontWeight: 700, background: 'rgba(239,68,68,0.06)', color: '#dc2626', border: '1px solid rgba(239,68,68,0.15)' }}>
                              💊 Issued
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Batch Details */}
                      {isExpanded && (
                        <tr>
                          <td colSpan="8" style={{ padding: 0, background: 'var(--surface-2)' }}>
                            <div style={{ margin: '0 24px 16px 56px', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                              <div style={{ padding: '12px 20px', background: 'linear-gradient(135deg, rgba(99,102,241,0.05), rgba(99,102,241,0.02))', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem' }}>📦</span>
                                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                                    Stock Entries — {item.GENERIC_NAME}
                                  </span>
                                </div>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                  {batchLoading ? 'Loading...' : `${batchDetails.length} batch${batchDetails.length !== 1 ? 'es' : ''}`}
                                </span>
                              </div>
                              {batchLoading ? (
                                <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>
                              ) : batchDetails.length === 0 ? (
                                <div style={{ padding: '40px 30px', textAlign: 'center' }}>
                                  <div style={{ fontSize: '2.2rem', marginBottom: 10, opacity: 0.25 }}>📋</div>
                                  <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>No stock entries yet</div>
                                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16, maxWidth: 320, margin: '0 auto 16px' }}>
                                    This medicine has no batch/stock data. Add stock using the button below.
                                  </div>
                                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); openAddModal(); }}
                                    style={{ fontWeight: 700, borderRadius: 10, padding: '8px 20px', background: 'linear-gradient(135deg, #059669, #10b981)', color: '#fff', border: 'none', fontSize: '0.85rem' }}>
                                    + Add Stock for {item.GENERIC_NAME}
                                  </button>
                                </div>
                              ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--surface-2)' }}>
                                      <th style={bthS}>BATCH NO</th>
                                      <th style={bthS}>EXPIRY DATE</th>
                                      <th style={{ ...bthS, textAlign: 'right' }}>QTY</th>
                                      <th style={bthS}>SUPPLIER</th>
                                      <th style={{ ...bthS, textAlign: 'right' }}>MRP (₹)</th>
                                      <th style={{ ...bthS, textAlign: 'center' }}>LEDGER</th>
                                      <th style={{ ...bthS, textAlign: 'right' }}>ACTIONS</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batchDetails.map((b, bi) => (
                                      <tr key={b.BATCH_ID} style={{ borderBottom: '1px solid var(--border)', background: bi % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)' }}>
                                        <td style={btdS}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <code style={{ background: 'var(--surface-3)', padding: '3px 10px', borderRadius: 6, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                                              {b.BATCH_NUMBER}
                                            </code>
                                            {b.ADDED_ON && (
                                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                                Added {new Date(b.ADDED_ON).toLocaleDateString('en-IN')}
                                              </span>
                                            )}
                                          </div>
                                        </td>
                                        <td style={btdS}>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <span style={{ fontWeight: 600 }}>{new Date(b.EXPIRY_DATE).toLocaleDateString('en-IN')}</span>
                                            {isExpired(b.EXPIRY_DATE) && <span className="badge badge-red" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>EXP</span>}
                                            {isExpiringSoon(b.EXPIRY_DATE) && !isExpired(b.EXPIRY_DATE) && <span className="badge badge-amber" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>SOON</span>}
                                          </div>
                                        </td>
                                        <td style={{ ...btdS, textAlign: 'right' }}>
                                          <span style={{
                                            fontWeight: 800, fontSize: '0.95rem',
                                            color: b.QUANTITY === 0 ? '#ef4444' : b.QUANTITY <= 10 ? '#d97706' : '#10b981',
                                          }}>{b.QUANTITY}</span>
                                        </td>
                                        <td style={btdS}><span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{b.SUPPLIER_NAME || '—'}</span></td>
                                        <td style={{ ...btdS, textAlign: 'right', fontWeight: 700 }}>₹{(b.MRP || 0).toFixed(2)}</td>
                                        <td style={{ ...btdS, textAlign: 'center' }}>
                                          <button className="btn btn-sm" onClick={(e) => openLedger(e, b.MEDICINE_ID, item.GENERIC_NAME)}
                                            style={{ borderRadius: 8, padding: '4px 10px', fontWeight: 600, background: 'rgba(37,99,235,0.08)', color: '#2563eb', border: '1px solid rgba(37,99,235,0.15)', fontSize: '0.75rem' }}>
                                            📋
                                          </button>
                                        </td>
                                        <td style={{ ...btdS, textAlign: 'right' }}>
                                          <button className="btn btn-sm" onClick={() => openEditBatch(b, item.GENERIC_NAME)}
                                            style={{ fontWeight: 700, borderRadius: 8, padding: '4px 12px', background: 'rgba(99,102,241,0.08)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.15)', fontSize: '0.78rem' }}>
                                            ✏️ Edit
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── ADD STOCK MODAL ─────────────────────────────────── */}
      {addModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, animation: 'fadeIn 0.2s ease-out', padding: 24 }}
          onClick={() => setAddModalOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 25px 60px rgba(0,0,0,0.35)', border: '1px solid var(--border)', animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
            {/* Header */}
            <div style={{ padding: 0, flexShrink: 0, position: 'relative', overflow: 'hidden', background: 'linear-gradient(135deg, #064e3b 0%, #059669 40%, #34d399 100%)' }}>
              <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
              <div style={{ position: 'absolute', bottom: -20, right: 60, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
              <div style={{ position: 'relative', padding: '24px 28px', display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.6rem' }}>📦</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: '#fff' }}>Add New Stock</h3>
                  <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>Receive stock into inventory — new or existing medicines</p>
                </div>
                <button type="button" onClick={() => setAddModalOpen(false)}
                  style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', width: 38, height: 38, borderRadius: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>✕</button>
              </div>
            </div>

            <form onSubmit={handleAddSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 16px' }}>
                {/* Medicine & Supplier */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(16,185,129,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>💊</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#059669' }}>Medicine & Supplier</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    {/* Medicine Typeahead */}
                    <div style={{ position: 'relative' }}>
                      <label style={labelS}>Medicine <span style={{ color: '#ef4444' }}>*</span></label>
                      <div style={{ position: 'relative' }}>
                        <input type="text" className="form-input" value={medSearch}
                          onFocus={() => setMedFocused(true)} onBlur={() => setTimeout(() => setMedFocused(false), 200)}
                          onChange={e => { setMedSearch(e.target.value); setAddForm({ ...addForm, medicineId: '', newMedName: e.target.value }); }}
                          placeholder="Type medicine name..." style={{ paddingLeft: 36 }} />
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.95rem', pointerEvents: 'none', opacity: 0.5 }}>🔍</span>
                      </div>
                      {addForm.medicineId && <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>✅ Existing medicine selected</div>}
                      {isNewMedicine && <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#d97706', fontWeight: 600 }}>🆕 New medicine — will be created automatically</div>}
                      {medFocused && medSearch.trim().length >= 1 && filteredMedicines.length > 0 && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: 'var(--surface)', border: '2px solid #059669', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.2)', maxHeight: 220, overflowY: 'auto' }}>
                          {filteredMedicines.slice(0, 10).map(m => (
                            <button key={m.id} type="button" onClick={() => selectMedicine(m)}
                              style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{m.genericName}</div>
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>{m.formulation} · {m.strength}{m.strengthUnit} · Stock: {m.totalStock || 0}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Supplier Typeahead */}
                    <div style={{ position: 'relative' }}>
                      <label style={labelS}>Supplier</label>
                      <div style={{ position: 'relative' }}>
                        <input type="text" className="form-input" value={supSearch}
                          onFocus={() => setSupFocused(true)} onBlur={() => setTimeout(() => setSupFocused(false), 200)}
                          onChange={e => { setSupSearch(e.target.value); setAddForm({ ...addForm, supplierId: '', newSupName: e.target.value }); }}
                          placeholder="Type supplier name..." style={{ paddingLeft: 36 }} />
                        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.95rem', pointerEvents: 'none', opacity: 0.5 }}>🏢</span>
                      </div>
                      {addForm.supplierId && <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>✅ Existing supplier selected</div>}
                      {isNewSupplier && <div style={{ marginTop: 4, fontSize: '0.72rem', color: '#d97706', fontWeight: 600 }}>🆕 New supplier — will be created automatically</div>}
                      {supFocused && supSearch.trim().length >= 1 && filteredSuppliers.length > 0 && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: 'var(--surface)', border: '2px solid #059669', borderRadius: 12, boxShadow: '0 12px 36px rgba(0,0,0,0.2)', maxHeight: 220, overflowY: 'auto' }}>
                          {filteredSuppliers.slice(0, 10).map(s => (
                            <button key={s.id} type="button" onClick={() => selectSupplier(s)}
                              style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-2)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{s.name}</div>
                              {s.contactPerson && <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>{s.contactPerson}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  {isNewMedicine && (
                    <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: 'rgba(245,158,11,0.04)', border: '1px dashed rgba(245,158,11,0.3)' }}>
                      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d97706', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Medicine Details</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={{ ...labelS, fontSize: '0.78rem' }}>Formulation</label>
                          <select className="form-input" value={addForm.newMedFormulation} onChange={e => setAddForm({ ...addForm, newMedFormulation: e.target.value })}>
                            {['Tablet', 'Capsule', 'Injection', 'Syrup', 'Ointment', 'Drops', 'Other'].map(f => <option key={f} value={f}>{f}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={{ ...labelS, fontSize: '0.78rem' }}>Strength</label>
                          <input className="form-input" type="text" value={addForm.newMedStrength} onChange={e => setAddForm({ ...addForm, newMedStrength: e.target.value })} placeholder="e.g. 500" />
                        </div>
                        <div>
                          <label style={{ ...labelS, fontSize: '0.78rem' }}>Unit</label>
                          <select className="form-input" value={addForm.newMedStrengthUnit} onChange={e => setAddForm({ ...addForm, newMedStrengthUnit: e.target.value })}>
                            {['mg', 'ml', 'g', 'mcg', 'IU', '%'].map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {/* Batch Details */}
                <div style={{ marginBottom: 22 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(99,102,241,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>📋</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6366f1' }}>Batch Details</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={labelS}>Batch Number <span style={{ color: '#ef4444' }}>*</span></label>
                      <input required className="form-input" type="text" value={addForm.batchNumber} onChange={e => setAddForm({ ...addForm, batchNumber: e.target.value })} placeholder="e.g. BN-2024-001" />
                    </div>
                    <div>
                      <label style={labelS}>Expiry Date <span style={{ color: '#ef4444' }}>*</span></label>
                      <input required className="form-input" type="date" value={addForm.expiryDate} onChange={e => setAddForm({ ...addForm, expiryDate: e.target.value })} />
                    </div>
                    <div>
                      <label style={labelS}>Invoice Number</label>
                      <input className="form-input" type="text" value={addForm.invoiceNumber} onChange={e => setAddForm({ ...addForm, invoiceNumber: e.target.value })} placeholder="e.g. INV-1234" />
                    </div>
                  </div>
                </div>
                {/* Quantity & Pricing */}
                <div style={{ marginBottom: 8, padding: 16, borderRadius: 12, background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(245,158,11,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>💰</span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d97706' }}>Quantity & Pricing</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                    <div>
                      <label style={labelS}>Quantity <span style={{ color: '#ef4444' }}>*</span></label>
                      <input required className="form-input" type="number" min="1" value={addForm.quantity} onChange={e => setAddForm({ ...addForm, quantity: e.target.value })} placeholder="e.g. 100" />
                    </div>
                    <div>
                      <label style={labelS}>Purchase Rate (₹)</label>
                      <input className="form-input" type="number" step="0.01" min="0" value={addForm.purchaseRate} onChange={e => setAddForm({ ...addForm, purchaseRate: e.target.value })} placeholder="e.g. 5.50" />
                    </div>
                    <div>
                      <label style={labelS}>MRP (₹)</label>
                      <input className="form-input" type="number" step="0.01" min="0" value={addForm.mrp} onChange={e => setAddForm({ ...addForm, mrp: e.target.value })} placeholder="e.g. 10.00" />
                    </div>
                    <div>
                      <label style={labelS}>GST Rate (%)</label>
                      <input className="form-input" type="number" step="0.01" min="0" value={addForm.gstRate} onChange={e => setAddForm({ ...addForm, gstRate: e.target.value })} placeholder="e.g. 12" />
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
                <button type="button" onClick={() => setAddModalOpen(false)} className="btn btn-ghost" style={{ minWidth: 100, fontWeight: 600, borderRadius: 10 }}>Cancel</button>
                <button type="submit" disabled={addSubmitting} className="btn btn-primary" style={{ minWidth: 180, background: 'linear-gradient(135deg, #059669, #10b981)', border: 'none', fontWeight: 700, borderRadius: 10, opacity: addSubmitting ? 0.7 : 1 }}>
                  {addSubmitting ? '⏳ Processing...' : '📦 Add to Inventory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── EDIT BATCH MODAL ────────────────────────────────── */}
      {editModalOpen && editBatch && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, animation: 'fadeIn 0.2s ease-out', padding: 24 }}
          onClick={() => setEditModalOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', borderRadius: 20, overflow: 'hidden', background: 'var(--surface)', boxShadow: '0 25px 60px rgba(0,0,0,0.35)', border: '1px solid var(--border)', animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 14, background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', color: '#fff', flexShrink: 0 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem' }}>✏️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Edit Batch</h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.8rem', opacity: 0.85 }}>{editBatch.GENERIC_NAME} — Batch: {editBatch.BATCH_NUMBER}</p>
              </div>
              <button type="button" onClick={() => setEditModalOpen(false)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 34, height: 34, borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 16px' }}>
                {/* Info Card */}
                <div style={{ marginBottom: 20, padding: 16, borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Medicine</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{editBatch.GENERIC_NAME}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Batch</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{editBatch.BATCH_NUMBER}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Expiry</div>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{new Date(editBatch.EXPIRY_DATE).toLocaleDateString('en-IN')}</div>
                  </div>
                </div>
                {/* Editable Fields */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={labelS}>Quantity <span style={{ color: '#ef4444' }}>*</span></label>
                    <input required className="form-input" type="number" min="0" value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} />
                    <div style={{ marginTop: 4, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      Current: {editBatch.QUANTITY || 0}
                      {parseInt(editForm.quantity) !== (editBatch.QUANTITY || 0) && (
                        <span style={{ color: parseInt(editForm.quantity) > (editBatch.QUANTITY || 0) ? '#10b981' : '#ef4444', fontWeight: 700, marginLeft: 6 }}>
                          ({parseInt(editForm.quantity) > (editBatch.QUANTITY || 0) ? '+' : ''}{parseInt(editForm.quantity) - (editBatch.QUANTITY || 0)})
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <label style={labelS}>MRP (₹)</label>
                    <input className="form-input" type="number" step="0.01" min="0" value={editForm.mrp} onChange={e => setEditForm({ ...editForm, mrp: e.target.value })} />
                  </div>
                  <div>
                    <label style={labelS}>Purchase Rate (₹)</label>
                    <input className="form-input" type="number" step="0.01" min="0" value={editForm.purchaseRate} onChange={e => setEditForm({ ...editForm, purchaseRate: e.target.value })} />
                  </div>
                </div>
              </div>
              <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
                <button type="button" onClick={() => setEditModalOpen(false)} className="btn btn-ghost" style={{ minWidth: 100, fontWeight: 600, borderRadius: 10 }}>Cancel</button>
                <button type="submit" disabled={editSubmitting} className="btn btn-primary" style={{ minWidth: 160, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', fontWeight: 700, borderRadius: 10, opacity: editSubmitting ? 0.7 : 1 }}>
                  {editSubmitting ? '⏳ Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── LEDGER DRAWER ───────────────────────────────────── */}
      {ledgerOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'flex-end', animation: 'fadeIn 0.2s ease-out' }}
          onClick={() => setLedgerOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 680, maxWidth: '100%', height: '100%', background: 'var(--surface)', boxShadow: '-8px 0 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.2)' }}>📋</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Stock Ledger</h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--blue)', fontWeight: 600, marginTop: 2 }}>{ledgerMedName}</div>
                </div>
              </div>
              <button onClick={() => setLedgerOpen(false)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 36, height: 36, borderRadius: 10, fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
              <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                <table style={{ width: '100%', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={thS}>DATE</th>
                      <th style={thS}>TYPE</th>
                      <th style={{ ...thS, textAlign: 'right' }}>QTY</th>
                      <th style={thS}>BATCH</th>
                      <th style={thS}>REFERENCE</th>
                      <th style={thS}>USER</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerData.map((entry, i) => (
                      <tr key={entry.ID} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)' }}>
                        <td style={tdS}>{new Date(entry.TRANSACTION_DATE).toLocaleString('en-IN')}</td>
                        <td style={tdS}>
                          <span className={`badge ${entry.TRANSACTION_TYPE === 'IN' || entry.TRANSACTION_TYPE === 'RETURN' ? 'badge-green' : 'badge-red'}`}>
                            {entry.TRANSACTION_TYPE}
                          </span>
                        </td>
                        <td style={{ ...tdS, textAlign: 'right', fontWeight: 700 }}>{entry.QUANTITY}</td>
                        <td style={tdS}><code style={{ background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 4, fontSize: '0.8rem' }}>{entry.BATCH_NUMBER}</code></td>
                        <td style={{ ...tdS, color: 'var(--text-secondary)' }}>{entry.REFERENCE_TYPE} #{entry.REFERENCE_ID}</td>
                        <td style={tdS}>{entry.PERFORMED_BY_NAME}</td>
                      </tr>
                    ))}
                    {ledgerData.length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                          <div style={{ fontSize: '2rem', marginBottom: 8, opacity: 0.3 }}>📋</div>
                          No transactions recorded.<br />
                          <span style={{ fontSize: '0.78rem' }}>Stock added via Add Stock or dispensed will appear here.</span>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── ISSUED MEDS DRAWER ──────────────────────────────── */}
      {issuedOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(6px)', zIndex: 9999, display: 'flex', justifyContent: 'flex-end', animation: 'fadeIn 0.2s ease-out' }}
          onClick={() => setIssuedOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ width: 740, maxWidth: '100%', height: '100%', background: 'var(--surface)', boxShadow: '-8px 0 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--border)', animation: 'hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1)' }}>
            {/* Header */}
            <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg, rgba(220,38,38,0.06), rgba(239,68,68,0.03))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>💊</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>Issued Medicines</h3>
                  <div style={{ fontSize: '0.82rem', color: '#dc2626', fontWeight: 600, marginTop: 2 }}>{issuedMedName}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {issuedData.length > 0 && (
                  <div style={{ padding: '6px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>Total Issued: </span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: '#dc2626' }}>{issuedData.reduce((sum, e) => sum + (e.QUANTITY || 0), 0)}</span>
                  </div>
                )}
                <button onClick={() => setIssuedOpen(false)}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: 36, height: 36, borderRadius: 10, fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            </div>
            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
              <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                <table style={{ width: '100%', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-2)' }}>
                      <th style={thS}>DATE</th>
                      <th style={thS}>PATIENT</th>
                      <th style={thS}>UHID</th>
                      <th style={{ ...thS, textAlign: 'right' }}>QTY</th>
                      <th style={thS}>BATCH</th>
                      <th style={thS}>TYPE</th>
                      <th style={thS}>ISSUED BY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issuedData.map((entry, i) => (
                      <tr key={entry.ID} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)' }}>
                        <td style={tdS}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{new Date(entry.TRANSACTION_DATE).toLocaleDateString('en-IN')}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(entry.TRANSACTION_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>
                        <td style={tdS}>
                          {entry.PATIENT_NAME && entry.PATIENT_NAME.trim() ? (
                            <div>
                              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>{entry.PATIENT_NAME}</div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '0.82rem' }}>
                              {entry.REFERENCE_TYPE === 'OTC' ? 'OTC Customer' : '—'}
                            </span>
                          )}
                        </td>
                        <td style={tdS}>
                          {entry.PATIENT_UHID ? (
                            <code style={{ background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 4, fontSize: '0.78rem', fontWeight: 600 }}>{entry.PATIENT_UHID}</code>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ ...tdS, textAlign: 'right' }}>
                          <span style={{ fontWeight: 800, fontSize: '1rem', color: '#dc2626',
                            display: 'inline-block', padding: '2px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.06)' }}>
                            -{entry.QUANTITY}
                          </span>
                        </td>
                        <td style={tdS}>
                          <code style={{ background: 'var(--surface-3)', padding: '2px 8px', borderRadius: 4, fontSize: '0.78rem' }}>{entry.BATCH_NUMBER}</code>
                        </td>
                        <td style={tdS}>
                          <span className={`badge ${entry.REFERENCE_TYPE === 'OTC' ? 'badge-amber' : 'badge-blue'}`}
                            style={{ fontSize: '0.7rem', padding: '2px 8px' }}>
                            {entry.REFERENCE_TYPE === 'DISPENSING' ? '🏥 Rx' : entry.REFERENCE_TYPE === 'OTC' ? '🛒 OTC' : entry.REFERENCE_TYPE}
                          </span>
                        </td>
                        <td style={tdS}>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{entry.PERFORMED_BY_NAME || '—'}</span>
                        </td>
                      </tr>
                    ))}
                    {issuedData.length === 0 && (
                      <tr>
                        <td colSpan="7" style={{ textAlign: 'center', padding: 50, color: 'var(--text-muted)' }}>
                          <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.2 }}>💊</div>
                          <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>No medicines issued yet</div>
                          <div style={{ fontSize: '0.82rem' }}>
                            When medicines are dispensed via prescription or OTC sales,<br />
                            they will appear here with patient details.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}


const labelS = { display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 };
const thS = { padding: '14px 20px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 };
const tdS = { padding: '16px 20px', verticalAlign: 'middle' };
const bthS = { padding: '10px 16px', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 };
const btdS = { padding: '10px 16px', verticalAlign: 'middle', fontSize: '0.85rem' };
