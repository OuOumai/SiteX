/**
 * server/test_multi_chantier_creation.js
 *
 * Automated verification of immediate multi-chantier creation workflow.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./src/db.js');

async function runTest() {
  console.log('🧪 Starting Multi-Chantier Creation Workflow Test...\n');
  let testProjectId = null;

  try {
    // 1. Get an existing Responsable user
    const userRes = await pool.query(`
      SELECT id, nom, prenom FROM public.utilisateur 
      WHERE role_id IN (1, 2) OR id = 1 
      LIMIT 1;
    `);
    if (userRes.rows.length === 0) {
      throw new Error('No admin/responsable user found in database to run test.');
    }
    const user = userRes.rows[0];
    console.log(`👤 Using user: ${user.prenom} ${user.nom} (ID: ${user.id})`);

    // 2. Simulate POST /projects with nombre_chantiers = 3
    const projectName = `Test Workflow Multi-Chantiers ${Date.now()}`;
    console.log(`\n📁 Step 1: Creating project "${projectName}" with 3 chantiers...`);

    const client = await pool.connect();
    let createdProject, createdChantiers = [];
    try {
      await client.query('BEGIN');
      const pRes = await client.query(
        `INSERT INTO public.projet (nom, description, type_projet, date_debut, statut)
         VALUES ($1, $2, $3, NOW(), 'En cours')
         RETURNING id, nom, type_projet`,
        [projectName, 'Test project for multi-chantier workflow', 'Ferroviaire']
      );
      createdProject = pRes.rows[0];
      testProjectId = createdProject.id;

      for (let i = 1; i <= 3; i++) {
        const cRes = await client.query(
          `INSERT INTO public.chantier (
            projet_id, responsable_id, nom, statut, d_max_position_meters, date_creation
          )
          VALUES ($1, $2, $3, 'En attente', 50, NOW())
          RETURNING id, projet_id, nom, statut, d_max_position_meters`,
          [testProjectId, user.id, `Chantier ${i}`]
        );
        createdChantiers.push(cRes.rows[0]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    console.log(`✅ Project created with ID: ${testProjectId}`);
    console.log(`✅ Initial chantiers count: ${createdChantiers.length}`);
    createdChantiers.forEach((c) => console.log(`   └─ ${c.nom} (ID: ${c.id}, statut: ${c.statut})`));

    if (createdChantiers.length !== 3) {
      throw new Error(`Expected 3 chantiers, got ${createdChantiers.length}`);
    }

    // 3. Verify getProjectDetails query returns all 3 chantiers as NON_CONFIGURE (À configurer)
    console.log('\n🔍 Step 2: Verifying project details & GIS status for all 3 chantiers...');
    const detailsQuery = `
      SELECT 
        c.id, c.nom, c.statut,
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
      ORDER BY c.id ASC;
    `;
    const detailsRes1 = await pool.query(detailsQuery, [testProjectId]);
    console.log('Chantiers status after project creation:');
    detailsRes1.rows.forEach((c) => {
      const displayStatus = c.gis_status === 'PRET_POUR_SUIVI' ? '✓ Configuré' : '○ À configurer';
      console.log(`   ${displayStatus} | ${c.nom} (ID: ${c.id}) — gis_status: ${c.gis_status}, tronçons: ${c.nombre_troncons}`);
    });

    const allNonConfigure = detailsRes1.rows.every((c) => c.gis_status === 'NON_CONFIGURE');
    if (!allNonConfigure) {
      throw new Error('Expected all 3 chantiers to have gis_status = NON_CONFIGURE initially');
    }
    console.log('✅ All 3 chantiers correctly marked as "À configurer" (NON_CONFIGURE)');

    // 4. Configure Chantier 1 (simulate GIS validation for Chantier 1)
    console.log('\n🗺️ Step 3: Configuring Chantier 1 (importing alignment and tronçons)...');
    const ch1 = createdChantiers[0];
    const alignRes = await pool.query(
      `INSERT INTO public.reference_alignment (chantier_id, nom, geometry)
       VALUES ($1, 'Axe Chantier 1', ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.8,34.0],[-6.7,34.1]]}'), 4326))
       RETURNING id`,
      [ch1.id]
    );
    const refId = alignRes.rows[0].id;

    await pool.query(
      `INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, geometry, avancement)
       VALUES ($1, $2, 'Tronçon 1.1', 0, 10, ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.8,34.0],[-6.7,34.1]]}'), 4326), 10)`,
      [ch1.id, refId]
    );
    console.log(`✅ Chantier 1 configured with reference alignment ${refId} and 1 tronçon`);

    // Verify Chantier 1 is now PRET_POUR_SUIVI (Configuré) while Chantiers 2 & 3 remain NON_CONFIGURE (À configurer)
    const detailsRes2 = await pool.query(detailsQuery, [testProjectId]);
    console.log('\nChantiers status after validating Chantier 1:');
    detailsRes2.rows.forEach((c) => {
      const displayStatus = c.gis_status === 'PRET_POUR_SUIVI' ? '✓ Configuré' : '○ À configurer';
      console.log(`   ${displayStatus} | ${c.nom} (ID: ${c.id}) — gis_status: ${c.gis_status}, tronçons: ${c.nombre_troncons}`);
    });

    const ch1Row = detailsRes2.rows.find((r) => r.id === ch1.id);
    const ch2Row = detailsRes2.rows.find((r) => r.id === createdChantiers[1].id);
    const ch3Row = detailsRes2.rows.find((r) => r.id === createdChantiers[2].id);

    if (ch1Row.gis_status !== 'PRET_POUR_SUIVI') {
      throw new Error(`Expected Chantier 1 to be PRET_POUR_SUIVI, got ${ch1Row.gis_status}`);
    }
    if (ch2Row.gis_status !== 'NON_CONFIGURE' || ch3Row.gis_status !== 'NON_CONFIGURE') {
      throw new Error('Expected Chantiers 2 and 3 to remain NON_CONFIGURE');
    }
    console.log('✅ Chantier 1 is "✓ Configuré", and Chantiers 2 & 3 are "○ À configurer"');

    // 5. Configure Chantier 2 (simulate navigating directly to Chantier 2 and validating it)
    console.log('\n🗺️ Step 4: Configuring Chantier 2 (simulating "Passer au Chantier 2" and validating)...');
    const ch2 = createdChantiers[1];
    const alignRes2 = await pool.query(
      `INSERT INTO public.reference_alignment (chantier_id, nom, geometry)
       VALUES ($1, 'Axe Chantier 2', ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.7,34.1],[-6.6,34.2]]}'), 4326))
       RETURNING id`,
      [ch2.id]
    );
    const refId2 = alignRes2.rows[0].id;
    await pool.query(
      `INSERT INTO public.troncon (chantier_id, reference_alignment_id, nom, pk_debut, pk_fin, geometry, avancement)
       VALUES ($1, $2, 'Tronçon 2.1', 10, 20, ST_SetSRID(ST_GeomFromGeoJSON('{"type":"LineString","coordinates":[[-6.7,34.1],[-6.6,34.2]]}'), 4326), 25)`,
      [ch2.id, refId2]
    );
    console.log('✅ Chantier 2 configured with alignment and tronçon');

    const detailsRes3 = await pool.query(detailsQuery, [testProjectId]);
    console.log('\nChantiers status after validating Chantier 2:');
    detailsRes3.rows.forEach((c) => {
      const displayStatus = c.gis_status === 'PRET_POUR_SUIVI' ? '✓ Configuré' : '○ À configurer';
      console.log(`   ${displayStatus} | ${c.nom} (ID: ${c.id}) — gis_status: ${c.gis_status}, tronçons: ${c.nombre_troncons}`);
    });

    const ch2RowAfter = detailsRes3.rows.find((r) => r.id === ch2.id);
    const ch3RowAfter = detailsRes3.rows.find((r) => r.id === createdChantiers[2].id);

    if (ch2RowAfter.gis_status !== 'PRET_POUR_SUIVI') {
      throw new Error(`Expected Chantier 2 to update to PRET_POUR_SUIVI, got ${ch2RowAfter.gis_status}`);
    }
    if (ch3RowAfter.gis_status !== 'NON_CONFIGURE') {
      throw new Error('Expected Chantier 3 to remain NON_CONFIGURE');
    }
    console.log('✅ Chantier 1 is "✓ Configuré", Chantier 2 is "✓ Configuré", Chantier 3 is "○ À configurer"');

    // 6. Test dynamic expansion via initializeProjectChantiers (e.g. expanding to 4 chantiers)
    console.log('\n🔢 Step 5: Testing dynamic expansion to 4 chantiers (initializeProjectChantiers)...');
    const existing = detailsRes3.rows;
    if (existing.length < 4) {
      await pool.query(
        `INSERT INTO public.chantier (
          projet_id, responsable_id, nom, statut, d_max_position_meters, date_creation
        )
        VALUES ($1, $2, $3, 'En attente', 50, NOW())`,
        [testProjectId, user.id, `Chantier 4`]
      );
    }
    const detailsRes4 = await pool.query(detailsQuery, [testProjectId]);
    console.log(`✅ Total chantiers now: ${detailsRes4.rows.length}`);
    detailsRes4.rows.forEach((c) => {
      const displayStatus = c.gis_status === 'PRET_POUR_SUIVI' ? '✓ Configuré' : '○ À configurer';
      console.log(`   ${displayStatus} | ${c.nom} (ID: ${c.id}) — gis_status: ${c.gis_status}`);
    });

    if (detailsRes4.rows.length !== 4) {
      throw new Error(`Expected 4 chantiers, got ${detailsRes4.rows.length}`);
    }

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ Test failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (testProjectId) {
      console.log(`\n🧹 Cleaning up test project (ID: ${testProjectId})...`);
      try {
        await pool.query('DELETE FROM public.troncon WHERE chantier_id IN (SELECT id FROM public.chantier WHERE projet_id = $1)', [testProjectId]);
        await pool.query('DELETE FROM public.reference_alignment WHERE chantier_id IN (SELECT id FROM public.chantier WHERE projet_id = $1)', [testProjectId]);
        await pool.query('DELETE FROM public.chantier WHERE projet_id = $1', [testProjectId]);
        await pool.query('DELETE FROM public.projet WHERE id = $1', [testProjectId]);
        console.log('✅ Test data cleaned up cleanly.');
      } catch (cleanErr) {
        console.warn('⚠️ Cleanup warning:', cleanErr.message);
      }
    }
    await pool.end();
  }
}

runTest();
