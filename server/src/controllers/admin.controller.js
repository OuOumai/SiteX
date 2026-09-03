/**
 * server/src/controllers/admin.controller.js
 *
 * Administrator controllers for SiteX.
 * Protected by JWT authentication + Administrateur authorization checks.
 */

'use strict';

const db = require('../db');

/**
 * GET /admin/demandes
 * Retrieves all role verification requests with applicant details and role metadata.
 */
async function getRoleRequests(req, res) {
  try {
    const { statut } = req.query;

    let queryText = `
      SELECT 
        dr.id,
        dr.utilisateur_id,
        dr.requested_role_id,
        dr.statut,
        dr.date_demande,
        dr.date_traitement,
        dr.traite_par,
        u.nom AS applicant_nom,
        u.prenom AS applicant_prenom,
        u.email AS applicant_email,
        u.photo_url AS applicant_photo,
        u.telephone AS applicant_telephone,
        u.entreprise AS applicant_entreprise,
        u.poste AS applicant_poste,
        u.ville AS applicant_ville,
        u.date_creation AS applicant_date_creation,
        r_curr.nom AS current_role_nom,
        r_req.nom AS requested_role_nom,
        r_req.description AS requested_role_description,
        admin_u.nom AS admin_nom,
        admin_u.prenom AS admin_prenom
      FROM public.demande_role dr
      JOIN public.utilisateur u ON dr.utilisateur_id = u.id
      JOIN public.role r_req ON dr.requested_role_id = r_req.id
      LEFT JOIN public.role r_curr ON u.role_id = r_curr.id
      LEFT JOIN public.utilisateur admin_u ON dr.traite_par = admin_u.id
    `;

    const params = [];
    if (statut) {
      queryText += ` WHERE dr.statut = $1`;
      params.push(statut.toUpperCase());
    }

    queryText += ` ORDER BY dr.date_demande DESC`;

    const result = await db.query(queryText, params);

    return res.status(200).json({
      demandes: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    console.error('❌ Admin getRoleRequests error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la récupération des demandes.' });
  }
}

/**
 * GET /admin/demandes/:id
 * Retrieves detail for a single role request.
 */
async function getRoleRequestById(req, res) {
  try {
    const requestId = Number(req.params.id);

    const queryText = `
      SELECT 
        dr.id,
        dr.utilisateur_id,
        dr.requested_role_id,
        dr.statut,
        dr.date_demande,
        dr.date_traitement,
        dr.traite_par,
        u.nom AS applicant_nom,
        u.prenom AS applicant_prenom,
        u.email AS applicant_email,
        u.photo_url AS applicant_photo,
        u.telephone AS applicant_telephone,
        u.entreprise AS applicant_entreprise,
        u.poste AS applicant_poste,
        u.ville AS applicant_ville,
        u.adresse AS applicant_adresse,
        u.date_creation AS applicant_date_creation,
        r_curr.nom AS current_role_nom,
        r_req.nom AS requested_role_nom,
        r_req.description AS requested_role_description,
        admin_u.nom AS admin_nom,
        admin_u.prenom AS admin_prenom
      FROM public.demande_role dr
      JOIN public.utilisateur u ON dr.utilisateur_id = u.id
      JOIN public.role r_req ON dr.requested_role_id = r_req.id
      LEFT JOIN public.role r_curr ON u.role_id = r_curr.id
      LEFT JOIN public.utilisateur admin_u ON dr.traite_par = admin_u.id
      WHERE dr.id = $1
    `;

    const result = await db.query(queryText, [requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Demande de rôle non trouvée.' });
    }

    return res.status(200).json({ demande: result.rows[0] });
  } catch (error) {
    console.error('❌ Admin getRoleRequestById error:', error.message);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

/**
 * POST /admin/demandes/:id/accept
 * PATCH /admin/demandes/:id/accept
 *
 * Transactionally accepts a pending role request:
 * 1. Checks request exists and is PENDING.
 * 2. Checks target role is a valid operational role (not Administrateur).
 * 3. Assigns role to user (utilisateur.role_id = requested_role_id).
 * 4. Updates demande_role (statut = 'APPROVED', date_traitement = NOW(), traite_par = admin.id).
 * 5. Creates user notification.
 */
async function acceptRoleRequest(req, res) {
  const requestId = Number(req.params.id);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock and verify request exists
    const reqResult = await client.query(
      `SELECT * FROM public.demande_role WHERE id = $1 FOR UPDATE`,
      [requestId]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demande de rôle introuvable.' });
    }

    const roleRequest = reqResult.rows[0];

    if (roleRequest.statut !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Cette demande a déjà été traitée (statut actuel : ${roleRequest.statut}).`,
      });
    }

    // 2. Validate requested role is NOT Administrateur
    const targetRoleRes = await client.query(
      `SELECT id, nom FROM public.role WHERE id = $1`,
      [roleRequest.requested_role_id]
    );

    if (targetRoleRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Rôle cible inexistant dans le système.' });
    }

    const targetRole = targetRoleRes.rows[0];

    if (targetRole.nom === 'Administrateur') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        message: 'Le rôle Administrateur ne peut pas être attribué via une demande utilisateur.',
      });
    }

    // 3. Assign role to user
    await client.query(
      `UPDATE public.utilisateur SET role_id = $1 WHERE id = $2`,
      [targetRole.id, roleRequest.utilisateur_id]
    );

    // 4. Update request status to APPROVED
    const updateResult = await client.query(
      `UPDATE public.demande_role
          SET statut = 'APPROVED',
              date_traitement = NOW(),
              traite_par = $1
        WHERE id = $2
        RETURNING *`,
      [req.user.id, requestId]
    );

    // 5. Create in-app notification
    try {
      await client.query(
        `INSERT INTO public.notification (utilisateur_id, message, type, date_envoi, lu)
         VALUES ($1, $2, 'ROLE_APPROVED', NOW(), false)`,
        [
          roleRequest.utilisateur_id,
          `Félicitations ! Votre demande pour le rôle "${targetRole.nom}" a été validée par l'administrateur.`,
        ]
      );
    } catch (notifErr) {
      console.warn('⚠️ Could not insert notification:', notifErr.message);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: `Demande acceptée. Le rôle "${targetRole.nom}" a été assigné avec succès.`,
      demande_role: updateResult.rows[0],
      assigned_role: targetRole.nom,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Admin acceptRoleRequest error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la validation de la demande.' });
  } finally {
    client.release();
  }
}

/**
 * POST /admin/demandes/:id/reject
 * PATCH /admin/demandes/:id/reject
 *
 * Transactionally rejects a pending role request:
 * 1. Checks request exists and is PENDING.
 * 2. Updates demande_role (statut = 'REJECTED', date_traitement = NOW(), traite_par = admin.id).
 * 3. Creates user notification.
 */
async function rejectRoleRequest(req, res) {
  const requestId = Number(req.params.id);
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock and verify request exists
    const reqResult = await client.query(
      `SELECT dr.*, r.nom AS requested_role_nom
       FROM public.demande_role dr
       JOIN public.role r ON dr.requested_role_id = r.id
       WHERE dr.id = $1 FOR UPDATE`,
      [requestId]
    );

    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Demande de rôle introuvable.' });
    }

    const roleRequest = reqResult.rows[0];

    if (roleRequest.statut !== 'PENDING') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Cette demande a déjà été traitée (statut actuel : ${roleRequest.statut}).`,
      });
    }

    // 2. Update request status to REJECTED
    const updateResult = await client.query(
      `UPDATE public.demande_role
          SET statut = 'REJECTED',
              date_traitement = NOW(),
              traite_par = $1
        WHERE id = $2
        RETURNING *`,
      [req.user.id, requestId]
    );

    // 3. Create in-app notification
    try {
      await client.query(
        `INSERT INTO public.notification (utilisateur_id, message, type, date_envoi, lu)
         VALUES ($1, $2, 'ROLE_REJECTED', NOW(), false)`,
        [
          roleRequest.utilisateur_id,
          `Votre demande pour le rôle "${roleRequest.requested_role_nom}" a été refusée par l'administrateur.`,
        ]
      );
    } catch (notifErr) {
      console.warn('⚠️ Could not insert notification:', notifErr.message);
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Demande de rôle refusée.',
      demande_role: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Admin rejectRoleRequest error:', error.message);
    return res.status(500).json({ message: 'Erreur lors du rejet de la demande.' });
  } finally {
    client.release();
  }
}

/**
 * GET /admin/stats
 * Overview dashboard metrics for the administrator.
 */
async function getAdminStats(req, res) {
  try {
    const pendingRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM public.demande_role WHERE statut = 'PENDING'`
    );
    const usersRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM public.utilisateur WHERE actif = true`
    );
    const rolesRes = await db.query(
      `SELECT r.id, r.nom, COUNT(u.id)::int AS user_count
       FROM public.role r
       LEFT JOIN public.utilisateur u ON u.role_id = r.id
       GROUP BY r.id, r.nom
       ORDER BY r.id`
    );

    return res.status(200).json({
      pendingRequests: pendingRes.rows[0].count,
      totalUsers: usersRes.rows[0].count,
      roles: rolesRes.rows,
    });
  } catch (error) {
    console.error('❌ Admin getAdminStats error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la récupération des statistiques.' });
  }
}

module.exports = {
  getRoleRequests,
  getRoleRequestById,
  acceptRoleRequest,
  rejectRoleRequest,
  getAdminStats,
};
