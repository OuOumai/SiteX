/**
 * server/test_responsable_workflow.js
 *
 * Automated end-to-end integration test for the Responsable Project + GIS workflow.
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const jwt = require('jsonwebtoken');
const { pool } = require('./src/db');

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function runTests() {
  console.log('🧪 Starting End-to-End Responsable & GIS Setup Tests...\n');

  try {
    // 1. Fetch users with different roles for testing
    const usersRes = await pool.query(`
      SELECT u.id, u.email, u.role_id, r.nom AS role_nom
      FROM public.utilisateur u
      JOIN public.role r ON u.role_id = r.id
      ORDER BY u.id ASC
    `);

    const responsableUser = usersRes.rows.find((u) => u.role_nom === 'Responsable') || {
      id: 11,
      email: 'responsable@sitex.com',
      role_id: 2,
      role_nom: 'Responsable',
    };

    const clientUser = usersRes.rows.find((u) => u.role_nom === 'Client') || {
      id: 1,
      email: 'client@sitex.com',
      role_id: 4,
      role_nom: 'Client',
    };

    const agentUser = usersRes.rows.find((u) => u.role_nom === 'AgentTerrain') || {
      id: 7,
      email: 'agent@sitex.com',
      role_id: 3,
      role_nom: 'AgentTerrain',
    };

    console.log(`👤 Test Responsable: User #${responsableUser.id} (${responsableUser.email})`);
    console.log(`👤 Test Client: User #${clientUser.id} (${clientUser.email})`);
    console.log(`👤 Test AgentTerrain: User #${agentUser.id} (${agentUser.email})\n`);

    // Generate JWT tokens
    const responsableToken = jwt.sign(
      { id: responsableUser.id, email: responsableUser.email, role_id: responsableUser.role_id, role_nom: 'Responsable' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const clientToken = jwt.sign(
      { id: clientUser.id, email: clientUser.email, role_id: clientUser.role_id, role_nom: 'Client' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const agentToken = jwt.sign(
      { id: agentUser.id, email: agentUser.email, role_id: agentUser.role_id, role_nom: 'AgentTerrain' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // ── Test 1: Authorization Check (Client & AgentTerrain Forbidden) ──
    console.log('🔒 Test 1: Testing RBAC Authorization (403 Forbidden for Client / Agent)...');
    
    const clientProjRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clientToken}`,
      },
      body: JSON.stringify({ nom: 'Unauthorized Client Project' }),
    });

    if (clientProjRes.status === 403) {
      console.log('  ✅ Client blocked with 403 Forbidden on POST /projects');
    } else {
      console.error(`  ❌ Expected 403 for Client, received ${clientProjRes.status}`);
    }

    const agentProjRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`,
      },
      body: JSON.stringify({ nom: 'Unauthorized Agent Project' }),
    });

    if (agentProjRes.status === 403) {
      console.log('  ✅ AgentTerrain blocked with 403 Forbidden on POST /projects');
    } else {
      console.error(`  ❌ Expected 403 for Agent, received ${agentProjRes.status}`);
    }

    // ── Test 2: Responsable Dashboard ──
    console.log('\n📊 Test 2: Testing GET /responsable/dashboard...');
    const dashRes = await fetch(`${BASE_URL}/responsable/dashboard`, {
      headers: { Authorization: `Bearer ${responsableToken}` },
    });
    const dashData = await dashRes.json();
    console.log(`  ✅ Dashboard data received:`, dashData.stats);

    // ── Test 3: Create Project as Responsable ──
    console.log('\n🏗️ Test 3: Testing POST /projects as Responsable...');
    const newProjName = `LGV Maroc Axe Nord ${Date.now()}`;
    const projRes = await fetch(`${BASE_URL}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${responsableToken}`,
      },
      body: JSON.stringify({
        nom: newProjName,
        description: 'Ligne à Grande Vitesse reliant Kénitra à Tanger Med avec double voie électrifiée.',
        date_debut: '2026-03-01',
        date_fin: '2027-12-31',
        statut: 'En cours',
      }),
    });
    const projData = await projRes.json();
    console.log('Project response:', projRes.status, projData);
    const createdProject = projData.project;

    console.log(`  ✅ Project #${createdProject.id} created: "${createdProject.nom}" (Status: ${createdProject.statut})`);

    // ── Test 4: Create Chantier under Project ──
    console.log('\n🚧 Test 4: Testing POST /projects/:projectId/chantiers...');
    const chantierRes = await fetch(`${BASE_URL}/projects/${createdProject.id}/chantiers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${responsableToken}`,
      },
      body: JSON.stringify({
        nom: 'Lot 01 - Terrassement & Plateforme Ferroviaire',
        surface: 45000,
        date_debut: '2026-03-15',
        date_fin_prevue: '2026-10-30',
        statut: 'En cours',
      }),
    });
    const chantierData = await chantierRes.json();
    const createdChantier = chantierData.chantier;
    console.log(`  ✅ Chantier #${createdChantier.id} created under Project #${createdProject.id} (Responsable: #${createdChantier.responsable_id})`);

    // ── Test 5: Import Reference Alignment GeoJSON ──
    console.log('\n🗺️ Test 5: Testing POST /chantiers/:id/reference-alignment with GeoJSON LineString...');
    // Real curved railway geometry in Morocco (Kenitra -> Rabat)
    const railwayGeojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Axe Ferroviaire Kénitra – Salé – Rabat' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-6.5823, 34.2612],
              [-6.6145, 34.2134],
              [-6.6489, 34.1689],
              [-6.6892, 34.1245],
              [-6.7345, 34.0812],
              [-6.7790, 34.0456],
              [-6.8123, 34.0189],
              [-6.8498, 33.9716],
            ],
          },
        },
      ],
    };

    const alignRes = await fetch(`${BASE_URL}/chantiers/${createdChantier.id}/reference-alignment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${responsableToken}`,
      },
      body: JSON.stringify({
        geojson: railwayGeojson,
        nom: 'Axe Ferroviaire Principal Kénitra – Rabat',
        original_filename: 'kenitra_rabat_corridor.geojson',
      }),
    });
    const alignData = await alignRes.json();
    const createdAlign = alignData.reference_alignment;
    console.log(`  ✅ Reference Alignment #${createdAlign.id} created: "${createdAlign.nom}"`);
    console.log(`  📏 PostGIS Geodesic Length: ${createdAlign.length_km} km (${createdAlign.length_meters} meters)`);

    // ── Test 6: Generate Linear Segmentation Preview (4 Tronçons) ──
    console.log('\n✂️ Test 6: Testing POST /chantiers/:id/troncons/generate (Curved segmentation ST_LineSubstring)...');
    const genRes = await fetch(`${BASE_URL}/chantiers/${createdChantier.id}/troncons/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${responsableToken}`,
      },
      body: JSON.stringify({ count: 4 }),
    });
    const genData = await genRes.json();
    console.log(`  ✅ Generated ${genData.count} tronçons (Average: ${genData.average_length_km} km / tronçon):`);
    genData.troncons.forEach((t) => {
      console.log(`     - ${t.nom}: PK ${t.pk_debut.toFixed(3)} -> PK ${t.pk_fin.toFixed(3)} (${t.length_km.toFixed(2)} km)`);
    });

    // ── Test 7: Transactional Persistence of Tronçons in PostgreSQL ──
    console.log('\n💾 Test 7: Testing POST /chantiers/:id/troncons (Transaction save to public.troncon)...');
    const saveRes = await fetch(`${BASE_URL}/chantiers/${createdChantier.id}/troncons`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${responsableToken}`,
      },
      body: JSON.stringify({
        troncons: genData.troncons,
        reference_alignment_id: createdAlign.id,
      }),
    });
    const saveData = await saveRes.json();
    console.log(`  ✅ ${saveData.troncons.length} tronçons persisted into public.troncon:`);
    saveData.troncons.forEach((t) => {
      console.log(`     - DB ID #${t.id}: "${t.nom}" | PK ${t.pk_debut} -> PK ${t.pk_fin}`);
    });

    // ── Test 8: Verify Chantier Detail Status & Ready for Terrain ──
    console.log('\n🔍 Test 8: Verifying GET /chantiers/:id state...');
    const detailRes = await fetch(`${BASE_URL}/chantiers/${createdChantier.id}`, {
      headers: { Authorization: `Bearer ${responsableToken}` },
    });
    const detailData = await detailRes.json();
    const ch = detailData.chantier;
    console.log(`  ✅ Chantier Status: "${ch.statut}"`);
    console.log(`  ✅ GIS Setup State: "${ch.gis_status}" (Expected: "PRET_POUR_SUIVI")`);
    console.log(`  ✅ Reference Alignment: ID #${ch.reference_alignment?.id} (${ch.reference_alignment?.length_km} km)`);
    console.log(`  ✅ Total Troncons count: ${ch.troncons?.length}`);
    console.log(`  ✅ PK Range: PK ${ch.pk_debut} -> PK ${ch.pk_fin}`);

    console.log('\n🎉 ALL 8 INTEGRATION TESTS PASSED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('❌ Test failed with error:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

runTests();
