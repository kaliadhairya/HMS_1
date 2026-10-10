import { TriangleAlert, HeartPulse, ShieldCheck } from 'lucide-react';

const CATEGORY = { corporate_employee: { label: 'Corporate', tone: 'info' }, other: { label: 'General', tone: 'neutral' } };

// Sticky patient identity strip for patient-context screens: who, which record, and safety alerts.
export default function PatientBanner({ patient, allergies = [], conditions = [], actions }) {
  if (!patient) return null;
  const type = patient.patientType || patient.patient_type;
  const cat = CATEGORY[type] || CATEGORY.other;
  const isCorporate = type === 'corporate_employee';
  const initials = `${(patient.name || '?').charAt(0)}${patient.last_name ? patient.last_name.charAt(0) : ''}`.toUpperCase();
  const allergyNames = allergies.map((a) => a.allergen).filter(Boolean);

  return (
    <section className="patient-banner" aria-label="Patient summary">
      <div className="pb-identity">
        <span className="pb-avatar" aria-hidden="true">{initials}</span>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="pb-name">{patient.name}</span>
            <span className={`status status-${cat.tone}`}>{cat.label}</span>
          </div>
          <div className="pb-ids">
            <span className="mono">{patient.uhid || 'No UHID'}</span> · {patient.age ?? '–'} y · {patient.gender || '–'}
          </div>
        </div>
      </div>

      <div className="pb-facts">
        <div className="pb-fact"><span>Blood group</span><span>{patient.blood_group || 'Not recorded'}</span></div>
        <div className="pb-fact">
          <span>{isCorporate ? 'Employee no.' : 'Phone'}</span>
          <span className="tabular">{(isCorporate ? (patient.empNumber || patient.emp_number) : (patient.phoneNumber || patient.phone_number)) || '—'}</span>
        </div>
      </div>

      <div className="pb-alerts">
        {allergyNames.length > 0 ? (
          <span className="status status-danger" title={allergyNames.join(', ')}>
            <TriangleAlert size={13} aria-hidden="true" /> Allergies: {allergyNames.slice(0, 3).join(', ')}{allergyNames.length > 3 ? ` +${allergyNames.length - 3}` : ''}
          </span>
        ) : (
          <span className="status status-neutral"><ShieldCheck size={13} aria-hidden="true" /> No known allergies</span>
        )}
        {conditions.length > 0 && (
          <span className="status status-warning">
            <HeartPulse size={13} aria-hidden="true" /> {conditions.map((c) => c.condition_name || c.condition || c.name).filter(Boolean).slice(0, 2).join(', ') || `${conditions.length} chronic`}
          </span>
        )}
        {actions}
      </div>
    </section>
  );
}
