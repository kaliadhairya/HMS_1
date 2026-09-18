const express = require('express');
const router = express.Router();
const {
  InvestigationOrder,
  InvestigationOrderItem,
  Patient,
  User,
} = require('../models');

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

router.get('/dashboard', async (req, res) => {
  try {
    const [pendingQueue, collectionDelayed, completedToday, criticalAlerts, itemDepartments] = await Promise.all([
      InvestigationOrder.count({ where: { status: ['Pending', 'Ordered'] } }),
      InvestigationOrder.count({ where: { status: 'In Progress' } }),
      InvestigationOrder.count({ where: { status: 'Completed' } }),
      InvestigationOrder.count({ where: { priority: 'STAT', status: ['Pending', 'Ordered', 'In Progress'] } }),
      InvestigationOrderItem.findAll({ attributes: ['department'] }),
    ]);

    const testTypes = itemDepartments.reduce((acc, item) => {
      const key = String(item.department || 'General').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    res.json({
      status: 'success',
      data: {
        pendingQueue,
        completedToday,
        criticalAlerts,
        collectionDelayed,
        testTypes,
      },
    });
  } catch (err) {
    console.error('Lab dashboard error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab dashboard.' });
  }
});

router.get('/queue', async (req, res) => {
  try {
    const orders = await InvestigationOrder.findAll({
      where: { status: ['Pending', 'Ordered', 'In Progress'] },
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'name', 'first_name', 'last_name', 'uhid'] },
        { model: User, as: 'doctor', attributes: ['id', 'name'] },
        { model: InvestigationOrderItem, as: 'items', attributes: ['id', 'test_name', 'status', 'department'] },
      ],
      order: [['order_date', 'ASC']],
    });

    const queue = orders.map((order) => ({
      id: `ORD-${order.id}`,
      patient: displayPatientName(order.patient),
      uhid: order.patient?.uhid || '---',
      doctor: order.doctor?.name || 'Unknown',
      dept: order.investigation_type || 'General',
      tests: (order.items || []).map((item) => item.test_name),
      priority: order.priority || 'Routine',
      status: order.status,
      time: order.order_date ? new Date(order.order_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '---',
    }));

    res.json({ status: 'success', data: queue, source: 'live' });
  } catch (err) {
    console.error('Lab queue error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab queue.' });
  }
});

router.patch('/queue/:id', async (req, res) => {
  try {
    const orderId = parseInt(req.params.id.replace('ORD-', ''), 10);
    const { status } = req.body;

    await InvestigationOrder.update({ status }, { where: { id: orderId } });

    const io = req.app.get('io');
    if (io) io.to('doctor').emit('lab_status_change', { orderId, status });

    res.json({ status: 'success', message: 'Status updated' });
  } catch (err) {
    console.error('Lab queue status error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to update investigation status.' });
  }
});

router.get('/samples', async (req, res) => {
  try {
    const items = await InvestigationOrderItem.findAll({
      include: [{
        model: InvestigationOrder,
        as: 'order',
        include: [{ model: Patient, as: 'patient', attributes: ['id', 'name', 'first_name', 'last_name', 'uhid'] }],
      }],
      where: { status: ['Pending', 'Collected', 'Received in Lab', 'In Progress', 'Completed'] },
      order: [['id', 'DESC']],
    });

    // Cap result set to most recent 100 items
    const data = items.slice(0, 100).map((item) => ({
      id: `SMP-${item.id}`,
      itemId: item.id,
      barcode: `${89100000 + item.id}`,
      patient: displayPatientName(item.order?.patient),
      tests: item.test_name,
      type: deriveSampleType(item.test_name),
      collectedAt: item.status === 'Pending' ? 'Pending' : 'Logged',
      collector: 'Lab Technician',
      status: item.status === 'Pending' ? 'Pending Collection' : item.status,
      storage: item.status === 'Pending' ? 'Pending' : 'Room Temperature',
    }));

    res.json({ status: 'success', data, source: 'live' });
  } catch (err) {
    console.error('Lab samples error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load sample log.' });
  }
});

router.post('/samples', async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) {
      return res.status(400).json({ status: 'error', message: 'itemId is required.' });
    }

    const item = await InvestigationOrderItem.findByPk(itemId);
    if (!item) {
      return res.status(404).json({ status: 'error', message: 'Investigation item not found.' });
    }

    await InvestigationOrderItem.update({ status: 'Collected' }, { where: { id: itemId } });
    await InvestigationOrder.update({ status: 'In Progress' }, { where: { id: item.order_id } });

    res.status(201).json({ status: 'success', message: 'Sample logged successfully' });
  } catch (err) {
    console.error('Lab sample log error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to log sample.' });
  }
});

router.get('/results', async (req, res) => {
  try {
    const items = await InvestigationOrderItem.findAll({
      where: { status: ['Pending', 'Collected', 'Received in Lab', 'In Progress'] },
      include: [{
        model: InvestigationOrder,
        as: 'order',
        include: [
          { model: Patient, as: 'patient', attributes: ['id', 'name', 'first_name', 'last_name', 'uhid'] },
          { model: User, as: 'doctor', attributes: ['name'] },
        ],
      }],
      order: [['id', 'ASC']],
    });

    const data = items.map((item) => ({
      id: `RES-${item.id}`,
      itemId: item.id,
      patient: displayPatientName(item.order?.patient),
      uhid: item.order?.patient?.uhid || '---',
      test: item.test_name,
      sampleBarcode: `${89100000 + item.id}`,
      orderedBy: item.order?.doctor?.name || 'Unknown',
      priority: item.order?.priority || 'Routine',
      time: item.order?.order_date ? new Date(item.order.order_date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '---',
      currentResult: item.result_value || '',
      remarks: item.remarks || '',
    }));

    res.json({ status: 'success', data, source: 'live' });
  } catch (err) {
    console.error('Lab results error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load pending lab results.' });
  }
});

router.post('/results/:itemId', async (req, res) => {
  try {
    const { result_value, remarks } = req.body;
    const itemId = parseInt(req.params.itemId.replace('RES-', ''), 10);

    if (!result_value) {
      return res.status(400).json({ status: 'error', message: 'result_value is required.' });
    }

    await InvestigationOrderItem.update(
      { result_value, remarks: remarks || null, status: 'Completed' },
      { where: { id: itemId } }
    );

    const item = await InvestigationOrderItem.findByPk(itemId);
    if (item) {
      const remaining = await InvestigationOrderItem.count({
        where: { order_id: item.order_id, status: ['Pending', 'Collected', 'Received in Lab', 'In Progress'] },
      });
      if (remaining === 0) {
        await InvestigationOrder.update({ status: 'Completed' }, { where: { id: item.order_id } });
      } else {
        await InvestigationOrder.update({ status: 'In Progress' }, { where: { id: item.order_id } });
      }
    }

    const io = req.app.get('io');
    if (io) io.to('doctor').emit('lab_result_ready', { itemId, result_value });

    res.json({ status: 'success', message: 'Result saved and notified.' });
  } catch (err) {
    console.error('Lab result save error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to save lab result.' });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const completedItems = await InvestigationOrderItem.findAll({
      where: { status: 'Completed' },
      include: [{
        model: InvestigationOrder,
        as: 'order',
        include: [{ model: Patient, as: 'patient', attributes: ['name', 'first_name', 'last_name'] }],
      }],
      order: [['id', 'DESC']],
    });

    // Cap result set to most recent 50 items
    const data = completedItems.slice(0, 50).map((item) => ({
      id: `REP-${item.id}`,
      patient: displayPatientName(item.order?.patient),
      test: item.test_name,
      printed: false,
      verifiedBy: 'Lab Admin',
      time: 'Available',
      status: 'Final',
      result: item.result_value,
    }));

    res.json({ status: 'success', data, source: 'live' });
  } catch (err) {
    console.error('Lab reports error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab reports.' });
  }
});

router.get('/workload', async (req, res) => {
  try {
    const [testsStarted, testsCompleted, criticalFlagged] = await Promise.all([
      InvestigationOrderItem.count({ where: { status: ['Collected', 'Received in Lab', 'In Progress'] } }),
      InvestigationOrderItem.count({ where: { status: 'Completed' } }),
      InvestigationOrder.count({ where: { priority: 'STAT', status: ['Pending', 'Ordered', 'In Progress'] } }),
    ]);

    res.json({
      status: 'success',
      data: {
        testsStarted,
        testsCompleted,
        avgTat: 'N/A',
        targetTat: '60 mins',
        criticalFlagged,
        shift: 'Operational',
      },
    });
  } catch (err) {
    console.error('Lab workload error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to load lab workload.' });
  }
});

module.exports = router;
