import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ReferralTypeModal from '../ReferralTypeModal';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/axios';
import { useSocket } from '../../context/SocketContext';
import { toast } from 'react-hot-toast';

const COMPLETED_PRESCRIPTION_STATUSES = new Set(['Consulted', 'Finalized', 'Dispensed']);

function isSavedPrescription(rx) {
  return COMPLETED_PRESCRIPTION_STATUSES.has(rx.status) || Number(rx.medicine_count || 0) > 0;
}

function isSameLocalDate(value, date = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getFullYear() === date.getFullYear()
    && parsed.getMonth() === date.getMonth()
    && parsed.getDate() === date.getDate();
}

function getPatientTypeBadge(type) {
  if (type === 'corporate_employee') return { label: 'Corporate', bg: 'rgba(16,185,129,0.1)', color: 'var(--green)', border: 'rgba(16,185,129,0.2)' };
  if (type === 'cisf_employee') return { label: 'CISF', bg: 'rgba(99,102,241,0.1)', color: '#4f46e5', border: 'rgba(99,102,241,0.2)' };
  return { label: 'General', bg: 'rgba(59,130,246,0.1)', color: 'var(--blue)', border: 'rgba(59,130,246,0.2)' };
}

function normalizeDashboardSearch(value) {
  return String(value ?? '').trim().toLowerCase();
}

function matchesDashboardPatientSearch(patient, query) {
  const search = normalizeDashboardSearch(query);
  if (!search) return true;

  return [
    patient?.name,
    patient?.uhid,
    patient?.empNumber,
    patient?.phoneNumber,
    patient?.mobile,
    patient?.age,
    patient?.gender,
    patient?.patientType,
    getPatientTypeBadge(patient?.patientType).label,
    patient?.consulting_doctor_name,
  ].map(normalizeDashboardSearch).join(' ').includes(search);
}

function isPendingLabReview(lab) {
  return normalizeDashboardSearch(lab?.status) !== 'completed';
}

function getActionMenuPosition(rect, preferredWidth = 240) {
  const safeGap = 8;
  if (typeof window === 'undefined') {
    return { top: rect.bottom + 6, left: Math.max(safeGap, rect.right - preferredWidth) };
  }

  const maxLeft = Math.max(safeGap, window.innerWidth - preferredWidth - safeGap);
  const maxTop = Math.max(safeGap, window.innerHeight - 360);
  return {
    top: Math.min(rect.bottom + 6, maxTop),
    left: Math.min(Math.max(safeGap, rect.right - preferredWidth), maxLeft),
  };
}


export default function DoctorDashboard() {
  const { user } = useAuth();
  const [todayPatients, setTodayPatients] = useState([]);
  const [myPatients, setMyPatients] = useState([]);
  const [pendingPatients, setPendingPatients] = useState([]);
  const [doctorPrescriptions, setDoctorPrescriptions] = useState([]);
  const [doctorLabs, setDoctorLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState(null);
  const navigate = useNavigate();
  const socket = useSocket();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [todayStatusFilter, setTodayStatusFilter] = useState('all');
  const [todaySearch, setTodaySearch] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');

  // State for Referral Modal
  const [isReferralModalOpen, setIsReferralModalOpen] = useState(false);
  const [selectedPatientForReferral, setSelectedPatientForReferral] = useState(null);

  // Actions dropdown state — rendered as overlay outside the table
  const [actionPatient, setActionPatient] = useState(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });
  const actionBtnRefs = useRef({});
  const pendingActionId = useRef(null);

  const openActions = (patient, e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropdownPos(getActionMenuPosition(rect, 240));
    setActionPatient(patient);
    setExpandedRow(patient.id);
  };

  const closeActions = () => {
    setActionPatient(null);
    setExpandedRow(null);
  };

  useEffect(() => {
    fetchDoctorData();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('lab_result_ready', (data) => {
      toast.success(`Lab Result Ready for Item ID: ${data.itemId}`, { icon: '🔬', duration: 5000 });
    });
    socket.on('lab_status_change', (data) => {
      if (data.status === 'In Progress') toast(`Lab Order ${data.orderId} is now In Progress`, { icon: '🧪' });
    });
    socket.on('prescription_dispensed', (data) => {
      toast.success(`Prescription ${data.prescriptionId} has been dispensed`, { icon: '💊', duration: 5000 });
    });
    return () => {
      socket.off('lab_result_ready');
      socket.off('lab_status_change');
      socket.off('prescription_dispensed');
    };
  }, [socket]);

  const fetchDoctorData = async () => {
    try {
      const [todayRes, patientsRes, pendingRes, prescriptionsRes, labsRes] = await Promise.allSettled([
        api.get('/patients/hms/today-patients'),
        api.get('/doctor/my-patients'),
        api.get('/patients/hms/pending-consultation'),
        api.get('/doctor/prescriptions'),
        api.get('/doctor/labs'),
      ]);

      const failedRequests = [todayRes, patientsRes, pendingRes, prescriptionsRes, labsRes]
        .filter((result) => result.status === 'rejected');
      if (failedRequests.length > 0) {
        console.error('Failed to fetch some doctor dashboard data:', failedRequests.map((result) => result.reason));
      }

      setTodayPatients(todayRes.status === 'fulfilled' ? todayRes.value.data?.data || [] : []);
      setMyPatients(patientsRes.status === 'fulfilled' ? patientsRes.value.data?.data || [] : []);
      setPendingPatients(pendingRes.status === 'fulfilled' ? pendingRes.value.data?.data || [] : []);
      setDoctorPrescriptions(prescriptionsRes.status === 'fulfilled' ? prescriptionsRes.value.data?.data || [] : []);
      setDoctorLabs(labsRes.status === 'fulfilled' ? labsRes.value.data?.data || [] : []);
      setLastRefreshedAt(new Date());
    } catch (err) {
      console.error('Failed to fetch doctor data:', err);
      setTodayPatients([]);
      setMyPatients([]);
      setPendingPatients([]);
      setDoctorPrescriptions([]);
      setDoctorLabs([]);
      setLastRefreshedAt(null);
    } finally {
      setLoading(false);
    }
  };

  const startConsultation = async (patient, e) => {
    try {
      // Capture button position for dropdown before the API call
      if (e && e.currentTarget) {
        const rect = e.currentTarget.getBoundingClientRect();
        setDropdownPos(getActionMenuPosition(rect, 240));
      }
      const payload = { patient_id: patient.id, department_id: null, encounter_type: 'OPD' };
      await api.post('/hms/encounters', payload);
      toast.success('Consultation started!');
      pendingActionId.current = patient.id;
      await fetchDoctorData();
    } catch (err) {
      console.error('Failed to start consultation:', err);
      toast.error('Failed to start consultation');
    }
  };

  // Auto-open actions dropdown after startConsultation refreshes data
  useEffect(() => {
    if (pendingActionId.current && todayPatients.length > 0) {
      const pid = pendingActionId.current;
      const patient = todayPatients.find(p => p.id === pid);
      if (patient && patient.encounter_id) {
        pendingActionId.current = null;
        setActionPatient(patient);
        setExpandedRow(patient.id);
        // Recalculate position from ref if available
        const btn = actionBtnRefs.current[pid];
        if (btn) {
          const rect = btn.getBoundingClientRect();
          setDropdownPos(getActionMenuPosition(rect, 240));
        }
      }
    }
  }, [todayPatients]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 16 }}>
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading clinical workspace...</p>
      </div>
    );
  }

  const completedPrescriptionPatientIds = new Set(
    doctorPrescriptions
      .filter(rx => isSavedPrescription(rx) && isSameLocalDate(rx.created_at))
      .map(rx => Number(rx.patient_id))
      .filter(Boolean)
  );
  const isCompletedToday = (patient) => (
    patient.encounter_status === 'Finalized' || completedPrescriptionPatientIds.has(Number(patient.id))
  );
  const waitingPatients = todayPatients.filter(p => !p.encounter_id);
  const consultingPatients = todayPatients.filter(p => p.encounter_id && !isCompletedToday(p));
  const completedPatients = todayPatients.filter(isCompletedToday);
  const todayPatientsForStatus = todayStatusFilter === 'waiting'
    ? waitingPatients
    : todayStatusFilter === 'consulting'
      ? consultingPatients
      : todayStatusFilter === 'completed'
        ? completedPatients
        : todayPatients;
  const visibleTodayPatients = todayPatientsForStatus.filter(p => matchesDashboardPatientSearch(p, todaySearch));
  const visiblePendingPatients = pendingPatients.filter(p => matchesDashboardPatientSearch(p, pendingSearch));
  const pendingLabReviews = doctorLabs.filter(isPendingLabReview).length;
  const todayQueueTabs = [
    { key: 'all', label: 'All', count: todayPatients.length },
    { key: 'waiting', label: 'Waiting', count: waitingPatients.length },
    { key: 'consulting', label: 'Consulting', fullLabel: 'In Consultation', count: consultingPatients.length },
    { key: 'completed', label: 'Completed', count: completedPatients.length },
  ];

  const hour = currentTime.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const dateStr = currentTime.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lastRefreshedLabel = lastRefreshedAt
    ? lastRefreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '--';

  const majorCards = [
    { icon: '👥', label: "Today's Patients", value: todayPatients.length, color: '#3b82f6', border: '#3b82f6' },
    { icon: '⏳', label: 'Waiting', value: waitingPatients.length, color: waitingPatients.length > 0 ? '#f59e0b' : '#10b981', border: '#f59e0b' },
    { icon: '🩺', label: 'In Consultation', value: consultingPatients.length, color: '#8b5cf6', border: '#8b5cf6' },
    { icon: '✅', label: 'Completed', value: completedPatients.length, color: '#10b981', border: '#10b981' },
    { icon: '🔬', label: 'Pending Lab Reviews', value: pendingLabReviews, color: pendingLabReviews > 0 ? '#eab308' : '#10b981', border: '#eab308' },
  ];

  return (
    <div className="doctor-dashboard-shell" style={{
      display: 'grid', gridTemplateColumns: 'minmax(270px, 320px) minmax(0, 1fr)',
      minHeight: 'calc(100vh - 72px)',
      overflow: 'visible',
      background: 'var(--bg)',
    }}>

      {/* ── LEFT PANEL (Doctor Profile + Stats) ── */}
      <div className="doctor-dashboard-sidebar" style={{
        display: 'flex', flexDirection: 'column',
        background: 'transparent',
        borderRight: 'none',
        overflow: 'visible',
        padding: '24px 20px',
        gap: 16,
      }}>

        {/* ── Doctor Profile Card ── */}
        <div className="doctor-dashboard-profile-card" style={{
          padding: '20px 22px',
          borderRadius: 16,
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border)',
          position: 'relative',
          overflow: 'visible',
          minHeight: 'fit-content',
        }}>
          {/* Gradient top accent */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 4,
            background: 'linear-gradient(90deg, #06b6d4, #8b5cf6)',
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
          }} />

          <div className="doctor-dashboard-profile-top" style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: 'var(--text-muted)', fontStyle: 'italic',
            }}>
              {greeting}
            </div>
          </div>

          <div className="doctor-dashboard-profile-name" style={{
            fontFamily: 'var(--font-body, system-ui, -apple-system, sans-serif)',
            fontSize: 'clamp(1.15rem, 1.4vw, 1.4rem)', fontWeight: 700, lineHeight: 1.35,
            color: 'var(--text-primary)', marginBottom: 8, letterSpacing: '-0.01em',
            wordBreak: 'break-word', overflowWrap: 'break-word',
          }}>
            {user?.name || 'Doctor'}
          </div>
          <div className="doctor-dashboard-profile-date" style={{
            fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500,
            marginBottom: 16, lineHeight: 1.4,
          }}>
            {dateStr} — Clinical Workspace
          </div>

          <div className="doctor-dashboard-profile-actions" style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => navigate('/hms/appointments/book')}
              style={{
                flex: '1 1 auto', whiteSpace: 'nowrap', padding: '10px 12px', fontSize: '0.85rem', fontWeight: 700,
                borderRadius: 10, color: 'var(--text-inverse)',
                background: 'var(--green)',
                border: 'none', boxShadow: '0 4px 12px rgba(15,118,110,0.2)',
              }}>
              + Book Follow-up
            </button>
            <button className="btn btn-outline" 
              onClick={() => {
                fetchDoctorData();
                toast.success('Dashboard refreshed');
              }}
              style={{
                flex: '1 1 auto', whiteSpace: 'nowrap', padding: '10px 12px', fontSize: '0.85rem', fontWeight: 600,
                borderRadius: 10, color: 'var(--green)',
                border: '1px solid var(--green)', background: 'transparent',
              }}>
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* ── Stat Cards ── */}
        {majorCards.map((c) => (
          <div key={c.label} className="doctor-dashboard-stat-card" style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '16px 20px', borderRadius: 16,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid var(--border)',
            borderLeft: `6px solid ${c.border || c.color}`,
          }}>
            <span style={{
              width: 42, height: 42, borderRadius: '50%',
              background: `${c.color}15`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.2rem', flexShrink: 0,
            }}>{c.icon}</span>
            <span style={{
              flex: 1, fontSize: '0.85rem', fontWeight: 700,
              color: 'var(--text-secondary)', textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>{c.label}</span>
            <span style={{
              fontSize: '1.75rem', fontWeight: 800,
              color: c.color, lineHeight: 1,
              minWidth: 32, textAlign: 'right',
            }}>{c.value}</span>
          </div>
        ))}

        {/* Credits */}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            Designed, developed, and maintained by HMS IT Department © 2026.
          </div>
        </div>
      </div>

      {/* ── RIGHT CONTENT (Side-by-side tables) ── */}
      <div className="doctor-dashboard-content" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px', minHeight: 0, overflow: 'visible', padding: '16px 20px' }}>

          {/* ── Today's Registered Patients ── */}
          <div className="card hms-anim-5 doctor-dashboard-table-card doctor-dashboard-today-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, height: 'auto' }}>
            <div className="doctor-dashboard-card-header" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}>
              <div className="doctor-dashboard-card-title-block">
                <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 8,
                    background: 'rgba(59,130,246,0.1)', fontSize: '0.9rem',
                  }}>
                    📋
                  </span>
                  Today's Patients
                </h3>
                <span className="doctor-dashboard-last-refreshed">Last refreshed: {lastRefreshedLabel}</span>
              </div>
              <div className="doctor-dashboard-card-actions">
                {todayPatients.length > 0 && (
                  <label className="doctor-dashboard-list-search doctor-dashboard-header-search">
                    <span aria-hidden="true">🔎</span>
                    <input
                      type="search"
                      value={todaySearch}
                      onChange={(e) => setTodaySearch(e.target.value)}
                      placeholder="Search patient, UHID, emp no"
                      aria-label="Search today's patients"
                    />
                  </label>
                )}
                <button className="btn btn-sm btn-ghost" onClick={fetchDoctorData}>↻ Refresh</button>
              </div>
            </div>

            {todayPatients.length > 0 && (
              <div className="doctor-dashboard-list-tools">
                <div className="doctor-dashboard-segmented" role="tablist" aria-label="Filter today patients">
                  {todayQueueTabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={todayStatusFilter === tab.key ? 'active' : ''}
                      onClick={() => setTodayStatusFilter(tab.key)}
                      title={tab.fullLabel || tab.label}
                    >
                      <span>{tab.label}</span>
                      <strong>{tab.count}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {todayPatients.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', flex: 1 }}>
                ☕ No patients registered for consultation today.
              </div>
            ) : visibleTodayPatients.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', flex: 1 }}>
                🔎 No matching patients in this queue.
              </div>
            ) : (
              <div className="table-wrapper hms-table-anim doctor-dashboard-table-wrap doctor-dashboard-list-scroll" style={{ border: 'none', borderRadius: 0, boxShadow: 'none', flex: 1, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr><th style={{width:30}}>#</th><th>Patient</th><th style={{textAlign:'center'}}>Type</th><th>Status</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {visibleTodayPatients.map((p, idx) => {
                      const isBeingConsulted = !!p.encounter_id;
                      const isMyConsultation = isBeingConsulted && String(p.consulting_doctor_id) === String(user?.id);
                      const isDone = isCompletedToday(p);
                      const typeBadge = getPatientTypeBadge(p.patientType);
                      const rowBg = isDone ? 'rgba(16,185,129,0.04)' : isMyConsultation ? 'rgba(59,130,246,0.05)' : isBeingConsulted ? 'rgba(245,158,11,0.04)' : 'transparent';

                      return (
                        <tr key={p.id} style={{ background: rowBg }}>
                          <td><strong>{idx + 1}</strong></td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              {p.uhid} • {p.age}y • {p.gender}
                              {p.empNumber && <span> • Emp: {p.empNumber}</span>}
                            </div>
                            {p.created_at && (
                              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>
                                Reg: {new Date(p.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: typeBadge.bg,
                              color: typeBadge.color,
                              border: `1px solid ${typeBadge.border}`,
                            }}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              {isDone ? (
                                <span className="badge badge-green">✓ Done</span>
                              ) : isBeingConsulted ? (
                                <span className="badge badge-blue">In Consultation</span>
                              ) : (
                                <span className="badge badge-amber" style={{ animation: 'hmsPulseGlow 2s infinite' }}>⏳ Waiting</span>
                              )}
                              {isBeingConsulted && !isMyConsultation && (
                                <span style={{
                                  fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic',
                                  display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', marginTop: 2,
                                  background: 'var(--surface-2)', padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)'
                                }}>
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                                  BY — Dr. {p.consulting_doctor_name}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            {(() => {
                              const isExpanded = expandedRow === p.id;
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  {!isBeingConsulted ? (
                                    <button ref={el => { actionBtnRefs.current[p.id] = el; }} className="btn btn-sm btn-primary" onClick={(e) => startConsultation(p, e)}
                                      style={{ whiteSpace: 'nowrap', fontSize: '0.76rem', padding: '6px 14px', borderRadius: 8 }}>Start Consulting</button>
                                  ) : isMyConsultation ? (
                                    <button
                                      className={`btn btn-sm ${isExpanded ? '' : 'btn-primary'}`}
                                      onClick={(e) => { if (isExpanded) { closeActions(); } else { openActions(p, e); } }}
                                      style={{
                                        whiteSpace: 'nowrap', fontSize: '0.76rem', padding: '6px 14px', borderRadius: 8,
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        ...(isExpanded ? { background: 'var(--red-light)', color: 'var(--red)', border: '1px solid var(--red-border)' } : {}),
                                      }}>{isExpanded ? '\u2715 Close' : '\u25b8 Actions'}</button>
                                  ) : (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 4px' }}>View Only</span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Pending Consultation (Unconsulted Past Patients) ── */}
          <div className="card hms-anim-6 doctor-dashboard-table-card doctor-dashboard-pending-card" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, height: 'auto' }}>
            <div className="doctor-dashboard-card-header" style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface-2)',
            }}>
              <div className="doctor-dashboard-card-title-block">
                <h3 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: 8,
                    background: 'rgba(245,158,11,0.1)', fontSize: '0.9rem',
                  }}>
                    ⏰
                  </span>
                  Pending Consultation
                  {pendingPatients.length > 0 && (
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                      background: 'var(--amber-light)', color: 'var(--amber)', border: '1px solid var(--amber-border)',
                    }}>{pendingPatients.length}</span>
                  )}
                </h3>
                <span className="doctor-dashboard-last-refreshed">Last refreshed: {lastRefreshedLabel}</span>
              </div>
              <div className="doctor-dashboard-card-actions">
                {pendingPatients.length > 0 && (
                  <label className="doctor-dashboard-list-search doctor-dashboard-header-search">
                    <span aria-hidden="true">🔎</span>
                    <input
                      type="search"
                      value={pendingSearch}
                      onChange={(e) => setPendingSearch(e.target.value)}
                      placeholder="Search pending patient, UHID, emp no"
                      aria-label="Search pending consultations"
                    />
                  </label>
                )}
                <button className="btn btn-sm btn-ghost" onClick={fetchDoctorData}>↻ Refresh</button>
              </div>
            </div>

            {pendingPatients.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', flex: 1 }}>
                ✅ All registered patients have been consulted.
              </div>
            ) : visiblePendingPatients.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', flex: 1 }}>
                🔎 No matching pending consultations.
              </div>
            ) : (
              <div className="table-wrapper hms-table-anim doctor-dashboard-table-wrap doctor-dashboard-list-scroll" style={{ border: 'none', borderRadius: 0, boxShadow: 'none', flex: 1, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr><th style={{width:30}}>#</th><th>Patient</th><th style={{textAlign:'center'}}>Type</th><th>Registered</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {visiblePendingPatients.map((p, idx) => {
                      const isExpired = p.days_ago >= 4;
                      const regDate = p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
                      const daysLabel = p.days_ago === 1 ? '1 day ago' : `${p.days_ago} days ago`;
                      const typeBadge = getPatientTypeBadge(p.patientType);

                      return (
                        <tr key={p.id} style={{
                          opacity: isExpired ? 0.45 : 1,
                          textDecoration: isExpired ? 'line-through' : 'none',
                          background: isExpired ? 'rgba(148,163,184,0.07)' : 'transparent',
                          pointerEvents: isExpired ? 'none' : 'auto',
                        }}>
                          <td><strong>{idx + 1}</strong></td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                              {p.uhid} • {p.age}y • {p.gender}
                              {p.empNumber && <span> • Emp: {p.empNumber}</span>}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              background: typeBadge.bg,
                              color: typeBadge.color,
                              border: `1px solid ${typeBadge.border}`,
                            }}>
                              {typeBadge.label}
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{
                                fontSize: '0.73rem', fontWeight: 700,
                                color: isExpired ? 'var(--red)' : p.days_ago >= 3 ? 'var(--amber)' : 'var(--text-secondary)',
                              }}>
                                {daysLabel}
                              </span>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{regDate}</span>
                              {p.created_at && (
                                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                  {new Date(p.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            {isExpired ? (
                              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Expired</span>
                            ) : (
                              <button className="btn btn-sm btn-primary" onClick={() => startConsultation(p)}
                                style={{ whiteSpace: 'nowrap', fontSize: '0.76rem', padding: '6px 14px', borderRadius: 8 }}>
                                Start Consulting
                              </button>
                            )}
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
      
      {/* Global Modals for this view */}
      <ReferralTypeModal 
        isOpen={isReferralModalOpen} 
        onClose={() => { setIsReferralModalOpen(false); setSelectedPatientForReferral(null); }} 
        patient={selectedPatientForReferral} 
      />
{/* ── Patient Actions Dropdown Overlay ── */}
      {actionPatient && (() => {
        const p = actionPatient;
        const prescriptionAction = { label: 'Prescription', icon: '\u211B', iconBg: '#0d9488', onClick: () => navigate(`/hms/prescription-slip?patientId=${p.id}&encounterId=${p.encounter_id}`) };
        const ipdAction = { label: 'Move to IPD', icon: '\uD83C\uDFE5', iconBg: '#ec4899', onClick: () => navigate(`/ipd/admission-form?patientId=${p.id}`) };
        const corporateExtras = [
          { label: 'Referral', icon: '🔗', iconBg: '#3b82f6', onClick: () => { setSelectedPatientForReferral(p); setIsReferralModalOpen(true); } },
          { label: 'Rest Form', icon: '🛏️', iconBg: '#d97706', onClick: () => navigate(`/doctor/rest-forms/new?patientId=${p.id}`) },
          { label: 'Med Certificate', icon: '📋', iconBg: '#7c3aed', onClick: () => navigate(`/doctor/medical-certificate?patientId=${p.id}`) },
          ipdAction
        ];
        const generalExtras = [
          { label: 'Med Certificate', icon: '📋', iconBg: '#7c3aed', onClick: () => navigate(`/doctor/medical-certificate?patientId=${p.id}`) },
          ipdAction
        ];
        const isCorporate = p.patientType === 'corporate_employee';
        const actions = [prescriptionAction, ...(isCorporate ? corporateExtras : generalExtras)];

        return (
          <>
            {/* Transparent backdrop */}
            <div 
              onClick={closeActions}
              style={{
                position: 'fixed', inset: 0, zIndex: 9998,
                background: 'transparent',
              }}
            />
            {/* Dropdown panel */}
            <div className="doctor-dashboard-actions-menu" style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: 240,
              background: 'var(--surface, #fff)',
              borderRadius: 14,
              border: '1px solid var(--border, rgba(0,0,0,0.08))',
              boxShadow: '0 16px 48px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
              zIndex: 9999,
              overflow: 'hidden',
              animation: 'hmsSlideDown 0.22s cubic-bezier(0.16,1,0.3,1) both',
            }}>
              {/* Header */}
              <div style={{
                padding: '11px 16px 9px',
                fontSize: '0.65rem', fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.12em',
                color: 'var(--text-muted, #94a3b8)',
                borderBottom: '1px solid var(--border, rgba(0,0,0,0.06))',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span>Patient Actions</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'none', letterSpacing: 'normal' }}>{p.name}</span>
              </div>

              {/* Items */}
              <div style={{ padding: '6px 0' }}>
                {actions.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => { closeActions(); a.onClick(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      width: '100%', padding: '10px 16px',
                      border: 'none', background: 'transparent',
                      cursor: 'pointer', transition: 'all 0.15s',
                      textAlign: 'left', fontFamily: 'inherit',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-2, rgba(0,0,0,0.03))'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: `${a.iconBg}14`,
                      border: `1px solid ${a.iconBg}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '1rem', flexShrink: 0, color: a.iconBg,
                    }}>
                      {a.icon}
                    </span>
                    <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary, #1e293b)' }}>
                      {a.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
