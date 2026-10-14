// Typed read mappings for immutable clinical source versions. Legacy routes
// supply rows explicitly; no mapper invents a dose, code, unit or privilege.
type Id = string | number;
type Timestamp = string | Date;
type Reference = { reference: string };
type Concept = { text: string };
type Quantity = { value: number; unit: string };
type MedicationVersion = {
  id: string; order_id: string; version: number; current_version: number;
  patient_id: number; encounter_id: number; admission_id: number | null;
  state: 'DRAFT' | 'SIGNED' | 'HELD' | 'DISCONTINUED';
  product_snapshot: { name?: string; code?: string };
  dose: string | number; dose_unit: string; route: string;
  frequency: { type: 'INTERVAL'; interval_minutes: number };
  starts_at: Timestamp; ends_at: Timestamp; signed_at: Timestamp;
  prn: boolean; indication: string | null; supply_quantity: string | number;
  supply_unit: string; author_user_id: number;
};
type DispenseLine = {
  id: string; version_id: string; patient_id: number; dispenser_user_id: number;
  product_name: string; quantity: string | number; unit: string; created_at: Timestamp;
};
type Administration = {
  id: string; version_id: string; patient_id: number; product_name: string;
  performer_user_id: number; actual_at: Timestamp; dose: string | number;
  dose_unit: string; route: string; outcome: 'GIVEN' | 'HELD' | 'REFUSED' | 'OMITTED';
  reason: string | null; corrections: Array<{ corrected_fields: {
    actual_at?: Timestamp; entered_in_error?: boolean; notes?: string
  }; reason: string }>;
};
const reference = (type: string, id: Id): Reference => ({ reference: `${type}/${id}` });
const when = (value: Timestamp): string => {
  const text = String(value);
  const d = value instanceof Date ? value : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(' ', 'T')}Z`);
  if (!Number.isFinite(d.getTime())) throw new Error('Clinical source timestamp is invalid');
  return d.toISOString();
};
const quantity = (value: string | number, unit: string): Quantity => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !unit?.trim()) throw new Error('Clinical source quantity is invalid');
  return { value: n, unit };
};
const medication = (name: string | undefined): Concept => {
  if (!name?.trim()) throw new Error('Clinical source medication identity is missing');
  return { text: name };
};
function medicationRequest(v: MedicationVersion) {
  const superseded = Number(v.version) !== Number(v.current_version);
  const status = superseded || v.state === 'DISCONTINUED' ? 'stopped' : v.state === 'HELD' ? 'on-hold' : v.state === 'SIGNED' ? 'active' : 'unknown';
  const q = quantity(v.dose, v.dose_unit);
  return {
    resourceType: 'MedicationRequest', id: v.id, meta: { versionId: String(v.version) },
    status, intent: 'order', medicationCodeableConcept: medication(v.product_snapshot.name),
    subject: reference('Patient', v.patient_id),
    encounter: reference('Encounter', v.admission_id ? `ipd-${v.admission_id}` : `opd-${v.encounter_id}`),
    authoredOn: when(v.signed_at), requester: reference('Practitioner', v.author_user_id),
    reasonCode: v.indication ? [{ text: v.indication }] : undefined,
    dosageInstruction: [{
      text: `${v.dose} ${v.dose_unit}, ${v.route}, every ${v.frequency.interval_minutes} minutes${v.prn ? ` as needed: ${v.indication}` : ''}`,
      timing: { repeat: { boundsPeriod: { start: when(v.starts_at), end: when(v.ends_at) }, frequency: 1, period: v.frequency.interval_minutes, periodUnit: 'min' } },
      asNeededBoolean: v.prn, route: { text: v.route }, doseAndRate: [{ doseQuantity: q }],
    }],
    dispenseRequest: { quantity: quantity(v.supply_quantity, v.supply_unit), validityPeriod: { start: when(v.starts_at), end: when(v.ends_at) } },
  };
}
function medicationDispense(d: DispenseLine) {
  return {
    resourceType: 'MedicationDispense', id: d.id, status: 'completed',
    medicationCodeableConcept: medication(d.product_name), subject: reference('Patient', d.patient_id),
    performer: [{ actor: reference('Practitioner', d.dispenser_user_id) }],
    authorizingPrescription: [reference('MedicationRequest', d.version_id)],
    quantity: quantity(d.quantity, d.unit), whenHandedOver: when(d.created_at),
  };
}
function medicationAdministration(a: Administration) {
  let actualAt = a.actual_at;
  let enteredInError = false;
  const note: Array<{ text: string }> = [];
  for (const c of a.corrections || []) {
    if (c.corrected_fields.actual_at) actualAt = c.corrected_fields.actual_at;
    if (c.corrected_fields.entered_in_error !== undefined) enteredInError = c.corrected_fields.entered_in_error;
    note.push({ text: `Linked correction: ${c.reason}${c.corrected_fields.notes ? `; ${c.corrected_fields.notes}` : ''}` });
  }
  return {
    resourceType: 'MedicationAdministration', id: a.id,
    meta: { versionId: String(1 + (a.corrections || []).length) },
    status: enteredInError ? 'entered-in-error' : a.outcome === 'GIVEN' ? 'completed' : 'not-done',
    statusReason: a.reason ? [{ text: a.reason }] : undefined,
    medicationCodeableConcept: medication(a.product_name), subject: reference('Patient', a.patient_id),
    effectiveDateTime: when(actualAt), performer: [{ actor: reference('Practitioner', a.performer_user_id) }],
    request: reference('MedicationRequest', a.version_id),
    dosage: { route: { text: a.route }, dose: quantity(a.dose, a.dose_unit) },
    note: note.length ? note : undefined,
  };
}
module.exports = { medicationRequest, medicationDispense, medicationAdministration };
