// Stable document section names. Existing signed content retains these legacy
// keys; public presentation uses explicit aliases without re-signing history.
const encounterFields=['chief_complaint','hopi','past_medical_history','surgical_history','family_history','social_history','current_medications','general_examination','cvs_findings','rs_findings','abdomen_findings','cns_findings'] as const;
const fields={
 clinical_note:['chiefComplaint','history','examination','assessment','plan'],
 discharge_summary:['diagnosis','course','condition','instructions','medicationPlan','warningSigns','followUp','pendingResults'],
 nursing_assessment:['assessment','observations','risks','actions','escalation'],
 care_plan:['assessment','goals','actions','review','handover'],encounter_note:encounterFields,
} as const;
const publicSectionKeys={chief_complaint:'chiefComplaint',medication_plan:'medicationPlan',warning_signs:'warningSigns',follow_up:'followUp',pending_results:'pendingResults'} as const;
module.exports={encounterFields,fields,publicSectionKeys};
