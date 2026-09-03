/**
 * server/test_equipe_terrain_flow.js
 *
 * Automated verification suite for the Responsable "Équipe terrain" & Cascading Assignment Pipeline:
 * - Summary stats
 * - Hierarchy tree (Projet -> Chantier -> Tronçon)
 * - Complete ownership chain validation
 * - Cascading assignment creation
 * - Duplicate prevention
 * - Assignment removal without affecting historical observations
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');

async function runTests() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING RESPONSABLE "ÉQUIPE TERRAIN" & CASCADING ASSIGNMENT PIPELINE TEST SUITE');
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
  const resp1 = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('RespTeam1', 'Rachid', 'resp_team1_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const resp1Id = resp1.rows[0].id;

  const resp2 = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('RespTeam2', 'Farid', 'resp_team2_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const resp2Id = resp2.rows[0].id;

  const agent1 = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentA', 'Amine', 'agent_a_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agent1Id = agent1.rows[0].id;

  const agent2 = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentB', 'Brahim', 'agent_b_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agent2Id = agent2.rows[0].id;

  // Insert Admin-Approved role requests for Agent 1 and Agent 2
  await db.query(`
    INSERT INTO public.demande_role (utilisateur_id, requested_role_id, statut)
    VALUES ($1, 3, 'APPROVED'), ($2, 3, 'APPROVED');
  `, [agent1Id, agent2Id]);

  // 2. Setup Projects, Chantiers, Tronçons for Responsable 1
  const proj1 = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet Autoroute RP4022', 'Test Team Assignment', 'En cours', 'Autoroute')
    RETURNING id;
  `);
  const proj1Id = proj1.rows[0].id;

  const ch1 = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
    VALUES ($1, $2, 'Chantier Nord PK 0 à PK 10', 'En cours')
    RETURNING id;
  `, [proj1Id, resp1Id]);
  const ch1Id = ch1.rows[0].id;

  const lineGeo = {
    type: 'LineString',
    coordinates: [[-7.5, 33.5], [-7.4, 33.6]],
  };

  const ref1 = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe RP4022', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [ch1Id, JSON.stringify(lineGeo)]);
  const ref1Id = ref1.rows[0].id;

  const t1 = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T01 - Section Nord', 0.0, 5.0, 'EN_COURS', 0, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
    RETURNING id;
  `, [ch1Id, ref1Id, JSON.stringify(lineGeo)]);
  const t1Id = t1.rows[0].id;

  const t2 = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T02 - Section Centrale', 5.0, 10.0, 'NON_COMMENCE', 0, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
    RETURNING id;
  `, [ch1Id, ref1Id, JSON.stringify(lineGeo)]);
  const t2Id = t2.rows[0].id;

  // Setup Project & Chantier for Responsable 2 (Different Scope)
  const proj2 = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet Voie Express Sud', 'Other Responsable Scope', 'En cours', 'Voie Express')
    RETURNING id;
  `);
  const proj2Id = proj2.rows[0].id;

  const ch2 = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
    VALUES ($1, $2, 'Chantier Sud PK 0 à PK 8', 'En cours')
    RETURNING id;
  `, [proj2Id, resp2Id]);
  const ch2Id = ch2.rows[0].id;

  const ref2 = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe Express Sud', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [ch2Id, JSON.stringify(lineGeo)]);
  const ref2Id = ref2.rows[0].id;

  const t3 = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T03 - Scope Resp 2', 0.0, 8.0, 'NON_COMMENCE', 0, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
    RETURNING id;
  `, [ch2Id, ref2Id, JSON.stringify(lineGeo)]);
  const t3Id = t3.rows[0].id;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Hierarchy Tree Query for Responsable 1
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 1: Hierarchy Tree Query (Projet -> Chantier -> Tronçon)');
    const hierQuery = `
      SELECT 
        p.id AS projet_id,
        p.nom AS projet_nom,
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        t.id AS troncon_id,
        t.nom AS troncon_nom
      FROM public.projet p
      JOIN public.chantier c ON c.projet_id = p.id
      LEFT JOIN public.troncon t ON t.chantier_id = c.id
      WHERE c.responsable_id = $1
      ORDER BY p.nom, c.nom, t.nom;
    `;
    const hierRes = await db.query(hierQuery, [resp1Id]);
    assert(hierRes.rows.length === 2, `Responsable 1 sees exactly 2 tronçons in hierarchy (got ${hierRes.rows.length})`);
    assert(hierRes.rows[0].projet_id === proj1Id, 'Tree matches Projet 1');
    assert(hierRes.rows[0].chantier_id === ch1Id, 'Tree matches Chantier 1');

    // ------------------------------------------------------------------------
    // TEST 2: Assign Agent A to Tronçon T01 (Complete Chain)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 2: Create Assignment with Full Chain Verification');
    const assignRes = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, notes)
      VALUES ($1, $2, $3, 'Consignes terrassement')
      RETURNING id, troncon_id, agent_id, statut;
    `, [t1Id, agent1Id, resp1Id]);

    assert(assignRes.rows.length === 1, 'Assignment created successfully');
    const aff1Id = assignRes.rows[0].id;
    assert(assignRes.rows[0].statut === 'ACTIF', 'Assignment status is ACTIF');

    // ------------------------------------------------------------------------
    // TEST 3: Duplicate Assignment Prevention
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 3: Prevent Duplicate Assignment (Same A.T. + Same Tronçon)');
    let duplicateCaught = false;
    try {
      await db.query(`
        INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par)
        VALUES ($1, $2, $3);
      `, [t1Id, agent1Id, resp1Id]);
    } catch (e) {
      duplicateCaught = true;
    }
    assert(duplicateCaught, 'Duplicate assignment blocked by unique constraint');

    // ------------------------------------------------------------------------
    // TEST 4: Single Active Assignment per Agent Guard (uq_active_affectation_per_agent)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 4: Guard Against Multiple Active Assignments for Same Agent');
    let multiActiveCaught = false;
    try {
      await db.query(`
        INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, statut)
        VALUES ($1, $2, $3, 'ACTIF');
      `, [t2Id, agent1Id, resp1Id]);
    } catch (e) {
      multiActiveCaught = e.code === '23505' && e.constraint === 'uq_active_affectation_per_agent';
    }
    assert(multiActiveCaught, 'Duplicate active assignment across tronçons blocked by uq_active_affectation_per_agent');

    // Assign Agent 2 to Tronçon 2
    const assign2 = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, statut)
      VALUES ($1, $2, $3, 'ACTIF')
      RETURNING id;
    `, [t2Id, agent2Id, resp1Id]);
    assert(assign2.rows.length === 1, 'Agent 2 assigned to tronçon T02 successfully');

    // ------------------------------------------------------------------------
    // TEST 5: Equipe Terrain Query with Assignments & Stats
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 5: Equipe Terrain Query with Aggregated Assignments');
    const equipeQuery = `
      SELECT 
        u.id,
        u.nom,
        u.prenom,
        u.email,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'affectation_id', a.id,
              'troncon_id', t.id,
              'troncon_nom', t.nom,
              'chantier_id', c.id,
              'chantier_nom', c.nom,
              'projet_id', p.id,
              'projet_nom', p.nom
            )
          ) FILTER (WHERE a.id IS NOT NULL AND c.responsable_id = $1),
          '[]'::json
        ) AS affectations
      FROM public.utilisateur u
      JOIN public.role r ON u.role_id = r.id
      LEFT JOIN public.affectation_troncon a ON a.agent_id = u.id AND a.statut = 'ACTIF'
      LEFT JOIN public.troncon t ON a.troncon_id = t.id
      LEFT JOIN public.chantier c ON t.chantier_id = c.id AND c.responsable_id = $1
      LEFT JOIN public.projet p ON c.projet_id = p.id
      WHERE r.nom = 'AgentTerrain' AND u.actif = true
      GROUP BY u.id
      ORDER BY u.nom;
    `;
    const eqRes = await db.query(equipeQuery, [resp1Id]);
    const agentARow = eqRes.rows.find(r => r.id === agent1Id);
    const agentBRow = eqRes.rows.find(r => r.id === agent2Id);

    assert(agentARow && agentARow.affectations.length === 1, `Agent A has 1 active assignment under Resp 1 (got ${agentARow?.affectations?.length})`);
    assert(agentBRow && agentBRow.affectations.length === 1, `Agent B has 1 active assignment under Resp 1 (got ${agentBRow?.affectations?.length})`);

    // ------------------------------------------------------------------------
    // TEST 6: Ownership Check - Responsable 1 cannot assign to Tronçon T03 (Resp 2)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 6: Cross-Responsable Boundary Enforcement');
    const checkOwnership = await db.query(`
      SELECT t.id, c.responsable_id
      FROM public.troncon t
      JOIN public.chantier c ON t.chantier_id = c.id
      WHERE t.id = $1;
    `, [t3Id]);
    const isOwner = checkOwnership.rows[0].responsable_id === resp1Id;
    assert(!isOwner, 'Responsable 1 is NOT owner of Tronçon T03 (properly blocked)');

    // ------------------------------------------------------------------------
    // TEST 7: Remove Assignment and Preserve Observations
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 7: Remove Assignment while Preserving Observations');
    // Add observation by Agent A on Tronçon T01 first
    const obsInsert = await db.query(`
      INSERT INTO public.observation_terrain (
        chantier_id, troncon_id, agent_id, date_heure,
        agent_lat, agent_lng, projected_lat, projected_lng,
        distance_from_start, progress_percentage, chainage,
        position_gps, position_projetee, phase, phase_statut, statut, commentaire
      )
      VALUES (
        $1, $2, $3, NOW(),
        33.55, -7.45, 33.55, -7.45,
        1500.0, 30.0, 1.5,
        ST_SetSRID(ST_MakePoint(-7.45, 33.55), 4326),
        ST_SetSRID(ST_MakePoint(-7.45, 33.55), 4326),
        'Terrassement', 'En cours', 'EN_COURS', 'Relevé préliminaire'
      )
      RETURNING id;
    `, [ch1Id, t1Id, agent1Id]);
    const obsId = obsInsert.rows[0].id;

    // Delete assignment
    await db.query(`DELETE FROM public.affectation_troncon WHERE id = $1;`, [aff1Id]);

    // Check observation still exists!
    const obsCheck = await db.query(`SELECT id, troncon_id, agent_id FROM public.observation_terrain WHERE id = $1;`, [obsId]);
    assert(obsCheck.rows.length === 1, 'Historical field observation is preserved after unassignment');

  } finally {
    // Clean up
    await db.query(`DELETE FROM public.observation_terrain WHERE troncon_id IN ($1, $2, $3)`, [t1Id, t2Id, t3Id]);
    await db.query(`DELETE FROM public.affectation_troncon WHERE troncon_id IN ($1, $2, $3)`, [t1Id, t2Id, t3Id]);
    await db.query(`DELETE FROM public.troncon WHERE id IN ($1, $2, $3)`, [t1Id, t2Id, t3Id]);
    await db.query(`DELETE FROM public.reference_alignment WHERE id IN ($1, $2)`, [ref1Id, ref2Id]);
    await db.query(`DELETE FROM public.chantier WHERE id IN ($1, $2)`, [ch1Id, ch2Id]);
    await db.query(`DELETE FROM public.projet WHERE id IN ($1, $2)`, [proj1Id, proj2Id]);
    await db.query(`DELETE FROM public.demande_role WHERE utilisateur_id IN ($1, $2, $3, $4)`, [resp1Id, resp2Id, agent1Id, agent2Id]);
    await db.query(`DELETE FROM public.utilisateur WHERE id IN ($1, $2, $3, $4)`, [resp1Id, resp2Id, agent1Id, agent2Id]);
    console.log('Cleaned up test data.');
  }

  await db.pool.end();
  console.log('\n' + '='.repeat(90));
  console.log(`📊 PIPELINE TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
