// Historical compatibility fixture, never an application authoring path.
const {sql,requireThrowawayDb}=require('./helpers');
async function historicalPrescription({patientId,encounterId,doctorId,items=[]}){
 requireThrowawayDb();
 const [rx]=await sql("INSERT INTO hms_prescriptions(patient_id,encounter_id,doctor_id,status,type) VALUES($1,$2,$3,'Draft','OPD') RETURNING id",[patientId,encounterId,doctorId]);
 for(const line of items)await sql(`INSERT INTO hms_prescription_items(prescription_id,medicine_name,generic_name,dose,dose_unit,frequency,duration_days,instructions)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[rx.id,line.medicine_name,line.generic_name??line.medicine_name,line.dose??null,line.dose_unit??null,line.frequency??null,line.duration_days??null,line.instructions??null]);
 return rx;
}
module.exports={historicalPrescription};
