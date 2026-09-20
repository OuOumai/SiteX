/**
 * server/src/routes/agent.routes.js
 *
 * Agent de Terrain route definitions.
 * Mounted at: /agent
 */

'use strict';

const express               = require('express');
const agentController       = require('../controllers/agent.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requireAgentOrAdmin } = require('../middleware/agent.middleware');
const observationUpload     = require('../middleware/observation-upload.middleware');

const router = express.Router();

// A.T. Dashboard & "Mes affectations"
router.get('/dashboard',                            authenticateToken, requireAgentOrAdmin, agentController.getAgentDashboard);
router.get('/troncon/:id',                          authenticateToken, requireAgentOrAdmin, agentController.getAgentTronconDetails);
router.post('/troncon/:id/calculate-projection',    authenticateToken, requireAgentOrAdmin, agentController.calculateProjection);
router.post('/troncon/:id/observations',            authenticateToken, requireAgentOrAdmin, observationUpload.array('photos', 10), agentController.createObservation);
router.get('/troncon/:id/observations',             authenticateToken, requireAgentOrAdmin, agentController.getObservationHistory);

// Operational Justifications & Absences
router.get('/justifications/:id',                  authenticateToken, agentController.getExplanationDetails);
router.post('/justifications/:id/repondre',         authenticateToken, requireAgentOrAdmin, agentController.respondExplanation);
router.get('/absences',                             authenticateToken, agentController.getAgentAbsences);
router.post('/absences',                            authenticateToken, requireAgentOrAdmin, agentController.createAgentAbsence);

module.exports = router;

