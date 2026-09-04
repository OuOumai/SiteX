/**
 * server/src/controllers/agent.controller.js
 *
 * Controller for Agent de Terrain (A.T.) functionalities:
 * - "Mes affectations" Dashboard
 * - Assigned Tronçon detail view & field prep
 * - GPS Field Observation, Construction Phase, Status, Comments, Photos & Metric Progress Calculation
 */

'use strict';

const path = require('path');
const fs = require('fs');
const db = require('../db');
const crsService = require('../services/crs.service');
const { calculateObservationProgress } = require('../services/progress.service');

const ALLOWED_PHASES = [
  'Terrassement',
  'Assainissement',
  'Fondation',
  'Chaussée',
  'Revêtement',
  'Signalisation',
  'Autre',
];

const ALLOWED_PHASE_STATUSES = [
  'Non commencée',
  'En cours',
  'Terminée',
];

/**
 * GET /agent/dashboard
 * Returns the authenticated Agent de Terrain's dedicated dashboard:
 * - Statistics (total assignments, total projects, total km, average progress)
 * - "Mes affectations" list strictly filtered to this agent
 */
async function getAgentDashboard(req, res) {
  try {
    const agentId = req.user.id;

    // Fetch all active assignments for this agent
    const assignmentsQuery = `
      SELECT 
        a.id AS affectation_id,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        a.statut AS affectation_statut,
        a.notes AS affectation_notes,
        t.id AS troncon_id,
        t.nom AS troncon_nom,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS troncon_statut,
        COALESCE(t.avancement, 0)::int AS troncon_avancement,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS length_meters,
        ST_AsGeoJSON(t.geometry)::json AS geometry,
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        c.d_max_position_meters,
        p.id AS projet_id,
        p.nom AS projet_nom,
        p.type_projet,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS responsable_nom,
        resp.telephone AS responsable_telephone,
        resp.email AS responsable_email
      FROM public.affectation_troncon a
      JOIN public.troncon t ON a.troncon_id = t.id
      JOIN public.chantier c ON t.chantier_id = c.id
      JOIN public.projet p ON c.projet_id = p.id
      LEFT JOIN public.utilisateur resp ON c.responsable_id = resp.id
      LEFT JOIN LATERAL (
        SELECT ot.progress_percentage
        FROM public.observation_terrain ot
        WHERE ot.troncon_id = t.id
        ORDER BY ot.date_heure DESC, ot.id DESC
        LIMIT 1
      ) latest_obs ON true
      WHERE a.agent_id = $1 AND a.statut = 'ACTIF'
      ORDER BY a.date_affectation DESC;
    `;

    const result = await db.query(assignmentsQuery, [agentId]);
    const affectations = result.rows;

    // Calculate aggregated statistics
    const totalAssignments = affectations.length;
    const uniqueProjectIds = new Set(affectations.map((a) => a.projet_id));
    const totalProjects = uniqueProjectIds.size;
    const totalKmAssigned = affectations.reduce((sum, a) => sum + (parseFloat(a.length_km) || 0), 0);
    const totalAvancement = affectations.reduce((sum, a) => sum + (a.troncon_avancement || 0), 0);
    const avancementMoyen = totalAssignments > 0 ? Math.round(totalAvancement / totalAssignments) : 0;

    return res.status(200).json({
      stats: {
        totalAssignments,
        totalProjects,
        totalKmAssigned: Number(totalKmAssigned.toFixed(3)),
        avancementMoyen,
      },
      affectations,
    });
  } catch (error) {
    console.error('❌ GetAgentDashboard error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération du tableau de bord Agent de Terrain.',
    });
  }
}

/**
 * GET /agent/troncon/:id
 * Fetches detailed troncon view for an assigned agent.
 * Strictly verifies that the authenticated agent is assigned to this troncon.
 */
async function getAgentTronconDetails(req, res) {
  try {
    const { id } = req.params;
    const agentId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // 1. Fetch troncon and verify assignment
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
        c.d_max_position_meters,
        c.projet_id,
        p.nom AS projet_nom,
        p.type_projet,
        ra.nom AS reference_alignment_nom,
        ra.direction_reversed,
        TRIM(CONCAT(resp.prenom, ' ', resp.nom)) AS responsable_nom,
        resp.telephone AS responsable_telephone,
        resp.email AS responsable_email,
        a.id AS affectation_id,
        TO_CHAR(a.date_affectation, 'YYYY-MM-DD HH24:MI') AS date_affectation,
        a.statut AS affectation_statut,
        a.notes AS affectation_notes
      FROM public.troncon t
      JOIN public.chantier c ON c.id = t.chantier_id
      JOIN public.projet p ON p.id = c.projet_id
      LEFT JOIN public.reference_alignment ra ON ra.id = t.reference_alignment_id
      LEFT JOIN public.utilisateur resp ON c.responsable_id = resp.id
      LEFT JOIN public.affectation_troncon a ON a.troncon_id = t.id AND a.agent_id = $2 AND a.statut = 'ACTIF'
      WHERE t.id = $1 AND (a.agent_id = $2 OR $3 = true);
    `;

    const tronconRes = await db.query(tronconQuery, [id, agentId, isAdmin]);

    if (tronconRes.rows.length === 0) {
      return res.status(403).json({
        message: 'Accès non autorisé : vous n\'êtes pas affecté à ce tronçon ou il est introuvable.',
      });
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

    // 3. Observations history on this troncon with photos aggregation
    const obsQuery = `
      SELECT 
        ot.id,
        ot.agent_id,
        TO_CHAR(ot.date_heure, 'YYYY-MM-DD HH24:MI:SS') AS date_heure,
        ot.agent_lat,
        ot.agent_lng,
        ot.projected_lat,
        ot.projected_lng,
        ot.distance_from_start,
        ot.progress_percentage,
        ot.daily_progress_meters,
        ot.daily_progress_percentage,
        ot.authoritative_progress_meters,
        ot.authoritative_progress_percentage,
        ot.chainage,
        ot.accuracy,
        ot.distance_offset,
        ot.validation_status,
        ot.statut,
        ot.type_observation,
        COALESCE(ot.phase, 'Terrassement') AS phase,
        COALESCE(ot.phase_statut, 'En cours') AS phase_statut,
        ot.commentaire,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
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
      FROM public.observation_terrain ot
      JOIN public.utilisateur u ON ot.agent_id = u.id
      LEFT JOIN public.photo_terrain pt ON pt.observation_id = ot.id
      WHERE ot.troncon_id = $1
      GROUP BY ot.id, u.nom, u.prenom
      ORDER BY ot.date_heure DESC, ot.id DESC
      LIMIT 30;
    `;
    const obsRes = await db.query(obsQuery, [id]);
    const observations = obsRes.rows;

    // 4. Latest observation and non-regressing authoritative progress
    const latestObservation = observations.length > 0 ? observations[0] : null;
    const currentProgress = troncon.avancement || 0;

    return res.status(200).json({
      troncon: {
        id: troncon.id,
        nom: troncon.nom,
        chantier_id: troncon.chantier_id,
        chantier_nom: troncon.chantier_nom,
        d_max_position_meters: parseFloat(troncon.d_max_position_meters),
        projet_id: troncon.projet_id,
        projet_nom: troncon.projet_nom,
        type_projet: troncon.type_projet,
        pk_debut: troncon.pk_debut,
        pk_fin: troncon.pk_fin,
        length_km: troncon.length_km,
        length_meters: troncon.length_meters,
        statut: troncon.statut,
        avancement: currentProgress,
        start_lat: troncon.start_lat,
        start_lng: troncon.start_lng,
        end_lat: troncon.end_lat,
        end_lng: troncon.end_lng,
        geometry: troncon.geometry,
        reference_alignment_nom: troncon.reference_alignment_nom,
        direction_reversed: troncon.direction_reversed,
        responsable_nom: troncon.responsable_nom,
        responsable_telephone: troncon.responsable_telephone,
        responsable_email: troncon.responsable_email,
        affectation: {
          id: troncon.affectation_id,
          date_affectation: troncon.date_affectation,
          statut: troncon.affectation_statut,
          notes: troncon.affectation_notes,
        },
        latest_observation: latestObservation,
      },
      siblings,
      observations,
    });
  } catch (error) {
    console.error('❌ GetAgentTronconDetails error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des détails du tronçon affecté.',
    });
  }
}

/**
 * Helper: Perform metric orthogonal projection on a tronçon geometry
 */
async function performTronconProjection(tronconId, agentLat, agentLng, accuracy = null) {
  // 1. Fetch troncon geometry and metadata
  const tronconRes = await db.query(
    `SELECT t.id, t.chantier_id, t.nom, t.pk_debut, t.pk_fin, t.geometry,
            c.d_max_position_meters,
            ST_AsGeoJSON(t.geometry)::json AS geojson
     FROM public.troncon t
     JOIN public.chantier c ON c.id = t.chantier_id
     WHERE t.id = $1`,
    [tronconId]
  );

  if (tronconRes.rows.length === 0) {
    throw new Error('Tronçon introuvable.');
  }

  const troncon = tronconRes.rows[0];

  // 2. Select dynamic projected measurement CRS
  const measCrs = crsService.getMeasurementCrs(troncon.geojson);

  // 3. PostGIS orthogonal projection and metric distance computation
  const spatialQuery = `
    WITH base AS (
      SELECT 
        t.geometry AS t_geom,
        t.pk_debut,
        t.pk_fin,
        ST_SetSRID(ST_MakePoint($2, $3), 4326) AS gps_pt,
        $4::int AS meas_srid
      FROM public.troncon t
      WHERE t.id = $1
    ),
    metric AS (
      SELECT
        t_geom,
        pk_debut,
        pk_fin,
        gps_pt,
        meas_srid,
        ST_Transform(t_geom, meas_srid) AS t_metric,
        ST_Transform(gps_pt, meas_srid) AS gps_metric
      FROM base
    ),
    comp AS (
      SELECT
        pk_debut,
        pk_fin,
        ST_Length(t_metric) AS total_length_m,
        ST_LineLocatePoint(t_metric, gps_metric) AS locate_fraction,
        ST_ClosestPoint(t_metric, gps_metric) AS closest_pt_metric,
        ST_Distance(t_metric, gps_metric) AS offset_distance_m
      FROM metric
    )
    SELECT
      ROUND(total_length_m::numeric, 2) AS total_length_meters,
      ROUND((total_length_m / 1000.0)::numeric, 3) AS total_length_km,
      ROUND(locate_fraction::numeric, 6) AS fraction,
      ROUND((locate_fraction * total_length_m)::numeric, 2) AS distance_from_start_meters,
      ROUND(((locate_fraction * total_length_m) / total_length_m * 100.0)::numeric, 2) AS raw_progress_percentage,
      ROUND((COALESCE(pk_debut, 0) + (locate_fraction * total_length_m) / 1000.0)::numeric, 3) AS calculated_pk,
      ST_X(ST_Transform(closest_pt_metric, 4326)) AS projected_lng,
      ST_Y(ST_Transform(closest_pt_metric, 4326)) AS projected_lat,
      ROUND(offset_distance_m::numeric, 2) AS offset_distance_meters
    FROM comp;
  `;

  const spatialRes = await db.query(spatialQuery, [
    tronconId,
    agentLng,
    agentLat,
    measCrs.srid,
  ]);

  if (spatialRes.rows.length === 0) {
    throw new Error('Erreur lors du calcul géospatial de projection.');
  }

  const row = spatialRes.rows[0];

  // Clamp progress percentage strictly to [0.0, 100.0]
  const rawPct = parseFloat(row.raw_progress_percentage) || 0;
  const progressPercentage = Math.min(100.0, Math.max(0.0, rawPct));

  return {
    troncon_id: troncon.id,
    chantier_id: troncon.chantier_id,
    troncon_nom: troncon.nom,
    pk_debut: troncon.pk_debut,
    pk_fin: troncon.pk_fin,
    measurement_crs: {
      srid: measCrs.srid,
      code: measCrs.code,
      name: measCrs.name,
      unit: 'mètres',
    },
    agent_location: {
      latitude: parseFloat(agentLat),
      longitude: parseFloat(agentLng),
      accuracy: accuracy ? parseFloat(accuracy) : null,
    },
    projected_location: {
      latitude: parseFloat(row.projected_lat),
      longitude: parseFloat(row.projected_lng),
    },
    distance_from_start_meters: parseFloat(row.distance_from_start_meters) || 0,
    distance_from_start_km: Number(((parseFloat(row.distance_from_start_meters) || 0) / 1000.0).toFixed(3)),
    total_length_meters: parseFloat(row.total_length_meters) || 0,
    total_length_km: parseFloat(row.total_length_km) || 0,
    fraction: parseFloat(row.fraction) || 0,
    progress_percentage: Number(progressPercentage.toFixed(2)),
    calculated_pk: parseFloat(row.calculated_pk) || 0,
    offset_distance_meters: parseFloat(row.offset_distance_meters) || 0,
    d_max_position_meters: parseFloat(troncon.d_max_position_meters),
    proximity_status: (parseFloat(row.offset_distance_meters) || 0) <= parseFloat(troncon.d_max_position_meters)
      ? 'normal'
      : 'exceptional_confirmation_required',
    requires_exceptional_confirmation:
      (parseFloat(row.offset_distance_meters) || 0) > parseFloat(troncon.d_max_position_meters),
  };
}

/**
 * POST /agent/troncon/:id/calculate-projection
 * Previews the orthogonal projection of an A.T. GPS coordinate onto the tronçon.
 */
async function calculateProjection(req, res) {
  try {
    const { id } = req.params;
    const { latitude, longitude, accuracy } = req.body;
    const agentId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // 1. Validation
    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ message: 'Coordonnées GPS (latitude, longitude) requises.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Coordonnées GPS invalides.' });
    }

    // 2. Verify Assignment
    const checkRes = await db.query(
      `SELECT t.id, a.id AS affectation_id
       FROM public.troncon t
       LEFT JOIN public.affectation_troncon a ON a.troncon_id = t.id AND a.agent_id = $2 AND a.statut = 'ACTIF'
       WHERE t.id = $1 AND (a.agent_id = $2 OR $3 = true);`,
      [id, agentId, isAdmin]
    );

    if (checkRes.rows.length === 0) {
      return res.status(403).json({
        message: 'Accès non autorisé : vous n\'êtes pas affecté à ce tronçon.',
      });
    }

    // 3. Compute projection
    const projectionResult = await performTronconProjection(id, lat, lng, accuracy);

    return res.status(200).json(projectionResult);
  } catch (error) {
    console.error('❌ CalculateProjection error:', error.message);
    return res.status(500).json({
      message: error.message || 'Erreur lors du calcul de la projection géospatiale.',
    });
  }
}

/**
 * POST /agent/troncon/:id/observations
 * Records a new field observation with:
 * - Spatial projection & progress calculation
 * - Controlled construction phase
 * - Controlled phase status
 * - Field comment
 * - Attached photos (saved to disk and recorded in public.photo_terrain)
 */
async function createObservation(req, res) {
  try {
    const { id } = req.params;
    const body = req.body || {};
    const { latitude, longitude, accuracy, phase, phase_statut, commentaire, type_observation } = body;
    const exceptionalConfirmed = body.exceptional_confirmation === true || body.exceptional_confirmation === 'true';
    const agentId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    // 1. Validation GPS
    if (latitude === undefined || longitude === undefined || latitude === null || longitude === null) {
      return res.status(400).json({ message: 'Coordonnées GPS requises pour déclarer une observation.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Coordonnées GPS invalides.' });
    }

    // 2. Validate Phase & Status against controlled lists
    let selectedPhase = phase || 'Terrassement';
    if (!ALLOWED_PHASES.includes(selectedPhase)) {
      return res.status(400).json({
        message: `Phase invalide. Les phases autorisées sont : ${ALLOWED_PHASES.join(', ')}`,
      });
    }

    let selectedPhaseStatut = phase_statut || 'En cours';
    if (!ALLOWED_PHASE_STATUSES.includes(selectedPhaseStatut)) {
      return res.status(400).json({
        message: `Statut de phase invalide. Les statuts autorisés sont : ${ALLOWED_PHASE_STATUSES.join(', ')}`,
      });
    }

    // 3. Verify Assignment
    const checkRes = await db.query(
      `SELECT t.id, t.chantier_id, a.id AS affectation_id
       FROM public.troncon t
       LEFT JOIN public.affectation_troncon a ON a.troncon_id = t.id AND a.agent_id = $2 AND a.statut = 'ACTIF'
       WHERE t.id = $1 AND (a.agent_id = $2 OR $3 = true);`,
      [id, agentId, isAdmin]
    );

    if (checkRes.rows.length === 0) {
      return res.status(403).json({
        message: 'Accès non autorisé : vous n\'êtes pas affecté à ce tronçon.',
      });
    }

    const chantierId = checkRes.rows[0].chantier_id;

    // 4. Compute spatial projection
    const proj = await performTronconProjection(id, lat, lng, accuracy);
    const validationStatus = proj.requires_exceptional_confirmation ? 'exceptional' : 'normal';
    if (proj.requires_exceptional_confirmation && !exceptionalConfirmed) {
      return res.status(409).json({
        message: `Vous êtes à ${proj.offset_distance_meters} m de l'infrastructure. La distance maximale recommandée pour ce chantier est de ${proj.d_max_position_meters} m. Une validation exceptionnelle explicite est requise.`,
        code: 'EXCEPTIONAL_CONFIRMATION_REQUIRED',
        projection: proj,
      });
    }

    // 5. Calculate today's baseline and the non-regressing authoritative progression.
    // CURRENT_DATE intentionally follows the database's local calendar day.
    const progressStateRes = await db.query(`
      SELECT
        COALESCE(MAX(distance_from_start) FILTER (WHERE date_heure < CURRENT_DATE), 0) AS daily_baseline_meters,
        COALESCE(MAX(distance_from_start), 0) AS previous_authoritative_meters
      FROM public.observation_terrain
      WHERE troncon_id = $1
    `, [id]);
    const totalLengthMeters = proj.total_length_meters || 0;
    const currentMetricMeters = proj.distance_from_start_meters;
    const dailyBaselineMeters = parseFloat(progressStateRes.rows[0]?.daily_baseline_meters) || 0;
    const previousAuthoritativeMeters = parseFloat(progressStateRes.rows[0]?.previous_authoritative_meters) || 0;
    const {
      dailyProgressMeters,
      dailyProgressPercentage,
      authoritativeProgressMeters,
      authoritativeProgressPercentage,
    } = calculateObservationProgress({
      currentMetricMeters,
      totalLengthMeters,
      dailyBaselineMeters,
      previousAuthoritativeMeters,
    });

    // 6. Insert into public.observation_terrain (Historical Timeline)
    const insertQuery = `
      INSERT INTO public.observation_terrain (
        chantier_id,
        troncon_id,
        agent_id,
        date_heure,
        agent_lat,
        agent_lng,
        projected_lat,
        projected_lng,
        distance_from_start,
        progress_percentage,
        chainage,
        position_gps,
        position_projetee,
        accuracy,
        distance_offset,
        phase,
        phase_statut,
        statut,
        type_observation,
        commentaire,
        validation_status,
        daily_progress_meters,
        daily_progress_percentage,
        authoritative_progress_meters,
        authoritative_progress_percentage
      )
      VALUES (
        $1, $2, $3, NOW(),
        $4, $5, $6, $7,
        $8, $9, $10,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        ST_SetSRID(ST_MakePoint($7, $6), 4326),
        $11, $12, $13, $14,
        'EN_COURS',
        COALESCE($15, 'OBSERVATION_PROGRESSION'),
        $16,
        $17, $18, $19, $20, $21
      )
      RETURNING 
        id,
        chantier_id,
        troncon_id,
        agent_id,
        TO_CHAR(date_heure, 'YYYY-MM-DD HH24:MI:SS') AS date_heure,
        agent_lat,
        agent_lng,
        projected_lat,
        projected_lng,
        distance_from_start,
        progress_percentage,
        chainage,
        accuracy,
        distance_offset,
        phase,
        phase_statut,
        statut,
        type_observation,
        commentaire,
        validation_status,
        daily_progress_meters,
        daily_progress_percentage,
        authoritative_progress_meters,
        authoritative_progress_percentage;
    `;

    const insertRes = await db.query(insertQuery, [
      chantierId,
      id,
      agentId,
      proj.agent_location.latitude,
      proj.agent_location.longitude,
      proj.projected_location.latitude,
      proj.projected_location.longitude,
      proj.distance_from_start_meters,
      proj.progress_percentage,
      proj.calculated_pk,
      proj.agent_location.accuracy,
      proj.offset_distance_meters,
      selectedPhase,
      selectedPhaseStatut,
      type_observation || 'OBSERVATION_PROGRESSION',
      commentaire || null,
      validationStatus,
      Number(dailyProgressMeters.toFixed(2)),
      Number(dailyProgressPercentage.toFixed(2)),
      Number(authoritativeProgressMeters.toFixed(2)),
      Number(authoritativeProgressPercentage.toFixed(2)),
    ]);

    const createdObs = insertRes.rows[0];
    await db.query(`
      UPDATE public.troncon
      SET authoritative_progress_meters = GREATEST(COALESCE(authoritative_progress_meters, 0), $2),
          avancement = GREATEST(COALESCE(avancement, 0), $3)
      WHERE id = $1
    `, [id, authoritativeProgressMeters, Math.round(authoritativeProgressPercentage)]);
    const savedPhotos = [];

    // 6. Handle Photos Attachment
    // A) Multer uploaded files (multipart/form-data)
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const fileUrl = `/uploads/observations/${file.filename}`;
        const photoRes = await db.query(
          `INSERT INTO public.photo_terrain (observation_id, fichier, date_prise, position_gps, description)
           VALUES ($1, $2, NOW(), ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)
           RETURNING id, fichier AS url, TO_CHAR(date_prise, 'YYYY-MM-DD HH24:MI') AS date_prise, description;`,
          [createdObs.id, fileUrl, proj.agent_location.longitude, proj.agent_location.latitude, selectedPhase]
        );
        if (photoRes.rows.length > 0) {
          savedPhotos.push(photoRes.rows[0]);
        }
      }
    }

    // B) JSON base64 photos array
    let jsonPhotos = body.photos;
    if (typeof jsonPhotos === 'string') {
      try { jsonPhotos = JSON.parse(jsonPhotos); } catch (e) {}
    }

    if (Array.isArray(jsonPhotos) && jsonPhotos.length > 0) {
      const uploadDir = path.join(__dirname, '../../uploads/observations');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      for (let i = 0; i < jsonPhotos.length; i++) {
        const p = jsonPhotos[i];
        if (typeof p === 'string' && p.startsWith('data:image')) {
          // Base64 Data URL
          const matches = p.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
          if (matches) {
            const ext = matches[1] === 'jpeg' ? '.jpg' : `.${matches[1]}`;
            const buffer = Buffer.from(matches[2], 'base64');
            const filename = `obs_${agentId}_${Date.now()}_${i}${ext}`;
            const filePath = path.join(uploadDir, filename);
            fs.writeFileSync(filePath, buffer);
            const fileUrl = `/uploads/observations/${filename}`;

            const photoRes = await db.query(
              `INSERT INTO public.photo_terrain (observation_id, fichier, date_prise, position_gps, description)
               VALUES ($1, $2, NOW(), ST_SetSRID(ST_MakePoint($3, $4), 4326), $5)
               RETURNING id, fichier AS url, TO_CHAR(date_prise, 'YYYY-MM-DD HH24:MI') AS date_prise, description;`,
              [createdObs.id, fileUrl, proj.agent_location.longitude, proj.agent_location.latitude, selectedPhase]
            );
            if (photoRes.rows.length > 0) {
              savedPhotos.push(photoRes.rows[0]);
            }
          }
        }
      }
    }

    createdObs.photos = savedPhotos;

    return res.status(201).json({
      message: 'Observation de terrain enregistrée avec succès.',
      observation: createdObs,
      projection: proj,
    });
  } catch (error) {
    console.error('❌ CreateObservation error:', error.message);
    return res.status(500).json({
      message: error.message || 'Erreur lors de l\'enregistrement de l\'observation.',
    });
  }
}

async function getObservationHistory(req, res) {
  try {
    const { id } = req.params;
    const agentId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : null;
    const access = await db.query(
      `SELECT 1 FROM public.troncon t
       LEFT JOIN public.affectation_troncon a ON a.troncon_id = t.id AND a.agent_id = $2 AND a.statut = 'ACTIF'
       WHERE t.id = $1 AND (a.agent_id = $2 OR $3 = true)`, [id, agentId, isAdmin]
    );
    if (!access.rows.length) return res.status(403).json({ message: 'Accès non autorisé à cet historique.' });

    const result = await db.query(
      `SELECT ot.id, ot.chantier_id, ot.troncon_id, ot.agent_id,
              TO_CHAR(ot.date_heure, 'YYYY-MM-DD HH24:MI:SS') AS date_heure,
              ot.agent_lat, ot.agent_lng, ot.projected_lat, ot.projected_lng,
              ot.distance_from_start, ot.progress_percentage, ot.chainage, ot.accuracy,
              ot.distance_offset, ot.validation_status, ot.statut, ot.type_observation,
              ot.daily_progress_meters, ot.daily_progress_percentage,
              ot.authoritative_progress_meters, ot.authoritative_progress_percentage,
              COALESCE(ot.phase, 'Terrassement') AS phase,
              COALESCE(ot.phase_statut, 'En cours') AS phase_statut, ot.commentaire,
              TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
              COALESCE(JSON_AGG(JSON_BUILD_OBJECT('id', pt.id, 'url', pt.fichier,
                'date_prise', TO_CHAR(pt.date_prise, 'YYYY-MM-DD HH24:MI'), 'description', pt.description))
                FILTER (WHERE pt.id IS NOT NULL), '[]'::json) AS photos
       FROM public.observation_terrain ot
       JOIN public.utilisateur u ON u.id = ot.agent_id
       LEFT JOIN public.photo_terrain pt ON pt.observation_id = ot.id
       WHERE ot.troncon_id = $1
         AND ($2::text IS NULL OR TO_CHAR(ot.date_heure, 'YYYY-MM') = $2)
       GROUP BY ot.id, u.nom, u.prenom
       ORDER BY ot.date_heure DESC, ot.id DESC`, [id, month]
    );
    return res.json({ month, observations: result.rows });
  } catch (error) {
    console.error('❌ GetObservationHistory error:', error.message);
    return res.status(500).json({ message: 'Impossible de charger l’historique des observations.' });
  }
}

module.exports = {
  ALLOWED_PHASES,
  ALLOWED_PHASE_STATUSES,
  getAgentDashboard,
  getAgentTronconDetails,
  calculateProjection,
  createObservation,
  getObservationHistory,
};
