// Discharge of an inpatient admission (completion A3): the one command behind the legacy
// route and the v2 API. It needs a clinically ready plan, a named owner for pending results,
// and the doctor's signed discharge document, and it closes the admission, its occupancy and
// its bed in the caller's transaction. Refusals are thrown with an HTTP status.
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { publish } = require('../utils/outbox');
const { closeOccupancy } = require('../utils/adt');
const { text, refusal, nextId, findAdmission } = require('./admissionRows');

async function discharge({ admissionId, body, user, transaction: t }) {
  const { courseInHospital, conditionAtDischarge, adviceOnDischarge,
          chiefComplaint, comorbidities, allergies, historyOfIllness,
          investigations, dischargeMedications, dietLifestyle, warningSigns,
          followUpAppointments } = body;
    const admission = await findAdmission(admissionId, t, true);
  if (!admission) throw refusal(404, 'Admission record not found');
  if (String(admission.FACILITY_ID).toLowerCase() !== String(user.facilityId).toLowerCase()) throw refusal(404, 'Admission record not found');
  if (admission.STATUS !== 'Active') throw refusal(409, `This admission is already ${String(admission.STATUS).toLowerCase()}.`);
  const Documents = require('./clinicalDocuments.cts');
  const planRows = await sequelize.query('SELECT clinical_ready_at,pending_results,results_owner_user_id FROM hms_discharge_plans WHERE admission_id=:admissionId AND facility_id=:facility FOR SHARE',
    { replacements: { admissionId: admission.ID,facility:user.facilityId }, type: QueryTypes.SELECT, transaction: t });
  const plan = planRows[0];
  if (!plan || !plan.clinical_ready_at) throw refusal(409, 'A clinically ready discharge plan is required.');
  if (plan.pending_results && !plan.results_owner_user_id) throw refusal(409, 'Pending results need a named owner before discharge.');

  // The doctor confirms and signs the exact structured document in the same
  // transaction that closes the admission and occupancy. No unsigned legacy
  // summary can authorize a discharge.
  const content = {
    diagnosis: text(body.finalDiagnosis),course: text(courseInHospital),condition: text(conditionAtDischarge),
    instructions: text(adviceOnDischarge),medicationPlan: text(dischargeMedications),warningSigns: text(warningSigns),
    followUp: text(followUpAppointments),pendingResults: plan.pending_results || '',
    chiefComplaint: text(chiefComplaint),comorbidities: text(comorbidities),allergies: text(allergies),
    historyOfIllness: text(historyOfIllness),investigations: text(investigations),dietLifestyle: text(dietLifestyle),
  };
  const doc = await Documents.create({patientId:Number(admission.PATIENT_ID),admissionId:Number(admission.ID),docType:'discharge_summary',content},user,t);
  const signed = await Documents.change(Number(doc.id),user,'sign',{},'1',t);
  const signedRow = await Documents.read(Number(doc.id),user,t);
  // The shared observations of this admission that were current when the doctor signed (a set
  // replaced by a correction is not current) are linked to the signed document (A5).
  await sequelize.query(`INSERT INTO hms_observation_links (observation_set_id, clinical_document_id, facility_id, linked_by)
    SELECT s.id, :documentId, s.facility_id, :user FROM hms_observation_sets s
    WHERE s.admission_id = :admissionId AND s.facility_id = :facility
      AND NOT EXISTS (SELECT 1 FROM hms_observation_sets c WHERE c.correction_of = s.id)`,
  { replacements: { documentId: Number(doc.id), user: user.id, admissionId: admission.ID, facility: user.facilityId }, transaction: t });
  if (String(signedRow.draft_content?.pendingResults || '').trim() && !plan.results_owner_user_id)
    throw refusal(409, 'Pending results need a named owner before discharge.');

  const [[updated]] = await sequelize.query(`
    UPDATE HMS_ADMISSIONS SET DISCHARGE_DATE = CURRENT_TIMESTAMP, STATUS = 'Discharged'
    WHERE ID = :admissionId
    RETURNING DISCHARGE_DATE AS "DISCHARGE_DATE"
  `, { replacements: { admissionId: admission.ID }, transaction: t });
  // The bed goes to cleaning, not straight back to Ready (blueprint 4.1).
  await closeOccupancy(sequelize, { admissionId: admission.ID, reason: 'discharged', transaction: t });
  if (admission.BED_ID) {
    await sequelize.query("UPDATE HMS_BEDS SET STATUS = 'Dirty' WHERE ID = :bedId", { replacements: { bedId: admission.BED_ID }, transaction: t });
  }

  const summaryId = await nextId('hms_discharge_seq', 'HMS_DISCHARGE_SUMMARIES', t);
  await sequelize.query(`
    INSERT INTO HMS_DISCHARGE_SUMMARIES (
      ID, ADMISSION_ID, FINAL_DIAGNOSIS, COURSE_IN_HOSPITAL,
      DISCHARGE_CONDITION, ADVICE_ON_DISCHARGE,
      CHIEF_COMPLAINT, COMORBIDITIES, ALLERGIES, HISTORY_OF_ILLNESS,
      INVESTIGATIONS, DISCHARGE_MEDICATIONS, DIET_LIFESTYLE,
      WARNING_SIGNS, FOLLOW_UP_APPOINTMENTS,
      CREATED_BY, CREATED_AT, CLINICAL_DOCUMENT_ID, FACILITY_ID
    ) VALUES (
      :id, :admId, :fd, :cih, :dc, :aod,
      :cc, :como, :allg, :hoi,
      :inv, :dm, :dl,
      :ws, :fua,
      :createdBy, CURRENT_TIMESTAMP, :documentId, :facility
    )
  `, {
    replacements: {
      id: summaryId,
      admId: admission.ID,
      fd: content.diagnosis,
      cih: content.course || null,
      dc: content.condition || null,
      aod: content.instructions || null,
      cc: content.chiefComplaint || null,
      como: content.comorbidities || null,
      allg: content.allergies || null,
      hoi: content.historyOfIllness || null,
      inv: content.investigations || null,
      dm: content.medicationPlan || null,
      dl: content.dietLifestyle || null,
      ws: content.warningSigns || null,
      fua: content.followUp || null,
      createdBy: user.id,
      documentId: doc.id,facility:user.facilityId,
    },
    transaction: t,
  });

  await publish('adt.admission.discharged',`facility:${user.facilityId}`,{
    admission_id:Number(admission.ID),patient_id:Number(admission.PATIENT_ID),summary_id:summaryId,
    signed_document_id:doc.public_id,signed_version:signed.row.signed_version,
  },{transaction:t});


  return {
    admissionId: admission.ID,
    summaryId,
    clinicalDocumentId: doc.public_id,
    signatureDigest: signed.digest,
    dischargeDate: updated?.DISCHARGE_DATE || new Date(),
  };
}

module.exports = { discharge };
