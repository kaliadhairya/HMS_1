const express = require('express');

function createInternalRoutes({ authController, auditService, userRepository, requireInternal }) {
  const router = express.Router();
  router.use(requireInternal);
  router.post('/auth/validate', authController.validate);
  router.get('/users', async (req, res, next) => { try { return res.json({ success: true, data: await userRepository.list(req.query.role || null) }); } catch (error) { return next(error); } });
  router.get('/users/:id', async (req, res, next) => { try { const user = await userRepository.findById(Number(req.params.id)); if (!user) return res.status(404).json({ success: false, message: 'User not found.' }); return res.json({ success: true, data: user }); } catch (error) { return next(error); } });
  router.post('/audit', async (req, res, next) => {
    try {
      if (!req.body.action) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'action is required.' } });
      const result = await auditService.record({
        ...req.body,
        idempotencyKey: req.headers['idempotency-key'] || req.body.idempotencyKey,
      });
      return res.status(result.created ? 201 : 200).json({ success: true, created: result.created, id: result.record.id });
    } catch (error) { return next(error); }
  });
  return router;
}

module.exports = { createInternalRoutes };
