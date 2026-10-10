import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { BedDouble, CircleCheck, DoorOpen, Plus, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import DataTable from '../../../components/ui/DataTable';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';

const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const occupancyTone = (pct) => (pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--success)');

export default function ReceptionistIPDPage() {
  const navigate = useNavigate();
  const [data, setData] = useState({ admissions: [], beds: [] });
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('admissions');
  const [advanceTarget, setAdvanceTarget] = useState(null);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [savingAdvance, setSavingAdvance] = useState(false);

  useEffect(() => {
    api.get('/receptionist/ipd-admissions')
      .then(res => setData(res.data.data))
      .catch((err) => { console.error(err); toast.error('Could not load admissions'); })
      .finally(() => setLoading(false));
  }, []);

  const openAdvance = (admission) => {
    setAdvanceAmount('');
    setAdvanceTarget(admission);
  };

  const addAdvance = async (e) => {
    e.preventDefault();
    const admission = advanceTarget;
    if (!admission || !advanceAmount) return;
    const amount = Number(advanceAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    setSavingAdvance(true);
    try {
      await api.post('/billing/advance', {
        patientId: admission.patient_id,
        admissionId: admission.id,
        amount,
        paymentMode: 'Cash',
        notes: 'Collected from receptionist IPD desk',
      });
      toast.success('Advance recorded');
      setAdvanceTarget(null);
      const res = await api.get('/receptionist/ipd-admissions');
      setData(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record advance');
    } finally {
      setSavingAdvance(false);
    }
  };

  const totalBeds = data.beds.reduce((s, w) => s + w.total, 0);
  const totalAvail = data.beds.reduce((s, w) => s + w.available, 0);
  const admittedCount = data.admissions.filter(a => a.status === 'Admitted').length;
  const dischargeCount = data.admissions.filter(a => a.status === 'Discharge Pending').length;

  const rows = useMemo(
    () => data.admissions.filter(a => (tab === 'admissions' ? a.status === 'Admitted' : a.status === 'Discharge Pending')),
    [data.admissions, tab],
  );

  const columns = useMemo(() => [
    {
      id: 'id', header: 'Adm. ID', accessorFn: (a) => Number(a.id || 0), meta: { width: 100 },
      cell: ({ getValue }) => <span className="mono">{getValue()}</span>,
    },
    {
      id: 'patient', header: 'Patient', accessorFn: (a) => a.patient || '',
      cell: ({ row }) => (
        <span className="cell-stack">
          <span className="cell-primary">{row.original.patient || '—'}</span>
          <span className="cell-secondary mono">{row.original.uhid || 'No UHID'}</span>
        </span>
      ),
    },
    { id: 'location', header: 'Ward / bed', accessorFn: (a) => `${a.ward} / ${a.bed}` },
    { id: 'doctor', header: 'Doctor', accessorFn: (a) => a.doctor || '' },
    {
      id: 'admitted', header: 'Admitted', accessorFn: (a) => (a.admission_date ? new Date(a.admission_date).getTime() : 0), meta: { width: 130 },
      cell: ({ row }) => <span className="tabular">{fmtDate(row.original.admission_date)}</span>,
    },
    {
      id: 'advance', header: 'Advance', accessorFn: (a) => Number(a.advance_paid || 0), meta: { width: 120, align: 'right' },
      cell: ({ getValue }) => <span className="tabular">{inr(getValue())}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (a) => a.status || '', meta: { width: 150 },
      cell: ({ getValue }) => <span className={`status ${getValue() === 'Admitted' ? 'status-success' : 'status-warning'}`}>{getValue()}</span>,
    },
    {
      id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, meta: { width: 170, align: 'right' },
      cell: ({ row }) => {
        const a = row.original;
        return (
          <span className="inline-actions">
            {a.status === 'Admitted' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openAdvance(a)}>
                <Wallet size={14} aria-hidden="true" /> Add advance
              </button>
            )}
            {a.status === 'Discharge Pending' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/ipd/patient/${a.id}`)}>
                Process discharge
              </button>
            )}
          </span>
        );
      },
    },
  ], [navigate]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="IPD admission desk"
          description="New admissions, bed allotment, advance deposits and discharge initiation."
          actions={(
            <button type="button" className="btn btn-primary btn-md" onClick={() => navigate('/ipd/beds')}>
              <Plus size={16} aria-hidden="true" /> New admission
            </button>
          )}
        />

        <div className="kpi-strip">
          <div className="panel kpi">
            <div className="kpi-label">Beds available</div>
            <div className="kpi-value">{totalAvail} <span className="kpi-sub">/ {totalBeds}</span></div>
          </div>
          <div className="panel kpi"><div className="kpi-label">Active admissions</div><div className="kpi-value">{admittedCount}</div></div>
          <div className="panel kpi"><div className="kpi-label">Discharge pending</div><div className="kpi-value">{dischargeCount}</div></div>
        </div>

        {data.beds.length > 0 && (
          <section className="panel panel-pad" style={{ marginBottom: 16 }}>
            <h2 className="panel-title"><BedDouble size={16} aria-hidden="true" /> Bed occupancy by ward</h2>
            <ul className="bar-list" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', columnGap: 24 }}>
              {data.beds.map((w) => {
                const pct = w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0;
                return (
                  <li key={w.ward}>
                    <div className="bar-row">
                      <span>{w.ward}</span>
                      <strong className="tabular">{w.available} free</strong>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, background: occupancyTone(pct) }} /></div>
                    <div className="cell-secondary" style={{ marginTop: 4 }}>{w.occupied}/{w.total} occupied · {pct}%</div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="panel">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Admission status">
              <button type="button" role="tab" aria-selected={tab === 'admissions'} className={tab === 'admissions' ? 'is-active' : ''} onClick={() => setTab('admissions')}>
                Active admissions <span className="seg-count">{admittedCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={tab === 'discharge'} className={tab === 'discharge' ? 'is-active' : ''} onClick={() => setTab('discharge')}>
                Discharge pending <span className="seg-count">{dischargeCount}</span>
              </button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            getRowId={(a) => String(a.id)}
            initialSorting={[{ id: 'admitted', desc: true }]}
            empty={tab === 'admissions' ? (
              <EmptyState icon={BedDouble} title="No active admissions" description="Admitted patients appear here with their ward, bed and advance paid." />
            ) : (
              <EmptyState icon={CircleCheck} title="No pending discharges" description="Patients marked for discharge appear here for processing." />
            )}
          />
        </section>
      </main>

      <Modal
        open={Boolean(advanceTarget)}
        onOpenChange={(open) => { if (!open) setAdvanceTarget(null); }}
        title="Add advance"
        description={advanceTarget ? `Cash advance for ${advanceTarget.patient} (admission ${advanceTarget.id}).` : ''}
        size="sm"
        footer={(
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setAdvanceTarget(null)}>Cancel</button>
            <button type="submit" form="advance-form" className="btn btn-primary btn-md" disabled={savingAdvance || !advanceAmount}>
              {savingAdvance ? 'Saving…' : 'Record advance'}
            </button>
          </>
        )}
      >
        <form id="advance-form" onSubmit={addAdvance}>
          <div className="form-group">
            <label className="form-label" htmlFor="advance-amount">Amount (₹)</label>
            <input
              id="advance-amount"
              className="form-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={advanceAmount}
              onChange={(e) => setAdvanceAmount(e.target.value)}
              autoFocus
              required
            />
            <p className="form-hint">Recorded as a cash payment against this admission.</p>
          </div>
        </form>
      </Modal>
    </>
  );
}
