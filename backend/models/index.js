const { sequelize } = require('./db');
const User        = require('./User');
const Patient     = require('./Patient');
const TestReport  = require('./TestReport');
const Permission  = require('./Permission');
const AuditLog    = require('./AuditLog');

// Sprint 2 HMS Models
const Department       = require('./Department');
const Doctor           = require('./Doctor');
const Appointment      = require('./Appointment');
const Token            = require('./Token');
const Vital            = require('./Vital');
const PatientDocument  = require('./PatientDocument');
const Allergy          = require('./Allergy');
const ChronicCondition = require('./ChronicCondition');

// Sprint 3 Models
const Encounter = require('./Encounter');
const Diagnosis = require('./Diagnosis');
const Prescription = require('./Prescription');
const PrescriptionItem = require('./PrescriptionItem');
const InvestigationOrder = require('./InvestigationOrder');
const InvestigationOrderItem = require('./InvestigationOrderItem');
const Medicine = require('./Medicine');
const RestForm = require('./RestForm');

// Sprint 4 — Pharmacy Models
const Supplier         = require('./Supplier');
const MedicineBatch    = require('./MedicineBatch');
const StockLedger      = require('./StockLedger');
const PurchaseOrder    = require('./PurchaseOrder');
const PurchaseItem     = require('./PurchaseItem');
const DispensingRecord = require('./DispensingRecord');
const DispensingItem   = require('./DispensingItem');
const OtcSale          = require('./OtcSale');
const OtcItem          = require('./OtcItem');

// Part B - IPD Models
const Ward             = require('./Ward');
const Bed              = require('./Bed');
const Admission        = require('./Admission');
const ProgressNote     = require('./ProgressNote');
const NursingNote      = require('./NursingNote');
const IpdVitals        = require('./IpdVitals');
const MarRecord        = require('./MarRecord');
const IpdRequest       = require('./IpdRequest');

// Part B - Billing Models
const Bill             = require('./Bill');
const BillItem         = require('./BillItem');
const Payment          = require('./Payment');
const PatientAdvance   = require('./PatientAdvance');

// Part C - Admin Settings Models
const HospitalProfile  = require('./HospitalProfile');
const Tariff           = require('./Tariff');

// ── Associations ──────────────────────────────────────────────
Patient.belongsTo(User, {
  foreignKey: 'registeredBy',
  as: 'registeredByUser',
});

TestReport.belongsTo(Patient, {
  foreignKey: 'patientId',
  as: 'patient',
});

TestReport.belongsTo(User, {
  foreignKey: 'reportedBy',
  as: 'reportedByUser',
});

AuditLog.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user',
});

// ── Sprint 2 Associations ──────────────────────────────────────
Doctor.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasOne(Doctor, { foreignKey: 'user_id', as: 'doctorProfile' });
Doctor.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Department.hasMany(Doctor, { foreignKey: 'department_id', as: 'doctors' });
Department.belongsTo(Doctor, { foreignKey: 'head_doctor_id', as: 'head_doctor' });

Appointment.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Appointment.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });
Appointment.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Appointment.belongsTo(User, { foreignKey: 'booked_by', as: 'bookedByUser' });

Token.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Token.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });
Token.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Token.belongsTo(User, { foreignKey: 'generated_by', as: 'generatedByUser' });

Vital.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Vital.belongsTo(User, { foreignKey: 'recorded_by', as: 'recordedByUser' });

PatientDocument.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
PatientDocument.belongsTo(User, { foreignKey: 'uploaded_by', as: 'uploadedByUser' });

Allergy.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Allergy.belongsTo(User, { foreignKey: 'noted_by', as: 'notedByUser' });

ChronicCondition.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });

// ── Sprint 3 Associations ──────────────────────────────────────
Encounter.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Patient.hasMany(Encounter, { foreignKey: 'patient_id', as: 'encounters' });

Encounter.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });
Encounter.belongsTo(Department, { foreignKey: 'department_id', as: 'department' });
Encounter.belongsTo(Token, { foreignKey: 'token_id', as: 'token' });
Encounter.belongsTo(Appointment, { foreignKey: 'appointment_id', as: 'appointment' });

Diagnosis.belongsTo(Encounter, { foreignKey: 'encounter_id', as: 'encounter' });
Encounter.hasMany(Diagnosis, { foreignKey: 'encounter_id', as: 'diagnoses' });

Prescription.belongsTo(Encounter, { foreignKey: 'encounter_id', as: 'encounter' });
Encounter.hasMany(Prescription, { foreignKey: 'encounter_id', as: 'prescriptions' });
Prescription.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Prescription.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });

PrescriptionItem.belongsTo(Prescription, { foreignKey: 'prescription_id', as: 'prescription' });
Prescription.hasMany(PrescriptionItem, { foreignKey: 'prescription_id', as: 'items' });

InvestigationOrder.belongsTo(Encounter, { foreignKey: 'encounter_id', as: 'encounter' });
Encounter.hasMany(InvestigationOrder, { foreignKey: 'encounter_id', as: 'investigationOrders' });
InvestigationOrder.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
InvestigationOrder.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });

InvestigationOrderItem.belongsTo(InvestigationOrder, { foreignKey: 'order_id', as: 'order' });
InvestigationOrder.hasMany(InvestigationOrderItem, { foreignKey: 'order_id', as: 'items' });

RestForm.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Patient.hasMany(RestForm, { foreignKey: 'patient_id', as: 'restForms' });
RestForm.belongsTo(User, { foreignKey: 'doctor_id', as: 'doctor' });
RestForm.belongsTo(Encounter, { foreignKey: 'encounter_id', as: 'encounter' });

// ── Pharmacy Associations ───────────────────────────
// Note: Use camelCase attribute names for model properties.
Medicine.hasMany(MedicineBatch, { foreignKey: 'medicineId', as: 'batches' });
MedicineBatch.belongsTo(Medicine, { foreignKey: 'medicineId', as: 'medicine' });

MedicineBatch.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'supplier' });
Supplier.hasMany(MedicineBatch, { foreignKey: 'supplierId', as: 'batches' });

Medicine.hasMany(StockLedger, { foreignKey: 'medicineId', as: 'ledgerEntries' });
StockLedger.belongsTo(Medicine, { foreignKey: 'medicineId', as: 'medicine' });

MedicineBatch.hasMany(StockLedger, { foreignKey: 'batchId', as: 'ledgerEntries' });
StockLedger.belongsTo(MedicineBatch, { foreignKey: 'batchId', as: 'batch' });

StockLedger.belongsTo(User, { foreignKey: 'performedBy', as: 'performedByUser' });

PurchaseOrder.hasMany(PurchaseItem, { foreignKey: 'purchaseOrderId', as: 'items' });
PurchaseItem.belongsTo(PurchaseOrder, { foreignKey: 'purchaseOrderId', as: 'purchaseOrder' });
PurchaseOrder.belongsTo(Supplier, { foreignKey: 'supplierId', as: 'supplier' });
PurchaseItem.belongsTo(Medicine, { foreignKey: 'medicineId', as: 'medicine' });

DispensingRecord.hasMany(DispensingItem, { foreignKey: 'dispensingRecordId', as: 'items' });
DispensingItem.belongsTo(DispensingRecord, { foreignKey: 'dispensingRecordId', as: 'dispensingRecord' });
DispensingRecord.belongsTo(Patient, { foreignKey: 'patientId', as: 'patient' });
DispensingRecord.belongsTo(User, { foreignKey: 'dispensedBy', as: 'dispensedByUser' });
DispensingRecord.belongsTo(Prescription, { foreignKey: 'prescriptionId', as: 'prescription' });

OtcSale.hasMany(OtcItem, { foreignKey: 'otcSaleId', as: 'items' });
OtcItem.belongsTo(OtcSale, { foreignKey: 'otcSaleId', as: 'otcSale' });
OtcSale.belongsTo(Patient, { foreignKey: 'patientId', as: 'patient' });
OtcSale.belongsTo(User, { foreignKey: 'soldBy', as: 'soldByUser' });

// ── Part B — IPD Associations ───────────────────────────
Ward.hasMany(Bed, { foreignKey: 'wardId' });
Bed.belongsTo(Ward, { foreignKey: 'wardId' });

Patient.hasMany(Admission, { foreignKey: 'patientId' });
Admission.belongsTo(Patient, { foreignKey: 'patientId' });
Admission.belongsTo(Bed, { foreignKey: 'bedId' });

Admission.hasMany(ProgressNote, { foreignKey: 'admissionId' });
Admission.hasMany(NursingNote, { foreignKey: 'admissionId' });
Admission.hasMany(IpdVitals, { foreignKey: 'admissionId' });
Admission.hasMany(MarRecord, { foreignKey: 'admissionId' });

// Note: IPD requests route uses optimized raw SQL for queries with JOINs.

// ── Part B — Billing Associations ───────────────────────
Patient.hasMany(Bill, { foreignKey: 'patientId' });
Bill.belongsTo(Patient, { foreignKey: 'patientId' });

Bill.hasMany(BillItem, { foreignKey: 'billId' });
BillItem.belongsTo(Bill, { foreignKey: 'billId' });

Bill.hasMany(Payment, { foreignKey: 'billId' });
Payment.belongsTo(Bill, { foreignKey: 'billId' });

Patient.hasMany(PatientAdvance, { foreignKey: 'patientId' });
PatientAdvance.belongsTo(Patient, { foreignKey: 'patientId' });

module.exports = {
  sequelize, User, Patient, TestReport, Permission, AuditLog,
  Department, Doctor, Appointment, Token, Vital,
  PatientDocument, Allergy, ChronicCondition,
  Encounter, Diagnosis, Prescription, PrescriptionItem,
  InvestigationOrder, InvestigationOrderItem, Medicine, RestForm,
  // Sprint 4 Pharmacy
  Supplier, MedicineBatch, StockLedger,
  PurchaseOrder, PurchaseItem,
  DispensingRecord, DispensingItem,
  OtcSale, OtcItem,
  // Part B IPD & Billing
  Ward, Bed, Admission, ProgressNote, NursingNote, IpdVitals, MarRecord, IpdRequest,
  Bill, BillItem, Payment, PatientAdvance,
  // Part C Admin
  HospitalProfile, Tariff,
};
