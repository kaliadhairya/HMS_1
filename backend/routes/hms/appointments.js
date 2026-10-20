const { conflictResponse } = require('../../utils/dbErrors');
const { DEFAULT_APPOINTMENT_SLOTS, addFifteenMinutes, doctorIdsFor, getBookedSlots, getNextAppointmentId, normalizeStatus, overlapsBooked, resolveAppointmentSlot, slotMinutes, reserveAppointment } = require('../../services/appointmentBooking');
const express = require('express');
const router = express.Router();
const { Op, QueryTypes } = require('sequelize');
const { Appointment, Patient, Doctor, Department, User } = require('../../models');
const { sequelize } = require('../../models/db');
const { resolveDoctorUser } = require('../../utils/doctorIdentity');
const { protect, restrictTo } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

// POST /api/hms/appointments — Book Appointment
router.post('/', protect, restrictTo('super_admin', 'admin', 'doctor', 'receptionist'), async (req, res) => {
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

    if (!patient_id || !doctor_id || !appointment_date) {
      return res.status(400).json({ success: false, message: 'patient_id, doctor_id and appointment_date are required.' });
    }
    // The booking screen used to send department 1 for every doctor; take the doctor's own
    // department when none is given.
    const { ids: doctorIds, userId: doctorUserId, departmentId: doctorDepartmentId } = await doctorIdsFor(doctor_id);
    if (!doctorUserId) {
      return res.status(400).json({ success: false, message: 'Unknown doctor.' });
    }
    const resolvedDepartmentId = department_id ? Number(department_id) : doctorDepartmentId;
    if (!resolvedDepartmentId) {
      return res.status(400).json({ success: false, message: 'department_id is required for this doctor.' });
    }

    // One booking at a time per doctor and day, so two desks cannot take the same slot.
    const booking = await sequelize.transaction((transaction) => reserveAppointment({
      patientId: Number(patient_id),
      doctorIds,
      doctorRef: doctor_id,
      doctorUserId,
      departmentId: resolvedDepartmentId,
      appointmentDate: appointment_date,
      slotStart: slot_start || appointment_time,
      slotEnd: slot_end,
      apptType: appt_type || 'walk-in',
      status: normalizeStatus(status) || 'Scheduled',
      bookedBy: Number(req.user.id),
      transaction,
    }));
    if (booking.error) {
      return res.status(409).json({ success: false, message: booking.error });
    }
    const apptId = booking.id;
    const resolvedSlot = booking.slot;
    const normalizedStatus = normalizeStatus(status) || 'Scheduled';

    await logAction(req.user.id, 'CREATE', 'appointment', apptId, null, { date: appointment_date, slot: resolvedSlot.slotStart }, req.ip);

    res.status(201).json({
      success: true,
      message: 'Appointment booked.',
      data: {
        id: apptId,
        patient_id: Number(patient_id),
        doctor_id: doctorUserId,
        department_id: resolvedDepartmentId,
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
    const conflict = conflictResponse(err, { exclusion: 'This doctor already has an appointment that overlaps this time.' });
    if (conflict) return res.status(conflict.status).json({ success: false, message: conflict.message });
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error booking appointment.' });
  }
});

// GET /api/hms/appointments — List with filters
router.get('/', protect, restrictTo('super_admin', 'admin', 'doctor', 'receptionist'), async (req, res) => {
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
      const { ids } = await doctorIdsFor(doctor_id);
      filters.push(`a.DOCTOR_ID IN (:doctorIds)`);
      replacements.doctorIds = ids.length ? ids : [Number(doctor_id)];
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
       LEFT JOIN HMS_DOCTORS d ON d.USER_ID = a.DOCTOR_ID
       LEFT JOIN HMS_USERS du ON du.ID = a.DOCTOR_ID
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
router.put('/:id', protect, restrictTo('super_admin', 'admin', 'doctor', 'receptionist'), async (req, res) => {
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
        return res.status(409).json({ success: false, message: resolvedSlot.error });
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
    const conflict = conflictResponse(err, { exclusion: 'Moving this appointment would overlap another booking for the same doctor.' });
    if (conflict) return res.status(conflict.status).json({ success: false, message: conflict.message });
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating appointment.' });
  }
});

module.exports = router;
