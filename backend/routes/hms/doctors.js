const express = require('express');
const router = express.Router();
const { Doctor, Department, User } = require('../../models');
const { protect } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

// GET /api/hms/doctors
router.get('/', protect, async (req, res) => {
  try {
    const users = await User.findAll({
      where: { role: 'doctor', isActive: 1 }
    });
    
    // Map raw users into the expected shape for the frontend dropdown
    const doctors = users.map(u => ({
      id: u.id,
      user_id: u.id,
      speciality: 'General',
      user: {
        name: u.name,
        phone: u.phone
      }
    }));
    
    res.json({ success: true, data: doctors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/hms/doctors
router.post('/', protect, async (req, res) => {
  try {
    const { user_id, department_id, speciality, registration_number, fee, slot_duration_mins } = req.body;
    if (!user_id) return res.status(400).json({ success: false, message: 'user_id required.' });

    const doctor = await Doctor.create({
      user_id, department_id, speciality, registration_number, fee, slot_duration_mins
    });

    await logAction(req.user.id, 'CREATE', 'doctor', doctor.id, null, { user_id, department_id }, req.ip);

    res.status(201).json({ success: true, data: doctor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/hms/doctors/:id
router.get('/:id', protect, async (req, res) => {
  try {
    const doctor = await Doctor.findByPk(req.params.id, {
      include: [
        { model: User, as: 'user', attributes: ['name', 'email', 'phone'] },
        { model: Department, as: 'department', attributes: ['name'] }
      ]
    });
    if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found.' });
    
    res.json({ success: true, data: doctor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
