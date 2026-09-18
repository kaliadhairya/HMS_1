import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function IPDBillingPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState(null);
  const [charges, setCharges] = useState([]);
  const [wardInfo, setWardInfo] = useState({});
  const [medicineTotal, setMedicineTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
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
    } catch { toast.error('Failed to load admission'); }
  }, [admissionId]);

  const fetchCharges = useCallback(async () => {
    try {
      const res = await api.get(`/ipd/admissions/${admissionId}/charges`);
      const d = res.data.data;
      setCharges(d.charges || []);
      setWardInfo(d.wardInfo || {});
      setMedicineTotal(d.medicineTotal || 0);
      setGrandTotal(d.grandTotal || 0);
    } catch { toast.error('Failed to load charges'); }
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
    } catch { toast.error('Failed to add'); }
  };

  const updateQty = async (charge, newQty) => {
    if (newQty < 1) return;
    try {
      await api.patch(`/ipd/admissions/${admissionId}/charges/${charge.ID}`, { quantity: newQty });
      fetchCharges();
    } catch { toast.error('Failed to update'); }
  };

  const removeCharge = async (charge) => {
    try {
      await api.delete(`/ipd/admissions/${admissionId}/charges/${charge.ID}`);
      toast.success('Removed');
      fetchCharges();
    } catch { toast.error('Failed to remove'); }
  };

  const generateBill = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/ipd/admissions/${admissionId}/generate-bill`);
      toast.success(`Bill generated: ${res.data.data.billNumber}`);
      setGeneratedBill(res.data.data);
      setPreviewMode(true);
    } catch (err) { toast.error(err.response?.data?.message || 'Failed to generate bill'); }
    finally { setGenerating(false); }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (<><Navbar /><div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><div className="spinner" style={{ width: 36, height: 36 }} /></div></>);
  }

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: '8px',
    border: '1px solid #e2e8f0', background: '#f8fafc',
    color: '#1e293b', fontSize: '0.95rem', transition: 'all 0.2s ease', outline: 'none',
  };

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
        <div className="container py-4" style={{ maxWidth: '100%' }}>

        {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="header-icon" style={{ background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.25)' }}>💰</span>
                IPD Billing
              </h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
                <span>Patient Checkout</span>
                <span style={{ opacity: 0.5 }}>•</span>
                <span>Encounter ID: {admission?.ADMISSION_ID_FORMATTED}</span>
              </div>
            </div>
            <div className="header-actions">
              <button className="btn btn-ghost" onClick={() => navigate('/ipd/billing')} style={{ borderRadius: 10, border: '1px solid var(--border)' }}>
                ← Back to List
              </button>
            </div>
          </div>

        {/* Patient Profile Banner */}
        <div className="card hms-anim-1" style={{
          padding: '24px 32px', marginBottom: 32,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-md)',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Accent decoration */}
          <div style={{ position: 'absolute', top: 0, left: 0, width: 6, height: '100%', background: 'var(--green)' }}></div>
          
          {/* Avatar Section */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{ 
              width: 80, height: 80, borderRadius: '50%', 
              background: 'linear-gradient(135deg, #f1f5f9, #e2e8f0)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '2.4rem', border: '3px solid #fff', boxShadow: '0 4px 10px rgba(0,0,0,0.05)'
            }}>
              {admission?.GENDER === 'Female' ? '👩' : '👨'}
            </div>
            <span className="badge badge-teal" style={{ fontSize: '0.65rem' }}>ACTIVE IPD</span>
          </div>

          {/* Name & Basic Info */}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '1.6rem', color: 'var(--text-primary)', fontWeight: 800 }}>{admission?.PATIENT_NAME}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginTop: 8, color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><strong>UHID:</strong> {admission?.UHID}</span>
              <span style={{ opacity: 0.3 }}>|</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><strong>Age/Sex:</strong> {admission?.AGE}Y / {admission?.GENDER?.[0]}</span>
            </div>
          </div>

          {/* Admission Details Grid */}
          <div style={{ 
            display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px 40px',
            background: 'var(--surface-2)', padding: '16px 24px', borderRadius: 12,
            border: '1px solid var(--border)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Location</span>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: 2 }}>
                {admission?.WARD_NAME} <span style={{ color: 'var(--green)', margin: '0 4px' }}>•</span> Bed {admission?.BED_NUMBER} ({admission?.ROOM_NUMBER})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Duration</span>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: 2 }}>{wardInfo.daysAdmitted || 0} Days <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.8rem' }}>(since {new Date(admission?.ADMISSION_DATE).toLocaleDateString()})</span></span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Consulting Doctor</span>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: 2 }}>{admission?.DOCTOR_NAME}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>Dept. / Type</span>
              <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginTop: 2 }}>{admission?.DEPARTMENT} <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span> {admission?.ADMISSION_TYPE}</span>
            </div>
          </div>
        </div>

        {/* Main Layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, alignItems: 'flex-start' }}>

          {/* LEFT: Medicine Selection */}
          <div>
            {/* Search */}
            <div className="card hms-anim-2" style={{ padding: '20px 24px', marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.1rem' }}>💊</span> Add Medicines / Consumables
              </h3>
              <div style={{ position: 'relative' }}>
                <input
                  style={inputStyle}
                  placeholder="Search medicines by name..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  onFocus={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.15)'; e.currentTarget.style.background = '#fff'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = '#f8fafc'; }}
                />
                {searching && <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}><div className="spinner" style={{ width: 18, height: 18 }} /></div>}
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div style={{
                  marginTop: 8, border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
                  maxHeight: 280, overflowY: 'auto', background: '#fff',
                }}>
                  {searchResults.map(med => (
                    <div key={med.id} style={{
                      padding: '12px 16px', borderBottom: '1px solid #f1f5f9',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#0f172a' }}>{med.genericName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                          {med.formulation}{med.strength ? ` • ${med.strength}${med.strengthUnit || ''}` : ''}{med.unitOfSale ? ` • ${med.unitOfSale}` : ''}
                        </div>
                      </div>

                      {addingId === med.id ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input type="number" min="1" max="99" value={addQty}
                            onChange={e => setAddQty(Number(e.target.value))}
                            style={{ width: 60, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', textAlign: 'center', fontSize: '0.88rem', outline: 'none' }}
                          />
                          <button onClick={() => addCharge(med)} style={{
                            padding: '6px 14px', borderRadius: 6, background: '#10b981', border: 'none',
                            color: '#fff', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                          }}>Add</button>
                          <button onClick={() => { setAddingId(null); setAddQty(1); }} style={{
                            padding: '6px 10px', borderRadius: 6, background: '#f1f5f9', border: '1px solid #e2e8f0',
                            color: '#64748b', fontSize: '0.8rem', cursor: 'pointer',
                          }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={() => setAddingId(med.id)} style={{
                          padding: '6px 14px', borderRadius: 6, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                          color: '#10b981', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#10b981'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16,185,129,0.1)'; e.currentTarget.style.color = '#10b981'; }}
                        >+ Select</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Charges Table */}
            <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '16px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>📋 Added Items ({charges.length})</h3>
              </div>

              {charges.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2rem', marginBottom: 8 }}>💊</div>
                  No medicines added yet. Use the search above to add items.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--surface-2)' }}>
                        <th style={thStyle}>#</th>
                        <th style={{...thStyle, textAlign: 'left'}}>Medicine</th>
                        <th style={thStyle}>Qty</th>
                        <th style={thStyle}>Unit Price (₹)</th>
                        <th style={thStyle}>Total (₹)</th>
                        <th style={thStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.map((c, i) => (
                        <tr key={c.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={tdStyle}>{i + 1}</td>
                          <td style={{...tdStyle, textAlign: 'left'}}>
                            <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{c.MEDICINE_NAME}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {c.FORMULATION}{c.STRENGTH ? ` • ${c.STRENGTH}` : ''}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <button onClick={() => updateQty(c, c.QUANTITY - 1)} style={qtyBtnStyle} disabled={c.QUANTITY <= 1}>−</button>
                              <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>{c.QUANTITY}</span>
                              <button onClick={() => updateQty(c, c.QUANTITY + 1)} style={qtyBtnStyle}>+</button>
                            </div>
                          </td>
                          <td style={tdStyle}>₹{(c.UNIT_PRICE || 0).toFixed(2)}</td>
                          <td style={{...tdStyle, fontWeight: 700, color: '#0f172a'}}>₹{(c.TOTAL_PRICE || 0).toFixed(2)}</td>
                          <td style={tdStyle}>
                            <button onClick={() => removeCharge(c)} style={{
                              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                              color: '#ef4444', padding: '4px 10px', borderRadius: 6, fontSize: '0.72rem',
                              fontWeight: 600, cursor: 'pointer',
                            }}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Bill Summary */}
          <div className="hms-anim-2" style={{ position: 'sticky', top: 90 }}>
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '2px solid var(--border)' }}>
              <div style={{
                padding: '18px 24px',
                background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
                color: '#fff',
              }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>🧾 Bill Summary</h3>
                <div style={{ fontSize: '0.78rem', opacity: 0.7, marginTop: 4 }}>{admission?.PATIENT_NAME || 'Patient'}</div>
              </div>

              <div style={{ padding: '20px 24px' }}>
                {/* Ward Charges */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 700 }}>Ward Charges</div>
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, background: 'rgba(59,130,246,0.04)',
                    border: '1px solid rgba(59,130,246,0.1)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{wardInfo.wardName || 'Ward'}</span>
                      <span style={{ fontWeight: 600 }}>₹{wardInfo.wardRate || 0}/day</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: 6 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Duration</span>
                      <span style={{ fontWeight: 600 }}>{wardInfo.daysAdmitted || 1} day(s)</span>
                    </div>
                    <div style={{ borderTop: '1px dashed var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Ward Total</span>
                      <span style={{ fontWeight: 800, color: '#3b82f6', fontSize: '1.05rem' }}>₹{(wardInfo.wardTotal || 0).toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Medicine Charges */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 700 }}>Medicine / Consumables</div>
                  <div style={{
                    padding: '14px 16px', borderRadius: 10, background: 'rgba(16,185,129,0.04)',
                    border: '1px solid rgba(16,185,129,0.1)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Items</span>
                      <span style={{ fontWeight: 600 }}>{charges.length} item(s)</span>
                    </div>
                    <div style={{ borderTop: '1px dashed var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Medicine Total</span>
                      <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1.05rem' }}>₹{medicineTotal.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Grand Total */}
                <div style={{
                  padding: '16px 18px', borderRadius: 12,
                  background: 'linear-gradient(135deg, #0f172a, #1e3a5f)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: 20,
                }}>
                  <span style={{ fontWeight: 800, color: '#fff', fontSize: '1rem' }}>Grand Total</span>
                  <span style={{ fontWeight: 900, color: '#34d399', fontSize: '1.35rem' }}>₹{grandTotal.toFixed(2)}</span>
                </div>

                {/* Save Draft Button */}
                <button
                  onClick={() => {
                    toast.success('Billing progress saved as draft');
                    navigate('/ipd/saved-bills');
                  }}
                  style={{
                    width: '100%', padding: '12px 0', borderRadius: 10, border: '1px solid var(--border)',
                    background: '#fff', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem', 
                    cursor: 'pointer', marginBottom: 12, transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)', e.currentTarget.style.transform = 'translateY(-1px)')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff', e.currentTarget.style.transform = 'none')}
                >
                  💾 Save Progress
                </button>

                {/* Generate Bill Button */}
                <button
                  onClick={generateBill}
                  disabled={generating}
                  style={{
                    width: '100%', padding: '14px 0', borderRadius: 10, border: 'none',
                    background: generating ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: generating ? 'not-allowed' : 'pointer',
                    boxShadow: generating ? 'none' : '0 6px 20px rgba(16,185,129,0.3)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => !generating && (e.currentTarget.style.transform = 'translateY(-2px)', e.currentTarget.style.boxShadow = '0 8px 24px rgba(16,185,129,0.4)')}
                  onMouseLeave={e => !generating && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 6px 20px rgba(16,185,129,0.3)')}
                >
                  {generating ? 'Generating...' : '🧾 Generate IPD Bill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <div style={{ padding: '20px', background: '#f1f5f9', minHeight: '100vh' }}>
          <div className="no-print" style={{ display: 'flex', justifyContent: 'center', gap: '15px', marginBottom: '30px' }}>
            <button className="btn btn-secondary" onClick={() => navigate('/ipd/billing')}>← Back to Admissions</button>
            <button className="btn btn-primary" onClick={handlePrint} style={{ fontSize: '1.1rem', padding: '10px 24px' }}>🖨️ Print Bill</button>
          </div>
          
          <div className="print-section bill-preview-paper">
            {/* Header */}
            <div style={{ display: 'flex', position: 'relative', borderBottom: '2px solid #000', paddingBottom: 15, marginBottom: 20 }}>
              <img src="/logo.png" alt="HMS Logo" style={{ width: 90, height: 90, position: 'absolute', left: 0, top: 0, objectFit: 'contain' }} />
              <div style={{ flex: 1, textAlign: 'center', padding: '0 210px 0 100px' }}>
                <h2 style={{ margin: '0 0 5px', fontSize: '20px', fontWeight: 'bold' }}>अस्पताल प्रबंधन प्रणाली</h2>
                <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 'bold' }}>HOSPITAL MANAGEMENT SYSTEM</h2>
                <h3 style={{ margin: '0 0 5px', fontSize: '16px', textDecoration: 'underline', textTransform: 'uppercase' }}>
                  HOSPITAL BILL OF {admission?.WARD_TYPE === 'Maternity' ? 'MATERNITY' : 'IPD'} PATIENT
                </h3>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'normal' }}>अधिकृत / अनाधिकृत रोगियों का बिल</h4>
              </div>
              <div style={{ position: 'absolute', right: 0, top: 0, textAlign: 'right', fontSize: '12px', border: '1px solid #000', padding: '6px', background: '#fff', maxWidth: '200px' }}>
                <div style={{ marginBottom: 4 }}>Receipt No. : <strong style={{ marginLeft: 4 }}>{generatedBill?.billNumber}</strong></div>
                <div style={{ marginBottom: 4 }}>Final Bill Amt : <strong style={{ marginLeft: 4 }}>Rs {generatedBill?.totalAmount?.toFixed(2)}/-</strong></div>
                <div>Date : <strong style={{ marginLeft: 4 }}>{new Date().toLocaleDateString('en-IN')}</strong></div>
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
                <div style={{ flex: 1.2 }}>Dt. of Disch: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</strong></div>
                <div style={{ flex: 0.8 }}>Ward: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.WARD_NAME || admission?.WARD_TYPE || 'General'}</strong></div>
              </div>
              <div style={{ display: 'flex' }}>
                <div style={{ flex: 1 }}>Diagnosis: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{admission?.DIAGNOSIS || '__________________'}</strong></div>
              </div>
              <div style={{ display: 'flex', marginTop: 5 }}>
                <div style={{ flex: 1 }}>Routine admission: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>Yes</strong></div>
                <div style={{ flex: 1 }}>Duration: <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px' }}>{wardInfo?.daysAdmitted || 1} days</strong></div>
              </div>
            </div>

            {/* Charges Summary */}
            <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '15px 0', marginBottom: '25px', display: 'flex' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '60%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '15px' }}>
                      <span>Stay charges</span>
                      <span>{wardInfo?.wardTotal?.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: '15px' }}>
                      <span>Medicines</span>
                      <span>{generatedBill?.medicineTotal?.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #000', marginTop: '10px', paddingTop: '10px', fontWeight: 'bold', fontSize: '16px' }}>
                      <span>Total</span>
                      <span>{generatedBill?.totalAmount?.toFixed(2)}</span>
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
                    {charges.map((c, i) => (
                      <tr key={i}>
                        <td style={{ padding: '4px 0' }}>{c.MEDICINE_NAME} {c.STRENGTH}</td>
                        <td style={{ padding: '4px 0', textAlign: 'center' }}>- {c.QUANTITY} -</td>
                        <td style={{ padding: '4px 0', textAlign: 'right' }}>{c.TOTAL_PRICE?.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan="2" style={{ borderTop: '1px solid #000', textAlign: 'right', padding: '8px 10px 0 0', fontWeight: 'bold' }}>Total</td>
                      <td style={{ borderTop: '1px solid #000', textAlign: 'right', padding: '8px 0 0 0', fontWeight: 'bold' }}>{generatedBill?.medicineTotal?.toFixed(2)}</td>
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
                Approved for Rs. <strong style={{ borderBottom: '1px dotted #000', padding: '0 10px', fontSize: '18px' }}>{generatedBill?.totalAmount?.toFixed(2)} /-</strong><br/>
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

const thStyle = {
  padding: '10px 14px', fontSize: '0.72rem', fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em',
  textAlign: 'center', whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 14px', fontSize: '0.88rem', textAlign: 'center', whiteSpace: 'nowrap',
};

const qtyBtnStyle = {
  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)',
  background: 'var(--surface-2)', cursor: 'pointer', display: 'flex',
  alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700,
};
