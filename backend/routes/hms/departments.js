const express = require('express');
const router = express.Router();
const { Department, Doctor, User } = require('../../models');
const { protect } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

// GET /api/hms/departments
router.get('/', protect, async (req, res) => {
  try {
    const depts = await Department.findAll({
      where: { is_active: 'Y' },
      order: [['name', 'ASC']]
    });
    res.json({ success: true, data: depts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/hms/departments (Admin only conceptually, protected by middleware in real app)
router.post('/', protect, async (req, res) => {
  try {
    const { name, short_code, floor_location } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Name required.' });

    const dept = await Department.create({ name, short_code, floor_location });
    await logAction(req.user.id, 'CREATE', 'department', dept.id, null, { name }, req.ip);

    res.status(201).json({ success: true, data: dept });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/hms/departments/:id/doctors
router.get('/:id/doctors', protect, async (req, res) => {
  try {
    const doctors = await Doctor.findAll({
      where: { department_id: req.params.id, is_active: 'Y' },
      include: [{ model: User, as: 'user', attributes: ['name', 'username', 'phone'] }]
    });
    res.json({ success: true, data: doctors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
