import type { Transaction } from 'sequelize';
const { sequelize } = require('../models/db');
const M = require('../domain/fhirClinical.cts');
const T = require('./terminology');
type Params = Record<string, string | number>;
type ClinicalResource = { resourceType: string; id: string; [key: string]: unknown };
const rows = (sql: string, replacements: Params, transaction: Transaction): Promise<Record<string, any>[]> =>
  sequelize.query(sql, { replacements, transaction, type: 'SELECT' });
const fail = (type: string, id: string): never => { throw Object.assign(new Error(`${type}/${id} not found.`), { status: 404, code: 'not-found' }); };
const clean = (r: ClinicalResource): ClinicalResource => JSON.parse(JSON.stringify(r));
const REQUEST_SQL = `SELECT v.*, o.patient_id, o.encounter_id, o.admission_id, o.current_version, o.state
 FROM hms_med_order_versions v JOIN hms_med_orders o ON o.id=v.order_id WHERE v.signed_at IS NOT NULL`;
const DISPENSE_SQL = `SELECT l.*, d.patient_id, d.dispenser_user_id, d.created_at, p.name AS product_name
 FROM hms_med_dispense_lines l JOIN hms_med_dispenses d ON d.id=l.dispense_id JOIN hms_med_products p ON p.id=l.product_id WHERE true`;
const ADMIN_SQL = `SELECT a.*, p.name AS product_name, coalesce((SELECT jsonb_agg(jsonb_build_object('corrected_fields', c.corrected_fields, 'reason', c.reason)
 ORDER BY c.recorded_at,c.id) FROM hms_med_corrections c WHERE c.administration_id=a.id),'[]'::jsonb) AS corrections
 FROM hms_med_administrations a JOIN hms_med_products p ON p.id=a.product_id WHERE true`;
const SOURCES: Record<string, {sql: string; alias: string; mapper: (row: any) => ClinicalResource}> = {
  MedicationRequest: {sql: REQUEST_SQL, alias: 'v', mapper: M.medicationRequest},
  MedicationDispense: {sql: DISPENSE_SQL, alias: 'l', mapper: M.medicationDispense},
  MedicationAdministration: {sql: ADMIN_SQL, alias: 'a', mapper: M.medicationAdministration},
};
async function medications(type: string, patientId: number, t: Transaction): Promise<ClinicalResource[]> {
  const s = SOURCES[type];
  const patientAlias = type === 'MedicationRequest' ? 'o' : type === 'MedicationDispense' ? 'd' : 'a';
  return (await rows(`${s.sql} AND ${patientAlias}.patient_id=:p ORDER BY ${s.alias}.id LIMIT 500`, {p: patientId}, t)).map(r => clean(s.mapper(r)));
}
async function medicationById(type: string, id: string, t: Transaction) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail(type, id);
  const s = SOURCES[type];
  const [row] = await rows(`${s.sql} AND ${s.alias}.id=:id`, {id}, t);
  if (!row) fail(type, id);
  return {patientId: row.patient_id, resource: clean(s.mapper(row))};
}
async function practitionerRole(userId: string, t: Transaction): Promise<ClinicalResource> {
  const [u] = await rows(`SELECT u.id,u.role,u.is_active FROM hms_users u JOIN hms_practitioners p ON p.user_id=u.id WHERE u.id=:id`, {id: Number(userId)||0}, t);
  if (!u) fail('PractitionerRole', userId);
  return {resourceType:'PractitionerRole', id:String(u.id), active:Boolean(Number(u.is_active)),
    practitioner:{reference:`Practitioner/${u.id}`}, organization:{reference:'Organization/hospital'},
    code:[{text:u.role}]}; // Describes the staff role; it does not assert a license or clinical privilege.
}
async function location(id: string, t: Transaction): Promise<ClinicalResource> {
  const [,kind,n] = id.match(/^(ward|bed)-(\d+)$/)||[];
  if (!kind) fail('Location', id);
  const [r] = await rows(`SELECT * FROM ${kind==='ward'?'hms_wards':'hms_beds'} WHERE id=:id`, {id:Number(n)}, t);
  if (!r) fail('Location', id);
  return clean({resourceType:'Location', id, status:Number(r.is_active)===1&&r.status!=='OutOfService'?'active':'inactive', mode:'instance',
    name:kind==='ward'?r.name:`Bed ${r.bed_number}`, managingOrganization:{reference:'Organization/hospital'},
    partOf:kind==='bed'?{reference:`Location/ward-${r.ward_id}`}:undefined,
    physicalType:{coding:[{system:'http://terminology.hl7.org/CodeSystem/location-physical-type', code:kind==='bed'?'bd':'wa'}]}});
}
const SERVICE_SQL = `SELECT i.*,o.patient_id,o.encounter_id,o.doctor_id,o.urgency,o.clinical_notes,o.created_at AS ordered_at,
 tv.name AS test_name,tt.code AS test_code FROM hms_investigation_order_items i
 JOIN hms_investigation_orders o ON o.id=i.order_id LEFT JOIN hms_lab_test_versions tv ON tv.id=i.lab_test_version_id
 LEFT JOIN hms_lab_tests tt ON tt.id=tv.test_id WHERE true`;
async function serviceRequest(r: Record<string, any>, t: Transaction): Promise<ClinicalResource> {
  const m = r.test_code ? await T.approvedMapping('LOCAL-LAB', r.test_code, 'LOINC', t) : null;
  const status = r.lab_state==='CANCELLED'?'revoked':r.lab_state==='RELEASED'?'completed':r.lab_state==='UNMAPPED'?'unknown':'active';
  const urgency = String(r.urgency).toLowerCase();
  return clean({resourceType:'ServiceRequest',id:String(r.id),status,intent:'order',
    code:{text:r.test_name||r.item_name,coding:m?[{system:m.system,version:m.version,code:m.code,display:m.display}]:undefined},
    subject:{reference:`Patient/${r.patient_id}`},encounter:{reference:`Encounter/opd-${r.encounter_id}`},
    authoredOn:new Date(r.ordered_at instanceof Date ? r.ordered_at : `${String(r.ordered_at).replace(' ','T')}Z`).toISOString(),
    requester:{reference:`Practitioner/${r.doctor_id}`},priority:['routine','urgent','stat','asap'].includes(urgency)?urgency:undefined,
    note:r.clinical_notes?[{text:r.clinical_notes}]:undefined});
}
async function serviceRequests(patientId: number,t: Transaction): Promise<ClinicalResource[]> {
  return Promise.all((await rows(`${SERVICE_SQL} AND o.patient_id=:p ORDER BY i.id LIMIT 500`,{p:patientId},t)).map(r=>serviceRequest(r,t)));
}
async function serviceRequestById(id: string,t: Transaction) {
  const [r]=await rows(`${SERVICE_SQL} AND i.id=:id`,{id:Number(id)||0},t);
  if(!r)fail('ServiceRequest',id);
  return {patientId:r.patient_id,resource:await serviceRequest(r,t)};
}
module.exports={medications,medicationById,practitionerRole,location,serviceRequests,serviceRequestById};
