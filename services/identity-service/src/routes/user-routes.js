const express = require('express');

function createUserRoutes(controller, { protect, restrictTo }) {
  const router = express.Router();
  router.use(protect, restrictTo('admin', 'super_admin'));

  router.get('/permissions', controller.listPermissions);
  router.put('/permissions', restrictTo('super_admin'), controller.updatePermissions);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.put('/:id/password', controller.password);
  router.patch('/:id/toggle-active', controller.toggleActive);
  router.get('/:id/login-history', controller.history);
  router.put('/:id', controller.update);
  router.delete('/:id', controller.remove);
  return router;
}

module.exports = { createUserRoutes };
