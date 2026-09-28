/**
 * server/src/routes/project.routes.js
 *
 * Project route definitions.
 * Mounted at: /projects  (see server.js)
 *
 * Endpoints:
 *   GET    /projects                → projectController.getAllProjects
 *   GET    /projects/:id            → projectController.getProjectDetails
 *   POST   /projects                → projectController.createProject
 *   POST   /projects/bulk-delete    → projectController.bulkDeleteProjects (bulk, safe with body)
 *   DELETE /projects/:id            → projectController.deleteProject
 */

'use strict';

const express               = require('express');
const projectController     = require('../controllers/project.controller');
const chantierController    = require('../controllers/chantier.controller');
const { authenticateToken } = require('../middleware/auth.middleware');
const { requireResponsableOrAdmin } = require('../middleware/responsable.middleware');

const projectCoverUpload    = require('../middleware/project-cover-upload.middleware');

const router = express.Router();

// Requires valid Bearer JWT authentication
router.get('/', authenticateToken, projectController.getAllProjects);
router.get('/:id', authenticateToken, projectController.getProjectDetails);
router.post('/', authenticateToken, requireResponsableOrAdmin, projectController.createProject);
router.post('/:projectId/chantiers', authenticateToken, requireResponsableOrAdmin, chantierController.createChantier);
router.post('/:projectId/chantiers/init', authenticateToken, requireResponsableOrAdmin, projectController.initializeProjectChantiers);
// Cover image upload / reset
router.post('/:id/cover', authenticateToken, requireResponsableOrAdmin, projectCoverUpload.single('cover'), projectController.updateProjectCover);
router.delete('/:id/cover', authenticateToken, requireResponsableOrAdmin, projectController.resetProjectCover);
// ⚠️  Use POST for bulk-delete so Express reliably parses the JSON body (DELETE+body is unreliable)
router.post('/bulk-delete', authenticateToken, requireResponsableOrAdmin, projectController.bulkDeleteProjects);
router.delete('/:id', authenticateToken, requireResponsableOrAdmin, projectController.deleteProject);

module.exports = router;
