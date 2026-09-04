/**
 * server/src/routes/responsable.routes.js
 *
 * Responsable route definitions.
 * Mounted at: /responsable
 */

'use strict';

const express               = require('express');
const responsableController = require('../controllers/responsable.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requireResponsableOrAdmin } = require('../middleware/responsable.middleware');

const router = express.Router();

router.get('/dashboard',                  authenticateToken, requireResponsableOrAdmin, responsableController.getDashboardData);
router.get('/equipe-terrain',             authenticateToken, requireResponsableOrAdmin, responsableController.getEquipeTerrain);
router.get('/hierarchy-tree',             authenticateToken, requireResponsableOrAdmin, responsableController.getHierarchyTree);
router.post('/affectations',              authenticateToken, requireResponsableOrAdmin, responsableController.createAffectation);
router.delete('/affectations/:affectationId', authenticateToken, requireResponsableOrAdmin, responsableController.removeAffectation);
router.get('/agents-terrain',             authenticateToken, requireResponsableOrAdmin, responsableController.getAvailableAgents);
router.get('/troncon/:id',                authenticateToken, requireResponsableOrAdmin, responsableController.getTronconDetails);
router.patch('/troncon/:id',              authenticateToken, requireResponsableOrAdmin, responsableController.renameTroncon);
router.delete('/troncon/:id',             authenticateToken, requireResponsableOrAdmin, responsableController.deleteTroncon);
router.patch('/chantier/:id',             authenticateToken, requireResponsableOrAdmin, responsableController.renameChantier);
router.delete('/chantier/:id',            authenticateToken, requireResponsableOrAdmin, responsableController.deleteChantier);
router.get('/troncon/:id/agents',         authenticateToken, requireResponsableOrAdmin, responsableController.getTronconAssignments);
router.post('/troncon/:id/agents',        authenticateToken, requireResponsableOrAdmin, responsableController.assignAgentToTroncon);
router.delete('/troncon/:id/agents/:agentId', authenticateToken, requireResponsableOrAdmin, responsableController.removeAgentFromTroncon);

module.exports = router;
