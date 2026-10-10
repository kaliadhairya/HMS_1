import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BedDouble, CircleCheck, Inbox, RefreshCw, Stethoscope, Trash2, TriangleAlert, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import RowMenu from '../../../components/ui/RowMenu';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';

const STATUS_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Admitted', label: 'Admitted' },
  { value: 'Cancelled', label: 'Cancelled' },
];
const STATUS_TONE = { Pending: 'warning', Admitted: 'success', Cancelled: 'neutral' };
const URGENCY_TONE = { Emergency: 'danger', Urgent: 'warning', Routine: 'neutral' };
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function IPDRequestsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Quick Admit State
  const [admitModal, setAdmitModal] = useState(null);
  const [wards, setWards] = useState([]);
  const [beds, setBeds] = useState([]);
  const [selectedWard, setSelectedWard] = useState('');
  const [selectedBed, setSelectedBed] = useState('');
  const [admitting, setAdmitting] = useState(false);

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Multi-select State
  const [selectedIds, setSelectedIds] = useState([]);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/ipd/requests?status=${statusFilter}`);
      if (res.data.success) {
        setRequests(res.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not load IPD requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [statusFilter]);

  // Clear selection when filter changes or requests reload
  useEffect(() => {
    setSelectedIds([]);
  }, [requests]);

  const getReqId = (r) => String(r.ID || r.id);
  const visibleIds = requests.map(r => getReqId(r));
  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : [...visibleIds]);
  };

  const toggleSelect = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleOpenAdmit = async (req) => {
    setAdmitModal(req);
    setSelectedWard('');
    setSelectedBed('');
    setBeds([]);
    // Fetch wards to allow bed selection
    try {
      const res = await api.get('/ipd/wards');
      const wardList = res.data.data || [];
      setWards(wardList);

      // Auto-match ward preference from doctor's request
      const pref = (req.WARD_PREFERENCE || req.wardPreference || '').toLowerCase().trim();
      if (pref) {
        const matched = wardList.find(w => {
          const wName = (w.NAME || w.name || '').toLowerCase();
          const wType = (w.TYPE || w.type || '').toLowerCase();
          return wName === pref || wType === pref || wName.includes(pref) || pref.includes(wName);
        });
        if (matched) {
          const wardId = String(matched.ID || matched.id);
          setSelectedWard(wardId);
          // Also fetch beds for the matched ward
          try {
            const bedRes = await api.get(`/ipd/beds?ward_id=${wardId}`);
            setBeds(bedRes.data.data?.filter(b => b.STATUS === 'Available' || b.status === 'Available') || []);
          } catch (err) {
            console.error(err);
          }
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchBeds = async (wardId) => {
    try {
      const res = await api.get(`/ipd/beds?ward_id=${wardId}`);
      setBeds(res.data.data?.filter(b => b.STATUS === 'Available' || b.status === 'Available') || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleWardChange = (e) => {
    const wId = e.target.value;
    setSelectedWard(wId);
    setSelectedBed('');
    if (wId) fetchBeds(wId);
    else setBeds([]);
  };

  const handleAdmitSubmit = async () => {
    if (!selectedBed) return toast.error('Select an available bed');
    setAdmitting(true);
    try {
      // 1. Create admission
      const admRes = await api.post('/ipd/admissions', {
        patientId: admitModal.PATIENT_ID || admitModal.patientId,
        admittingDoctorId: admitModal.DOCTOR_ID || admitModal.doctorId,
        department: admitModal.PRIMARY_DIAGNOSIS || 'General',
        bedId: selectedBed,
        admissionType: admitModal.URGENCY_LEVEL || 'Routine',
        patientName: admitModal.PATIENT_NAME || admitModal.patientName,
        uhid: admitModal.UHID || admitModal.uhid,
      });

      if (admRes.data.success) {
        const admissionId = admRes.data.data.id || admRes.data.data.ID;
        // 2. Update request status on backend
        await api.patch(`/ipd/requests/${admitModal.ID || admitModal.id}/status`, {
          status: 'Admitted',
          admissionId
        });

        // 3. Immediately update local state so UI reflects change
        const admitId = String(admitModal.ID || admitModal.id);
        setRequests(prev => prev.map(r => {
          if (String(r.ID || r.id) === admitId) {
            return { ...r, STATUS: 'Admitted', status: 'Admitted', ADMISSION_ID: admissionId };
          }
          return r;
        }));

        toast.success('Patient admitted');
        setAdmitModal(null);
        setSelectedWard('');
        setSelectedBed('');
        setBeds([]);

        // 4. Switch filter to "Admitted" so user sees the result
        setStatusFilter('Admitted');
      }
    } catch (err) {
      console.error(err);
      toast.error('Could not admit patient');
    } finally {
      setAdmitting(false);
    }
  };

  const canAdmit = user?.role === 'nurse' || user?.role === 'super_admin' || user?.role === 'receptionist';
  const canDelete = user?.role === 'doctor' || user?.role === 'super_admin' || user?.role === 'admin';

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const reqId = deleteTarget.ID || deleteTarget.id;
      await api.delete(`/ipd/requests/${reqId}`);
      setRequests(prev => prev.filter(r => String(r.ID || r.id) !== String(reqId)));
      toast.success('IPD request deleted');
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      toast.error('Could not delete request');
    } finally {
      setDeleting(false);
    }
  };

  // Confirmation happens in the bulk-delete Modal before this runs.
  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || deletingSelected) return;

    setDeletingSelected(true);
    try {
      await api.post('/ipd/requests/bulk-delete', { ids: selectedIds });
      setRequests(prev => prev.filter(r => !selectedIds.includes(getReqId(r))));
      toast.success(`Deleted ${selectedIds.length} ${selectedIds.length === 1 ? 'request' : 'requests'}`);
      setSelectedIds([]);
      setConfirmBulkDelete(false);
    } catch (err) {
      console.error(err);
      toast.error('Could not delete the selected requests');
    } finally {
      setDeletingSelected(false);
    }
  };

  const recordVitals = (req) => navigate('/hms/vitals/entry', {
    state: {
      patient: {
        id: req.PATIENT_ID || req.patientId,
        name: req.PATIENT_NAME || req.patientName,
        uhid: req.UHID || req.uhid,
        age: req.AGE || req.age || '',
      }
    }
  });

  const columns = useMemo(() => {
    const cols = [];
    if (canDelete) {
      cols.push({
        id: 'select', enableSorting: false, meta: { width: 44 },
        header: () => (
          <input
            type="checkbox"
            aria-label="Select all requests"
            checked={allSelected}
            disabled={visibleIds.length === 0}
            onChange={toggleSelectAll}
          />
        ),
        cell: ({ row }) => {
          const reqId = getReqId(row.original);
          return (
            <input
              type="checkbox"
              aria-label={`Select request for ${row.original.PATIENT_NAME || row.original.patientName || 'patient'}`}
              checked={selectedIds.includes(reqId)}
              onChange={() => toggleSelect(reqId)}
            />
          );
        },
      });
    }
    cols.push(
      {
        id: 'requested', header: 'Requested', meta: { width: 140 },
        accessorFn: (r) => { const d = r.REQUEST_DATE || r.requestDate; return d ? new Date(d).getTime() : 0; },
        cell: ({ row }) => {
          const d = row.original.REQUEST_DATE || row.original.requestDate;
          return (
            <span className="cell-stack">
              <span className="tabular" style={{ fontWeight: 600 }}>{fmtDate(d)}</span>
              <span className="cell-secondary">{fmtTime(d)}</span>
            </span>
          );
        },
      },
      {
        id: 'patient', header: 'Patient', accessorFn: (r) => r.PATIENT_NAME || r.patientName || '',
        cell: ({ row }) => (
          <span className="cell-stack">
            <span className="cell-primary">{row.original.PATIENT_NAME || row.original.patientName || '—'}</span>
            <span className="cell-secondary mono">{row.original.UHID || row.original.uhid || 'No UHID'}</span>
          </span>
        ),
      },
      { id: 'doctor', header: 'Requesting doctor', accessorFn: (r) => r.DOCTOR_NAME || r.doctorName || '', cell: ({ getValue }) => getValue() || '—' },
      {
        id: 'diagnosis', header: 'Diagnosis and reason', accessorFn: (r) => r.PRIMARY_DIAGNOSIS || r.primaryDiagnosis || '',
        cell: ({ row }) => {
          const reason = row.original.REASON_FOR_ADMISSION || row.original.reasonForAdmission;
          return (
            <span className="cell-stack" style={{ maxWidth: 260 }}>
              <span style={{ fontWeight: 600 }}>{row.original.PRIMARY_DIAGNOSIS || row.original.primaryDiagnosis || '—'}</span>
              {reason && <span className="cell-secondary" title={reason} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{reason}</span>}
            </span>
          );
        },
      },
      {
        id: 'ward', header: 'Ward and urgency', accessorFn: (r) => r.WARD_PREFERENCE || r.wardPreference || '', meta: { width: 170 },
        cell: ({ row }) => {
          const urgency = row.original.URGENCY_LEVEL || row.original.urgencyLevel;
          return (
            <span className="cell-stack" style={{ gap: 4, alignItems: 'flex-start' }}>
              <span>{row.original.WARD_PREFERENCE || row.original.wardPreference || '—'}</span>
              {urgency && <span className={`status status-${URGENCY_TONE[urgency] || 'neutral'}`}>{urgency}</span>}
            </span>
          );
        },
      },
      {
        id: 'status', header: 'Status', accessorFn: (r) => r.STATUS || r.status || '', meta: { width: 120 },
        cell: ({ getValue }) => <span className={`status status-${STATUS_TONE[getValue()] || 'neutral'}`}>{getValue() || '—'}</span>,
      },
      {
        id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 200, align: 'right' },
        cell: ({ row }) => {
          const req = row.original;
          const status = req.STATUS || req.status;
          return (
            <span className="inline-actions">
              {status === 'Pending' && canAdmit && (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleOpenAdmit(req)}>
                  <BedDouble size={14} aria-hidden="true" /> Admit
                </button>
              )}
              {status === 'Pending' && !canAdmit && <span className="cell-secondary">Awaiting admission</span>}
              {status === 'Admitted' && canAdmit && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => recordVitals(req)}>
                  <Stethoscope size={14} aria-hidden="true" /> Record vitals
                </button>
              )}
              {canDelete && (
                <RowMenu
                  label={`Actions for ${req.PATIENT_NAME || req.patientName || 'request'}`}
                  items={[{ label: 'Delete request', icon: Trash2, danger: true, onSelect: () => setDeleteTarget(req) }]}
                />
              )}
            </span>
          );
        },
      },
    );
    return cols;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDelete, canAdmit, selectedIds, allSelected, requests]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="IPD admission requests"
          description="Review admission requests from doctors, assign a bed and complete the admission."
          meta={!loading && <span className="muted">{requests.length} {requests.length === 1 ? 'request' : 'requests'}</span>}
        />

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Request status">
              {STATUS_OPTIONS.map(o => (
                <button
                  key={o.value || 'all'}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === o.value}
                  className={statusFilter === o.value ? 'is-active' : ''}
                  onClick={() => setStatusFilter(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-md" onClick={fetchRequests} style={{ marginLeft: 'auto' }}>
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>

          {canDelete && selectedIds.length > 0 && (
            <div className="selection-bar" role="status">
              <strong>{selectedIds.length} selected</strong>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmBulkDelete(true)} disabled={deletingSelected}>
                <Trash2 size={14} aria-hidden="true" /> {deletingSelected ? 'Deleting…' : 'Delete selected'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>
                <X size={14} aria-hidden="true" /> Clear selection
              </button>
            </div>
          )}

          <DataTable
            columns={columns}
            data={requests}
            loading={loading}
            getRowId={getReqId}
            initialSorting={[{ id: 'requested', desc: true }]}
            empty={statusFilter ? (
              <EmptyState icon={Inbox} title={`No ${statusFilter.toLowerCase()} requests`} description="Try another status, or show all requests." />
            ) : (
              <EmptyState icon={Inbox} title="No admission requests yet" description="Requests appear here when a doctor asks for a patient to be admitted." />
            )}
          />
        </section>
      </main>

      {/* Delete confirmation */}
      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
        title="Delete IPD request"
        description="This permanently deletes the admission request. It cannot be undone."
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={handleDelete} disabled={deleting}>
              <Trash2 size={16} aria-hidden="true" /> {deleting ? 'Deleting…' : 'Delete request'}
            </button>
          </>
        )}
      >
        {deleteTarget && (
          <div className="facts">
            <div><div className="fact-label">Patient</div><div className="fact-value">{deleteTarget.PATIENT_NAME || deleteTarget.patientName || 'Unknown'}</div></div>
            <div><div className="fact-label">UHID</div><div className="fact-value mono">{deleteTarget.UHID || deleteTarget.uhid || 'N/A'}</div></div>
            <div><div className="fact-label">Diagnosis</div><div className="fact-value">{deleteTarget.PRIMARY_DIAGNOSIS || deleteTarget.primaryDiagnosis || '—'}</div></div>
            <div><div className="fact-label">Requested</div><div className="fact-value tabular">{fmtDate(deleteTarget.REQUEST_DATE || deleteTarget.requestDate)}</div></div>
          </div>
        )}
      </Modal>

      {/* Bulk delete confirmation */}
      <Modal
        open={confirmBulkDelete}
        onOpenChange={(open) => { if (!open && !deletingSelected) setConfirmBulkDelete(false); }}
        title={`Delete ${selectedIds.length} ${selectedIds.length === 1 ? 'request' : 'requests'}`}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirmBulkDelete(false)} disabled={deletingSelected}>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={handleBulkDelete} disabled={deletingSelected}>
              <Trash2 size={16} aria-hidden="true" /> {deletingSelected ? 'Deleting…' : 'Delete requests'}
            </button>
          </>
        )}
      >
        <p>Only the admission requests are deleted. Patient registrations stay as they are.</p>
        <div className="alert-strip alert-danger" style={{ margin: 0 }}>
          <TriangleAlert size={16} aria-hidden="true" /> This cannot be undone.
        </div>
      </Modal>

      {/* Admit patient */}
      <Modal
        open={Boolean(admitModal)}
        onOpenChange={(open) => { if (!open) setAdmitModal(null); }}
        title="Admit patient"
        description="Assign a ward and bed to complete the admission."
        size="lg"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setAdmitModal(null)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-md" onClick={handleAdmitSubmit} disabled={admitting || !selectedBed}>
              <CircleCheck size={16} aria-hidden="true" /> {admitting ? 'Admitting…' : 'Confirm admission'}
            </button>
          </>
        )}
      >
        {admitModal && (
          <>
            <section>
              <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Patient</h3>
              <div className="facts">
                {[
                  { label: 'Patient name', value: admitModal.PATIENT_NAME || admitModal.patientName },
                  { label: 'UHID', value: admitModal.UHID || admitModal.uhid, mono: true },
                  { label: 'Requesting doctor', value: admitModal.DOCTOR_NAME || admitModal.doctorName },
                  { label: 'Requested', value: fmtDateTime(admitModal.REQUEST_DATE || admitModal.requestDate) },
                ].map(item => (
                  <div key={item.label}>
                    <div className="fact-label">{item.label}</div>
                    <div className={`fact-value${item.mono ? ' mono' : ''}`}>{item.value || 'N/A'}</div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Clinical summary</h3>
              <div className="facts">
                <div>
                  <div className="fact-label">Primary diagnosis</div>
                  <div className="fact-value">{admitModal.PRIMARY_DIAGNOSIS || admitModal.primaryDiagnosis || 'N/A'}</div>
                </div>
                <div>
                  <div className="fact-label">Ward preference</div>
                  <div className="fact-value">{admitModal.WARD_PREFERENCE || admitModal.wardPreference || 'General'}</div>
                </div>
                <div>
                  <div className="fact-label">Urgency</div>
                  <div className="fact-value">
                    <span className={`status status-${URGENCY_TONE[admitModal.URGENCY_LEVEL || ''] || 'success'}`}>{admitModal.URGENCY_LEVEL || admitModal.urgencyLevel || 'Routine'}</span>
                  </div>
                </div>
                <div>
                  <div className="fact-label">Estimated duration</div>
                  <div className="fact-value">{admitModal.ESTIMATED_DURATION || admitModal.estimatedDuration || '—'} {admitModal.DURATION_UNIT || admitModal.durationUnit || ''}</div>
                </div>
              </div>
              {(admitModal.REASON_FOR_ADMISSION || admitModal.reasonForAdmission) && (
                <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="fact-label">Reason for admission</div>
                  <div className="fact-value" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>{admitModal.REASON_FOR_ADMISSION || admitModal.reasonForAdmission}</div>
                </div>
              )}
            </section>

            <section>
              <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Ward and bed</h3>
              <div className="form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="admit-ward">Ward</label>
                  <select id="admit-ward" className="form-select" value={selectedWard} onChange={handleWardChange}>
                    <option value="">Choose ward</option>
                    {wards.map(w => (
                      <option key={w.ID || w.id} value={w.ID || w.id}>{w.NAME || w.name} ({w.TYPE || w.type})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="admit-bed">
                    Bed
                    {selectedWard && beds.length > 0 && <span className="cell-secondary" style={{ marginLeft: 6 }}>{beds.length} available</span>}
                  </label>
                  <select id="admit-bed" className="form-select" value={selectedBed} onChange={e => setSelectedBed(e.target.value)} disabled={!selectedWard}>
                    <option value="">Choose bed</option>
                    {beds.map(b => (
                      <option key={b.ID || b.id} value={b.ID || b.id}>
                        Room {b.ROOM_NUMBER}, bed {b.BED_NUMBER}
                      </option>
                    ))}
                  </select>
                  {selectedWard && beds.length === 0 && (
                    <p className="form-hint" style={{ color: 'var(--red)' }}>No beds available in this ward.</p>
                  )}
                </div>
              </div>

              {/* Selected bed summary */}
              {selectedBed && (() => {
                const bed = beds.find(b => String(b.ID || b.id) === String(selectedBed));
                const ward = wards.find(w => String(w.ID || w.id) === String(selectedWard));
                if (!bed) return null;
                return (
                  <div className="alert-strip alert-info" style={{ margin: '12px 0 0' }}>
                    <CircleCheck size={16} aria-hidden="true" />
                    <span>
                      <strong>{ward?.NAME || 'Ward'}, room {bed.ROOM_NUMBER}, bed {bed.BED_NUMBER}.</strong>{' '}
                      The patient is assigned to this bed when you confirm.
                    </span>
                  </div>
                );
              })()}
            </section>
          </>
        )}
      </Modal>
    </>
  );
}
