/**
 * server/src/controllers/roleRequest.controller.js
 *
 * Role Request workflow business logic for SiteX.
 * Communicates with PostgreSQL via db.js wrapper.
 */

'use strict';

const db = require('../db');

// Allowed requested roles:
// 2 = Responsable de Projet
// 3 = Agent de Terrain
// 4 = Client
// Role 1 (Administrateur) is STRICTLY PROHIBITED from public role requests.
const ALLOWED_REQUESTED_ROLE_IDS = [2, 3, 4];

/**
 * POST /users/me/role-request
 * Submits or updates a pending role request.
 */
async function createRoleRequest(req, res) {
  try {
    const { role_id } = req.body;
    const requestedRoleId = Number(role_id);

    // 1. Guard against asking for Administrateur (ID = 1)
    if (requestedRoleId === 1) {
      return res.status(400).json({
        message: 'Le rôle Administrateur ne peut pas être demandé.',
      });
    }

    // 2. Validate allowed role IDs
    if (!ALLOWED_REQUESTED_ROLE_IDS.includes(requestedRoleId)) {
      return res.status(400).json({
        message: 'Rôle demandé invalide. Choisissez parmi Responsable de Projet, Agent de Terrain, ou Client.',
      });
    }

    // 3. Check if user already has a pending request
    const existingReq = await db.query(
      `SELECT id, statut FROM public.demande_role
        WHERE utilisateur_id = $1 AND statut = 'PENDING'
        ORDER BY date_demande DESC LIMIT 1`,
      [req.user.id]
    );

    let result;
    if (existingReq.rows.length > 0) {
      // Update existing pending request
      result = await db.query(
        `UPDATE public.demande_role
            SET requested_role_id = $1, date_demande = NOW()
          WHERE id = $2
          RETURNING *`,
        [requestedRoleId, existingReq.rows[0].id]
      );
    } else {
      // Insert new pending request
      result = await db.query(
        `INSERT INTO public.demande_role (utilisateur_id, requested_role_id, statut)
         VALUES ($1, $2, 'PENDING')
         RETURNING *`,
        [req.user.id, requestedRoleId]
      );
    }

    // Fetch full request details with role metadata
    const fullRequestResult = await db.query(
      `SELECT dr.*, r.nom AS role_nom, r.description AS role_description
         FROM public.demande_role dr
         JOIN public.role r ON dr.requested_role_id = r.id
        WHERE dr.id = $1`,
      [result.rows[0].id]
    );

    return res.status(200).json({
      message: 'Demande de profil soumise avec succès.',
      role_request: fullRequestResult.rows[0],
    });
  } catch (error) {
    console.error('❌ CreateRoleRequest error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la soumission de la demande de profil.',
    });
  }
}

/**
 * GET /users/me/role-request
 * Retrieves the authenticated user's active role request status.
 */
async function getRoleRequest(req, res) {
  try {
    const result = await db.query(
      `SELECT dr.*, r.nom AS role_nom, r.description AS role_description
         FROM public.demande_role dr
         JOIN public.role r ON dr.requested_role_id = r.id
        WHERE dr.utilisateur_id = $1
        ORDER BY dr.date_demande DESC
        LIMIT 1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({ role_request: null });
    }

    return res.status(200).json({ role_request: result.rows[0] });
  } catch (error) {
    console.error('❌ GetRoleRequest error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération de la demande de profil.',
    });
  }
}

module.exports = {
  createRoleRequest,
  getRoleRequest,
};
