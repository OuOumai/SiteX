/**
 * server/src/middleware/agent.middleware.js
 *
 * Authorization middleware for Agent de Terrain (and Admin) operations.
 * Verifies authenticated user has role 'AgentTerrain' (role_id = 3) or 'Administrateur' (role_id = 1).
 * Returns 403 Forbidden for unauthorized roles.
 */

'use strict';

const db = require('../db');

async function requireAgentOrAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Accès non autorisé. Authentification requise.' });
    }

    const roleResult = await db.query(
      `SELECT u.actif, u.role_id, r.nom AS role_nom
       FROM public.utilisateur u
       JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (roleResult.rows.length === 0 || !roleResult.rows[0].actif) {
      return res.status(403).json({ message: 'Compte inactif ou introuvable.' });
    }

    const { role_id, role_nom } = roleResult.rows[0];

    // Role 1 = Administrateur, Role 3 = AgentTerrain
    if (role_nom !== 'AgentTerrain' && role_nom !== 'Administrateur' && role_id !== 3 && role_id !== 1) {
      return res.status(403).json({
        message: 'Accès interdit : privilèges Agent de Terrain requis.',
      });
    }

    req.user.role_id = role_id;
    req.user.role_nom = role_nom;
    next();
  } catch (error) {
    console.error('❌ requireAgentOrAdmin middleware error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la vérification des permissions.' });
  }
}

module.exports = { requireAgentOrAdmin };
