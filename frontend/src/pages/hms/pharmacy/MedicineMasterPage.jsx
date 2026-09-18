import { useState, useEffect } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function MedicineMasterPage() {
  const [medicines, setMedicines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    genericName: '', brandNames: [], category: 'Analgesic',
    formulation: 'Tablet', strength: '', strengthUnit: 'mg',
    unitOfSale: 'Strip', hsnCode: '', gstRate: 0, isControlled: false,
    initialQuantity: 0, perUnitPrice: 0
  });
  const [brandInput, setBrandInput] = useState('');
  const [rxNavSuggestions, setRxNavSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const categories = ['Analgesic', 'Antibiotic', 'Antacid', 'Antidiabetic', 'IV Fluid', 'Vitamins', 'Other'];
  const formulations = ['Tablet', 'Capsule', 'Injection', 'Syrup', 'Ointment', 'Drops', 'Other'];
  const strengthUnits = ['mg', 'ml', 'g', 'mcg', 'IU', '%'];
  const unitsOfSale = ['Strip', 'Bottle', 'Vial', 'Tube', 'Box'];

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
      const res = await api.get(`/medicines?search=${debouncedSearch}`);
      setMedicines(res.data.data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load medicines.');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (med) => {
    setEditingId(med.id);
    setFormData({
      genericName: med.genericName,
      brandNames: typeof med.brandNames === 'string' ? JSON.parse(med.brandNames) : (med.brandNames || []),
      category: med.category || 'Other',
      formulation: med.formulation || 'Tablet',
      strength: med.strength || '',
      strengthUnit: med.strengthUnit || 'mg',
      unitOfSale: med.unitOfSale || 'Strip',
      hsnCode: med.hsnCode || '',
      gstRate: med.gstRate || 0,
      isControlled: med.isControlled === 1,
      initialQuantity: med.totalStock || 0,
      perUnitPrice: med.mrp || 0,
    });
    setBrandInput('');
    setIsModalOpen(true);
  };

  const handleToggleActive = async (id) => {
    try {
      await api.patch(`/medicines/${id}/toggle`);
      toast.success('Medicine status updated.');
      fetchMedicines();
    } catch (err) {
      toast.error('Failed to update status.');
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
      const payload = { ...formData, brandNames: formData.brandNames };
      if (editingId) {
        await api.put(`/medicines/${editingId}`, payload);
        toast.success('Medicine updated successfully.');
      } else {
        await api.post('/medicines', payload);
        toast.success('Medicine created successfully.');
      }
      setIsModalOpen(false);
      fetchMedicines();
    } catch (err) {
      console.error(err);
      let errMsg = err.response?.data?.message || err.response?.data?.error || 'Failed to save medicine.';
      if (err.response?.data?.errors) {
        errMsg = err.response.data.errors.map(e => e.msg).join(', ');
      }
      toast.error(errMsg);
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        {/* Page Header */}
        <div className="hms-page-header" style={{ marginBottom: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(13,148,136,0.1)', borderColor: 'rgba(13,148,136,0.2)' }}>💊</span>
              Medicine Master
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Central repository for clinical medicines, formulations, and real-time inventory levels.
            </p>
          </div>
          <button 
            className="btn btn-primary" 
            onClick={openForm}
            style={{ 
              fontWeight: 700, padding: '12px 28px', borderRadius: 14, 
              display: 'flex', alignItems: 'center', gap: 10, 
              background: 'linear-gradient(135deg, #0d9488, #0f766e)', border: 'none',
              boxShadow: '0 4px 14px rgba(13,148,136,0.3)' 
            }}
          >
            <span>+</span> Add New Medicine
          </button>
        </div>

        {/* Search Bar - Premium Style */}
        <div className="hms-anim-1" style={{ marginBottom: 24 }}>
          <div className="card" style={{ 
            padding: '12px 24px', 
            borderRadius: 40,
            boxShadow: 'var(--shadow-md)',
            border: '2.5px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            transition: 'all 0.3s ease',
          }}
          onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--green)'}
          onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '1.4rem', opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              className="form-input"
              style={{ 
                fontSize: '1.1rem', 
                border: 'none', 
                boxShadow: 'none', 
                background: 'transparent',
                padding: '4px 0',
                flex: 1,
              }}
              placeholder="Search by Generic Name, Brand, or Category..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {loading && <div className="spinner" style={{ width: 20, height: 20 }} />}
          </div>
        </div>

        {/* Results Table */}
        <div className="card hms-anim-2" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)', borderRadius: 16 }}>
          <div className="table-wrapper" style={{ border: 'none' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)' }}>
                  <th style={{ ...thS, paddingLeft: 24 }}>MEDICINE IDENTITY</th>
                  <th style={thS}>BRANDS</th>
                  <th style={thS}>FORM / STRENGTH</th>
                  <th style={thS}>CATEGORY</th>
                  <th style={{ ...thS, textAlign: 'right' }}>STOCK LEVEL</th>
                  <th style={{ ...thS, textAlign: 'right' }}>UNIT PRICE</th>
                  <th style={{ ...thS, textAlign: 'center', paddingRight: 24 }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {medicines.length === 0 && !loading ? (
                  <tr>
                    <td colSpan="7" style={{ padding: 80, textAlign: 'center' }}>
                      <div style={{ fontSize: '3.5rem', marginBottom: 16, opacity: 0.2 }}>💊</div>
                      <h3 style={{ color: 'var(--text-secondary)' }}>No medicines found</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Try adjusting your search or add a new entry.</p>
                    </td>
                  </tr>
                ) : (
                  medicines.map((med, i) => (
                    <tr key={med.id} style={{ 
                      borderBottom: '1px solid var(--border)', 
                      background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)',
                      opacity: med.isActive ? 1 : 0.6
                    }}>
                      <td style={{ ...tdS, paddingLeft: 24 }}>
                        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1rem' }}>{med.genericName}</div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)' }}>ID: {med.id}</span>
                          {med.isControlled === 1 && <span className="badge badge-red" style={{ fontSize: '0.6rem', padding: '1px 6px' }}>Rx</span>}
                        </div>
                      </td>
                      <td style={tdS}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220 }}>
                          {(typeof med.brandNames === 'string' ? JSON.parse(med.brandNames) : (med.brandNames || [])).slice(0, 3).map((b, idx) => (
                            <span key={idx} className="badge" style={{ background: 'rgba(13,148,136,0.06)', color: '#0d9488', fontSize: '0.72rem', border: '1px solid rgba(13,148,136,0.1)' }}>{b}</span>
                          ))}
                          {(typeof med.brandNames === 'string' ? JSON.parse(med.brandNames) : (med.brandNames || [])).length > 3 && 
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>+{(typeof med.brandNames === 'string' ? JSON.parse(med.brandNames) : (med.brandNames || [])).length - 3} more</span>
                          }
                        </div>
                      </td>
                      <td style={tdS}>
                        <div style={{ fontWeight: 700 }}>{med.formulation}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>{med.strength} {med.strengthUnit}</div>
                      </td>
                      <td style={tdS}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.8 }}>{med.category}</span>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right' }}>
                        <div style={{ 
                          display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end'
                        }}>
                          <div style={{ 
                            padding: '4px 12px', borderRadius: 8, 
                            background: (med.totalStock || 0) < 50 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                            color: (med.totalStock || 0) < 50 ? '#ef4444' : '#10b981',
                            fontWeight: 900, fontSize: '1rem'
                          }}>
                            {med.totalStock || 0}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>{med.unitOfSale}s</div>
                        </div>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right' }}>
                        <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '1rem' }}>₹{(med.mrp || 0).toFixed(2)}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>per {med.unitOfSale}</div>
                      </td>
                      <td style={{ ...tdS, textAlign: 'center', paddingRight: 24 }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-sm btn-outline" onClick={() => handleEdit(med)} style={{ fontWeight: 700, borderRadius: 10, padding: '6px 14px' }}>Edit</button>
                          <button 
                            className="btn btn-sm" 
                            onClick={() => handleToggleActive(med.id)}
                            style={{ 
                              borderRadius: 10, padding: '6px 14px', fontWeight: 700,
                              background: med.isActive ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                              color: med.isActive ? '#ef4444' : '#10b981',
                              border: 'none'
                            }}
                          >
                            {med.isActive ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

    {isModalOpen && (
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
        onClick={() => setIsModalOpen(false)}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            borderRadius: 16, overflow: 'hidden',
            background: 'var(--surface-1, #fff)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          }}
        >
          <div style={{
            padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 14,
            background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 100%)',
            color: '#fff', flexShrink: 0,
          }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem' }}>
              {editingId ? '✏️' : '💊'}
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>{editingId ? 'Edit Medicine' : 'Add New Medicine'}</h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.8rem', opacity: 0.85 }}>{editingId ? 'Update details for this medicine entry.' : 'Fill in the details to register a new medicine in inventory.'}</p>
            </div>
            <button type="button" onClick={() => setIsModalOpen(false)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 32, height: 32, borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>✕</button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 16px' }}>

              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(13,148,136,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>🧬</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#0d9488' }}>Medicine Identity</span>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Generic Name <span style={{ color: '#ef4444' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <input required type="text" value={formData.genericName} onChange={e => setFormData({ ...formData, genericName: e.target.value })} placeholder="e.g. Aspirin, Metformin..." className="form-input" style={{ paddingLeft: 38 }} />
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: '0.95rem', pointerEvents: 'none' }}>🔍</span>
                    {(suggestionsLoading || rxNavSuggestions.length > 0) && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 20, background: '#fff', border: '1.5px solid #0d9488', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.15)', maxHeight: 200, overflowY: 'auto' }}>
                        {suggestionsLoading && <div style={{ padding: '14px 16px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Searching RxNav...</div>}
                        {!suggestionsLoading && rxNavSuggestions.map((s) => (
                          <button key={`${s.rxnormId || s.name}-${s.rxnormTty || 'na'}`} type="button" onClick={() => applySuggestion(s)} style={{ width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #eee', background: 'transparent', cursor: 'pointer' }}>
                            <div style={{ fontWeight: 600 }}>{s.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{s.rxnormTty || 'RxNorm'}{s.synonym ? ` • ${s.synonym}` : ''}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 5, fontSize: '0.74rem', color: 'var(--text-muted)' }}>💡 Type 2+ characters to get RxNav suggestions</div>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Brand Names <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>(press Enter to add)</span></label>
                  {formData.brandNames.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                      {formData.brandNames.map(b => (
                        <span key={b} style={{ background: 'linear-gradient(135deg, #0d9488, #0f766e)', color: '#fff', padding: '5px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {b} <span onClick={() => removeBrand(b)} style={{ cursor: 'pointer', width: 18, height: 18, borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>✕</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <input type="text" value={brandInput} onChange={e => setBrandInput(e.target.value)} onKeyDown={addBrand} placeholder="Type a brand name and press Enter..." className="form-input" />
                </div>
              </div>

              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(99,102,241,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>📋</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6366f1' }}>Classification & Form</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Category</label>
                    <select className="form-input" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Formulation <span style={{ color: '#ef4444' }}>*</span></label>
                    <select className="form-input" required value={formData.formulation} onChange={e => setFormData({ ...formData, formulation: e.target.value })}>{formulations.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(245,158,11,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>⚖️</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#d97706' }}>Dosage & Packaging</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Strength</label>
                    <input className="form-input" type="text" value={formData.strength} onChange={e => setFormData({ ...formData, strength: e.target.value })} placeholder="e.g. 500" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Unit</label>
                    <select className="form-input" value={formData.strengthUnit} onChange={e => setFormData({ ...formData, strengthUnit: e.target.value })}>{strengthUnits.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Sale Unit</label>
                    <select className="form-input" value={formData.unitOfSale} onChange={e => setFormData({ ...formData, unitOfSale: e.target.value })}>{unitsOfSale.map(c => <option key={c} value={c}>{c}</option>)}</select>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(239,68,68,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>🏷️</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#dc2626' }}>Tax & Compliance</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>HSN Code</label>
                    <input className="form-input" type="text" value={formData.hsnCode} onChange={e => setFormData({ ...formData, hsnCode: e.target.value })} placeholder="e.g. 30049099" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>GST Rate (%)</label>
                    <input className="form-input" type="number" step="0.01" value={formData.gstRate} onChange={e => setFormData({ ...formData, gstRate: parseFloat(e.target.value) || 0 })} placeholder="e.g. 12" />
                  </div>
                </div>
                <label htmlFor="isControlled" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, cursor: 'pointer', border: `1.5px solid ${formData.isControlled ? 'rgba(239,68,68,0.4)' : 'var(--border, #e2e8f0)'}`, background: formData.isControlled ? 'rgba(239,68,68,0.05)' : 'transparent', transition: 'all 0.2s' }}>
                  <div style={{ width: 40, height: 22, borderRadius: 12, position: 'relative', background: formData.isControlled ? '#ef4444' : 'var(--border, #cbd5e1)', transition: 'background 0.25s', flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: formData.isControlled ? 20 : 2, transition: 'left 0.25s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                  <input type="checkbox" id="isControlled" checked={formData.isControlled} onChange={e => setFormData({ ...formData, isControlled: e.target.checked })} style={{ display: 'none' }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: formData.isControlled ? '#dc2626' : 'var(--text-primary)' }}>Controlled Substance (Rx)</div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 1 }}>Mark if this medicine requires a prescription to dispense</div>
                  </div>
                </label>
              </div>

              <div style={{ marginBottom: 22, marginTop: 10, padding: '16px', borderRadius: '12px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 6, background: 'rgba(16, 185, 129, 0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem' }}>📦</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#10b981' }}>{editingId ? 'Update Inventory & Pricing' : 'Initial Inventory (Optional)'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>{editingId ? 'Total Quantity' : 'Quantity to Add'}</label>
                    <input className="form-input" type="number" min="0" value={formData.initialQuantity} onChange={e => setFormData({ ...formData, initialQuantity: parseInt(e.target.value) || 0 })} placeholder="e.g. 100" />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 5, fontSize: '0.82rem', fontWeight: 600 }}>Per Unit Price (MRP) ₹</label>
                    <input className="form-input" type="number" min="0" step="0.01" value={formData.perUnitPrice} onChange={e => setFormData({ ...formData, perUnitPrice: parseFloat(e.target.value) || 0 })} placeholder="e.g. 5.50" />
                  </div>
                </div>
              </div>

            </div>

            <div style={{ padding: '16px 28px', borderTop: '1px solid var(--border, #e2e8f0)', background: 'var(--surface-2, #f8fafc)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
              <button type="button" onClick={() => setIsModalOpen(false)} className="btn btn-ghost" style={{ minWidth: 100 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" style={{ minWidth: 160, background: 'linear-gradient(135deg, #0d9488, #0f766e)', border: 'none' }}>
                {editingId ? '💾 Update Medicine' : '💊 Save Medicine'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )}
    </>
  );
}

const thS = {
  padding: '14px 20px', textAlign: 'left', color: 'var(--text-muted)', 
  fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
  fontWeight: 700
};

const tdS = {
  padding: '16px 20px', verticalAlign: 'middle'
};