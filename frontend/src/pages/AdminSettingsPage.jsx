import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { useAuth } from '../context/AuthContext';

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  // Admin tabs: Hospital Profile, Tariff, Dept Config, Working Hours, Holiday Calendar
  // Super Admin also keeps Security Logs
  const TABS = [
    { label: 'Hospital Profile', comp: <HospitalProfileTab /> },
    { label: 'Tariff / Rate Card', comp: <TariffTab /> },
    { label: 'Department Config', comp: <DepartmentConfigTab /> },
    { label: 'Working Hours', comp: <WorkingHoursTab /> },
    { label: 'Holiday Calendar', comp: <HolidayCalendarTab /> },
    ...(isSuperAdmin ? [{ label: 'Security Logs', comp: <SecurityLogsTab /> }] : []),
  ];

  return (
    <>
      <Navbar />
      <div className="page-wrapper fade-up">
        <h2 style={{ marginBottom: 24 }}>⚙️ Settings</h2>
        <div style={{ display: 'flex', gap: 24 }}>
          {/* Sidebar */}
          <div className="card" style={{ width: 230, padding: 0, flexShrink: 0 }}>
            {TABS.map((tab, i) => (
              <div key={tab.label} onClick={() => setActiveTab(i)} style={{
                padding: '14px 20px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: activeTab === i ? 600 : 400,
                background: activeTab === i ? 'var(--primary-color)' : 'transparent',
                color: activeTab === i ? '#fff' : 'var(--text-primary)',
                borderBottom: '1px solid var(--border)', transition: 'all 0.15s',
              }}>{tab.label}</div>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1 }}>
            {TABS[activeTab]?.comp}
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 1 — Hospital Profile
// ═══════════════════════════════════════════════════════════════
function HospitalProfileTab() {
  const [form, setForm] = useState({});
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/hospital-profile')
      .then(res => {
        setForm(res.data.data || {});
        if (res.data.data?.LOGO_URL) setLogoPreview(res.data.data.LOGO_URL);
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setLogoFile(file);
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    try {
      const fd = new FormData();
      Object.keys(form).forEach(k => { if (form[k] !== null && form[k] !== undefined) fd.append(k === 'NAME' ? 'name' : k === 'TAGLINE' ? 'tagline' : k === 'ADDRESS' ? 'address' : k === 'CITY' ? 'city' : k === 'STATE' ? 'state' : k === 'PIN' ? 'pin' : k === 'PHONE' ? 'phone' : k === 'EMAIL' ? 'email' : k === 'WEBSITE' ? 'website' : k === 'GSTIN' ? 'gstin' : k === 'REG_NUMBER' ? 'regNumber' : k === 'NABH_STATUS' ? 'nabhStatus' : k === 'CGHS_EMPANELLED' ? 'cghsEmpanelled' : k, form[k]); });
      if (logoFile) fd.append('logo', logoFile);
      await api.put('/admin/hospital-profile', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Hospital profile updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    }
  };

  const upd = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  if (loading) return <div className="card" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div className="card" style={{ padding: 28 }}>
      <h3 style={{ marginBottom: 20 }}>Hospital Profile</h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="form-group">
          <label>Hospital Name *</label>
          <input className="form-control" value={form.NAME || ''} onChange={e => upd('NAME', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Tagline</label>
          <input className="form-control" value={form.TAGLINE || ''} onChange={e => upd('TAGLINE', e.target.value)} />
        </div>
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label>Address</label>
          <input className="form-control" value={form.ADDRESS || ''} onChange={e => upd('ADDRESS', e.target.value)} />
        </div>
        <div className="form-group">
          <label>City</label>
          <input className="form-control" value={form.CITY || ''} onChange={e => upd('CITY', e.target.value)} />
        </div>
        <div className="form-group">
          <label>State</label>
          <input className="form-control" value={form.STATE || ''} onChange={e => upd('STATE', e.target.value)} />
        </div>
        <div className="form-group">
          <label>PIN</label>
          <input className="form-control" value={form.PIN || ''} onChange={e => upd('PIN', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Phone</label>
          <input className="form-control" value={form.PHONE || ''} onChange={e => upd('PHONE', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Email</label>
          <input className="form-control" value={form.EMAIL || ''} onChange={e => upd('EMAIL', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Website</label>
          <input className="form-control" value={form.WEBSITE || ''} onChange={e => upd('WEBSITE', e.target.value)} />
        </div>
        <div className="form-group">
          <label>GSTIN</label>
          <input className="form-control" value={form.GSTIN || ''} onChange={e => upd('GSTIN', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Registration Number</label>
          <input className="form-control" value={form.REG_NUMBER || ''} onChange={e => upd('REG_NUMBER', e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.NABH_STATUS == 1} onChange={e => upd('NABH_STATUS', e.target.checked ? 1 : 0)} /> NABH Accredited
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.CGHS_EMPANELLED == 1} onChange={e => upd('CGHS_EMPANELLED', e.target.checked ? 1 : 0)} /> CGHS Empanelled
        </label>
      </div>

      <div style={{ marginTop: 20 }}>
        <label style={{ fontWeight: 600, marginBottom: 8, display: 'block' }}>Hospital Logo</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {logoPreview && <img src={logoPreview} alt="Logo" style={{ width: 80, height: 80, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: '#fff' }} />}
          <input type="file" accept="image/*" onChange={handleLogoChange} />
        </div>
      </div>

      {/* Letterhead Preview */}
      <div style={{ marginTop: 24, padding: 20, border: '2px dashed var(--border)', borderRadius: 12, background: '#fff' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Letterhead Preview</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoPreview && <img src={logoPreview} alt="" style={{ width: 50, height: 50, objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f4c81' }}>{form.NAME || 'Hospital Name'}</div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>{form.TAGLINE || ''}</div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>{form.ADDRESS || ''}, {form.CITY || ''} - {form.PIN || ''}</div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>Ph: {form.PHONE || ''} | Reg: {form.REG_NUMBER || ''}</div>
          </div>
        </div>
        <div style={{ height: 3, background: '#0f4c81', marginTop: 12, borderRadius: 2 }}></div>
      </div>

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button className="btn btn-primary" onClick={handleSave}>Save Profile</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 2 — Tariff Management
// ═══════════════════════════════════════════════════════════════
function TariffTab() {
  const [tariffs, setTariffs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);

  const fetchTariffs = () => {
    api.get('/admin/tariff/all')
      .then(res => setTariffs(res.data.data))
      .catch(() => toast.error('Failed to load tariffs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTariffs(); }, []);

  const categories = [...new Set(tariffs.map(t => t.CATEGORY))];

  const handleToggle = async (id) => {
    try {
      await api.patch(`/admin/tariff/${id}/toggle`);
      fetchTariffs();
      toast.success('Tariff toggled');
    } catch { toast.error('Toggle failed'); }
  };

  if (loading) return <div className="card" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3>Tariff / Rate Card</h3>
        <button className="btn btn-primary" onClick={() => { setEditItem(null); setShowModal(true); }}>+ Add Tariff</button>
      </div>

      {categories.map(cat => (
        <div key={cat} className="card" style={{ padding: 20, marginBottom: 16 }}>
          <h4 style={{ marginBottom: 12, color: 'var(--primary-color)' }}>{cat}</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                <th style={{ padding: 10 }}>Name</th>
                <th style={{ padding: 10 }}>Rate (Rs.)</th>
                <th style={{ padding: 10 }}>GST %</th>
                <th style={{ padding: 10 }}>Per Unit</th>
                <th style={{ padding: 10 }}>Ward Type</th>
                <th style={{ padding: 10 }}>Status</th>
                <th style={{ padding: 10 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tariffs.filter(t => t.CATEGORY === cat).map(t => (
                <tr key={t.ID} style={{ borderBottom: '1px solid var(--border)', opacity: t.IS_ACTIVE ? 1 : 0.5 }}>
                  <td style={{ padding: 10, fontWeight: 500 }}>{t.NAME}</td>
                  <td style={{ padding: 10 }}>{t.RATE}</td>
                  <td style={{ padding: 10 }}>{t.GST_RATE}%</td>
                  <td style={{ padding: 10 }}>{t.PER_UNIT || '-'}</td>
                  <td style={{ padding: 10 }}>{t.WARD_TYPE || '-'}</td>
                  <td style={{ padding: 10 }}>
                    <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: '0.8rem', background: t.IS_ACTIVE ? '#48bb7820' : '#e53e3e20', color: t.IS_ACTIVE ? '#48bb78' : '#e53e3e' }}>
                      {t.IS_ACTIVE ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: 10, display: 'flex', gap: 6 }}>
                    <button className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => { setEditItem(t); setShowModal(true); }}>Edit</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => handleToggle(t.ID)}>{t.IS_ACTIVE ? 'Disable' : 'Enable'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {showModal && <TariffModal item={editItem} onClose={() => setShowModal(false)} onSaved={fetchTariffs} />}
    </div>
  );
}

function TariffModal({ item, onClose, onSaved }) {
  const [form, setForm] = useState({
    category: item?.CATEGORY || 'Consultation',
    name: item?.NAME || '',
    rate: item?.RATE || '',
    gstRate: item?.GST_RATE || 0,
    perUnit: item?.PER_UNIT || '',
    wardType: item?.WARD_TYPE || '',
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (item) {
        await api.put(`/admin/tariff/${item.ID}`, form);
      } else {
        await api.post('/admin/tariff', form);
      }
      toast.success(item ? 'Tariff updated' : 'Tariff created');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 500, padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3>{item ? 'Edit Tariff' : 'Add Tariff'}</h3>
          <button style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-primary)' }} onClick={onClose}>x</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="form-group">
            <label>Category</label>
            <select className="form-control" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option>Consultation</option><option>Lab</option><option>Bed Rent</option><option>Procedure</option><option>Package</option>
            </select>
          </div>
          <div className="form-group"><label>Name</label><input className="form-control" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}><label>Rate (Rs.)</label><input type="number" className="form-control" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} required /></div>
            <div className="form-group" style={{ flex: 1 }}><label>GST %</label><input type="number" step="0.01" className="form-control" value={form.gstRate} onChange={e => setForm({ ...form, gstRate: e.target.value })} /></div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}><label>Per Unit</label><input className="form-control" value={form.perUnit} onChange={e => setForm({ ...form, perUnit: e.target.value })} placeholder="e.g. per visit" /></div>
            <div className="form-group" style={{ flex: 1 }}><label>Ward Type</label><input className="form-control" value={form.wardType} onChange={e => setForm({ ...form, wardType: e.target.value })} placeholder="General/Private/ICU" /></div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{item ? 'Update' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 3 — Department Config
// ═══════════════════════════════════════════════════════════════
function DepartmentConfigTab() {
  const [depts, setDepts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/admin/departments')
      .then(res => setDepts(res.data.data || []))
      .catch(() => toast.error('Failed to load departments'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="card" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3>🏥 Department Configuration</h3>
      </div>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>Manage hospital departments, assign HODs, and configure departmental settings.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <th style={{ padding: 10 }}>Department</th>
            <th style={{ padding: 10 }}>Code</th>
            <th style={{ padding: 10 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {depts.length === 0 ? (
            <tr><td colSpan="3" style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>No departments configured. Add departments via the HMS setup.</td></tr>
          ) : depts.map((d, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: 10, fontWeight: 600 }}>{d.NAME}</td>
              <td style={{ padding: 10, fontFamily: 'monospace', fontSize: '0.85rem' }}>{d.CODE || '—'}</td>
              <td style={{ padding: 10 }}>
                <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: '0.8rem', background: '#48bb7820', color: '#48bb78' }}>Active</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 4 — Working Hours
// ═══════════════════════════════════════════════════════════════
function WorkingHoursTab() {
  const [hours, setHours] = useState([
    { day: 'Monday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Tuesday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Wednesday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Thursday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Friday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Saturday', opd: '9:00 AM – 1:00 PM', emergency: '24/7', shifts: 2 },
    { day: 'Sunday', opd: 'Closed', emergency: '24/7', shifts: 1 },
  ]);

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ marginBottom: 16 }}>🕐 Working Hours & Shift Configuration</h3>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>Define OPD timings, emergency availability, and daily shift counts.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <th style={{ padding: 10 }}>Day</th>
            <th style={{ padding: 10 }}>OPD Hours</th>
            <th style={{ padding: 10 }}>Emergency</th>
            <th style={{ padding: 10 }}>Shifts/Day</th>
          </tr>
        </thead>
        <tbody>
          {hours.map(h => (
            <tr key={h.day} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: 10, fontWeight: 600 }}>{h.day}</td>
              <td style={{ padding: 10 }}>
                <span style={{ color: h.opd === 'Closed' ? '#ef4444' : 'var(--text-primary)' }}>{h.opd}</span>
              </td>
              <td style={{ padding: 10 }}>
                <span style={{ padding: '3px 8px', borderRadius: 12, fontSize: '0.8rem', background: '#48bb7820', color: '#48bb78' }}>{h.emergency}</span>
              </td>
              <td style={{ padding: 10 }}>{h.shifts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 5 — Holiday Calendar
// ═══════════════════════════════════════════════════════════════
function HolidayCalendarTab() {
  const [holidays, setHolidays] = useState([
    { date: '2026-01-26', name: 'Republic Day', type: 'National' },
    { date: '2026-03-14', name: 'Holi', type: 'Festival' },
    { date: '2026-04-14', name: 'Ambedkar Jayanti', type: 'National' },
    { date: '2026-05-01', name: 'May Day', type: 'National' },
    { date: '2026-08-15', name: 'Independence Day', type: 'National' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'National' },
    { date: '2026-10-20', name: 'Dussehra', type: 'Festival' },
    { date: '2026-11-09', name: 'Diwali', type: 'Festival' },
    { date: '2026-12-25', name: 'Christmas', type: 'Festival' },
  ]);
  const [form, setForm] = useState({ date: '', name: '', type: 'National' });
  const [showForm, setShowForm] = useState(false);

  const addHoliday = () => {
    if (!form.date || !form.name) return;
    setHolidays(prev => [...prev, { ...form }].sort((a, b) => a.date.localeCompare(b.date)));
    setForm({ date: '', name: '', type: 'National' });
    setShowForm(false);
    toast.success('Holiday added');
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3>📅 Holiday Calendar</h3>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>+ Add Holiday</button>
      </div>

      {showForm && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, padding: 16, background: 'var(--surface-2)', borderRadius: 10 }}>
          <input type="date" className="form-control" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <input className="form-control" placeholder="Holiday name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={{ flex: 1 }} />
          <select className="form-control" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option>National</option><option>Festival</option><option>Hospital</option>
          </select>
          <button className="btn btn-primary" onClick={addHoliday}>Add</button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <th style={{ padding: 10 }}>Date</th>
            <th style={{ padding: 10 }}>Holiday</th>
            <th style={{ padding: 10 }}>Type</th>
            <th style={{ padding: 10 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {holidays.map((h, i) => {
            const isPast = new Date(h.date) < new Date();
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: isPast ? 0.5 : 1 }}>
                <td style={{ padding: 10, fontFamily: 'monospace', fontWeight: 600 }}>{h.date}</td>
                <td style={{ padding: 10, fontWeight: 500 }}>{h.name}</td>
                <td style={{ padding: 10 }}>
                  <span style={{
                    padding: '3px 8px', borderRadius: 12, fontSize: '0.8rem',
                    background: h.type === 'National' ? '#60a5fa20' : h.type === 'Festival' ? '#f59e0b20' : '#a855f720',
                    color: h.type === 'National' ? '#60a5fa' : h.type === 'Festival' ? '#f59e0b' : '#a855f7',
                  }}>{h.type}</span>
                </td>
                <td style={{ padding: 10 }}>
                  {isPast ? <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Past</span> : <span style={{ fontSize: '0.8rem', color: 'var(--green)' }}>Upcoming</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 6 — Security Logs (Super Admin only)
// ═══════════════════════════════════════════════════════════════
function SecurityLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    api.get('/security/audit-trail?per_page=200')
      .then(res => setLogs(res.data.data?.logs || []))
      .catch(() => toast.error('Failed to load logs'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = failedOnly ? logs.filter(l => l.ACTION === 'LOGIN_FAILED' || l.ACTION === 'ACCOUNT_LOCKED') : logs;

  if (loading) return <div className="card" style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  return (
    <div className="card" style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3>🔐 Security Logs</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={failedOnly} onChange={e => setFailedOnly(e.target.checked)} /> Failed logins only
        </label>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <th style={{ padding: 10 }}>Timestamp</th>
            <th style={{ padding: 10 }}>Username</th>
            <th style={{ padding: 10 }}>Action</th>
            <th style={{ padding: 10 }}>Module</th>
            <th style={{ padding: 10 }}>IP Address</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan="5" style={{ padding: 16, textAlign: 'center' }}>No logs found</td></tr>
          ) : filtered.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: 10, fontSize: '0.85rem' }}>{l.CREATED_AT ? new Date(l.CREATED_AT).toLocaleString() : ''}</td>
              <td style={{ padding: 10 }}>{l.USERNAME || l.USER_NAME || 'Unknown'}</td>
              <td style={{ padding: 10 }}>
                <span style={{
                  padding: '3px 8px', borderRadius: 12, fontSize: '0.8rem',
                  background: l.ACTION === 'LOGIN_FAILED' ? '#e53e3e20' : l.ACTION === 'ACCOUNT_LOCKED' ? '#d69e2e20' : '#48bb7820',
                  color: l.ACTION === 'LOGIN_FAILED' ? '#e53e3e' : l.ACTION === 'ACCOUNT_LOCKED' ? '#d69e2e' : '#48bb78',
                }}>{l.ACTION}</span>
              </td>
              <td style={{ padding: 10 }}>{l.MODULE || '-'}</td>
              <td style={{ padding: 10, fontSize: '0.85rem', fontFamily: 'monospace' }}>{l.IP_ADDRESS || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
