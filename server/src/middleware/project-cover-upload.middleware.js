/**
 * server/src/middleware/project-cover-upload.middleware.js
 *
 * Multer configuration for Project Cover photo uploads.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/project_covers');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    let ext = path.extname(file.originalname || '');
    if (!ext || ext.length === 0) {
      if (file.mimetype === 'image/png') ext = '.png';
      else if (file.mimetype === 'image/webp') ext = '.webp';
      else ext = '.jpg';
    }
    const projectId = req.params.id || req.params.projectId || 'project';
    const filename = `project_${projectId}_${Date.now()}${ext}`;
    cb(null, filename);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/octet-stream',
  ];
  if (!file.mimetype || file.mimetype.startsWith('image/') || allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format de fichier non supporté. Seules les images sont autorisées.'), false);
  }
};

const projectCoverUpload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
  },
  fileFilter: fileFilter,
});

module.exports = projectCoverUpload;
