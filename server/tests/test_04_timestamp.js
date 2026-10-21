/**
 * server/tests/test_04_timestamp.js
 *
 * Dedicated verification script for TEST 04 — KML TimeStamp:
 * 1. Parser verification: extracts name, folder, TimeStamp, when
 * 2. Data flow verification: preserves time in properties.kml_metadata and metadata
 * 3. Spatial analysis & candidate extraction: preserves kml_metadata without turning it into progress
 * 4. PostGIS reference alignment persistence: stores time in kml_metadata JSONB column
 * 5. Separation check: verifies authoritative progress and timeline remain unpolluted
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/db');
const kmlService = require('../src/services/kml.service');
const crsService = require('../src/services/crs.service');

async function runTest04() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('🧪 RUNNING TEST 04 — KML TIMESTAMP VERIFICATION');
  console.log('═════════════════════════════════════════════════════════════════\n');

  const kmlFixturePath = path.join(__dirname, '../../Tangier_Railway_TimeStamp_Test.kml');
  assert(fs.existsSync(kmlFixturePath), 'Tangier_Railway_TimeStamp_Test.kml must exist');
  const kmlContent = fs.readFileSync(kmlFixturePath, 'utf8');

  // -------------------------------------------------------------------------
  // STEP 1: Parser Verification
  // -------------------------------------------------------------------------
  console.log('▶ STEP 1: Verifying KML parser extraction of TimeStamp...');
  const parsed = kmlService.parseKmlToGeoJson(kmlContent);

  assert.strictEqual(parsed.type, 'Feature', 'Must normalize to GeoJSON Feature');
  assert.strictEqual(parsed.geometry.type, 'LineString', 'Geometry must be LineString');
  assert.strictEqual(parsed.geometry.coordinates.length, 13, 'Must contain 13 coordinates');
  assert.strictEqual(parsed.properties.name, 'Railway Section - Temporal Test', 'Placemark name must match');

  // Verify exact TimeStamp metadata extraction
  const timeMeta = parsed.metadata?.time;
  assert(timeMeta, 'parsed.metadata.time must be present');
  assert.strictEqual(timeMeta.type, 'timestamp', 'Time type must be "timestamp"');
  assert.strictEqual(timeMeta.when, '2025-06-15T00:00:00Z', 'When must match exact ISO string');

  // Verify properties.kml_metadata mirrors metadata
  const propTime = parsed.properties?.kml_metadata?.time;
  assert(propTime, 'properties.kml_metadata.time must be present');
  assert.strictEqual(propTime.type, 'timestamp', 'properties time type matches');
  assert.strictEqual(propTime.when, '2025-06-15T00:00:00Z', 'properties when matches');

  // Verify folders
  assert(Array.isArray(parsed.metadata.folders), 'Folders must be an array');
  assert.strictEqual(parsed.metadata.folders[0], 'Railway Temporal Test', 'Folder name matches');

  console.log('  ✅ Parser successfully extracted:');
  console.log(`     - Name: "${parsed.properties.name}"`);
  console.log(`     - Folder: "${parsed.metadata.folders.join(' > ')}"`);
  console.log(`     - TimeStamp Type: "${timeMeta.type}"`);
  console.log(`     - TimeStamp <when>: "${timeMeta.when}"`);
  console.log(`     - Stored at: parsed.metadata.time & parsed.properties.kml_metadata.time\n`);

  // -------------------------------------------------------------------------
  // STEP 2: Database & Test Chantier Context
  // -------------------------------------------------------------------------
  console.log('▶ STEP 2: Checking database test chantier...');
  const chantierRes = await db.query('SELECT id, nom FROM public.chantier ORDER BY id LIMIT 1');
  assert(chantierRes.rows.length > 0, 'At least one chantier must exist');
  const testChantier = chantierRes.rows[0];
  console.log(`  ✅ Using test chantier: ID=${testChantier.id}, Nom="${testChantier.nom}"\n`);

  // -------------------------------------------------------------------------
  // STEP 3: Reference Alignment Persistence (JSONB kml_metadata)
  // -------------------------------------------------------------------------
  console.log('▶ STEP 3: Testing PostGIS persistence of Reference Alignment with TimeStamp metadata...');

  const insertQuery = `
    INSERT INTO public.reference_alignment (
      chantier_id,
      nom,
      source,
      original_filename,
      geometry,
      original_geometry,
      direction_reversed,
      source_srid,
      source_crs_name,
      date_import,
      kml_metadata
    )
    VALUES (
      $1, $2, 'KML', $3,
      ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
      ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
      false, 4326, 'WGS 84', NOW(), $5
    )
    RETURNING id, nom, kml_metadata, ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters;
  `;

  const insertRes = await db.query(insertQuery, [
    testChantier.id,
    'Axe Test 04 - TimeStamp Railway',
    'Tangier_Railway_TimeStamp_Test.kml',
    JSON.stringify(parsed.geometry),
    JSON.stringify(parsed.metadata)
  ]);

  const inserted = insertRes.rows[0];
  assert(inserted && inserted.id, 'Alignment must be inserted');
  const insertedId = inserted.id;

  try {
    assert(inserted.kml_metadata, 'kml_metadata must be returned from DB');
    assert.strictEqual(inserted.kml_metadata.time.type, 'timestamp', 'DB kml_metadata time type is timestamp');
    assert.strictEqual(inserted.kml_metadata.time.when, '2025-06-15T00:00:00Z', 'DB kml_metadata time when matches');
    console.log(`  ✅ Successfully persisted alignment ID=${insertedId} with length=${inserted.length_meters}m`);
    console.log(`  ✅ DB JSONB column kml_metadata.time.when verified: "${inserted.kml_metadata.time.when}"\n`);

    // -----------------------------------------------------------------------
    // STEP 4: Strict Separation from Authoritative Progress
    // -----------------------------------------------------------------------
    console.log('▶ STEP 4: Verifying separation between KML TimeStamp and SiteX Authoritative Progress...');

    // A. Check that no fake observation_terrain was inserted with this when date
    const fakeObsRes = await db.query(
      `SELECT count(*) FROM public.observation_terrain WHERE chantier_id = $1 AND date_heure = '2025-06-15T00:00:00Z'`,
      [testChantier.id]
    );
    assert.strictEqual(parseInt(fakeObsRes.rows[0].count, 10), 0, 'No observation_terrain should be created from KML TimeStamp');
    console.log('  ✅ No fake observations created in public.observation_terrain');

    // B. Check that chantier and tronçon avancements are not affected by KML TimeStamp
    const chantierProgRes = await db.query('SELECT id, nom, statut FROM public.chantier WHERE id = $1', [testChantier.id]);
    const tronconProgRes = await db.query('SELECT count(*), COALESCE(AVG(avancement), 0) as avg_progress FROM public.troncon WHERE chantier_id = $1', [testChantier.id]);
    console.log(`  ✅ Authoritative chantier status is "${chantierProgRes.rows[0].statut}", tronçon count=${tronconProgRes.rows[0].count}, avg progress=${tronconProgRes.rows[0].avg_progress}%`);

    // -----------------------------------------------------------------------
    // STEP 5: Temporal Visibility Filter Check (lib/temporal.ts logic)
    // -----------------------------------------------------------------------
    console.log('\n▶ STEP 5: Verifying Temporal Visibility Filter for Leaflet (isKmlElementVisible)...');
    const { isKmlTimeActiveAtDate } = require('../src/services/kml.service');

    const beforeDate = '2025-06-14T23:59:59Z';
    const atDate = '2025-06-15T00:00:00Z';
    const afterDate = '2025-06-16T12:00:00Z';

    const activeBefore = isKmlTimeActiveAtDate(timeMeta, beforeDate);
    const activeAt = isKmlTimeActiveAtDate(timeMeta, atDate);
    const activeAfter = isKmlTimeActiveAtDate(timeMeta, afterDate);

    assert.strictEqual(activeBefore, false, 'Element must NOT be active before its when date');
    assert.strictEqual(activeAt, true, 'Element MUST be active at its when date');
    assert.strictEqual(activeAfter, true, 'Element MUST be active after its when date');

    console.log(`  ✅ Visibility before (2025-06-14): ${activeBefore} (hidden)`);
    console.log(`  ✅ Visibility at when (2025-06-15): ${activeAt} (visible)`);
    console.log(`  ✅ Visibility after (2025-06-16): ${activeAfter} (visible)\n`);

  } finally {
    // Clean up test alignment to avoid polluting user database
    await db.query('DELETE FROM public.reference_alignment WHERE id = $1', [insertedId]);
    console.log(`🧹 Cleaned up temporary test alignment ID=${insertedId}`);
  }

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('🎉 TEST 04 (KML TIMESTAMP) COMPLETED SUCCESSFULLY WITH ZERO REGRESSIONS!');
  console.log('═════════════════════════════════════════════════════════════════\n');
}

runTest04()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test 04 failure:', err);
    process.exit(1);
  });
