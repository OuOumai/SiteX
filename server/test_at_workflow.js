/**
 * server/test_at_workflow.js
 *
 * Automated verification suite for Agent de Terrain (A.T.) & Responsable assignment workflow.
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');

async function runTests() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING AGENT DE TERRAIN (A.T.) & AFFECTATIONS WORKFLOW TEST SUITE');
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

  // 1. Setup test Responsable, Agent A, Agent B, Agent C
  const rand = Math.floor(Math.random() * 100000);
  const respUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('RespAT', 'Test', 'resp_at_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const respId = respUser.rows[0].id;

  const agentA = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentA', 'Alice', 'agent_a_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentAId = agentA.rows[0].id;

  const agentB = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentB', 'Bob', 'agent_b_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentBId = agentB.rows[0].id;

  const agentC = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentC', 'Charlie', 'agent_c_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentCId = agentC.rows[0].id;

  // Insert Admin-Approved role requests for agents
  await db.query(`
    INSERT INTO public.demande_role (utilisateur_id, requested_role_id, statut)
    VALUES ($1, 3, 'APPROVED'), ($2, 3, 'APPROVED'), ($3, 3, 'APPROVED');
  `, [agentAId, agentBId, agentCId]);

  // 2. Setup Project, Chantier, Reference Alignment, and 2 Tronçons
  const projRes = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet Autoroute RP4022', 'Test Linear Project', 'En cours', 'Autoroute')
    RETURNING id;
  `);
  const projId = projRes.rows[0].id;

  const chRes = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
    VALUES ($1, $2, 'Chantier Section Nord', 'En cours')
    RETURNING id;
  `, [projId, respId]);
  const chantierId = chRes.rows[0].id;

  const refRes = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe RP4022', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.8,33.9],[-6.9,33.8],[-7.0,33.7]]}'), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [chantierId]);
  const refId = refRes.rows[0].id;

  const t1Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T01', 0.0, 10.0, 'EN_COURS', 35, ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.8,33.9],[-6.85,33.85]]}'), 4326))
    RETURNING id;
  `, [chantierId, refId]);
  const t1Id = t1Res.rows[0].id;

  const t2Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon T02', 10.0, 20.0, 'NON_COMMENCE', 0, ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.85,33.85],[-6.9,33.8]]}'), 4326))
    RETURNING id;
  `, [chantierId, refId]);
  const t2Id = t2Res.rows[0].id;

  try {
    // ------------------------------------------------------------------------
    // TEST 1: Responsable lists available agents
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 1: List Available Agents for Assignment');
    const availAgentsRes = await db.query(`
      SELECT u.id, u.nom, u.prenom, u.email, r.nom AS role_nom
      FROM public.utilisateur u
      JOIN public.role r ON u.role_id = r.id
      WHERE (r.nom = 'AgentTerrain' OR u.role_id = 3) AND u.actif = true;
    `);
    const agentIds = availAgentsRes.rows.map(a => a.id);
    assert(agentIds.includes(agentAId) && agentIds.includes(agentBId) && agentIds.includes(agentCId), 'Available agents list includes Alice, Bob, Charlie');

    // ------------------------------------------------------------------------
    // TEST 2: Assign Agent A to Tronçon T01
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 2: Assign Agent A to Tronçon T01');
    const assignA1 = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, notes)
      VALUES ($1, $2, $3, 'Responsable assigned Alice')
      RETURNING id, statut;
    `, [t1Id, agentAId, respId]);
    assert(assignA1.rows.length === 1 && assignA1.rows[0].statut === 'ACTIF', 'Agent A assigned to Tronçon T01 with ACTIF status');

    // ------------------------------------------------------------------------
    // TEST 3: Assign Agent B to Tronçon T01 (Multiple agents on same tronçon)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 3: Assign Agent B to Tronçon T01 (Multiple agents on same tronçon)');
    const assignB1 = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par, notes)
      VALUES ($1, $2, $3, 'Responsable assigned Bob')
      RETURNING id, statut;
    `, [t1Id, agentBId, respId]);
    assert(assignB1.rows.length === 1, 'Agent B assigned to Tronçon T01 successfully alongside Agent A');

    // ------------------------------------------------------------------------
    // TEST 4: Prevent Duplicate Assignment of Agent A on Tronçon T01
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 4: Prevent Duplicate Assignment');
    const dupRes = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par)
      VALUES ($1, $2, $3)
      ON CONFLICT (troncon_id, agent_id) DO NOTHING
      RETURNING id;
    `, [t1Id, agentAId, respId]);
    assert(dupRes.rows.length === 0, 'Duplicate assignment blocked cleanly by unique constraint');

    // ------------------------------------------------------------------------
    // TEST 5: Assign Agent A to Tronçon T02 (Same agent on multiple tronçons)
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 5: Assign Agent A to Tronçon T02');
    const assignA2 = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, affecte_par)
      VALUES ($1, $2, $3)
      RETURNING id;
    `, [t2Id, agentAId, respId]);
    assert(assignA2.rows.length === 1, 'Agent A assigned to second Tronçon T02 successfully');

    // ------------------------------------------------------------------------
    // TEST 6: Verify Tronçon T01 assigned agents from Responsable perspective
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 6: Responsable views Tronçon T01 assigned agents');
    const t1AgentsRes = await db.query(`
      SELECT a.id, a.agent_id, u.nom, u.prenom
      FROM public.affectation_troncon a
      JOIN public.utilisateur u ON a.agent_id = u.id
      WHERE a.troncon_id = $1 AND a.statut = 'ACTIF'
      ORDER BY u.nom;
    `, [t1Id]);
    assert(t1AgentsRes.rows.length === 2, `Tronçon T01 has 2 active agents assigned (got: ${t1AgentsRes.rows.length})`);

    // ------------------------------------------------------------------------
    // TEST 7: Agent A Dashboard ("Mes affectations") isolation
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 7: Agent A Dashboard Query (Strict Isolation)');
    const agentADashRes = await db.query(`
      SELECT 
        a.id AS affectation_id,
        t.id AS troncon_id,
        t.nom AS troncon_nom,
        t.pk_debut,
        t.pk_fin,
        t.statut AS troncon_statut,
        t.avancement AS troncon_avancement,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        p.nom AS projet_nom,
        c.nom AS chantier_nom
      FROM public.affectation_troncon a
      JOIN public.troncon t ON a.troncon_id = t.id
      JOIN public.chantier c ON t.chantier_id = c.id
      JOIN public.projet p ON c.projet_id = p.id
      WHERE a.agent_id = $1 AND a.statut = 'ACTIF'
      ORDER BY t.pk_debut;
    `, [agentAId]);
    assert(agentADashRes.rows.length === 2, `Agent A sees exactly 2 assignments (T01 & T02) (got ${agentADashRes.rows.length})`);
    assert(agentADashRes.rows[0].projet_nom === 'Projet Autoroute RP4022', 'Assignment contains full project name');
    assert(agentADashRes.rows[0].troncon_nom === 'Tronçon T01', 'Assignment contains tronçon name');

    // ------------------------------------------------------------------------
    // TEST 8: Agent B Dashboard Query
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 8: Agent B Dashboard Query');
    const agentBDashRes = await db.query(`
      SELECT a.id, t.nom AS troncon_nom
      FROM public.affectation_troncon a
      JOIN public.troncon t ON a.troncon_id = t.id
      WHERE a.agent_id = $1 AND a.statut = 'ACTIF';
    `, [agentBId]);
    assert(agentBDashRes.rows.length === 1 && agentBDashRes.rows[0].troncon_nom === 'Tronçon T01', 'Agent B sees exactly 1 assignment (T01 only)');

    // ------------------------------------------------------------------------
    // TEST 9: Unassigned Agent C Dashboard Query
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 9: Unassigned Agent C Dashboard Query');
    const agentCDashRes = await db.query(`
      SELECT a.id
      FROM public.affectation_troncon a
      WHERE a.agent_id = $1 AND a.statut = 'ACTIF';
    `, [agentCId]);
    assert(agentCDashRes.rows.length === 0, 'Unassigned Agent C sees 0 assignments (clean empty state)');

    // ------------------------------------------------------------------------
    // TEST 10: Agent B Access Control on Tronçon T02
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 10: Agent B Access Control on Unassigned Tronçon T02');
    const checkB2Res = await db.query(`
      SELECT t.id
      FROM public.troncon t
      JOIN public.affectation_troncon a ON a.troncon_id = t.id AND a.agent_id = $2
      WHERE t.id = $1;
    `, [t2Id, agentBId]);
    assert(checkB2Res.rows.length === 0, 'Agent B is blocked from viewing Tronçon T02 (not assigned)');

    // ------------------------------------------------------------------------
    // TEST 11: Responsable unassigns Agent A from Tronçon T01
    // ------------------------------------------------------------------------
    console.log('\n📌 TEST 11: Responsable unassigns Agent A from Tronçon T01');
    const delRes = await db.query(`
      DELETE FROM public.affectation_troncon
      WHERE troncon_id = $1 AND agent_id = $2
      RETURNING id;
    `, [t1Id, agentAId]);
    assert(delRes.rows.length === 1, 'Agent A removed from Tronçon T01');

    const agentAAfterDel = await db.query(`
      SELECT a.id, t.nom AS troncon_nom
      FROM public.affectation_troncon a
      JOIN public.troncon t ON a.troncon_id = t.id
      WHERE a.agent_id = $1 AND a.statut = 'ACTIF';
    `, [agentAId]);
    assert(agentAAfterDel.rows.length === 1 && agentAAfterDel.rows[0].troncon_nom === 'Tronçon T02', 'Agent A now has only 1 assignment (T02)');

  } finally {
    // Clean up test data
    await db.query(`DELETE FROM public.affectation_troncon WHERE troncon_id IN ($1, $2)`, [t1Id, t2Id]);
    await db.query(`DELETE FROM public.troncon WHERE id IN ($1, $2)`, [t1Id, t2Id]);
    await db.query(`DELETE FROM public.reference_alignment WHERE id = $1`, [refId]);
    await db.query(`DELETE FROM public.chantier WHERE id = $1`, [chantierId]);
    await db.query(`DELETE FROM public.projet WHERE id = $1`, [projId]);
    await db.query(`DELETE FROM public.demande_role WHERE utilisateur_id IN ($1, $2, $3, $4)`, [respId, agentAId, agentBId, agentCId]);
    await db.query(`DELETE FROM public.utilisateur WHERE id IN ($1, $2, $3, $4)`, [respId, agentAId, agentBId, agentCId]);
    console.log('Cleaned up test data.');
  }

  await db.pool.end();
  console.log('\n' + '='.repeat(90));
  console.log(`📊 WORKFLOW TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));
}

runTests().catch(e => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
