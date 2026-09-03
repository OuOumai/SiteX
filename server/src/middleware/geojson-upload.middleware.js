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
  const allowedExts = ['.geojson', '.json'];
  const ext = path.extname(file.originalname || '').toLowerCase();
  
  if (allowedExts.includes(ext) || file.mimetype.includes('json') || file.mimetype === 'application/octet-stream') {
    cb(null, true);
  } else {
    cb(new Error('Format de fichier non supporté. Veuillez sélectionner un fichier .geojson ou .json.'), false);
  }
};

const geojsonUpload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: fileFilter,
});

module.exports = geojsonUpload;
