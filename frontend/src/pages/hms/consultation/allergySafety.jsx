import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck, ShieldQuestion, TriangleAlert } from 'lucide-react';
import api from '../../../api/axios';
import Modal from '../../../components/ui/Modal';

// Patient-safety helpers shared by the consultation page, the prescription slip and quick consult.
//
// The allergy record is fetched on its own so each screen can tell three states apart:
//   'ok'      the allergies API answered (with allergies, or with none: "No known allergies")
//   'error'   it could not be loaded: "Allergies not checked", never "No known allergies"
//   'loading' / 'idle' (no patient yet)

export function usePatientAllergies(patientId) {
  const [state, setState] = useState({ status: 'idle', allergies: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!patientId) {
      setState({ status: 'idle', allergies: [] });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading', allergies: [] });
    api.get(`/patients/hms/${patientId}/allergies`)
      .then((res) => {
        if (cancelled) return;
        const list = res.data?.data;
        if (!Array.isArray(list)) throw new Error('Unexpected allergies response');
        setState({ status: 'ok', allergies: list.filter((a) => String(a?.allergen || '').trim()) });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', allergies: [] }); });
    return () => { cancelled = true; };
  }, [patientId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

const norm = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Words that say nothing about the substance ("Sulfa drugs" should still match sulfamethoxazole).
const FILLER_WORDS = new Set(['drug', 'drugs', 'group', 'class', 'allergy', 'allergic', 'tablet', 'tablets', 'capsule', 'injection', 'syrup', 'medicine', 'medicines']);

// Names to compare for one medicine: display name, generic name and brand names.
export function medicineNames(item) {
  if (!item) return [];
  const brands = Array.isArray(item.brandNames) ? item.brandNames : [];
  return [item.medicine_name, item.generic_name, item.genericName, item.name, ...brands].filter(Boolean);
}

// Recorded allergies that match a medicine: case-insensitive, the allergen contained in the
// medicine name (or generic/brand name) or the other way round. Each significant word of a
// multi-word allergen is also checked, so "Sulfa drugs" flags sulfamethoxazole.
export function findAllergyMatches(allergies, names) {
  const terms = names.map(norm).filter((t) => t.length >= 3);
  if (terms.length === 0) return [];
  return (allergies || []).filter((allergy) => {
    const allergen = norm(allergy.allergen);
    if (allergen.length < 3) return false;
    if (terms.some((t) => t.includes(allergen) || allergen.includes(t))) return true;
    const words = allergen.split(' ').filter((w) => w.length >= 4 && !FILLER_WORDS.has(w));
    return words.length > 1 && words.some((w) => terms.some((t) => t.includes(w)));
  });
}

const allergyDetail = (a) => [a.severity, a.reaction].filter(Boolean).join(', ');

// Prominent allergy status for a prescribing screen.
export function AllergyStatusPanel({ status, allergies, onRetry, style }) {
  let body;
  if (status === 'ok' && allergies.length > 0) {
    body = (
      <div className="alert-strip alert-danger" role="alert" style={{ marginBottom: 0, alignItems: 'flex-start' }}>
        <TriangleAlert size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>Allergies: </strong>
          {allergies.map((a, i) => (
            <span key={a.id || `${a.allergen}-${i}`}>
              {i > 0 && '; '}
              <strong>{a.allergen}</strong>
              {allergyDetail(a) && ` (${allergyDetail(a)})`}
            </span>
          ))}
        </div>
      </div>
    );
  } else if (status === 'ok') {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="status status-neutral"><ShieldCheck size={13} aria-hidden="true" /> No known allergies</span>
        <span className="muted">None recorded for this patient.</span>
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className="alert-strip alert-warning" role="status" style={{ marginBottom: 0, flexWrap: 'wrap' }}>
        <ShieldQuestion size={16} aria-hidden="true" />
        <span><strong>Allergies not checked.</strong> The allergy record could not be loaded. Ask the patient before prescribing.</span>
        {onRetry && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry} style={{ marginLeft: 'auto' }}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        )}
      </div>
    );
  } else if (status === 'loading') {
    body = <p className="muted" style={{ margin: 0 }}>Checking allergies…</p>;
  } else {
    body = <p className="muted" style={{ margin: 0 }}>Select a patient to see their allergies.</p>;
  }
  return <section aria-label="Patient allergies" style={style}>{body}</section>;
}

// Confirmation before a medicine that matches a recorded allergy (or one that could not be
// checked) goes on the prescription. Nothing is blocked or allowed without the doctor's choice.
export function AllergyWarningModal({ pending, onCancel, onConfirm }) {
  const open = Boolean(pending);
  const unchecked = Boolean(pending?.unchecked);
  const medicine = pending?.medicineName || 'This medicine';
  const allergenNames = (pending?.matches || []).map((a) => a.allergen).join(', ');
  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!next) onCancel(); }}
      title={unchecked ? 'Allergies not checked' : 'Allergy warning'}
      description={unchecked
        ? `The patient's allergy record could not be loaded, so ${medicine} was not checked against it.`
        : `${medicine} matches the patient's recorded allergy to ${allergenNames}.`}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className="btn btn-danger btn-md" onClick={onConfirm}>Prescribe anyway</button>
        </>
      )}
    >
      {!unchecked && (pending?.matches || []).length > 0 && (
        <ul className="list-rows" style={{ marginBottom: 12 }}>
          {pending.matches.map((a, i) => (
            <li key={a.id || i} className="list-row" style={{ cursor: 'default' }}>
              <span className="cell-stack">
                <span className="cell-primary">{a.allergen}</span>
                <span className="cell-secondary">{allergyDetail(a) || 'Severity and reaction not recorded'}</span>
              </span>
              <span className="status status-danger">Allergy</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted" style={{ margin: 0 }}>
        Prescribe only if you have confirmed it is safe for this patient. Cancel leaves it off the prescription.
      </p>
    </Modal>
  );
}

// Gate for adding medicines: check(names, label, onAllow) calls onAllow straight away when the
// medicine is clear, otherwise asks first. Render `modal` once in the page.
export function useAllergyGate({ status, allergies }) {
  const [pending, setPending] = useState(null);
  const pendingRef = useRef(null);

  const ask = (next) => { pendingRef.current = next; setPending(next); };

  const check = useCallback((names, label, onAllow) => {
    if (status !== 'ok') {
      ask({ medicineName: label, matches: [], unchecked: true, onAllow });
      return;
    }
    const matches = findAllergyMatches(allergies, names);
    if (matches.length === 0) { onAllow([]); return; }
    ask({ medicineName: label, matches, unchecked: false, onAllow });
  }, [status, allergies]);

  const cancel = useCallback(() => { pendingRef.current = null; setPending(null); }, []);
  const confirm = useCallback(() => {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (current) current.onAllow(current.matches);
  }, []);

  const modal = <AllergyWarningModal pending={pending} onCancel={cancel} onConfirm={confirm} />;
  return { check, modal };
}
