/**
 * server/src/middleware/observation-upload.middleware.js
 *
 * Multer configuration for field observation photos.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure the directory exists
const uploadDir = path.join(__dirname, '../../uploads/observations');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    let ext = path.extname(file.originalname || '');
    if (!ext || ext.length === 0) {
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else if (file.mimetype === 'image/gif') ext = '.gif';
      else ext = '.jpg';
    }
    // Name format: obs_agentId_timestamp_random.ext
    const rand = Math.floor(Math.random() * 10000);
    const userId = req.user ? req.user.id : 'anon';
    const filename = `obs_${userId}_${Date.now()}_${rand}${ext}`;
    cb(null, filename);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/octet-stream',
  ];
  if (!file.mimetype || file.mimetype.startsWith('image/') || allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format de fichier non supporté. Seules les images sont autorisées.'), false);
  }
};

const observationUpload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
    files: 10, // Max 10 photos per observation
  },
  fileFilter: fileFilter,
});

module.exports = observationUpload;
