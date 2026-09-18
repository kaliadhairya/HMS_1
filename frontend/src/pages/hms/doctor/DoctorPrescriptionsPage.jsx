import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const CONSULTED_STATUSES = new Set(['Consulted', 'Finalized']);

function isConsultedStatus(status) {
  return CONSULTED_STATUSES.has(status);
}

function isConsultedPrescription(rx) {
  return isConsultedStatus(rx.status) || Number(rx.medicine_count || 0) > 0;
}

function getPatientTypeMeta(type) {
  if (type === 'corporate_employee') return { label: 'Corporate', bg: 'rgba(59,130,246,0.1)', color: '#2563eb', border: 'rgba(59,130,246,0.2)' };
  if (type === 'cisf_employee') return { label: 'CISF', bg: 'rgba(99,102,241,0.1)', color: '#4f46e5', border: 'rgba(99,102,241,0.2)' };
  return { label: 'General', bg: 'rgba(16,185,129,0.1)', color: '#059669', border: 'rgba(16,185,129,0.2)' };
}

function getPrescriptionStatusLabel(rx) {
  if (rx.status === 'Finalized') return 'Finalized';
  if (isConsultedPrescription(rx)) return 'Consulted';
  return rx.status || 'Pending';
}

const DEFAULT_FILTERS = {
  patientName: '',
  empNo: '',
  phoneNo: '',
  fromDate: '',
  toDate: '',
  patientType: '',
  prescribedBy: '',
};

const PATIENT_TYPE_FILTERS = [
  { value: '', label: 'All Types' },
  { value: 'corporate_employee', label: 'Corporate Employee / Dependent' },
  { value: 'cisf_employee', label: 'CISF Employee' },
  { value: 'other', label: 'General Patient' },
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesFilter(value, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return true;
  return normalizeText(value).includes(normalizedQuery);
}

function getLocalDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getDoctorName(rx) {
  const name = rx.doctor_name || rx.doctor_username;
  if (name) return name;
  return rx.doctor_id ? 'Doctor #' + rx.doctor_id : '-';
}

export default function DoctorPrescriptionsPage() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentUserId = user?.id ?? user?.ID;

  const fetchPrescriptions = () => {
    setLoading(true);
    api.get('/doctor/prescriptions?scope=all')
      .then(res => setPrescriptions(res.data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPrescriptions();
  }, []);

  const handleDelete = async (e, rx) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `⚠️ WARNING: Are you sure you want to permanently DELETE the prescription for "${rx.patient_name}" (Rx ID: ${rx.id})?\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await api.delete(`/doctor/prescriptions/${rx.id}`);
      toast.success('Prescription deleted.');
      fetchPrescriptions();
    } catch (err) {
      toast.error('Error deleting prescription.');
    }
  };

  const updateFilter = (name, value) => {
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const prescribedByOptions = useMemo(() => {
    const seen = new Map();
    prescriptions.forEach((rx) => {
      const doctorName = getDoctorName(rx);
      if (doctorName && doctorName !== '-') {
        seen.set(normalizeText(doctorName), doctorName);
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [prescriptions]);

  const filtered = useMemo(() => prescriptions.filter((rx) => {
    const rxDate = getLocalDateKey(rx.created_at);
    const search = normalizeText(searchQuery);
    const doctorName = getDoctorName(rx);
    if (search) {
      const searchable = [
        rx.patient_name,
        rx.uhid,
        rx.emp_number,
        rx.phone_number,
        doctorName,
        rx.diagnosis,
        rx.id ? 'rx-' + rx.id : '',
      ].map(normalizeText).join(' ');
      if (!searchable.includes(search)) return false;
    }
    if (!matchesFilter(rx.patient_name, filters.patientName)) return false;
    if (!matchesFilter(rx.emp_number, filters.empNo)) return false;
    if (!matchesFilter(rx.phone_number, filters.phoneNo)) return false;
    if (filters.patientType && rx.patient_type !== filters.patientType) return false;
    if (filters.prescribedBy && doctorName !== filters.prescribedBy) return false;
    if (filters.fromDate && (!rxDate || rxDate < filters.fromDate)) return false;
    if (filters.toDate && (!rxDate || rxDate > filters.toDate)) return false;
    return true;
  }), [prescriptions, searchQuery, filters]);

  const pendingCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Pending').length;
  const consultedCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Consulted').length;
  const finalizedCount = filtered.filter(r => getPrescriptionStatusLabel(r) === 'Finalized').length;

  const exportToCSV = () => {
    if (filtered.length === 0) {
      toast.error('No data to export.');
      return;
    }

    const headers = [
      'Date', 'Rx ID', 'Patient Name', 'Patient Type', 'UHID', 'Emp Number',
      'Phone Number', 'Prescribed By', 'Diagnosis', 'Medicines Count', 'Status'
    ];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = filtered.map(rx => [
      escapeCSV(rx.created_at ? new Date(rx.created_at).toLocaleDateString('en-IN') : ''),
      escapeCSV('Rx-' + rx.id),
      escapeCSV(rx.patient_name),
      escapeCSV(getPatientTypeMeta(rx.patient_type).label),
      escapeCSV(rx.uhid),
      escapeCSV(rx.emp_number),
      escapeCSV(rx.phone_number),
      escapeCSV(getDoctorName(rx)),
      escapeCSV(rx.diagnosis),
      escapeCSV(rx.medicine_count || 0),
      escapeCSV(getPrescriptionStatusLabel(rx)),
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `Prescription_Hub_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} prescriptions to CSV!`);
  };

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">📋</span>
              Prescription Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              View, edit, and manage all saved prescriptions.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/hms/prescription-slip')}>
              + Write New Prescription
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="hms-anim-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #f59e0b', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Pending</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b' }}>{pendingCount}</div>
          </div>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #10b981', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Consulted</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981' }}>{consultedCount}</div>
          </div>
          <div className="hms-stat-card" style={{ padding: 18, borderLeft: '4px solid #3b82f6', cursor: 'default' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.08em', marginBottom: 4 }}>Finalized</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#3b82f6' }}>{finalizedCount}</div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="hms-anim-3" style={{ marginBottom: showFilters ? 0 : 24 }}>
          <div className="card" style={{
            padding: '12px 20px',
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
            <span style={{ fontSize: '1.4rem', filter: 'grayscale(0.5)' }}>🔍</span>
            <input
              type="text"
              className="form-input"
              style={{
                fontSize: '1.1rem',
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
                padding: '10px 0',
                flex: 1,
              }}
              placeholder="Search by Patient Name, UHID, Emp No, Phone No, or Doctor..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {loading && <div className="spinner" style={{ width: 22, height: 22 }} />}
            <button
              type="button"
              onClick={() => setShowFilters(prev => !prev)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '8px 18px', borderRadius: 20,
                border: showFilters ? '2px solid var(--green)' : '2px solid var(--border)',
                background: showFilters ? 'rgba(16,185,129,0.08)' : 'var(--surface-2)',
                color: showFilters ? 'var(--green)' : 'var(--text-secondary)',
                fontSize: '0.84rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.2s',
                flexShrink: 0,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filter
              {activeFilterCount > 0 && (
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--green)', color: '#fff',
                  fontSize: '0.68rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1,
                }}>
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search Filters Panel */}
        {showFilters && (
          <div className="hms-anim-1" style={{ marginTop: 16, marginBottom: 24 }}>
            <div className="card" style={{
              padding: '20px 28px 24px',
              borderTop: '3px solid var(--green)',
              borderRadius: 16,
              background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 800,
                  textTransform: 'uppercase', letterSpacing: '0.12em',
                  color: 'var(--green)',
                }}>
                  Search Filters
                </span>
                <div style={{
                  flex: 1, height: 2,
                  background: 'linear-gradient(90deg, var(--green), transparent)',
                  borderRadius: 2,
                }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px 20px', marginBottom: 20 }}>
                <div>
                  <label className="form-label">Patient Name</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search patient"
                    value={filters.patientName}
                    onChange={e => updateFilter('patientName', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Emp No</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Employee no"
                    value={filters.empNo}
                    onChange={e => updateFilter('empNo', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Phone No</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Phone no"
                    value={filters.phoneNo}
                    onChange={e => updateFilter('phoneNo', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">From Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.fromDate}
                    onChange={e => updateFilter('fromDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">To Date</label>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.toDate}
                    onChange={e => updateFilter('toDate', e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Patient Type</label>
                  <select
                    className="form-input"
                    value={filters.patientType}
                    onChange={e => updateFilter('patientType', e.target.value)}
                  >
                    {PATIENT_TYPE_FILTERS.map(option => (
                      <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Prescribed By</label>
                  <select
                    className="form-input"
                    value={filters.prescribedBy}
                    onChange={e => updateFilter('prescribedBy', e.target.value)}
                  >
                    <option value="">All Doctors</option>
                    {prescribedByOptions.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                  disabled={activeFilterCount === 0}
                  style={{ borderRadius: 10 }}
                >
                  Clear Filters
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowFilters(false)}
                  style={{ borderRadius: 10 }}
                >
                  Search
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results count bar */}
        {filtered.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 4px', marginTop: 16,
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Showing <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong> prescription{filtered.length !== 1 ? 's' : ''}
              {activeFilterCount > 0 && (
                <span style={{
                  marginLeft: 10, padding: '2px 10px', borderRadius: 10,
                  background: 'rgba(16,185,129,0.1)', color: 'var(--green)',
                  fontSize: '0.72rem', fontWeight: 700,
                  border: '1px solid rgba(16,185,129,0.2)',
                }}>
                  {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
                </span>
              )}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={exportToCSV}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '7px 18px', borderRadius: 10,
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.82rem', fontWeight: 700,
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.color = '#059669'; e.currentTarget.style.background = 'rgba(16,185,129,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--surface)'; }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Export to Excel
              </button>
            </div>
          </div>
        )}

        {/* Prescription Table */}
        <div className="card hms-anim-4" style={{ padding: 0, overflow: 'hidden', marginTop: filtered.length > 0 ? 0 : 24 }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, gap: 12 }}>
              <div className="spinner" style={{ width: 28, height: 28 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading prescriptions...</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24 }}>
              <span className="empty-icon">📭</span>
              <h3>{searchQuery || activeFilterCount ? 'No Results Found' : 'No Prescriptions Yet'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                {searchQuery || activeFilterCount ? 'No prescriptions match the current search or filters.' : 'No prescriptions have been saved yet.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Rx ID</th>
                    <th>Patient</th>
                    <th>Prescribed By</th>
                    <th>UHID</th>
                    <th>Diagnosis</th>
                    <th>Meds</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((rx) => {
                    const label = getPrescriptionStatusLabel(rx);
                    const typeMeta = getPatientTypeMeta(rx.patient_type);
                    const doctorName = getDoctorName(rx);
                    const isOwnPrescription = String(rx.doctor_id || '') === String(currentUserId || '');
                    return (
                      <tr key={rx.id}>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          <div>{rx.created_at ? new Date(rx.created_at).toLocaleDateString('en-GB') : '-'}</div>
                          {rx.created_at && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{new Date(rx.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</div>}
                        </td>
                        <td><strong style={{ color: 'var(--blue)' }}>Rx-{rx.id}</strong></td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{rx.patient_name || '-'}</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: typeMeta.bg,
                              color: typeMeta.color,
                              border: `1px solid ${typeMeta.border}`,
                            }}>
                              {typeMeta.label}
                            </span>
                            {rx.emp_number && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Emp: {rx.emp_number}</span>}
                            {rx.phone_number && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Ph: {rx.phone_number}</span>}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{doctorName}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>Doctor</div>
                        </td>
                        <td style={{ fontWeight: 600, color: 'var(--green)' }}>{rx.uhid || '-'}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {rx.diagnosis || '-'}
                        </td>
                        <td>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 30, height: 30, borderRadius: '50%',
                            background: 'rgba(16,185,129,0.1)', color: '#059669',
                            fontWeight: 800, fontSize: '0.85rem',
                            border: '1px solid rgba(16,185,129,0.2)',
                          }}>
                            {rx.medicine_count || 0}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            padding: '3px 12px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
                            background: label === 'Consulted' ? 'rgba(16,185,129,0.1)'
                                     : label === 'Finalized' ? 'rgba(59,130,246,0.1)'
                                     : 'rgba(245,158,11,0.1)',
                            color: label === 'Consulted' ? '#059669'
                                 : label === 'Finalized' ? '#2563eb'
                                 : '#d97706',
                            border: `1px solid ${label === 'Consulted' ? 'rgba(16,185,129,0.2)'
                                               : label === 'Finalized' ? 'rgba(59,130,246,0.2)'
                                               : 'rgba(245,158,11,0.2)'}`,
                          }}>
                            {label}
                          </span>
                        </td>
                      <td>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                          <button className="btn btn-sm btn-outline"
                            style={{ color: '#2563eb', borderColor: 'rgba(37,99,235,0.2)' }}
                            onClick={() => navigate(`/hms/prescription-slip?encounterId=${rx.encounter_id}&patientId=${rx.patient_id}`)}
                          >
                            ✏️ Edit
                          </button>
                          {isOwnPrescription && (
                            <button className="btn btn-sm btn-danger"
                              onClick={(e) => handleDelete(e, rx)}
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
