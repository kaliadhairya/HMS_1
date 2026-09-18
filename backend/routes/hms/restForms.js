const express = require('express');
const router = express.Router();
const { RestForm, Patient } = require('../../models');
const { protect, checkPermission } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

// Create Rest Form
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const {
      patient_id, encounter_id, attended_date,
      advised_days, from_date, to_date, disease, fit_date,
      working_as, department, extended_date
    } = req.body;

    // Auto-generate sr_no as RF-01, RF-02, etc.
    const count = await RestForm.count();
    const sr_no = `RF-${String(count + 1).padStart(2, '0')}`;

    const restForm = await RestForm.create({
      patient_id,
      doctor_id: req.user.id,
      encounter_id: encounter_id || null,
      book_no: '',
      sr_no,
      attended_date,
      advised_days,
      from_date,
      to_date,
      disease,
      fit_date,
      working_as,
      department,
      extended_date: extended_date || null
    });

    logAction(req.user.id, 'CREATE_REST_FORM', 'RestForms', restForm.id, null, restForm.id, req.ip);
    res.status(201).json(restForm);
  } catch (error) {
    console.error('Error creating rest form:', error);
    res.status(500).json({ error: 'Failed to create rest form' });
  }
});

// Get all Rest Forms for the logged-in doctor
router.get('/doctor', protect, async (req, res) => {
  try {
    const restForms = await RestForm.findAll({
      where: { doctor_id: req.user.id },
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'name', 'uhid', 'empNumber', 'relationship'] }
      ],
      order: [['CREATED_AT', 'DESC']]
    });
    
    // Normalize keys to camelCase/lowercase for frontend
    const mapped = restForms.map(f => {
      const data = f.toJSON();
      return {
        id: data.id || data.ID,
        patient_id: data.patient_id,
        patient_name: data.patient?.name,
        emp_number: data.patient?.empNumber,
        relationship: data.patient?.relationship,
        book_no: data.book_no,
        sr_no: data.sr_no,
        attended_date: data.attended_date,
        advised_days: data.advised_days,
        from_date: data.from_date,
        to_date: data.to_date,
        disease: data.disease,
        fit_date: data.fit_date,
        working_as: data.working_as,
        department: data.department,
        extended_date: data.extended_date,
        created_at: data.CREATED_AT || data.createdAt,
      };
    });
    
    res.json(mapped);
  } catch (error) {
    console.error('Error fetching rest forms:', error);
    res.status(500).json({ error: 'Failed to fetch rest forms' });
  }
});

// Get a single Rest Form by ID
router.get('/:id', protect, async (req, res) => {
  try {
    const restForm = await RestForm.findByPk(req.params.id, {
      include: [{ model: Patient, as: 'patient' }]
    });

    if (!restForm) return res.status(404).json({ error: 'Rest form not found' });
    
    // Normalizing keys
    const data = restForm.toJSON();
    const result = {
      id: data.id || data.ID,
      patient_id: data.patient_id,
      patient_name: data.patient?.name,
      emp_number: data.patient?.empNumber,
      relationship: data.patient?.relationship,
      book_no: data.book_no,
      sr_no: data.sr_no,
      attended_date: data.attended_date,
      advised_days: data.advised_days,
      from_date: data.from_date,
      to_date: data.to_date,
      disease: data.disease,
      fit_date: data.fit_date,
      working_as: data.working_as,
      department: data.department,
      extended_date: data.extended_date,
      created_at: data.CREATED_AT || data.createdAt,
      doctor_id: data.doctor_id
    };

    res.json(result);
  } catch (error) {
    console.error('Error fetching rest form:', error);
    res.status(500).json({ error: 'Failed to fetch rest form' });
  }
});

// Update a Rest Form
router.put('/:id', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const restForm = await RestForm.findByPk(req.params.id);
    if (!restForm) return res.status(404).json({ error: 'Rest form not found' });

    await restForm.update(req.body);
    logAction(req.user.id, 'UPDATE_REST_FORM', 'RestForms', restForm.id, 'old', 'new', req.ip);
    
    res.json(restForm);
  } catch (error) {
    console.error('Error updating rest form:', error);
    res.status(500).json({ error: 'Failed to update rest form' });
  }
});

// Delete a Rest Form
router.delete('/:id', protect, checkPermission('consultation', 'delete'), async (req, res) => {
  try {
    const restForm = await RestForm.findByPk(req.params.id);
    if (!restForm) return res.status(404).json({ error: 'Rest form not found' });

    await restForm.destroy();
    logAction(req.user.id, 'DELETE_REST_FORM', 'RestForms', req.params.id, restForm.id, null, req.ip);
    
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Error deleting rest form:', error);
    res.status(500).json({ error: 'Failed to delete rest form' });
  }
});

module.exports = router;
