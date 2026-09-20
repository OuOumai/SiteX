/**
 * server/test_journal_operational_workflow.js
 *
 * Automated verification suite for Responsable Chantier Journal & Operational Calendar:
 * 1. Day with terrain observation (RELEVE)
 * 2. Non-working day (Sunday - NON_TRAVAILLE)
 * 3. Public holiday (NON_TRAVAILLE with holiday name)
 * 4. Declared A.T. absence (ABSENCE_AGENT with motif)
 * 5. Working day without observation (SANS_RELEVE)
 * 6. Continuous S-curve flat plateau carry-forward (never artificial 0% drop)
 * 7. Non-regression invariant
 * 8. Never-observed tronçons contribute 0% to arithmetic average
 * 9. Justification request & response workflow with in-app notifications
 * 10. Existing Chantier 75 scenario data integrity (25%, 136.25 / 545.2 m)
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const chantierController = require('./src/controllers/chantier.controller');
const agentController = require('./src/controllers/agent.controller');

async function runJournalTests() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING RESPONSABLE CHANTIER JOURNAL & OPERATIONAL CALENDAR TEST SUITE');
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
    VALUES ('RespJournal', 'Samir', 'resp_journal_${rand}@test.com', 'dummyhash', 2, true)
    RETURNING id;
  `);
  const respId = respUser.rows[0].id;

  const agentUser = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('AgentJournal', 'Yassine', 'agent_journal_${rand}@test.com', 'dummyhash', 3, true)
    RETURNING id;
  `);
  const agentId = agentUser.rows[0].id;

  // 2. Setup Project & Chantier with 2 tronçons
  const projRes = await db.query(`
    INSERT INTO public.projet (nom, description, statut, type_projet)
    VALUES ('Projet Journal Test', 'Test Journal Suite', 'En cours', 'Autoroute')
    RETURNING id;
  `);
  const projId = projRes.rows[0].id;

  const chantierRes = await db.query(`
    INSERT INTO public.chantier (projet_id, responsable_id, nom, statut, date_debut)
    VALUES ($1, $2, 'Chantier Journal Opérationnel', 'En cours', '2026-09-01')
    RETURNING id;
  `, [projId, respId]);
  const chantierId = chantierRes.rows[0].id;

  // Insert Reference Alignment
  const lineGeoJSON = {
    type: 'LineString',
    coordinates: [
      [-6.8, 34.0],
      [-6.8, 34.018],
    ],
  };
  const refRes = await db.query(`
    INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
    VALUES ($1, 'Axe Test Journal', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
    RETURNING id;
  `, [chantierId, JSON.stringify(lineGeoJSON)]);
  const refId = refRes.rows[0].id;

  // 3. Setup 2 Tronçons: T1 (1000m) and T2 (1000m)
  const t1Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon 1 Nord', 0, 1000, 'EN_COURS', 0, ST_SetSRID(ST_MakeLine(ST_MakePoint(-6.8, 34.0), ST_MakePoint(-6.8, 34.009)), 4326))
    RETURNING id;
  `, [chantierId, refId]);
  const t1Id = t1Res.rows[0].id;

  const t2Res = await db.query(`
    INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, statut, avancement, geometry)
    VALUES ($1, $2, 'Tronçon 2 Sud', 1000, 2000, 'NON_COMMENCE', 0, ST_SetSRID(ST_MakeLine(ST_MakePoint(-6.8, 34.009), ST_MakePoint(-6.8, 34.018)), 4326))
    RETURNING id;
  `, [chantierId, refId]);
  const t2Id = t2Res.rows[0].id;


  // Assign agent to T1
  await db.query(`
    INSERT INTO public.affectation_troncon (troncon_id, agent_id, statut, date_affectation)
    VALUES ($1, $2, 'ACTIF', '2026-09-01 08:00:00')
  `, [t1Id, agentId]);

  // Configure Chantier Calendar (Mon-Sat = [1,2,3,4,5,6], Sunday = 7 off)
  await db.query(`
    INSERT INTO public.chantier_calendrier (chantier_id, jours_travailles)
    VALUES ($1, '{1,2,3,4,5,6}')
  `, [chantierId]);

  // Insert Public Holiday on 2026-09-15 (Fête Nationale)
  await db.query(`
    INSERT INTO public.jour_ferie (date, nom, est_chome, chantier_id)
    VALUES ('2026-09-15', 'Fête Nationale Test', true, $1)
  `, [chantierId]);

  // Insert Agent Absence from 2026-09-16 to 2026-09-17 (Congé Maladie)
  await db.query(`
    INSERT INTO public.agent_absence (agent_id, date_debut, date_fin, motif, statut)
    VALUES ($1, '2026-09-16', '2026-09-17', 'Congé Maladie Justifié', 'VALIDE')
  `, [agentId]);

  // Insert Observations on 2026-09-02 (T1 -> 50% = 500m)
  await db.query(`
    INSERT INTO public.observation_terrain (
      chantier_id, troncon_id, agent_id, date_heure, progress_percentage,
      authoritative_progress_percentage, authoritative_progress_meters, chainage, phase, statut, validation_status,
      position_gps
    ) VALUES ($1, $2, $3, '2026-09-02 10:00:00', 50, 50, 500, 500, 'Terrassement', 'EN_COURS', 'normal', ST_SetSRID(ST_MakePoint(-6.8, 34.004), 4326))
  `, [chantierId, t1Id, agentId]);

  await db.query(`
    UPDATE public.troncon SET avancement = 50, authoritative_progress_meters = 500 WHERE id = $1
  `, [t1Id]);

  // Insert second observation on 2026-09-03 with lower percentage (40%) to test non-regression
  await db.query(`
    INSERT INTO public.observation_terrain (
      chantier_id, troncon_id, agent_id, date_heure, progress_percentage,
      authoritative_progress_percentage, authoritative_progress_meters, chainage, phase, statut, validation_status,
      position_gps
    ) VALUES ($1, $2, $3, '2026-09-03 14:00:00', 40, 50, 500, 400, 'Terrassement', 'EN_COURS', 'normal', ST_SetSRID(ST_MakePoint(-6.8, 34.004), 4326))
  `, [chantierId, t1Id, agentId]);


  try {
    // -------------------------------------------------------------------------
    // TEST 1: Query Journal via getChantierJournal controller
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 1: Invoke getChantierJournal for month 2026-09');
    let journalResponse = null;
    const req = {
      params: { id: chantierId },
      query: { month: '2026-09' },
      user: { id: respId, role_nom: 'Responsable', role_id: 2 },
    };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        journalResponse = payload;
        return this;
      },
    };

    await chantierController.getChantierJournal(req, res);
    assert(journalResponse && Array.isArray(journalResponse.days), 'Journal returns days array for month 2026-09');
    assert(journalResponse.days.length === 30, 'Month has exactly 30 days', `Got ${journalResponse?.days?.length}`);

    // Find specific test days in the month
    const dayObs = journalResponse.days.find((d) => d.date === '2026-09-02');
    const dayNonReg = journalResponse.days.find((d) => d.date === '2026-09-03');
    const dayPlateau = journalResponse.days.find((d) => d.date === '2026-09-04'); // Friday with no new observation
    const daySunday = journalResponse.days.find((d) => d.date === '2026-09-06'); // Sunday (non-travaille)
    const dayHoliday = journalResponse.days.find((d) => d.date === '2026-09-15'); // Holiday
    const dayAbsence = journalResponse.days.find((d) => d.date === '2026-09-16'); // Agent absence
    const daySansReleve = journalResponse.days.find((d) => d.date === '2026-09-08'); // Tuesday working day without obs

    // -------------------------------------------------------------------------
    // TEST 2: Day with terrain observation (RELEVE)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 2: Day with terrain observation');
    const t1OnDay2 = dayObs.troncons.find((t) => t.troncon_id === t1Id);
    assert(t1OnDay2.statut === 'RELEVE', 'Tronçon 1 on 2026-09-02 has status RELEVE', `Got ${t1OnDay2?.statut}`);
    assert(t1OnDay2.observations_count === 1, 'Tronçon 1 has 1 observation count');
    assert(dayObs.consolidated_progress === 25, 'Consolidated progress is arithmetic average: (50% + 0%) / 2 = 25%', `Got ${dayObs?.consolidated_progress}%`);

    // -------------------------------------------------------------------------
    // TEST 3: Non-working day (Sunday - NON_TRAVAILLE)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 3: Non-working day (Sunday)');
    assert(daySunday.is_non_travaille === true, 'Sunday is marked as non_travaille');
    assert(daySunday.statut_jour === 'NON_TRAVAILLE', 'Sunday statut_jour is NON_TRAVAILLE', `Got ${daySunday?.statut_jour}`);
    assert(daySunday.consolidated_progress === 25, 'Consolidated progress on Sunday carries forward (25%) without regressing to 0%', `Got ${daySunday?.consolidated_progress}%`);

    // -------------------------------------------------------------------------
    // TEST 4: Public holiday (NON_TRAVAILLE with holiday name)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 4: Public holiday');
    assert(dayHoliday.is_ferie === true, 'Holiday is marked as ferie');
    assert(dayHoliday.ferie_nom === 'Fête Nationale Test', 'Holiday name is correctly attached', `Got ${dayHoliday?.ferie_nom}`);
    assert(dayHoliday.statut_jour === 'NON_TRAVAILLE', 'Holiday statut_jour is NON_TRAVAILLE');

    // -------------------------------------------------------------------------
    // TEST 5: Declared A.T. absence (ABSENCE_AGENT)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 5: Declared A.T. absence');
    const t1OnAbsDay = dayAbsence.troncons.find((t) => t.troncon_id === t1Id);
    assert(t1OnAbsDay.statut === 'ABSENCE_AGENT', 'Tronçon 1 on 2026-09-16 has status ABSENCE_AGENT', `Got ${t1OnAbsDay?.statut}`);
    assert(t1OnAbsDay.absence_info && t1OnAbsDay.absence_info.motif === 'Congé Maladie Justifié', 'Absence motif is correctly displayed');

    // -------------------------------------------------------------------------
    // TEST 6: Working day without observation (SANS_RELEVE)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 6: Working day without observation');
    const t1OnSansReleve = daySansReleve.troncons.find((t) => t.troncon_id === t1Id);
    assert(t1OnSansReleve.statut === 'SANS_RELEVE', 'Tronçon 1 on 2026-09-08 is SANS_RELEVE', `Got ${t1OnSansReleve?.statut}`);
    assert(daySansReleve.statut_jour === 'INACTIVITE_A_VERIFIER', 'Day status is INACTIVITE_A_VERIFIER', `Got ${daySansReleve?.statut_jour}`);

    // -------------------------------------------------------------------------
    // TEST 7: Continuous S-curve flat plateau carry-forward
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 7: Continuous flat plateau carry-forward');
    assert(dayPlateau.consolidated_progress === 25, '2026-09-04 carries forward 25% progress without regressing', `Got ${dayPlateau?.consolidated_progress}%`);

    // -------------------------------------------------------------------------
    // TEST 8: Non-regression invariant
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 8: Non-regression invariant');
    const t1OnDay3 = dayNonReg.troncons.find((t) => t.troncon_id === t1Id);
    assert(t1OnDay3.avancement === 50, 'Authoritative progress on 2026-09-03 remains 50% despite 40% observation', `Got ${t1OnDay3?.avancement}%`);
    assert(dayNonReg.consolidated_progress === 25, 'Consolidated progress remains 25%', `Got ${dayNonReg?.consolidated_progress}%`);

    // -------------------------------------------------------------------------
    // TEST 9: Justification Request & Response Workflow
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 9: Justification Request & Response Workflow');
    let requestJustifRes = null;
    const reqJustif = {
      params: { id: chantierId },
      body: {
        troncon_id: t1Id,
        date_concernee: '2026-09-08',
        message: "Absence de relevé constatée mardi. Merci d'indiquer le motif.",
      },
      user: { id: respId, role_nom: 'Responsable', role_id: 2 },
    };
    const resJustif = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        requestJustifRes = payload;
        return this;
      },
    };

    await chantierController.requestExplanation(reqJustif, resJustif);
    assert(requestJustifRes && requestJustifRes.demande, 'Demande d’explication created successfully');
    const demandeId = requestJustifRes.demande.id;

    // Check notification was sent to Agent
    const notifAgent = await db.query(`
      SELECT * FROM public.notification
      WHERE utilisateur_id = $1 AND related_entity_type = 'demande_explication' AND related_entity_id = $2
    `, [agentId, demandeId]);
    assert(notifAgent.rows.length > 0, 'In-app notification created for Agent de Terrain');

    // Agent responds to the justification request
    let respondJustifRes = null;
    const reqRespond = {
      params: { id: demandeId },
      body: {
        motif: 'METEO',
        reponse: "Fortes pluies et inondation sur le tronçon, impossible d'intervenir.",
      },
      user: { id: agentId, role_nom: 'Agent de Terrain', role_id: 3 },
    };
    const resRespond = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        respondJustifRes = payload;
        return this;
      },
    };

    await agentController.respondExplanation(reqRespond, resRespond);
    assert(respondJustifRes && respondJustifRes.demande && respondJustifRes.demande.statut === 'REPONDUE', 'Agent successfully answered the justification request');
    assert(respondJustifRes.demande.motif_agent === 'METEO', 'Agent motif correctly saved');

    // Check notification was sent to Responsable
    const notifResp = await db.query(`
      SELECT * FROM public.notification
      WHERE utilisateur_id = $1 AND related_entity_type = 'demande_explication' AND related_entity_id = $2
    `, [respId, demandeId]);
    assert(notifResp.rows.length > 0, 'In-app notification created for Responsable');

    // Re-query journal to verify attached explanation on 2026-09-08
    await chantierController.getChantierJournal(req, res);
    const daySansReleveUpdated = journalResponse.days.find((d) => d.date === '2026-09-08');
    const t1Updated = daySansReleveUpdated.troncons.find((t) => t.troncon_id === t1Id);
    assert(t1Updated.demande_explication && t1Updated.demande_explication.statut === 'REPONDUE', 'Journal day reflects the answered justification request');
    assert(t1Updated.demande_explication.reponse_agent.includes('Fortes pluies'), 'Journal includes agent explanation text');

    // -------------------------------------------------------------------------
    // TEST 10: Existing Chantier 75 scenario integrity (25%, 136.25 / 545.2 m)
    // -------------------------------------------------------------------------
    console.log('\n📌 TEST 10: Existing Chantier 75 Scenario Integrity');
    const chantier75Check = await db.query('SELECT id, nom, responsable_id FROM public.chantier WHERE id = 75');
    if (chantier75Check.rows.length > 0) {
      let c75AvancementRes = null;
      const c75Req = {
        params: { id: 75 },
        user: { id: chantier75Check.rows[0].responsable_id, role_nom: 'Responsable', role_id: 2 },
      };
      const c75Res = {
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          c75AvancementRes = payload;
          return this;
        },
      };

      await chantierController.getChantierAvancementStats(c75Req, c75Res);
      assert(c75AvancementRes && c75AvancementRes.chantier, 'Chantier 75 avancement endpoint returned successfully');
      assert(c75AvancementRes.chantier.avancement === 25, `Chantier 75 official avancement remains 25% (got ${c75AvancementRes?.chantier?.avancement}%)`);
      assert(c75AvancementRes.stats.total_completed_meters === 136.25, `Chantier 75 completed meters is 136.25 m (got ${c75AvancementRes?.stats?.total_completed_meters} m)`);
      assert(c75AvancementRes.stats.total_planned_meters === 545.2, `Chantier 75 planned meters is 545.2 m (got ${c75AvancementRes?.stats?.total_planned_meters} m)`);
    } else {
      console.log('  ℹ️ Chantier 75 does not exist in this environment, skipping C75 specific values check.');
    }

  } finally {
    // Cleanup test data
    console.log('\n🧹 Cleaning up test data...');
    await db.query('DELETE FROM public.demande_explication WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.observation_terrain WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.agent_absence WHERE agent_id = $1', [agentId]);
    await db.query('DELETE FROM public.jour_ferie WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.chantier_calendrier WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.affectation_troncon WHERE troncon_id IN ($1, $2)', [t1Id, t2Id]);
    await db.query('DELETE FROM public.troncon WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.reference_alignment WHERE chantier_id = $1', [chantierId]);
    await db.query('DELETE FROM public.chantier WHERE id = $1', [chantierId]);
    await db.query('DELETE FROM public.projet WHERE id = $1', [projId]);
    await db.query('DELETE FROM public.notification WHERE utilisateur_id IN ($1, $2)', [agentId, respId]);
    await db.query('DELETE FROM public.utilisateur WHERE id IN ($1, $2)', [respId, agentId]);
    console.log('  └─ Test data cleaned up.');
  }

  console.log('\n' + '='.repeat(90));
  console.log(`📊 JOURNAL TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));

  if (passed !== total) {
    process.exit(1);
  }
}

runJournalTests().then(() => {
  console.log('🎉 All Chantier Journal tests completed successfully!');
  process.exit(0);
}).catch((err) => {
  console.error('❌ Test runner error:', err);
  process.exit(1);
});
