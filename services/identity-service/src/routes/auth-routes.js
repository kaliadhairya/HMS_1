const express = require('express');

function createAuthRoutes(controller, { protect }) {
  const router = express.Router();
  router.post('/login', controller.login);
  router.get('/me', protect, controller.me);
  router.post('/change-password', protect, controller.changePassword);
  router.post('/forgot-password', controller.forgotPassword);
  router.post('/verify-otp', controller.verifyOtp);
  router.post('/reset-password', controller.resetPassword);
  router.all('/emergency-reset', (req, res) => res.status(404).json({ success: false, message: 'Route not found.' }));
  return router;
}

module.exports = { createAuthRoutes };
