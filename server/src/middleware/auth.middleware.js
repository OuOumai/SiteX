/**
 * server/src/middleware/auth.middleware.js
 *
 * JWT authentication middleware.
 * JWT_SECRET is read from process.env and is NEVER exported — it stays server-side.
 * If JWT_SECRET is not configured, this module throws immediately at load time.
 */

'use strict';

const jwt = require('jsonwebtoken');

// ─── Fail-fast: require JWT_SECRET to be explicitly set ──────────────────────
if (!process.env.JWT_SECRET) {
  throw new Error(
    'FATAL: JWT_SECRET environment variable is not set. ' +
    'Configure it in server/.env before starting the server.'
  );
}

const JWT_SECRET = process.env.JWT_SECRET;
const db = require('../db');

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that validates a Bearer JWT token.
 * On success, attaches the decoded payload to req.user and calls next().
 * On failure, returns 401 (missing token or invalid/expired token).
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      message: 'Accès non autorisé. Token manquant.',
      code: 'TOKEN_MISSING',
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          message: 'Token invalide ou expiré.',
          error: 'jwt expired',
          code: 'TOKEN_EXPIRED',
          expiredAt: err.expiredAt,
        });
      }
      return res.status(401).json({
        message: 'Token invalide ou expiré.',
        error: err.message,
        code: 'TOKEN_INVALID',
      });
    }
    req.user = user;
    next();
  });
}

/**
 * Express middleware that verifies the authenticated user has the 'Administrateur' role.
 * Resolves the role dynamically from PostgreSQL to prevent stale JWT bypasses.
 */
async function requireAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Accès non autorisé.' });
    }

    const roleResult = await db.query(
      `SELECT u.actif, r.nom AS role_nom
       FROM public.utilisateur u
       JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (roleResult.rows.length === 0 || !roleResult.rows[0].actif) {
      return res.status(403).json({ message: 'Compte inactif ou introuvable.' });
    }

    const userRoleNom = roleResult.rows[0].role_nom;

    if (userRoleNom !== 'Administrateur') {
      return res.status(403).json({
        message: 'Accès interdit : privilèges Administrateur requis.',
      });
    }

    req.user.role_nom = userRoleNom;
    next();
  } catch (error) {
    console.error('❌ requireAdmin middleware error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la vérification des permissions.' });
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { authenticateToken, requireAdmin };
