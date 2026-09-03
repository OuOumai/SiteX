/**
 * server/src/middleware/responsable.middleware.js
 *
 * Authorization middleware for Responsable (and Admin) operations.
 * Verifies authenticated user has role 'Responsable' (role_id = 2) or 'Administrateur' (role_id = 1).
 * Returns 403 Forbidden for 'Client' or 'AgentTerrain'.
 */

'use strict';

const db = require('../db');

async function requireResponsableOrAdmin(req, res, next) {
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

    // Role 1 = Administrateur, Role 2 = Responsable
    if (role_nom !== 'Responsable' && role_nom !== 'Administrateur' && role_id !== 2 && role_id !== 1) {
      return res.status(403).json({
        message: 'Accès interdit : privilèges Responsable de projet requis.',
      });
    }

    req.user.role_id = role_id;
    req.user.role_nom = role_nom;
    next();
  } catch (error) {
    console.error('❌ requireResponsableOrAdmin middleware error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la vérification des permissions.' });
  }
}

module.exports = { requireResponsableOrAdmin };
