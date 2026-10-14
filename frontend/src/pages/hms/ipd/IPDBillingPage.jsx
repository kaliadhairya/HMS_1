import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import AccountWorkspace from '../../../components/billing/AccountWorkspace';

// Inpatient billing (Phase 5): the admission's billing account. Bed days,
// dispensed medicines and tests are charged as they happen; staff add
// consumables; the desk issues interim and final bills from the account.
export default function IPDBillingPage() {
  const { admissionId } = useParams();
  const navigate = useNavigate();
  const [admission, setAdmission] = useState(null);

  useEffect(() => {
    api.get(`/ipd/admissions/${admissionId}`).then((r) => setAdmission(r.data.data)).catch(() => toast.error('Could not load the admission.'));
  }, [admissionId]);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="IPD billing"
          description={`Admission ${admission?.ADMISSION_ID_FORMATTED || admissionId}`}
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/ipd/billing')}>
              <ArrowLeft size={16} aria-hidden="true" /> Back to list
            </button>
          )}
        />
        {admission && (
          <section className="panel panel-pad" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="cell-avatar" aria-hidden="true">{(admission.PATIENT_NAME || '?').charAt(0).toUpperCase()}</span>
              <span className="cell-stack">
                <span className="cell-primary" style={{ fontSize: '1.05rem' }}>{admission.PATIENT_NAME}</span>
                <span className="cell-secondary"><span className="mono">{admission.UHID}</span> · {admission.AGE} y / {admission.GENDER?.[0]}</span>
              </span>
              {admission.STATUS === 'Active'
                ? <span className="status status-info" style={{ marginLeft: 'auto' }}>In hospital</span>
                : <span className="status status-neutral" style={{ marginLeft: 'auto' }}>Discharged {admission.DISCHARGE_DATE ? new Date(admission.DISCHARGE_DATE).toLocaleDateString('en-IN') : ''}</span>}
            </div>
            <div className="facts">
              <div><div className="fact-label">Location</div><div className="fact-value">{admission.WARD_NAME} · Bed {admission.BED_NUMBER}</div></div>
              <div><div className="fact-label">Admitted</div><div className="fact-value">{admission.ADMISSION_DATE ? new Date(admission.ADMISSION_DATE).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div></div>
              <div><div className="fact-label">Consulting doctor</div><div className="fact-value">{admission.DOCTOR_NAME}</div></div>
              <div><div className="fact-label">Dept. / type</div><div className="fact-value">{admission.DEPARTMENT} / {admission.ADMISSION_TYPE}</div></div>
            </div>
          </section>
        )}
        <AccountWorkspace episode={{ admissionId }} medicineSearch />
      </main>
    </>
  );
}
