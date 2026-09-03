'use strict';

const express = require('express');
const { authenticateToken } = require('../middleware/auth.middleware');
const controller = require('../controllers/notification.controller');
const router = express.Router();

router.get('/', authenticateToken, controller.listNotifications);
router.patch('/read-all', authenticateToken, controller.markAllNotificationsRead);
router.patch('/:id/read', authenticateToken, controller.markNotificationRead);

module.exports = router;
