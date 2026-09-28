/**
 * server/src/controllers/project.controller.js
 *
 * Controller handling Projet entity resources.
 * Adheres to SiteX architecture & PostgreSQL real data models (UML: Projet -> Chantier -> Avancement/Images/Reclamations).
 */

'use strict';

const path = require('path');
const fs = require('fs');
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
    const isAgent = req.user.role_nom === 'AgentTerrain' || req.user.role_id === 3;
    const agentId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 6));
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';
    const statut = req.query.statut ? String(req.query.statut).trim() : '';

    // 1. Compute global status counts across the whole database
    const agentAccessSql = isAgent ? `
      EXISTS (
        SELECT 1
        FROM public.chantier assigned_c
        JOIN public.troncon assigned_t ON assigned_t.chantier_id = assigned_c.id
        JOIN public.affectation_troncon assigned_a ON assigned_a.troncon_id = assigned_t.id
        WHERE assigned_c.projet_id = p.id
          AND assigned_a.agent_id = $1
          AND assigned_a.statut = 'ACTIF'
      )
    ` : 'TRUE';
    const statusCountsQuery = `
      SELECT 
        COUNT(*)::int AS total_all,
        COUNT(CASE WHEN LOWER(COALESCE(statut, 'En cours')) LIKE '%cours%' THEN 1 END)::int AS count_cours,
        COUNT(CASE WHEN LOWER(COALESCE(statut, '')) LIKE '%termin%' THEN 1 END)::int AS count_termines,
        COUNT(CASE WHEN LOWER(COALESCE(statut, '')) LIKE '%retard%' THEN 1 END)::int AS count_retard
      FROM public.projet p
      WHERE ${agentAccessSql};
    `;
    const statusCountsRes = await db.query(statusCountsQuery, isAgent ? [agentId] : []);
    const countsRow = statusCountsRes.rows[0] || {};
    const statusCounts = {
      'Tous': countsRow.total_all || 0,
      'En cours': countsRow.count_cours || 0,
      'Terminés': countsRow.count_termines || 0,
      'En retard': countsRow.count_retard || 0,
    };

    // 2. Build dynamic filtering where clauses
    const whereClauses = [];
    const params = isAgent ? [agentId] : [];
    if (isAgent) whereClauses.push(agentAccessSql);

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
        p.cover_image_url,
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
    const isAgent = req.user.role_nom === 'AgentTerrain' || req.user.role_id === 3;
    const agentId = req.user.id;

    // 1. Fetch project info
    const projectQuery = `
      SELECT 
        id,
        nom,
        description,
        type_projet,
        cover_image_url,
        TO_CHAR(date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(date_fin, 'YYYY-MM-DD') AS date_fin,
        COALESCE(statut, 'En cours') AS statut
      FROM public.projet
      WHERE id = $1
        AND ($2 = false OR EXISTS (
          SELECT 1
          FROM public.chantier assigned_c
          JOIN public.troncon assigned_t ON assigned_t.chantier_id = assigned_c.id
          JOIN public.affectation_troncon assigned_a ON assigned_a.troncon_id = assigned_t.id
          WHERE assigned_c.projet_id = public.projet.id
            AND assigned_a.agent_id = $3
            AND assigned_a.statut = 'ACTIF'
        ));
    `;
    const projectRes = await db.query(projectQuery, [id, isAgent, agentId]);

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
        ST_AsGeoJSON(c.localisation)::json AS localisation,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation,
        COALESCE((
          SELECT ROUND(AVG(COALESCE(t.avancement, 0)))::int
          FROM public.troncon t
          WHERE t.chantier_id = c.id
        ), 0) AS avancement,
        latest_avancement.date AS avancement_date,
        latest_avancement.commentaire AS avancement_commentaire,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS responsable_nom,
        ref.id AS reference_alignment_id,
        ref.nom AS reference_alignment_nom,
        ref.direction_reversed,
        ROUND((ST_Length(COALESCE(ref.original_geometry, ref.geometry)::geography) / 1000.0)::numeric, 2) AS length_km,
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
        SELECT ra.id, ra.nom, ra.geometry, ra.original_geometry, ra.direction_reversed
        FROM public.reference_alignment ra
        WHERE ra.chantier_id = c.id
        ORDER BY ra.id DESC
        LIMIT 1
      ) ref ON true
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      WHERE c.projet_id = $1
        AND ($2 = false OR EXISTS (
          SELECT 1 FROM public.troncon assigned_t
          JOIN public.affectation_troncon assigned_a ON assigned_a.troncon_id = assigned_t.id
          WHERE assigned_t.chantier_id = c.id
            AND assigned_a.agent_id = $3
            AND assigned_a.statut = 'ACTIF'
        ))
      GROUP BY c.id, c.localisation, latest_avancement.date, latest_avancement.commentaire, u.prenom, u.nom, ref.id, ref.nom, ref.geometry, ref.original_geometry, ref.direction_reversed
      ORDER BY c.id ASC;
    `;
    const chantiersRes = await db.query(chantiersQuery, [id, isAgent, agentId]);
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
      WHERE c.projet_id = $1
        AND ($3 = false OR EXISTS (
          SELECT 1 FROM public.troncon assigned_t
          JOIN public.affectation_troncon assigned_a ON assigned_a.troncon_id = assigned_t.id
          WHERE assigned_t.chantier_id = c.id
            AND assigned_a.agent_id = $4
            AND assigned_a.statut = 'ACTIF'
        ));
    `;
    const indicatorsRes = await db.query(indicatorsQuery, [id, project.date_debut || '2026-01-01', isAgent, agentId]);
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
/**
 * POST /projects
 * Creates a new project in public.projet.
 * If nombre_chantiers is specified, creates the planned chantiers immediately in public.chantier.
 * Accessible to Responsable and Admin.
 */
async function createProject(req, res) {
  const client = await db.pool.connect();
  try {
    const { nom, description, type_projet, date_debut, date_fin, statut, nombre_chantiers } = req.body;
    const userId = req.user?.id || null;

    if (!nom || !nom.trim()) {
      client.release();
      return res.status(400).json({ message: 'Le nom du projet est obligatoire.' });
    }

    await client.query('BEGIN');

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

    const result = await client.query(query, values);
    const createdProject = result.rows[0];

    const count = parseInt(nombre_chantiers, 10);
    const initialCount = Number.isFinite(count) && count > 0 ? count : 0;
    const createdChantiers = [];

    for (let i = 1; i <= initialCount; i++) {
      const cRes = await client.query(
        `INSERT INTO public.chantier (
          projet_id,
          responsable_id,
          nom,
          statut,
          date_debut,
          date_fin_prevue,
          d_max_position_meters,
          date_creation
        )
        VALUES ($1, $2, $3, 'En attente', $4, $5, 50, NOW())
        RETURNING id, projet_id, responsable_id, nom, statut, TO_CHAR(date_debut, 'YYYY-MM-DD') AS date_debut, TO_CHAR(date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue, d_max_position_meters`,
        [createdProject.id, userId, `Chantier ${i}`, date_debut || null, date_fin || null]
      );
      createdChantiers.push({
        ...cRes.rows[0],
        gis_status: 'NON_CONFIGURE',
      });
    }

    await client.query('COMMIT');
    client.release();

    return res.status(201).json({
      message: 'Projet créé avec succès.',
      project: createdProject,
      chantiers: createdChantiers,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ CreateProject error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la création du projet: ' + error.message,
    });
  }
}

/**
 * POST /projects/:projectId/chantiers/init
 * Ensures that the project has at least `count` chantiers created in public.chantier.
 * Creates placeholder chantiers with status 'En attente' and gis_status 'NON_CONFIGURE'.
 */
async function initializeProjectChantiers(req, res) {
  const client = await db.pool.connect();
  try {
    const projectId = req.params.projectId || req.params.id;
    const count = Math.max(1, Math.min(50, parseInt(req.body.count, 10) || 1));
    const userId = req.user?.id || null;

    const projCheck = await client.query('SELECT id, date_debut, date_fin FROM public.projet WHERE id = $1', [projectId]);
    if (projCheck.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Projet introuvable.' });
    }
    const project = projCheck.rows[0];

    await client.query('BEGIN');

    // Fetch existing chantiers for this project
    const existingRes = await client.query(
      'SELECT id, nom FROM public.chantier WHERE projet_id = $1 ORDER BY id ASC',
      [projectId]
    );
    const existing = existingRes.rows;

    if (existing.length < count) {
      for (let i = existing.length + 1; i <= count; i++) {
        await client.query(
          `INSERT INTO public.chantier (
            projet_id,
            responsable_id,
            nom,
            statut,
            date_debut,
            date_fin_prevue,
            d_max_position_meters,
            date_creation
          )
          VALUES ($1, $2, $3, 'En attente', $4, $5, 50, NOW())`,
          [projectId, userId, `Chantier ${i}`, project.date_debut || null, project.date_fin || null]
        );
      }
    }

    await client.query('COMMIT');
    client.release();

    // Query all chantiers for this project with GIS status
    const allChantiersRes = await db.query(
      `SELECT 
        c.id, c.projet_id, c.nom, c.statut, c.surface, c.surface_reference,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.d_max_position_meters,
        COUNT(t.id)::int AS nombre_troncons,
        CASE 
          WHEN COUNT(t.id) > 0 THEN 'PRET_POUR_SUIVI'
          WHEN ref.id IS NOT NULL THEN 'ALIGNEMENT_IMPORTE'
          ELSE 'NON_CONFIGURE'
        END AS gis_status
      FROM public.chantier c
      LEFT JOIN LATERAL (
        SELECT id FROM public.reference_alignment WHERE chantier_id = c.id ORDER BY id DESC LIMIT 1
      ) ref ON true
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      WHERE c.projet_id = $1
      GROUP BY c.id, ref.id
      ORDER BY c.id ASC`,
      [projectId]
    );

    return res.status(200).json({
      message: 'Chantiers initialisés avec succès.',
      chantiers: allChantiersRes.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ initializeProjectChantiers error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de l\'initialisation des chantiers: ' + error.message,
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

/**
 * POST /projects/:id/cover
 * Updates a project's cover image.
 * Accepts either:
 *  - Multipart file in `req.file` (field 'cover' or 'image')
 *  - JSON body with `imageBase64` or `image` (base64 data URI or raw base64)
 */
async function updateProjectCover(req, res) {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!projectId) {
      return res.status(400).json({ message: 'Identifiant du projet invalide.' });
    }

    // Verify project exists
    const projCheck = await db.query(`SELECT id, nom, cover_image_url FROM public.projet WHERE id = $1`, [projectId]);
    if (!projCheck.rows.length) {
      return res.status(404).json({ message: 'Projet introuvable.' });
    }
    const currentCover = projCheck.rows[0].cover_image_url;

    let filename;
    const uploadDir = path.join(__dirname, '../../uploads/project_covers');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    if (req.file) {
      filename = req.file.filename;
    } else if (req.body && (req.body.imageBase64 || req.body.image)) {
      const base64Str = String(req.body.imageBase64 || req.body.image).trim();
      const matches = base64Str.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,([\s\S]+)$/);
      let ext = 'jpg';
      let dataBuffer;
      if (matches && matches.length === 3) {
        const rawExt = matches[1].toLowerCase();
        ext = rawExt === 'jpeg' ? 'jpg' : rawExt.includes('png') ? 'png' : rawExt.includes('webp') ? 'webp' : 'jpg';
        dataBuffer = Buffer.from(matches[2].replace(/\s/g, ''), 'base64');
      } else {
        dataBuffer = Buffer.from(base64Str.replace(/\s/g, ''), 'base64');
      }
      filename = `project_${projectId}_${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(uploadDir, filename), dataBuffer);
    } else {
      return res.status(400).json({ message: 'Aucune image fournie.' });
    }

    // Clean up old custom cover file if it was in uploads/project_covers
    if (currentCover && currentCover.startsWith('/uploads/project_covers/')) {
      const oldFileName = path.basename(currentCover);
      const oldFilePath = path.join(uploadDir, oldFileName);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (e) {
          console.warn('Could not delete old project cover:', e.message);
        }
      }
    }

    const relativeUrl = `/uploads/project_covers/${filename}`;
    await db.query(`UPDATE public.projet SET cover_image_url = $1 WHERE id = $2`, [relativeUrl, projectId]);

    return res.status(200).json({
      message: 'Image de couverture mise à jour avec succès.',
      cover_image_url: relativeUrl,
      project_id: projectId,
    });
  } catch (error) {
    console.error('❌ UpdateProjectCover error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la mise à jour de l’image du projet.' });
  }
}

/**
 * DELETE /projects/:id/cover
 * Resets a project's cover image to default (sets cover_image_url = null).
 */
async function resetProjectCover(req, res) {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!projectId) {
      return res.status(400).json({ message: 'Identifiant du projet invalide.' });
    }

    const projCheck = await db.query(`SELECT id, cover_image_url FROM public.projet WHERE id = $1`, [projectId]);
    if (!projCheck.rows.length) {
      return res.status(404).json({ message: 'Projet introuvable.' });
    }
    const currentCover = projCheck.rows[0].cover_image_url;

    if (currentCover && currentCover.startsWith('/uploads/project_covers/')) {
      const uploadDir = path.join(__dirname, '../../uploads/project_covers');
      const oldFileName = path.basename(currentCover);
      const oldFilePath = path.join(uploadDir, oldFileName);
      if (fs.existsSync(oldFilePath)) {
        try {
          fs.unlinkSync(oldFilePath);
        } catch (e) {
          console.warn('Could not delete old project cover:', e.message);
        }
      }
    }

    await db.query(`UPDATE public.projet SET cover_image_url = NULL WHERE id = $1`, [projectId]);

    return res.status(200).json({
      message: 'Image de couverture réinitialisée par défaut.',
      cover_image_url: null,
      project_id: projectId,
    });
  } catch (error) {
    console.error('❌ ResetProjectCover error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la réinitialisation de l’image du projet.' });
  }
}

module.exports = {
  getAllProjects,
  getProjectDetails,
  createProject,
  initializeProjectChantiers,
  deleteProject,
  bulkDeleteProjects,
  updateProjectCover,
  resetProjectCover,
};

