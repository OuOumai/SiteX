/**
 * server/src/db.js
 *
 * PostgreSQL connection pool for SiteX.
 * Reads configuration from environment variables only — no hardcoded credentials.
 *
 * Startup sequence (called by server.js before Express listens):
 *   1. Create pg.Pool from env vars
 *   2. Run SELECT NOW() to verify connectivity
 *   3. Run SELECT current_database() to verify correct database
 *   4. Throw on any failure → server refuses to start with a clear error
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Ensure environment variables are loaded
const serverEnvPath = path.join(__dirname, '../.env');
const rootEnvPath   = path.join(__dirname, '../../.env');
if (!process.env.DB_PASSWORD) {
  if (fs.existsSync(serverEnvPath)) {
    require('dotenv').config({ path: serverEnvPath });
  } else if (fs.existsSync(rootEnvPath)) {
    require('dotenv').config({ path: rootEnvPath });
  } else {
    require('dotenv').config();
  }
}

const { Pool } = require('pg');

// ─── Pool Configuration ──────────────────────────────────────────────────────

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Connection pool sizing — conservative defaults for a mobile-backend API
  max:                10,
  idleTimeoutMillis:  30000,
  connectionTimeoutMillis: 5000,
});

// Surface pool-level errors (e.g. a client that idles and gets its connection dropped)
pool.on('error', (err) => {
  console.error('❌ Unexpected PostgreSQL pool error:', err.message);
});

// ─── Convenience Query Wrapper ───────────────────────────────────────────────

/**
 * Execute a parameterized SQL query.
 *
 * @param {string} text   - SQL string with $1, $2 … placeholders
 * @param {any[]}  params - Bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
function query(text, params) {
  return pool.query(text, params);
}

// ─── Startup Verification ────────────────────────────────────────────────────

/**
 * Verifies the PostgreSQL connection before the HTTP server starts.
 * Checks:
 *   1. Basic connectivity  — SELECT NOW()
 *   2. Correct database    — SELECT current_database()
 *
 * Throws an Error if either check fails so the process exits cleanly
 * instead of starting a partially functional API.
 */
async function verifyConnection() {
  const EXPECTED_DB = process.env.DB_NAME;

  // 1. Connectivity check
  const timeResult = await pool.query('SELECT NOW() AS server_time');
  console.log(`✅ PostgreSQL connected — server time: ${timeResult.rows[0].server_time}`);

  // 2. Database name check
  const dbResult = await pool.query('SELECT current_database() AS db_name');
  const actualDb = dbResult.rows[0].db_name;

  if (actualDb !== EXPECTED_DB) {
    throw new Error(
      `Wrong database connected: expected "${EXPECTED_DB}", got "${actualDb}". ` +
      `Check DB_NAME in server/.env.`
    );
  }

  console.log(`✅ Database verified: ${actualDb}`);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { pool, query, verifyConnection };
