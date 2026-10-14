const express = require('express');
const router = express.Router();
const { QueryTypes } = require('sequelize');
const {
  InvestigationOrder,
  InvestigationOrderItem,
  Patient,
  User,
} = require('../models');
const { sequelize } = require('../models/db');
const { publish } = require('../utils/outbox');
const { checkPermission } = require('../middleware/auth');

// Item statuses: Pending (ordered, no sample) -> Collected (sample logged) -> Completed (result entered).
// Cancelled items drop out of every lab list. Order status follows its items:
// Pending -> In Progress (first sample) -> Completed (no outstanding items).
const OPEN_ORDER_STATUSES = ['Pending', 'Ordered', 'In Progress'];
const COLLECTED_STATUSES = ['Collected', 'Received in Lab', 'In Progress'];
const OUTSTANDING_ITEM_STATUSES = ['Pending', ...COLLECTED_STATUSES];
// A sample is late when it has waited longer than this for collection (matches the test queue).
const COLLECTION_TARGET_MIN = { STAT: 60, Routine: 240 };

const canRead = checkPermission('lab', 'read');
const canWrite = checkPermission('lab', 'write');

function displayPatientName(patient) {
  if (!patient) return 'Unknown';
  const combined = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim();
  return combined || patient.name || 'Unknown';
}

function deriveSampleType(testName) {
  const value = String(testName || '').toLowerCase();
  if (value.includes('urine')) return 'Urine';
  if (value.includes('sputum')) return 'Sputum';
  if (value.includes('stool')) return 'Stool';
  if (value.includes('abg') || value.includes('arterial')) return 'Arterial Blood';
  return 'Blood';
}

// ── Reference ranges and abnormal flags ──────────────────────────────────────
// There is no test catalogue in the schema, so the range is whatever the technician records on
// the item (HMS_INVESTIGATION_ORDER_ITEMS.REFERENCE_RANGE). Flags are derived from it on read.
// Accepted forms: "12-16", "3.5 - 5.1 mmol/L", "70 to 110", "<200", "<= 5", ">40".
// Anything ambiguous (sex-specific "M: 12-16, F: 10-14", text) gives no flag rather than a guess.
const NUM = '[-+]?\\d+(?:\\.\\d+)?';
const RANGE_RE = new RegExp(`^\\s*(${NUM})\\s*(?:-|–|—|to)\\s*(${NUM})`, 'i');
const UPPER_RE = new RegExp(`^\\s*(?:<=?|≤|up\\s*to|below)\\s*(${NUM})`, 'i');
const LOWER_RE = new RegExp(`^\\s*(?:>=?|≥|above)\\s*(${NUM})`, 'i');
const SECOND_RANGE_RE = new RegExp(`${NUM}\\s*(?:-|–|—|to)\\s*${NUM}|[<>≤≥]`, 'i');
const VALUE_RE = new RegExp(`^\\s*(${NUM})\\s*(?:[a-zA-Zµ%][a-zA-Z0-9µ%/^.]*\\s*)?$`);

function parseReferenceRange(range) {
  const text = String(range || '').trim();
  if (!text) return null;
  let m = text.match(RANGE_RE);
  let bounds = null;
  if (m) bounds = { low: Number(m[1]), high: Number(m[2]) };
  else if ((m = text.match(UPPER_RE))) bounds = { low: null, high: Number(m[1]) };
  else if ((m = text.match(LOWER_RE))) bounds = { low: Number(m[1]), high: null };
  if (!bounds) return null;
  if (SECOND_RANGE_RE.test(text.slice(m[0].length))) return null;
  if (bounds.low !== null && bounds.high !== null && bounds.low > bounds.high) return null;
  return bounds;
}

// 'High' | 'Low' | 'Normal', or null when the value is not numeric or no usable range exists.
function abnormalFlag(resultValue, referenceRange) {
  const bounds = parseReferenceRange(referenceRange);
  if (!bounds) return null;
  const m = String(resultValue ?? '').match(VALUE_RE);
  if (!m) return null;
  const value = Number(m[1]);
  if (bounds.low !== null && value < bounds.low) return 'Low';
  if (bounds.high !== null && value > bounds.high) return 'High';
  return 'Normal';
}

const isAbnormal = (flag) => flag === 'High' || flag === 'Low';

// ── Shared loader: orders with their items (raw SQL so the timestamps come back) ─────────────
async function loadOrders({ where = '1=1', replacements = {}, limit = null } = {}) {
  const actor = require('../utils/auditContext').storage.getStore()?.userId ?? null;
  where = `(${where}) AND (NOT EXISTS (SELECT 1 FROM hms_users caller WHERE caller.id=:careActor AND caller.role='doctor') OR patient_in_care(:careActor, o.patient_id))`;
  replacements = { ...replacements, careActor: actor };

  const orders = await sequelize.query(`
    SELECT o.ID, o.ENCOUNTER_ID, o.PATIENT_ID, o.DOCTOR_ID, o.ORDER_TYPE, o.URGENCY, o.STATUS,
           o.CLINICAL_NOTES, o.CREATED_AT, o.UPDATED_AT,
           p.NAME AS PATIENT_NAME, p.FIRST_NAME, p.LAST_NAME, p.UHID, p.AGE, p.GENDER,
           u.NAME AS DOCTOR_NAME
      FROM HMS_INVESTIGATION_ORDERS o
      LEFT JOIN HMS_PATIENTS p ON p.ID = o.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = o.DOCTOR_ID
     WHERE ${where}
     ORDER BY o.ID DESC
     ${limit ? 'LIMIT :limit' : ''}`, { replacements: { ...replacements, limit }, type: QueryTypes.SELECT });
  if (orders.length === 0) return [];

  const items = await sequelize.query(`
    SELECT i.ID, i.ORDER_ID, i.ITEM_NAME, i.TEST_CATEGORY, i.STATUS, i.RESULT_VALUE, i.REFERENCE_RANGE, i.REMARKS, i.CREATED_AT, i.UPDATED_AT,
             i.lab_test_version_id, r.abnormal_flag AS governed_flag
      FROM HMS_INVESTIGATION_ORDER_ITEMS i
      LEFT JOIN LATERAL (SELECT v.abnormal_flag FROM hms_lab_result_versions v JOIN hms_lab_report_results l ON l.result_version_id=v.id JOIN hms_lab_report_versions p ON p.id=l.report_version_id
        WHERE v.item_id=i.id ORDER BY p.released_at DESC,p.version DESC LIMIT 1) r ON true
     WHERE i.ORDER_ID IN (:ids)
     ORDER BY i.ID`, { replacements: { ids: orders.map((o) => o.id) }, type: QueryTypes.SELECT });

  const byOrder = new Map();
  for (const it of items) {
    const flag = it.status === 'Completed' ? (it.lab_test_version_id ? ({ LOW: 'Low', HIGH: 'High', IN_RANGE: 'Normal' }[it.governed_flag] || null) : abnormalFlag(it.result_value, it.reference_range)) : null;
    const entry = {
      itemId: it.id,
      test: it.item_name,
      department: it.test_category || null,
      status: it.status,
      result: it.result_value || null,
      referenceRange: it.reference_range || null,
      flag,
      remarks: it.remarks || null,
      // Status changes stamp UPDATED_AT, so for a completed item it is the time the result was entered.
      completedAt: it.status === 'Completed' ? it.updated_at : null,
    };
    if (!byOrder.has(it.order_id)) byOrder.set(it.order_id, []);
    byOrder.get(it.order_id).push(entry);
  }

  return orders.map((o) => {
    const tests = byOrder.get(o.id) || [];
    const completed = tests.filter((t) => t.status === 'Completed');
    const completedAt = completed.reduce((max, t) => (t.completedAt && (!max || new Date(t.completedAt) > new Date(max)) ? t.completedAt : max), null);
    return {
      orderId: o.id,
      id: `ORD-${o.id}`,
      encounterId: o.encounter_id,
      patientId: o.patient_id,
      patient: displayPatientName({ first_name: o.first_name, last_name: o.last_name, name: o.patient_name }),
      uhid: o.uhid || '---',
      age: o.age ?? null,
      gender: o.gender || null,
      doctorId: o.doctor_id,
      doctor: o.doctor_name || 'Unknown',
      investigationType: o.order_type || 'Lab',
      priority: o.urgency || 'Routine',
      status: o.status,
      clinicalNotes: o.clinical_notes || null,
      orderedAt: o.created_at,
      completedAt,
      tests,
      abnormalCount: completed.filter((t) => isAbnormal(t.flag)).length,
    };
  });
}

// Stamp UPDATED_AT on every status change (the models do not map it), so turnaround and
// "completed today" can be measured.
async function setItemStatus(itemId, fields, transaction) {
  const sets = ['STATUS = :status', 'UPDATED_AT = CURRENT_TIMESTAMP'];
  if ('result_value' in fields) sets.push('RESULT_VALUE = :result_value');
  if ('reference_range' in fields) sets.push('REFERENCE_RANGE = :reference_range');
  if ('remarks' in fields) sets.push('REMARKS = :remarks');
  await sequelize.query(`UPDATE HMS_INVESTIGATION_ORDER_ITEMS SET ${sets.join(', ')} WHERE ID = :itemId`, {
    replacements: { result_value: null, reference_range: null, remarks: null, ...fields, itemId },
    transaction,
  });
}

async function setOrderStatus(orderId, status, transaction) {
  await sequelize.query('UPDATE HMS_INVESTIGATION_ORDERS SET STATUS = :status, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = :orderId', {
    replacements: { status, orderId }, transaction,
  });
}

const minutesBetween = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / 60000;

// Completed items whose result was entered today, with their flags and turnaround.
async function itemsCompletedToday() {
  const rows = await sequelize.query(`
    SELECT i.ID, i.RESULT_VALUE, i.REFERENCE_RANGE, i.CREATED_AT, i.UPDATED_AT, o.CREATED_AT AS ORDERED_AT, i.lab_test_version_id, r.abnormal_flag AS governed_flag
      FROM HMS_INVESTIGATION_ORDER_ITEMS i
      JOIN HMS_INVESTIGATION_ORDERS o ON o.ID = i.ORDER_ID
      LEFT JOIN LATERAL (SELECT v.abnormal_flag FROM hms_lab_result_versions v JOIN hms_lab_report_results l ON l.result_version_id=v.id
        JOIN hms_lab_report_versions p ON p.id=l.report_version_id WHERE v.item_id=i.id ORDER BY p.released_at DESC,p.version DESC LIMIT 1) r ON true
     WHERE i.STATUS = 'Completed' AND i.UPDATED_AT >= hms_service_day_start()`, { type: QueryTypes.SELECT });
  return rows.map((r) => ({
    id: r.id,
    flag: r.lab_test_version_id ? ({ LOW: 'Low', HIGH: 'High', IN_RANGE: 'Normal' }[r.governed_flag] || null) : abnormalFlag(r.result_value, r.reference_range),
    // Items completed before status changes were stamped still have UPDATED_AT = CREATED_AT; their
    // completion time is unknown, so they carry no turnaround.
    tatMinutes: r.updated_at && r.ordered_at && new Date(r.updated_at) > new Date(r.created_at) ? minutesBetween(r.ordered_at, r.updated_at) : null,
  }));
}

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', canRead, async (req, res) => {
  try {
    const [[counts], pendingSamples, deptRows, completedItems] = await Promise.all([
      sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM HMS_INVESTIGATION_ORDERS WHERE STATUS IN (:open)) AS PENDING_QUEUE,
          (SELECT COUNT(*) FROM HMS_INVESTIGATION_ORDERS WHERE STATUS IN (:open) AND URGENCY = 'STAT') AS STAT_PENDING,
          (SELECT COUNT(*) FROM HMS_INVESTIGATION_ORDERS WHERE STATUS = 'Completed' AND UPDATED_AT >= hms_service_day_start()) AS COMPLETED_TODAY`,
      { replacements: { open: OPEN_ORDER_STATUSES }, type: QueryTypes.SELECT }),
      sequelize.query(`
        SELECT o.URGENCY, o.CREATED_AT
          FROM HMS_INVESTIGATION_ORDER_ITEMS i
          JOIN HMS_INVESTIGATION_ORDERS o ON o.ID = i.ORDER_ID
         WHERE i.STATUS = 'Pending' AND o.STATUS IN (:open)`,
      { replacements: { open: OPEN_ORDER_STATUSES }, type: QueryTypes.SELECT }),
      sequelize.query(`
        SELECT LOWER(COALESCE(TEST_CATEGORY, 'General')) AS DEPT, COUNT(*) AS N
          FROM HMS_INVESTIGATION_ORDER_ITEMS
         WHERE CREATED_AT >= hms_service_day_start() AND STATUS <> 'Cancelled'
         GROUP BY LOWER(COALESCE(TEST_CATEGORY, 'General'))`, { type: QueryTypes.SELECT }),
      itemsCompletedToday(),
    ]);

    const now = Date.now();
    const collectionDelayed = pendingSamples.filter((r) => {
      const limit = COLLECTION_TARGET_MIN[r.urgency] ?? COLLECTION_TARGET_MIN.Routine;
      return r.created_at && minutesBetween(r.created_at, now) > limit;
    }).length;

    const testTypes = Object.fromEntries(deptRows.map((r) => [r.dept, Number(r.n)]));

    res.json({
      status: 'success',
      data: {
        pendingQueue: Number(counts.pending_queue),
        statPending: Number(counts.stat_pending),
        completedToday: Number(counts.completed_today),
        abnormalToday: completedItems.filter((i) => isAbnormal(i.flag)).length,
        collectionDelayed,
        testTypes,
      },
    });
  } catch (err) {
    console.error('Lab dashboard error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab dashboard.' });
  }
});

// ── Test queue ───────────────────────────────────────────────────────────────
router.get('/queue', canRead, async (req, res) => {
  try {
    const orders = await InvestigationOrder.findAll({
      where: { status: OPEN_ORDER_STATUSES, ...(req.user.role === 'doctor' ? { patient_id: { [require('sequelize').Op.in]: sequelize.literal(`(SELECT id FROM hms_patients WHERE patient_in_care(${Number(req.user.id)},id))`) } } : {}) },
      attributes: { include: [[sequelize.literal(`(SELECT count(DISTINCT l.item_id) FROM hms_lab_specimen_links l JOIN hms_lab_specimens s ON s.id=l.specimen_id JOIN hms_investigation_order_items i ON i.id=l.item_id WHERE i.order_id=InvestigationOrder.id AND s.state IN ('COLLECTED','SENT','RECEIVED','STORED'))`), 'usable_collected']] },
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'name', 'first_name', 'last_name', 'uhid'] },
        { model: User, as: 'doctor', attributes: ['id', 'name'] },
        { model: InvestigationOrderItem, as: 'items', attributes: ['id', 'test_name', 'status', 'department'] },
      ],
      order: [['order_date', 'ASC']],
    });

    const queue = orders.map((order) => {
      const items = (order.items || []).filter((item) => item.status !== 'Cancelled');
      return {
        id: `ORD-${order.id}`,
        orderId: order.id,
        patient: displayPatientName(order.patient),
        uhid: order.patient?.uhid || '---',
        doctor: order.doctor?.name || 'Unknown',
        dept: order.investigation_type || 'General',
        tests: items.map((item) => item.test_name),
        collected: Number(order.get('usable_collected') || 0),
        priority: order.priority || 'Routine',
        status: order.status,
        time: order.order_date ? new Date(order.order_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '---',
        ordered_at: order.order_date || null,
      };
    });

    res.json({ status: 'success', data: queue, source: 'live' });
  } catch (err) {
    console.error('Lab queue error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab queue.' });
  }
});

// Order-level status change. 'In Progress' marks the order as being worked on; 'Cancelled'
// withdraws an order whose results have not been reported and cancels its outstanding tests.
const QUEUE_STATUSES = ['In Progress', 'Cancelled'];
router.patch('/queue/:id', canWrite, async (req, res) => {
  try {
    const C = require('../services/laboratoryCommon');
    if (req.body.status !== 'Cancelled') return res.status(410).json({ code: 'LEGACY_LAB_WRITE_RETIRED', message: 'Use specimen custody and result processing commands.' });
    const data = await sequelize.transaction(tx => require('../services/laboratoryOrders').cancel(String(req.params.id).replace('ORD-', ''), req.user, req.headers['if-match'], tx));
    res.json({ success: true, data });
  } catch (e) { res.status(e.status || 500).json({ success: false, code: e.code || 'LAB_COMMAND_FAILED', message: e.status ? e.message : 'Command could not be confirmed.' }); }
});

// ── Samples ──────────────────────────────────────────────────────────────────
router.get('/samples', canRead, async (req, res) => {
  try {
    const rows = await sequelize.query(`SELECT s.*,p.name AS patient,p.uhid,u.name AS collector FROM hms_lab_specimens s
      JOIN hms_patients p ON p.id=s.patient_id LEFT JOIN hms_users u ON u.id=s.collector_user_id
      WHERE (:doctor::int IS NULL OR patient_in_care(:doctor,s.patient_id)) ORDER BY s.created_at DESC LIMIT 200`,
      { replacements: { doctor: req.user.role === 'doctor' ? req.user.id : null }, type: QueryTypes.SELECT });
    res.json({ success: true, data: rows, source: 'accessions' });
  } catch (e) { res.status(503).json({ success: false, message: 'Specimen observations unavailable.' }); }
});

router.post('/samples', canWrite, (req, res) => res.status(410).json({ success: false, code: 'LEGACY_LAB_WRITE_RETIRED', message: 'Use accession-based specimens and versioned result entry in the laboratory workflow.' }));

// ── Results ──────────────────────────────────────────────────────────────────
// Only tests whose sample has been logged are waiting for a result.
router.get('/results', canRead, async (req, res) => {
  try {
    const rows = await sequelize.query(`SELECT i.*,o.patient_id,p.name AS patient,p.uhid FROM hms_investigation_order_items i
      JOIN hms_investigation_orders o ON o.id=i.order_id JOIN hms_patients p ON p.id=o.patient_id
      WHERE i.lab_state IN ('PROCESSING','ENTERED','VERIFIED','REPEAT')
      AND (:doctor::int IS NULL OR patient_in_care(:doctor,o.patient_id)) ORDER BY i.id LIMIT 200`,
      { replacements: { doctor: req.user.role === 'doctor' ? req.user.id : null }, type: QueryTypes.SELECT });
    res.json({ success: true, data: rows, source: 'governed' });
  } catch (e) { res.status(503).json({ success: false, message: 'Result observations unavailable.' }); }
});

router.post('/results/:itemId', canWrite, (req, res) => res.status(410).json({ success: false, code: 'LEGACY_LAB_WRITE_RETIRED', message: 'Use accession-based specimens and versioned result entry in the laboratory workflow.' }));

// ── Reports: one per order with at least one reported test ──────────────────────
router.get('/reports', canRead, async (req, res) => {
  try {
    const orders = await loadOrders({
      where: "EXISTS (SELECT 1 FROM HMS_INVESTIGATION_ORDER_ITEMS i WHERE i.ORDER_ID = o.ID AND i.STATUS = 'Completed')",
      limit: 50, // most recent 50 reports
    });

    const data = orders.map((o) => ({
      ...o,
      id: `REP-${o.orderId}`,
      tests: o.tests.filter((t) => t.status !== 'Cancelled'),
      test: o.tests.filter((t) => t.status !== 'Cancelled').map((t) => t.test).join(', '),
      status: o.status === 'Completed' ? 'Final' : 'Partial',
    }));

    res.json({ status: 'success', data, source: 'live' });
  } catch (err) {
    console.error('Lab reports error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab reports.' });
  }
});

// All investigation orders for one patient, with results (report editor, doctor review).
router.get('/patients/:patientId/orders', canRead, async (req, res) => {
  try {
    const patientId = parseInt(req.params.patientId, 10);
    if (!Number.isInteger(patientId)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });
    const orders = await loadOrders({ where: "o.PATIENT_ID = :patientId AND o.STATUS <> 'Cancelled'", replacements: { patientId }, limit: 50 });
    res.json({ status: 'success', data: orders });
  } catch (err) {
    console.error('Lab patient orders error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load the patient\'s investigations.' });
  }
});

// ── Workload (whole lab, today) ─────────────────────────────────────────────────
router.get('/workload', canRead, async (req, res) => {
  try {
    const [[{ in_progress: inProgress }], completedItems] = await Promise.all([
      sequelize.query('SELECT COUNT(*) AS IN_PROGRESS FROM HMS_INVESTIGATION_ORDER_ITEMS WHERE STATUS IN (:collected)', {
        replacements: { collected: COLLECTED_STATUSES }, type: QueryTypes.SELECT,
      }),
      itemsCompletedToday(),
    ]);

    const tats = completedItems.map((i) => i.tatMinutes).filter((m) => m !== null);
    const avgTatMinutes = tats.length ? Math.round(tats.reduce((a, b) => a + b, 0) / tats.length) : null;

    res.json({
      status: 'success',
      data: {
        testsStarted: Number(inProgress),
        testsCompleted: completedItems.length,
        avgTat: avgTatMinutes === null ? 'N/A' : `${avgTatMinutes} min`,
        avgTatMinutes,
        targetTat: null,
        abnormalFlagged: completedItems.filter((i) => isAbnormal(i.flag)).length,
        // Existing dashboards label this historical alias "Abnormal results".
        // New consumers use abnormalFlagged or unresolvedCritical explicitly.
        criticalFlagged: completedItems.filter((i) => isAbnormal(i.flag)).length,
        legacyCriticalFlaggedMeaning: 'ABNORMAL_COUNT_ONLY',
        unresolvedCritical: Number((await sequelize.query("SELECT count(*)::int AS n FROM hms_lab_critical_tasks WHERE state<>'CLOSED'", { type: QueryTypes.SELECT }))[0].n),
        shift: 'Operational',
      },
    });
  } catch (err) {
    console.error('Lab workload error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab workload.' });
  }
});

module.exports = router;
module.exports.abnormalFlag = abnormalFlag;
module.exports.parseReferenceRange = parseReferenceRange;
module.exports.loadOrders = loadOrders;
