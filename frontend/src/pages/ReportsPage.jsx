import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import { openAuthenticatedBlob } from '../utils/authenticatedDownload';

const TABS = ['OPD Register', 'Revenue', 'Pharmacy Sales', 'Lab Workload', 'Audit Trail', 'Doctor Performance'];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <>
      <Navbar />
      <div className="page-wrapper fade-up">
        <h2 style={{ marginBottom: 24 }}>Reports & Analytics</h2>
        <div style={{ display: 'flex', gap: 24 }}>
          <div className="card" style={{ width: 200, padding: 0, flexShrink: 0 }}>
            {TABS.map((tab, i) => (
              <div key={tab} onClick={() => setActiveTab(i)} style={{
                padding: '13px 18px', cursor: 'pointer', fontSize: '0.88rem', fontWeight: activeTab === i ? 600 : 400,
                background: activeTab === i ? 'var(--primary-color)' : 'transparent',
                color: activeTab === i ? '#fff' : 'var(--text-primary)',
                borderBottom: '1px solid var(--border)', transition: 'all 0.15s',
              }}>{tab}</div>
            ))}
          </div>
          <div style={{ flex: 1 }}>
            {activeTab === 0 && <OPDRegisterTab />}
            {activeTab === 1 && <RevenueTab />}
            {activeTab === 2 && <PharmacySalesTab />}
            {activeTab === 3 && <LabWorkloadTab />}
            {activeTab === 4 && <AuditTrailTab />}
            {activeTab === 5 && <DoctorPerformanceTab />}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Date Range Component (reusable) ─────────────────
function DateRangeFilter({ startDate, endDate, setStartDate, setEndDate, onFetch, children }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap' }}>
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>From</label>
        <input type="date" className="form-control" value={startDate} onChange={e => setStartDate(e.target.value)} />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>To</label>
        <input type="date" className="form-control" value={endDate} onChange={e => setEndDate(e.target.value)} />
      </div>
      {children}
      <button className="btn btn-primary" onClick={onFetch} style={{ height: 40 }}>Generate</button>
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────
function KPICard({ label, value, color, icon }) {
  return (
    <div className="card" style={{ padding: '20px 18px', position: 'relative', overflow: 'hidden', flex: 1, minWidth: 160 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function OPDRegisterTab() {
  const today = new Date().toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [dept, setDept] = useState('');

  useEffect(() => { api.get('/users?role=doctor').then(r => setDoctors(r.data.data || [])).catch(() => {}); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      let url = `/reports/opd-register?start_date=${startDate}&end_date=${endDate}`;
      if (doctorId) url += `&doctor_id=${doctorId}`;
      if (dept) url += `&department=${dept}`;
      const res = await api.get(url);
      setData(res.data.data);
    } catch { toast.error('Failed to load OPD register'); }
    setLoading(false);
  };

  const exportExcel = async () => {
    let url = `/reports/opd-register?start_date=${startDate}&end_date=${endDate}&export=excel`;
    if (doctorId) url += `&doctor_id=${doctorId}`;
    if (dept) url += `&department=${dept}`;
    try {
      await openAuthenticatedBlob(url, { download: true, filename: 'opd-register.xlsx' });
    } catch {
      toast.error('Failed to export OPD register');
    }
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ marginBottom: 16 }}>OPD Register</h3>
      <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Doctor</label>
          <select className="form-control" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
            <option value="">All</option>
            {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button className="btn btn-outline" onClick={exportExcel} style={{ height: 40 }}>Export Excel</button>
      </DateRangeFilter>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: 10 }}>Date</th><th style={{ padding: 10 }}>Token</th><th style={{ padding: 10 }}>UHID</th>
              <th style={{ padding: 10 }}>Name</th><th style={{ padding: 10 }}>Age</th><th style={{ padding: 10 }}>Gender</th>
              <th style={{ padding: 10 }}>Doctor</th><th style={{ padding: 10 }}>Dept</th><th style={{ padding: 10 }}>Fee</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? <tr><td colSpan="9" style={{ padding: 20, textAlign: 'center' }}>No records found</td></tr> :
              data.map(r => (
                <tr key={r.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>{r.ENCOUNTER_DATE ? new Date(r.ENCOUNTER_DATE).toLocaleDateString('en-IN') : ''}</td>
                  <td style={{ padding: 10 }}>{r.TOKEN_NUMBER || '-'}</td>
                  <td style={{ padding: 10, fontWeight: 500 }}>{r.UHID}</td>
                  <td style={{ padding: 10 }}>{r.PATIENT_NAME}</td>
                  <td style={{ padding: 10 }}>{r.AGE}</td>
                  <td style={{ padding: 10 }}>{r.GENDER}</td>
                  <td style={{ padding: 10 }}>{r.DOCTOR_NAME}</td>
                  <td style={{ padding: 10 }}>{r.DEPARTMENT || '-'}</td>
                  <td style={{ padding: 10 }}>{r.FEE ? `Rs.${r.FEE}` : '-'}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function RevenueTab() {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/revenue?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed to load revenue'); }
    setLoading(false);
  };

  const chartData = data?.dailyCollection?.map(d => ({
    date: d.DATE_VAL ? new Date(d.DATE_VAL).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
    amount: Number(d.DAILY_TOTAL) || 0,
  })) || [];

  return (
    <div>
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 16 }}>Revenue Report</h3>
        <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} />
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <KPICard label="Total Billed" value={`Rs.${Number(data.totals.TOTAL_BILLED || 0).toLocaleString()}`} color="var(--blue)" icon="💰" />
            <KPICard label="Total Collected" value={`Rs.${Number(data.totals.TOTAL_COLLECTED || 0).toLocaleString()}`} color="#48bb78" icon="✅" />
            <KPICard label="Outstanding" value={`Rs.${Number(data.totals.OUTSTANDING || 0).toLocaleString()}`} color="#e53e3e" icon="⚠️" />
          </div>

          {chartData.length > 0 && (
            <div className="card" style={{ padding: 24, marginBottom: 20 }}>
              <h4 style={{ marginBottom: 16 }}>Daily Collection Trend</h4>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="amount" fill="#0f4c81" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div style={{ display: 'flex', gap: 20 }}>
            <div className="card" style={{ padding: 20, flex: 1 }}>
              <h4 style={{ marginBottom: 12 }}>By Department</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ padding: 8, textAlign: 'left' }}>Department</th><th style={{ padding: 8, textAlign: 'right' }}>Revenue</th></tr></thead>
                <tbody>{(data.byDepartment || []).map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: 8 }}>{d.DEPARTMENT || 'N/A'}</td><td style={{ padding: 8, textAlign: 'right' }}>Rs.{Number(d.REVENUE || 0).toLocaleString()}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <div className="card" style={{ padding: 20, flex: 1 }}>
              <h4 style={{ marginBottom: 12 }}>By Payment Mode</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ padding: 8, textAlign: 'left' }}>Mode</th><th style={{ padding: 8, textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>{(data.byMode || []).map((d, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: 8 }}>{d.PAYMENT_MODE}</td><td style={{ padding: 8, textAlign: 'right' }}>Rs.{Number(d.TOTAL || 0).toLocaleString()}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function PharmacySalesTab() {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/pharmacy-sales?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed'); }
    setLoading(false);
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ marginBottom: 16 }}>Pharmacy Sales Report</h3>
      <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} />
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
          <thead><tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-secondary)' }}>
            <th style={{ padding: 10 }}>Rank</th><th style={{ padding: 10 }}>Medicine</th><th style={{ padding: 10 }}>Category</th>
            <th style={{ padding: 10 }}>Qty Sold</th><th style={{ padding: 10, textAlign: 'right' }}>Value (Rs.)</th>
          </tr></thead>
          <tbody>{data.length === 0 ? <tr><td colSpan="5" style={{ padding: 20, textAlign: 'center' }}>No data</td></tr> :
            data.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 10, fontWeight: 600, color: 'var(--primary-color)' }}>{i + 1}</td>
                <td style={{ padding: 10 }}>{r.GENERIC_NAME}</td>
                <td style={{ padding: 10 }}>{r.CATEGORY}</td>
                <td style={{ padding: 10 }}>{r.TOTAL_QTY}</td>
                <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>Rs.{Number(r.TOTAL_VALUE || 0).toLocaleString()}</td>
              </tr>
            ))
          }</tbody>
        </table>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function LabWorkloadTab() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/reports/lab-workload?start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed'); }
    setLoading(false);
  };

  return (
    <div>
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 16 }}>Lab Workload Report</h3>
        <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData} />
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
            <KPICard label="Total Ordered" value={data.total_ordered} color="var(--blue)" icon="📋" />
            <KPICard label="Completed" value={data.total_completed} color="#48bb78" icon="✅" />
            <KPICard label="Pending" value={data.pending_list.length} color="#e53e3e" icon="⏳" />
          </div>

          <div className="card" style={{ padding: 24 }}>
            <h4 style={{ marginBottom: 16 }}>Pending Orders</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead><tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: 10 }}>Patient</th><th style={{ padding: 10 }}>Doctor</th><th style={{ padding: 10 }}>Test</th>
                <th style={{ padding: 10 }}>Urgency</th><th style={{ padding: 10 }}>Hours Pending</th>
              </tr></thead>
              <tbody>{data.pending_list.length === 0 ? <tr><td colSpan="5" style={{ padding: 20, textAlign: 'center' }}>All clear!</td></tr> :
                data.pending_list.map((r, i) => {
                  const hrs = Number(r.AGE_HOURS || 0);
                  const rowColor = hrs > 48 ? '#fed7d720' : hrs > 24 ? '#fefcbf20' : 'transparent';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: rowColor }}>
                      <td style={{ padding: 10 }}>{r.PATIENT_NAME}</td>
                      <td style={{ padding: 10 }}>{r.DOCTOR_NAME}</td>
                      <td style={{ padding: 10 }}>{r.ITEM_NAME}</td>
                      <td style={{ padding: 10 }}>
                        <span style={{ padding: '2px 6px', borderRadius: 8, fontSize: '0.8rem', background: r.URGENCY === 'STAT' ? '#e53e3e20' : '#ecc94b20', color: r.URGENCY === 'STAT' ? '#e53e3e' : '#d69e2e' }}>{r.URGENCY}</span>
                      </td>
                      <td style={{ padding: 10, fontWeight: 600, color: hrs > 48 ? '#e53e3e' : hrs > 24 ? '#d69e2e' : 'var(--text-primary)' }}>{hrs.toFixed(1)}h</td>
                    </tr>
                  );
                })
              }</tbody>
            </table>
          </div>
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
  const [moduleFilter, setModuleFilter] = useState('');
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(today);

  const fetchData = async (p = 1) => {
    setLoading(true);
    try {
      let url = `/reports/audit-trail?page=${p}&limit=50&start_date=${startDate}&end_date=${endDate}`;
      if (moduleFilter) url += `&module=${moduleFilter}`;
      const res = await api.get(url);
      setData(res.data.data);
      setTotalPages(res.data.total_pages);
      setPage(p);
    } catch { toast.error('Failed'); }
    setLoading(false);
  };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 style={{ marginBottom: 16 }}>Audit Trail</h3>
      <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={() => fetchData(1)}>
        <div className="form-group" style={{ margin: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Module</label>
          <select className="form-control" value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}>
            <option value="">All</option>
            <option>auth</option><option>billing</option><option>admin</option><option>pharmacy</option><option>ipd</option>
          </select>
        </div>
      </DateRangeFilter>

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div> : (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead><tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-secondary)' }}>
              <th style={{ padding: 10 }}>Timestamp</th><th style={{ padding: 10 }}>User</th><th style={{ padding: 10 }}>Role</th>
              <th style={{ padding: 10 }}>Action</th><th style={{ padding: 10 }}>Module</th><th style={{ padding: 10 }}>IP</th>
            </tr></thead>
            <tbody>{data.length === 0 ? <tr><td colSpan="6" style={{ padding: 20, textAlign: 'center' }}>No records</td></tr> :
              data.map(r => (
                <tr key={r.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>{r.CREATED_AT ? new Date(r.CREATED_AT).toLocaleString() : ''}</td>
                  <td style={{ padding: 10 }}>{r.USERNAME}</td>
                  <td style={{ padding: 10 }}>{r.ROLE}</td>
                  <td style={{ padding: 10 }}>{r.ACTION}</td>
                  <td style={{ padding: 10 }}>{r.MODULE}</td>
                  <td style={{ padding: 10, fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.IP_ADDRESS}</td>
                </tr>
              ))
            }</tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button className="btn btn-outline" disabled={page <= 1} onClick={() => fetchData(page - 1)}>Previous</button>
            <span style={{ padding: '8px 12px', fontSize: '0.9rem' }}>Page {page} of {totalPages}</span>
            <button className="btn btn-outline" disabled={page >= totalPages} onClick={() => fetchData(page + 1)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
function DoctorPerformanceTab() {
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(monthAgo);
  const [endDate, setEndDate] = useState(today);
  const [doctorId, setDoctorId] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { api.get('/users?role=doctor').then(r => setDoctors(r.data.data || [])).catch(() => {}); }, []);

  const fetchData = async () => {
    if (!doctorId) return toast.error('Please select a doctor');
    setLoading(true);
    try {
      const res = await api.get(`/reports/doctor-performance?doctor_id=${doctorId}&start_date=${startDate}&end_date=${endDate}`);
      setData(res.data.data);
    } catch { toast.error('Failed'); }
    setLoading(false);
  };

  return (
    <div>
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h3 style={{ marginBottom: 16 }}>Doctor Performance</h3>
        <DateRangeFilter startDate={startDate} endDate={endDate} setStartDate={setStartDate} setEndDate={setEndDate} onFetch={fetchData}>
          <div className="form-group" style={{ margin: 0 }}>
            <label style={{ fontSize: '0.8rem' }}>Doctor</label>
            <select className="form-control" value={doctorId} onChange={e => setDoctorId(e.target.value)} required>
              <option value="">Select Doctor</option>
              {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </DateRangeFilter>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>}

      {data && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <KPICard label="Patients Seen" value={data.encounters} color="var(--blue)" icon="👥" />
          <KPICard label="Prescriptions" value={data.prescriptions} color="#48bb78" icon="📝" />
          <KPICard label="Lab Orders" value={data.labOrders} color="#d69e2e" icon="🔬" />
          <KPICard label="Revenue Generated" value={`Rs.${Number(data.revenue || 0).toLocaleString()}`} color="#0f4c81" icon="💰" />
        </div>
      )}
    </div>
  );
}
