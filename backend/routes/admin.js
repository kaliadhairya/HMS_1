const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { sequelize, HospitalProfile, Tariff, AuditLog, User } = require('../models');
const { protect, checkPermission } = require('../middleware/auth');
const logAction = require('../utils/auditLogger');

// ── Multer config for logo upload ────────────────────────────
const uploadDir = path.join(__dirname, '..', 'uploads', 'logo');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `hospital-logo-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files (png, jpg, gif, svg) are allowed'));
  },
});

// ═══════════════════════════════════════════════════════════════
//  HOSPITAL PROFILE
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/hospital-profile  (No auth — needed for PDF letterheads)
router.get('/hospital-profile', async (req, res) => {
  try {
    const [rows] = await sequelize.query(`SELECT * FROM HMS_HOSPITAL_PROFILE LIMIT 1`);
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch hospital profile' });
  }
});

// PUT /api/admin/hospital-profile  (Admin only + logo upload)
router.put('/hospital-profile', protect, checkPermission('admin', 'write'), upload.single('logo'), async (req, res) => {
  try {
    const { name, tagline, address, city, state, pin, phone, email, website,
            gstin, regNumber, nabhStatus, cghsEmpanelled, letterheadConfig } = req.body;

    let logoUrl = undefined;
    if (req.file) {
      logoUrl = `/uploads/logo/${req.file.filename}`;
    }

    const updates = [];
    const replacements = {};

    const addField = (col, val, key) => {
      if (val !== undefined) {
        updates.push(`${col} = :${key}`);
        replacements[key] = val;
      }
    };

    addField('NAME', name, 'name');
    addField('TAGLINE', tagline, 'tagline');
    addField('ADDRESS', address, 'address');
    addField('CITY', city, 'city');
    addField('STATE', state, 'state');
    addField('PIN', pin, 'pin');
    addField('PHONE', phone, 'phone');
    addField('EMAIL', email, 'email');
    addField('WEBSITE', website, 'website');
    addField('GSTIN', gstin, 'gstin');
    addField('REG_NUMBER', regNumber, 'regNumber');
    addField('NABH_STATUS', nabhStatus, 'nabhStatus');
    addField('CGHS_EMPANELLED', cghsEmpanelled, 'cghsEmpanelled');
    addField('LETTERHEAD_CONFIG', letterheadConfig, 'letterheadConfig');
    if (logoUrl) {
      addField('LOGO_URL', logoUrl, 'logoUrl');
    }

    updates.push('UPDATED_BY = :updatedBy');
    replacements.updatedBy = req.user.id;
    updates.push('UPDATED_AT = CURRENT_TIMESTAMP');

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update' });
    }

    await sequelize.query(
      `UPDATE HMS_HOSPITAL_PROFILE SET ${updates.join(', ')} WHERE ID = 1`,
      { replacements }
    );

    await logAction(req.user.id, 'UPDATE', 'admin', 1, null, { action: 'update_hospital_profile' }, req.ip);

    const [rows] = await sequelize.query(`SELECT * FROM HMS_HOSPITAL_PROFILE WHERE ID = 1`);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update hospital profile' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  TARIFF MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// GET /api/admin/tariff  (Active tariffs only)
router.get('/tariff', protect, checkPermission('admin', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT * FROM HMS_TARIFFS WHERE IS_ACTIVE = 1 ORDER BY CATEGORY, NAME`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch tariffs' });
  }
});

// GET /api/admin/tariff/all  (All tariffs including inactive)
router.get('/tariff/all', protect, checkPermission('admin', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT t.*, u.NAME as DOCTOR_NAME FROM HMS_TARIFFS t
       LEFT JOIN HMS_USERS u ON u.ID = t.DOCTOR_ID
       ORDER BY t.CATEGORY, t.NAME`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch tariffs' });
  }
});

// POST /api/admin/tariff
router.post('/tariff', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const { category, name, rate, gstRate, perUnit, wardType, doctorId } = req.body;
    const tariff = await Tariff.create({
      category, name, rate,
      gstRate: gstRate || 0,
      perUnit, wardType,
      doctorId: doctorId || null,
    });
    await logAction(req.user.id, 'CREATE', 'admin', tariff.id, null, { action: 'create_tariff', name }, req.ip);
    res.json({ success: true, data: tariff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create tariff' });
  }
});

// PUT /api/admin/tariff/:id
router.put('/tariff/:id', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const { category, name, rate, gstRate, perUnit, wardType, doctorId } = req.body;
    const tariff = await Tariff.findByPk(req.params.id);
    if (!tariff) return res.status(404).json({ success: false, message: 'Tariff not found' });

    await tariff.update({
      category, name, rate,
      gstRate: gstRate || 0,
      perUnit, wardType,
      doctorId: doctorId || null,
    });
    await logAction(req.user.id, 'UPDATE', 'admin', tariff.id, null, { action: 'update_tariff', name }, req.ip);
    res.json({ success: true, data: tariff });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update tariff' });
  }
});

// PATCH /api/admin/tariff/:id/toggle
router.patch('/tariff/:id/toggle', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    await sequelize.query(
      `UPDATE HMS_TARIFFS SET IS_ACTIVE = CASE WHEN IS_ACTIVE = 1 THEN 0 ELSE 1 END WHERE ID = :id`,
      { replacements: { id: req.params.id } }
    );
    const [rows] = await sequelize.query(`SELECT * FROM HMS_TARIFFS WHERE ID = :id`, { replacements: { id: req.params.id } });
    await logAction(req.user.id, 'UPDATE', 'admin', req.params.id, null, { action: 'toggle_tariff' }, req.ip);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to toggle tariff' });
  }
});

// ═══════════════════════════════════════════════════════════════
//  STAFF MANAGEMENT (Admin can view/edit operational staff only)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  ATTENDANCE & LEAVE (In-memory store for now)
// ═══════════════════════════════════════════════════════════════
let leaveRequests = [
  { id: 1, staff_name: 'Dr. Sharma', role: 'doctor', department: 'Cardiology', type: 'Casual Leave', from: '2026-04-05', to: '2026-04-06', days: 2, reason: 'Personal work', status: 'Pending', applied_on: '2026-04-02' },
  { id: 2, staff_name: 'Nurse Priya', role: 'nurse', department: 'ICU', type: 'Sick Leave', from: '2026-04-04', to: '2026-04-04', days: 1, reason: 'Fever', status: 'Pending', applied_on: '2026-04-03' },
  { id: 3, staff_name: 'Rahul Kumar', role: 'receptionist', department: 'Front Desk', type: 'Earned Leave', from: '2026-04-10', to: '2026-04-14', days: 5, reason: 'Family function', status: 'Approved', applied_on: '2026-04-01' },
];

router.get('/attendance', protect, checkPermission('admin', 'read'), async (req, res) => {
  try {
    // Staff who logged in today = "present"
    const [present] = await sequelize.query(`
      SELECT u.ID, u.NAME, u.ROLE, u.LAST_LOGIN
      FROM HMS_USERS u
      WHERE u.ROLE NOT IN ('super_admin', 'admin')
        AND u.IS_ACTIVE = 1
        AND trunc(u.LAST_LOGIN) = trunc(CURRENT_TIMESTAMP)
      ORDER BY u.LAST_LOGIN DESC
    `).catch(() => [[]]);

    // Total active staff
    const [totalRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_USERS
      WHERE ROLE NOT IN ('super_admin', 'admin') AND IS_ACTIVE = 1
    `).catch(() => [[{ CNT: 0 }]]);
    const totalStaff = totalRows[0]?.CNT || 0;

    res.json({
      success: true,
      data: {
        present,
        total_staff: totalStaff,
        present_count: present.length,
        absent_count: totalStaff - present.length,
        leave_requests: leaveRequests,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/attendance/leave/:id', protect, checkPermission('admin', 'write'), async (req, res) => {
  const { status } = req.body; // 'Approved' or 'Rejected'
  const lr = leaveRequests.find(l => l.id === parseInt(req.params.id));
  if (!lr) return res.status(404).json({ success: false, message: 'Leave request not found' });
  lr.status = status;
  await logAction(req.user.id, 'UPDATE', 'attendance', lr.id, null, { action: `leave_${status.toLowerCase()}`, staff: lr.staff_name }, req.ip);
  res.json({ success: true, data: lr });
});

// ═══════════════════════════════════════════════════════════════
//  NOTICES & COMMUNICATION (Department-level)
// ═══════════════════════════════════════════════════════════════
let notices = [
  { id: 1, title: 'OPD Timing Change', message: 'OPD hours extended to 6:00 PM from 1st April.', department: 'All', priority: 'normal', created_by: 'Admin', created_at: new Date('2026-04-01').toISOString() },
  { id: 2, title: 'Annual Day Celebration', message: 'Hospital annual day on 15th April. All staff invited.', department: 'All', priority: 'info', created_by: 'Admin', created_at: new Date('2026-04-02').toISOString() },
];

router.get('/notices', protect, checkPermission('admin', 'read'), async (req, res) => {
  res.json({ success: true, data: notices });
});

router.post('/notices', protect, checkPermission('admin', 'write'), async (req, res) => {
  const { title, message, department, priority } = req.body;
  if (!title || !message) return res.status(400).json({ success: false, message: 'Title and message required' });
  const notice = {
    id: notices.length + 1 + Date.now(),
    title, message,
    department: department || 'All',
    priority: priority || 'normal',
    created_by: req.user.name || 'Admin',
    created_at: new Date().toISOString(),
  };
  notices.unshift(notice);
  await logAction(req.user.id, 'CREATE', 'notices', notice.id, null, { action: 'create_notice', title }, req.ip);
  res.json({ success: true, data: notice });
});

router.delete('/notices/:id', protect, checkPermission('admin', 'write'), async (req, res) => {
  const idx = notices.findIndex(n => n.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: 'Notice not found' });
  notices.splice(idx, 1);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
//  DEPARTMENT CONFIG  (for admin settings)
// ═══════════════════════════════════════════════════════════════
router.get('/departments', protect, checkPermission('admin', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT * FROM HMS_DEPARTMENTS ORDER BY NAME
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch departments' });
  }
});

module.exports = router;

