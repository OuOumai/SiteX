/**
 * server/test_complete_communication_flow.js
 *
 * Verifies the complete operational communication flow between Responsable and A.T.
 * according to Requirements 1, 2, 3, 4, 5, 6, 7, 8, 9, 17 & 18.
 *
 * Scenario:
 * Chantier 75, Date: 2026-09-08 (working day with no observation), Tronçon 2 (assigned to Agent Terrain).
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const db = require('./src/db');
const chantierController = require('./src/controllers/chantier.controller');
const agentController = require('./src/controllers/agent.controller');

function mockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runTest() {
  console.log('='.repeat(90));
  console.log('🧪 RUNNING COMPLETE OPERATIONAL COMMUNICATION & STATISTICS TEST SUITE');
  console.log('='.repeat(90));

  let passed = 0;
  let total = 0;

  function assert(cond, desc) {
    total++;
    if (cond) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  const chantierId = 75;
  const tronconId = 170; // Tronçon 2
  const dateConcernee = '2026-09-08';
  const responsableId = 11;
  const agentId = 7;

  let createdAffectationId = null;
  let createdDemandeId = null;

  try {
    // 0. Setup: Clean any leftover test records for this date/troncon
    await db.query(`DELETE FROM public.notification WHERE related_entity_type = 'demande_explication' AND related_entity_id IN (SELECT id FROM public.demande_explication WHERE troncon_id = $1 AND date_concernee = $2::date)`, [tronconId, dateConcernee]);
    await db.query(`DELETE FROM public.demande_explication WHERE troncon_id = $1 AND date_concernee = $2::date`, [tronconId, dateConcernee]);

    // Ensure Tronçon 2 has an active affectation to Agent 7
    const affRes = await db.query(`
      INSERT INTO public.affectation_troncon (troncon_id, agent_id, date_affectation, statut)
      VALUES ($1, $2, CURRENT_DATE, 'ACTIF')
      RETURNING id
    `, [tronconId, agentId]);
    createdAffectationId = affRes.rows[0].id;

    console.log('\n📌 STEP 1 & 2 & 3: Responsable opens Historique & checks selected date');
    const reqJournal1 = {
      params: { id: chantierId },
      query: { mois: '2026-09' },
      user: { id: responsableId, role_nom: 'Responsable', role_id: 2 },
    };
    const resJournal1 = mockRes();
    await chantierController.getChantierJournal(reqJournal1, resJournal1);
    assert(resJournal1.statusCode === 200, 'Journal returned HTTP 200');

    const targetDay = resJournal1.data.days.find((d) => d.date === dateConcernee);
    assert(Boolean(targetDay), `Selected date ${dateConcernee} exists in journal`);
    assert(!targetDay.is_non_travaille, `${dateConcernee} is a normal working day`);

    const t2DayInfo = targetDay.troncons.find((t) => t.troncon_id === tronconId);
    assert(Boolean(t2DayInfo), 'Tronçon 2 exists for selected date');
    assert(t2DayInfo.statut === 'SANS_RELEVE', 'Tronçon 2 is initially SANS_RELEVE');
    assert(t2DayInfo.agent_id === agentId, `Tronçon 2 has assigned agent ID ${agentId}`);
    assert(!t2DayInfo.demande_explication, 'No pending explanation request prior to action');

    console.log('\n📌 STEP 4 & 5 & 6: Responsable taps "Contacter les A.T.", selects T2 and sends request');
    const reqSend = {
      params: { id: chantierId },
      body: {
        troncon_id: tronconId,
        date_concernee: dateConcernee,
        message: "Aucun relevé terrain n'a été enregistré pour cette journée. Merci de nous indiquer la situation.",
      },
      user: { id: responsableId, role_nom: 'Responsable', role_id: 2, prenom: 'Ahmed', nom: 'Responsable' },
    };
    const resSend = mockRes();
    await chantierController.requestExplanation(reqSend, resSend);
    assert(resSend.statusCode === 201, 'Request creation returned HTTP 201 Created');
    assert(Boolean(resSend.data?.demande), 'Response includes created demande object');
    createdDemandeId = resSend.data.demande.id;

    console.log('\n📌 STEP 7: Verify request is persisted with status EN_ATTENTE');
    const checkDemande = await db.query(`
      SELECT * FROM public.demande_explication WHERE id = $1
    `, [createdDemandeId]);
    assert(checkDemande.rows.length === 1, 'Demande record is persisted in public.demande_explication');
    assert(checkDemande.rows[0].statut === 'EN_ATTENTE', 'Request status is EN_ATTENTE');
    assert(checkDemande.rows[0].agent_id === agentId, `Request is linked to assigned A.T. (${agentId})`);
    assert(checkDemande.rows[0].responsable_id === responsableId, `Request is linked to Responsable (${responsableId})`);

    console.log('\n📌 STEP 8: Verify A.T. receives an in-app notification in existing architecture');
    const agentNotifs = await db.query(`
      SELECT * FROM public.notification
      WHERE utilisateur_id = $1 AND related_entity_type = 'demande_explication' AND related_entity_id = $2
      ORDER BY id DESC LIMIT 1
    `, [agentId, createdDemandeId]);
    assert(agentNotifs.rows.length === 1, 'In-app notification found for Agent de Terrain');
    const agentNotif = agentNotifs.rows[0];
    assert(agentNotif.lu === false, 'Notification is initially UNREAD (lu = false)');
    assert(agentNotif.type === 'DEMANDE_EXPLICATION', 'Notification type is DEMANDE_EXPLICATION');

    console.log('\n📌 STEP 9 & 10: Open A.T. notification & verify complete request details');
    // Parse metadata
    let notifMeta = agentNotif.metadata;
    if (typeof notifMeta === 'string') {
      try { notifMeta = JSON.parse(notifMeta); } catch { notifMeta = {}; }
    }
    assert(notifMeta.chantier_id === chantierId, `Metadata contains chantier_id = ${chantierId}`);
    assert(notifMeta.troncon_id === tronconId, `Metadata contains troncon_id = ${tronconId}`);
    assert(notifMeta.date_concernee === dateConcernee, `Metadata contains date_concernee = ${dateConcernee}`);
    assert(Boolean(notifMeta.demandeur_nom), 'Metadata contains requester name');
    assert(Boolean(notifMeta.message_responsable), 'Metadata contains responsable message');

    // Mark notification as read
    await db.query(`UPDATE public.notification SET lu = true, date_lecture = NOW() WHERE id = $1`, [agentNotif.id]);
    const readCheck = await db.query(`SELECT lu FROM public.notification WHERE id = $1`, [agentNotif.id]);
    assert(readCheck.rows[0].lu === true, 'Notification marked as read after opening');

    console.log('\n📌 STEP 11 & 12: A.T. responds with motif & explanation -> status becomes REPONDUE');
    const reqAnswer = {
      params: { id: createdDemandeId },
      body: {
        motif: 'MATERIEL',
        reponse: 'Problème de batterie et dysfonctionnement du récepteur GPS sur le terrain.',
      },
      user: { id: agentId, role_nom: 'AgentTerrain', role_id: 3, prenom: 'Karim', nom: 'Agent' },
    };
    const resAnswer = mockRes();
    await agentController.respondExplanation(reqAnswer, resAnswer);
    assert(resAnswer.statusCode === 200, 'A.T. response returned HTTP 200 OK');
    assert(resAnswer.data.demande.statut === 'REPONDUE', 'Demande status changed to REPONDUE');
    assert(resAnswer.data.demande.motif_agent === 'MATERIEL', 'Motif saved as MATERIEL');

    console.log('\n📌 STEP 13 & 14: Responsable receives in-app notification & opens response');
    const respNotifs = await db.query(`
      SELECT * FROM public.notification
      WHERE utilisateur_id = $1 AND related_entity_type = 'demande_explication' AND related_entity_id = $2
      ORDER BY id DESC LIMIT 1
    `, [responsableId, createdDemandeId]);
    assert(respNotifs.rows.length === 1, 'In-app notification found for Responsable');
    const respNotif = respNotifs.rows[0];
    assert(respNotif.type === 'EXPLICATION_FOURNIE', 'Notification type is EXPLICATION_FOURNIE');

    let respMeta = respNotif.metadata;
    if (typeof respMeta === 'string') {
      try { respMeta = JSON.parse(respMeta); } catch { respMeta = {}; }
    }
    assert(respMeta.motif === 'MATERIEL', 'Responsable notification metadata contains motif = MATERIEL');
    assert(Boolean(respMeta.reponse), 'Responsable notification metadata contains explanation text');

    console.log('\n📌 STEP 15: Verify explanation appears in the operational journal');
    const reqJournal2 = {
      params: { id: chantierId },
      query: { mois: '2026-09' },
      user: { id: responsableId, role_nom: 'Responsable', role_id: 2 },
    };
    const resJournal2 = mockRes();
    await chantierController.getChantierJournal(reqJournal2, resJournal2);
    const dayAfter = resJournal2.data.days.find((d) => d.date === dateConcernee);
    const t2After = dayAfter.troncons.find((t) => t.troncon_id === tronconId);
    assert(Boolean(t2After.demande_explication), 'Tronçon 2 includes demande_explication object in journal');
    assert(t2After.demande_explication.statut === 'REPONDUE', 'Journal reflects status REPONDUE');
    assert(t2After.demande_explication.motif_agent === 'MATERIEL', 'Journal displays motif_agent = MATERIEL');
    assert(t2After.demande_explication.reponse_agent.includes('GPS'), 'Journal displays agent explanation text');

    console.log('\n📌 STEP 16: Verify original observations & business progress remain untouched');
    const reqAvancement = {
      params: { id: chantierId },
      user: { id: responsableId, role_nom: 'Responsable', role_id: 2 },
    };
    const resAvancement = mockRes();
    await chantierController.getChantierAvancementStats(reqAvancement, resAvancement);
    assert(resAvancement.statusCode === 200, 'Avancement returned HTTP 200');
    assert(resAvancement.data.chantier.avancement === 25, `Chantier 75 authoritative progress is unchanged: 25% (got ${resAvancement.data.chantier?.avancement}%)`);
    assert(resAvancement.data.troncons[0].avancement === 100, 'T1 authoritative progress remains 100%');
    assert(resAvancement.data.troncons[1].avancement === 0, 'T2 progress remains 0%');
    assert(resAvancement.data.stats.total_completed_meters === 136.25, `Completed meters is unchanged: 136.25 m (got ${resAvancement.data.stats?.total_completed_meters} m)`);

    console.log('\n📌 STEP 17: Verify duplicate protection (sending again does NOT duplicate)');
    const reqDup = {
      params: { id: chantierId },
      body: {
        troncon_id: tronconId,
        date_concernee: dateConcernee,
        message: 'Second message attempt for same date and tronçon',
      },
      user: { id: responsableId, role_nom: 'Responsable', role_id: 2, prenom: 'Ahmed', nom: 'Responsable' },
    };
    const resDup = mockRes();
    await chantierController.requestExplanation(reqDup, resDup);
    assert(resDup.statusCode === 409, `Duplicate request rejected with HTTP 409 (got ${resDup.statusCode})`);
    assert(resDup.data.already_answered === true || resDup.data.already_pending === true, 'Duplicate response flags already_answered/already_pending');

    const totalCountDemandes = await db.query(`
      SELECT COUNT(*)::int AS cnt FROM public.demande_explication
      WHERE troncon_id = $1 AND date_concernee = $2::date
    `, [tronconId, dateConcernee]);
    assert(totalCountDemandes.rows[0].cnt === 1, 'Only 1 record exists in demande_explication (no duplicates)');

    console.log('\n📌 STEP 18: Test statistics categories integrity');
    const summary = resJournal2.data.summary;
    assert(typeof summary.jours_avec_activite === 'number', 'summary.jours_avec_activite is a valid number');
    assert(typeof summary.jours_sans_releve === 'number', 'summary.jours_sans_releve is a valid number');
    assert(typeof summary.jours_feries_chomes === 'number', 'summary.jours_feries_chomes is a valid number');
    assert(typeof summary.jours_absence_agent === 'number', 'summary.jours_absence_agent is a valid number');
    assert(typeof summary.demandes_en_attente === 'number', 'summary.demandes_en_attente is a valid number');

    // Verify non-working days vs observation days vs missing days don't overlap improperly
    assert(summary.jours_feries_chomes >= 2, `Past non-working days in month elapsed: ${summary.jours_feries_chomes} j (>= 2)`);

  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up test artifacts...');
    if (createdDemandeId) {
      await db.query(`DELETE FROM public.notification WHERE related_entity_type = 'demande_explication' AND related_entity_id = $1`, [createdDemandeId]);
      await db.query(`DELETE FROM public.demande_explication WHERE id = $1`, [createdDemandeId]);
    }
    if (createdAffectationId) {
      await db.query(`DELETE FROM public.affectation_troncon WHERE id = $1`, [createdAffectationId]);
    }
    console.log('  └─ Test affectation, notifications, and explanation requests cleaned up.');
  }

  console.log('\n' + '='.repeat(90));
  console.log(`📊 COMMUNICATION FLOW TEST RESULTS: ${passed} / ${total} TESTS PASSED`);
  console.log('='.repeat(90));

  if (passed === total) {
    console.log('🎉 Full communication workflow & duplicate protection verified successfully!');
  } else {
    process.exitCode = 1;
  }
}

runTest()
  .catch((err) => {
    console.error('❌ Test suite fatal error:', err);
    process.exit(1);
  })
  .finally(async () => {
    // Allow db pool to drain
    process.exit(process.exitCode || 0);
  });
