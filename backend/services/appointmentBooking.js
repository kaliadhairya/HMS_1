// Appointment booking core shared by the legacy route and the v2 API (completion A3).
// One doctor and day are serialized by an advisory lock, the slot is resolved against
// booked times, and the row is written with the care-team link in the caller's transaction.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { ensureCareTeam } = require('../utils/careTeam');
const { resolveDoctorUser } = require('../utils/doctorIdentity');

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

// A doctor given as a user ID or profile ID, as the user ID appointments store.
async function doctorIdsFor(doctorId) {
  const doctor = await resolveDoctorUser(doctorId);
  return { ids: doctor ? [doctor.userId] : [], userId: doctor ? doctor.userId : null, departmentId: doctor ? doctor.departmentId : null };
}

// Minutes past midnight for an "HH:MM" slot time, or null when it is not one.
function slotMinutes(time) {
  if (!time) return null;
  const [hours, minutes] = String(time).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return (hours * 60) + minutes;
}

// Ranges this doctor's bookings still hold on the day. Matches the database rule
// (ex_appointments_doctor_no_overlap, migration 0013): only cancelled and no-show
// bookings release their time. A completed booking still occupied its time.
async function getBookedSlots(doctorId, appointmentDate, excludeId = null) {
  const { ids } = await doctorIdsFor(doctorId);
  const filters = [
    `DOCTOR_ID IN (:doctorIds)`,
    `trunc(APPOINTMENT_DATE) = TO_DATE(:appointmentDate, 'YYYY-MM-DD')`,
    `(STATUS IS NULL OR STATUS NOT IN ('Cancelled', 'No Show'))`
  ];
  const replacements = {
    doctorIds: ids.length ? ids : [Number(doctorId)],
    appointmentDate,
  };

  if (excludeId) {
    filters.push(`ID != :excludeId`);
    replacements.excludeId = Number(excludeId);
  }

  const rows = await sequelize.query(
    `SELECT SLOT_START, SLOT_END
       FROM HMS_APPOINTMENTS
      WHERE ${filters.join(' AND ')}`,
    {
      replacements,
      type: QueryTypes.SELECT,
    }
  );

  return rows
    .map((row) => {
      const start = slotMinutes(row.SLOT_START);
      if (start === null) return null;
      return { start, end: slotMinutes(row.SLOT_END) ?? start + 15 };
    })
    .filter(Boolean);
}

// True when [start, end) overlaps any booked range, not just an identical start time.
function overlapsBooked(bookedRanges, slotStart, slotEnd) {
  const start = slotMinutes(slotStart);
  const end = slotMinutes(slotEnd) ?? (start + 15);
  return bookedRanges.some((booked) => start < booked.end && booked.start < end);
}

async function resolveAppointmentSlot({ doctorId, appointmentDate, slotStart, slotEnd, excludeId = null }) {
  const bookedSlots = await getBookedSlots(doctorId, appointmentDate, excludeId);

  if (slotStart) {
    const requestedEnd = slotEnd || addFifteenMinutes(slotStart);
    if (overlapsBooked(bookedSlots, slotStart, requestedEnd)) {
      return { error: 'This doctor already has an appointment that overlaps this time.' };
    }
    return {
      slotStart,
      slotEnd: requestedEnd,
    };
  }

  const nextAvailable = DEFAULT_APPOINTMENT_SLOTS.find((candidate) => !overlapsBooked(bookedSlots, candidate, addFifteenMinutes(candidate)));
  if (!nextAvailable) {
    return { error: 'No appointment slots are available for the selected doctor and date.' };
  }

  return {
    slotStart: nextAvailable,
    slotEnd: addFifteenMinutes(nextAvailable),
  };
}


// Books one slot inside the caller's transaction. Returns { id, slot } or { error }.
async function reserveAppointment({ patientId, doctorIds, doctorRef, doctorUserId, departmentId, appointmentDate, slotStart, slotEnd, apptType, status, bookedBy, transaction }) {
  const lockKey = `appointment:${Math.min(...doctorIds)}:${appointmentDate}`;
  await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:lockKey))', { replacements: { lockKey }, transaction });
  const slot = await resolveAppointmentSlot({
    doctorId: doctorRef,
    appointmentDate,
    slotStart,
    slotEnd,
  });
  if (slot.error) return { error: slot.error };

  const id = await getNextAppointmentId();
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
        id,
        patientId,
        doctorId: doctorUserId,
        departmentId,
        appointmentDate,
        slotStart: slot.slotStart,
        slotEnd: slot.slotEnd,
        apptType,
        status,
        bookedBy,
      },
      type: QueryTypes.INSERT,
      transaction,
    }
  );
  await ensureCareTeam(doctorUserId, patientId, transaction);
  return { id, slot };
}

module.exports = { DEFAULT_APPOINTMENT_SLOTS, addFifteenMinutes, doctorIdsFor, getBookedSlots, getNextAppointmentId, normalizeStatus, overlapsBooked, resolveAppointmentSlot, slotMinutes, reserveAppointment };
