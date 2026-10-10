import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { BedDouble, RefreshCw, UserRound } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import AdmissionModal from '../../../components/AdmissionModal';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';

// Bed status -> status tone. Anything not listed falls back to neutral.
const BED_TONE = { Available: 'success', Occupied: 'info', Reserved: 'warning', Cleaning: 'warning', Maintenance: 'neutral' };
const TONE_VARS = {
  success: { bg: 'var(--success-light)', border: 'var(--success-border)', fg: 'var(--success)' },
  info: { bg: 'var(--primary-light)', border: 'var(--primary-border)', fg: 'var(--primary)' },
  warning: { bg: 'var(--amber-light)', border: 'var(--amber-border)', fg: 'var(--amber)' },
  neutral: { bg: 'var(--surface-2)', border: 'var(--border)', fg: 'var(--text-secondary)' },
};
const bedTone = (status) => BED_TONE[status] || 'neutral';
const occupancyColor = (pct) => (pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--amber)' : 'var(--success)');

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
      if (data.length === 0) setLoading(false);
    } catch (err) { toast.error('Could not load wards'); setLoading(false); }
  };

  const fetchBeds = async (wardId) => {
    setLoading(true);
    try {
      const res = await api.get(`/ipd/beds?ward_id=${wardId}`);
      setBeds(res.data.data || []);
    } catch (err) { toast.error('Could not load beds'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchWards(); }, []);
  useEffect(() => { if (activeWard) fetchBeds(activeWard); }, [activeWard]);

  // Group beds by room
  const roomsMap = useMemo(() => {
    const map = {};
    beds.forEach(b => {
      const r = b.ROOM_NUMBER || b.room_number || 'Unknown';
      if (!map[r]) map[r] = [];
      map[r].push(b);
    });
    return map;
  }, [beds]);
  const roomKeys = Object.keys(roomsMap).sort();

  const totalBeds = beds.length;
  const avail = beds.filter(b => (b.STATUS || b.status) === 'Available').length;
  const occ = beds.filter(b => (b.STATUS || b.status) === 'Occupied').length;
  const occPct = totalBeds > 0 ? Math.round((occ / totalBeds) * 100) : 0;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Bed management"
          description="Live bed board by ward. Select an available bed to admit a patient."
          meta={<span className="muted">{roomKeys.length} rooms · {totalBeds} beds in this ward · {wards.length} wards</span>}
          actions={(
            <button type="button" className="btn btn-secondary btn-md" onClick={() => fetchBeds(activeWard)} disabled={!activeWard}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          )}
        />

        {/* Ward tabs */}
        {wards.length > 0 && (
          <div className="tabs" role="tablist" aria-label="Wards">
            {wards.map(w => {
              const wId = w.id || w.ID;
              const isActive = wId === activeWard;
              return (
                <button
                  key={wId}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`tab${isActive ? ' is-active' : ''}`}
                  onClick={() => setActiveWard(wId)}
                >
                  {w.NAME}
                  <span className="cell-secondary" style={{ marginLeft: 6 }}>{[w.FLOOR, w.TYPE].filter(Boolean).join(' · ')}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Summary */}
        <div className="kpi-strip">
          <div className="panel kpi"><div className="kpi-label">Total beds</div><div className="kpi-value">{totalBeds}</div></div>
          <div className="panel kpi"><div className="kpi-label">Available</div><div className="kpi-value" style={{ color: 'var(--success)' }}>{avail}</div></div>
          <div className="panel kpi"><div className="kpi-label">Occupied</div><div className="kpi-value">{occ}</div></div>
          <div className="panel kpi">
            <div className="kpi-label">Occupancy</div>
            <div className="kpi-value" style={{ color: occupancyColor(occPct) }}>{occPct}%</div>
            <div className="bar-track" style={{ marginTop: 8 }}>
              <div className="bar-fill" style={{ width: `${occPct}%`, background: occupancyColor(occPct) }} />
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="chip-row" style={{ marginBottom: 12 }} aria-label="Bed status legend">
          <span className="status status-success">Available</span>
          <span className="status status-info">Occupied</span>
          <span className="status status-warning">Reserved</span>
        </div>

        {/* Room floor plan */}
        {loading ? (
          <section className="panel panel-pad"><p className="muted">Loading…</p></section>
        ) : roomKeys.length === 0 ? (
          <section className="panel">
            <EmptyState
              icon={BedDouble}
              title={wards.length === 0 ? 'No wards set up' : 'No beds in this ward'}
              description={wards.length === 0 ? 'An administrator can add wards and beds from admin bed management.' : 'Beds added to this ward appear here grouped by room.'}
            />
          </section>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {roomKeys.map((roomKey) => {
              const roomBeds = roomsMap[roomKey];
              const roomOcc = roomBeds.filter(b => (b.STATUS || b.status) === 'Occupied').length;
              const roomAvail = roomBeds.length - roomOcc;

              return (
                <section key={roomKey} className="panel" aria-label={`Room ${roomKey}`}>
                  <div className="panel-head">
                    <div className="cell-stack">
                      <h2 className="panel-title" style={{ margin: 0 }}>Room {roomKey}</h2>
                      <span className="cell-secondary">{roomBeds.length} beds</span>
                    </div>
                    <div className="chip-row">
                      <span className="status status-success">{roomAvail} free</span>
                      {roomOcc > 0 && <span className="status status-info">{roomOcc} occupied</span>}
                    </div>
                  </div>

                  {/* Beds */}
                  <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                    {roomBeds.map(bed => {
                      const isOcc = bed.STATUS === 'Occupied';
                      const isHovered = hoveredBed === bed.ID;
                      const tone = TONE_VARS[bedTone(bed.STATUS)];
                      const Tile = isOcc ? 'div' : 'button';
                      const Icon = isOcc ? UserRound : BedDouble;

                      return (
                        <Tile
                          key={bed.ID}
                          {...(isOcc ? {} : {
                            type: 'button',
                            onClick: () => setAdmittingBed(bed),
                            'aria-label': `Admit a patient to bed ${bed.BED_NUMBER} (${bed.STATUS || 'Available'})`,
                          })}
                          onMouseEnter={() => setHoveredBed(bed.ID)}
                          onMouseLeave={() => setHoveredBed(null)}
                          title={isOcc ? `${bed.BED_NUMBER}: ${bed.PATIENT_NAME || 'Occupied'}` : undefined}
                          style={{
                            padding: '10px 8px',
                            borderRadius: 8,
                            background: tone.bg,
                            border: `1px solid ${isHovered && !isOcc ? tone.fg : tone.border}`,
                            cursor: isOcc ? 'default' : 'pointer',
                            textAlign: 'center',
                            minHeight: 84,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 3,
                            font: 'inherit', color: 'var(--text-primary)', width: '100%',
                          }}
                        >
                          <Icon size={18} aria-hidden="true" style={{ color: tone.fg }} />
                          <div className="mono" style={{ fontWeight: 600, color: tone.fg }}>{bed.BED_NUMBER}</div>
                          {isOcc ? (
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                              {bed.PATIENT_NAME}
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.75rem', color: tone.fg }}>{bed.STATUS || 'Available'}</div>
                          )}
                          {isOcc && bed.ADMISSION_DATE && (
                            <div className="cell-secondary" style={{ fontSize: '0.7rem' }}>
                              {new Date(bed.ADMISSION_DATE).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </div>
                          )}
                        </Tile>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

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
