/**
 * server/src/routes/user.routes.js
 *
 * User profile & role request route definitions.
 * Business logic lives in controllers/user.controller.js and controllers/roleRequest.controller.js.
 *
 * Mounted at: /users  (see server.js)
 * Endpoints:
 *   GET   /users/me              → userController.getMe
 *   PATCH /users/me              → userController.updateMe
 *   PATCH /users/me/password     → userController.changePassword
 *   POST  /users/me/photo        → userController.uploadPhoto
 *   POST  /users/me/role-request → roleRequestController.createRoleRequest
 *   GET   /users/me/role-request → roleRequestController.getRoleRequest
 */

'use strict';

const express               = require('express');
const userController        = require('../controllers/user.controller');
const roleRequestController = require('../controllers/roleRequest.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const upload                = require('../middleware/upload.middleware');

const router = express.Router();

// All routes require valid Bearer JWT authentication
router.get('/me',                  authenticateToken, userController.getMe);
router.patch('/me',                authenticateToken, userController.updateMe);
router.patch('/me/password',       authenticateToken, userController.changePassword);
router.post('/me/photo',           authenticateToken, upload.single('photo'), userController.uploadPhoto);
router.delete('/me/photo',         authenticateToken, userController.deletePhoto);
router.post('/me/role-request',    authenticateToken, roleRequestController.createRoleRequest);
router.get('/me/role-request',     authenticateToken, roleRequestController.getRoleRequest);

module.exports = router;
