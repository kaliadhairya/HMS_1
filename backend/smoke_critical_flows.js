const assert = require('assert');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:5001/api';

async function request(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
    method: options.method || 'GET',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let payload = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  return { status: res.status, payload };
}

async function login(username, password) {
  const { status, payload } = await request('/auth/login', {
    method: 'POST',
    body: { username, password },
  });
  assert.equal(status, 200, `login failed for ${username}`);
  assert.equal(payload.success, true, `login success false for ${username}`);
  return payload.token;
}

async function main() {
  const stamp = Date.now();
  const receptionistToken = await login('receptionist', 'Receptionist@123');
  const doctorToken = await login('doctor', 'Doctor@123');
  const pharmacistToken = await login('pharmacist', 'Pharmacist@123');
  const nurseToken = await login('nurse', 'Nurse@123');

  const accessCheck = await request('/dashboard/super-admin', { token: nurseToken });
  assert.equal(accessCheck.status, 403, 'nurse should not access super-admin dashboard');

  const patientRes = await request('/patients/hms', {
    method: 'POST',
    token: receptionistToken,
    body: {
      patientType: 'other',
      name: `Smoke Patient ${stamp}`,
      age: 33,
      gender: 'Male',
      opdIndoor: 'OPD',
      testDate: new Date().toISOString().split('T')[0],
      phoneNumber: `99999${String(stamp).slice(-5)}`,
      city: 'Metro City',
    },
  });
  assert.equal(patientRes.status, 201, 'patient registration failed');
  const patientId = patientRes.payload?.data?.id;
  assert.ok(patientId, 'patient id missing');

  const tokenQueueRes = await request('/hms/tokens', {
    method: 'POST',
    token: receptionistToken,
    body: { patient_id: patientId, doctor_id: 1, department_id: 1 },
  });
  assert.equal(tokenQueueRes.status, 201, 'token generation failed');

  const apptRes = await request('/hms/appointments', {
    method: 'POST',
    token: receptionistToken,
    body: {
      patient_id: patientId,
      doctor_id: 1,
      department_id: 1,
      appointment_date: '2026-04-08',
      status: 'Scheduled',
    },
  });
  assert.equal(apptRes.status, 201, 'appointment creation failed');
  assert.ok(apptRes.payload?.data?.slot_start, 'appointment slot was not assigned');

  const encounterRes = await request('/hms/encounters', {
    method: 'POST',
    token: doctorToken,
    body: { patient_id: patientId, encounter_type: 'OPD', department_id: 1 },
  });
  assert.equal(encounterRes.status, 201, 'encounter creation failed');
  const encounterId = encounterRes.payload.id;
  assert.ok(encounterId, 'encounter id missing');

  const prescriptionShell = await request('/hms/prescriptions', {
    method: 'POST',
    token: doctorToken,
    body: { encounter_id: encounterId, patient_id: patientId, status: 'Finalized' },
  });
  assert.equal(prescriptionShell.status, 200, 'prescription shell creation failed');
  const prescriptionId = prescriptionShell.payload.id;
  assert.ok(prescriptionId, 'prescription id missing');

  const medicineSearch = await request('/hms/medicines/search?q=par', { token: doctorToken });
  assert.equal(medicineSearch.status, 200, 'medicine search failed');
  assert.ok(Array.isArray(medicineSearch.payload) && medicineSearch.payload.length > 0, 'no medicines returned for smoke test');
  const medicine = medicineSearch.payload[0];

  const itemsRes = await request(`/hms/prescriptions/${prescriptionId}/items`, {
    method: 'PUT',
    token: doctorToken,
    body: {
      items: [{
        medicine_id: medicine.id,
        name: `${medicine.genericName} (${medicine.strength}${medicine.strengthUnit})`,
        dosage: '1 tab',
        frequency: '1-0-1',
        duration: '3 days',
        instructions: 'After food',
      }],
      status: 'Finalized',
    },
  });
  assert.equal(itemsRes.status, 200, 'prescription item save failed');
  assert.ok(Array.isArray(itemsRes.payload) && itemsRes.payload.length === 1, 'prescription item not persisted');

  const patientRx = await request(`/hms/prescriptions/patient/${patientId}`, { token: doctorToken });
  assert.equal(patientRx.status, 200, 'patient prescription history failed');
  assert.ok(Array.isArray(patientRx.payload) && patientRx.payload.some((item) => item.id === prescriptionId), 'prescription missing from patient history');

  const doctorSchedule = await request('/doctor/schedule', { token: doctorToken });
  assert.equal(doctorSchedule.status, 200, 'doctor schedule failed');

  const doctorClinicalNotes = await request('/doctor/clinical-notes', { token: doctorToken });
  assert.equal(doctorClinicalNotes.status, 200, 'doctor clinical notes failed');

  const doctorReferrals = await request('/doctor/referrals', { token: doctorToken });
  assert.equal(doctorReferrals.status, 200, 'doctor referrals failed');

  const investigationOrder = await request('/hms/investigation-orders', {
    method: 'POST',
    token: doctorToken,
    body: {
      encounter_id: encounterId,
      patient_id: patientId,
      investigation_type: 'Lab',
      priority: 'Routine',
      clinical_notes: 'Smoke lab workflow',
      items: [{ test_name: 'CBC', department: 'Pathology' }],
    },
  });
  assert.equal(investigationOrder.status, 201, 'investigation order creation failed');

  const labSamples = await request('/lab/samples', { token: doctorToken });
  assert.equal(labSamples.status, 200, 'lab sample log load failed');
  const sampleRow = (labSamples.payload?.data || []).find((item) => item.tests === 'CBC' && item.patient.includes(`Smoke Patient ${stamp}`));
  assert.ok(sampleRow, 'new investigation sample not visible in sample log');

  const sampleLog = await request('/lab/samples', {
    method: 'POST',
    token: doctorToken,
    body: { itemId: sampleRow.itemId },
  });
  assert.equal(sampleLog.status, 201, 'sample logging failed');

  const labResults = await request('/lab/results', { token: doctorToken });
  assert.equal(labResults.status, 200, 'lab results queue load failed');
  const resultRow = (labResults.payload?.data || []).find((item) => item.itemId === sampleRow.itemId);
  assert.ok(resultRow, 'logged sample not visible in pending results');

  const resultSave = await request(`/lab/results/${resultRow.id}`, {
    method: 'POST',
    token: doctorToken,
    body: { result_value: '13.2', remarks: 'Smoke result' },
  });
  assert.equal(resultSave.status, 200, 'lab result save failed');

  const labReports = await request('/lab/reports', { token: doctorToken });
  assert.equal(labReports.status, 200, 'lab reports load failed');
  assert.ok((labReports.payload?.data || []).some((item) => item.id === `REP-${sampleRow.itemId}`), 'completed lab report missing');

  const invoiceNumber = `SMOKE-GRN-${stamp}`;
  const batchNumber = `SMOKE-BATCH-${stamp}`;
  const grnRes = await request('/pharmacy/grn', {
    method: 'POST',
    token: pharmacistToken,
    body: {
      supplierId: 1,
      invoiceNumber,
      invoiceDate: '2026-04-07',
      items: [{
        medicineId: medicine.id,
        batchNumber,
        expiryDate: '2027-12-31',
        quantity: 5,
        purchaseRate: 2,
        mrp: 3,
        gstRate: 5,
      }],
    },
  });
  assert.equal(grnRes.status, 200, 'GRN failed');

  const batchRes = await request(`/pharmacy/medicines/${medicine.id}/batches`, { token: pharmacistToken });
  assert.equal(batchRes.status, 200, 'batch lookup failed');
  const batch = (batchRes.payload?.data || []).find((item) => item.batchNumber === batchNumber);
  assert.ok(batch, 'new GRN batch not visible');

  const queueBeforeDispense = await request('/pharmacy/dispense-queue', { token: pharmacistToken });
  assert.equal(queueBeforeDispense.status, 200, 'dispense queue load failed');
  assert.ok(queueBeforeDispense.payload?.data?.some((item) => (item.PRESCRIPTION_ID ?? item.prescription_id) === prescriptionId), 'prescription missing from dispense queue');

  const dispenseRes = await request('/pharmacy/dispense', {
    method: 'POST',
    token: pharmacistToken,
    body: {
      prescriptionId,
      items: [{
        medicineId: medicine.id,
        batchId: batch.id,
        quantity: 1,
        rate: 3,
        amount: 3,
        medicineName: `${medicine.genericName} (${medicine.strength}${medicine.strengthUnit})`,
      }],
    },
  });
  assert.equal(dispenseRes.status, 200, 'dispense failed');
  assert.equal(dispenseRes.payload.success, true, 'dispense success false');

  const queueAfterDispense = await request('/pharmacy/dispense-queue', { token: pharmacistToken });
  assert.equal(queueAfterDispense.status, 200, 'dispense queue reload failed');
  assert.ok(!queueAfterDispense.payload?.data?.some((item) => (item.PRESCRIPTION_ID ?? item.prescription_id) === prescriptionId), 'dispensed prescription still in queue');

  const billsRes = await request(`/billing/patient/${patientId}`, { token: receptionistToken });
  assert.equal(billsRes.status, 200, 'billing patient history failed');
  const dispenseBill = (billsRes.payload?.data || []).find((bill) => Number(bill.ENCOUNTER_ID ?? bill.encounter_id) === Number(encounterId));
  assert.ok(dispenseBill, 'billing record missing after dispense');
  assert.equal(Number(dispenseBill.TOTAL_AMOUNT ?? dispenseBill.total_amount), 3, 'dispensed amount missing from bill total');
  assert.equal(Number(dispenseBill.NET_PAYABLE ?? dispenseBill.net_payable), 3, 'dispensed amount missing from bill net payable');

  const prescriptionPdf = await request(`/pdf/prescription/${prescriptionId}`, { token: doctorToken });
  assert.equal(prescriptionPdf.status, 200, 'prescription PDF generation failed');
  assert.ok(typeof prescriptionPdf.payload === 'string' && prescriptionPdf.payload.startsWith('%PDF'), 'prescription PDF payload invalid');

  const billPdf = await request(`/pdf/bill/${dispenseBill.ID ?? dispenseBill.id}`, { token: receptionistToken });
  assert.equal(billPdf.status, 200, 'bill PDF generation failed');
  assert.ok(typeof billPdf.payload === 'string' && billPdf.payload.startsWith('%PDF'), 'bill PDF payload invalid');

  const visitorCreate = await request('/receptionist/visitor-log', {
    method: 'POST',
    token: receptionistToken,
    body: {
      patient: `Smoke Patient ${stamp}`,
      ward: 'General-A',
      bed: 'B-2',
      visitor: 'Smoke Visitor',
      relation: 'Friend',
    },
  });
  assert.equal(visitorCreate.status, 201, 'visitor create failed');
  const visitorId = visitorCreate.payload?.data?.numericId;
  assert.ok(visitorId, 'visitor numeric id missing');

  const visitorCheckout = await request(`/receptionist/visitor-log/${visitorId}/checkout`, {
    method: 'PUT',
    token: receptionistToken,
  });
  assert.equal(visitorCheckout.status, 200, 'visitor checkout failed');

  const notificationsRes = await request('/receptionist/notifications', { token: receptionistToken });
  assert.equal(notificationsRes.status, 200, 'receptionist notifications failed');

  const billingSummary = await request('/receptionist/billing-summary', { token: receptionistToken });
  assert.equal(billingSummary.status, 200, 'receptionist billing summary failed');

  console.log(JSON.stringify({
    ok: true,
    patientId,
    encounterId,
    prescriptionId,
    batchId: batch.id,
    invoiceNumber,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
