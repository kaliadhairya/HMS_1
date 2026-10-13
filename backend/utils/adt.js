const { QueryTypes } = require('sequelize');

// Bed lifecycle and occupancy (migration 0017). Transitions a clinician or
// nurse can make on a bed; occupancy is changed only by admission, transfer
// and discharge.
const BED_TRANSITIONS = {
  Dirty: ['Cleaning', 'OutOfService'],
  Cleaning: ['Available', 'Dirty'],
  Available: ['OutOfService'],
  OutOfService: ['Available', 'Dirty'],
};

// Occupies a bed for an admission from `now`. Runs in the caller's transaction.
async function openOccupancy(sequelize, { bedId, admissionId, userId, reason, transaction }) {
  await sequelize.query(
    `INSERT INTO hms_bed_occupancies (bed_id, admission_id, starts_at, reason, created_by)
     VALUES (:bedId, :admissionId, now(), :reason, :userId)`,
    { replacements: { bedId, admissionId, reason: reason || null, userId }, transaction }
  );
}

// Ends the admission's open occupancy at `now`. Returns the bed it was in.
async function closeOccupancy(sequelize, { admissionId, reason, transaction }) {
  const [row] = await sequelize.query(
    `UPDATE hms_bed_occupancies SET ends_at = now(), reason = COALESCE(reason, '') || CASE WHEN :reason IS NULL THEN '' ELSE ' | ' || :reason END
      WHERE admission_id = :admissionId AND ends_at IS NULL RETURNING bed_id`,
    { replacements: { admissionId, reason: reason || null }, type: QueryTypes.SELECT, transaction }
  );
  return row ? Number(row.bed_id ?? row.BED_ID) : null;
}

function canMoveBed(from, to) {
  return (BED_TRANSITIONS[from] || []).includes(to);
}

module.exports = { BED_TRANSITIONS, canMoveBed, openOccupancy, closeOccupancy };
