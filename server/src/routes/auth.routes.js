/**
 * server/src/routes/auth.routes.js
 *
 * Authentication route definitions only.
 * Business logic lives in controllers/auth.controller.js.
 *
 * Mounted at: /auth  (see server.js)
 *
 * Endpoints:
 *   POST /auth/register  → authController.register
 *   POST /auth/login     → authController.login
 *   GET  /auth/me        → authController.getMe  (requires JWT)
 */

'use strict';

const express        = require('express');
const authController = require('../controllers/auth.controller');
const { authenticateToken } = require('../middleware/auth.middleware');

const router = express.Router();

// Public routes
router.post('/register', authController.register);
router.post('/login',    authController.login);

// Protected route — requires a valid Bearer JWT
router.get('/me', authenticateToken, authController.getMe);

module.exports = router;
