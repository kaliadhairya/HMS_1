const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, checkPermission, restrictTo } = require('../middleware/auth');
const Patient = require('../models/Patient');
const TestReport = require('../models/TestReport');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { Token, Appointment, Doctor } = require('../models');

// All dashboard routes require authentication + dashboard read permission
router.use(protect, checkPermission('dashboard', 'read'));

// Active medicines with 10 or fewer units across all batches (same rule as the pharmacy reports).
const LOW_STOCK_SQL = `
  SELECT COUNT(*) as CNT FROM (
    SELECT m.ID FROM HMS_MEDICINES m
    LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
    WHERE m.IS_ACTIVE = 1
    GROUP BY m.ID
    HAVING COALESCE(SUM(b.QUANTITY), 0) <= 10
  ) low_stock`;

// Results completed today that fall outside their reference range (the lab dashboard's "critical flagged").
async function abnormalLabResultsToday() {
  const { abnormalFlag } = require('./lab');
  const rows = await sequelize.query(
    `SELECT RESULT_VALUE, REFERENCE_RANGE FROM HMS_INVESTIGATION_ORDER_ITEMS WHERE STATUS = 'Completed' AND UPDATED_AT >= hms_service_day_start()`,
    { type: sequelize.QueryTypes.SELECT }
  );
  return rows.filter((r) => ['High', 'Low'].includes(abnormalFlag(r.result_value ?? r.RESULT_VALUE, r.reference_range ?? r.REFERENCE_RANGE))).length;
}

// ─── Helper: get start of today, this week, this month ──────────
function getDateRanges() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // last day of prev month
  return { todayStart, weekStart, monthStart, prevMonthStart, prevMonthEnd };
}

// ─── GET /api/dashboard/super-admin ─────────────────────────────
// ─── GET /api/dashboard/super-admin ─────────────────────────────
router.get('/super-admin', restrictTo('super_admin', 'admin'), async (req, res) => {
  try {
    const { todayStart, weekStart, monthStart, prevMonthStart, prevMonthEnd } = getDateRanges();

    // 1. Efficient counts at DB level
    const [countsResult] = await sequelize.query(`
      SELECT
        COUNT(*) as total_patients,
        COUNT(CASE WHEN CREATED_AT >= :todayStart THEN 1 END) as today_patients,
        COUNT(CASE WHEN CREATED_AT >= :weekStart THEN 1 END) as week_patients,
        COUNT(CASE WHEN CREATED_AT >= :monthStart THEN 1 END) as month_patients,
        COUNT(CASE WHEN CREATED_AT >= :prevMonthStart AND CREATED_AT <= :prevMonthEnd THEN 1 END) as prev_month_patients
      FROM HMS_PATIENTS
    `, {
      replacements: {
        todayStart,
        weekStart,
        monthStart,
        prevMonthStart,
        prevMonthEnd: new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), prevMonthEnd.getDate(), 23, 59, 59, 999)
      },
      type: sequelize.QueryTypes.SELECT
    });

    const totalPatients = Number(countsResult?.total_patients || 0);
    const todayPatients = Number(countsResult?.today_patients || 0);
    const weekPatients = Number(countsResult?.week_patients || 0);
    const monthPatients = Number(countsResult?.month_patients || 0);
    const prevMonthPatients = Number(countsResult?.prev_month_patients || 0);

    // 2. Fetch only the recent window (previous month, or the last 30 days if that reaches further back)
    const last30Start = new Date(todayStart);
    last30Start.setDate(last30Start.getDate() - 29);
    const windowStart = last30Start < prevMonthStart ? last30Start : prevMonthStart;
    const recentPatients = await Patient.findAll({
      where: {
        createdAt: { [Op.gte]: windowStart }
      },
      attributes: ['id', 'createdAt', 'patientType', 'gender', 'opdIndoor'],
      order: [['createdAt', 'ASC']]
    });

    const isOnOrAfter = (value, start) => new Date(value) >= start;
    const todayPatientRows = recentPatients.filter(p => isOnOrAfter(p.createdAt, todayStart));
    const weekPatientRows = recentPatients.filter(p => isOnOrAfter(p.createdAt, weekStart));
    const monthPatientRows = recentPatients.filter(p => isOnOrAfter(p.createdAt, monthStart));
    const prevMonthPatientRows = recentPatients.filter(p => {
      const d = new Date(p.createdAt);
      return d >= prevMonthStart && d <= new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), prevMonthEnd.getDate(), 23, 59, 59, 999);
    });

    // ── Patient analytics helpers ──
    const localKey = (dt) => {
      const d = new Date(dt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    const dayCountInclusive = (start, end) => {
      const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      return Math.max(1, Math.floor((endDay - startDay) / 86400000) + 1);
    };

    const buildPatientAnalytics = (patients, startDate, days, endDate) => {
      const trendBuckets = [];
      const trendIndex = {};
      const anchor = endDate || todayStart;
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(anchor);
        d.setDate(d.getDate() - i);
        if (startDate && d < startDate) continue;
        const key = localKey(d);
        trendIndex[key] = trendBuckets.length;
        trendBuckets.push({ date: key, count: 0 });
      }

      const byType = { corporate_employee: 0, other: 0 };
      const byGender = { Male: 0, Female: 0, Other: 0 };
      const opdVsIndoor = { OPD: 0, Indoor: 0 };

      patients.forEach(p => {
        const key = localKey(p.createdAt);
        if (key in trendIndex) trendBuckets[trendIndex[key]].count++;

        if (byType[p.patientType] !== undefined) byType[p.patientType]++;
        else byType.other++;

        if (byGender[p.gender] !== undefined) byGender[p.gender]++;
        else byGender.Other++;

        if (opdVsIndoor[p.opdIndoor] !== undefined) opdVsIndoor[p.opdIndoor]++;
      });

      return {
        total: patients.length,
        trend: trendBuckets,
        by_type: byType,
        by_gender: byGender,
        opd_vs_indoor: opdVsIndoor,
      };
    };

    // "Last 30 days" (the modal's label): totals and breakdowns used to cover the whole fetch window
    // (up to two months) while the trend showed 30 days.
    const last30Rows = recentPatients.filter(p => isOnOrAfter(p.createdAt, last30Start));
    const allPatientAnalytics = buildPatientAnalytics(last30Rows, last30Start, 30);
    const todayAnalytics = buildPatientAnalytics(todayPatientRows, todayStart, 1);
    const weekAnalytics = buildPatientAnalytics(weekPatientRows, weekStart, dayCountInclusive(weekStart, todayStart));
    const monthAnalytics = buildPatientAnalytics(monthPatientRows, monthStart, dayCountInclusive(monthStart, todayStart));
    const prevMonthAnalytics = buildPatientAnalytics(prevMonthPatientRows, prevMonthStart, dayCountInclusive(prevMonthStart, prevMonthEnd), prevMonthEnd);

    // 3. Active users count
    const allUsers = await User.findAll({
      attributes: ['id', 'isActive', 'role'],
    });
    const activeUsers = allUsers.filter(u => u.isActive === 1 || u.isActive === true).length;
    const userAnalytics = allUsers.reduce((acc, user) => {
      const role = user.role || 'unknown';
      acc.by_role[role] = (acc.by_role[role] || 0) + 1;
      return acc;
    }, { total: allUsers.length, active: activeUsers, inactive: Math.max(0, allUsers.length - activeUsers), by_role: {} });

    // 4. Recent audit log entries (limited to 20 at DB level)
    const auditLogs = await AuditLog.findAll({
      include: [{ model: User, as: 'user', attributes: ['name', 'username'] }],
      order: [['created_at', 'DESC']],
      limit: 20,
    });
    const recentAudit = auditLogs.map(log => ({
      id: log.id,
      user: log.user?.name || log.user?.username || 'System',
      action: log.action,
      module: log.module,
      created_at: log.created_at,
    }));

    // 5. Failed logins today (counted at DB level)
    const failedLoginsToday = await AuditLog.count({
      where: {
        action: 'LOGIN_FAILED',
        created_at: { [Op.gte]: todayStart },
      },
    });

    const [lowStockRows] = await sequelize.query(LOW_STOCK_SQL);
    const lowStockCount = Number(lowStockRows[0]?.CNT || 0);
    const abnormalLabs = await abnormalLabResultsToday();

    res.json({
      success: true,
      data: {
        today_patients: todayPatients,
        week_patients: weekPatients,
        month_patients: monthPatients,
        prev_month_patients: prevMonthPatients,
        total_patients: totalPatients,
        patient_analytics: {
          ...allPatientAnalytics,
          scopes: {
            all: allPatientAnalytics,
            today: todayAnalytics,
            week: weekAnalytics,
            month: monthAnalytics,
            prev_month: prevMonthAnalytics,
          },
        },
        active_users: activeUsers,
        user_analytics: userAnalytics,
        recent_audit: recentAudit,
        alerts: {
          failed_logins_today: failedLoginsToday,
          // These two were hard-coded to 0.
          low_stock_count: lowStockCount,
          critical_lab_count: abnormalLabs,
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/dashboard/doctor ──────────────────────────────────
router.get('/doctor', restrictTo('doctor', 'super_admin', 'admin'), async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const userId = req.user.id;

    let opdQueueCount = 0;
    let upcomingApptsCount = 0;

    // OPD tokens store the doctor's user ID
    opdQueueCount = await Token.count({
      where: { doctor_id: userId, token_date: todayStr, status: 'Waiting' }
    });

    // Appointments store user ID as doctor_id
    upcomingApptsCount = await Appointment.count({
      where: { doctor_id: userId, appointment_date: todayStr, status: 'Scheduled' }
    });

    res.json({
      success: true,
      data: {
        pending_prescriptions: 0,
        ipd_patients: 0,
        opd_queue: opdQueueCount,
        upcoming_appointments: upcomingApptsCount,
        is_doctor_profile_setup: true
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/dashboard/receptionist ────────────────────────────
router.get('/receptionist', restrictTo('receptionist', 'super_admin', 'admin'), async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    const tokenQueueCount = await Token.count({
      where: { token_date: todayStr }
    });

    const todaysApptsCount = await Appointment.count({
      where: { appointment_date: todayStr }
    });

    const [unpaidRows] = await sequelize.query(`
      SELECT COUNT(*) AS CNT
      FROM (
        SELECT e.ID
        FROM HMS_ENCOUNTERS e
        LEFT JOIN HMS_BILLS b ON b.ENCOUNTER_ID = e.ID
        WHERE trunc(e.ENCOUNTER_DATE) = trunc(CURRENT_TIMESTAMP)
          AND e.STATUS = 'Finalized'
          AND (
            b.ID IS NULL
            OR (b.STATUS = 'Pending' AND COALESCE(b.NET_PAYABLE, 0) > 0)
          )
      )
    `);

    const [bedRows] = await sequelize.query(`
      SELECT COUNT(*) AS CNT
      FROM HMS_BEDS
      WHERE STATUS = 'Available' AND COALESCE(IS_ACTIVE, 1) = 1
    `);

    const [dischargeRows] = await sequelize.query(`
      SELECT COUNT(*) AS CNT
      FROM HMS_ADMISSIONS
      WHERE STATUS IN ('Discharge Pending', 'Pending Discharge')
    `);

    const [walkinBookedRows] = await sequelize.query(`
      SELECT
        SUM(CASE WHEN APPOINTMENT_ID IS NULL THEN 1 ELSE 0 END) AS WALK_IN_COUNT,
        SUM(CASE WHEN APPOINTMENT_ID IS NOT NULL THEN 1 ELSE 0 END) AS BOOKED_COUNT
      FROM HMS_ENCOUNTERS
      WHERE trunc(ENCOUNTER_DATE) = trunc(CURRENT_TIMESTAMP)
    `);

    res.json({
      success: true,
      data: {
        token_queue: tokenQueueCount,
        todays_appointments: todaysApptsCount,
        unpaid_bills_count: Number(unpaidRows[0]?.CNT || 0),
        bed_availability: Number(bedRows[0]?.CNT || 0),
        pending_discharges: Number(dischargeRows[0]?.CNT || 0),
        walk_in_count: Number(walkinBookedRows[0]?.WALK_IN_COUNT || 0),
        booked_count: Number(walkinBookedRows[0]?.BOOKED_COUNT || 0),
      }
    });
  } catch(err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/dashboard/lab-tech ────────────────────────────────
router.get('/lab-tech', restrictTo('lab_technician', 'super_admin', 'admin'), async (req, res) => {
  try {
    const { todayStart } = getDateRanges();

    // Retrieve reports and calculate daily status counts
    const allReports = await TestReport.findAll({
      attributes: ['id', 'status', 'createdAt'],
    });

    const todayReports = allReports.filter(r => new Date(r.createdAt) >= todayStart);
    const pendingReports = todayReports.filter(r => r.status === 'draft').length;
    const completedToday = todayReports.filter(r => r.status === 'final').length;

    // Recent patients with lab orders
    const recentPatients = await Patient.findAll({
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'name', 'testDate', 'patientType'],
    });

    res.json({
      success: true,
      data: {
        pending_reports: pendingReports,
        completed_today: completedToday,
        recent_patients: recentPatients.slice(0, 5),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/dashboard/pharmacist ──────────────────────────────
router.get('/pharmacist', restrictTo('pharmacist', 'super_admin', 'admin'), async (req, res) => {
  try {
    // Dispense queue count (finalized prescriptions)
    const [queueRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_PRESCRIPTIONS WHERE STATUS = 'Finalized'
    `);
    const dispenseQueueCount = queueRows[0]?.CNT || 0;

    // Low stock count (medicines with total qty <= 10)
    const [lowRows] = await sequelize.query(LOW_STOCK_SQL);
    const lowStockCount = lowRows[0]?.CNT || 0;

    // Top 5 low stock items
    const [lowItems] = await sequelize.query(`
      SELECT m.ID, m.GENERIC_NAME, COALESCE(SUM(b.QUANTITY), 0) as TOTAL_QTY
      FROM HMS_MEDICINES m
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
      WHERE m.IS_ACTIVE = 1
      GROUP BY m.ID, m.GENERIC_NAME
      HAVING COALESCE(SUM(b.QUANTITY), 0) <= 10
      ORDER BY TOTAL_QTY ASC
      LIMIT 5
    `);

    // Expiring in 30 days count
    const [expiringRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_MEDICINE_BATCHES
      WHERE trunc(EXPIRY_DATE) <= trunc(CURRENT_TIMESTAMP) + 30
        AND trunc(EXPIRY_DATE) > trunc(CURRENT_TIMESTAMP)
        AND QUANTITY > 0
    `);
    const expiringCount = expiringRows[0]?.CNT || 0;

    // Today's sales: what was actually billed today — dispensing records plus counter (OTC) sales, the same
    // figures the pharmacy reports use. It used to be units out x current MRP, which left out GST and
    // priced old stock movements at today's MRP.
    const [salesRows] = await sequelize.query(`
      SELECT
        (SELECT COALESCE(SUM(TOTAL_AMOUNT), 0) FROM HMS_DISPENSING_RECORDS WHERE DISPENSED_AT >= hms_service_day_start()) as DISPENSED,
        (SELECT COALESCE(SUM(TOTAL_AMOUNT), 0) FROM HMS_OTC_SALES WHERE SOLD_AT >= hms_service_day_start()) as COUNTER
    `);
    const todaysSales = Math.round((Number(salesRows[0]?.DISPENSED || 0) + Number(salesRows[0]?.COUNTER || 0)) * 100) / 100;

    res.json({
      success: true,
      data: {
        dispense_queue_count: dispenseQueueCount,
        low_stock_count: lowStockCount,
        low_stock_items: lowItems,
        expiring_count: expiringCount,
        todays_sales: todaysSales,
      },
    });
  } catch (err) {
    console.error('Pharmacist dashboard error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/dashboard/admin-ops ───────────────────────────────
router.get('/admin-ops', restrictTo('admin', 'super_admin'), async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];

    // Revenue today = payments received today (shown as "Collected today" on billing & finance).
    // It used to read a table that does not exist (HMS_BILLING) and the error was swallowed, so it was always 0.
    const [revRows] = await sequelize.query(`
      SELECT COALESCE(SUM(AMOUNT), 0) as REVENUE FROM HMS_PAYMENTS
      WHERE PAYMENT_DATE >= hms_service_day_start()
    `);
    const revenueToday = Number(revRows[0]?.REVENUE || 0);

    // Bed occupancy
    const [bedRows] = await sequelize.query(`
      SELECT
        COUNT(*) as TOTAL_BEDS,
        COALESCE(SUM(CASE WHEN STATUS = 'Occupied' THEN 1 ELSE 0 END), 0) as OCCUPIED
      FROM HMS_BEDS
    `).catch(() => [[{ TOTAL_BEDS: 0, OCCUPIED: 0 }]]);
    const totalBeds = bedRows[0]?.TOTAL_BEDS || 0;
    const occupiedBeds = bedRows[0]?.OCCUPIED || 0;
    const bedOccupancy = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    // OPD count today (tokens)
    const [opdRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_TOKENS
      WHERE trunc(TOKEN_DATE) = trunc(CURRENT_TIMESTAMP)
    `).catch(() => [[{ CNT: 0 }]]);
    const opdCount = opdRows[0]?.CNT || 0;

    // IPD count (currently admitted). Admissions live in HMS_ADMISSIONS with STATUS 'Active'.
    const [ipdRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_ADMISSIONS
      WHERE STATUS = 'Active'
    `).catch(() => [[{ CNT: 0 }]]);
    const ipdCount = ipdRows[0]?.CNT || 0;

    // Staff on duty (users who logged in today, excluding admin/super_admin)
    const [staffRows] = await sequelize.query(`
      SELECT COUNT(DISTINCT u.ID) as CNT FROM HMS_USERS u
      WHERE u.ROLE NOT IN ('admin', 'super_admin')
        AND u.IS_ACTIVE = 1
        AND trunc(u.LAST_LOGIN) = trunc(CURRENT_TIMESTAMP)
    `).catch(() => [[{ CNT: 0 }]]);
    const staffOnDuty = staffRows[0]?.CNT || 0;

    // Pending discharges: marked for discharge, or admitted past their expected discharge date
    const [dischRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_ADMISSIONS
      WHERE STATUS IN ('Discharge Pending', 'Pending Discharge')
         OR (STATUS = 'Active' AND EXPECTED_DISCHARGE_DATE IS NOT NULL
             AND trunc(EXPECTED_DISCHARGE_DATE) <= trunc(CURRENT_TIMESTAMP))
    `).catch(() => [[{ CNT: 0 }]]);
    const pendingDischarges = dischRows[0]?.CNT || 0;

    // Low stock medicines
    const [lowStockRows] = await sequelize.query(LOW_STOCK_SQL);
    const lowStock = lowStockRows[0]?.CNT || 0;

    // Today's appointments (cancelled ones are not expected visits)
    const [apptRows] = await sequelize.query(`
      SELECT COUNT(*) as CNT FROM HMS_APPOINTMENTS
      WHERE trunc(APPOINTMENT_DATE) = trunc(CURRENT_TIMESTAMP)
        AND COALESCE(STATUS, '') <> 'Cancelled'
    `);
    const todaysAppointments = apptRows[0]?.CNT || 0;

    // Recent admissions (last 10)
    const [recentAdmissions] = await sequelize.query(`
      SELECT a.ID, p.NAME as PATIENT_NAME, a.STATUS, a.ADMISSION_DATE,
             w.NAME as WARD_NAME, b.BED_NUMBER
      FROM HMS_ADMISSIONS a
      LEFT JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      ORDER BY a.ADMISSION_DATE DESC
      LIMIT 10
    `).catch(() => [[]]);

    res.json({
      success: true,
      data: {
        revenue_today: revenueToday,
        bed_occupancy: bedOccupancy,
        total_beds: totalBeds,
        occupied_beds: occupiedBeds,
        opd_count: opdCount,
        ipd_count: ipdCount,
        staff_on_duty: staffOnDuty,
        pending_discharges: pendingDischarges,
        low_stock: lowStock,
        todays_appointments: todaysAppointments,
        recent_admissions: recentAdmissions,
      },
    });
  } catch (err) {
    console.error('Admin ops dashboard error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/dashboard/nurse ───────────────────────────────────
router.get('/nurse', async (req, res) => {
  res.json({
    success: true,
    data: {
      ward_patients: [],
      overdue_vitals: [],
      mar_due_soon: [],
    },
  });
});

module.exports = router;
