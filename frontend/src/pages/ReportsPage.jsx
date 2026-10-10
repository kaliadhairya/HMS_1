import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import {
  BarChart3, ChevronLeft, ChevronRight, ClipboardList, Download, FlaskConical, Pill, ScrollText, Stethoscope, Wallet,
} from 'lucide-react';
import api from '../api/axios';
import { openAuthenticatedBlob } from '../utils/authenticatedDownload';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import DataTable from '../components/ui/DataTable';
import EmptyState from '../components/ui/EmptyState';

const TABS = [
  { label: 'OPD register', icon: ClipboardList },
  { label: 'Revenue', icon: Wallet },
  { label: 'Pharmacy sales', icon: Pill },
  { label: 'Lab workload', icon: FlaskConical },
  { label: 'Audit trail', icon: ScrollText },
  { label: 'Doctor performance', icon: Stethoscope },
];

// Local calendar date (not UTC), so default ranges match the hospital's day.
const localYmd = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const daysAgo = (n) => localYmd(new Date(Date.now() - n * 86400000));
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
// Compact Indian notation for chart axes: ₹950, ₹12k, ₹1.2L, ₹3.4Cr.
const inrCompact = (v) => {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const trim = (x) => String(Math.round(x * 10) / 10).replace(/\.0$/, '');
  if (abs >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(n / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(n / 1e3)}k`;
  return `₹${Math.round(n)}`;
};
const localKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function CollectionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <div className="muted" style={{ fontSize: '0.78rem' }}>{d.full}</div>
      <strong className="tabular">{inr(d.amount)}</strong> <span className="muted">collected</span>
    </div>
  );
}
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title="Reports and analytics" description="Operational, financial and audit reports for a chosen date range." />

        <div className="tabs" role="tablist" aria-label="Reports">
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.label}
                type="button"
                role="tab"
                id={`report-tab-${i}`}
                aria-selected={activeTab === i}
                aria-controls={`report-panel-${i}`}
                className={`tab${activeTab === i ? ' is-active' : ''}`}
                onClick={() => setActiveTab(i)}
              >
                <Icon size={16} aria-hidden="true" /> {tab.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`report-panel-${activeTab}`} aria-labelledby={`report-tab-${activeTab}`}>
          {activeTab === 0 && <OPDRegisterTab />}
          {activeTab === 1 && <RevenueTab />}
          {activeTab === 2 && <PharmacySalesTab />}
          {activeTab === 3 && <LabWorkloadTab />}
          {activeTab === 4 && <AuditTrailTab />}
          {activeTab === 5 && <DoctorPerformanceTab />}
        </div>
      </main>
    </>
  );
}

// ── Date range toolbar (reusable) ─────────────────
function DateRangeFilter({ id, startDate, endDate, setStartDate, setEndDate, onFetch, loading, children }) {
  return (
    <div className="toolbar" style={{ alignItems: 'flex-end' }}>
      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-from`}>From</label>
        <input id={`${id}-from`} type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-to`}>To</label>
        <input id={`${id}-to`} type="date" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      {children}
      <button type="button" className="btn btn-primary btn-md" onClick={onFetch} disabled={loading}>
        <BarChart3 size={16} aria-hidden="true" /> {loading ? 'Generating…' : 'Generate'}
      </button>
    </div>
  );
}

function PanelTitle({ icon: Icon, children, actions }) {
  return (
    <div className="panel-head">
      <h2 className="panel-title" style={{ margin: 0 }}><Icon size={16} aria-hidden="true" /> {children}</h2>
      {actions}
    </div>
  );
}

const notGenerated = (text) => <EmptyState icon={BarChart3} title="No report yet" description={text || 'Choose a date range and select Generate.'} />;

// ═══════════════════════════════════════════════════════════════
function OPDRegisterTab() {
  const today = localYmd();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [dept] = useState('');

  useEffect(() => { api.get('/users?role=doctor').then((r) => setDoctors(r.data.data || [])).catch(() => {}); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      let url = `/reports/opd-register?start_date=${startDate}&end_date=${endDate}`;
      if (doctorId) url += `&doctor_id=${doctorId}`;
      if (dept) url += `&department=${dept}`;
      const res = await api.get(url);
      setData(res.data.data);
      setGenerated(true);
    } catch { toast.error('Failed to load OPD register'); }
    setLoading(false);
  };

  const exportExcel = () => {
    let url = `/reports/opd-register?start_date=${startDate}&end_date=${endDate}&export=excel`;
    if (doctorId) url += `&doctor_id=${doctorId}`;
    if (dept) url += `&department=${dept}`;
    openAuthenticatedBlob(url, { download: true, filename: 'opd-register.xlsx' })
      .catch(() => toast.error('Export failed.'));
  };

  const columns = useMemo(() => [
    { id: 'date', header: 'Date', accessorFn: (r) => (r.ENCOUNTER_DATE ? new Date(r.ENCOUNTER_DATE).getTime() : 0), meta: { width: 120 }, cell: ({ row }) => <span className="tabular">{fmtDate(row.original.ENCOUNTER_DATE)}</span> },
    { id: 'token', header: 'Token', accessorFn: (r) => Number(r.TOKEN_NUMBER) || 0, meta: { width: 80 }, cell: ({ row }) => <span className="tabular">{row.original.TOKEN_NUMBER || '—'}</span> },
    {
      id: 'patient', header: 'Patient', accessorFn: (r) => r.PATIENT_NAME || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.PATIENT_NAME}</span>
          <span className="cell-secondary mono">{row.original.UHID}</span>
        </span>
      ),
    },
    { id: 'agegender', header: 'Age / gender', accessorFn: (r) => Number(r.AGE) || 0, meta: { width: 120 }, cell: ({ row }) => <span className="tabular">{row.original.AGE ?? '—'} / {row.original.GENDER || '—'}</span> },
    { id: 'doctor', header: 'Doctor', accessorFn: (r) => r.DOCTOR_NAME || '' },
    { id: 'dept', header: 'Department', accessorFn: (r) => r.DEPARTMENT || '', cell: ({ getValue }) => getValue() || '—' },
    { id: 'fee', header: 'Fee', accessorFn: (r) => Number(r.FEE) || 0, meta: { width: 110, align: 'right' }, cell: ({ row }) => <span className="tabular">{row.original.FEE ? inr(row.original.FEE) : '—'}</span> },
  ], []);

  return (
    <section className="panel">
      <PanelTitle
        icon={ClipboardList}
        actions={(
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportExcel}>
            <Download size={14} aria-hidden="true" /> Export Excel
          </button>
        )}
      >
        OPD register
      </PanelTitle>
      <DateRangeFilter id="opd" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} loading={loading}>
        <div className="form-group">
          <label className="form-label" htmlFor="opd-doctor">Doctor</label>
          <select id="opd-doctor" className="form-select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
            <option value="">All doctors</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </DateRangeFilter>
      <DataTable
        columns={columns}
        data={Array.isArray(data) ? data : []}
        loading={loading}
        getRowId={(r, i) => String(r.ID ?? i)}
        pageSize={50}
        empty={generated ? <EmptyState icon={ClipboardList} title="No OPD visits" description="No visits were recorded in this date range." /> : notGenerated()}
      />
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
function RevenueTab() {
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(localYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/revenue?start_date=${startDate}&end_date=${endDate}`);
      setData({ ...res.data.data, range: [startDate, endDate] });
    } catch { toast.error('Failed to load revenue'); }
    setLoading(false);
  };

  // One bar per calendar day in the selected range, so days with no collection show as gaps, not missing days.
  const chartData = useMemo(() => {
    const byDay = {};
    (data?.dailyCollection || []).forEach((d) => {
      if (!d.DATE_VAL) return;
      const key = localKey(new Date(d.DATE_VAL));
      byDay[key] = (byDay[key] || 0) + (Number(d.DAILY_TOTAL) || 0);
    });
    const [from, to] = data?.range || [];
    if (!from || !to) return [];
    const out = [];
    const [sy, sm, sd] = from.split('-').map(Number);
    const [ey, em, ed] = to.split('-').map(Number);
    const end = new Date(ey, em - 1, ed);
    for (let d = new Date(sy, sm - 1, sd); d <= end && out.length < 400; d.setDate(d.getDate() + 1)) {
      const key = localKey(d);
      out.push({
        date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        full: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
        amount: byDay[key] || 0,
      });
    }
    return out;
  }, [data]);
  const chartTotal = chartData.reduce((s, d) => s + d.amount, 0);
  const chartAvg = chartData.length ? chartTotal / chartData.length : 0;

  return (
    <div className="stack">
      <section className="panel">
        <PanelTitle icon={Wallet}>Revenue</PanelTitle>
        <DateRangeFilter id="rev" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} loading={loading} />
        {!data && (loading ? <div className="panel-pad"><p className="muted">Loading…</p></div> : notGenerated())}
      </section>

      {data && (
        <>
          <div className="kpi-strip" style={{ marginBottom: 0 }}>
            <div className="panel kpi"><div className="kpi-label">Total billed</div><div className="kpi-value">{inr(data.totals?.TOTAL_BILLED)}</div></div>
            <div className="panel kpi"><div className="kpi-label">Total collected</div><div className="kpi-value">{inr(data.totals?.TOTAL_COLLECTED)}</div></div>
            <div className="panel kpi">
              <div className="kpi-label">Outstanding</div>
              <div className="kpi-value" style={{ color: Number(data.totals?.OUTSTANDING) > 0 ? 'var(--amber)' : undefined }}>{inr(data.totals?.OUTSTANDING)}</div>
            </div>
          </div>

          {chartData.length > 0 && (
            <section className="panel panel-pad">
              <h3 className="panel-title" style={{ marginBottom: 2 }}>Daily collection</h3>
              <p className="muted" style={{ marginBottom: 12 }}>
                {inr(chartTotal)} over {chartData.length} {chartData.length === 1 ? 'day' : 'days'} · average {inr(Math.round(chartAvg))} a day
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="date" tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} minTickGap={16} />
                  <YAxis tickFormatter={inrCompact} width={56} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} allowDecimals={false} />
                  <Tooltip content={<CollectionTooltip />} cursor={{ fill: 'var(--surface-3)', opacity: 0.6 }} />
                  {chartAvg >= 1 && (
                    <ReferenceLine
                      y={chartAvg} stroke="var(--text-muted)" strokeDasharray="4 4"
                      label={{ value: `Avg ${inrCompact(chartAvg)}`, position: 'insideTopRight', fill: 'var(--text-secondary)', fontSize: 11 }}
                    />
                  )}
                  <Bar dataKey="amount" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          <div className="split-2">
            <section className="panel panel-pad">
              <h3 className="panel-title">By department</h3>
              {(data.byDepartment || []).length === 0 ? <p className="muted">No revenue in this period.</p> : (
                <table className="mini-table">
                  <thead><tr><th>Department</th><th className="text-right">Revenue</th></tr></thead>
                  <tbody>
                    {(data.byDepartment || []).map((d, i) => (
                      <tr key={i}><td>{d.DEPARTMENT || 'N/A'}</td><td className="text-right tabular">{inr(d.REVENUE)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="panel panel-pad">
              <h3 className="panel-title">By payment mode</h3>
              {(data.byMode || []).length === 0 ? <p className="muted">No collections in this period.</p> : (
                <table className="mini-table">
                  <thead><tr><th>Mode</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>
                    {(data.byMode || []).map((d, i) => (
                      <tr key={i}><td>{d.PAYMENT_MODE}</td><td className="text-right tabular">{inr(d.TOTAL)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function PharmacySalesTab() {
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(localYmd());
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/pharmacy-sales?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
      setGenerated(true);
    } catch { toast.error('Failed to load pharmacy sales'); }
    setLoading(false);
  };

  const rows = useMemo(() => (Array.isArray(data) ? data : []).map((r, i) => ({ ...r, rank: i + 1 })), [data]);

  const columns = useMemo(() => [
    { id: 'rank', header: 'Rank', accessorFn: (r) => r.rank, meta: { width: 80 }, cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{getValue()}</span> },
    { id: 'medicine', header: 'Medicine', accessorFn: (r) => r.GENERIC_NAME || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'category', header: 'Category', accessorFn: (r) => r.CATEGORY || '', cell: ({ getValue }) => getValue() || '—' },
    { id: 'qty', header: 'Qty sold', accessorFn: (r) => Number(r.TOTAL_QTY) || 0, meta: { width: 110, align: 'right' }, cell: ({ getValue }) => <span className="tabular">{getValue()}</span> },
    { id: 'value', header: 'Value', accessorFn: (r) => Number(r.TOTAL_VALUE) || 0, meta: { width: 140, align: 'right' }, cell: ({ getValue }) => <span className="tabular" style={{ fontWeight: 600 }}>{inr(getValue())}</span> },
  ], []);

  return (
    <section className="panel">
      <PanelTitle icon={Pill}>Pharmacy sales</PanelTitle>
      <DateRangeFilter id="pharm" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} loading={loading} />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        getRowId={(r) => String(r.rank)}
        initialSorting={[{ id: 'rank', desc: false }]}
        empty={generated ? <EmptyState icon={Pill} title="No sales" description="No medicines were sold in this date range." /> : notGenerated()}
      />
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
function LabWorkloadTab() {
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate] = useState(localYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/lab-workload?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed to load lab workload'); }
    setLoading(false);
  };

  const columns = useMemo(() => [
    { id: 'patient', header: 'Patient', accessorFn: (r) => r.PATIENT_NAME || '', cell: ({ getValue }) => <span className="cell-primary">{getValue()}</span> },
    { id: 'doctor', header: 'Doctor', accessorFn: (r) => r.DOCTOR_NAME || '' },
    { id: 'test', header: 'Test', accessorFn: (r) => r.ITEM_NAME || '' },
    {
      id: 'urgency', header: 'Urgency', accessorFn: (r) => r.URGENCY || '', meta: { width: 120 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'STAT' ? 'status-danger' : 'status-neutral'}`}>{getValue() || '—'}</span>,
    },
    {
      id: 'hours', header: 'Pending for', accessorFn: (r) => Number(r.AGE_HOURS || 0), meta: { width: 140, align: 'right' },
      cell: ({ getValue }) => {
        const hrs = getValue();
        const text = `${hrs.toFixed(1)} h`;
        if (hrs > 48) return <span className="status status-danger">{text}</span>;
        if (hrs > 24) return <span className="status status-warning">{text}</span>;
        return <span className="tabular">{text}</span>;
      },
    },
  ], []);

  return (
    <div className="stack">
      <section className="panel">
        <PanelTitle icon={FlaskConical}>Lab workload</PanelTitle>
        <DateRangeFilter id="lab" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} loading={loading} />
        {!data && (loading ? <div className="panel-pad"><p className="muted">Loading…</p></div> : notGenerated())}
      </section>

      {data && (
        <>
          <div className="kpi-strip" style={{ marginBottom: 0 }}>
            <div className="panel kpi"><div className="kpi-label">Total ordered</div><div className="kpi-value">{data.total_ordered}</div></div>
            <div className="panel kpi"><div className="kpi-label">Completed</div><div className="kpi-value">{data.total_completed}</div></div>
            <div className="panel kpi">
              <div className="kpi-label">Pending</div>
              <div className="kpi-value" style={{ color: (data.pending_list || []).length > 0 ? 'var(--amber)' : undefined }}>{(data.pending_list || []).length}</div>
            </div>
          </div>

          <section className="panel">
            <PanelTitle icon={ClipboardList}>Pending orders</PanelTitle>
            <DataTable
              columns={columns}
              data={data.pending_list || []}
              loading={loading}
              getRowId={(r, i) => String(i)}
              initialSorting={[{ id: 'hours', desc: true }]}
              empty={<EmptyState icon={FlaskConical} title="No pending orders" description="Every lab order in this range has been completed." />}
            />
          </section>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function AuditTrailTab() {
  const [data, setData] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [moduleFilter, setModuleFilter] = useState('');
  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate, setEndDate] = useState(localYmd());

  const fetchData = async (p = 1) => {
    setLoading(true);
    try {
      let url = `/reports/audit-trail?page=${p}&limit=50&start_date=${startDate}&end_date=${endDate}`;
      if (moduleFilter) url += `&module=${moduleFilter}`;
      const res = await api.get(url);
      setData(res.data.data);
      setTotalPages(res.data.total_pages);
      setPage(p);
      setGenerated(true);
    } catch { toast.error('Failed to load audit trail'); }
    setLoading(false);
  };

  const rows = Array.isArray(data) ? data : [];

  return (
    <section className="panel">
      <PanelTitle icon={ScrollText}>Audit trail</PanelTitle>
      <DateRangeFilter id="audit" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={() => fetchData(1)} loading={loading}>
        <div className="form-group">
          <label className="form-label" htmlFor="audit-module">Module</label>
          <select id="audit-module" className="form-select" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
            <option value="">All modules</option>
            <option>auth</option><option>billing</option><option>admin</option><option>pharmacy</option><option>ipd</option>
          </select>
        </div>
      </DateRangeFilter>

      <div className="dt">
        <div className="dt-scroll">
          <table className="dt-table">
            <thead>
              <tr>
                <th style={{ width: 190 }}>Time</th><th>User</th><th style={{ width: 150 }}>Role</th>
                <th>Action</th><th style={{ width: 120 }}>Module</th><th style={{ width: 150 }}>IP address</th>
              </tr>
            </thead>
            <tbody>
              {loading && Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk-${i}`} className="dt-skeleton-row" aria-hidden="true">
                  {Array.from({ length: 6 }).map((__, j) => <td key={j}><span className="skeleton" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>)}
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="dt-empty-cell">
                    {generated ? <EmptyState icon={ScrollText} title="No audit records" description="No activity was logged for these filters." /> : notGenerated()}
                  </td>
                </tr>
              )}
              {!loading && rows.map((r) => (
                <tr key={r.ID}>
                  <td className="tabular">{r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleString('en-IN') : '—'}</td>
                  <td className="cell-primary">{r.USERNAME}</td>
                  <td>{r.ROLE}</td>
                  <td>{r.ACTION}</td>
                  <td><span className="tag">{r.MODULE}</span></td>
                  <td className="mono">{r.IP_ADDRESS}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {generated && !loading && rows.length > 0 && (
          <div className="dt-footer">
            <span className="dt-count">Page <strong>{page}</strong> of <strong>{totalPages}</strong></span>
            <div className="dt-pager">
              <button type="button" className="icon-btn" disabled={page <= 1} onClick={() => fetchData(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
              <button type="button" className="icon-btn" disabled={page >= totalPages} onClick={() => fetchData(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
function DoctorPerformanceTab() {
  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(localYmd());
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/users?role=doctor').then((r) => setDoctors(r.data.data || [])).catch(() => {}); }, []);

  const fetchData = async () => {
    if (!doctorId) return toast.error('Select a doctor first');
    setLoading(true);
    try {
      const res = await api.get(`/reports/doctor-performance?doctor_id=${doctorId}&start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed to load doctor performance'); }
    setLoading(false);
  };

  return (
    <div className="stack">
      <section className="panel">
        <PanelTitle icon={Stethoscope}>Doctor performance</PanelTitle>
        <DateRangeFilter id="docperf" startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} loading={loading}>
          <div className="form-group">
            <label className="form-label" htmlFor="docperf-doctor">Doctor</label>
            <select id="docperf-doctor" className="form-select" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
              <option value="">Select doctor</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </DateRangeFilter>
        {!data && (loading ? <div className="panel-pad"><p className="muted">Loading…</p></div> : notGenerated('Choose a doctor and date range, then select Generate.'))}
      </section>

      {data && (
        <div className="kpi-strip" style={{ marginBottom: 0 }}>
          <div className="panel kpi"><div className="kpi-label">Patients seen</div><div className="kpi-value">{data.encounters}</div></div>
          <div className="panel kpi"><div className="kpi-label">Prescriptions</div><div className="kpi-value">{data.prescriptions}</div></div>
          <div className="panel kpi"><div className="kpi-label">Lab orders</div><div className="kpi-value">{data.labOrders}</div></div>
          <div className="panel kpi"><div className="kpi-label">Revenue generated</div><div className="kpi-value">{inr(data.revenue)}</div></div>
        </div>
      )}
    </div>
  );
}
