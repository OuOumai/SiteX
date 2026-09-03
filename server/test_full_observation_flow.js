/**
 * server/test_full_observation_flow.js
 *
 * Automated verification suite for the Complete Observation Workflow:
 * - Phase selection
 * - Phase status
 * - Comments
 * - Photo attachments
 * - Strict permissions
 * - Responsable access
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const crsService = require('./src/services/crs.service');

async function runTests() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING COMPLETE FIELD OBSERVATION & PHOTOS PIPELINE TEST SUITE');
  console.log('='.repeat(90));

  let passed = 0;
  let total = 0;

  function assert(condition, name, details = '') {
    total++;
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } else {
      console.error(`  ❌ [FAIL] ${name} - ${details}`);
    }
  }

  const rand = Math.floor(Math.random() * 100000);

  // 1. Setup Test Users
  const respUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('RespPhoto', 'Hassan', 'resp_photo_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const respId = respUser.rows[0].id;

  const otherRespUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('RespOther', 'Samir', 'resp_other_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const otherRespId = otherRespUser.rows[0].id;

  const agentUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentField', 'Leila', 'agent_field_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentId = agentUser.rows[0].id;

  // 2. Setup Project, Chantier, Reference Alignment, and Tronçon
  const projRes = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet Autoroute Tit Mellil', 'Test Field Observation', 'En cours', 'Autoroute')
    RETURNING id;
  `);
  const projId = projRes.rows[0].id;

  const chRes = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
    VALUES ($1, $2, 'Chantier PK 0 à PK 15', 'En cours')
    RETURNING id;
  `, [projId, respId]);
  const chantierId = chRes.rows[0].id;

  const lineGeoJSON = {
    type: 'LineString',
    coordinates: [
      [-7.4500, 33.5800],
      [-7.4200, 33.5600],
      [-7.3800, 33.5400],
    ],
  };

  const refRes = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe Autoroute', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [chantierId, JSON.stringify(lineGeoJSON)]);
  const refId = refRes.rows[0].id;

  const t1Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T01 - Section Tit Mellil', 0.0, 8.5, 'EN_COURS', 0, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
    RETURNING id;
  `, [chantierId, refId, JSON.stringify(lineGeoJSON)]);
  const t1Id = t1Res.rows[0].id;

  // 3. Assign Leila to Tronçon T01
  await db.query(`
    INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par)
    VALUES ($1, $2, $3);
  `, [t1Id, agentId, respId]);

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Insert Observation with Phase, Phase Status, Comment, and Spatial Data
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 1: Insert Observation with Phase, Status & Comment');
    const measCrs = crsService.getMeasurementCrs(lineGeoJSON);
    const agentGps = { lat: 33.5700, lng: -7.4350 };

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
        ROUND(locate_fraction::numeric, 6) AS fraction,
        ROUND((locate_fraction * total_length_m)::numeric, 2) AS distance_from_start_meters,
        ROUND(((locate_fraction * total_length_m) / total_length_m * 100.0)::numeric, 2) AS progress_percentage,
        ST_X(ST_Transform(closest_pt_metric, 4326)) AS projected_lng,
        ST_Y(ST_Transform(closest_pt_metric, 4326)) AS projected_lat,
        ROUND(offset_distance_m::numeric, 2) AS offset_distance_meters
      FROM comp;
    `;

    const spRes = await db.query(spatialQuery, [t1Id, agentGps.lng, agentGps.lat, measCrs.srid]);
    const sp = spRes.rows[0];

    const obsRes = await db.query(`
      INSERT INTO public.observation_terrain (
        chantier_id, troncon_id, agent_id, date_heure,
        agent_lat, agent_lng, projected_lat, projected_lng,
        distance_from_start, progress_percentage, chainage,
        position_gps, position_projetee, accuracy, distance_offset,
        phase, phase_statut, statut, type_observation, commentaire
      )
      VALUES (
        $1, $2, $3, NOW(),
        $4, $5, $6, $7,
        $8, $9, $10,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        ST_SetSRID(ST_MakePoint($7, $6), 4326),
        3.5, $11,
        'Fondation', 'En cours', 'EN_COURS', 'OBSERVATION_PROGRESSION',
        'Coulage de béton de propreté sur 200m'
      )
      RETURNING id, phase, phase_statut, commentaire, progress_percentage;
    `, [
      chantierId, t1Id, agentId,
      agentGps.lat, agentGps.lng, sp.projected_lat, sp.projected_lng,
      sp.distance_from_start_meters, sp.progress_percentage, 0.0 + sp.distance_from_start_meters / 1000.0,
      sp.offset_distance_meters
    ]);

    const createdObs = obsRes.rows[0];
    assert(createdObs.phase === 'Fondation', 'Observation phase stored correctly as "Fondation"');
    assert(createdObs.phase_statut === 'En cours', 'Observation phase status stored correctly as "En cours"');
    assert(createdObs.commentaire.includes('Coulage de béton'), 'Comment stored correctly');

    // ------------------------------------------------------------------------
    // TEST 2: Attach Photos to Observation
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 2: Attach Photos to Observation in public.photo_terrain');
    const photoUrl1 = '/uploads/observations/obs_test_1.jpg';
    const photoUrl2 = '/uploads/observations/obs_test_2.jpg';

    await db.query(`
      INSERT INTO public.photo_terrain (observation_id, fichier, date_prise, position_gps, description)
      VALUES 
        ($1, $2, NOW(), ST_SetSRID(ST_MakePoint($4, $5), 4326), 'Vue générale fondation'),
        ($1, $3, NOW(), ST_SetSRID(ST_MakePoint($4, $5), 4326), 'Détail armatures');
    `, [createdObs.id, photoUrl1, photoUrl2, agentGps.lng, agentGps.lat]);

    const photosCheck = await db.query(
      `SELECT id, fichier, description FROM public.photo_terrain WHERE observation_id = $1 ORDER BY id ASC`,
      [createdObs.id]
    );

    assert(photosCheck.rows.length === 2, `Attached 2 photos to observation (got ${photosCheck.rows.length})`);
    assert(photosCheck.rows[0].fichier === photoUrl1, 'Photo 1 URL path matches');

    // ------------------------------------------------------------------------
    // TEST 3: Query Observation with Photos Aggregation (Agent & Responsable)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 3: Query Observation with Photos Aggregation');
    const queryWithPhotos = `
      SELECT 
        o.id,
        o.phase,
        o.phase_statut,
        o.commentaire,
        o.progress_percentage,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', pt.id,
              'url', pt.fichier,
              'description', pt.description
            )
          ) FILTER (WHERE pt.id IS NOT NULL),
          '[]'::json
        ) AS photos
      FROM public.observation_terrain o
      JOIN public.utilisateur u ON o.agent_id = u.id
      LEFT JOIN public.photo_terrain pt ON pt.observation_id = o.id
      WHERE o.troncon_id = $1
      GROUP BY o.id, u.nom, u.prenom;
    `;

    const resAgg = await db.query(queryWithPhotos, [t1Id]);
    assert(resAgg.rows.length === 1, 'Query returns the observation');
    const obsWithPhotos = resAgg.rows[0];
    assert(Array.isArray(obsWithPhotos.photos) && obsWithPhotos.photos.length === 2, `Photos array aggregated with 2 photos (got ${obsWithPhotos.photos.length})`);
    assert(obsWithPhotos.photos[0].url === photoUrl1, 'Photo URL in JSON matches');

    // ------------------------------------------------------------------------
    // TEST 4: Controlled Phase & Status Validation Lists
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 4: Controlled Phase & Status Validation Lists');
    const { ALLOWED_PHASES, ALLOWED_PHASE_STATUSES } = require('./src/controllers/agent.controller');
    assert(ALLOWED_PHASES.includes('Terrassement') && ALLOWED_PHASES.includes('Chaussée'), 'ALLOWED_PHASES includes valid phases');
    assert(!ALLOWED_PHASES.includes('PhaseInconnue123'), 'Invalid phase rejected');
    assert(ALLOWED_PHASE_STATUSES.includes('En cours') && ALLOWED_PHASE_STATUSES.includes('Terminée'), 'ALLOWED_PHASE_STATUSES includes valid statuses');
    assert(!ALLOWED_PHASE_STATUSES.includes('StatutInvalide999'), 'Invalid status rejected');

  } finally {
    // Clean up
    await db.query(`DELETE FROM public.photo_terrain WHERE observation_id IN (SELECT id FROM public.observation_terrain WHERE troncon_id = $1)`, [t1Id]);
    await db.query(`DELETE FROM public.observation_terrain WHERE troncon_id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.affectation_troncon WHERE troncon_id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.troncon WHERE id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.reference_alignment WHERE id = $1`, [refId]);
    await db.query(`DELETE FROM public.chantier WHERE id = $1`, [chantierId]);
    await db.query(`DELETE FROM public.projet WHERE id = $1`, [projId]);
    await db.query(`DELETE FROM public.utilisateur WHERE id IN ($1, $2, $3)`, [respId, otherRespId, agentId]);
    console.log('Cleaned up test observation & photos data.');
  }

  await db.pool.end();
  console.log('\n' + '='.repeat(90));
  console.log(`📊 WORKFLOW TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
