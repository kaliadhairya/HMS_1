import { useState, useEffect, useMemo } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function AdminBedManagementPage() {
  const [wards, setWards] = useState([]);
  const [activeWard, setActiveWard] = useState(null);
  const [beds, setBeds] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showAddWard, setShowAddWard] = useState(false);
  const [showAddBeds, setShowAddBeds] = useState(false);

  const fetchWards = async () => {
    try {
      const res = await api.get('/ipd/wards');
      const data = res.data.data || [];
      setWards(data);
      if (data.length > 0 && !activeWard) setActiveWard(data[0].id || data[0].ID);
    } catch (err) { toast.error('Failed to load wards'); }
  };

  const fetchBeds = async (wardId) => {
    setLoading(true);
    try {
      const res = await api.get(`/ipd/beds?ward_id=${wardId}`);
      setBeds(res.data.data || []);
    } catch (err) { toast.error('Failed to load beds'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchWards(); }, []);
  useEffect(() => { if (activeWard) fetchBeds(activeWard); }, [activeWard]);

  const toggleWard = async (ward) => {
    try {
      await api.patch(`/ipd/wards/${ward.ID}/toggle`);
      toast.success(`Ward ${ward.IS_ACTIVE ? 'disabled' : 'enabled'}`);
      fetchWards();
    } catch (err) { toast.error('Failed to toggle ward'); }
  };

  const toggleBed = async (bed) => {
    try {
      await api.patch(`/ipd/beds/${bed.ID}/toggle`);
      toast.success(`Bed ${bed.IS_ACTIVE ? 'disabled' : 'enabled'}`);
      fetchBeds(activeWard);
    } catch (err) { toast.error('Failed to toggle bed'); }
  };

  // Group beds by room
  const roomsMap = useMemo(() => {
    const map = {};
    beds.forEach(b => {
      const r = b.ROOM_NUMBER || 'Unknown';
      if (!map[r]) map[r] = [];
      map[r].push(b);
    });
    return map;
  }, [beds]);
  const roomKeys = Object.keys(roomsMap).sort();
  const activeWardObj = wards.find(w => (w.id || w.ID) === activeWard);

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>

        {/* Header */}
        <div className="hms-page-header" style={{ marginBottom: 24 }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.25)' }}>⚙️</span>
              Admin Bed Management
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Configure hospital wards, rooms, and beds layout.
            </p>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={() => setShowAddWard(true)}>+ Add Ward</button>
            <button className="btn btn-outline" onClick={() => setShowAddBeds(true)} disabled={!activeWard}>+ Add Beds</button>
            <button className="btn btn-ghost" onClick={() => fetchBeds(activeWard)}>↻ Refresh</button>
          </div>
        </div>

        {/* Wards Grid */}
        <div className="hms-anim-1" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 24
        }}>
          {wards.map(w => {
            const isActiveTab = (w.id || w.ID) === activeWard;
            const isWardActive = w.IS_ACTIVE === 1;
            return (
              <div key={w.ID} className="card" style={{
                padding: '16px 20px', cursor: 'pointer',
                border: isActiveTab ? '2px solid #3b82f6' : '1px solid var(--border)',
                background: isWardActive ? (isActiveTab ? '#eff6ff' : '#ffffff') : 'transparent',
                opacity: isWardActive ? 1 : 0.5,
                boxShadow: isWardActive ? '0 4px 12px rgba(0,0,0,0.05)' : 'none',
                transition: 'all 0.2s',
              }} onClick={() => setActiveWard(w.id || w.ID)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: isWardActive ? '#0f172a' : 'var(--text-muted)' }}>{w.NAME}</h3>
                    <div style={{ fontSize: '0.75rem', color: isWardActive ? '#64748b' : 'var(--text-muted)', marginTop: 4 }}>
                      {w.FLOOR} • {w.TYPE} • {w.TOTAL_BEDS} Beds
                    </div>
                  </div>
                  <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); toggleWard(w); }}
                    style={{
                      background: isWardActive ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                      color: isWardActive ? '#ef4444' : '#10b981',
                      border: 'none', padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600
                    }}>
                    {isWardActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Room Floor Plan Grid */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
            <div className="spinner" style={{ width: 36, height: 36 }} />
          </div>
        ) : (
          <div className="hms-anim-2" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 20,
            marginBottom: 24,
          }}>
            {roomKeys.map((roomKey, rIdx) => {
              const roomBeds = roomsMap[roomKey];
              const isWardActive = activeWardObj?.IS_ACTIVE === 1;

              return (
                <div key={roomKey} className="card" style={{ padding: 0, overflow: 'hidden', opacity: isWardActive ? 1 : 0.5 }}>
                  <div style={{
                    padding: '14px 20px',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Room {roomKey}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{roomBeds.length} beds</div>
                  </div>

                  <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                    {roomBeds.map(bed => {
                      const isOcc = bed.STATUS === 'Occupied';
                      const isBedActive = bed.IS_ACTIVE === 1;

                      return (
                        <div key={bed.ID} style={{
                          padding: '12px 10px', borderRadius: 12,
                          background: isOcc ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.04)',
                          border: `1.5px solid ${isOcc ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.15)'}`,
                          textAlign: 'center', minHeight: 90, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 4,
                          opacity: isBedActive ? 1 : 0.4,
                        }}>
                          <div style={{ fontSize: '1.4rem', lineHeight: 1 }}>{isOcc ? '🛌' : '🛏️'}</div>
                          <div style={{ fontWeight: 700, fontSize: '0.72rem', color: isOcc ? '#ef4444' : '#10b981' }}>{bed.BED_NUMBER}</div>
                          {isOcc ? (
                            <div style={{ fontSize: '0.65rem', fontWeight: 600 }}>{bed.PATIENT_NAME}</div>
                          ) : (
                            <div style={{ fontSize: '0.62rem', fontWeight: 500, color: '#10b981' }}>Available</div>
                          )}
                          <button className="btn btn-sm" onClick={() => toggleBed(bed)}
                            style={{
                              marginTop: 4, background: 'var(--surface-2)', color: 'var(--text-primary)',
                              border: '1px solid var(--border)', padding: '2px 8px', fontSize: '0.65rem'
                            }}>
                            {isBedActive ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Ward Modal */}
      {showAddWard && (
        <AddWardModal onClose={() => setShowAddWard(false)} onSuccess={() => { setShowAddWard(false); fetchWards(); }} />
      )}
      {/* Add Beds Modal */}
      {showAddBeds && activeWardObj && (
        <AddBedsModal ward={activeWardObj} onClose={() => setShowAddBeds(false)} onSuccess={() => { setShowAddBeds(false); fetchWards(); fetchBeds(activeWard); }} />
      )}
    </>
  );
}

function AddWardModal({ onClose, onSuccess }) {
  const [formData, setFormData] = useState({ name: '', type: 'General', floor: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/ipd/wards', formData);
      toast.success('Ward added successfully');
      onSuccess();
    } catch (err) { toast.error('Failed to add ward'); }
    finally { setLoading(false); }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: '8px',
    border: '1px solid #e2e8f0', background: '#f8fafc',
    color: '#1e293b', fontSize: '0.95rem',
    transition: 'all 0.2s ease', outline: 'none',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
  };
  const labelStyle = {
    display: 'block', marginBottom: '6px', fontSize: '0.85rem',
    fontWeight: 600, color: '#475569', letterSpacing: '0.02em'
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content slide-down" style={{ 
        width: 440, maxWidth: '90vw', background: '#ffffff', 
        borderRadius: '16px', padding: 0, overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)'
      }}>
        {/* Modal Header */}
        <div style={{ 
          background: 'linear-gradient(135deg, #f0fdf4, #ffffff)',
          padding: '20px 24px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 36, height: 36, borderRadius: '10px', background: '#3b82f6', 
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
              boxShadow: '0 4px 10px rgba(59,130,246,0.2)'
            }}>🏥</div>
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>Add New Ward</h3>
          </div>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer',
            color: '#94a3b8', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '8px', transition: 'all 0.2s'
          }} onMouseEnter={e => {e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'}} onMouseLeave={e => {e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'}}>×</button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <label style={labelStyle}>Ward Name <span style={{color:'#ef4444'}}>*</span></label>
            <input style={inputStyle} required placeholder="e.g. ICU Wing A" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} 
              onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Ward Type</label>
              <select style={{...inputStyle, cursor: 'pointer'}} value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}
                onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
              >
                <option>General</option>
                <option>Private</option>
                <option>Critical Care</option>
                <option>Maternity</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Floor <span style={{color:'#ef4444'}}>*</span></label>
              <input style={inputStyle} required placeholder="e.g. 2nd Floor" value={formData.floor} onChange={e => setFormData({ ...formData, floor: e.target.value })} 
                onFocus={e => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #cbd5e1',
              color: '#334155', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
            }} onMouseEnter={e => {e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#94a3b8'}} onMouseLeave={e => {e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{
              padding: '10px 24px', borderRadius: '8px', background: '#3b82f6', border: 'none',
              color: '#fff', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(59,130,246,0.3)', opacity: loading ? 0.7 : 1
            }} onMouseEnter={e => !loading && (e.currentTarget.style.transform = 'translateY(-1px)', e.currentTarget.style.boxShadow = '0 6px 16px rgba(59,130,246,0.4)')} onMouseLeave={e => !loading && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 4px 12px rgba(59,130,246,0.3)')}>
              {loading ? 'Creating...' : 'Create Ward'}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15,23,42,0.6); z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(8px);
          animation: hmsFadeIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}

function AddBedsModal({ ward, onClose, onSuccess }) {
  const [formData, setFormData] = useState({ roomNumber: '', bedPrefix: '', count: 1 });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/ipd/beds', { ...formData, wardId: ward.ID });
      toast.success('Beds added successfully');
      onSuccess();
    } catch (err) { toast.error('Failed to add beds'); }
    finally { setLoading(false); }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: '8px',
    border: '1px solid #e2e8f0', background: '#f8fafc',
    color: '#1e293b', fontSize: '0.95rem',
    transition: 'all 0.2s ease', outline: 'none',
    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
  };
  const labelStyle = {
    display: 'block', marginBottom: '6px', fontSize: '0.85rem',
    fontWeight: 600, color: '#475569', letterSpacing: '0.02em'
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content slide-down" style={{ 
        width: 440, maxWidth: '90vw', background: '#ffffff', 
        borderRadius: '16px', padding: 0, overflow: 'hidden',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)'
      }}>
        {/* Modal Header */}
        <div style={{ 
          background: 'linear-gradient(135deg, #f0fdf4, #ffffff)',
          padding: '20px 24px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              width: 36, height: 36, borderRadius: '10px', background: '#10b981', 
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
              boxShadow: '0 4px 10px rgba(16,185,129,0.2)'
            }}>🛏️</div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>Add Beds</h3>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2, fontWeight: 500 }}>{ward.NAME}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer',
            color: '#94a3b8', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '8px', transition: 'all 0.2s'
          }} onMouseEnter={e => {e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'}} onMouseLeave={e => {e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94a3b8'}}>×</button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <label style={labelStyle}>Room No. <span style={{color:'#ef4444'}}>*</span></label>
              <input style={inputStyle} required placeholder="e.g. G-01" value={formData.roomNumber} onChange={e => setFormData({ ...formData, roomNumber: e.target.value })} 
                onFocus={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
              />
            </div>
            <div>
              <label style={labelStyle}>Bed Prefix <span style={{color:'#ef4444'}}>*</span></label>
              <input style={inputStyle} required placeholder="e.g. GW" value={formData.bedPrefix} onChange={e => setFormData({ ...formData, bedPrefix: e.target.value })} 
                onFocus={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
              />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Number of Beds <span style={{color:'#ef4444'}}>*</span></label>
            <input type="number" style={inputStyle} required min="1" max="20" value={formData.count} onChange={e => setFormData({ ...formData, count: Number(e.target.value) })} 
              onFocus={e => { e.currentTarget.style.borderColor = '#10b981'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.15)'; e.currentTarget.style.background = '#ffffff'; }}
              onBlur={e => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.02)'; e.currentTarget.style.background = '#f8fafc'; }}
            />
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{color:'#10b981'}}>ℹ️</span> Beds will be auto-numbered (e.g. {formData.bedPrefix || 'PREFIX'}-01, {formData.bedPrefix || 'PREFIX'}-02)
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #cbd5e1',
              color: '#334155', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
            }} onMouseEnter={e => {e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.borderColor = '#94a3b8'}} onMouseLeave={e => {e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'}}>Cancel</button>
            <button type="submit" disabled={loading} style={{
              padding: '10px 24px', borderRadius: '8px', background: '#10b981', border: 'none',
              color: '#fff', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(16,185,129,0.3)', opacity: loading ? 0.7 : 1
            }} onMouseEnter={e => !loading && (e.currentTarget.style.transform = 'translateY(-1px)', e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,185,129,0.4)')} onMouseLeave={e => !loading && (e.currentTarget.style.transform = 'none', e.currentTarget.style.boxShadow = '0 4px 12px rgba(16,185,129,0.3)')}>
              {loading ? 'Adding...' : `Add ${formData.count} Beds`}
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15,23,42,0.6); z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          backdrop-filter: blur(8px);
          animation: hmsFadeIn 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}
