import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Pill, Plus, Power, PowerOff, Search, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';

function parseBrandNames(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      return [String(parsed)];
    } catch {
      // Postgres array format e.g. "{Novamox,Amox}" or plain string "Novamox"
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
      }
      return [trimmed];
    }
  }
  return [];
}

const LOW_STOCK = 50;
const categories = ['Analgesic', 'Antibiotic', 'Antacid', 'Antidiabetic', 'IV Fluid', 'Vitamins', 'Other'];
const formulations = ['Tablet', 'Capsule', 'Injection', 'Syrup', 'Ointment', 'Drops', 'Other'];
const strengthUnits = ['mg', 'ml', 'g', 'mcg', 'IU', '%'];
const unitsOfSale = ['Strip', 'Bottle', 'Vial', 'Tube', 'Box'];

const suggestionBox = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, maxHeight: 220, overflowY: 'auto',
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-lg)',
};
const suggestionItem = {
  width: '100%', textAlign: 'left', padding: '9px 12px', border: 0, borderBottom: '1px solid var(--border)',
  background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer', display: 'grid', gap: 2,
};
const chipRemove = {
  border: 0, background: 'none', padding: 0, marginLeft: 6, display: 'inline-flex', color: 'var(--text-muted)', cursor: 'pointer',
};

export default function MedicineMasterPage() {
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [loadedQty, setLoadedQty] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    genericName: '', brandNames: [], category: 'Analgesic',
    formulation: 'Tablet', strength: '', strengthUnit: 'mg',
    unitOfSale: 'Strip', hsnCode: '', gstRate: 0, isControlled: false,
    initialQuantity: 0, perUnitPrice: 0
  });
  const [brandInput, setBrandInput] = useState('');
  const [rxNavSuggestions, setRxNavSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    fetchMedicines();
  }, [debouncedSearch]);

  useEffect(() => {
    const genericName = formData.genericName.trim();
    if (!isModalOpen || genericName.length < 2) {
      setRxNavSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSuggestionsLoading(true);
        const res = await api.get(`/medicines/rxnav/search?q=${encodeURIComponent(genericName)}`);
        setRxNavSuggestions(res.data?.data || []);
      } catch (err) {
        setRxNavSuggestions([]);
      } finally {
        setSuggestionsLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [formData.genericName, isModalOpen]);

  const fetchMedicines = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/medicines?search=${encodeURIComponent(debouncedSearch)}`);
      setMedicines(res.data.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Could not load medicines');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (med) => {
    setEditingId(med.id);
    setLoadedQty(Number(med.totalStock || 0));
    setFormData({
      genericName: med.genericName,
      brandNames: parseBrandNames(med.brandNames),
      category: med.category || 'Other',
      formulation: med.formulation || 'Tablet',
      strength: med.strength || '',
      strengthUnit: med.strengthUnit || 'mg',
      unitOfSale: med.unitOfSale || 'Strip',
      hsnCode: med.hsnCode || '',
      gstRate: med.gstRate || 0,
      isControlled: med.isControlled === 1,
      initialQuantity: Number(med.totalStock || 0),
      perUnitPrice: Number(med.mrp || 0),
    });
    setBrandInput('');
    setIsModalOpen(true);
  };

  const handleToggleActive = async (id) => {
    try {
      await api.patch(`/medicines/${id}/toggle`);
      toast.success('Medicine status updated');
      fetchMedicines();
    } catch (err) {
      toast.error('Could not update the status');
    }
  };

  const openForm = () => {
    setEditingId(null);
    setFormData({
      genericName: '', brandNames: [], category: 'Analgesic',
      formulation: 'Tablet', strength: '', strengthUnit: 'mg',
      unitOfSale: 'Strip', hsnCode: '', gstRate: 0, isControlled: false,
      initialQuantity: 0, perUnitPrice: 0
    });
    setBrandInput('');
    setIsModalOpen(true);
  };

  const addBrand = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (brandInput.trim() && !formData.brandNames.includes(brandInput.trim())) {
        setFormData(prev => ({ ...prev, brandNames: [...prev.brandNames, brandInput.trim()] }));
        setBrandInput('');
      }
    }
  };

  const removeBrand = (bToRemove) => {
    setFormData(prev => ({ ...prev, brandNames: prev.brandNames.filter(b => b !== bToRemove) }));
  };

  const applySuggestion = (suggestion) => {
    setFormData((prev) => {
      const nextBrands = [...prev.brandNames];
      if (suggestion.synonym && !nextBrands.includes(suggestion.synonym)) {
        nextBrands.push(suggestion.synonym);
      }

      return {
        ...prev,
        genericName: suggestion.name,
        brandNames: nextBrands,
      };
    });
    setRxNavSuggestions([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const payload = { ...formData, brandNames: formData.brandNames };
      // The quantity field is prefilled with the total across all batches, but the API writes it onto the
      // latest batch only. Sending it back unchanged would inflate stock when a medicine has several batches,
      // so it is sent only when the user actually changed it.
      if (editingId && payload.initialQuantity === loadedQty) delete payload.initialQuantity;
      if (editingId) {
        await api.put(`/medicines/${editingId}`, payload);
        toast.success('Medicine updated');
      } else {
        await api.post('/medicines', payload);
        toast.success('Medicine added');
      }
      setIsModalOpen(false);
      fetchMedicines();
    } catch (err) {
      console.error(err);
      let errMsg = err.response?.data?.message || err.response?.data?.error || 'Could not save the medicine';
      if (err.response?.data?.errors) {
        errMsg = err.response.data.errors.map(e => e.msg).join(', ');
      }
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  const setField = (key, value) => setFormData((prev) => ({ ...prev, [key]: value }));

  const activeCount = medicines.filter((m) => m.isActive).length;
  const filtered = useMemo(() => medicines.filter((m) => {
    if (statusFilter === 'active') return Boolean(m.isActive);
    if (statusFilter === 'disabled') return !m.isActive;
    return true;
  }), [medicines, statusFilter]);

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Medicine', accessorFn: (m) => m.genericName || '',
      cell: ({ row }) => {
        const m = row.original;
        return (
          <span className="cell-stack">
            <span className="cell-primary">{m.genericName}</span>
            <span className="cell-secondary" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="mono">ID {m.id}</span>
              {m.isControlled === 1 && <span className="status status-danger" title="Controlled substance, prescription required">Rx</span>}
            </span>
          </span>
        );
      },
    },
    {
      id: 'brands', header: 'Brands', enableSorting: false, accessorFn: (m) => parseBrandNames(m.brandNames).join(', '),
      cell: ({ row }) => {
        const brands = parseBrandNames(row.original.brandNames);
        if (brands.length === 0) return <span className="cell-secondary">—</span>;
        return (
          <span className="chip-row" style={{ gap: 4, maxWidth: 240 }}>
            {brands.slice(0, 3).map((b) => <span key={b} className="tag">{b}</span>)}
            {brands.length > 3 && <span className="tag tag-more">+{brands.length - 3}</span>}
          </span>
        );
      },
    },
    {
      id: 'form', header: 'Form and strength', accessorFn: (m) => m.formulation || '', meta: { width: 160 },
      cell: ({ row }) => (
        <span className="cell-stack">
          <span>{row.original.formulation || '—'}</span>
          <span className="cell-secondary">{[row.original.strength, row.original.strengthUnit].filter(Boolean).join(' ') || '—'}</span>
        </span>
      ),
    },
    { id: 'category', header: 'Category', accessorFn: (m) => m.category || '', meta: { width: 140 }, cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'stock', header: 'Stock', accessorFn: (m) => Number(m.totalStock || 0), meta: { width: 110, align: 'right' },
      cell: ({ row, getValue }) => (
        <span className="cell-stack" style={{ alignItems: 'flex-end' }}>
          <span className="tabular" style={{ fontWeight: 600, color: getValue() < LOW_STOCK ? 'var(--red)' : undefined }}>{getValue()}</span>
          <span className="cell-secondary">{row.original.unitOfSale ? `${row.original.unitOfSale}s` : ''}</span>
        </span>
      ),
    },
    {
      id: 'price', header: 'Unit price', accessorFn: (m) => Number(m.mrp || 0), meta: { width: 120, align: 'right' },
      cell: ({ row, getValue }) => (
        <span className="cell-stack" style={{ alignItems: 'flex-end' }}>
          <span className="tabular">₹{getValue().toFixed(2)}</span>
          <span className="cell-secondary">{row.original.unitOfSale ? `per ${row.original.unitOfSale}` : ''}</span>
        </span>
      ),
    },
    {
      id: 'status', header: 'Status', accessorFn: (m) => (m.isActive ? 'Active' : 'Disabled'), meta: { width: 110 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Active' ? 'status-success' : 'status-neutral'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => {
        const m = row.original;
        return (
          <RowMenu
            label={`Actions for ${m.genericName}`}
            items={[
              { label: 'Edit medicine', icon: Pencil, onSelect: () => handleEdit(m) },
              { label: m.isActive ? 'Disable' : 'Enable', icon: m.isActive ? PowerOff : Power, onSelect: () => handleToggleActive(m.id), danger: Boolean(m.isActive), separator: true },
            ]}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const addButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={openForm}>
      <Plus size={16} aria-hidden="true" /> Add medicine
    </button>
  );

  const showSuggestions = suggestionsLoading || rxNavSuggestions.length > 0;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Medicines"
          description="The medicine catalogue: formulations, pricing and current stock."
          meta={!loading && <span className="muted">{medicines.length} medicines · {activeCount} active</span>}
          actions={addButton}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search medicines</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search generic or brand name" />
            </label>
            <div className="segmented" role="tablist" aria-label="Filter by status">
              {[['all', 'All'], ['active', 'Active'], ['disabled', 'Disabled']].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={statusFilter === key} className={statusFilter === key ? 'is-active' : ''} onClick={() => setStatusFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            getRowId={(m) => String(m.id)}
            onRowClick={handleEdit}
            rowLabel={(m) => `Edit ${m.genericName}`}
            initialSorting={[{ id: 'name', desc: false }]}
            empty={debouncedSearch || medicines.length > 0 ? (
              <EmptyState icon={Search} title="No medicines match" description="Try another generic or brand name, or show all statuses." />
            ) : (
              <EmptyState icon={Pill} title="No medicines yet" description="Add the medicines the pharmacy stocks so they can be prescribed and dispensed." action={addButton} />
            )}
          />
        </section>
      </main>

      <Modal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        size="lg"
        title={editingId ? `Edit ${formData.genericName || 'medicine'}` : 'Add medicine'}
        description={editingId ? 'Update the details, stock and price for this medicine.' : 'Register a new medicine. Opening stock is optional.'}
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setIsModalOpen(false)}>Cancel</button>
            <button type="submit" form="medicine-form" className="btn btn-primary btn-md" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add medicine'}
            </button>
          </>
        )}
      >
        <form id="medicine-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
          <h3 className="panel-subtitle" style={{ marginTop: 0, marginBottom: 0 }}>Identity</h3>
          <div className="form-group">
            <label className="form-label" htmlFor="med-generic">Generic name</label>
            <div style={{ position: 'relative' }}>
              <input
                id="med-generic" className="form-input" required type="text" autoComplete="off"
                value={formData.genericName} onChange={e => setField('genericName', e.target.value)}
                placeholder="For example, Paracetamol"
                aria-describedby="med-generic-hint"
              />
              {showSuggestions && (
                <div style={suggestionBox} role="listbox" aria-label="RxNav suggestions">
                  {suggestionsLoading && <p className="muted" style={{ padding: '10px 12px' }}>Searching RxNav…</p>}
                  {!suggestionsLoading && rxNavSuggestions.map((s) => (
                    <button key={`${s.rxnormId || s.name}-${s.rxnormTty || 'na'}`} type="button" role="option" aria-selected="false" onClick={() => applySuggestion(s)} style={suggestionItem}>
                      <span className="cell-primary">{s.name}</span>
                      <span className="cell-secondary">{s.rxnormTty || 'RxNorm'}{s.synonym ? ` · ${s.synonym}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="form-hint" id="med-generic-hint">Type 2 or more characters to see RxNav suggestions.</p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="med-brand">Brand names</label>
            {formData.brandNames.length > 0 && (
              <div className="chip-row" style={{ gap: 6 }}>
                {formData.brandNames.map(b => (
                  <span key={b} className="tag">
                    {b}
                    <button type="button" style={chipRemove} onClick={() => removeBrand(b)} aria-label={`Remove ${b}`}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              id="med-brand" className="form-input" type="text" value={brandInput}
              onChange={e => setBrandInput(e.target.value)} onKeyDown={addBrand}
              placeholder="Type a brand name and press Enter"
            />
          </div>

          <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>Classification</h3>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="med-category">Category</label>
              <select id="med-category" className="form-select" value={formData.category} onChange={e => setField('category', e.target.value)}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="med-formulation">Formulation</label>
              <select id="med-formulation" className="form-select" required value={formData.formulation} onChange={e => setField('formulation', e.target.value)}>
                {formulations.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>Dosage and packaging</h3>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label" htmlFor="med-strength">Strength</label>
              <input id="med-strength" className="form-input" type="text" value={formData.strength} onChange={e => setField('strength', e.target.value)} placeholder="For example, 500" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="med-unit">Unit</label>
              <select id="med-unit" className="form-select" value={formData.strengthUnit} onChange={e => setField('strengthUnit', e.target.value)}>
                {strengthUnits.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="med-sale-unit">Sale unit</label>
              <select id="med-sale-unit" className="form-select" value={formData.unitOfSale} onChange={e => setField('unitOfSale', e.target.value)}>
                {unitsOfSale.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>Tax and compliance</h3>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="med-hsn">HSN code</label>
              <input id="med-hsn" className="form-input" type="text" value={formData.hsnCode} onChange={e => setField('hsnCode', e.target.value)} placeholder="For example, 30049099" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="med-gst">GST rate (%)</label>
              <input id="med-gst" className="form-input" type="number" step="0.01" value={formData.gstRate} onChange={e => setField('gstRate', parseFloat(e.target.value) || 0)} placeholder="For example, 12" />
            </div>
          </div>
          <label className="check-row" htmlFor="isControlled">
            <input type="checkbox" id="isControlled" checked={formData.isControlled} onChange={e => setField('isControlled', e.target.checked)} />
            <span>
              <span style={{ fontWeight: 600 }}>Controlled substance (Rx)</span>
              <span className="form-hint" style={{ display: 'block', marginTop: 2 }}>Tick if this medicine can only be dispensed against a prescription.</span>
            </span>
          </label>

          <h3 className="panel-subtitle" style={{ marginBottom: 0 }}>{editingId ? 'Inventory and pricing' : 'Opening stock (optional)'}</h3>
          <div className="form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="med-qty">{editingId ? 'Total quantity' : 'Quantity to add'}</label>
              <input id="med-qty" className="form-input" type="number" min="0" value={formData.initialQuantity} onChange={e => setField('initialQuantity', parseInt(e.target.value) || 0)} placeholder="For example, 100" />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="med-mrp">MRP per unit (₹)</label>
              <input id="med-mrp" className="form-input" type="number" min="0" step="0.01" value={formData.perUnitPrice} onChange={e => setField('perUnitPrice', parseFloat(e.target.value) || 0)} placeholder="For example, 5.50" />
            </div>
          </div>
          {editingId && <p className="form-hint" style={{ marginTop: -6 }}>A changed quantity or MRP is applied to the latest batch only.</p>}
        </form>
      </Modal>
    </>
  );
}
