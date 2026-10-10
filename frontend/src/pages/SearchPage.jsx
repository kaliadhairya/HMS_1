import { useState, useEffect, useCallback, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, FileText, Search, SearchX } from 'lucide-react';
import Navbar from '../components/Navbar';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import api from '../api/axios';

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

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

  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const rows = Array.isArray(results) ? results : [];

  const clearFilters = () => {
    setFilters({ empNumber: '', phoneNumber: '', fromDate: '', toDate: '', patientType: '' });
  };

  const from = total === 0 ? 0 : (page - 1) * LIMIT + 1;
  const to = Math.min(total, page * LIMIT);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Search records"
          description="Find patients by employee number or phone number, or filter by date range."
        />

        <section className="panel">
          <div className="filter-panel" style={{ borderRadius: '10px 10px 0 0' }}>
            <form onSubmit={(e) => { e.preventDefault(); handleSearch(1); }}>
              <div className="filter-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="s-emp">Employee number</label>
                  <input id="s-emp" className="form-input" placeholder="e.g. EMP-12345" value={filters.empNumber} onChange={(e) => setFilter('empNumber', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-phone">Phone number</label>
                  <input
                    id="s-phone" className="form-input" inputMode="numeric" placeholder="10-digit phone"
                    value={filters.phoneNumber}
                    onChange={(e) => setFilter('phoneNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-from">From date</label>
                  <input id="s-from" className="form-input" type="date" value={filters.fromDate} onChange={(e) => setFilter('fromDate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-to">To date</label>
                  <input id="s-to" className="form-input" type="date" value={filters.toDate} onChange={(e) => setFilter('toDate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="s-type">Patient type</label>
                  <select id="s-type" className="form-select" value={filters.patientType} onChange={(e) => setFilter('patientType', e.target.value)}>
                    <option value="">All types</option>
                    <option value="corporate_employee">Corporate employee</option>
                    <option value="other">Other patient</option>
                  </select>
                </div>
              </div>
              <div className="filter-actions">
                <button type="button" className="btn btn-ghost btn-md" onClick={clearFilters}>Clear filters</button>
                <button type="submit" className="btn btn-primary btn-md" disabled={loading}>
                  <Search size={16} aria-hidden="true" /> {loading ? 'Searching…' : 'Search'}
                </button>
              </div>
            </form>
          </div>

          <div className="dt">
            <div className="dt-scroll">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>Patient</th>
                    <th style={{ width: 120 }}>Type</th>
                    <th style={{ width: 150 }}>Emp no. / phone</th>
                    <th style={{ width: 130 }}>Age / gender</th>
                    <th style={{ width: 110 }}>Ward</th>
                    <th>Diagnosis</th>
                    <th style={{ width: 130 }}>Test date</th>
                    <th style={{ width: 140, textAlign: 'right' }}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && Array.from({ length: 6 }).map((_, i) => (
                    <tr key={`sk-${i}`} className="dt-skeleton-row" aria-hidden="true">
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j}><span className="skeleton" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>
                      ))}
                    </tr>
                  ))}
                  {!loading && rows.length === 0 && searched && (
                    <tr>
                      <td colSpan={9} className="dt-empty-cell">
                        <EmptyState icon={SearchX} title="No records found" description="No patients match these filters. Clear the filters or widen the date range." />
                      </td>
                    </tr>
                  )}
                  {!loading && rows.map((p, i) => {
                    const corporate = p.patientType === 'corporate_employee';
                    return (
                      <tr key={p.id}>
                        <td className="tabular cell-secondary">{(page - 1) * LIMIT + i + 1}</td>
                        <td>
                          <span className="cell-stack">
                            <span className="cell-primary">{p.name}</span>
                            {corporate && p.relationship && <span className="cell-secondary">{p.relationship}</span>}
                          </span>
                        </td>
                        <td><span className={`status ${corporate ? 'status-info' : 'status-neutral'}`}>{corporate ? 'Corporate' : 'Other'}</span></td>
                        <td className="mono">{(corporate ? p.empNumber : p.phoneNumber) || '—'}</td>
                        <td className="tabular">{p.age} y / {p.gender}</td>
                        <td>{p.ward || '—'}</td>
                        <td style={{ color: 'var(--text-secondary)', maxWidth: 200 }}>{p.provDiagnosis || '—'}</td>
                        <td className="tabular">{fmtDate(p.testDate)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleViewReport(p.id)} aria-label={`View report for ${p.name}`}>
                            <FileText size={14} aria-hidden="true" /> View report
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {searched && !loading && total > 0 && (
              <div className="dt-footer">
                <span className="dt-count">Showing <strong>{from}–{to}</strong> of <strong>{total}</strong> records</span>
                {totalPages > 1 && (
                  <nav className="dt-pager" aria-label="Pagination">
                    <button type="button" className="icon-btn" disabled={page === 1} onClick={() => handleSearch(page - 1)} aria-label="Previous page">
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((n) => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                      .map((n, idx, arr) => (
                        <Fragment key={n}>
                          {idx > 0 && arr[idx - 1] !== n - 1 && <span aria-hidden="true">…</span>}
                          <button
                            type="button"
                            className={`btn btn-sm ${n === page ? 'btn-primary' : 'btn-ghost'}`}
                            aria-current={n === page ? 'page' : undefined}
                            onClick={() => handleSearch(n)}
                          >
                            {n}
                          </button>
                        </Fragment>
                      ))}
                    <button type="button" className="icon-btn" disabled={page === totalPages} onClick={() => handleSearch(page + 1)} aria-label="Next page">
                      <ChevronRight size={16} />
                    </button>
                  </nav>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
