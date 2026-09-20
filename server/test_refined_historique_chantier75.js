/**
 * test_refined_historique_chantier75.js
 * Verification of all refined Historique requirements against Chantier 75.
 */
require('dotenv').config();
const db = require('./src/db');
const chantierController = require('./src/controllers/chantier.controller');

async function run() {
  console.log('==========================================================================================');
  console.log('🧪 RUNNING CHANTIER 75 REFINED HISTORIQUE VERIFICATION SUITE');
  console.log('==========================================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(desc, condition) {
    total++;
    if (condition) {
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${desc}`);
      process.exitCode = 1;
    }
  }

  // 1. Verify Chantier 75 Official Avancement
  console.log('📌 CHECK 1: Official Chantier 75 Avancement');
  const mockReqAv = {
    user: { id: 11, role: 'RESPONSABLE' },
    params: { id: 75 }
  };
  let avData = null;
  const mockResAv = {
    status: (s) => ({
      json: (d) => {
        avData = d;
      }
    })
  };
  await chantierController.getChantierAvancementStats(mockReqAv, mockResAv);

  assert('Chantier 75 avancement is 25%', avData.chantier.avancement === 25);
  assert('T1 avancement is 100%', avData.troncons[0].avancement === 100);
  assert('T2 avancement is 0%', avData.troncons[1].avancement === 0);
  assert('T3 avancement is 0%', avData.troncons[2].avancement === 0);
  assert('T4 avancement is 0%', avData.troncons[3].avancement === 0);
  assert('Completed meters is 136.25 m', avData.stats.total_completed_meters === 136.25);
  assert('Planned meters is 545.2 m', avData.stats.total_planned_meters === 545.2);
  assert('Observation on 31 August exists', avData.historique.observations.some(o => o.date_heure && o.date_heure.startsWith('2026-08-31')));

  // 2. Verify August 2026 Journal
  console.log('\n📌 CHECK 2: August 2026 Journal & Moroccan Holidays');
  const mockReqAug = {
    user: { id: 11, role: 'RESPONSABLE' },
    params: { id: 75 },
    query: { month: '2026-08' }
  };
  let augData = null;
  const mockResAug = {
    status: (s) => ({
      json: (d) => {
        augData = d;
      }
    })
  };
  await chantierController.getChantierJournal(mockReqAug, mockResAug);

  assert('August has 31 days', augData.days.length === 31);
  const day31 = augData.days.find(d => d.date === '2026-08-31');
  assert('31 August consolidated progress is 25%', day31.consolidated_progress === 25);
  assert('31 August T1 has 1 observation', day31.troncons[0].observations_count === 1);
  assert('31 August T2 is unassigned (agent_id is null)', day31.troncons[1].agent_id === null);
  assert('31 August T3 is unassigned (agent_id is null)', day31.troncons[2].agent_id === null);
  assert('31 August T4 is unassigned (agent_id is null)', day31.troncons[3].agent_id === null);

  // Moroccan holidays in August 2026
  const aug14 = augData.days.find(d => d.date === '2026-08-14');
  assert('2026-08-14 is marked as ferie', aug14.is_ferie === true);
  assert('2026-08-14 holiday name is Allégeance Oued Eddahab', aug14.ferie_nom === 'Allégeance Oued Eddahab');
  assert('2026-08-14 day status is NON_TRAVAILLE', aug14.statut_jour === 'NON_TRAVAILLE');

  const aug20 = augData.days.find(d => d.date === '2026-08-20');
  assert('2026-08-20 holiday is Révolution du Roi et du Peuple', aug20.ferie_nom === 'Révolution du Roi et du Peuple');

  const aug21 = augData.days.find(d => d.date === '2026-08-21');
  assert('2026-08-21 holiday is Fête de la Jeunesse', aug21.ferie_nom === 'Fête de la Jeunesse');

  // Sunday 30 August was before the first observation (was 0%)
  const sun30 = augData.days.find(d => d.date === '2026-08-30');
  assert('Sunday 30 August is NON_TRAVAILLE', sun30.statut_jour === 'NON_TRAVAILLE');
  assert('Sunday 30 August progress is 0% (prior to first observation)', sun30.consolidated_progress === 0);

  // 3. Verify September 2026 Journal
  console.log('\n📌 CHECK 3: September 2026 Journal');
  const mockReqSep = {
    user: { id: 11, role: 'RESPONSABLE' },
    params: { id: 75 },
    query: { month: '2026-09' }
  };
  let sepData = null;
  const mockResSep = {
    status: (s) => ({
      json: (d) => {
        sepData = d;
      }
    })
  };
  await chantierController.getChantierJournal(mockReqSep, mockResSep);

  assert('September has 30 days', sepData.days.length === 30);
  const sep01 = sepData.days.find(d => d.date === '2026-09-01');
  assert('September 1 carries forward 25% authoritative progress', sep01.consolidated_progress === 25);

  // Sunday 6 September carries forward 25% without resetting
  const sun06 = sepData.days.find(d => d.date === '2026-09-06');
  assert('Sunday 6 September is NON_TRAVAILLE', sun06.statut_jour === 'NON_TRAVAILLE');
  assert('Sunday 6 September carries forward 25% without resetting', sun06.consolidated_progress === 25);

  assert('September has no demo/fake national holidays', sepData.days.every(d => !d.is_ferie || d.ferie_nom !== 'Fête Nationale Test'));

  console.log(`\n==========================================================================================`);
  console.log(`📊 CHANTIER 75 VERIFICATION: ${passed} / ${total} TESTS PASSED`);
  console.log(`==========================================================================================`);

  if (passed === total) {
    console.log('🎉 Chantier 75 tests completed successfully!');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
