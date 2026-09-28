/**
 * server/src/routes/chantier.routes.js
 *
 * Chantier & GIS Setup route definitions.
 * Mounted at: /chantiers
 */

'use strict';

const express                  = require('express');
const chantierController       = require('../controllers/chantier.controller');
const { authenticateToken }    = require('../middleware/auth.middleware');
const { requireResponsableOrAdmin } = require('../middleware/responsable.middleware');
const geojsonUpload            = require('../middleware/geojson-upload.middleware');

const router = express.Router();

// General Chantier Details & Operational Monitoring
router.get('/:id', authenticateToken, chantierController.getChantierDetails);
router.get('/:id/avancement', authenticateToken, requireResponsableOrAdmin, chantierController.getChantierAvancementStats);
router.get('/:id/journal', authenticateToken, requireResponsableOrAdmin, chantierController.getChantierJournal);
router.get('/:id/timeline', authenticateToken, chantierController.getChantierTimeline);
router.post('/:id/justifications/demander', authenticateToken, requireResponsableOrAdmin, chantierController.requestExplanation);

// Chantier Creation (Responsable / Admin)
router.post('/', authenticateToken, requireResponsableOrAdmin, chantierController.createChantier);
router.put('/:id/configuration', authenticateToken, requireResponsableOrAdmin, chantierController.updateChantierConfiguration);
router.put('/:id/aoi', authenticateToken, requireResponsableOrAdmin, chantierController.saveChantierAoi);
router.post('/:id/aoi/check-conflict', authenticateToken, requireResponsableOrAdmin, chantierController.checkChantierAoiConflict);
router.get('/:chantierId/sibling-aois', authenticateToken, requireResponsableOrAdmin, chantierController.getSiblingChantierAois);

// GIS Coordinate Reference System (CRS) Detection
router.post(
  '/:chantierId/crs/detect',
  authenticateToken,
  requireResponsableOrAdmin,
  geojsonUpload.single('geojson'),
  chantierController.detectSourceCrs
);

// GIS Reference Alignment
router.get('/:chantierId/reference-alignment', authenticateToken, chantierController.getReferenceAlignment);
router.put(
  '/:chantierId/reference-alignment/direction',
  authenticateToken,
  requireResponsableOrAdmin,
  chantierController.toggleAlignmentDirection
);
router.post(
  '/:chantierId/reference-alignment/analyze',
  authenticateToken,
  requireResponsableOrAdmin,
  geojsonUpload.single('geojson'),
  chantierController.analyzeGeoJSONSource
);
router.post(
  '/:chantierId/reference-alignment',
  authenticateToken,
  requireResponsableOrAdmin,
  geojsonUpload.single('geojson'),
  chantierController.uploadReferenceAlignment
);

// Tronçon Generation Preview & Persistence
router.post(
  '/:chantierId/troncons/generate',
  authenticateToken,
  requireResponsableOrAdmin,
  chantierController.generateTronconsPreview
);
router.post(
  '/:chantierId/troncons/recalculate-chainage',
  authenticateToken,
  requireResponsableOrAdmin,
  chantierController.recalculateTronconsChainage
);
router.post(
  '/:chantierId/troncons',
  authenticateToken,
  requireResponsableOrAdmin,
  chantierController.saveTroncons
);
router.get('/:chantierId/troncons', authenticateToken, chantierController.getChantierTroncons);

module.exports = router;
