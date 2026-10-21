/**
 * server/src/server.js
 *
 * SiteX Express API entry point.
 *
 * Startup sequence:
 *   1. Load environment variables (dotenv)
 *   2. Verify PostgreSQL connectivity — fail fast if DB is unreachable
 *   3. Start Express HTTP server
 */

'use strict';

require('dotenv').config();

const path       = require('path');
const fs         = require('fs');
const express    = require('express');
const cors       = require('cors');
const authRoutes      = require('./routes/auth.routes');
const userRoutes      = require('./routes/user.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const projectRoutes   = require('./routes/project.routes');
const chantierRoutes  = require('./routes/chantier.routes');
const responsableRoutes = require('./routes/responsable.routes');
const adminRoutes       = require('./routes/admin.routes');
const agentRoutes       = require('./routes/agent.routes');
const notificationRoutes = require('./routes/notification.routes');
const db                = require('./db');

const app  = express();
const PORT = process.env.PORT || 5000;

// Ensure uploads directories exist
const avatarsDir = path.join(__dirname, '../uploads/avatars');
const geojsonDir = path.join(__dirname, '../uploads/geojson');
const obsDir     = path.join(__dirname, '../uploads/observations');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });
if (!fs.existsSync(geojsonDir)) fs.mkdirSync(geojsonDir, { recursive: true });
if (!fs.existsSync(obsDir))     fs.mkdirSync(obsDir, { recursive: true });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, express.static(path.join(__dirname, '../uploads')));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth',        authRoutes);
app.use('/users',       userRoutes);
app.use('/dashboard',   dashboardRoutes);
app.use('/projects',    projectRoutes);
app.use('/chantiers',   chantierRoutes);
app.use('/responsable', responsableRoutes);
app.use('/admin',       adminRoutes);
app.use('/agent',       agentRoutes);
app.use('/notifications', notificationRoutes);


// Health check — useful for deployment/monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SiteX Auth API',
    timestamp: new Date().toISOString(),
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    // Step 1: Verify database before accepting any HTTP traffic
    await db.verifyConnection();

    // Step 2: Start listening only after DB is confirmed healthy
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 SiteX API running on http://0.0.0.0:${PORT}`);
      console.log(`   LAN access: http://192.168.1.155:${PORT}`);
      console.log(`   POST /auth/register`);
      console.log(`   POST /auth/login`);
      console.log(`   GET  /auth/me`);
      console.log(`   PATCH /users/me`);
      console.log(`   GET  /health`);
    });
  } catch (err) {
    console.error('❌ Server failed to start:', err.message);
    process.exit(1);
  }
}

start();
