const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');

// Every DOCTOR_ID in appointments, tokens, encounters, prescriptions, orders and
// admissions holds the doctor's user ID (migration 0003 converted older rows
// that held the HMS_DOCTORS profile ID, and a foreign key now enforces it).
// Clients may still send a profile ID, so resolve either to the user ID.
// Returns null when the value is not a doctor.
async function resolveDoctorUser(doctorId, transaction) {
  const id = Number(doctorId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const rows = await sequelize.query(
    `SELECT u.ID AS USER_ID, d.DEPARTMENT_ID
       FROM HMS_USERS u LEFT JOIN HMS_DOCTORS d ON d.USER_ID = u.ID
      WHERE u.ID = :id AND u.ROLE = 'doctor'
     UNION ALL
     SELECT d.USER_ID, d.DEPARTMENT_ID
       FROM HMS_DOCTORS d
      WHERE d.ID = :id
        AND NOT EXISTS (SELECT 1 FROM HMS_USERS u WHERE u.ID = :id AND u.ROLE = 'doctor')
     LIMIT 1`,
    { replacements: { id }, type: QueryTypes.SELECT, transaction }
  );
  const row = rows[0];
  if (!row) return null;
  return { userId: Number(row.USER_ID), departmentId: row.DEPARTMENT_ID ? Number(row.DEPARTMENT_ID) : null };
}

module.exports = { resolveDoctorUser };
