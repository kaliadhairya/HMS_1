import { useState, useEffect, useMemo } from 'react';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';
import AdmissionModal from '../../../components/AdmissionModal';

export default function BedManagementPage() {
  const [wards, setWards] = useState([]);
  const [activeWard, setActiveWard] = useState(null);
  const [beds, setBeds] = useState([]);
  const [admittingBed, setAdmittingBed] = useState(null);
  const [hoveredBed, setHoveredBed] = useState(null);
  const [loading, setLoading] = useState(true);

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
  const totalBeds = beds.length;
  const avail = beds.filter(b => b.STATUS === 'Available').length;
  const occ = beds.filter(b => b.STATUS === 'Occupied').length;
  const occPct = totalBeds > 0 ? Math.round((occ / totalBeds) * 100) : 0;

  const wardColors = {
    'General': { accent: '#3b82f6', gradient: 'linear-gradient(135deg,#3b82f6,#60a5fa)' },
    'Semi-Private': { accent: '#8b5cf6', gradient: 'linear-gradient(135deg,#8b5cf6,#a78bfa)' },
    'Critical Care': { accent: '#ef4444', gradient: 'linear-gradient(135deg,#ef4444,#f87171)' },
  };
  const getWardStyle = (type) => wardColors[type] || wardColors['General'];

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>

        {/* ─── Page Header ─── */}
        <div className="hms-page-header" style={{ marginBottom: 24 }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.25)' }}>🏥</span>
              Bed Management Dashboard
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Visual floor plan — {roomKeys.length} rooms, {totalBeds} beds across {wards.length} wards
            </p>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => fetchBeds(activeWard)}>↻ Refresh</button>
          </div>
        </div>

        {/* ─── Ward Tabs ─── */}
        <div className="card hms-anim-1" style={{ padding: 0, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'stretch',
            borderBottom: '1px solid var(--border)',
          }}>
            {wards.map((w, i) => {
              const wId = w.id || w.ID;
              const isActive = wId === activeWard;
              const ws = getWardStyle(w.TYPE);
              return (
                <button key={wId} onClick={() => setActiveWard(wId)} style={{
                  flex: 1, padding: '18px 24px',
                  background: isActive ? `${ws.accent}08` : 'transparent',
                  border: 'none', borderBottom: isActive ? `3px solid ${ws.accent}` : '3px solid transparent',
                  cursor: 'pointer', transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center', gap: 14,
                  borderRight: i < wards.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: isActive ? ws.gradient : 'var(--surface-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.2rem', color: isActive ? '#fff' : 'var(--text-muted)',
                    transition: 'all 0.3s', flexShrink: 0,
                  }}>
                    {w.TYPE?.includes('Critical') ? '🚨' : w.TYPE?.includes('Semi') ? '🏨' : '🏥'}
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{
                      fontWeight: isActive ? 800 : 600, fontSize: '0.95rem',
                      color: isActive ? ws.accent : 'var(--text-primary)',
                    }}>{w.NAME}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {w.FLOOR} • {w.TYPE}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Summary Stats Bar */}
          <div style={{
            padding: '14px 28px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--surface-2)',
          }}>
            <div style={{ display: 'flex', gap: 24 }}>
              {[
                { label: 'Total Beds', val: totalBeds, color: '#3b82f6', icon: '🛏️' },
                { label: 'Available', val: avail, color: '#10b981', icon: '✅' },
                { label: 'Occupied', val: occ, color: '#ef4444', icon: '🔴' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: '1rem' }}>{s.icon}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>{s.label}:</span>
                  <span style={{ fontSize: '1rem', fontWeight: 800, color: s.color }}>{s.val}</span>
                </div>
              ))}
            </div>

            {/* Occupancy Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Occupancy</span>
              <div style={{
                width: 120, height: 8, borderRadius: 4,
                background: 'var(--border)', overflow: 'hidden',
              }}>
                <div style={{
                  width: `${occPct}%`, height: '100%', borderRadius: 4,
                  background: occPct > 80 ? '#ef4444' : occPct > 50 ? '#f59e0b' : '#10b981',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <span style={{
                fontSize: '0.85rem', fontWeight: 800,
                color: occPct > 80 ? '#ef4444' : occPct > 50 ? '#f59e0b' : '#10b981',
              }}>{occPct}%</span>
            </div>
          </div>
        </div>

        {/* ─── Room Floor Plan Grid ─── */}
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
              const roomOcc = roomBeds.filter(b => b.STATUS === 'Occupied').length;
              const roomAvail = roomBeds.length - roomOcc;
              const ws = getWardStyle(activeWardObj?.TYPE);

              return (
                <div key={roomKey} className="card" style={{
                  padding: 0, overflow: 'hidden',
                  animation: `hmsSlideUp 0.3s cubic-bezier(0.16,1,0.3,1) ${rIdx * 0.04}s both`,
                }}>
                  {/* Room Header */}
                  <div style={{
                    padding: '14px 20px',
                    background: 'var(--surface-2)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: ws.gradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 800, fontSize: '0.75rem',
                      }}>{rIdx + 1}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Room {roomKey}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{roomBeds.length} beds</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{
                        fontSize: '0.65rem', padding: '3px 10px', borderRadius: 20,
                        background: 'rgba(16,185,129,0.1)', color: '#10b981', fontWeight: 700,
                        border: '1px solid rgba(16,185,129,0.15)',
                      }}>{roomAvail} Free</span>
                      {roomOcc > 0 && <span style={{
                        fontSize: '0.65rem', padding: '3px 10px', borderRadius: 20,
                        background: 'rgba(239,68,68,0.1)', color: '#ef4444', fontWeight: 700,
                        border: '1px solid rgba(239,68,68,0.15)',
                      }}>{roomOcc} Occupied</span>}
                    </div>
                  </div>

                  {/* Beds — 3×2 Visual Grid */}
                  <div style={{
                    padding: '16px 20px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                  }}>
                    {roomBeds.map(bed => {
                      const isOcc = bed.STATUS === 'Occupied';
                      const isHovered = hoveredBed === bed.ID;

                      return (
                        <div
                          key={bed.ID}
                          onMouseEnter={() => setHoveredBed(bed.ID)}
                          onMouseLeave={() => setHoveredBed(null)}
                          onClick={() => !isOcc && setAdmittingBed(bed)}
                          style={{
                            position: 'relative',
                            padding: '12px 10px',
                            borderRadius: 12,
                            background: isOcc
                              ? 'rgba(239,68,68,0.06)'
                              : isHovered ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.04)',
                            border: `1.5px solid ${isOcc ? 'rgba(239,68,68,0.25)' : isHovered ? 'rgba(16,185,129,0.4)' : 'rgba(16,185,129,0.15)'}`,
                            cursor: isOcc ? 'default' : 'pointer',
                            transition: 'all 0.2s',
                            transform: isHovered && !isOcc ? 'translateY(-2px)' : 'none',
                            boxShadow: isHovered && !isOcc ? '0 4px 12px rgba(16,185,129,0.15)' : 'none',
                            textAlign: 'center',
                            minHeight: 80,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 4,
                          }}
                        >
                          {/* Bed Icon */}
                          <div style={{ fontSize: '1.4rem', lineHeight: 1 }}>
                            {isOcc ? '🛌' : '🛏️'}
                          </div>

                          {/* Bed Number */}
                          <div style={{
                            fontWeight: 700, fontSize: '0.72rem',
                            color: isOcc ? '#ef4444' : '#10b981',
                            letterSpacing: '0.02em',
                          }}>{bed.BED_NUMBER}</div>

                          {/* Patient Name or "Available" */}
                          {isOcc ? (
                            <div style={{
                              fontSize: '0.65rem', fontWeight: 600,
                              color: 'var(--text-primary)',
                              overflow: 'hidden', textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap', maxWidth: '100%',
                            }}>{bed.PATIENT_NAME}</div>
                          ) : (
                            <div style={{
                              fontSize: '0.62rem', fontWeight: 500,
                              color: '#10b981',
                            }}>Available</div>
                          )}

                          {/* Admission date for occupied */}
                          {isOcc && bed.ADMISSION_DATE && (
                            <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                              {new Date(bed.ADMISSION_DATE).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </div>
                          )}

                          {/* Status Dot */}
                          <div style={{
                            position: 'absolute', top: 6, right: 6,
                            width: 8, height: 8, borderRadius: '50%',
                            background: isOcc ? '#ef4444' : '#10b981',
                            boxShadow: `0 0 0 2px ${isOcc ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`,
                          }} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ─── Legend Footer ─── */}
        <div className="card hms-anim-3" style={{
          display: 'flex', justifyContent: 'center', gap: 40,
          padding: '16px 32px',
        }}>
          {[
            { color: '#10b981', label: 'Available', icon: '🛏️' },
            { color: '#ef4444', label: 'Occupied', icon: '🛌' },
            { color: '#f59e0b', label: 'Reserved', icon: '🔒' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 14, height: 14, borderRadius: 4,
                background: `${l.color}15`, border: `2px solid ${l.color}`,
              }} />
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{l.label}</span>
              <span style={{ fontSize: '0.9rem' }}>{l.icon}</span>
            </div>
          ))}
        </div>

      </div>

      {admittingBed && (
        <AdmissionModal
          bedId={admittingBed.ID}
          wardId={admittingBed.WARD_ID}
          bedNumber={admittingBed.BED_NUMBER}
          onClose={() => setAdmittingBed(null)}
          onSuccess={() => { setAdmittingBed(null); fetchBeds(activeWard); }}
        />
      )}
    </>
  );
}
