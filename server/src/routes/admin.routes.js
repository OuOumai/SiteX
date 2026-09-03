/**
 * server/src/routes/admin.routes.js
 *
 * Administrator routes for SiteX.
 * Protected with authenticateToken + requireAdmin middleware.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticateToken, requireAdmin } = require('../middleware/auth.middleware');
const adminController = require('../controllers/admin.controller');

// Enforce JWT Auth and Admin authorization on all /admin endpoints
router.use(authenticateToken, requireAdmin);

// Role requests
router.get('/demandes', adminController.getRoleRequests);
router.get('/demandes/:id', adminController.getRoleRequestById);

// Accept role request (supports POST and PATCH)
router.post('/demandes/:id/accept', adminController.acceptRoleRequest);
router.patch('/demandes/:id/accept', adminController.acceptRoleRequest);

// Reject role request (supports POST and PATCH)
router.post('/demandes/:id/reject', adminController.rejectRoleRequest);
router.patch('/demandes/:id/reject', adminController.rejectRoleRequest);

// Admin dashboard statistics
router.get('/stats', adminController.getAdminStats);

module.exports = router;
