const express = require('express');
const router = express.Router();
const { sequelize, AuditLog } = require('../models');
const { logAction } = require('../utils/auditLogger');

const VISITOR_MODULE = 'receptionist_visitor';
const NOTIFICATION_MODULE = 'receptionist_notification';
const MAX_VISITORS = 5;

function safeParseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getVisitorEntries() {
  const logs = await AuditLog.findAll({
    where: { module: VISITOR_MODULE },
    order: [['created_at', 'DESC']],
  });

  const latestByRecord = new Map();
  for (const log of logs) {
    if (!log.record_id || latestByRecord.has(log.record_id)) continue;
    const payload = safeParseJson(log.new_value);
    if (!payload) continue;
    latestByRecord.set(log.record_id, {
      id: `VIS-${String(log.record_id).padStart(3, '0')}`,
      numericId: log.record_id,
      ...payload,
    });
  }

  return Array.from(latestByRecord.values()).sort((a, b) => {
    return new Date(`${b.date}T${b.check_in || '00:00'}`) - new Date(`${a.date}T${a.check_in || '00:00'}`);
  });
}

async function nextVisitorRecordId() {
  const [rows] = await sequelize.query(`
    SELECT COALESCE(MAX(RECORD_ID), 0) + 1 AS NEXT_ID
    FROM HMS_AUDIT_LOGS
    WHERE MODULE = :module
  `, {
    replacements: { module: VISITOR_MODULE }
  });
  return Number(rows[0]?.NEXT_ID || rows[0]?.next_id || 1);
}

async function getNotificationReadSet() {
  const logs = await AuditLog.findAll({
    where: { module: NOTIFICATION_MODULE, action: 'MARK_READ' },
    attributes: ['record_id'],
  });
  return new Set(logs.map((log) => Number(log.record_id)).filter(Boolean));
}

async function buildNotifications() {
  const readSet = await getNotificationReadSet();

  const [appointmentRows] = await sequelize.query(`
    SELECT a.ID, p.NAME AS PATIENT_NAME, u.NAME AS DOCTOR_NAME, a.APPOINTMENT_DATE
    FROM HMS_APPOINTMENTS a
    JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
    JOIN HMS_DOCTORS d ON d.ID = a.DOCTOR_ID
    JOIN HMS_USERS u ON u.ID = d.USER_ID
    WHERE trunc(a.APPOINTMENT_DATE) = trunc(CURRENT_TIMESTAMP)
      AND a.STATUS IN ('Scheduled', 'Confirmed')
    ORDER BY a.APPOINTMENT_DATE ASC
    LIMIT 10
  `);

  const [billRows] = await sequelize.query(`
    SELECT
      COALESCE(b.ID, e.ID) AS ID,
      e.ID AS ENCOUNTER_ID,
      p.NAME AS PATIENT_NAME,
      p.UHID,
      COALESCE(b.NET_PAYABLE, 0) AS AMOUNT,
      e.ENCOUNTER_DATE
    FROM HMS_ENCOUNTERS e
    JOIN HMS_PATIENTS p ON p.ID = e.PATIENT_ID
    LEFT JOIN HMS_BILLS b ON b.ENCOUNTER_ID = e.ID
    WHERE trunc(e.ENCOUNTER_DATE) = trunc(CURRENT_TIMESTAMP)
      AND e.STATUS = 'Finalized'
      AND (
        b.ID IS NULL
        OR (b.STATUS = 'Pending' AND COALESCE(b.NET_PAYABLE, 0) > 0)
      )
    ORDER BY e.ENCOUNTER_DATE DESC
    LIMIT 10
  `);

  const [ipdRows] = await sequelize.query(`
    SELECT a.ID, p.NAME AS PATIENT_NAME, b.BED_NUMBER, w.NAME AS WARD_NAME
    FROM HMS_ADMISSIONS a
    JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
    LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
    LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
    WHERE a.STATUS IN ('Discharge Pending', 'Pending Discharge')
    ORDER BY a.ADMISSION_DATE DESC
    LIMIT 10
  `);

  const notifications = [
    ...appointmentRows.map((row) => ({
      id: 1000000 + Number(row.ID),
      type: 'appointment',
      message: `Today's appointment: ${row.PATIENT_NAME} with ${row.DOCTOR_NAME}`,
      time: new Date(row.APPOINTMENT_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      read: readSet.has(1000000 + Number(row.ID)),
      priority: 'medium',
    })),
    ...billRows.map((row) => ({
      id: 2000000 + Number(row.ENCOUNTER_ID),
      type: 'bill',
      message: row.AMOUNT > 0
        ? `Pending payment: ${row.PATIENT_NAME} (${row.UHID}) for Rs. ${Number(row.AMOUNT).toFixed(0)}`
        : `Bill not generated yet for finalized encounter: ${row.PATIENT_NAME} (${row.UHID})`,
      time: new Date(row.ENCOUNTER_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      read: readSet.has(2000000 + Number(row.ENCOUNTER_ID)),
      priority: 'high',
    })),
    ...ipdRows.map((row) => ({
      id: 3000000 + Number(row.ID),
      type: 'ipd',
      message: `Discharge clearance pending for ${row.PATIENT_NAME} (${row.WARD_NAME || 'Ward'} / ${row.BED_NUMBER || 'Bed'})`,
      time: 'Pending',
      read: readSet.has(3000000 + Number(row.ID)),
      priority: 'high',
    })),
  ];

  return notifications.sort((a, b) => Number(!a.read) - Number(!b.read)).reverse();
}

router.get('/visitor-log', async (req, res) => {
  try {
    const data = await getVisitorEntries();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Visitor log fetch failed:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch visitor log.' });
  }
});

router.post('/visitor-log', async (req, res) => {
  try {
    const { patient, ward, bed, visitor, relation } = req.body;
    if (!patient || !visitor) {
      return res.status(400).json({ success: false, message: 'Patient and visitor name are required.' });
    }

    const visitors = await getVisitorEntries();
    const activeCount = visitors.filter((entry) => entry.patient === patient && entry.status === 'Active').length;
    if (activeCount >= MAX_VISITORS) {
      return res.status(400).json({ success: false, message: `Maximum visitor limit (${MAX_VISITORS}) reached for this patient.` });
    }

    const recordId = await nextVisitorRecordId();
    const now = new Date();
    const payload = {
      date: now.toISOString().split('T')[0],
      patient,
      ward: ward || '-',
      bed: bed || '-',
      visitor,
      relation: relation || '-',
      check_in: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      check_out: null,
      status: 'Active',
    };

    await logAction(req.user.id, 'CREATE', VISITOR_MODULE, recordId, null, payload, req.ip);
    res.status(201).json({
      success: true,
      data: {
        id: `VIS-${String(recordId).padStart(3, '0')}`,
        numericId: recordId,
        ...payload,
      },
      message: 'Visitor pass issued.',
    });
  } catch (error) {
    console.error('Visitor check-in failed:', error);
    res.status(500).json({ success: false, message: 'Failed to issue visitor pass.' });
  }
});

router.put('/visitor-log/:id/checkout', async (req, res) => {
  try {
    const recordId = Number(req.params.id);
    const visitors = await getVisitorEntries();
    const current = visitors.find((entry) => entry.numericId === recordId);
    if (!current) {
      return res.status(404).json({ success: false, message: 'Visitor pass not found.' });
    }
    if (current.status !== 'Active') {
      return res.status(400).json({ success: false, message: 'Visitor is already checked out.' });
    }

    const updated = {
      ...current,
      check_out: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      status: 'Checked Out',
    };

    await logAction(req.user.id, 'UPDATE', VISITOR_MODULE, recordId, current, updated, req.ip);
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Visitor checkout failed:', error);
    res.status(500).json({ success: false, message: 'Failed to check out visitor.' });
  }
});

router.get('/notifications', async (req, res) => {
  try {
    const data = await buildNotifications();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Receptionist notifications failed:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch notifications.' });
  }
});

router.put('/notifications/:id/read', async (req, res) => {
  try {
    const recordId = Number(req.params.id);
    if (!recordId) {
      return res.status(400).json({ success: false, message: 'Invalid notification id.' });
    }

    await logAction(req.user.id, 'MARK_READ', NOTIFICATION_MODULE, recordId, null, { read: true }, req.ip);
    res.json({ success: true });
  } catch (error) {
    console.error('Notification read failed:', error);
    res.status(500).json({ success: false, message: 'Failed to update notification.' });
  }
});

router.get('/billing-summary', async (req, res) => {
  try {
    const [unpaidToday] = await sequelize.query(`
      SELECT
        e.ID AS ENCOUNTER_ID,
        p.UHID AS UHID,
        p.NAME AS PATIENT,
        u.NAME AS DOCTOR,
        COALESCE(d.NAME, e.ENCOUNTER_TYPE) AS DEPARTMENT,
        COALESCE(b.NET_PAYABLE, 0) AS AMOUNT,
        e.ENCOUNTER_DATE AS ENCOUNTER_DATE
      FROM HMS_ENCOUNTERS e
      JOIN HMS_PATIENTS p ON p.ID = e.PATIENT_ID
      JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
      LEFT JOIN HMS_DEPARTMENTS d ON d.ID = e.DEPARTMENT_ID
      LEFT JOIN HMS_BILLS b ON b.ENCOUNTER_ID = e.ID
      WHERE trunc(e.ENCOUNTER_DATE) = trunc(CURRENT_TIMESTAMP)
        AND e.STATUS = 'Finalized'
        AND (
          b.ID IS NULL
          OR (b.STATUS = 'Pending' AND COALESCE(b.NET_PAYABLE, 0) > 0)
        )
      ORDER BY e.ENCOUNTER_DATE DESC
    `);

    const [recentPayments] = await sequelize.query(`
      SELECT
        pm.RECEIPT_NUMBER AS RECEIPT_NO,
        p.UHID AS UHID,
        p.NAME AS PATIENT,
        pm.AMOUNT AS AMOUNT,
        pm.PAYMENT_MODE AS METHOD,
        pm.PAYMENT_DATE AS PAYMENT_DATE
      FROM HMS_PAYMENTS pm
      JOIN HMS_PATIENTS p ON p.ID = pm.PATIENT_ID
      WHERE trunc(pm.PAYMENT_DATE) >= trunc(CURRENT_TIMESTAMP) - 2
      ORDER BY pm.PAYMENT_DATE DESC
      LIMIT 20
    `);

    const [collectionRows] = await sequelize.query(`
      SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL
      FROM HMS_PAYMENTS
      WHERE trunc(PAYMENT_DATE) = trunc(CURRENT_TIMESTAMP)
    `);

    const [pendingRows] = await sequelize.query(`
      SELECT COALESCE(SUM(NET_PAYABLE), 0) AS TOTAL
      FROM HMS_BILLS
      WHERE STATUS = 'Pending'
    `);

    res.json({
      success: true,
      data: {
        unpaid_today: unpaidToday.map((row) => ({
          encounter_id: row.ENCOUNTER_ID,
          uhid: row.UHID,
          patient: row.PATIENT,
          doctor: row.DOCTOR,
          department: row.DEPARTMENT,
          amount: Number(row.AMOUNT || 0),
          date: row.ENCOUNTER_DATE,
        })),
        recent_payments: recentPayments.map((row) => ({
          receipt_no: row.RECEIPT_NO,
          uhid: row.UHID,
          patient: row.PATIENT,
          amount: Number(row.AMOUNT || 0),
          method: row.METHOD,
          date: new Date(row.PAYMENT_DATE).toLocaleDateString('en-IN'),
          time: new Date(row.PAYMENT_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        })),
        todays_collection: Number(collectionRows[0]?.TOTAL || 0),
        pending_total: Number(pendingRows[0]?.TOTAL || 0),
      }
    });
  } catch (error) {
    console.error('Receptionist billing summary failed:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch billing summary.' });
  }
});

router.get('/ipd-admissions', async (req, res) => {
  try {
    const [admissions] = await sequelize.query(`
      SELECT
        a.ID,
        a.PATIENT_ID,
        p.NAME AS PATIENT,
        p.UHID,
        w.NAME AS WARD,
        b.BED_NUMBER AS BED,
        u.NAME AS DOCTOR,
        a.ADMISSION_DATE,
        CASE
          WHEN a.STATUS = 'Active' AND a.DISCHARGE_DATE IS NULL THEN 'Admitted'
          WHEN a.STATUS IN ('Discharge Pending', 'Pending Discharge') THEN 'Discharge Pending'
          ELSE a.STATUS
        END AS STATUS,
        COALESCE(adv.ADVANCE_PAID, 0) AS ADVANCE_PAID
      FROM HMS_ADMISSIONS a
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = a.ADMITTING_DOCTOR_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      LEFT JOIN (
        SELECT ADMISSION_ID, SUM(AMOUNT) AS ADVANCE_PAID
        FROM HMS_PATIENT_ADVANCES
        WHERE COALESCE(IS_REFUNDED, 0) = 0
        GROUP BY ADMISSION_ID
      ) adv ON adv.ADMISSION_ID = a.ID
      WHERE a.STATUS IN ('Active', 'Discharge Pending', 'Pending Discharge')
      ORDER BY a.ADMISSION_DATE DESC
    `);

    const [beds] = await sequelize.query(`
      SELECT
        w.NAME AS WARD,
        COUNT(b.ID) AS TOTAL,
        SUM(CASE WHEN b.STATUS = 'Occupied' THEN 1 ELSE 0 END) AS OCCUPIED,
        SUM(CASE WHEN b.STATUS = 'Available' THEN 1 ELSE 0 END) AS AVAILABLE
      FROM HMS_WARDS w
      LEFT JOIN HMS_BEDS b ON b.WARD_ID = w.ID AND COALESCE(b.IS_ACTIVE, 1) = 1
      GROUP BY w.NAME
      ORDER BY w.NAME
    `);

    res.json({
      success: true,
      data: {
        admissions: admissions.map((row) => ({
          id: row.ID,
          patient_id: row.PATIENT_ID,
          patient: row.PATIENT,
          uhid: row.UHID,
          ward: row.WARD || '-',
          bed: row.BED || '-',
          doctor: row.DOCTOR || '-',
          admission_date: row.ADMISSION_DATE,
          status: row.STATUS,
          advance_paid: Number(row.ADVANCE_PAID || 0),
        })),
        beds: beds.map((row) => ({
          ward: row.WARD,
          total: Number(row.TOTAL || 0),
          occupied: Number(row.OCCUPIED || 0),
          available: Number(row.AVAILABLE || 0),
        })),
      }
    });
  } catch (error) {
    console.error('Receptionist IPD summary failed:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch IPD admission data.' });
  }
});

module.exports = router;
