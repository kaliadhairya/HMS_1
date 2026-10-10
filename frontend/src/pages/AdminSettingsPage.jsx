import { useState, useEffect, useMemo } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  Building2, CalendarDays, Clock, Lock, LockOpen, Pencil, Plus, ReceiptText, Save, Search, ShieldCheck, Upload, Layers,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import RowMenu from '../components/ui/RowMenu';
import { useAuth } from '../context/AuthContext';

const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function AdminSettingsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  // Admin tabs: Hospital Profile, Tariff, Dept Config, Working Hours, Holiday Calendar
  // Super Admin also keeps Security Logs
  const TABS = [
    { label: 'Hospital profile', icon: Building2, comp: <HospitalProfileTab /> },
    { label: 'Tariff and rate card', icon: ReceiptText, comp: <TariffTab /> },
    { label: 'Departments', icon: Layers, comp: <DepartmentConfigTab /> },
    { label: 'Working hours', icon: Clock, comp: <WorkingHoursTab /> },
    { label: 'Holiday calendar', icon: CalendarDays, comp: <HolidayCalendarTab /> },
    ...(isSuperAdmin ? [{ label: 'Security logs', icon: ShieldCheck, comp: <SecurityLogsTab /> }] : []),
  ];

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Settings" description="Hospital profile, rate card, departments, timings and holidays." />

        <div className="tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                id={`settings-tab-${i}`}
                aria-selected={activeTab === i}
                aria-controls={`settings-panel-${i}`}
                className={`tab${activeTab === i ? ' is-active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                <Icon size={16} aria-hidden="true" /> {tab.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`settings-panel-${activeTab}`} aria-labelledby={`settings-tab-${activeTab}`}>
          {TABS[activeTab]?.comp}
        </div>
      </main>
    </>
  );
}

function PanelHead({ icon: Icon, title, actions }) {
  return (
    <div className="panel-head">
      <h2 className="panel-title" style={{ margin: 0 }}><Icon size={16} aria-hidden="true" /> {title}</h2>
      {actions}
    </div>
  );
}

const loadingPanel = <section className="panel panel-pad"><p className="muted">Loading…</p></section>;

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
      .then((res) => {
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
      Object.keys(form).forEach((k) => { if (form[k] !== null && form[k] !== undefined) fd.append(k === 'NAME' ? 'name' : k === 'TAGLINE' ? 'tagline' : k === 'ADDRESS' ? 'address' : k === 'CITY' ? 'city' : k === 'STATE' ? 'state' : k === 'PIN' ? 'pin' : k === 'PHONE' ? 'phone' : k === 'EMAIL' ? 'email' : k === 'WEBSITE' ? 'website' : k === 'GSTIN' ? 'gstin' : k === 'REG_NUMBER' ? 'regNumber' : k === 'NABH_STATUS' ? 'nabhStatus' : k === 'CGHS_EMPANELLED' ? 'cghsEmpanelled' : k, form[k]); });
      if (logoFile) fd.append('logo', logoFile);
      await api.put('/admin/hospital-profile', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Hospital profile updated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Update failed');
    }
  };

  const upd = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  if (loading) return loadingPanel;

  const field = (key, label, opts = {}) => (
    <div className="form-group" style={opts.full ? { gridColumn: '1 / -1' } : undefined}>
      <label className="form-label" htmlFor={`hp-${key}`}>{label}</label>
      <input
        id={`hp-${key}`}
        className="form-input"
        type={opts.type || 'text'}
        value={form[key] || ''}
        onChange={(e) => upd(key, e.target.value)}
      />
    </div>
  );

  return (
    <div className="split-2" style={{ alignItems: 'start' }}>
      <section className="panel">
        <PanelHead icon={Building2} title="Hospital profile" />
        <form className="panel-pad stack" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
          <div className="form-row-2">
            {field('NAME', 'Hospital name')}
            {field('TAGLINE', 'Tagline')}
            {field('ADDRESS', 'Address', { full: true })}
            {field('CITY', 'City')}
            {field('STATE', 'State')}
            {field('PIN', 'PIN')}
            {field('PHONE', 'Phone', { type: 'tel' })}
            {field('EMAIL', 'Email')}
            {field('WEBSITE', 'Website')}
            {field('GSTIN', 'GSTIN')}
            {field('REG_NUMBER', 'Registration number')}
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label className="check-row">
              <input type="checkbox" checked={form.NABH_STATUS == 1} onChange={(e) => upd('NABH_STATUS', e.target.checked ? 1 : 0)} /> NABH accredited
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.CGHS_EMPANELLED == 1} onChange={(e) => upd('CGHS_EMPANELLED', e.target.checked ? 1 : 0)} /> CGHS empanelled
            </label>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="hp-logo">Hospital logo</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              {logoPreview && (
                <img src={logoPreview} alt="Current logo" style={{ width: 72, height: 72, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: 'var(--surface)' }} />
              )}
              <input id="hp-logo" type="file" accept="image/*" onChange={handleLogoChange} />
            </div>
            <p className="form-hint"><Upload size={12} aria-hidden="true" /> PNG or JPG. Used on printed letterheads and reports.</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary btn-md"><Save size={16} aria-hidden="true" /> Save profile</button>
          </div>
        </form>
      </section>

      <section className="panel panel-pad">
        <h2 className="panel-title">Letterhead preview</h2>
        {/* print-area keeps the preview on a white, print-like palette in both themes */}
        <div className="print-area" style={{ padding: 20, border: '1px dashed var(--border)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {logoPreview && <img src={logoPreview} alt="" style={{ width: 50, height: 50, objectFit: 'contain' }} />}
            <div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>{form.NAME || 'Hospital name'}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{form.TAGLINE || ''}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{form.ADDRESS || ''}, {form.CITY || ''} - {form.PIN || ''}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Ph: {form.PHONE || ''} | Reg: {form.REG_NUMBER || ''}</div>
            </div>
          </div>
          <div style={{ height: 3, background: 'var(--primary)', marginTop: 12, borderRadius: 2 }} />
        </div>
      </section>
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
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');

  const fetchTariffs = () => {
    api.get('/admin/tariff/all')
      .then((res) => setTariffs(res.data.data))
      .catch(() => toast.error('Failed to load tariffs'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchTariffs(); }, []);

  const list = Array.isArray(tariffs) ? tariffs : [];
  const categories = [...new Set(list.map((t) => t.CATEGORY))];

  const handleToggle = async (id) => {
    try {
      await api.patch(`/admin/tariff/${id}/toggle`);
      fetchTariffs();
      toast.success('Tariff status changed');
    } catch { toast.error('Toggle failed'); }
  };

  const openAdd = () => { setEditItem(null); setShowModal(true); };
  const openEdit = (t) => { setEditItem(t); setShowModal(true); };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((t) => {
      if (category && t.CATEGORY !== category) return false;
      if (!q) return true;
      return [t.NAME, t.CATEGORY, t.WARD_TYPE].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [list, category, query]);

  const columns = useMemo(() => [
    {
      id: 'name', header: 'Name', accessorFn: (t) => t.NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary" style={{ color: row.original.IS_ACTIVE ? undefined : 'var(--text-muted)' }}>{row.original.NAME}</span>
          {row.original.DOCTOR_NAME && <span className="cell-secondary">{row.original.DOCTOR_NAME}</span>}
        </span>
      ),
    },
    { id: 'category', header: 'Category', accessorFn: (t) => t.CATEGORY || '', meta: { width: 140 }, cell: ({ getValue }) => <span className="tag">{getValue()}</span> },
    { id: 'rate', header: 'Rate', accessorFn: (t) => Number(t.RATE) || 0, meta: { width: 120, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span> },
    { id: 'gst', header: 'GST', accessorFn: (t) => Number(t.GST_RATE) || 0, meta: { width: 80, align: 'right' }, cell: ({ row }) => <span className="tabular">{row.original.GST_RATE}%</span> },
    { id: 'unit', header: 'Per unit', accessorFn: (t) => t.PER_UNIT || '', meta: { width: 120 }, cell: ({ getValue }) => getValue() || '—' },
    { id: 'ward', header: 'Ward type', accessorFn: (t) => t.WARD_TYPE || '', meta: { width: 120 }, cell: ({ getValue }) => getValue() || '—' },
    {
      id: 'status', header: 'Status', accessorFn: (t) => (t.IS_ACTIVE ? 'Active' : 'Inactive'), meta: { width: 110 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Active' ? 'status-success' : 'status-neutral'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 56, align: 'right' },
      cell: ({ row }) => {
        const t = row.original;
        return (
          <RowMenu
            label={`Actions for ${t.NAME}`}
            items={[
              { label: 'Edit tariff', icon: Pencil, onSelect: () => openEdit(t) },
              { label: t.IS_ACTIVE ? 'Disable' : 'Enable', icon: t.IS_ACTIVE ? Lock : LockOpen, onSelect: () => handleToggle(t.ID), danger: Boolean(t.IS_ACTIVE), separator: true },
            ]}
          />
        );
      },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);

  const addButton = (
    <button type="button" className="btn btn-primary btn-md" onClick={openAdd}>
      <Plus size={16} aria-hidden="true" /> Add tariff
    </button>
  );

  return (
    <section className="panel">
      <PanelHead icon={ReceiptText} title="Tariff and rate card" actions={addButton} />
      <div className="toolbar">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search tariffs</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, category or ward type" />
        </label>
        <label className="sr-only" htmlFor="tariff-category">Filter by category</label>
        <select id="tariff-category" className="form-select" style={{ width: 200 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        getRowId={(t) => String(t.ID)}
        onRowClick={openEdit}
        rowLabel={(t) => `Edit ${t.NAME}`}
        pageSize={50}
        empty={list.length > 0 ? (
          <EmptyState icon={Search} title="No tariffs match" description="Try another name, or clear the category filter." />
        ) : (
          <EmptyState icon={ReceiptText} title="No tariffs yet" description="Add consultation, lab, bed and procedure rates for billing." action={addButton} />
        )}
      />

      {showModal && <TariffModal item={editItem} onClose={() => setShowModal(false)} onSaved={fetchTariffs} />}
    </section>
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
      toast.error(err.response?.data?.message || 'Failed to save tariff');
    }
  };

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={item ? `Edit ${item.NAME}` : 'Add tariff'}
      description="Rates are used when bills are generated."
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onClose}>Cancel</button>
          <button type="submit" form="tariff-form" className="btn btn-primary btn-md">{item ? 'Save changes' : 'Create tariff'}</button>
        </>
      )}
    >
      <form id="tariff-form" onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div className="form-group">
          <label className="form-label" htmlFor="tf-category">Category</label>
          <select id="tf-category" className="form-select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option>Consultation</option><option>Lab</option><option>Bed Rent</option><option>Procedure</option><option>Package</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="tf-name">Name</label>
          <input id="tf-name" className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="tf-rate">Rate (₹)</label>
            <input id="tf-rate" type="number" className="form-input" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} required />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="tf-gst">GST %</label>
            <input id="tf-gst" type="number" step="0.01" className="form-input" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} />
          </div>
        </div>
        <div className="form-row-2">
          <div className="form-group">
            <label className="form-label" htmlFor="tf-unit">Per unit</label>
            <input id="tf-unit" className="form-input" value={form.perUnit} onChange={(e) => setForm({ ...form, perUnit: e.target.value })} placeholder="e.g. per visit" />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="tf-ward">Ward type</label>
            <input id="tf-ward" className="form-input" value={form.wardType} onChange={(e) => setForm({ ...form, wardType: e.target.value })} placeholder="General, Private or ICU" />
          </div>
        </div>
      </form>
    </Modal>
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
      .then((res) => setDepts(res.data.data || []))
      .catch(() => toast.error('Failed to load departments'))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo(() => [
    { id: 'name', header: 'Department', accessorFn: (d) => d.NAME || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'code', header: 'Code', accessorFn: (d) => d.CODE || '', meta: { width: 160 }, cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span> },
    { id: 'status', header: 'Status', enableSorting: false, meta: { width: 120 }, cell: () => <span className="status status-success">Active</span> },
  ], []);

  return (
    <section className="panel">
      <PanelHead icon={Layers} title="Departments" />
      <p className="muted" style={{ padding: '12px 16px 0' }}>Hospital departments available for appointments, billing and reports.</p>
      <DataTable
        columns={columns}
        data={depts}
        loading={loading}
        getRowId={(d, i) => String(d.ID ?? i)}
        initialSorting={[{ id: 'name', desc: false }]}
        empty={<EmptyState icon={Layers} title="No departments configured" description="Add departments through the HMS setup." />}
      />
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 4 — Working Hours
// ═══════════════════════════════════════════════════════════════
function WorkingHoursTab() {
  const [hours] = useState([
    { day: 'Monday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Tuesday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Wednesday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Thursday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Friday', opd: '9:00 AM – 5:00 PM', emergency: '24/7', shifts: 3 },
    { day: 'Saturday', opd: '9:00 AM – 1:00 PM', emergency: '24/7', shifts: 2 },
    { day: 'Sunday', opd: 'Closed', emergency: '24/7', shifts: 1 },
  ]);

  return (
    <section className="panel">
      <PanelHead icon={Clock} title="Working hours and shifts" />
      <div className="panel-pad">
        <p className="muted" style={{ marginBottom: 12 }}>OPD timings, emergency availability and the number of shifts each day.</p>
        <table className="mini-table">
          <thead>
            <tr><th>Day</th><th>OPD hours</th><th>Emergency</th><th className="text-right">Shifts per day</th></tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.day}>
                <td className="cell-primary">{h.day}</td>
                <td>{h.opd === 'Closed' ? <span className="status status-neutral">Closed</span> : <span className="tabular">{h.opd}</span>}</td>
                <td><span className="status status-success">{h.emergency}</span></td>
                <td className="text-right tabular">{h.shifts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
    setHolidays((prev) => [...prev, { ...form }].sort((a, b) => a.date.localeCompare(b.date)));
    setForm({ date: '', name: '', type: 'National' });
    setShowForm(false);
    toast.success('Holiday added');
  };

  return (
    <section className="panel">
      <PanelHead
        icon={CalendarDays}
        title="Holiday calendar"
        actions={(
          <button type="button" className="btn btn-primary btn-md" onClick={() => setShowForm(true)}>
            <Plus size={16} aria-hidden="true" /> Add holiday
          </button>
        )}
      />
      <div className="panel-pad">
        <table className="mini-table">
          <thead>
            <tr><th>Date</th><th>Holiday</th><th>Type</th><th>Status</th></tr>
          </thead>
          <tbody>
            {holidays.map((h, i) => {
              const isPast = new Date(h.date) < new Date();
              return (
                <tr key={i} style={{ color: isPast ? 'var(--text-muted)' : undefined }}>
                  <td className="mono">{h.date}</td>
                  <td style={{ fontWeight: 500 }}>{h.name}</td>
                  <td><span className="tag">{h.type}</span></td>
                  <td>{isPast ? <span className="status status-neutral">Past</span> : <span className="status status-info">Upcoming</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={showForm}
        onOpenChange={setShowForm}
        title="Add holiday"
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" form="holiday-form" className="btn btn-primary btn-md">Add holiday</button>
          </>
        )}
      >
        <form id="holiday-form" onSubmit={(e) => { e.preventDefault(); addHoliday(); }} style={{ display: 'grid', gap: 14 }}>
          <div className="form-group">
            <label className="form-label" htmlFor="hol-date">Date</label>
            <input id="hol-date" type="date" className="form-input" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hol-name">Holiday name</label>
            <input id="hol-name" className="form-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="hol-type">Type</label>
            <select id="hol-type" className="form-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option>National</option><option>Festival</option><option>Hospital</option>
            </select>
          </div>
        </form>
      </Modal>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TAB 6 — Security Logs (Super Admin only)
// ═══════════════════════════════════════════════════════════════
const LOG_TONE = { LOGIN_FAILED: 'danger', ACCOUNT_LOCKED: 'warning', LOGIN: 'success' };

function SecurityLogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failedOnly, setFailedOnly] = useState(false);

  useEffect(() => {
    api.get('/security/audit-trail?per_page=200')
      .then((res) => setLogs(res.data.data?.logs || []))
      .catch(() => toast.error('Failed to load logs'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = failedOnly ? logs.filter((l) => l.ACTION === 'LOGIN_FAILED' || l.ACTION === 'ACCOUNT_LOCKED') : logs;

  const columns = useMemo(() => [
    {
      id: 'time', header: 'Time', accessorFn: (l) => (l.CREATED_AT ? new Date(l.CREATED_AT).getTime() : 0), meta: { width: 190 },
      cell: ({ row }) => <span className="tabular">{fmtDateTime(row.original.CREATED_AT)}</span>,
    },
    { id: 'user', header: 'Username', accessorFn: (l) => l.USERNAME || l.USER_NAME || 'Unknown', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    {
      id: 'action', header: 'Action', accessorFn: (l) => l.ACTION || '', meta: { width: 180 },
      cell: ({ getValue }) => <span className={`status status-${LOG_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
    },
    { id: 'module', header: 'Module', accessorFn: (l) => l.MODULE || '', meta: { width: 130 }, cell: ({ getValue }) => getValue() || '—' },
    { id: 'ip', header: 'IP address', accessorFn: (l) => l.IP_ADDRESS || '', meta: { width: 160 }, cell: ({ getValue }) => <span className="mono">{getValue() || '—'}</span> },
  ], []);

  return (
    <section className="panel">
      <PanelHead
        icon={ShieldCheck}
        title="Security logs"
        actions={(
          <label className="check-row" style={{ fontSize: '0.86rem' }}>
            <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /> Failed sign-ins only
          </label>
        )}
      />
      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        getRowId={(l, i) => String(l.ID ?? i)}
        initialSorting={[{ id: 'time', desc: true }]}
        empty={<EmptyState icon={ShieldCheck} title="No logs found" description={failedOnly ? 'No failed sign-ins or locked accounts were recorded.' : 'Security events appear here.'} />}
      />
    </section>
  );
}
