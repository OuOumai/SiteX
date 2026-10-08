/**
 * server/src/middleware/geojson-upload.middleware.js
 *
 * Multer configuration for GeoJSON / spatial file uploads.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/geojson');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '') || '.geojson';
    const cleanName = path.basename(file.originalname || 'alignment', ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `geojson_${Date.now()}_${cleanName}${ext}`;
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExts = [
    '.geojson', '.json', '.kml',
    '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp'
  ];
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimetype = (file.mimetype || '').toLowerCase();
  
  const isKmlMime =
    mimetype.includes('kml') ||
    mimetype.includes('xml') ||
    mimetype === 'application/vnd.google-earth.kml+xml';
  const isImageMime = mimetype.startsWith('image/');

  if (
    allowedExts.includes(ext) ||
    mimetype.includes('json') ||
    isKmlMime ||
    isImageMime ||
    mimetype === 'application/octet-stream'
  ) {
    cb(null, true);
  } else {
    cb(new Error('Format de fichier non supporté. Veuillez sélectionner un fichier spatial (.geojson, .json, .kml) ou une image compagnon (.png, .jpg).'), false);
  }
};

const geojsonUpload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: fileFilter,
});

/**
 * Middleware handling both single spatial file uploads and multi-file uploads
 * containing a primary spatial file (.kml, .geojson) alongside companion assets (e.g. .png images).
 */
const spatialAndAssets = (req, res, next) => {
  geojsonUpload.any()(req, res, (err) => {
    if (err) return next(err);
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      const spatialFile = req.files.find((f) => {
        const ext = path.extname(f.originalname || '').toLowerCase();
        return ['.kml', '.geojson', '.json'].includes(ext);
      }) || req.files[0];

      req.file = spatialFile;
      req.companionFiles = req.files.filter((f) => f !== spatialFile);
    } else {
      req.companionFiles = [];
    }
    next();
  });
};

geojsonUpload.spatialAndAssets = spatialAndAssets;

module.exports = geojsonUpload;
