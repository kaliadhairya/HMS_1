import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Search, SlidersHorizontal, UserPlus, Download, MoreHorizontal, UserRound, Route, CalendarPlus, Trash2, Users, X,
} from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import { useAuth } from '../../../context/AuthContext';

const TYPE_META = {
  corporate_employee: { label: 'Corporate', full: 'Corporate employee', tone: 'info' },
  other: { label: 'General', full: 'General / external', tone: 'neutral' },
};
const typeMeta = (type) => TYPE_META[type] || TYPE_META.other;

const INITIAL_FILTERS = { empNumber: '', phoneNumber: '', fromDate: '', toDate: '', patientType: '', doctorId: '' };
const REGISTER_ROLES = ['super_admin', 'receptionist', 'doctor'];
const JOURNEY_ROLES = ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse'];

const getPatientId = (p) => p?.id || p?.ID;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const withDr = (name) => (!name ? '' : /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`);

export default function PatientSearchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = user?.role;
  const isSuperAdmin = role === 'super_admin';

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [activeFilterCount, setActiveFilterCount] = useState(0);
  const [doctors, setDoctors] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleting, setDeleting] = useState(false);

  const searchPatients = async (q, f = filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
      const res = await api.get(`/patients/hms/search?${params.toString()}`);
      setResults(res.data.data || []);
      setActiveFilterCount(Object.values(f).filter((v) => v && String(v).trim() !== '').length);
    } catch {
      toast.error('Patient search failed.');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSearch = useCallback((() => {
    let t;
    return (q) => { clearTimeout(t); t = setTimeout(() => searchPatients(q), 350); };
  })(), [filters]);

  useEffect(() => {
    searchPatients('');
    api.get('/hms/doctors')
      .then((res) => { if (res.data?.success) setDoctors(res.data.data); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleIds = useMemo(() => results.map(getPatientId).filter(Boolean), [results]);
  useEffect(() => { setSelectedIds((prev) => prev.filter((id) => visibleIds.includes(id))); }, [visibleIds]);
  const selected = results.filter((p) => selectedIds.includes(getPatientId(p)));
  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length;

  const setFilter = (field, value) => setFilters((prev) => ({ ...prev, [field]: value }));
  const clearFilters = () => { setFilters(INITIAL_FILTERS); searchPatients(query, INITIAL_FILTERS); };

  const deleteOne = async (patient) => {
    const id = getPatientId(patient);
    if (!window.confirm(`Permanently delete patient "${patient.patient_name}" (${patient.uhid})?\n\nThis cannot be undone.`)) return;
    try {
      await api.delete(`/patients/${id}`);
      toast.success('Patient record deleted.');
      searchPatients(query);
    } catch {
      toast.error('Deletion failed. The record may be linked to visits or bills.');
    }
  };

  const deleteSelected = async () => {
    if (!isSuperAdmin || selected.length === 0 || deleting) return;
    const names = selected.slice(0, 4).map((p) => p.patient_name).join(', ');
    const more = selected.length > 4 ? `, +${selected.length - 4} more` : '';
    if (!window.confirm(`Permanently delete ${selected.length} patient(s)?\n\n${names}${more}\n\nThis cannot be undone.`)) return;
    setDeleting(true);
    let failed = 0;
    for (const p of selected) {
      try { await api.delete(`/patients/${getPatientId(p)}`); } catch { failed += 1; }
    }
    setDeleting(false);
    setSelectedIds([]);
    searchPatients(query, filters);
    if (failed) toast.error(`${failed} patient(s) could not be deleted. Records may be linked.`);
    else toast.success(`Deleted ${selected.length} patient(s).`);
  };

  const exportCSV = () => {
    if (results.length === 0) { toast.error('No data to export.'); return; }
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['UHID', 'Patient Name', 'Type', 'Relation', 'Employee Name', 'Employee Number', 'Age', 'Gender', 'Phone Number', 'Registration Date', 'Last Consultation', 'Doctor'];
    const rows = results.map((p) => [
      p.uhid, p.patient_name, typeMeta(p.patient_type).full, p.relationship, p.employee_name, p.emp_number, p.age, p.gender,
      p.phone_number, fmtDate(p.registration_date), fmtDate(p.consultation_date), withDr(p.doctor_name),
    ].map(esc).join(','));
    const blob = new Blob(['﻿' + [header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `patients_${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast.success(`Exported ${results.length} patients.`);
  };

  const openProfile = (p) => navigate(`/hms/patients/${getPatientId(p)}`);

  const columns = useMemo(() => {
    const cols = [];
    if (isSuperAdmin) {
      cols.push({
        id: 'select',
        enableSorting: false,
        meta: { width: 44 },
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all patients"
            checked={allSelected}
            onChange={() => setSelectedIds(allSelected ? [] : visibleIds)}
          />
        ),
        cell: ({ row }) => {
          const id = getPatientId(row.original);
          return (
            <input
              type="checkbox"
              aria-label={`Select ${row.original.patient_name}`}
              checked={selectedIds.includes(id)}
              onClick={(e) => e.stopPropagation()}
              onChange={() => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
            />
          );
        },
      });
    }
    cols.push(
      {
        id: 'patient',
        header: 'Patient',
        accessorFn: (p) => p.patient_name || '',
        cell: ({ row }) => (
          <div className="cell-person">
            <span className="cell-avatar" aria-hidden="true">{(row.original.patient_name || '?').charAt(0).toUpperCase()}</span>
            <span className="cell-stack">
              <span className="cell-primary">{row.original.patient_name}</span>
              <span className="cell-secondary mono">{row.original.uhid}</span>
            </span>
          </div>
        ),
      },
      {
        id: 'age',
        header: 'Age / sex',
        accessorFn: (p) => Number(p.age) || 0,
        meta: { width: 110 },
        cell: ({ row }) => <span className="tabular">{row.original.age ?? '–'} y · {(row.original.gender || '–').charAt(0)}</span>,
      },
      {
        id: 'type',
        header: 'Category',
        accessorFn: (p) => typeMeta(p.patient_type).label,
        meta: { width: 130 },
        cell: ({ row }) => {
          const m = typeMeta(row.original.patient_type);
          return <span className={`status status-${m.tone}`}>{m.label}</span>;
        },
      },
      {
        id: 'phone',
        header: 'Contact',
        accessorFn: (p) => p.phone_number || '',
        enableSorting: false,
        meta: { width: 140 },
        cell: ({ row }) => <span className="tabular">{row.original.phone_number || '—'}</span>,
      },
      {
        id: 'employee',
        header: 'Employee',
        accessorFn: (p) => p.emp_number || '',
        meta: { width: 150 },
        cell: ({ row }) => (row.original.emp_number ? (
          <span className="cell-stack">
            <span className="mono">{row.original.emp_number}</span>
            <span className="cell-secondary">{row.original.relationship || 'Self'}</span>
          </span>
        ) : <span className="cell-secondary">—</span>),
      },
      {
        id: 'lastVisit',
        header: 'Last visit',
        accessorFn: (p) => (p.consultation_date ? new Date(p.consultation_date).getTime() : 0),
        meta: { width: 170 },
        cell: ({ row }) => (row.original.consultation_date ? (
          <span className="cell-stack">
            <span className="tabular">{fmtDate(row.original.consultation_date)}</span>
            <span className="cell-secondary">{withDr(row.original.doctor_name)}</span>
          </span>
        ) : <span className="cell-secondary">No visits yet</span>),
      },
      {
        id: 'registered',
        header: 'Registered',
        accessorFn: (p) => (p.registration_date ? new Date(p.registration_date).getTime() : 0),
        meta: { width: 130 },
        cell: ({ row }) => <span className="tabular">{fmtDate(row.original.registration_date)}</span>,
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        enableSorting: false,
        meta: { width: 56, align: 'right' },
        cell: ({ row }) => {
          const p = row.original;
          const id = getPatientId(p);
          return (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="icon-btn row-action" aria-label={`Actions for ${p.patient_name}`} onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal size={18} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="menu" align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu.Item className="menu-item" onSelect={() => openProfile(p)}>
                    <UserRound size={16} /> Open profile
                  </DropdownMenu.Item>
                  {JOURNEY_ROLES.includes(role) && (
                    <DropdownMenu.Item className="menu-item" onSelect={() => navigate(`/patient/${id}/journey`)}>
                      <Route size={16} /> Patient journey
                    </DropdownMenu.Item>
                  )}
                  {REGISTER_ROLES.includes(role) && (
                    <DropdownMenu.Item className="menu-item" onSelect={() => navigate('/hms/appointments/book', { state: { patient: { id, name: p.patient_name, uhid: p.uhid, phoneNumber: p.phone_number } } })}>
                      <CalendarPlus size={16} /> Book appointment
                    </DropdownMenu.Item>
                  )}
                  {isSuperAdmin && (
                    <>
                      <DropdownMenu.Separator className="menu-sep" />
                      <DropdownMenu.Item className="menu-item is-danger" onSelect={() => deleteOne(p)}>
                        <Trash2 size={16} /> Delete record
                      </DropdownMenu.Item>
                    </>
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          );
        },
      },
    );
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, allSelected, selectedIds, visibleIds, role]);

  const hasCriteria = query.trim() !== '' || activeFilterCount > 0;

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="Patients"
          description="Master patient index — search by name, UHID, phone or employee number."
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={exportCSV}>
                <Download size={16} aria-hidden="true" /> Export CSV
              </button>
              {REGISTER_ROLES.includes(role) && (
                <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/patients/new')}>
                  <UserPlus size={16} aria-hidden="true" /> Register patient
                </button>
              )}
            </>
          )}
        />

        <section className="panel">
          <div className="toolbar">
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search patients</span>
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); debouncedSearch(e.target.value); }}
                placeholder="Search name, UHID, phone or employee number"
                autoFocus
              />
            </label>
            <button
              type="button"
              className={`btn btn-md ${showFilters || activeFilterCount ? 'btn-secondary' : 'btn-ghost'}`}
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
            >
              <SlidersHorizontal size={16} aria-hidden="true" /> Filters
              {activeFilterCount > 0 && <span className="count-pill">{activeFilterCount}</span>}
            </button>
          </div>

          {showFilters && (
            <div className="filter-panel">
              <div className="filter-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="f-type">Category</label>
                  <select id="f-type" className="form-select" value={filters.patientType} onChange={(e) => setFilter('patientType', e.target.value)}>
                    <option value="">All categories</option>
                    <option value="corporate_employee">Corporate employee</option>
                    <option value="other">General / external</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="f-doctor">Consulting doctor</label>
                  <select id="f-doctor" className="form-select" value={filters.doctorId} onChange={(e) => setFilter('doctorId', e.target.value)}>
                    <option value="">Any doctor</option>
                    {doctors.map((d) => (
                      <option key={d.id || d.ID} value={d.user_id || d.USER_ID || d.id}>{withDr(d.user?.name || d.name || d.NAME)}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="f-phone">Phone</label>
                  <input id="f-phone" className="form-input" inputMode="tel" value={filters.phoneNumber} onChange={(e) => setFilter('phoneNumber', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="f-emp">Employee number</label>
                  <input id="f-emp" className="form-input" value={filters.empNumber} onChange={(e) => setFilter('empNumber', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="f-from">Registered from</label>
                  <input id="f-from" type="date" className="form-input" value={filters.fromDate} onChange={(e) => setFilter('fromDate', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="f-to">Registered to</label>
                  <input id="f-to" type="date" className="form-input" value={filters.toDate} onChange={(e) => setFilter('toDate', e.target.value)} />
                </div>
              </div>
              <div className="filter-actions">
                <button type="button" className="btn btn-ghost btn-md" onClick={clearFilters}>Clear</button>
                <button type="button" className="btn btn-primary btn-md" onClick={() => searchPatients(query, filters)}>Apply filters</button>
              </div>
            </div>
          )}

          {isSuperAdmin && selected.length > 0 && (
            <div className="selection-bar" role="status">
              <strong>{selected.length} selected</strong>
              <button type="button" className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={deleting}>
                <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting…' : 'Delete selected'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>
                <X size={14} aria-hidden="true" /> Clear selection
              </button>
            </div>
          )}

          <DataTable
            columns={columns}
            data={results}
            loading={loading}
            getRowId={(p) => String(getPatientId(p))}
            onRowClick={openProfile}
            rowLabel={(p) => `Open ${p.patient_name}, ${p.uhid}`}
            initialSorting={[{ id: 'registered', desc: true }]}
            empty={hasCriteria ? (
              <EmptyState
                icon={Search}
                title="No patients match"
                description="Check the spelling or UHID, or clear the filters to see everyone."
                action={<button type="button" className="btn btn-ghost btn-md" onClick={() => { setQuery(''); clearFilters(); }}>Clear search</button>}
              />
            ) : (
              <EmptyState
                icon={Users}
                title="No patients yet"
                description="Registered patients will appear here."
                action={REGISTER_ROLES.includes(role) && (
                  <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/hms/patients/new')}>
                    <UserPlus size={16} aria-hidden="true" /> Register patient
                  </button>
                )}
              />
            )}
          />
        </section>
      </main>
    </>
  );
}
