const express = require('express');
const router = express.Router();
const { Op, QueryTypes } = require('sequelize');
const { Appointment, Patient, Doctor, Department, User } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

const DEFAULT_APPOINTMENT_SLOTS = [
  '09:00', '09:15', '09:30', '09:45',
  '10:00', '10:15', '10:30', '10:45',
  '11:00', '11:15', '11:30', '11:45',
  '12:00', '12:15', '12:30', '12:45',
  '14:00', '14:15', '14:30', '14:45',
  '15:00', '15:15', '15:30', '15:45'
];

async function getNextAppointmentId() {
  try {
    const [row] = await sequelize.query(
      `SELECT nextval('hms_appt_seq') AS "NEXTVAL"`,
      { type: QueryTypes.SELECT }
    );
    return row.NEXTVAL || row.nextval;
  } catch {
    const [row] = await sequelize.query(
      `SELECT COALESCE(MAX(ID), 0) + 1 AS "NEXTVAL" FROM HMS_APPOINTMENTS`,
      { type: QueryTypes.SELECT }
    );
    return row.NEXTVAL || row.nextval;
  }
}

function addFifteenMinutes(slotStart) {
  if (!slotStart) return null;
  const [hours, minutes] = String(slotStart).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const endTotalMins = (hours * 60) + minutes + 15;
  const endHours = String(Math.floor(endTotalMins / 60)).padStart(2, '0');
  const endMinutes = String(endTotalMins % 60).padStart(2, '0');
  return `${endHours}:${endMinutes}`;
}

function normalizeStatus(status) {
  if (!status) return null;
  const compact = String(status).trim().toLowerCase().replace(/[\s_-]+/g, '');
  switch (compact) {
    case 'scheduled':
      return 'Scheduled';
    case 'checkedin':
      return 'Checked-in';
    case 'completed':
      return 'Completed';
    case 'cancelled':
    case 'canceled':
      return 'Cancelled';
    case 'noshow':
      return 'No Show';
    default:
      return String(status).trim();
  }
}

async function getBookedSlots(doctorId, appointmentDate, excludeId = null) {
  const filters = [
    `DOCTOR_ID = :doctorId`,
    `trunc(APPOINTMENT_DATE) = TO_DATE(:appointmentDate, 'YYYY-MM-DD')`,
    `STATUS NOT IN ('Cancelled', 'Completed', 'No Show')`
  ];
  const replacements = {
    doctorId: Number(doctorId),
    appointmentDate,
  };

  if (excludeId) {
    filters.push(`ID != :excludeId`);
    replacements.excludeId = Number(excludeId);
  }

  const rows = await sequelize.query(
    `SELECT SLOT_START
       FROM HMS_APPOINTMENTS
      WHERE ${filters.join(' AND ')}`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((row) => row.SLOT_START).filter(Boolean);
}

async function resolveAppointmentSlot({ doctorId, appointmentDate, slotStart, slotEnd, excludeId = null }) {
  const bookedSlots = await getBookedSlots(doctorId, appointmentDate, excludeId);

  if (slotStart) {
    if (bookedSlots.includes(slotStart)) {
      return { error: 'This slot is already booked.' };
    }
    return {
      slotStart,
      slotEnd: slotEnd || addFifteenMinutes(slotStart),
    };
  }

  const nextAvailable = DEFAULT_APPOINTMENT_SLOTS.find((candidate) => !bookedSlots.includes(candidate));
  if (!nextAvailable) {
    return { error: 'No appointment slots are available for the selected doctor and date.' };
  }

  return {
    slotStart: nextAvailable,
    slotEnd: addFifteenMinutes(nextAvailable),
  };
}

// POST /api/hms/appointments — Book Appointment
router.post('/', protect, async (req, res) => {
  try {
    const {
      patient_id,
      doctor_id,
      department_id,
      appointment_date,
      slot_start,
      slot_end,
      appointment_time,
      appt_type,
      status,
    } = req.body;

    if (!patient_id || !doctor_id || !department_id || !appointment_date) {
      return res.status(400).json({ success: false, message: 'patient_id, doctor_id, department_id, and appointment_date are required.' });
    }

    const resolvedSlot = await resolveAppointmentSlot({
      doctorId: doctor_id,
      appointmentDate: appointment_date,
      slotStart: slot_start || appointment_time,
      slotEnd: slot_end,
    });
    if (resolvedSlot.error) {
      return res.status(400).json({ success: false, message: resolvedSlot.error });
    }

    const apptId = await getNextAppointmentId();
    const normalizedStatus = normalizeStatus(status) || 'Scheduled';
    await sequelize.query(
      `INSERT INTO HMS_APPOINTMENTS (
         ID, PATIENT_ID, DOCTOR_ID, DEPARTMENT_ID, APPOINTMENT_DATE,
         SLOT_START, SLOT_END, APPT_TYPE, STATUS, BOOKED_BY, CREATED_AT
       ) VALUES (
         :id, :patientId, :doctorId, :departmentId, TO_DATE(:appointmentDate, 'YYYY-MM-DD'),
         :slotStart, :slotEnd, :apptType, :status, :bookedBy, CURRENT_TIMESTAMP
       )`,
      {
        replacements: {
          id: apptId,
          patientId: Number(patient_id),
          doctorId: Number(doctor_id),
          departmentId: Number(department_id),
          appointmentDate: appointment_date,
          slotStart: resolvedSlot.slotStart,
          slotEnd: resolvedSlot.slotEnd,
          apptType: appt_type || 'walk-in',
          status: normalizedStatus,
          bookedBy: Number(req.user.id),
        },
        type: QueryTypes.INSERT,
      }
    );

    await logAction(req.user.id, 'CREATE', 'appointment', apptId, null, { date: appointment_date, slot: resolvedSlot.slotStart }, req.ip);

    res.status(201).json({
      success: true,
      message: 'Appointment booked.',
      data: {
        id: apptId,
        patient_id: Number(patient_id),
        doctor_id: Number(doctor_id),
        department_id: Number(department_id),
        appointment_date,
        slot_start: resolvedSlot.slotStart,
        slot_end: resolvedSlot.slotEnd,
        appointment_time: resolvedSlot.slotStart,
        appt_type: appt_type || 'walk-in',
        status: normalizedStatus,
        booked_by: Number(req.user.id),
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error booking appointment.' });
  }
});

// GET /api/hms/appointments — List with filters
router.get('/', protect, async (req, res) => {
  try {
    const { date, department_id, doctor_id, patient_id, status } = req.query;
    const filters = [];
    const replacements = {};

    if (date) {
      filters.push(`trunc(a.APPOINTMENT_DATE) = TO_DATE(:date, 'YYYY-MM-DD')`);
      replacements.date = date;
    }
    if (department_id) {
      filters.push(`a.DEPARTMENT_ID = :departmentId`);
      replacements.departmentId = department_id;
    }
    if (doctor_id) {
      filters.push(`a.DOCTOR_ID = :doctorId`);
      replacements.doctorId = doctor_id;
    }
    if (patient_id) {
      filters.push(`a.PATIENT_ID = :patientId`);
      replacements.patientId = patient_id;
    }
    if (status) {
      filters.push(`a.STATUS = :status`);
      replacements.status = status;
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const appts = await sequelize.query(
      `SELECT
         a.ID,
         TO_CHAR(a.APPOINTMENT_DATE, 'YYYY-MM-DD') AS APPOINTMENT_DATE,
         a.SLOT_START,
         a.SLOT_END,
         a.APPT_TYPE,
         a.STATUS,
         a.CANCELLATION_REASON,
         a.BOOKED_BY,
         p.ID AS PATIENT_ID_REF,
         p.UHID AS PATIENT_UHID,
         p.NAME AS PATIENT_NAME,
         p.FIRST_NAME AS PATIENT_FIRST_NAME,
         p.LAST_NAME AS PATIENT_LAST_NAME,
         p.PHONENUMBER AS PATIENT_PHONE,
         d.ID AS DOCTOR_ID_REF,
         d.SPECIALITY AS DOCTOR_SPECIALITY,
         du.NAME AS DOCTOR_NAME,
         dept.ID AS DEPARTMENT_ID_REF,
         dept.NAME AS DEPARTMENT_NAME
       FROM HMS_APPOINTMENTS a
       LEFT JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
       LEFT JOIN HMS_DOCTORS d ON d.ID = a.DOCTOR_ID
       LEFT JOIN HMS_USERS du ON du.ID = d.USER_ID
       LEFT JOIN HMS_DEPARTMENTS dept ON dept.ID = a.DEPARTMENT_ID
       ${whereClause}
       ORDER BY a.APPOINTMENT_DATE DESC, a.SLOT_START ASC`,
      {
        replacements,
        type: QueryTypes.SELECT,
      }
    );

    res.json({
      success: true,
      data: appts.map((row) => ({
        id: row.ID,
        appointment_date: row.APPOINTMENT_DATE,
        slot_start: row.SLOT_START,
        slot_end: row.SLOT_END,
        appointment_time: row.SLOT_START,
        appt_type: row.APPT_TYPE,
        status: row.STATUS,
        cancellation_reason: row.CANCELLATION_REASON,
        booked_by: row.BOOKED_BY,
        patient: {
          id: row.PATIENT_ID_REF,
          uhid: row.PATIENT_UHID,
          name: row.PATIENT_NAME,
          first_name: row.PATIENT_FIRST_NAME,
          last_name: row.PATIENT_LAST_NAME,
          phoneNumber: row.PATIENT_PHONE,
        },
        doctor: {
          id: row.DOCTOR_ID_REF,
          speciality: row.DOCTOR_SPECIALITY,
          name: row.DOCTOR_NAME,
          user: { name: row.DOCTOR_NAME },
        },
        department: {
          id: row.DEPARTMENT_ID_REF,
          name: row.DEPARTMENT_NAME,
        },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error retrieving appointments.' });
  }
});

// PUT /api/hms/appointments/:id — Update/Reschedule
router.put('/:id', protect, async (req, res) => {
  try {
    const { appointment_date, slot_start, slot_end, appointment_time, status, cancellation_reason } = req.body;
    const [existingAppointment] = await sequelize.query(
      `SELECT
         ID,
         PATIENT_ID,
         DOCTOR_ID,
         DEPARTMENT_ID,
         TO_CHAR(APPOINTMENT_DATE, 'YYYY-MM-DD') AS APPOINTMENT_DATE,
         SLOT_START,
         SLOT_END,
         APPT_TYPE,
         STATUS,
         CANCELLATION_REASON,
         BOOKED_BY
       FROM HMS_APPOINTMENTS
      WHERE ID = :id`,
      {
        replacements: { id: Number(req.params.id) },
        type: QueryTypes.SELECT,
      }
    );

    if (!existingAppointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    const nextDate = appointment_date || existingAppointment.APPOINTMENT_DATE;
    const requestedSlot = slot_start || appointment_time || existingAppointment.SLOT_START;
    const shouldRecheckSlot = nextDate !== existingAppointment.APPOINTMENT_DATE || requestedSlot !== existingAppointment.SLOT_START;
    let nextSlotStart = requestedSlot;
    let nextSlotEnd = slot_end || existingAppointment.SLOT_END;

    if (shouldRecheckSlot) {
      const resolvedSlot = await resolveAppointmentSlot({
        doctorId: existingAppointment.DOCTOR_ID,
        appointmentDate: nextDate,
        slotStart: requestedSlot,
        slotEnd: slot_end,
        excludeId: req.params.id,
      });
      if (resolvedSlot.error) {
        return res.status(400).json({ success: false, message: resolvedSlot.error });
      }
      nextSlotStart = resolvedSlot.slotStart;
      nextSlotEnd = resolvedSlot.slotEnd;
    } else if (!nextSlotEnd) {
      nextSlotEnd = addFifteenMinutes(nextSlotStart);
    }

    const nextStatus = normalizeStatus(status) || existingAppointment.STATUS;
    await sequelize.query(
      `UPDATE HMS_APPOINTMENTS
          SET APPOINTMENT_DATE = TO_DATE(:appointmentDate, 'YYYY-MM-DD'),
              SLOT_START = :slotStart,
              SLOT_END = :slotEnd,
              STATUS = :status,
              CANCELLATION_REASON = :cancellationReason
        WHERE ID = :id`,
      {
        replacements: {
          id: Number(req.params.id),
          appointmentDate: nextDate,
          slotStart: nextSlotStart,
          slotEnd: nextSlotEnd,
          status: nextStatus,
          cancellationReason: cancellation_reason || existingAppointment.CANCELLATION_REASON || null,
        },
        type: QueryTypes.UPDATE,
      }
    );

    await logAction(
      req.user.id,
      'UPDATE',
      'appointment',
      Number(req.params.id),
      { date: existingAppointment.APPOINTMENT_DATE, slot: existingAppointment.SLOT_START, status: existingAppointment.STATUS },
      { date: nextDate, slot: nextSlotStart, status: nextStatus },
      req.ip
    );

    res.json({
      success: true,
      message: 'Appointment updated.',
      data: {
        id: Number(req.params.id),
        patient_id: existingAppointment.PATIENT_ID,
        doctor_id: existingAppointment.DOCTOR_ID,
        department_id: existingAppointment.DEPARTMENT_ID,
        appointment_date: nextDate,
        slot_start: nextSlotStart,
        slot_end: nextSlotEnd,
        appointment_time: nextSlotStart,
        appt_type: existingAppointment.APPT_TYPE,
        status: nextStatus,
        cancellation_reason: cancellation_reason || existingAppointment.CANCELLATION_REASON || null,
        booked_by: existingAppointment.BOOKED_BY,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating appointment.' });
  }
});

module.exports = router;
