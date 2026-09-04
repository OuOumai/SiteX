/**
 * server/src/controllers/responsable.controller.js
 *
 * Controller providing real aggregated data for the Responsable Dashboard & Profile.
 */

'use strict';

const db = require('../db');

function isAdminUser(user) {
  return user.role_nom === 'Administrateur' || user.role_id === 1;
}

async function renameChantier(req, res) {
  try {
    const name = String(req.body?.nom || '').trim();
    if (!name) return res.status(400).json({ message: 'Le nom du chantier est requis.' });
    const result = await db.query(`
      UPDATE public.chantier SET nom = $1
      WHERE id = $2 AND (responsable_id = $3 OR $4 = true)
      RETURNING id, nom
    `, [name, req.params.id, req.user.id, isAdminUser(req.user)]);
    if (!result.rows.length) return res.status(404).json({ message: 'Chantier introuvable ou accès interdit.' });
    return res.json({ message: 'Chantier renommé avec succès.', chantier: result.rows[0] });
  } catch (error) {
    console.error('RenameChantier error:', error.message);
    return res.status(500).json({ message: 'Erreur lors du renommage du chantier.' });
  }
}

async function renameTroncon(req, res) {
  try {
    const name = String(req.body?.nom || '').trim();
    if (!name) return res.status(400).json({ message: 'Le nom du tronçon est requis.' });
    const result = await db.query(`
      UPDATE public.troncon t SET nom = $1
      FROM public.chantier c
      WHERE t.id = $2 AND c.id = t.chantier_id
        AND (c.responsable_id = $3 OR $4 = true)
      RETURNING t.id, t.nom, t.chantier_id
    `, [name, req.params.id, req.user.id, isAdminUser(req.user)]);
    if (!result.rows.length) return res.status(404).json({ message: 'Tronçon introuvable ou accès interdit.' });
    return res.json({ message: 'Tronçon renommé avec succès.', troncon: result.rows[0] });
  } catch (error) {
    console.error('RenameTroncon error:', error.message);
    return res.status(500).json({ message: 'Erreur lors du renommage du tronçon.' });
  }
}

async function deleteTroncon(req, res) {
  const client = await db.pool.connect();
  try {
    const check = await client.query(`
      SELECT t.id, t.nom FROM public.troncon t
      JOIN public.chantier c ON c.id = t.chantier_id
      WHERE t.id = $1 AND (c.responsable_id = $2 OR $3 = true)
    `, [req.params.id, req.user.id, isAdminUser(req.user)]);
    if (!check.rows.length) return res.status(404).json({ message: 'Tronçon introuvable ou accès interdit.' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.photo_terrain WHERE observation_id IN
      (SELECT id FROM public.observation_terrain WHERE troncon_id = $1)`, [req.params.id]);
    await client.query('DELETE FROM public.observation_terrain WHERE troncon_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.troncon WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    return res.json({ message: `Tronçon « ${check.rows[0].nom} » supprimé avec succès.` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('DeleteTroncon error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la suppression du tronçon.' });
  } finally { client.release(); }
}

async function deleteChantier(req, res) {
  const client = await db.pool.connect();
  try {
    const check = await client.query(`SELECT id, nom FROM public.chantier
      WHERE id = $1 AND (responsable_id = $2 OR $3 = true)`,
      [req.params.id, req.user.id, isAdminUser(req.user)]);
    if (!check.rows.length) return res.status(404).json({ message: 'Chantier introuvable ou accès interdit.' });
    await client.query('BEGIN');
    await client.query(`DELETE FROM public.photo_terrain WHERE observation_id IN
      (SELECT id FROM public.observation_terrain WHERE chantier_id = $1 OR troncon_id IN
        (SELECT id FROM public.troncon WHERE chantier_id = $1))`, [req.params.id]);
    await client.query(`DELETE FROM public.observation_terrain WHERE chantier_id = $1 OR troncon_id IN
      (SELECT id FROM public.troncon WHERE chantier_id = $1)`, [req.params.id]);
    await client.query('DELETE FROM public.rapport WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.troncon WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.reference_alignment WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.avancement WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.image_satellite WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.reclamation WHERE chantier_id = $1', [req.params.id]);
    await client.query('DELETE FROM public.chantier WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    return res.json({ message: `Chantier « ${check.rows[0].nom} » et ses tronçons supprimés avec succès.` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('DeleteChantier error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la suppression du chantier.' });
  } finally { client.release(); }
}

/**
 * GET /responsable/dashboard
 * Aggregates all real database records for the authenticated Responsable:
 * - Mes projets
 * - Mes chantiers (with GIS setup state & avancement)
 * - Global avancement
 * - Observations terrain (view only)
 * - Réclamations client
 * - Map features (alignments & chantiers)
 */
async function getDashboardData(req, res) {
  try {
    const userId = req.user.id;

    // 1. Projects: Fetch projects where responsable has chantiers OR all active projects
    const projectsQuery = `
      SELECT 
        p.id,
        p.nom,
        p.description,
        p.type_projet,
        TO_CHAR(p.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(p.date_fin, 'YYYY-MM-DD') AS date_fin,
        COALESCE(p.statut, 'En cours') AS statut,
        COUNT(DISTINCT c.id)::int AS nombre_chantiers,
        COALESCE(AVG(latest_avancement.pourcentage), 0)::int AS avancement_moyen
      FROM public.projet p
      LEFT JOIN public.chantier c ON c.projet_id = p.id
      LEFT JOIN LATERAL (
        SELECT a.pourcentage
        FROM public.avancement a
        WHERE a.chantier_id = c.id
        ORDER BY a.date DESC, a.id DESC
        LIMIT 1
      ) latest_avancement ON true
      GROUP BY p.id
      ORDER BY p.id ASC;
    `;
    const projectsRes = await db.query(projectsQuery);
    const projects = projectsRes.rows;

    // 2. Chantiers for this Responsable (or all if admin)
    const chantiersQuery = `
      SELECT 
        c.id,
        c.projet_id,
        c.responsable_id,
        c.nom,
        c.statut,
        c.surface,
        c.surface_reference,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation,
        p.nom AS projet_nom,
        p.type_projet AS projet_type,
        COALESCE(latest_avancement.pourcentage, 0)::int AS avancement,
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
      LEFT JOIN public.projet p ON p.id = c.projet_id
      LEFT JOIN LATERAL (
        SELECT a.pourcentage
        FROM public.avancement a
        WHERE a.chantier_id = c.id
        ORDER BY a.date DESC, a.id DESC
        LIMIT 1
      ) latest_avancement ON true
      LEFT JOIN LATERAL (
        SELECT ra.id, ra.nom, ra.geometry, ra.direction_reversed
        FROM public.reference_alignment ra
        WHERE ra.chantier_id = c.id
        ORDER BY ra.id DESC
        LIMIT 1
      ) ref ON true
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      GROUP BY c.id, p.nom, p.type_projet, latest_avancement.pourcentage, ref.id, ref.nom, ref.geometry, ref.direction_reversed
      ORDER BY c.id ASC;
    `;
    const chantiersRes = await db.query(chantiersQuery);
    const chantiers = chantiersRes.rows;

    // 3. Observations Terrain (Read-only for Responsable)
    const obsQuery = `
      SELECT 
        o.id,
        o.chantier_id,
        o.troncon_id,
        o.agent_id,
        TO_CHAR(o.date_heure, 'YYYY-MM-DD HH24:MI') AS date_heure,
        o.chainage,
        o.statut,
        o.commentaire,
        o.type_observation,
        o.severite,
        c.nom AS chantier_nom,
        t.nom AS troncon_nom,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
        ST_AsGeoJSON(o.position_gps)::json AS position_gps
      FROM public.observation_terrain o
      LEFT JOIN public.chantier c ON c.id = o.chantier_id
      LEFT JOIN public.troncon t ON t.id = o.troncon_id
      LEFT JOIN public.utilisateur u ON u.id = o.agent_id
      ORDER BY o.date_heure DESC, o.id DESC
      LIMIT 20;
    `;
    let observations = [];
    try {
      const obsRes = await db.query(obsQuery);
      observations = obsRes.rows;
    } catch (e) {
      observations = [];
    }

    // 4. Réclamations Client
    const recQuery = `
      SELECT 
        r.id,
        r.chantier_id,
        r.utilisateur_id,
        r.titre,
        r.description,
        r.photo,
        r.statut,
        TO_CHAR(r.date_creation, 'YYYY-MM-DD HH24:MI') AS date_creation,
        c.nom AS chantier_nom,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS client_nom
      FROM public.reclamation r
      LEFT JOIN public.chantier c ON c.id = r.chantier_id
      LEFT JOIN public.utilisateur u ON u.id = r.utilisateur_id
      ORDER BY r.date_creation DESC, r.id DESC
      LIMIT 20;
    `;
    let reclamations = [];
    try {
      const recRes = await db.query(recQuery);
      reclamations = recRes.rows;
    } catch (e) {
      reclamations = [];
    }

    // 5. Global indicators & Attention Required Alerts
    const totalProjects = projects.length;
    const totalChantiers = chantiers.length;
    const chantiersPrets = chantiers.filter((c) => c.gis_status === 'PRET_POUR_SUIVI').length;
    const totalAvancement = chantiers.reduce((sum, c) => sum + (c.avancement || 0), 0);
    const avancementMoyen = totalChantiers > 0 ? Math.round(totalAvancement / totalChantiers) : 0;

    const alerts = [];
    chantiers.forEach((c) => {
      if (c.gis_status === 'NON_CONFIGURE') {
        alerts.push({
          id: `gis_unset_${c.id}`,
          type: 'GIS_NON_CONFIGURE',
          severity: 'HIGH',
          chantierId: c.id,
          chantierNom: c.nom,
          projetNom: c.projet_nom,
          message: `Le tracé GeoJSON n'a pas encore été importé pour le chantier "${c.nom}".`,
        });
      } else if (c.gis_status === 'ALIGNEMENT_IMPORTE') {
        alerts.push({
          id: `no_troncon_${c.id}`,
          type: 'AUCUN_TRONCON',
          severity: 'MEDIUM',
          chantierId: c.id,
          chantierNom: c.nom,
          projetNom: c.projet_nom,
          message: `L'alignement est importé mais aucun tronçon n'a été découpé pour "${c.nom}".`,
        });
      }
    });

    projects.forEach((p) => {
      if (p.nombre_chantiers === 0) {
        alerts.push({
          id: `no_chantier_proj_${p.id}`,
          type: 'PROJET_SANS_CHANTIER',
          severity: 'LOW',
          projectId: p.id,
          projetNom: p.nom,
          message: `Le projet "${p.nom}" n'a aucun chantier configuré.`,
        });
      }
    });

    // 5. Equipe Terrain Summary Stats for this Responsable (ONLY Admin-validated A.T.)
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;
    const equipeStatsQuery = `
      WITH all_active_agents AS (
        SELECT u.id
        FROM public.utilisateur u
        JOIN public.role r ON u.role_id = r.id
        WHERE (r.nom = 'AgentTerrain' OR u.role_id = 3) 
          AND u.actif = true
          AND EXISTS (
            SELECT 1 FROM public.demande_role dr 
            WHERE dr.utilisateur_id = u.id 
              AND dr.requested_role_id = 3 
              AND dr.statut = 'APPROVED'
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.demande_role dr_p 
            WHERE dr_p.utilisateur_id = u.id 
              AND dr_p.statut = 'PENDING'
          )
      ),
      resp_assignments AS (
        SELECT a.agent_id, a.id AS affectation_id
        FROM public.affectation_troncon a
        JOIN public.troncon t ON a.troncon_id = t.id
        JOIN public.chantier c ON t.chantier_id = c.id
        WHERE ($1 = true OR c.responsable_id = $2) AND a.statut = 'ACTIF'
      )
      SELECT 
        (SELECT COUNT(*) FROM all_active_agents)::int AS total_available,
        (SELECT COUNT(DISTINCT agent_id) FROM resp_assignments)::int AS total_assigned,
        (SELECT COUNT(*) FROM resp_assignments)::int AS total_assignments;
    `;
    const equipeStatsRes = await db.query(equipeStatsQuery, [isAdmin, userId]);
    const totalAvailable = equipeStatsRes.rows[0]?.total_available || 0;
    const totalAssigned = equipeStatsRes.rows[0]?.total_assigned || 0;
    const totalAssignments = equipeStatsRes.rows[0]?.total_assignments || 0;
    const totalUnassigned = Math.max(0, totalAvailable - totalAssigned);

    return res.status(200).json({
      stats: {
        totalProjects,
        totalChantiers,
        chantiersPrets,
        avancementMoyen,
        totalObservations: observations.length,
        totalReclamations: reclamations.length,
        equipeTerrain: {
          totalAvailable,
          totalAssigned,
          totalAssignments,
          totalUnassigned,
        },
      },
      projects,
      chantiers,
      observations,
      reclamations,
      alerts,
    });
  } catch (error) {
    console.error('❌ GetResponsableDashboard error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des données du tableau de bord Responsable.',
    });
  }
}

/**
 * GET /responsable/troncon/:id
 * Fetches detailed troncon view with start/end coordinates, sibling troncons,
 * parent chantier & project, latest observation, and unresolved anomalies count.
 */
async function getTronconDetails(req, res) {
  try {
    const { id } = req.params;

    // 1. Troncon and its geometry endpoints + parent info
    const tronconQuery = `
      SELECT 
        t.id,
        t.chantier_id,
        t.reference_alignment_id,
        t.nom,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS statut,
        COALESCE(t.avancement, 0)::int AS avancement,
        ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(t.geometry)::json AS geometry,
        ST_Y(ST_StartPoint(t.geometry)) AS start_lat,
        ST_X(ST_StartPoint(t.geometry)) AS start_lng,
        ST_Y(ST_EndPoint(t.geometry)) AS end_lat,
        ST_X(ST_EndPoint(t.geometry)) AS end_lng,
        t.date_creation,
        c.nom AS chantier_nom,
        c.projet_id,
        p.nom AS projet_nom,
        p.type_projet AS projet_type,
        ra.nom AS reference_alignment_nom,
        ra.direction_reversed
      FROM public.troncon t
      JOIN public.chantier c ON c.id = t.chantier_id
      JOIN public.projet p ON p.id = c.projet_id
      LEFT JOIN public.reference_alignment ra ON ra.id = t.reference_alignment_id
      WHERE t.id = $1;
    `;
    const tronconRes = await db.query(tronconQuery, [id]);

    if (tronconRes.rows.length === 0) {
      return res.status(404).json({ message: 'Tronçon introuvable.' });
    }

    const troncon = tronconRes.rows[0];

    // 2. Sibling troncons of the same chantier for map context
    const siblingsQuery = `
      SELECT 
        t.id,
        t.nom,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS statut,
        COALESCE(t.avancement, 0)::int AS avancement,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(t.geometry)::json AS geometry
      FROM public.troncon t
      WHERE t.chantier_id = $1
      ORDER BY t.pk_debut ASC;
    `;
    const siblingsRes = await db.query(siblingsQuery, [troncon.chantier_id]);
    const siblings = siblingsRes.rows;

    // 3. Recent terrain observations for this troncon with photos aggregation
    const obsQuery = `
      SELECT 
        o.id,
        o.agent_id,
        TO_CHAR(o.date_heure, 'YYYY-MM-DD HH24:MI:SS') AS date_heure,
        o.agent_lat,
        o.agent_lng,
        o.projected_lat,
        o.projected_lng,
        o.distance_from_start,
        o.progress_percentage,
        o.daily_progress_meters,
        o.daily_progress_percentage,
        o.authoritative_progress_meters,
        o.authoritative_progress_percentage,
        o.chainage,
        o.accuracy,
        o.distance_offset,
        o.validation_status,
        COALESCE(o.phase, 'Terrassement') AS phase,
        COALESCE(o.phase_statut, 'En cours') AS phase_statut,
        o.statut,
        o.commentaire,
        o.type_observation,
        o.severite,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
        ST_AsGeoJSON(o.position_gps)::json AS position_gps,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', pt.id,
              'url', pt.fichier,
              'date_prise', TO_CHAR(pt.date_prise, 'YYYY-MM-DD HH24:MI'),
              'description', pt.description
            )
          ) FILTER (WHERE pt.id IS NOT NULL),
          '[]'::json
        ) AS photos
      FROM public.observation_terrain o
      LEFT JOIN public.utilisateur u ON u.id = o.agent_id
      LEFT JOIN public.photo_terrain pt ON pt.observation_id = o.id
      WHERE o.troncon_id = $1
      GROUP BY o.id, u.nom, u.prenom
      ORDER BY o.date_heure DESC, o.id DESC
      LIMIT 30;
    `;
    const obsRes = await db.query(obsQuery, [id]);
    const observations = obsRes.rows;

    // 4. t.avancement is the non-regressing authoritative maximum.

    // 5. Anomaly counts
    const anomaliesCount = observations.filter(
      (o) => o.severite === 'MAJEUR' || o.severite === 'BLOQUANT' || o.statut === 'ANOMALIE'
    ).length;

    // 5. Assigned agents for this troncon
    const assignRes = await db.query(
      `SELECT 
        a.id AS affectation_id,
        a.agent_id,
        a.statut,
        a.notes,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        u.nom,
        u.prenom,
        u.email,
        u.telephone,
        u.photo_url,
        u.profession,
        u.entreprise,
        u.poste,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS affecte_par_nom
       FROM public.affectation_troncon a
       JOIN public.utilisateur u ON a.agent_id = u.id
       LEFT JOIN public.utilisateur resp ON a.affecte_par = resp.id
       WHERE a.troncon_id = $1 AND a.statut = 'ACTIF'
       ORDER BY a.date_affectation DESC;`,
      [id]
    );

    return res.status(200).json({
      troncon: {
        ...troncon,
        observations_count: observations.length,
        anomalies_count: anomaliesCount,
        latest_observation: observations.length > 0 ? observations[0] : null,
        assigned_agents: assignRes.rows,
      },
      siblings,
      observations,
      assigned_agents: assignRes.rows,
    });
  } catch (error) {
    console.error('❌ GetTronconDetails error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des détails du tronçon.',
    });
  }
}

/**
 * GET /responsable/agents-terrain
 * Lists all active users with role 'AgentTerrain' available for assignment.
 */
async function getAvailableAgents(req, res) {
  try {
    const result = await db.query(
      `SELECT u.id, u.nom, u.prenom, u.email, u.telephone, u.photo_url, u.profession, u.entreprise, u.poste
       FROM public.utilisateur u
       JOIN public.role r ON u.role_id = r.id
       WHERE (r.nom = 'AgentTerrain' OR u.role_id = 3) 
         AND u.actif = true
         AND EXISTS (
           SELECT 1 FROM public.demande_role dr 
           WHERE dr.utilisateur_id = u.id 
             AND dr.requested_role_id = 3 
             AND dr.statut = 'APPROVED'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.demande_role dr_p 
           WHERE dr_p.utilisateur_id = u.id 
             AND dr_p.statut = 'PENDING'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.affectation_troncon active_assignment
           WHERE active_assignment.agent_id = u.id AND active_assignment.statut = 'ACTIF'
         )
       ORDER BY u.nom ASC, u.prenom ASC;`
    );

    return res.status(200).json({
      agents: result.rows,
    });
  } catch (error) {
    console.error('❌ GetAvailableAgents error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la récupération des agents de terrain.' });
  }
}

/**
 * GET /responsable/troncon/:id/agents
 * Lists all agents currently assigned to a specific tronçon.
 */
async function getTronconAssignments(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // Verify ownership
    const checkRes = await db.query(
      `SELECT t.id, t.nom, c.responsable_id, c.nom AS chantier_nom, p.nom AS projet_nom
       FROM public.troncon t
       JOIN public.chantier c ON t.chantier_id = c.id
       JOIN public.projet p ON c.projet_id = p.id
       WHERE t.id = $1`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: 'Tronçon introuvable.' });
    }

    const tronconInfo = checkRes.rows[0];
    if (!isAdmin && tronconInfo.responsable_id !== userId) {
      return res.status(403).json({
        message: 'Accès interdit : vous n\'êtes pas le responsable de ce chantier.',
      });
    }

    const assignmentsRes = await db.query(
      `SELECT 
        a.id AS affectation_id,
        a.troncon_id,
        a.agent_id,
        a.statut,
        a.notes,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        u.nom,
        u.prenom,
        u.email,
        u.telephone,
        u.photo_url,
        u.profession,
        u.entreprise,
        u.poste,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS affecte_par_nom
       FROM public.affectation_troncon a
       JOIN public.utilisateur u ON a.agent_id = u.id
       LEFT JOIN public.utilisateur resp ON a.affecte_par = resp.id
       WHERE a.troncon_id = $1
       ORDER BY a.date_affectation DESC;`,
      [id]
    );

    return res.status(200).json({
      troncon_id: Number(id),
      troncon_nom: tronconInfo.nom,
      chantier_nom: tronconInfo.chantier_nom,
      projet_nom: tronconInfo.projet_nom,
      assignments: assignmentsRes.rows,
    });
  } catch (error) {
    console.error('❌ GetTronconAssignments error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la récupération des affectations.' });
  }
}

/**
 * POST /responsable/troncon/:id/agents
 * Assigns an Agent de Terrain to a specific tronçon.
 */
async function assignAgentToTroncon(req, res) {
  try {
    const { id } = req.params;
    const { agent_id, notes } = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    if (!agent_id) {
      return res.status(400).json({ message: 'L\'identifiant de l\'agent de terrain est requis.' });
    }

    const agentIdNum = parseInt(agent_id, 10);

    // 1. Verify troncon and ownership
    const checkRes = await db.query(
      `SELECT t.id, t.nom, c.responsable_id, c.nom AS chantier_nom, p.nom AS projet_nom
       FROM public.troncon t
       JOIN public.chantier c ON t.chantier_id = c.id
       JOIN public.projet p ON c.projet_id = p.id
       WHERE t.id = $1`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: 'Tronçon introuvable.' });
    }

    const tronconInfo = checkRes.rows[0];
    if (!isAdmin && tronconInfo.responsable_id !== userId) {
      return res.status(403).json({
        message: 'Accès interdit : vous ne pouvez affecter des agents qu\'à vos propres chantiers.',
      });
    }

    // 2. Verify agent exists, is active, has role AgentTerrain and was VALIDATED by admin
    const agentRes = await db.query(
      `SELECT u.id, u.nom, u.prenom, u.email, u.actif, r.nom AS role_nom
       FROM public.utilisateur u
       JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1 
         AND (r.nom = 'AgentTerrain' OR u.role_id = 3)
         AND u.actif = true
         AND EXISTS (
           SELECT 1 FROM public.demande_role dr 
           WHERE dr.utilisateur_id = u.id 
             AND dr.requested_role_id = 3 
             AND dr.statut = 'APPROVED'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.demande_role dr_p 
           WHERE dr_p.utilisateur_id = u.id 
             AND dr_p.statut = 'PENDING'
         )`,
      [agentIdNum]
    );

    if (agentRes.rows.length === 0) {
      return res.status(400).json({
        message: 'Cet utilisateur n\'a pas encore été validé comme Agent de Terrain par l\'administrateur ou son compte est inactif.',
      });
    }

    // 3. Insert assignment (prevent duplicates via ON CONFLICT)
    const insertRes = await db.query(
      `INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, notes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (troncon_id, agent_id) DO NOTHING
       RETURNING *;`,
      [id, agentIdNum, userId, notes || null]
    );

    if (insertRes.rows.length === 0) {
      return res.status(409).json({
        message: 'Cet agent de terrain est déjà affecté à ce tronçon.',
      });
    }

    // 4. Return full assignment details
    const fullRes = await db.query(
      `SELECT 
        a.id AS affectation_id,
        a.troncon_id,
        a.agent_id,
        a.statut,
        a.notes,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        u.nom,
        u.prenom,
        u.email,
        u.telephone,
        u.photo_url,
        u.profession,
        u.entreprise,
        u.poste,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS affecte_par_nom
       FROM public.affectation_troncon a
       JOIN public.utilisateur u ON a.agent_id = u.id
       LEFT JOIN public.utilisateur resp ON a.affecte_par = resp.id
       WHERE a.id = $1;`,
      [insertRes.rows[0].id]
    );

    return res.status(201).json({
      message: `L'agent ${agentRes.rows[0].prenom} ${agentRes.rows[0].nom} a été affecté au tronçon avec succès.`,
      affectation: fullRes.rows[0],
    });
  } catch (error) {
    console.error('❌ AssignAgentToTroncon error:', error.message);
    if (error.code === '23505') {
      return res.status(409).json({
        message: 'Affectation impossible : ce tronçon possède déjà un Agent de Terrain actif ou cet agent possède déjà une affectation active.',
      });
    }
    return res.status(500).json({ message: 'Erreur lors de l\'affectation de l\'agent au tronçon.' });
  }
}

/**
 * DELETE /responsable/troncon/:id/agents/:agentId
 * Removes an Agent de Terrain assignment from a tronçon.
 */
async function removeAgentFromTroncon(req, res) {
  try {
    const { id, agentId } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // Verify ownership
    const checkRes = await db.query(
      `SELECT t.id, c.responsable_id
       FROM public.troncon t
       JOIN public.chantier c ON t.chantier_id = c.id
       WHERE t.id = $1`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: 'Tronçon introuvable.' });
    }

    if (!isAdmin && checkRes.rows[0].responsable_id !== userId) {
      return res.status(403).json({
        message: 'Accès interdit : vous ne pouvez modifier que vos propres chantiers.',
      });
    }

    const delRes = await db.query(
      `DELETE FROM public.affectation_troncon 
       WHERE troncon_id = $1 AND agent_id = $2
       RETURNING id;`,
      [id, agentId]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ message: 'Affectation introuvable pour cet agent sur ce tronçon.' });
    }

    return res.status(200).json({
      message: 'L\'affectation de l\'agent a été retirée avec succès.',
    });
  } catch (error) {
    console.error('❌ RemoveAgentFromTroncon error:', error.message);
    return res.status(500).json({ message: 'Erreur lors du retrait de l\'affectation.' });
  }
}

/**
 * GET /responsable/equipe-terrain
 * Returns all active Agent de Terrain users with their assignments on this Responsable's projects.
 */
async function getEquipeTerrain(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // 1. Fetch only ADMIN-VALIDATED active agents and their assignments for this Responsable
    const agentsQuery = `
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        u.email,
        u.telephone,
        u.photo_url,
        u.profession,
        u.entreprise,
        u.poste,
        u.actif,
        TO_CHAR(u.date_creation, 'YYYY-MM-DD') AS date_creation,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'affectation_id', a.id,
              'troncon_id', t.id,
              'troncon_nom', t.nom,
              'pk_debut', t.pk_debut,
              'pk_fin', t.pk_fin,
              'chantier_id', c.id,
              'chantier_nom', c.nom,
              'projet_id', p.id,
              'projet_nom', p.nom,
              'date_affectation', TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI'),
              'notes', a.notes,
              'statut', a.statut
            )
          ) FILTER (WHERE a.id IS NOT NULL AND t.id IS NOT NULL AND c.id IS NOT NULL AND ($1 = true OR c.responsable_id = $2)),
          '[]'::json
        ) AS affectations
      FROM public.utilisateur u
      JOIN public.role r ON u.role_id = r.id
      LEFT JOIN public.affectation_troncon a ON a.agent_id = u.id AND a.statut = 'ACTIF'
      LEFT JOIN public.troncon t ON a.troncon_id = t.id
      LEFT JOIN public.chantier c ON t.chantier_id = c.id
      LEFT JOIN public.projet p ON c.projet_id = p.id
      WHERE (r.nom = 'AgentTerrain' OR u.role_id = 3) 
        AND u.actif = true
        AND EXISTS (
          SELECT 1 FROM public.demande_role dr 
          WHERE dr.utilisateur_id = u.id 
            AND dr.requested_role_id = 3 
            AND dr.statut = 'APPROVED'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.demande_role dr_p 
          WHERE dr_p.utilisateur_id = u.id 
            AND dr_p.statut = 'PENDING'
        )
      GROUP BY u.id
      ORDER BY u.nom ASC, u.prenom ASC;
    `;

    const agentsRes = await db.query(agentsQuery, [isAdmin, userId]);
    const agents = agentsRes.rows.map((agent) => {
      const affectations = Array.isArray(agent.affectations) ? agent.affectations : [];
      const uniqueProjects = new Set(affectations.map((a) => a.projet_id));
      const uniqueChantiers = new Set(affectations.map((a) => a.chantier_id));
      return {
        ...agent,
        affectations,
        assignments_count: affectations.length,
        projects_count: uniqueProjects.size,
        chantiers_count: uniqueChantiers.size,
      };
    });

    const totalAvailable = agents.length;
    const totalAssigned = agents.filter((a) => a.assignments_count > 0).length;
    const totalAssignments = agents.reduce((sum, a) => sum + a.assignments_count, 0);
    const totalUnassigned = Math.max(0, totalAvailable - totalAssigned);

    return res.status(200).json({
      stats: {
        totalAvailable,
        totalAssigned,
        totalAssignments,
        totalUnassigned,
      },
      agents,
    });
  } catch (error) {
    console.error('❌ GetEquipeTerrain error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération de l\'équipe terrain.',
    });
  }
}

/**
 * GET /responsable/hierarchy-tree
 * Returns the Responsable's cascading structure: Projets -> Chantiers -> Tronçons
 */
async function getHierarchyTree(req, res) {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    const query = `
      SELECT 
        p.id AS projet_id,
        p.nom AS projet_nom,
        p.type_projet,
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        t.id AS troncon_id,
        t.nom AS troncon_nom,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS troncon_statut,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km
      FROM public.projet p
      JOIN public.chantier c ON c.projet_id = p.id
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      WHERE ($1 = true OR c.responsable_id = $2)
      ORDER BY p.nom ASC, c.nom ASC, t.pk_debut ASC;
    `;

    const result = await db.query(query, [isAdmin, userId]);
    
    const projectMap = new Map();

    for (const row of result.rows) {
      if (!projectMap.has(row.projet_id)) {
        projectMap.set(row.projet_id, {
          id: row.projet_id,
          nom: row.projet_nom,
          type_projet: row.type_projet,
          chantiers: new Map(),
        });
      }

      const proj = projectMap.get(row.projet_id);
      if (row.chantier_id) {
        if (!proj.chantiers.has(row.chantier_id)) {
          proj.chantiers.set(row.chantier_id, {
            id: row.chantier_id,
            nom: row.chantier_nom,
            troncons: [],
          });
        }

        const chan = proj.chantiers.get(row.chantier_id);
        if (row.troncon_id) {
          chan.troncons.push({
            id: row.troncon_id,
            nom: row.troncon_nom,
            pk_debut: row.pk_debut,
            pk_fin: row.pk_fin,
            length_km: row.length_km,
            statut: row.troncon_statut,
          });
        }
      }
    }

    const projects = Array.from(projectMap.values()).map((p) => ({
      ...p,
      chantiers: Array.from(p.chantiers.values()),
    }));

    return res.status(200).json({ projects });
  } catch (error) {
    console.error('❌ GetHierarchyTree error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération de la hiérarchie des projets.',
    });
  }
}

/**
 * POST /responsable/affectations
 * Creates an assignment with full hierarchy chain validation:
 * Responsable -> Projet -> Chantier -> Tronçon -> Agent
 */
async function createAffectation(req, res) {
  const client = await db.pool.connect();
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;
    const { agent_id, projet_id, chantier_id, troncon_id, notes, reassign, replace_current } = req.body;

    if (!agent_id || !troncon_id) {
      client.release();
      return res.status(400).json({
        message: 'Identifiants de l\'agent et du tronçon requis.',
      });
    }

    const agentIdNum = parseInt(agent_id, 10);
    const tronconIdNum = parseInt(troncon_id, 10);
    const chantierIdNum = chantier_id ? parseInt(chantier_id, 10) : null;
    const projetIdNum = projet_id ? parseInt(projet_id, 10) : null;

    // 1. Verify complete ownership chain: Responsable -> Projet -> Chantier -> Tronçon
    let verifyQuery = `
      SELECT 
        t.id AS troncon_id,
        t.nom AS troncon_nom,
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        c.responsable_id,
        p.id AS projet_id,
        p.nom AS projet_nom
      FROM public.troncon t
      JOIN public.chantier c ON t.chantier_id = c.id
      JOIN public.projet p ON c.projet_id = p.id
      WHERE t.id = $1
    `;
    const params = [tronconIdNum];

    if (chantierIdNum) {
      verifyQuery += ` AND c.id = $2`;
      params.push(chantierIdNum);
    }
    if (projetIdNum) {
      verifyQuery += ` AND p.id = $${params.length + 1}`;
      params.push(projetIdNum);
    }

    const checkRes = await client.query(verifyQuery, params);

    if (checkRes.rows.length === 0) {
      client.release();
      return res.status(404).json({
        message: 'Hiérarchie invalide : le tronçon spécifié n\'appartient pas au chantier/projet indiqué.',
      });
    }

    const chain = checkRes.rows[0];

    // Verify Responsable ownership
    if (!isAdmin && chain.responsable_id !== userId) {
      client.release();
      return res.status(403).json({
        message: 'Accès interdit : vous ne pouvez affecter des agents qu\'à vos propres chantiers.',
      });
    }

    // 2. Verify agent exists, is active, has role AgentTerrain and was VALIDATED by admin
    const agentRes = await client.query(
      `SELECT u.id, u.nom, u.prenom, u.email, u.actif, r.nom AS role_nom
       FROM public.utilisateur u
       JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1 
         AND (r.nom = 'AgentTerrain' OR u.role_id = 3)
         AND u.actif = true
         AND EXISTS (
           SELECT 1 FROM public.demande_role dr 
           WHERE dr.utilisateur_id = u.id 
             AND dr.requested_role_id = 3 
             AND dr.statut = 'APPROVED'
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.demande_role dr_p 
           WHERE dr_p.utilisateur_id = u.id 
             AND dr_p.statut = 'PENDING'
         )`,
      [agentIdNum]
    );

    if (agentRes.rows.length === 0) {
      client.release();
      return res.status(400).json({
        message: 'Cet utilisateur n\'a pas encore été validé comme Agent de Terrain par l\'administrateur ou son compte est inactif.',
      });
    }

    await client.query('BEGIN');

    // 3. Check if Agent already has an active assignment
    const activeAgentRes = await client.query(
      `SELECT a.id, a.troncon_id, t.nom AS troncon_nom, c.nom AS chantier_nom, p.nom AS projet_nom
       FROM public.affectation_troncon a
       JOIN public.troncon t ON a.troncon_id = t.id
       JOIN public.chantier c ON t.chantier_id = c.id
       JOIN public.projet p ON c.projet_id = p.id
       WHERE a.agent_id = $1 AND a.statut = 'ACTIF'
       LIMIT 1`,
      [agentIdNum]
    );

    if (activeAgentRes.rows.length > 0) {
      const currentAff = activeAgentRes.rows[0];
      if (currentAff.troncon_id === tronconIdNum) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'Cet agent de terrain est déjà affecté à ce tronçon.',
          conflict: 'ALREADY_ASSIGNED_TO_THIS_TRONCON',
        });
      }

      // Agent is active on a different tronçon
      if (reassign === true) {
        await client.query(
          `UPDATE public.affectation_troncon
           SET statut = 'INACTIF'
           WHERE agent_id = $1 AND statut = 'ACTIF'`,
          [agentIdNum]
        );
      } else {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: `L'agent ${agentRes.rows[0].prenom} ${agentRes.rows[0].nom} est déjà affecté au tronçon « ${currentAff.troncon_nom} » (${currentAff.projet_nom} / ${currentAff.chantier_nom}). Confirmez la réaffectation pour le transférer.`,
          conflict: 'AGENT_ALREADY_ASSIGNED',
          current_assignment: currentAff,
        });
      }
    }

    // 4. Check if Target Tronçon already has an active agent
    const activeTronconRes = await client.query(
      `SELECT a.id, a.agent_id, u.prenom, u.nom, u.email
       FROM public.affectation_troncon a
       JOIN public.utilisateur u ON a.agent_id = u.id
       WHERE a.troncon_id = $1 AND a.statut = 'ACTIF'
       LIMIT 1`,
      [tronconIdNum]
    );

    if (activeTronconRes.rows.length > 0) {
      const currentTronconAgent = activeTronconRes.rows[0];
      if (currentTronconAgent.agent_id === agentIdNum) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: 'Cet agent de terrain est déjà affecté à ce tronçon.',
          conflict: 'ALREADY_ASSIGNED_TO_THIS_TRONCON',
        });
      }

      if (replace_current === true || reassign === true) {
        await client.query(
          `UPDATE public.affectation_troncon
           SET statut = 'INACTIF'
           WHERE troncon_id = $1 AND statut = 'ACTIF'`,
          [tronconIdNum]
        );
      } else {
        await client.query('ROLLBACK');
        client.release();
        return res.status(409).json({
          message: `Le tronçon « ${chain.troncon_nom} » est actuellement affecté à l'agent ${currentTronconAgent.prenom} ${currentTronconAgent.nom}. Confirmez le remplacement pour affecter un nouvel agent.`,
          conflict: 'TRONCON_ALREADY_ASSIGNED',
          current_agent: currentTronconAgent,
        });
      }
    }

    // 5. Insert new active assignment
    const insertRes = await client.query(
      `INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, notes, statut)
       VALUES ($1, $2, $3, $4, 'ACTIF')
       RETURNING *;`,
      [tronconIdNum, agentIdNum, userId, notes || null]
    );

    await client.query('COMMIT');

    // 6. Return full assignment details with hierarchy
    const fullRes = await client.query(
      `SELECT 
        a.id AS affectation_id,
        a.troncon_id,
        a.agent_id,
        a.statut,
        a.notes,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        t.nom AS troncon_nom,
        t.pk_debut,
        t.pk_fin,
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        p.id AS projet_id,
        p.nom AS projet_nom,
        u.nom AS agent_nom,
        u.prenom AS agent_prenom,
        u.email AS agent_email,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS affecte_par_nom
       FROM public.affectation_troncon a
       JOIN public.troncon t ON a.troncon_id = t.id
       JOIN public.chantier c ON t.chantier_id = c.id
       JOIN public.projet p ON c.projet_id = p.id
       JOIN public.utilisateur u ON a.agent_id = u.id
       LEFT JOIN public.utilisateur resp ON a.affecte_par = resp.id
       WHERE a.id = $1;`,
      [insertRes.rows[0].id]
    );

    client.release();

    return res.status(201).json({
      message: `L'agent ${agentRes.rows[0].prenom} ${agentRes.rows[0].nom} a été affecté au tronçon « ${chain.troncon_nom} » (${chain.projet_nom} / ${chain.chantier_nom}) avec succès.`,
      affectation: fullRes.rows[0],
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    client.release();

    console.error('❌ CreateAffectation error:', error.message);

    if (error.code === '23505') {
      if (error.constraint === 'uq_active_affectation_per_agent') {
        return res.status(409).json({
          message: 'Cet agent de terrain possède déjà une affectation active sur un autre tronçon. Confirmez la réaffectation pour le déplacer.',
          conflict: 'AGENT_ALREADY_ASSIGNED',
        });
      }
      if (error.constraint === 'uq_active_affectation_per_troncon') {
        return res.status(409).json({
          message: 'Ce tronçon possède déjà un agent de terrain actif. Confirmez le remplacement pour affecter un nouvel agent.',
          conflict: 'TRONCON_ALREADY_ASSIGNED',
        });
      }
      return res.status(409).json({
        message: 'Cet agent ou ce tronçon possède déjà une affectation active.',
        conflict: 'DUPLICATE_ACTIVE_ASSIGNMENT',
      });
    }

    return res.status(500).json({
      message: 'Erreur lors de la création de l\'affectation.',
    });
  }
}

/**
 * DELETE /responsable/affectations/:affectationId
 * Deletes an assignment after validating ownership.
 */
async function removeAffectation(req, res) {
  try {
    const { affectationId } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // Verify ownership of the chantier associated with this assignment
    const checkRes = await db.query(
      `SELECT a.id, c.responsable_id, u.nom, u.prenom, t.nom AS troncon_nom
       FROM public.affectation_troncon a
       JOIN public.troncon t ON a.troncon_id = t.id
       JOIN public.chantier c ON t.chantier_id = c.id
       JOIN public.utilisateur u ON a.agent_id = u.id
       WHERE a.id = $1`,
      [affectationId]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: 'Affectation introuvable.' });
    }

    const row = checkRes.rows[0];
    if (!isAdmin && row.responsable_id !== userId) {
      return res.status(403).json({
        message: 'Accès interdit : vous ne pouvez supprimer que les affectations de vos propres chantiers.',
      });
    }

    await db.query(`DELETE FROM public.affectation_troncon WHERE id = $1;`, [affectationId]);

    return res.status(200).json({
      message: `L'affectation de l'agent ${row.prenom} ${row.nom} sur le tronçon « ${row.troncon_nom} » a été retirée avec succès.`,
    });
  } catch (error) {
    console.error('❌ RemoveAffectation error:', error.message);
    return res.status(500).json({ message: 'Erreur lors du retrait de l\'affectation.' });
  }
}

module.exports = {
  getDashboardData,
  getEquipeTerrain,
  getHierarchyTree,
  createAffectation,
  removeAffectation,
  getTronconDetails,
  getAvailableAgents,
  getTronconAssignments,
  assignAgentToTroncon,
  removeAgentFromTroncon,
  renameChantier,
  deleteChantier,
  renameTroncon,
  deleteTroncon,
};
