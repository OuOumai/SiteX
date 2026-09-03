/**
 * server/src/controllers/project.controller.js
 *
 * Controller handling Projet entity resources.
 * Adheres to SiteX architecture & PostgreSQL real data models (UML: Projet -> Chantier -> Avancement/Images/Reclamations).
 */

'use strict';

const db = require('../db');

/**
 * GET /projects
 * Returns paginated projects with search, status filtering, and metadata.
 * Query params:
 *   - page   : integer (default 1)
 *   - limit  : integer (default 6)
 *   - search : string (optional, filters nom and description)
 *   - statut : string (optional: 'Tous' | 'En cours' | 'Terminés' | 'En retard')
 * Accessible to authenticated users.
 */
async function getAllProjects(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 6));
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';
    const statut = req.query.statut ? String(req.query.statut).trim() : '';

    // 1. Compute global status counts across the whole database
    const statusCountsQuery = `
      SELECT 
        COUNT(*)::int AS total_all,
        COUNT(CASE WHEN LOWER(COALESCE(statut, 'En cours')) LIKE '%cours%' THEN 1 END)::int AS count_cours,
        COUNT(CASE WHEN LOWER(COALESCE(statut, '')) LIKE '%termin%' THEN 1 END)::int AS count_termines,
        COUNT(CASE WHEN LOWER(COALESCE(statut, '')) LIKE '%retard%' THEN 1 END)::int AS count_retard
      FROM public.projet;
    `;
    const statusCountsRes = await db.query(statusCountsQuery);
    const countsRow = statusCountsRes.rows[0] || {};
    const statusCounts = {
      'Tous': countsRow.total_all || 0,
      'En cours': countsRow.count_cours || 0,
      'Terminés': countsRow.count_termines || 0,
      'En retard': countsRow.count_retard || 0,
    };

    // 2. Build dynamic filtering where clauses
    const whereClauses = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      whereClauses.push(`(p.nom ILIKE $${params.length} OR COALESCE(p.description, '') ILIKE $${params.length})`);
    }

    if (statut && statut !== 'Tous') {
      const lowerStatut = statut.toLowerCase();
      if (lowerStatut.includes('cours')) {
        whereClauses.push(`LOWER(COALESCE(p.statut, 'En cours')) LIKE '%cours%'`);
      } else if (lowerStatut.includes('termin')) {
        whereClauses.push(`LOWER(COALESCE(p.statut, '')) LIKE '%termin%'`);
      } else if (lowerStatut.includes('retard')) {
        whereClauses.push(`LOWER(COALESCE(p.statut, '')) LIKE '%retard%'`);
      } else {
        params.push(statut);
        whereClauses.push(`p.statut = $${params.length}`);
      }
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 3. Count total matching filtered rows
    const countQuery = `SELECT COUNT(*)::int AS total FROM public.projet p ${whereSQL};`;
    const countRes = await db.query(countQuery, params);
    const total = countRes.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // 4. Fetch paginated data
    const dataParams = [...params];
    dataParams.push(limit);
    const limitParamIndex = dataParams.length;
    dataParams.push(offset);
    const offsetParamIndex = dataParams.length;

    const dataQuery = `
      SELECT 
        p.id,
        p.nom,
        p.description,
        p.type_projet,
        TO_CHAR(p.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(p.date_fin, 'YYYY-MM-DD') AS date_fin,
        COALESCE(p.statut, 'En cours') AS statut
      FROM public.projet p
      ${whereSQL}
      ORDER BY p.id DESC
      LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex};
    `;

    const result = await db.query(dataQuery, dataParams);

    return res.status(200).json({
      projects: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
        hasPrev: page > 1,
      },
      statusCounts,
    });
  } catch (error) {
    console.error('❌ GetAllProjects error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des projets.',
    });
  }
}

/**
 * GET /projects/:id
 * Returns detailed project information including:
 * - Project attributes (id, nom, description, type_projet, date_debut, date_fin, statut)
 * - Related Chantiers with latest avancement, dates, and status
 * - Global indicators (nombreChantiers, avancementGlobal, imagesSatellite, reclamations, derniereMiseAJour)
 */
async function getProjectDetails(req, res) {
  try {
    const { id } = req.params;

    // 1. Fetch project info
    const projectQuery = `
      SELECT 
        id,
        nom,
        description,
        type_projet,
        TO_CHAR(date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(date_fin, 'YYYY-MM-DD') AS date_fin,
        COALESCE(statut, 'En cours') AS statut
      FROM public.projet
      WHERE id = $1;
    `;
    const projectRes = await db.query(projectQuery, [id]);

    if (projectRes.rows.length === 0) {
      return res.status(404).json({ message: 'Projet introuvable.' });
    }

    const project = projectRes.rows[0];

    // 2. Fetch related chantiers with latest avancement, GIS alignment, and troncons count
    const chantiersQuery = `
      SELECT 
        c.id,
        c.projet_id,
        c.nom,
        c.statut,
        c.surface,
        c.surface_reference,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation,
        COALESCE(latest_avancement.pourcentage, 0)::int AS avancement,
        latest_avancement.date AS avancement_date,
        latest_avancement.commentaire AS avancement_commentaire,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS responsable_nom,
        ref.id AS reference_alignment_id,
        ref.nom AS reference_alignment_nom,
        ref.direction_reversed,
        ROUND((ST_Length(ref.geometry::geography) / 1000.0)::numeric, 2) AS length_km,
        COUNT(t.id)::int AS nombre_troncons,
        CASE 
          WHEN COUNT(t.id) > 0 THEN 'PRET_POUR_SUIVI'
          WHEN ref.id IS NOT NULL THEN 'ALIGNEMENT_IMPORTE'
          ELSE 'NON_CONFIGURE'
        END AS gis_status
      FROM public.chantier c
      LEFT JOIN LATERAL (
        SELECT a.pourcentage, a.date, a.commentaire
        FROM public.avancement a
        WHERE a.chantier_id = c.id
        ORDER BY a.date DESC, a.id DESC
        LIMIT 1
      ) latest_avancement ON true
      LEFT JOIN public.utilisateur u ON u.id = c.responsable_id
      LEFT JOIN LATERAL (
        SELECT ra.id, ra.nom, ra.geometry, ra.direction_reversed
        FROM public.reference_alignment ra
        WHERE ra.chantier_id = c.id
        ORDER BY ra.id DESC
        LIMIT 1
      ) ref ON true
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      WHERE c.projet_id = $1
      GROUP BY c.id, latest_avancement.pourcentage, latest_avancement.date, latest_avancement.commentaire, u.prenom, u.nom, ref.id, ref.nom, ref.geometry, ref.direction_reversed
      ORDER BY c.id ASC;
    `;
    const chantiersRes = await db.query(chantiersQuery, [id]);
    const chantiers = chantiersRes.rows;

    // 3. Aggregate indicators across related tables
    const indicatorsQuery = `
      SELECT 
        COUNT(DISTINCT img.id)::int AS images_satellite,
        COUNT(DISTINCT rec.id)::int AS reclamations,
        GREATEST(
          MAX(c.date_creation),
          MAX(img.date_acquisition::timestamp),
          MAX(rec.date_creation),
          $2::timestamp
        ) AS derniere_mise_a_jour
      FROM public.chantier c
      LEFT JOIN public.image_satellite img ON img.chantier_id = c.id
      LEFT JOIN public.reclamation rec ON rec.chantier_id = c.id
      WHERE c.projet_id = $1;
    `;
    const indicatorsRes = await db.query(indicatorsQuery, [id, project.date_debut || '2026-01-01']);
    const ind = indicatorsRes.rows[0] || {};

    const nombreChantiers = chantiers.length;
    const totalAvancement = chantiers.reduce((sum, ch) => sum + (ch.avancement || 0), 0);
    const avancementGlobal = nombreChantiers > 0 ? Math.round(totalAvancement / nombreChantiers) : 0;

    const derniereMiseAJour = ind.derniere_mise_a_jour || project.date_debut;

    return res.status(200).json({
      project: {
        ...project,
        indicateurs: {
          nombreChantiers,
          avancementGlobal,
          imagesSatellite: ind.images_satellite || 0,
          reclamations: ind.reclamations || 0,
          derniereMiseAJour,
        },
        chantiers,
      },
    });
  } catch (error) {
    console.error('❌ GetProjectDetails error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des détails du projet.',
    });
  }
}

/**
 * POST /projects
 * Creates a new project in public.projet.
 * Accessible to Responsable and Admin.
 */
async function createProject(req, res) {
  try {
    const { nom, description, type_projet, date_debut, date_fin, statut } = req.body;

    if (!nom || !nom.trim()) {
      return res.status(400).json({ message: 'Le nom du projet est obligatoire.' });
    }

    const query = `
      INSERT INTO public.projet (nom, description, type_projet, date_debut, date_fin, statut)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING 
        id, 
        nom, 
        description, 
        type_projet,
        TO_CHAR(date_debut, 'YYYY-MM-DD') AS date_debut, 
        TO_CHAR(date_fin, 'YYYY-MM-DD') AS date_fin, 
        statut;
    `;

    const values = [
      nom.trim(),
      description ? description.trim() : null,
      type_projet ? type_projet.trim() : null,
      date_debut || null,
      date_fin || null,
      statut || 'En cours',
    ];

    const result = await db.query(query, values);
    const createdProject = result.rows[0];

    return res.status(201).json({
      message: 'Projet créé avec succès.',
      project: createdProject,
    });
  } catch (error) {
    console.error('❌ CreateProject error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la création du projet.',
    });
  }
}

/**
 * DELETE /projects/:id
 * Deletes a project and all its related data (chantiers, troncons, avancements,
 * images_satellite, reclamations, observations, reference_alignments) in a transaction.
 * Accessible to Responsable and Admin only.
 */
async function deleteProject(req, res) {
  const client = await require('../db').pool.connect();
  try {
    const { id } = req.params;

    // Verify the project exists first
    const checkRes = await client.query(
      'SELECT id, nom FROM public.projet WHERE id = $1',
      [id]
    );
    if (checkRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Projet introuvable.' });
    }
    const projetNom = checkRes.rows[0].nom;

    await client.query('BEGIN');

    // 1. Get all chantier IDs linked to this project
    const chantiersRes = await client.query(
      'SELECT id FROM public.chantier WHERE projet_id = $1',
      [id]
    );
    const chantierIds = chantiersRes.rows.map((r) => r.id);

    if (chantierIds.length > 0) {
      const chantierIdList = chantierIds.join(',');

      // 2. Get all troncon IDs for these chantiers
      const tronconsRes = await client.query(
        `SELECT id FROM public.troncon WHERE chantier_id IN (${chantierIdList})`
      );
      const tronconIds = tronconsRes.rows.map((r) => r.id);

      // 3. Get all observation_terrain IDs for these chantiers or troncons
      const obsRes = await client.query(
        `SELECT id FROM public.observation_terrain WHERE chantier_id IN (${chantierIdList})` +
        (tronconIds.length > 0 ? ` OR troncon_id IN (${tronconIds.join(',')})` : '')
      );
      const obsIds = obsRes.rows.map((r) => r.id);

      // 4. Delete photo_terrain linked to observations
      if (obsIds.length > 0) {
        await client.query(
          `DELETE FROM public.photo_terrain WHERE observation_id IN (${obsIds.join(',')})`
        );
      }

      // 5. Delete observation_terrain
      if (obsIds.length > 0) {
        await client.query(
          `DELETE FROM public.observation_terrain WHERE id IN (${obsIds.join(',')})`
        );
      }

      // 6. Delete rapports
      await client.query(
        `DELETE FROM public.rapport WHERE chantier_id IN (${chantierIdList})`
      );

      // 7. Delete troncons
      await client.query(
        `DELETE FROM public.troncon WHERE chantier_id IN (${chantierIdList})`
      );

      // 8. Delete reference_alignments
      await client.query(
        `DELETE FROM public.reference_alignment WHERE chantier_id IN (${chantierIdList})`
      );

      // 9. Delete avancements
      await client.query(
        `DELETE FROM public.avancement WHERE chantier_id IN (${chantierIdList})`
      );

      // 10. Delete images_satellite
      await client.query(
        `DELETE FROM public.image_satellite WHERE chantier_id IN (${chantierIdList})`
      );

      // 11. Delete reclamations
      await client.query(
        `DELETE FROM public.reclamation WHERE chantier_id IN (${chantierIdList})`
      );
    }

    // 12. Delete chantiers
    await client.query('DELETE FROM public.chantier WHERE projet_id = $1', [id]);

    // 13. Delete the project itself
    await client.query('DELETE FROM public.projet WHERE id = $1', [id]);

    await client.query('COMMIT');
    client.release();

    console.log(`✅ Projet "${projetNom}" (id=${id}) supprimé avec toutes ses données.`);
    return res.status(200).json({
      message: `Projet "${projetNom}" supprimé avec succès.`,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('❌ DeleteProject error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la suppression du projet.',
    });
  }
}

/**
 * POST /projects/bulk-delete
 * Bulk-deletes multiple projects and all their related data in a single transaction.
 * Body: { ids: number[] }
 * Accessible to Responsable and Admin only.
 */
async function bulkDeleteProjects(req, res) {
  const client = await require('../db').pool.connect();
  try {
    // Debug: log incoming request to confirm endpoint is hit and body is received
    console.log('🔍 BulkDeleteProjects called — method:', req.method, '| body:', JSON.stringify(req.body));

    const { ids } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      client.release();
      return res.status(400).json({ message: 'Aucun identifiant de projet fourni.' });
    }

    // Validate all IDs are positive integers
    const validIds = ids.filter((id) => Number.isInteger(Number(id)) && Number(id) > 0).map(Number);
    if (validIds.length === 0) {
      client.release();
      return res.status(400).json({ message: 'Identifiants de projet invalides.' });
    }

    // Verify all projects exist and get their names
    const checkRes = await client.query(
      `SELECT id, nom FROM public.projet WHERE id = ANY($1::int[])`,
      [validIds]
    );
    if (checkRes.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Aucun projet trouvé pour les identifiants fournis.' });
    }
    const foundIds = checkRes.rows.map((r) => r.id);
    const foundNames = checkRes.rows.map((r) => r.nom);

    await client.query('BEGIN');

    // 1. Get all chantier IDs linked to these projects
    const chantiersRes = await client.query(
      `SELECT id FROM public.chantier WHERE projet_id = ANY($1::int[])`,
      [foundIds]
    );
    const chantierIds = chantiersRes.rows.map((r) => r.id);

    if (chantierIds.length > 0) {
      // 2. Get all troncon IDs for these chantiers
      const tronconsRes = await client.query(
        `SELECT id FROM public.troncon WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );
      const tronconIds = tronconsRes.rows.map((r) => r.id);

      // 3. Get all observation_terrain IDs for these chantiers or troncons
      const obsRes = await client.query(
        `SELECT id FROM public.observation_terrain WHERE chantier_id = ANY($1::int[])` +
        (tronconIds.length > 0 ? ` OR troncon_id = ANY($2::int[])` : ''),
        tronconIds.length > 0 ? [chantierIds, tronconIds] : [chantierIds]
      );
      const obsIds = obsRes.rows.map((r) => r.id);

      // 4. Delete photo_terrain linked to observations
      if (obsIds.length > 0) {
        await client.query(
          `DELETE FROM public.photo_terrain WHERE observation_id = ANY($1::int[])`,
          [obsIds]
        );
      }

      // 5. Delete observation_terrain
      if (obsIds.length > 0) {
        await client.query(
          `DELETE FROM public.observation_terrain WHERE id = ANY($1::int[])`,
          [obsIds]
        );
      }

      // 6. Delete rapports
      await client.query(
        `DELETE FROM public.rapport WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );

      // 7. Delete troncons
      await client.query(
        `DELETE FROM public.troncon WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );

      // 8. Delete reference_alignments
      await client.query(
        `DELETE FROM public.reference_alignment WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );

      // 9. Delete avancements
      await client.query(
        `DELETE FROM public.avancement WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );

      // 10. Delete images_satellite
      await client.query(
        `DELETE FROM public.image_satellite WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );

      // 11. Delete reclamations
      await client.query(
        `DELETE FROM public.reclamation WHERE chantier_id = ANY($1::int[])`,
        [chantierIds]
      );
    }

    // 12. Delete chantiers
    await client.query(
      `DELETE FROM public.chantier WHERE projet_id = ANY($1::int[])`,
      [foundIds]
    );

    // 13. Delete the projects
    await client.query(
      `DELETE FROM public.projet WHERE id = ANY($1::int[])`,
      [foundIds]
    );

    await client.query('COMMIT');
    client.release();

    console.log(`✅ Suppression en masse : ${foundIds.length} projet(s) supprimé(s) — [${foundNames.join(', ')}]`);
    return res.status(200).json({
      message: `${foundIds.length} projet(s) supprimé(s) avec succès.`,
      deleted_count: foundIds.length,
      deleted_ids: foundIds,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('❌ BulkDeleteProjects error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la suppression des projets.',
    });
  }
}

module.exports = {
  getAllProjects,
  getProjectDetails,
  createProject,
  deleteProject,
  bulkDeleteProjects,
};

