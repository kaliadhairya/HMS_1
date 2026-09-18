import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

const PATIENT_TYPE_META = {
  corporate_employee: { label: 'Corporate Employee', shortLabel: 'Corp Emp', bg: 'rgba(59, 130, 246, 0.1)', color: '#2563eb', border: 'rgba(59, 130, 246, 0.2)' },
  cisf_employee: { label: 'CISF Employee', shortLabel: 'CISF', bg: 'rgba(99, 102, 241, 0.1)', color: '#4f46e5', border: 'rgba(99, 102, 241, 0.2)' },
  other: { label: 'General / External', shortLabel: 'General', bg: 'rgba(16, 185, 129, 0.1)', color: '#059669', border: 'rgba(16, 185, 129, 0.2)' },
};

const getPatientTypeMeta = (type) => PATIENT_TYPE_META[type] || PATIENT_TYPE_META.other;

const INITIAL_FILTERS = {
  empNumber: '',
  phoneNumber: '',
  fromDate: '',
  toDate: '',
  patientType: '',
  doctorId: '',
};

export default function PatientSearchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const [doctors, setDoctors] = useState([]);
  const [selectedPatientIds, setSelectedPatientIds] = useState([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const isSuperAdmin = user?.role === 'super_admin';

  const buildSearchParams = (q, f) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (f.empNumber) params.set('empNumber', f.empNumber);
    if (f.phoneNumber) params.set('phoneNumber', f.phoneNumber);
    if (f.fromDate) params.set('fromDate', f.fromDate);
    if (f.toDate) params.set('toDate', f.toDate);
    if (f.patientType) params.set('patientType', f.patientType);
    if (f.doctorId) params.set('doctorId', f.doctorId);
    return params.toString();
  };

  const countActiveFilters = (f) => {
    return Object.values(f).filter(v => v && String(v).trim() !== '').length;
  };

  const searchPatients = async (q, f = filters) => {
    setLoading(true);
    try {
      const paramStr = buildSearchParams(q, f);
      const res = await api.get(`/patients/hms/search?${paramStr}`);
      setResults(res.data.data);
      setActiveFilterCount(countActiveFilters(f));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  };

  const debouncedSearch = useCallback(debounce((q) => searchPatients(q), 400), [filters]);

  const getPatientId = (patient) => patient?.id || patient?.ID;
  const visiblePatientIds = useMemo(
    () => results.map(getPatientId).filter(Boolean),
    [results]
  );
  const selectedVisibleCount = visiblePatientIds.filter(id => selectedPatientIds.includes(id)).length;
  const allVisibleSelected = visiblePatientIds.length > 0 && selectedVisibleCount === visiblePatientIds.length;
  const selectedPatients = useMemo(
    () => results.filter(patient => selectedPatientIds.includes(getPatientId(patient))),
    [results, selectedPatientIds]
  );
  const selectedPatientCount = selectedPatients.length;

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    debouncedSearch(val);
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const handleFilterSearch = () => {
    searchPatients(query, filters);
  };

  const handleClearFilters = () => {
    setFilters(INITIAL_FILTERS);
    setActiveFilterCount(0);
    searchPatients(query, INITIAL_FILTERS);
  };

  useEffect(() => {
    searchPatients('');

    // Fetch active doctors list for the filter dropdown
    api.get('/hms/doctors')
      .then(res => {
        if (res.data && res.data.success) {
          setDoctors(res.data.data);
        }
      })
      .catch(err => console.error('Error fetching doctors:', err));
  }, []);

  useEffect(() => {
    setSelectedPatientIds(prev => prev.filter(id => visiblePatientIds.includes(id)));
  }, [visiblePatientIds]);

  const toggleSelectAllVisible = (e) => {
    e.stopPropagation();
    setSelectedPatientIds(allVisibleSelected ? [] : visiblePatientIds);
  };

  const togglePatientSelection = (e, patientId) => {
    e.stopPropagation();
    if (!patientId) return;
    setSelectedPatientIds(prev => (
      prev.includes(patientId)
        ? prev.filter(id => id !== patientId)
        : [...prev, patientId]
    ));
  };

  const handleDelete = async (e, patientId, patientName) => {
    e.stopPropagation();
    const confirmed = window.confirm(`⚠️ WARNING: Are you sure you want to permanently DELETE patient "${patientName}" (ID: ${patientId})?\n\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.delete(`/patients/${patientId}`);
      setSelectedPatientIds(prev => prev.filter(id => id !== patientId));
      toast.success('Patient record deleted.');
      searchPatients(query);
    } catch (err) {
      toast.error('Deletion failed. Records may be linked.');
    }
  };

  const handleBulkDelete = async () => {
    if (!isSuperAdmin || selectedPatientCount === 0 || deletingSelected) return;

    const selectedNames = selectedPatients
      .slice(0, 4)
      .map(patient => patient.patient_name || patient.NAME || patient.name)
      .filter(Boolean);
    const extraCount = selectedPatientCount - selectedNames.length;
    const preview = selectedNames.length
      ? `\n\nSelected: ${selectedNames.join(', ')}${extraCount > 0 ? `, +${extraCount} more` : ''}`
      : '';

    const confirmed = window.confirm(
      `⚠️ WARNING: Are you sure you want to permanently DELETE ${selectedPatientCount} selected patient${selectedPatientCount > 1 ? 's' : ''}?${preview}\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingSelected(true);
    const deletedIds = [];
    let failedCount = 0;

    for (const patient of selectedPatients) {
      const patientId = getPatientId(patient);
      if (!patientId) {
        failedCount += 1;
        continue;
      }

      try {
        await api.delete(`/patients/${patientId}`);
        deletedIds.push(patientId);
      } catch (err) {
        failedCount += 1;
      }
    }

    setSelectedPatientIds(prev => prev.filter(id => !deletedIds.includes(id)));
    setDeletingSelected(false);
    searchPatients(query, filters);

    if (failedCount > 0) {
      toast.error(`${failedCount} selected patient${failedCount > 1 ? 's' : ''} could not be deleted. Records may be linked.`);
      return;
    }

    toast.success(`Deleted ${deletedIds.length} selected patient${deletedIds.length !== 1 ? 's' : ''}.`);
  };

  const exportToCSV = () => {
    if (results.length === 0) {
      toast.error('No data to export.');
      return;
    }

    const headers = [
      'UHID', 'Patient Name', 'Type', 'Relation', 'Employee Name', 'Employee Number',
      'Age', 'Gender', 'Phone Number', 'Registration Date', 'Last Consultation', 'Doctor'
    ];

    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = results.map(p => [
      escapeCSV(p.uhid),
      escapeCSV(p.patient_name),
      escapeCSV(getPatientTypeMeta(p.patient_type).label),
      escapeCSV(p.relationship),
      escapeCSV(p.employee_name),
      escapeCSV(p.emp_number),
      escapeCSV(p.age),
      escapeCSV(p.gender),
      escapeCSV(p.phone_number),
      escapeCSV(p.registration_date ? new Date(p.registration_date).toLocaleDateString('en-IN') : ''),
      escapeCSV(p.consultation_date ? new Date(p.consultation_date).toLocaleDateString('en-IN') : ''),
      escapeCSV(p.doctor_name ? 'Dr. ' + p.doctor_name : ''),
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().split('T')[0];
    link.href = url;
    link.download = `Patient_Directory_${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${results.length} records to CSV!`);
  };

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        {/* Page Header */}
        <div className="hms-page-header">
          <div>
            <h1>
              <span className="header-icon">🔍</span>
              Patient Master Directory
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Centralized search for all patient medical records, visit history, and employee relationships.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={() => navigate('/hms/patients/new')}>
              + Register New Patient
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="hms-anim-2" style={{ marginBottom: 0 }}>
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
              placeholder="Search by UHID, Name, Mobile, or Employee Number..."
              value={query}
              onChange={handleInputChange}
              autoFocus
            />
            {loading && <div className="spinner" style={{ width: 22, height: 22 }} />}

            {/* Filter Toggle Button */}
            <button
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
              Filters
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

        {/* ── Search Filters Panel ── */}
        {showFilters && (
          <div className="hms-anim-1" style={{ marginTop: 16, marginBottom: 0 }}>
            <div className="card" style={{
              padding: '20px 28px 24px',
              borderTop: '3px solid var(--green)',
              borderRadius: 16,
              background: 'var(--surface)',
            }}>
              {/* Filter Header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 20,
              }}>
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

              {/* Filter Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px 20px', marginBottom: 20 }}>
                {/* Employee Number */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    Employee Number
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. EMP-12345"
                    value={filters.empNumber}
                    onChange={e => handleFilterChange('empNumber', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFilterSearch()}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10 }}
                  />
                </div>

                {/* Phone Number */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    Phone Number
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="10-digit Phone"
                    value={filters.phoneNumber}
                    onChange={e => handleFilterChange('phoneNumber', e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFilterSearch()}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10 }}
                  />
                </div>

                {/* From Date */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    From Date
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.fromDate}
                    onChange={e => handleFilterChange('fromDate', e.target.value)}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10 }}
                  />
                </div>

                {/* To Date */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    To Date
                  </label>
                  <input
                    type="date"
                    className="form-input"
                    value={filters.toDate}
                    onChange={e => handleFilterChange('toDate', e.target.value)}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10 }}
                  />
                </div>
              </div>

              {/* Second Row: Patient Type + Actions */}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20 }}>
                {/* Patient Type */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    Patient Type
                  </label>
                  <select
                    className="form-input"
                    value={filters.patientType}
                    onChange={e => handleFilterChange('patientType', e.target.value)}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10, minWidth: 200 }}
                  >
                    <option value="">All Types</option>
                    <option value="corporate_employee">Corporate Employee</option>
                    <option value="cisf_employee">CISF Employee</option>
                    <option value="other">General / External</option>
                  </select>
                </div>

                {/* Consulted By (Doctor) */}
                <div>
                  <label style={{
                    display: 'block', fontSize: '0.7rem', fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)', marginBottom: 6,
                  }}>
                    Consulted By
                  </label>
                  <select
                    className="form-input"
                    value={filters.doctorId}
                    onChange={e => handleFilterChange('doctorId', e.target.value)}
                    style={{ fontSize: '0.88rem', padding: '10px 14px', borderRadius: 10, minWidth: 200 }}
                  >
                    <option value="">All Doctors</option>
                    {doctors.map(doc => (
                      <option key={doc.id} value={doc.user_id}>
                        {doc.user?.name ? `Dr. ${doc.user.name}` : `Doctor #${doc.id}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Clear & Search Buttons */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleClearFilters}
                    style={{
                      padding: '10px 22px', borderRadius: 10,
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text-secondary)',
                      fontSize: '0.86rem', fontWeight: 700,
                      cursor: 'pointer', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--red)'; e.currentTarget.style.color = 'var(--red)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                  >
                    Clear Filters
                  </button>
                  <button
                    onClick={handleFilterSearch}
                    className="btn btn-primary"
                    style={{
                      padding: '10px 28px', borderRadius: 10,
                      fontSize: '0.86rem', fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: '#fff',
                      boxShadow: '0 0 0 3px rgba(255,255,255,0.3)',
                      flexShrink: 0,
                    }} />
                    Search
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results count bar */}
        {results.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 4px', marginTop: 16,
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Showing <strong style={{ color: 'var(--text-primary)' }}>{results.length}</strong> patient{results.length !== 1 ? 's' : ''}
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
              {isSuperAdmin && selectedPatientCount > 0 && (
                <span style={{
                  marginLeft: 10, padding: '2px 10px', borderRadius: 10,
                  background: 'rgba(239,68,68,0.1)', color: 'var(--red)',
                  fontSize: '0.72rem', fontWeight: 700,
                  border: '1px solid rgba(239,68,68,0.2)',
                }}>
                  {selectedPatientCount} selected
                </span>
              )}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {isSuperAdmin && selectedPatientCount > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={deletingSelected}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '7px 18px', borderRadius: 10,
                    border: '2px solid rgba(239,68,68,0.28)',
                    background: deletingSelected ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.1)',
                    color: 'var(--red)',
                    fontSize: '0.82rem', fontWeight: 800,
                    cursor: deletingSelected ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    opacity: deletingSelected ? 0.72 : 1,
                  }}
                >
                  {deletingSelected ? 'Deleting...' : `Delete Selected (${selectedPatientCount})`}
                </button>
              )}

              {/* Export Button */}
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

        {/* Results Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden', marginTop: results.length > 0 ? 0 : 24 }}>
          {loading && results.length === 0 ? (
            <div style={{ padding: 80, textAlign: 'center' }}>
              <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--text-muted)' }}>Searching master directory...</p>
            </div>
          ) : results.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24 }}>
              <span className="empty-icon">{query || activeFilterCount > 0 ? '👻' : '🏥'}</span>
              <h3>{query || activeFilterCount > 0 ? 'No records found' : 'Start your search'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {query || activeFilterCount > 0
                  ? `We couldn't find any patient matching your criteria.`
                  : 'Enter a name, UHID, or phone number to find a patient.'}
              </p>
              {activeFilterCount > 0 && (
                <button className="btn btn-outline" style={{ marginTop: 20 }} onClick={handleClearFilters}>
                  Clear All Filters
                </button>
              )}
              {!query && activeFilterCount === 0 && (
                <button className="btn btn-outline" style={{ marginTop: 20 }} onClick={() => navigate('/hms/patients/new')}>
                  Add First Patient
                </button>
              )}
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>UHID</th>
                    <th>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {isSuperAdmin && (
                          <label
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              cursor: visiblePatientIds.length ? 'pointer' : 'not-allowed',
                              fontSize: '0.72rem', color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              disabled={visiblePatientIds.length === 0}
                              onChange={toggleSelectAllVisible}
                              style={{ width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer' }}
                            />
                            Select All
                          </label>
                        )}
                        <span>Patient Name</span>
                      </div>
                    </th>
                    <th>Type</th>
                    <th>Relation</th>
                    <th>Emp Details</th>
                    <th>Age/Gender</th>
                    <th>Contact</th>
                    <th>Consultation</th>
                    {isSuperAdmin && <th style={{ textAlign: 'center' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {results.map((p, idx) => {
                    const patientId = getPatientId(p);
                    const selected = selectedPatientIds.includes(patientId);
                    const typeMeta = getPatientTypeMeta(p.patient_type);
                    return (
                    <tr key={patientId || idx} style={{ cursor: 'pointer' }} onClick={() => navigate(`/hms/patients/${patientId}`)}>
                      <td><strong style={{ color: 'var(--blue)' }}>{p.uhid || '-'}</strong></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                          {isSuperAdmin && (
                            <input
                              type="checkbox"
                              checked={selected}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => togglePatientSelection(e, patientId)}
                              aria-label={`Select ${p.patient_name || 'patient'}`}
                              style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--green)', cursor: 'pointer', flexShrink: 0 }}
                            />
                          )}
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{p.patient_name || '-'}</div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: 2 }}>Registered: {p.registration_date ? new Date(p.registration_date).toLocaleDateString() + ', ' + new Date(p.registration_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 800, padding: '3px 9px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
                          backgroundColor: typeMeta.bg,
                          color: typeMeta.color,
                          border: `1px solid ${typeMeta.border}`
                        }}>
                          {typeMeta.shortLabel}
                        </span>
                      </td>
                      <td>{p.relationship || '-'}</td>
                      <td>
                        {p.patient_type === 'corporate_employee' ? (
                          <>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{p.employee_name || '-'}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: {p.emp_number || '-'}</div>
                          </>
                        ) : '-'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                        {p.age}Y <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>/</span> {p.gender?.[0] || '-'}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.phone_number || '-'}</td>
                      <td>
                        {p.consultation_date ? (
                          <>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Dr. {p.doctor_name?.split(' ')[0]}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(p.consultation_date).toLocaleDateString()}</div>
                          </>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontStyle: 'italic' }}>No recent visit</span>}
                      </td>
                      {isSuperAdmin && (
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-sm btn-danger"
                            disabled={deletingSelected}
                            style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                            onClick={(e) => handleDelete(e, patientId, p.patient_name || p.NAME || p.name)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
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
