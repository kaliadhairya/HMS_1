import { Navigate, useSearchParams } from 'react-router-dom';

// Retired free-text composer: retain deep links and exact resource identities.
// The medication service validates that the encounter belongs to the patient.
export default function LegacyPrescriptionEntry() {
  const [params] = useSearchParams();
  const patient = params.get('patientId') || params.get('patient_id');
  const encounter = params.get('encounterId') || params.get('encounter_id');
  const target = new URLSearchParams();
  if (patient) target.set('patient_id', patient);
  if (encounter) target.set('encounter_id', encounter);
  return <Navigate replace to={`/medication/orders${target.size ? `?${target}` : ''}`} />;
}
