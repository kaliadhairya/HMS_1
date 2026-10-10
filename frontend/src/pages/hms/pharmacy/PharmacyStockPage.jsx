import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Boxes, Layers, PackagePlus, Pencil, Pill, RefreshCw, ScrollText, Search } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

const EMPTY_STOCK_FORM = {
  medicineId: '', supplierId: '', batchNumber: '', expiryDate: '',
  quantity: '', purchaseRate: '', mrp: '', gstRate: '0', invoiceNumber: '',
  newMedName: '', newMedFormulation: 'Tablet', newMedStrength: '', newMedStrengthUnit: 'mg',
  newSupName: '',
};

const LOW_STOCK = 10;
const FILTERS = [
  ['All', 'All'],
  ['Expired/Critical', 'Expired'],
  ['Expiring 30 Days', 'Expiring within 30 days'],
  ['Out of Stock', 'Out of stock'],
];

// SUM()/COUNT() columns arrive from PostgreSQL as strings ("0"), so always compare them as numbers.
const qtyOf = (item) => Number(item?.TOTAL_QUANTITY || 0);
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const inr = (v) => `₹${Number(v || 0).toFixed(2)}`;
const REF_LABEL = { DISPENSING: 'Prescription', OTC: 'Counter sale' };

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  width: '100%', textAlign: 'left', padding: '9px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer', display: 'grid', gap: 2,
};

const isExpiringSoon = (dateString) => {
  if (!dateString) return false;
  const diff = new Date(dateString) - new Date();
  return diff <= 30 * 24 * 60 * 60 * 1000 && diff > 0;
};

const isExpired = (dateString) => {
  if (!dateString) return false;
  return new Date(dateString) <= new Date();
};

const getItemKey = (item) => `${item.GENERIC_NAME}|${item.FORMULATION || ''}|${item.STRENGTH || ''}|${item.STRENGTH_UNIT || ''}`;

function ExpiryCell({ date }) {
  if (!date) return <span className="cell-secondary">—</span>;
  const expired = isExpired(date);
  const expiring = isExpiringSoon(date);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span className="tabular">{fmtDate(date)}</span>
      {expired && <span className="status status-danger">Expired</span>}
      {expiring && !expired && <span className="status status-warning">Expiring</span>}
    </span>
  );
}

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

  // Batch details for one medicine (opened from its row)
  const [batchItem, setBatchItem] = useState(null);
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
      toast.error('Could not load stock');
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

  // ─── BATCHES FOR ONE MEDICINE ───────────────────────────────
  const loadBatches = async (item) => {
    setBatchLoading(true);
    try {
      const params = new URLSearchParams({ name: item.GENERIC_NAME });
      if (item.FORMULATION) params.append('formulation', item.FORMULATION);
      if (item.STRENGTH) params.append('strength', item.STRENGTH);
      const res = await api.get(`/pharmacy/stock/batches-by-name?${params.toString()}`);
      setBatchDetails(res.data.data || []);
    } catch (err) {
      toast.error('Could not load batch details');
      setBatchDetails([]);
    } finally {
      setBatchLoading(false);
    }
  };

  const openBatches = (item) => {
    setBatchItem(item);
    setBatchDetails([]);
    loadBatches(item);
  };

  const closeBatches = () => {
    setBatchItem(null);
    setBatchDetails([]);
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
      toast.error('Fill in the medicine, batch number, expiry date and quantity');
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
        if (!finalMedicineId) throw new Error('Could not create the medicine');
        toast.success(`Medicine "${medSearch.trim()}" added to the catalogue`);
      }

      if (!finalSupplierId && supSearch.trim()) {
        const supRes = await api.post('/suppliers', { name: supSearch.trim() });
        finalSupplierId = supRes.data.data?.id;
        if (finalSupplierId) toast.success(`Supplier "${supSearch.trim()}" added`);
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
      toast.success('Stock added');
      setAddModalOpen(false);
      fetchStock();
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || err.message || 'Could not add stock');
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

      toast.success('Batch updated');
      setEditModalOpen(false);
      // Refresh both the stock list and the open batch list
      fetchStock();
      if (batchItem) loadBatches(batchItem);
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.message || 'Could not update the batch');
    } finally { setEditSubmitting(false); }
  };

  // ─── LEDGER ─────────────────────────────────────────────────
  const openLedger = async (e, medicineId, medicineName) => {
    if (e) e.stopPropagation();
    try {
      const res = await api.get(`/pharmacy/stock-ledger/${medicineId}`);
      setLedgerData(res.data.data || []);
      setLedgerMedName(medicineName);
      setLedgerOpen(true);
    } catch (err) { toast.error('Could not load the stock ledger'); }
  };

  // ─── ISSUED MEDS ────────────────────────────────────────────
  const openIssuedMeds = async (e, item) => {
    if (e) e.stopPropagation();
    try {
      const params = new URLSearchParams({ name: item.GENERIC_NAME });
      if (item.FORMULATION) params.append('formulation', item.FORMULATION);
      if (item.STRENGTH) params.append('strength', item.STRENGTH);
      const res = await api.get(`/pharmacy/issued-meds?${params.toString()}`);
      setIssuedData(res.data.data || []);
      setIssuedMedName(item.GENERIC_NAME);
      setIssuedOpen(true);
    } catch (err) { toast.error('Could not load issued medicines'); }
  };

  // ─── FILTERS AND COUNTS ─────────────────────────────────────
  const matchesFilter = (item, key) => {
    if (key === 'Expired/Critical') return isExpired(item.NEAREST_EXPIRY);
    if (key === 'Expiring 30 Days') return isExpiringSoon(item.NEAREST_EXPIRY) || isExpired(item.NEAREST_EXPIRY);
    if (key === 'Out of Stock') return qtyOf(item) <= 0;
    return true;
  };

  const filteredStock = stock.filter(item => {
    const name = (item.GENERIC_NAME || '').toLowerCase();
    if (!name.includes(search.toLowerCase())) return false;
    return matchesFilter(item, filter);
  });

  const filterCounts = Object.fromEntries(FILTERS.map(([key]) => [key, stock.filter((s) => matchesFilter(s, key)).length]));
  const outOfStockCount = filterCounts['Out of Stock'];
  const lowStockCount = stock.filter(s => qtyOf(s) > 0 && qtyOf(s) <= LOW_STOCK).length;
  const expiringCount = filterCounts['Expiring 30 Days'];

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Medicine', accessorFn: (item) => item.GENERIC_NAME || '',
      cell: ({ row }) => {
        const item = row.original;
        const form = [item.FORMULATION, [item.STRENGTH, item.STRENGTH_UNIT].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
        return (
          <span className="cell-stack">
            <span className="cell-primary">{item.GENERIC_NAME}</span>
            <span className="cell-secondary">{form || '—'}</span>
          </span>
        );
      },
    },
    {
      id: 'batches', header: 'Batches', accessorFn: (item) => Number(item.BATCH_COUNT || 0), meta: { width: 100, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{getValue()}</span>,
    },
    {
      id: 'qty', header: 'In stock', accessorFn: (item) => qtyOf(item), meta: { width: 140, align: 'right' },
      cell: ({ row, getValue }) => {
        const qty = getValue();
        const issued = Number(row.original.TOTAL_ISSUED || 0);
        return (
          <span className="cell-stack" style={{ alignItems: 'flex-end' }}>
            <span className="tabular" style={{ fontWeight: 600, color: qty <= 0 ? 'var(--red)' : qty <= LOW_STOCK ? 'var(--amber)' : undefined }}>{qty}</span>
            {issued > 0 && <span className="cell-secondary">{issued} issued</span>}
          </span>
        );
      },
    },
    {
      id: 'status', header: 'Status', meta: { width: 130 },
      accessorFn: (item) => (qtyOf(item) <= 0 ? 0 : qtyOf(item) <= LOW_STOCK ? 1 : 2),
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === 0) return <span className="status status-danger">Out of stock</span>;
        if (v === 1) return <span className="status status-warning">Low</span>;
        return <span className="status status-success">In stock</span>;
      },
    },
    {
      id: 'expiry', header: 'Nearest expiry', meta: { width: 200 },
      accessorFn: (item) => (item.NEAREST_EXPIRY ? new Date(item.NEAREST_EXPIRY).getTime() : Number.MAX_SAFE_INTEGER),
      cell: ({ row }) => <ExpiryCell date={row.original.NEAREST_EXPIRY} />,
    },
    {
      id: 'mrp', header: 'MRP', accessorFn: (item) => Number(item.MRP || 0), meta: { width: 110, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => {
        const item = row.original;
        return (
          <RowMenu
            label={`Actions for ${item.GENERIC_NAME}`}
            items={[
              { label: 'View batches', icon: Layers, onSelect: () => openBatches(item) },
              { label: 'Stock ledger', icon: ScrollText, onSelect: () => openLedger(null, item.ID, item.GENERIC_NAME) },
              { label: 'Issued to patients', icon: Pill, onSelect: () => openIssuedMeds(null, item) },
            ]}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const addStockButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={openAddModal}>
      <PackagePlus size={16} aria-hidden="true" /> Add stock
    </button>
  );

  const issuedTotal = issuedData.reduce((sum, e) => sum + Number(e.QUANTITY || 0), 0);
  const editOldQty = editBatch ? (editBatch.QUANTITY || 0) : 0;
  const editDiff = (parseInt(editForm.quantity) || 0) - editOldQty;

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Pharmacy stock"
        description="One row per medicine. Select a row to see its batches, adjust quantities or check the ledger."
        actions={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchStock}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
            {addStockButton}
          </>
        )}
      />

      <div className="kpi-strip">
        <div className="panel kpi">
          <div className="kpi-label">Medicines</div>
          <div className="kpi-value">{loading ? '—' : stock.length}</div>
        </div>
        <div className="panel kpi">
          <div className="kpi-label">Out of stock</div>
          <div className="kpi-value" style={{ color: outOfStockCount > 0 ? 'var(--red)' : undefined }}>{loading ? '—' : outOfStockCount}</div>
        </div>
        <div className="panel kpi">
          <div className="kpi-label">Low stock ({LOW_STOCK} or fewer)</div>
          <div className="kpi-value" style={{ color: lowStockCount > 0 ? 'var(--amber)' : undefined }}>{loading ? '—' : lowStockCount}</div>
        </div>
        <div className="panel kpi">
          <div className="kpi-label">Expired or expiring in 30 days</div>
          <div className="kpi-value" style={{ color: expiringCount > 0 ? 'var(--amber)' : undefined }}>{loading ? '—' : expiringCount}</div>
        </div>
      </div>

      {/* ─── MAIN TABLE (Consolidated) ────────────────────────── */}
      <section className="panel">
        <div className="toolbar">
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search stock</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by medicine name" />
          </label>
          <div className="segmented" role="tablist" aria-label="Filter stock">
            {FILTERS.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>
                {label} <span className="seg-count">{filterCounts[key]}</span>
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          data={filteredStock}
          loading={loading}
          getRowId={getItemKey}
          onRowClick={openBatches}
          rowLabel={(item) => `View batches of ${item.GENERIC_NAME}`}
          initialSorting={[{ id: 'name', desc: false }]}
          empty={stock.length > 0 ? (
            <EmptyState icon={Search} title="No medicines match" description="Try another name, or choose a different filter." />
          ) : (
            <EmptyState icon={Boxes} title="No stock yet" description="Add stock as it arrives so it can be dispensed and sold." action={addStockButton} />
          )}
        />
      </section>
    </main>

    {/* ─── BATCHES ─────────────────────────────────────────── */}
    <Modal
      open={Boolean(batchItem)}
      onOpenChange={(open) => { if (!open) closeBatches(); }}
      size="lg"
      title={batchItem ? `Batches of ${batchItem.GENERIC_NAME}` : 'Batches'}
      description={batchItem ? `${[batchItem.FORMULATION, [batchItem.STRENGTH, batchItem.STRENGTH_UNIT].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Stock entries'}${batchLoading ? '' : ` · ${batchDetails.length} ${batchDetails.length === 1 ? 'batch' : 'batches'}`}` : ''}
    >
      {batchLoading ? <p className="muted">Loading…</p> : batchDetails.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No stock entries yet"
          description="This medicine has no batches. Add stock to create one."
          action={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => { closeBatches(); openAddModal(); }}>
              <PackagePlus size={16} aria-hidden="true" /> Add stock
            </button>
          )}
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="text-right">Qty</th>
                <th>Supplier</th>
                <th className="text-right">MRP</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {batchDetails.map((b) => {
                const q = Number(b.QUANTITY || 0);
                return (
                  <tr key={b.BATCH_ID}>
                    <td>
                      <span className="cell-stack">
                        <span className="mono">{b.BATCH_NUMBER}</span>
                        {b.ADDED_ON && <span className="cell-secondary">Added {fmtDate(b.ADDED_ON)}</span>}
                      </span>
                    </td>
                    <td><ExpiryCell date={b.EXPIRY_DATE} /></td>
                    <td className="text-right tabular" style={{ fontWeight: 600, color: q <= 0 ? 'var(--red)' : q <= LOW_STOCK ? 'var(--amber)' : undefined }}>{q}</td>
                    <td>{b.SUPPLIER_NAME || '—'}</td>
                    <td className="text-right tabular">{inr(b.MRP)}</td>
                    <td className="text-right">
                      <span className="inline-actions" style={{ flexWrap: 'nowrap' }}>
                        <button type="button" className="icon-btn" aria-label={`Stock ledger for batch ${b.BATCH_NUMBER}`} title="Stock ledger" onClick={(e) => openLedger(e, b.MEDICINE_ID, batchItem?.GENERIC_NAME)}>
                          <ScrollText size={16} aria-hidden="true" />
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditBatch(b, batchItem?.GENERIC_NAME)}>
                          <Pencil size={14} aria-hidden="true" /> Edit
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Modal>

    {/* ─── ADD STOCK MODAL ─────────────────────────────────── */}
    <Modal
      open={addModalOpen}
      onOpenChange={setAddModalOpen}
      size="lg"
      title="Add stock"
      description="Receive a batch into inventory. A medicine or supplier you type that is not on file is created for you."
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setAddModalOpen(false)}>Cancel</button>
          <button type="submit" form="add-stock-form" className="btn btn-primary btn-md" disabled={addSubmitting}>
            {addSubmitting ? 'Adding…' : 'Add to inventory'}
          </button>
        </>
      )}
    >
      <form id="add-stock-form" onSubmit={handleAddSubmit} style={{ display: 'grid', gap: 14 }}>
        <h3 className="panel-subtitle" style={{ margin: 0 }}>Medicine and supplier</h3>
        <div className="form-row-2">
          {/* Medicine Typeahead */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label" htmlFor="stock-med">Medicine</label>
            <input
              id="stock-med" type="text" className="form-input" value={medSearch} autoComplete="off"
              onFocus={() => setMedFocused(true)} onBlur={() => setTimeout(() => setMedFocused(false), 200)}
              onChange={e => { setMedSearch(e.target.value); setAddForm({ ...addForm, medicineId: '', newMedName: e.target.value }); }}
              placeholder="Type a medicine name"
            />
            {addForm.medicineId && <p className="form-hint" style={{ color: 'var(--success)' }}>Existing medicine selected.</p>}
            {isNewMedicine && <p className="form-hint" style={{ color: 'var(--amber)' }}>Not on file. It will be added to the catalogue.</p>}
            {medFocused && medSearch.trim().length >= 1 && filteredMedicines.length > 0 && (
              <div style={suggestionBox} role="listbox" aria-label="Matching medicines">
                {filteredMedicines.slice(0, 10).map(m => (
                  <button key={m.id} type="button" role="option" aria-selected={addForm.medicineId === m.id} onClick={() => selectMedicine(m)} style={suggestionItem}>
                    <span className="cell-primary">{m.genericName}</span>
                    <span className="cell-secondary">{m.formulation} · {m.strength}{m.strengthUnit} · Stock {m.totalStock || 0}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Supplier Typeahead */}
          <div className="form-group" style={{ position: 'relative' }}>
            <label className="form-label" htmlFor="stock-sup">Supplier (optional)</label>
            <input
              id="stock-sup" type="text" className="form-input" value={supSearch} autoComplete="off"
              onFocus={() => setSupFocused(true)} onBlur={() => setTimeout(() => setSupFocused(false), 200)}
              onChange={e => { setSupSearch(e.target.value); setAddForm({ ...addForm, supplierId: '', newSupName: e.target.value }); }}
              placeholder="Type a supplier name"
            />
            {addForm.supplierId && <p className="form-hint" style={{ color: 'var(--success)' }}>Existing supplier selected.</p>}
            {isNewSupplier && <p className="form-hint" style={{ color: 'var(--amber)' }}>Not on file. It will be added as a new supplier.</p>}
            {supFocused && supSearch.trim().length >= 1 && filteredSuppliers.length > 0 && (
              <div style={suggestionBox} role="listbox" aria-label="Matching suppliers">
                {filteredSuppliers.slice(0, 10).map(s => (
                  <button key={s.id} type="button" role="option" aria-selected={addForm.supplierId === s.id} onClick={() => selectSupplier(s)} style={suggestionItem}>
                    <span className="cell-primary">{s.name}</span>
                    {s.contactPerson && <span className="cell-secondary">{s.contactPerson}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {isNewMedicine && (
          <div className="form-grid-3" style={{ padding: 12, borderRadius: 8, border: '1px dashed var(--border)', background: 'var(--surface-2)' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="stock-new-form">Formulation</label>
              <select id="stock-new-form" className="form-select" value={addForm.newMedFormulation} onChange={e => setAddForm({ ...addForm, newMedFormulation: e.target.value })}>
                {['Tablet', 'Capsule', 'Injection', 'Syrup', 'Ointment', 'Drops', 'Other'].map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="stock-new-strength">Strength</label>
              <input id="stock-new-strength" className="form-input" type="text" value={addForm.newMedStrength} onChange={e => setAddForm({ ...addForm, newMedStrength: e.target.value })} placeholder="For example, 500" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="stock-new-unit">Unit</label>
              <select id="stock-new-unit" className="form-select" value={addForm.newMedStrengthUnit} onChange={e => setAddForm({ ...addForm, newMedStrengthUnit: e.target.value })}>
                {['mg', 'ml', 'g', 'mcg', 'IU', '%'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
        )}

        <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>Batch</h3>
        <div className="form-grid-3">
          <div className="form-group">
            <label className="form-label" htmlFor="stock-batch">Batch number</label>
            <input id="stock-batch" required className="form-input" type="text" value={addForm.batchNumber} onChange={e => setAddForm({ ...addForm, batchNumber: e.target.value })} placeholder="For example, BN-2024-001" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-expiry">Expiry date</label>
            <input id="stock-expiry" required className="form-input" type="date" value={addForm.expiryDate} onChange={e => setAddForm({ ...addForm, expiryDate: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-invoice">Invoice number</label>
            <input id="stock-invoice" className="form-input" type="text" value={addForm.invoiceNumber} onChange={e => setAddForm({ ...addForm, invoiceNumber: e.target.value })} placeholder="For example, INV-1234" />
          </div>
        </div>

        <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>Quantity and pricing</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-qty">Quantity</label>
            <input id="stock-qty" required className="form-input" type="number" min="1" value={addForm.quantity} onChange={e => setAddForm({ ...addForm, quantity: e.target.value })} placeholder="For example, 100" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-rate">Purchase rate (₹)</label>
            <input id="stock-rate" className="form-input" type="number" step="0.01" min="0" value={addForm.purchaseRate} onChange={e => setAddForm({ ...addForm, purchaseRate: e.target.value })} placeholder="5.50" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-mrp">MRP (₹)</label>
            <input id="stock-mrp" className="form-input" type="number" step="0.01" min="0" value={addForm.mrp} onChange={e => setAddForm({ ...addForm, mrp: e.target.value })} placeholder="10.00" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="stock-gst">GST rate (%)</label>
            <input id="stock-gst" className="form-input" type="number" step="0.01" min="0" value={addForm.gstRate} onChange={e => setAddForm({ ...addForm, gstRate: e.target.value })} placeholder="12" />
          </div>
        </div>
      </form>
    </Modal>

    {/* ─── EDIT BATCH MODAL ────────────────────────────────── */}
    <Modal
      open={editModalOpen && Boolean(editBatch)}
      onOpenChange={setEditModalOpen}
      title="Adjust batch quantity"
      description={editBatch ? `${editBatch.GENERIC_NAME} · batch ${editBatch.BATCH_NUMBER}` : ''}
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setEditModalOpen(false)}>Cancel</button>
          <button type="submit" form="edit-batch-form" className="btn btn-primary btn-md" disabled={editSubmitting}>
            {editSubmitting ? 'Saving…' : 'Save changes'}
          </button>
        </>
      )}
    >
      {editBatch && (
        <form id="edit-batch-form" onSubmit={handleEditSubmit} style={{ display: 'grid', gap: 14 }}>
          <div className="facts" style={{ padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div><div className="fact-label">Expiry</div><div className="fact-value tabular">{fmtDate(editBatch.EXPIRY_DATE)}</div></div>
            <div><div className="fact-label">MRP</div><div className="fact-value tabular">{inr(editForm.mrp)}</div></div>
            <div><div className="fact-label">Purchase rate</div><div className="fact-value tabular">{inr(editForm.purchaseRate)}</div></div>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="edit-batch-qty">Quantity</label>
            <input id="edit-batch-qty" required className="form-input" type="number" min="0" value={editForm.quantity} onChange={e => setEditForm({ ...editForm, quantity: e.target.value })} />
            <p className="form-hint">
              Currently {editOldQty}
              {editDiff !== 0 && (
                <strong style={{ marginLeft: 6, color: editDiff > 0 ? 'var(--success)' : 'var(--red)' }}>
                  ({editDiff > 0 ? '+' : ''}{editDiff})
                </strong>
              )}
              . The difference is recorded in the stock ledger.
            </p>
          </div>
        </form>
      )}
    </Modal>

    {/* ─── LEDGER ──────────────────────────────────────────── */}
    <Modal
      open={ledgerOpen}
      onOpenChange={setLedgerOpen}
      size="lg"
      title="Stock ledger"
      description={ledgerMedName}
    >
      {ledgerData.length === 0 ? (
        <p className="muted">No transactions recorded. Stock that is added or dispensed appears here.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="mini-table">
            <thead>
              <tr><th>Date</th><th>Type</th><th className="text-right">Qty</th><th>Batch</th><th>Reference</th><th>User</th></tr>
            </thead>
            <tbody>
              {ledgerData.map((entry) => (
                <tr key={entry.ID}>
                  <td className="tabular" style={{ whiteSpace: 'nowrap' }}>{new Date(entry.TRANSACTION_DATE).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>
                    <span className={`status ${entry.TRANSACTION_TYPE === 'IN' || entry.TRANSACTION_TYPE === 'RETURN' ? 'status-success' : 'status-danger'}`}>
                      {entry.TRANSACTION_TYPE}
                    </span>
                  </td>
                  <td className="text-right tabular" style={{ fontWeight: 600 }}>{entry.QUANTITY}</td>
                  <td className="mono">{entry.BATCH_NUMBER}</td>
                  <td className="cell-secondary">{entry.REFERENCE_TYPE}{entry.REFERENCE_ID ? ` #${entry.REFERENCE_ID}` : ''}</td>
                  <td>{entry.PERFORMED_BY_NAME || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>

    {/* ─── ISSUED MEDS ─────────────────────────────────────── */}
    <Modal
      open={issuedOpen}
      onOpenChange={setIssuedOpen}
      size="lg"
      title="Issued medicines"
      description={issuedData.length > 0 ? `${issuedMedName} · ${issuedTotal} issued in total` : issuedMedName}
    >
      {issuedData.length === 0 ? (
        <p className="muted">Nothing issued yet. Prescriptions dispensed and counter sales appear here with patient details.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="mini-table">
            <thead>
              <tr><th>Date</th><th>Patient</th><th className="text-right">Qty</th><th>Batch</th><th>Type</th><th>Issued by</th></tr>
            </thead>
            <tbody>
              {issuedData.map((entry) => (
                <tr key={entry.ID}>
                  <td>
                    <span className="cell-stack">
                      <span className="tabular">{fmtDate(entry.TRANSACTION_DATE)}</span>
                      <span className="cell-secondary">{new Date(entry.TRANSACTION_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </td>
                  <td>
                    {entry.PATIENT_NAME && entry.PATIENT_NAME.trim() ? (
                      <span className="cell-stack">
                        <span className="cell-primary">{entry.PATIENT_NAME}</span>
                        {entry.PATIENT_UHID && <span className="cell-secondary mono">{entry.PATIENT_UHID}</span>}
                      </span>
                    ) : (
                      <span className="cell-secondary">{entry.REFERENCE_TYPE === 'OTC' ? 'Counter customer' : '—'}</span>
                    )}
                  </td>
                  <td className="text-right tabular" style={{ fontWeight: 600 }}>{entry.QUANTITY}</td>
                  <td className="mono">{entry.BATCH_NUMBER}</td>
                  <td><span className="tag">{REF_LABEL[entry.REFERENCE_TYPE] || entry.REFERENCE_TYPE}</span></td>
                  <td>{entry.PERFORMED_BY_NAME || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
    </>
  );
}
