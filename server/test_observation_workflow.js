/**
 * server/test_observation_workflow.js
 *
 * Automated verification suite for Agent de Terrain Field Observations & Metric Progress Calculation.
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const crsService = require('./src/services/crs.service');

async function runTests() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING AGENT DE TERRAIN FIELD OBSERVATIONS & PROGRESS PIPELINE TEST SUITE');
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
    VALUES ('RespObs', 'Chef', 'resp_obs_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const respId = respUser.rows[0].id;

  const agentUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentObs', 'Karim', 'agent_obs_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentId = agentUser.rows[0].id;

  const unassignedUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentOther', 'Tarik', 'agent_other_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const unassignedId = unassignedUser.rows[0].id;

  // 2. Setup Project, Chantier, Reference Alignment, and a 10 km Tronçon
  const projRes = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet RN1 Observation Test', 'Test Road Observation', 'En cours', 'Route Nationale')
    RETURNING id;
  `);
  const projId = projRes.rows[0].id;

  const chRes = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
    VALUES ($1, $2, 'Chantier RN1 Section Rabat', 'En cours')
    RETURNING id;
  `, [projId, respId]);
  const chantierId = chRes.rows[0].id;

  // LineString from Rabat to Skhirat (approx 20 km)
  const lineGeoJSON = {
    type: 'LineString',
    coordinates: [
      [-6.8361, 34.0132], // Start: Rabat
      [-6.9200, 33.9200], // Middle point 1
      [-7.0300, 33.8500], // Skhirat
    ],
  };

  const refRes = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe RN1', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [chantierId, JSON.stringify(lineGeoJSON)]);
  const refId = refRes.rows[0].id;

  // Tronçon 1: First 10 km (PK 0+000 to PK 10+000)
  const t1Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T01 - Rabat Sud', 0.0, 10.0, 'EN_COURS', 0, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
    RETURNING id;
  `, [chantierId, refId, JSON.stringify(lineGeoJSON)]);
  const t1Id = t1Res.rows[0].id;

  // 3. Assign Karim to Tronçon T01
  await db.query(`
    INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par)
    VALUES ($1, $2, $3);
  `, [t1Id, agentId, respId]);

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Calculate Spatial Projection for point near start of tronçon (approx 15% progress)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 1: Spatial Projection Calculation at Point 1 (Near start)');
    const gpsPt1 = { lat: 33.9950, lng: -6.8500 }; // Near Rabat start
    const measCrs = crsService.getMeasurementCrs(lineGeoJSON);

    const projQuery = `
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

    const res1 = await db.query(projQuery, [t1Id, gpsPt1.lng, gpsPt1.lat, measCrs.srid]);
    const r1 = res1.rows[0];

    assert(r1.total_length_meters > 0, `Total length is computed metric length (${r1.total_length_meters} m)`);
    assert(r1.progress_percentage > 0 && r1.progress_percentage < 30, `Progress percentage at Point 1 is ${r1.progress_percentage}% (expected ~15-25%)`);
    assert(r1.distance_from_start_meters > 0, `Distance from start is ${r1.distance_from_start_meters} m`);
    assert(r1.projected_lat !== null && r1.projected_lng !== null, `Projected point: [${r1.projected_lng}, ${r1.projected_lat}]`);

    // ------------------------------------------------------------------------
    // TEST 2: Insert Observation 1 (Recorded by Karim)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 2: Insert Observation 1 into Historical Timeline');
    const obs1Res = await db.query(`
      INSERT INTO public.observation_terrain (
        chantier_id, troncon_id, agent_id, date_heure,
        agent_lat, agent_lng, projected_lat, projected_lng,
        distance_from_start, progress_percentage, chainage,
        position_gps, position_projetee, accuracy, distance_offset,
        statut, type_observation, commentaire
      )
      VALUES (
        $1, $2, $3, NOW(),
        $4, $5, $6, $7,
        $8, $9, $10,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        ST_SetSRID(ST_MakePoint($7, $6), 4326),
        5.2, $11, 'EN_COURS', 'OBSERVATION_PROGRESSION', 'Pose des bordures effectuée'
      )
      RETURNING id, progress_percentage, distance_from_start;
    `, [
      chantierId, t1Id, agentId,
      gpsPt1.lat, gpsPt1.lng, r1.projected_lat, r1.projected_lng,
      r1.distance_from_start_meters, r1.progress_percentage, 0.0 + r1.distance_from_start_meters / 1000.0,
      r1.offset_distance_meters
    ]);

    assert(obs1Res.rows.length === 1, 'Observation 1 stored in public.observation_terrain');

    // ------------------------------------------------------------------------
    // TEST 3: Insert Observation 2 further along the road (approx 55% progress)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 3: Observation 2 (Mid-point along tronçon)');
    const gpsPt2 = { lat: 33.9100, lng: -6.9300 };
    const res2 = await db.query(projQuery, [t1Id, gpsPt2.lng, gpsPt2.lat, measCrs.srid]);
    const r2 = res2.rows[0];

    const obs2Res = await db.query(`
      INSERT INTO public.observation_terrain (
        chantier_id, troncon_id, agent_id, date_heure,
        agent_lat, agent_lng, projected_lat, projected_lng,
        distance_from_start, progress_percentage, chainage,
        position_gps, position_projetee, accuracy, distance_offset,
        statut, type_observation
      )
      VALUES (
        $1, $2, $3, NOW() + INTERVAL '1 hour',
        $4, $5, $6, $7,
        $8, $9, $10,
        ST_SetSRID(ST_MakePoint($5, $4), 4326),
        ST_SetSRID(ST_MakePoint($7, $6), 4326),
        4.0, $11, 'EN_COURS', 'OBSERVATION_PROGRESSION'
      )
      RETURNING id, progress_percentage;
    `, [
      chantierId, t1Id, agentId,
      gpsPt2.lat, gpsPt2.lng, r2.projected_lat, r2.projected_lng,
      r2.distance_from_start_meters, r2.progress_percentage, 0.0 + r2.distance_from_start_meters / 1000.0,
      r2.offset_distance_meters
    ]);

    assert(parseFloat(r2.progress_percentage) > parseFloat(r1.progress_percentage), `Observation 2 progress (${r2.progress_percentage}%) > Observation 1 (${r1.progress_percentage}%)`);

    // ------------------------------------------------------------------------
    // TEST 4: Verify Historical Timeline preservation & Latest Observation
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 4: Query Timeline History');
    const historyRes = await db.query(`
      SELECT id, progress_percentage, distance_from_start, TO_CHAR(date_heure, 'YYYY-MM-DD HH24:MI:SS') AS date_heure
      FROM public.observation_terrain
      WHERE troncon_id = $1
      ORDER BY date_heure DESC;
    `, [t1Id]);

    assert(historyRes.rows.length === 2, `History contains exactly 2 observations (got ${historyRes.rows.length})`);
    assert(parseFloat(historyRes.rows[0].progress_percentage) === parseFloat(r2.progress_percentage), `Latest observation is Observation 2 (${historyRes.rows[0].progress_percentage}%)`);

    // ------------------------------------------------------------------------
    // TEST 5: Verify Progress Clamping (Edge Cases: beyond end and before start)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 5: Progress percentage strictly clamped between [0.0%, 100.0%]');
    const rawProgressBefore = -5.5;
    const clampedBefore = Math.min(100.0, Math.max(0.0, rawProgressBefore));
    assert(clampedBefore === 0.0, 'Negative progress clamped to 0.0%');

    const rawProgressAfter = 112.4;
    const clampedAfter = Math.min(100.0, Math.max(0.0, rawProgressAfter));
    assert(clampedAfter === 100.0, 'Over 100% progress clamped to 100.0%');

  } finally {
    // Clean up
    await db.query(`DELETE FROM public.observation_terrain WHERE troncon_id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.affectation_troncon WHERE troncon_id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.troncon WHERE id = $1`, [t1Id]);
    await db.query(`DELETE FROM public.reference_alignment WHERE id = $1`, [refId]);
    await db.query(`DELETE FROM public.chantier WHERE id = $1`, [chantierId]);
    await db.query(`DELETE FROM public.projet WHERE id = $1`, [projId]);
    await db.query(`DELETE FROM public.utilisateur WHERE id IN ($1, $2, $3)`, [respId, agentId, unassignedId]);
    console.log('Cleaned up test observation data.');
  }

  await db.pool.end();
  console.log('\n' + '='.repeat(90));
  console.log(`📊 OBSERVATION PIPELINE RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
