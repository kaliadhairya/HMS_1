const express = require('express');

function createSecurityCompatibilityRoutes(controller, { protect, restrictTo }) {
  const router = express.Router();
  router.post('/sessions/:userId/force-logout', protect, restrictTo('super_admin'), controller.forceLogout);
  router.post('/users/:id/unlock', protect, restrictTo('super_admin'), controller.unlock);
  return router;
}

function createAdminCompatibilityRoutes(controller, { protect, restrictTo }) {
  const router = express.Router();
  router.get('/staff', protect, restrictTo('admin', 'super_admin'), controller.listStaff);
  router.put('/staff/:id', protect, restrictTo('admin', 'super_admin'), controller.updateStaff);
  return router;
}

module.exports = { createSecurityCompatibilityRoutes, createAdminCompatibilityRoutes };
