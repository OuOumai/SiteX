/**
 * server/src/routes/dashboard.routes.js
 *
 * Dashboard route definitions.
 * Mounted at: /dashboard  (see server.js)
 *
 * Endpoints:
 *   GET /dashboard/project → dashboardController.getProjectOverview
 */

'use strict';

const express             = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Requires valid Bearer JWT authentication
router.get('/project', authenticateToken, dashboardController.getProjectOverview);

module.exports = router;
