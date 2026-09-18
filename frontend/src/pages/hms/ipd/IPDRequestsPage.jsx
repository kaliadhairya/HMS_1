import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../../../components/Navbar';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import toast from 'react-hot-toast';

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

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/ipd/requests?status=${statusFilter}`);
      if (res.data.success) {
        setRequests(res.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load IPD requests');
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
    if (!selectedBed) return toast.error('Please select an available bed.');
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

        toast.success('Patient admitted successfully!');
        setAdmitModal(null);
        setSelectedWard('');
        setSelectedBed('');
        setBeds([]);

        // 4. Switch filter to "Admitted" so user sees the result
        setStatusFilter('Admitted');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to admit patient');
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
      toast.success('IPD request deleted successfully');
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete request');
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0 || deletingSelected) return;

    const confirmed = window.confirm(
      `⚠️ WARNING: Are you sure you want to permanently DELETE ${selectedIds.length} selected IPD request${selectedIds.length > 1 ? 's' : ''}?\n\nOnly the admission requests will be deleted. Patient registrations will remain intact.\n\nThis action cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingSelected(true);
    try {
      await api.post('/ipd/requests/bulk-delete', { ids: selectedIds });
      setRequests(prev => prev.filter(r => !selectedIds.includes(getReqId(r))));
      toast.success(`Deleted ${selectedIds.length} request(s) successfully`);
      setSelectedIds([]);
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete selected requests');
    } finally {
      setDeletingSelected(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        <div className="hms-page-header">
          <div>
            <h1><span className="header-icon">📥</span>IPD Admission Requests</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              Review and manage pending patient admissions requested by doctors.
            </p>
          </div>
        </div>

        <div className="hms-anim-2" style={{ marginBottom: 0 }}>
          <div className="card" style={{ padding: '12px 24px', borderRadius: 40, display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: '1.2rem' }}>🚦</span>
            <select 
              className="form-input" 
              value={statusFilter} 
              onChange={e => setStatusFilter(e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: '1.05rem', fontWeight: 600, flex: 1 }}
            >
              <option value="">All Requests</option>
              <option value="Pending">Pending Requests</option>
              <option value="Admitted">Admitted</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <button className="btn btn-sm btn-outline" onClick={fetchRequests}>↻ Refresh</button>
          </div>
        </div>

        {/* Results count bar */}
        {requests.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 4px', marginTop: 16,
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Showing <strong style={{ color: 'var(--text-primary)' }}>{requests.length}</strong> request{requests.length !== 1 ? 's' : ''}
              {canDelete && selectedIds.length > 0 && (
                <span style={{
                  marginLeft: 10, padding: '2px 10px', borderRadius: 10,
                  background: 'rgba(239,68,68,0.1)', color: 'var(--red)',
                  fontSize: '0.72rem', fontWeight: 700,
                  border: '1px solid rgba(239,68,68,0.2)',
                }}>
                  {selectedIds.length} selected
                </span>
              )}
            </span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {canDelete && selectedIds.length > 0 && (
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
                  {deletingSelected ? 'Deleting...' : `🗑️ Delete Selected (${selectedIds.length})`}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden', marginTop: requests.length > 0 ? 0 : 24 }}>
          <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  {canDelete && (
                    <th style={{ width: 44 }}>
                      <label
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                          cursor: visibleIds.length ? 'pointer' : 'not-allowed',
                          fontSize: '0.72rem', color: 'var(--text-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={allSelected}
                          disabled={visibleIds.length === 0}
                          onChange={toggleSelectAll}
                          style={{ width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer' }}
                        />
                        All
                      </label>
                    </th>
                  )}
                  <th>Request Date</th>
                  <th>Patient Info</th>
                  <th>Requesting Doctor</th>
                  <th>Diagnosis / Reason</th>
                  <th>Ward Pref. / Urgency</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={canDelete ? 8 : 7} style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></td></tr>
                ) : requests.length === 0 ? (
                  <tr><td colSpan={canDelete ? 8 : 7} style={{ textAlign: 'center', padding: 40 }}>No requests found.</td></tr>
                ) : (
                  requests.map(req => {
                    const reqId = getReqId(req);
                    const selected = selectedIds.includes(reqId);
                    return (
                    <tr key={reqId}>
                      {canDelete && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleSelect(reqId)}
                            style={{ width: 16, height: 16, accentColor: 'var(--green)', cursor: 'pointer' }}
                          />
                        </td>
                      )}
                      <td>
                        <div style={{ fontWeight: 600 }}>{new Date(req.REQUEST_DATE || req.requestDate).toLocaleDateString()}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(req.REQUEST_DATE || req.requestDate).toLocaleTimeString()}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 'bold' }}>{req.PATIENT_NAME || req.patientName}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--blue)' }}>{req.UHID || req.uhid}</div>
                      </td>
                      <td>{req.DOCTOR_NAME || req.doctorName}</td>
                      <td style={{ maxWidth: 250 }}>
                        <div style={{ fontWeight: 600 }}>{req.PRIMARY_DIAGNOSIS || req.primaryDiagnosis}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {req.REASON_FOR_ADMISSION || req.reasonForAdmission}
                        </div>
                      </td>
                      <td>
                        <div>{req.WARD_PREFERENCE || req.wardPreference}</div>
                        <span className={`badge ${req.URGENCY_LEVEL === 'Emergency' ? 'badge-danger' : 'badge-secondary'}`}>{req.URGENCY_LEVEL || req.urgencyLevel}</span>
                      </td>
                      <td>
                        <span className={`badge ${req.STATUS === 'Pending' ? 'badge-warning' : req.STATUS === 'Admitted' ? 'badge-success' : 'badge-secondary'}`}>
                          {req.STATUS || req.status}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(req.STATUS || req.status) === 'Pending' && canAdmit && (
                            <button className="btn btn-sm btn-primary" onClick={() => handleOpenAdmit(req)}>
                              🏥 Admit Patient
                            </button>
                          )}
                          {(req.STATUS || req.status) === 'Pending' && !canAdmit && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600,
                            }}>⏳ Awaiting Admission</span>
                          )}
                          {canDelete && (
                            <button
                              className="btn btn-sm"
                              style={{
                                background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                                border: '1px solid rgba(239,68,68,0.2)', fontWeight: 600,
                                fontSize: '0.78rem',
                              }}
                              onClick={() => setDeleteTarget(req)}
                            >🗑️ Delete Request</button>
                          )}
                          {(req.STATUS || req.status) === 'Admitted' && (
                            <>
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                fontSize: '0.78rem', color: '#10b981', fontWeight: 700,
                              }}>✅ Admitted</span>
                              {canAdmit && (
                                <button
                                  className="btn btn-sm"
                                  style={{
                                    background: 'rgba(59,130,246,0.1)', color: '#3b82f6',
                                    border: '1px solid rgba(59,130,246,0.2)', fontWeight: 600,
                                  }}
                                  onClick={() => navigate('/hms/vitals/entry', {
                                    state: {
                                      patient: {
                                        id: req.PATIENT_ID || req.patientId,
                                        name: req.PATIENT_NAME || req.patientName,
                                        uhid: req.UHID || req.uhid,
                                        age: req.AGE || req.age || '',
                                      }
                                    }
                                  })}
                                >🩺 Record Vitals</button>
                              )}
                            </>
                          )}
                          {(req.STATUS || req.status) === 'Cancelled' && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>— Cancelled</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'hmsSlideUp 0.25s cubic-bezier(0.16,1,0.3,1) both',
        }} onClick={() => !deleting && setDeleteTarget(null)}>
          <div style={{
            width: '100%', maxWidth: 480,
            background: 'var(--surface)', borderRadius: 20,
            border: '1px solid var(--border)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.2)',
            overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{
              padding: '20px 28px',
              background: 'rgba(239,68,68,0.04)',
              borderBottom: '1px solid rgba(239,68,68,0.15)',
              display: 'flex', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14,
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.3rem',
              }}>⚠️</div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#ef4444' }}>Delete IPD Request</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>This action cannot be undone</p>
              </div>
              <button onClick={() => setDeleteTarget(null)} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text-muted)',
                padding: 4, lineHeight: 1,
              }}>✕</button>
            </div>

            {/* Body */}
            <div style={{ padding: '24px 28px' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.6 }}>
                Are you sure you want to <strong style={{ color: '#ef4444' }}>permanently delete</strong> this IPD admission request?
              </p>

              <div style={{
                padding: '16px 18px', borderRadius: 14,
                background: 'var(--surface-2)', border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px', fontSize: '0.85rem' }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Patient</div>
                    <div style={{ fontWeight: 700 }}>{deleteTarget.PATIENT_NAME || deleteTarget.patientName || 'Unknown'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>UHID</div>
                    <div style={{ fontWeight: 600 }}>{deleteTarget.UHID || deleteTarget.uhid || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Diagnosis</div>
                    <div style={{ fontWeight: 600 }}>{deleteTarget.PRIMARY_DIAGNOSIS || deleteTarget.primaryDiagnosis || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Request Date</div>
                    <div style={{ fontWeight: 600 }}>{new Date(deleteTarget.REQUEST_DATE || deleteTarget.requestDate).toLocaleDateString()}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 28px',
              borderTop: '1px solid var(--border)',
              background: 'var(--surface-2)',
              display: 'flex', justifyContent: 'flex-end', gap: 12,
            }}>
              <button
                className="btn btn-ghost"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                style={{ fontWeight: 600 }}
              >Cancel</button>
              <button
                className="btn"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  background: '#ef4444', color: '#fff', fontWeight: 700,
                  border: 'none', padding: '10px 24px', borderRadius: 10,
                  fontSize: '0.88rem',
                }}
              >
                {deleting ? (
                  <><div className="spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Deleting...</>
                ) : '🗑️ Yes, Delete Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Professional Admit Modal ── */}
      {admitModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'hmsSlideUp 0.25s cubic-bezier(0.16,1,0.3,1) both',
        }} onClick={() => setAdmitModal(null)}>
          <div style={{
            width: '100%', maxWidth: 640, maxHeight: '90vh', overflow: 'auto',
            background: 'var(--surface)', borderRadius: 20,
            border: '1px solid var(--border)',
            boxShadow: '0 24px 48px rgba(0,0,0,0.15)',
          }} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div style={{
              padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderBottom: '1px solid var(--border)', background: 'var(--surface-2)',
              borderRadius: '20px 20px 0 0',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(59,130,246,0.12))',
                  border: '1px solid rgba(16,185,129,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
                }}>🏥</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Admit Patient</h3>
                  <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-muted)' }}>Assign ward & bed to complete admission</p>
                </div>
              </div>
              <button onClick={() => setAdmitModal(null)} style={{
                width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--surface)', cursor: 'pointer', fontSize: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)',
              }}>✕</button>
            </div>

            <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Patient Info Card */}
              <div style={{
                padding: 0, borderRadius: 14, overflow: 'hidden',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  padding: '10px 18px', background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: 'rgba(59,130,246,0.1)', fontSize: '0.75rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>👤</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Patient Details</span>
                </div>
                <div style={{ padding: '16px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
                  {[
                    { label: 'Patient Name', value: admitModal.PATIENT_NAME || admitModal.patientName },
                    { label: 'UHID', value: admitModal.UHID || admitModal.uhid },
                    { label: 'Requesting Doctor', value: admitModal.DOCTOR_NAME || admitModal.doctorName },
                    { label: 'Request Date', value: new Date(admitModal.REQUEST_DATE || admitModal.requestDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{item.value || 'N/A'}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Diagnosis & Clinical Info */}
              <div style={{
                padding: 0, borderRadius: 14, overflow: 'hidden',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  padding: '10px 18px', background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: 'rgba(236,72,153,0.1)', fontSize: '0.75rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>📋</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Clinical Summary</span>
                </div>
                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Primary Diagnosis</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{admitModal.PRIMARY_DIAGNOSIS || admitModal.primaryDiagnosis || 'N/A'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ward Preference</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{admitModal.WARD_PREFERENCE || admitModal.wardPreference || 'General'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Urgency Level</div>
                      <span style={{
                        display: 'inline-block', padding: '3px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700,
                        background: (admitModal.URGENCY_LEVEL || '') === 'Emergency' ? 'rgba(239,68,68,0.1)' : (admitModal.URGENCY_LEVEL || '') === 'Urgent' ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)',
                        color: (admitModal.URGENCY_LEVEL || '') === 'Emergency' ? '#ef4444' : (admitModal.URGENCY_LEVEL || '') === 'Urgent' ? '#f59e0b' : '#10b981',
                        border: `1px solid ${(admitModal.URGENCY_LEVEL || '') === 'Emergency' ? 'rgba(239,68,68,0.2)' : (admitModal.URGENCY_LEVEL || '') === 'Urgent' ? 'rgba(245,158,11,0.2)' : 'rgba(16,185,129,0.2)'}`,
                      }}>{admitModal.URGENCY_LEVEL || admitModal.urgencyLevel || 'Routine'}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Est. Duration</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 700 }}>{admitModal.ESTIMATED_DURATION || admitModal.estimatedDuration || '—'} {admitModal.DURATION_UNIT || admitModal.durationUnit || ''}</div>
                    </div>
                  </div>
                  {(admitModal.REASON_FOR_ADMISSION || admitModal.reasonForAdmission) && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 10,
                      background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)',
                    }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Reason for Admission</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{admitModal.REASON_FOR_ADMISSION || admitModal.reasonForAdmission}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bed Assignment Card */}
              <div style={{
                padding: 0, borderRadius: 14, overflow: 'hidden',
                border: '1px solid rgba(16,185,129,0.3)',
              }}>
                <div style={{
                  padding: '10px 18px',
                  background: 'rgba(16,185,129,0.06)',
                  borderBottom: '1px solid rgba(16,185,129,0.15)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    width: 24, height: 24, borderRadius: 6,
                    background: 'rgba(16,185,129,0.1)', fontSize: '0.75rem',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>🛏️</span>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981' }}>Assign Ward & Bed</span>
                </div>
                <div style={{ padding: '18px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>Select Ward</label>
                      <select className="form-input" value={selectedWard} onChange={handleWardChange}>
                        <option value="">— Choose Ward —</option>
                        {wards.map(w => (
                          <option key={w.ID || w.id} value={w.ID || w.id}>{w.NAME || w.name} ({w.TYPE || w.type})</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.78rem' }}>
                        Select Bed
                        {selectedWard && beds.length > 0 && (
                          <span style={{ marginLeft: 6, fontSize: '0.68rem', color: '#10b981', fontWeight: 600 }}>
                            ({beds.length} available)
                          </span>
                        )}
                      </label>
                      <select className="form-input" value={selectedBed} onChange={e => setSelectedBed(e.target.value)} disabled={!selectedWard}>
                        <option value="">— Choose Bed —</option>
                        {beds.map(b => (
                          <option key={b.ID || b.id} value={b.ID || b.id}>
                            Room {b.ROOM_NUMBER} → Bed {b.BED_NUMBER}
                          </option>
                        ))}
                      </select>
                      {selectedWard && beds.length === 0 && (
                        <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#ef4444', fontWeight: 600 }}>⚠️ No beds available in this ward.</div>
                      )}
                    </div>
                  </div>

                  {/* Selected Bed Summary */}
                  {selectedBed && (() => {
                    const bed = beds.find(b => String(b.ID || b.id) === String(selectedBed));
                    const ward = wards.find(w => String(w.ID || w.id) === String(selectedWard));
                    if (!bed) return null;
                    return (
                      <div style={{
                        marginTop: 14, padding: '12px 16px', borderRadius: 10,
                        background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
                        display: 'flex', alignItems: 'center', gap: 14,
                      }}>
                        <span style={{ fontSize: '1.4rem' }}>✅</span>
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#10b981' }}>
                            {ward?.NAME || 'Ward'} — Room {bed.ROOM_NUMBER}, Bed {bed.BED_NUMBER}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                            Patient will be assigned to this bed upon confirmation.
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 28px', borderTop: '1px solid var(--border)',
              background: 'var(--surface-2)', borderRadius: '0 0 20px 20px',
              display: 'flex', justifyContent: 'flex-end', gap: 12,
            }}>
              <button className="btn btn-ghost" onClick={() => setAdmitModal(null)}>Cancel</button>
              <button
                className="btn btn-primary btn-lg"
                onClick={handleAdmitSubmit}
                disabled={admitting || !selectedBed}
                style={{ minWidth: 180 }}
              >
                {admitting ? '⏳ Processing...' : '✅ Confirm Admission'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
