import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { BedDouble, Building2, Plus, RefreshCw, UserRound } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';

// Bed status -> status tone. Anything not listed falls back to neutral.
const BED_TONE = { Available: 'success', Occupied: 'info', Reserved: 'warning', Cleaning: 'warning', Maintenance: 'neutral' };
const TONE_VARS = {
  success: { bg: 'var(--success-light)', border: 'var(--success-border)', fg: 'var(--success)' },
  info: { bg: 'var(--primary-light)', border: 'var(--primary-border)', fg: 'var(--primary)' },
  warning: { bg: 'var(--amber-light)', border: 'var(--amber-border)', fg: 'var(--amber)' },
  neutral: { bg: 'var(--surface-2)', border: 'var(--border)', fg: 'var(--text-secondary)' },
};

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

  const toggleWard = async (ward) => {
    try {
      await api.patch(`/ipd/wards/${ward.ID}/toggle`);
      toast.success(`Ward ${ward.IS_ACTIVE ? 'disabled' : 'enabled'}`);
      fetchWards();
    } catch (err) { toast.error('Could not change ward status'); }
  };

  const toggleBed = async (bed) => {
    try {
      await api.patch(`/ipd/beds/${bed.ID}/toggle`);
      toast.success(`Bed ${bed.IS_ACTIVE ? 'disabled' : 'enabled'}`);
      fetchBeds(activeWard);
    } catch (err) { toast.error('Could not change bed status'); }
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
      <main className="app-page">
        <PageHeader
          title="Ward and bed setup"
          description="Configure hospital wards, rooms and beds, and take them in or out of service."
          meta={<span className="muted">{wards.length} wards · {beds.length} beds in the selected ward</span>}
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={() => fetchBeds(activeWard)} disabled={!activeWard}>
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </button>
              <button type="button" className="btn btn-secondary btn-md" onClick={() => setShowAddBeds(true)} disabled={!activeWard}>
                <BedDouble size={16} aria-hidden="true" /> Add beds
              </button>
              <button type="button" className="btn btn-primary btn-md" onClick={() => setShowAddWard(true)}>
                <Plus size={16} aria-hidden="true" /> Add ward
              </button>
            </>
          )}
        />

        {/* Wards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 20 }}>
          {wards.map(w => {
            const isActiveTab = (w.id || w.ID) === activeWard;
            const isWardActive = w.IS_ACTIVE === 1;
            return (
              <div
                key={w.ID}
                className="panel"
                style={{
                  padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  borderColor: isActiveTab ? 'var(--primary)' : undefined,
                  background: isActiveTab ? 'var(--primary-light)' : isWardActive ? undefined : 'var(--surface-2)',
                }}
              >
                <button
                  type="button"
                  aria-pressed={isActiveTab}
                  onClick={() => setActiveWard(w.id || w.ID)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}
                >
                  <span className="cell-stack">
                    <span className="cell-primary" style={{ color: isWardActive ? undefined : 'var(--text-muted)' }}>{w.NAME}</span>
                    <span className="cell-secondary">{w.FLOOR} · {w.TYPE} · {w.TOTAL_BEDS} beds</span>
                  </span>
                </button>
                <span className={`status ${isWardActive ? 'status-success' : 'status-neutral'}`}>{isWardActive ? 'In service' : 'Disabled'}</span>
                <button
                  type="button"
                  className={`btn btn-sm ${isWardActive ? 'btn-ghost' : 'btn-secondary'}`}
                  onClick={(e) => { e.stopPropagation(); toggleWard(w); }}
                  aria-label={`${isWardActive ? 'Disable' : 'Enable'} ward ${w.NAME}`}
                >
                  {isWardActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            );
          })}
        </div>

        {/* Room floor plan */}
        {loading ? (
          <section className="panel panel-pad"><p className="muted">Loading…</p></section>
        ) : roomKeys.length === 0 ? (
          <section className="panel">
            {wards.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No wards yet"
                description="Add a ward, then add rooms and beds to it."
                action={<button type="button" className="btn btn-primary btn-md" onClick={() => setShowAddWard(true)}><Plus size={16} aria-hidden="true" /> Add ward</button>}
              />
            ) : (
              <EmptyState
                icon={BedDouble}
                title="No beds in this ward"
                description="Add beds to a room in this ward to make them available for admission."
                action={<button type="button" className="btn btn-primary btn-md" onClick={() => setShowAddBeds(true)} disabled={!activeWard}><BedDouble size={16} aria-hidden="true" /> Add beds</button>}
              />
            )}
          </section>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {roomKeys.map((roomKey) => {
              const roomBeds = roomsMap[roomKey];
              const isWardActive = activeWardObj?.IS_ACTIVE === 1;

              return (
                <section key={roomKey} className="panel" aria-label={`Room ${roomKey}`} style={{ opacity: isWardActive ? 1 : 0.6 }}>
                  <div className="panel-head">
                    <h2 className="panel-title" style={{ margin: 0 }}>Room {roomKey}</h2>
                    <span className="cell-secondary">{roomBeds.length} beds</span>
                  </div>

                  <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                    {roomBeds.map(bed => {
                      const isOcc = bed.STATUS === 'Occupied';
                      const isBedActive = bed.IS_ACTIVE === 1;
                      const tone = TONE_VARS[isBedActive ? (BED_TONE[bed.STATUS] || 'neutral') : 'neutral'];
                      const Icon = isOcc ? UserRound : BedDouble;

                      return (
                        <div key={bed.ID} style={{
                          padding: '10px 8px', borderRadius: 8,
                          background: tone.bg,
                          border: `1px solid ${tone.border}`,
                          textAlign: 'center', minHeight: 96, display: 'flex', flexDirection: 'column',
                          alignItems: 'center', justifyContent: 'center', gap: 3,
                        }}>
                          <Icon size={18} aria-hidden="true" style={{ color: tone.fg }} />
                          <div className="mono" style={{ fontWeight: 600, color: tone.fg }}>{bed.BED_NUMBER}</div>
                          {!isBedActive ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Disabled</div>
                          ) : isOcc ? (
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{bed.PATIENT_NAME}</div>
                          ) : (
                            <div style={{ fontSize: '0.75rem', color: tone.fg }}>{bed.STATUS || 'Available'}</div>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => toggleBed(bed)}
                            aria-label={`${isBedActive ? 'Disable' : 'Enable'} bed ${bed.BED_NUMBER}`}
                            style={{ marginTop: 2 }}
                          >
                            {isBedActive ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>

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
      toast.success('Ward added');
      onSuccess();
    } catch (err) { toast.error('Could not add ward'); }
    finally { setLoading(false); }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Add ward"
      description="New wards are in service straight away. Add beds to it afterwards."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-ward-form" className="btn btn-primary btn-md" disabled={loading}>
            {loading ? 'Creating…' : 'Create ward'}
          </button>
        </>
      )}
    >
      <form id="add-ward-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="ward-name">Ward name</label>
          <input id="ward-name" className="form-input" required placeholder="e.g. ICU Wing A" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="ward-type">Ward type</label>
            <select id="ward-type" className="form-select" value={formData.type} onChange={e => setFormData({ ...formData, type: e.target.value })}>
              <option>General</option>
              <option>Private</option>
              <option>Critical Care</option>
              <option>Maternity</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="ward-floor">Floor</label>
            <input id="ward-floor" className="form-input" required placeholder="e.g. 2nd Floor" value={formData.floor} onChange={e => setFormData({ ...formData, floor: e.target.value })} />
          </div>
        </div>
      </form>
    </Modal>
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
      toast.success('Beds added');
      onSuccess();
    } catch (err) { toast.error('Could not add beds'); }
    finally { setLoading(false); }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Add beds"
      description={`Add beds to a room in ${ward.NAME}.`}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-beds-form" className="btn btn-primary btn-md" disabled={loading}>
            {loading ? 'Adding…' : `Add ${formData.count} ${formData.count === 1 ? 'bed' : 'beds'}`}
          </button>
        </>
      )}
    >
      <form id="add-beds-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="bed-room">Room no.</label>
            <input id="bed-room" className="form-input" required placeholder="e.g. G-01" value={formData.roomNumber} onChange={e => setFormData({ ...formData, roomNumber: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="bed-prefix">Bed prefix</label>
            <input id="bed-prefix" className="form-input" required placeholder="e.g. GW" value={formData.bedPrefix} onChange={e => setFormData({ ...formData, bedPrefix: e.target.value })} />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="bed-count">Number of beds</label>
          <input id="bed-count" type="number" className="form-input" required min="1" max="20" value={formData.count} onChange={e => setFormData({ ...formData, count: Number(e.target.value) })} />
          <p className="form-hint">Beds are numbered automatically, for example {formData.bedPrefix || 'PREFIX'}-01, {formData.bedPrefix || 'PREFIX'}-02.</p>
        </div>
      </form>
    </Modal>
  );
}
