import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import api from '../api/axios';

export default function SearchPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    empNumber: '',
    phoneNumber: '',
    fromDate: '',
    toDate: '',
    patientType: '',
  });
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 15;

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  const handleSearch = useCallback(async (pg = 1) => {
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ page: pg, limit: LIMIT });
      if (filters.empNumber.trim()) params.set('empNumber', filters.empNumber.trim());
      if (filters.phoneNumber.trim()) params.set('phoneNumber', filters.phoneNumber.trim());
      if (filters.fromDate) params.set('fromDate', filters.fromDate);
      if (filters.toDate) params.set('toDate', filters.toDate);
      if (filters.patientType) params.set('patientType', filters.patientType);

      const { data } = await api.get(`/patients?${params.toString()}`);
      setResults(data.patients);
      setTotal(data.total);
      setPage(pg);
    } catch {
      toast.error('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Load all on mount
  useEffect(() => { handleSearch(1); }, []);

  const handleViewReport = async (patientId) => {
    try {
      const { data } = await api.get(`/patients/${patientId}`);
      if (data.report) {
        navigate(`/report/${data.report.id}`, { state: { patient: data.patient } });
      } else {
        toast.error('No report found for this patient.');
      }
    } catch {
      toast.error('Failed to load patient report.');
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const clearFilters = () => {
    setFilters({ empNumber: '', phoneNumber: '', fromDate: '', toDate: '', patientType: '' });
  };

  return (
    <>
      <Navbar />
      <div className="page-wrapper">
        {/* Header */}
        <div className="page-header fade-up">
          <h1>Search <span style={{ color: 'var(--teal)' }}>Records</span></h1>
          <p>Find patients by employee number, Phone number, or filter by date range.</p>
        </div>

        {/* Filter Card */}
        <div className="card fade-up-2" style={{ marginBottom: 24 }}>
          <div className="card-section-title">Search Filters</div>
          <div className="form-grid" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Employee Number</label>
              <input
                className="form-input"
                placeholder="e.g. EMP-12345"
                value={filters.empNumber}
                onChange={e => setFilter('empNumber', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch(1)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone Number</label>
              <input
                className="form-input"
                placeholder="10-digit Phone"
                value={filters.phoneNumber}
                onChange={e => setFilter('phoneNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={e => e.key === 'Enter' && handleSearch(1)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">From Date</label>
              <input
                className="form-input" type="date"
                value={filters.fromDate}
                onChange={e => setFilter('fromDate', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">To Date</label>
              <input
                className="form-input" type="date"
                value={filters.toDate}
                onChange={e => setFilter('toDate', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Patient Type</label>
              <select className="form-select" value={filters.patientType} onChange={e => setFilter('patientType', e.target.value)}>
                <option value="">All Types</option>
                <option value="corporate_employee">Corporate Employee</option>
                <option value="other">Other Patient</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear Filters</button>
            <button className="btn btn-primary" onClick={() => handleSearch(1)} disabled={loading}>
              {loading ? <><div className="spinner" style={{ width: 15, height: 15 }} /> Searching…</> : '🔍 Search'}
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="fade-up-3">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {searched && !loading && (
                <span>
                  Found <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> record{total !== 1 ? 's' : ''}
                  {total > LIMIT && ` — Page ${page} of ${totalPages}`}
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
            </div>
          ) : results.length === 0 && searched ? (
            <div style={{
              textAlign: 'center', padding: '48px 20px',
              background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🔍</div>
              <p style={{ color: 'var(--text-secondary)' }}>No records found matching your filters.</p>
            </div>
          ) : (
            <>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Patient Name</th>
                      <th>Type</th>
                      <th>ID (Emp / Phone)</th>
                      <th>Age / Gender</th>
                      <th>Ward</th>
                      <th>Diagnosis</th>
                      <th>Test Date</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((p, i) => (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          {(page - 1) * LIMIT + i + 1}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          {p.patientType === 'corporate_employee' && p.relationship && (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                              {p.relationship}
                            </div>
                          )}
                        </td>
                        <td>
                          <span className={`badge ${p.patientType === 'corporate_employee' ? 'badge-teal' : 'badge-amber'}`}>
                            {p.patientType === 'corporate_employee' ? 'Corporate' : 'Other'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--teal)' }}>
                          {p.patientType === 'corporate_employee' ? p.empNumber : p.phoneNumber}
                        </td>
                        <td>{p.age} yrs / {p.gender}</td>
                        <td>{p.ward}</td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: 140 }}>
                          {p.provDiagnosis || '—'}
                        </td>
                        <td style={{ fontSize: '0.82rem' }}>
                          {new Date(p.testDate).toLocaleDateString('en-IN', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </td>
                        <td>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleViewReport(p.id)}
                          >
                            View Report
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={page === 1}
                    onClick={() => handleSearch(page - 1)}
                  >← Prev</button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                    .map((p, idx, arr) => (
                      <>
                        {idx > 0 && arr[idx - 1] !== p - 1 && (
                          <span key={`ellipsis-${p}`} style={{ color: 'var(--text-secondary)', padding: '0 4px' }}>…</span>
                        )}
                        <button
                          key={p}
                          className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}`}
                          onClick={() => handleSearch(p)}
                        >{p}</button>
                      </>
                    ))}
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={page === totalPages}
                    onClick={() => handleSearch(page + 1)}
                  >Next →</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
