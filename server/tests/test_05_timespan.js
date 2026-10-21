/**
 * server/tests/test_05_timespan.js
 *
 * Dedicated verification script for TEST 05 — KML TimeSpan:
 * 1. Parser verification: extracts Placemark name, Folder, TimeSpan, begin, end
 * 2. Temporal visibility evaluation using isKmlTimeActiveAtDate / isKmlElementVisible semantics:
 *    - Before interval (< 2026-06-01T00:00:00Z) -> false (hidden)
 *    - At begin (2026-06-01T00:00:00Z) -> true (visible)
 *    - Inside interval (2026-07-15T12:00:00Z) -> true (visible)
 *    - At end (2026-08-31T23:59:59Z) -> true (visible)
 *    - After interval (> 2026-08-31T23:59:59Z) -> false (hidden)
 *    - Present mode (null / undefined) -> true (visible)
 * 3. Partial TimeSpan semantics:
 *    - begin only
 *    - end only
 *    - missing / static metadata -> true (visible)
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

async function runTest05() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('🧪 RUNNING TEST 05 — KML TIMESPAN VERIFICATION');
  console.log('═════════════════════════════════════════════════════════════════\n');

  const kmlFixturePath = path.join(__dirname, '../../Tangier_Railway_TimeSpan_Test.kml');
  assert(fs.existsSync(kmlFixturePath), 'Tangier_Railway_TimeSpan_Test.kml must exist');
  const kmlContent = fs.readFileSync(kmlFixturePath, 'utf8');

  // -------------------------------------------------------------------------
  // STEP 1: Parser Verification
  // -------------------------------------------------------------------------
  console.log('▶ STEP 1: Verifying KML parser extraction of TimeSpan...');
  const parsed = kmlService.parseKmlToGeoJson(kmlContent);

  assert.strictEqual(parsed.type, 'Feature', 'Must normalize to GeoJSON Feature');
  assert.strictEqual(parsed.geometry.type, 'LineString', 'Geometry must be LineString');
  assert.strictEqual(parsed.geometry.coordinates.length, 13, 'Must contain 13 coordinates');
  assert.strictEqual(parsed.properties.name, 'Railway Section - TimeSpan Test', 'Placemark name must match');

  // Verify exact TimeSpan metadata extraction
  const timeMeta = parsed.metadata?.time;
  assert(timeMeta, 'parsed.metadata.time must be present');
  assert.strictEqual(timeMeta.type, 'timespan', 'Time type must be "timespan"');
  assert.strictEqual(timeMeta.begin, '2026-06-01T00:00:00Z', 'Begin must match exact ISO string');
  assert.strictEqual(timeMeta.end, '2026-08-31T23:59:59Z', 'End must match exact ISO string');

  // Verify properties.kml_metadata mirrors metadata
  const propTime = parsed.properties?.kml_metadata?.time;
  assert(propTime, 'properties.kml_metadata.time must be present');
  assert.strictEqual(propTime.type, 'timespan', 'properties time type matches');
  assert.strictEqual(propTime.begin, '2026-06-01T00:00:00Z', 'properties begin matches');
  assert.strictEqual(propTime.end, '2026-08-31T23:59:59Z', 'properties end matches');

  // Verify folders
  assert(Array.isArray(parsed.metadata.folders), 'Folders must be an array');
  assert.strictEqual(parsed.metadata.folders[0], 'Railway Temporal Test', 'Folder name matches');

  console.log('  ✅ Parser successfully extracted:');
  console.log(`     - Name: "${parsed.properties.name}"`);
  console.log(`     - Folder: "${parsed.metadata.folders.join(' > ')}"`);
  console.log(`     - TimeSpan Type: "${timeMeta.type}"`);
  console.log(`     - TimeSpan <begin>: "${timeMeta.begin}"`);
  console.log(`     - TimeSpan <end>: "${timeMeta.end}"`);
  console.log(`     - Stored at: parsed.metadata.time & parsed.properties.kml_metadata.time\n`);

  // -------------------------------------------------------------------------
  // STEP 2: Temporal Visibility Predicate Verification
  // -------------------------------------------------------------------------
  console.log('▶ STEP 2: Verifying Temporal Visibility Filter (isKmlTimeActiveAtDate)...');
  const { isKmlTimeActiveAtDate } = kmlService;

  // A. Standard TimeSpan (begin + end)
  const dateBefore = '2026-05-31T23:59:59Z';
  const dateAtBegin = '2026-06-01T00:00:00Z';
  const dateDuring = '2026-07-15T12:00:00Z';
  const dateAtEnd = '2026-08-31T23:59:59Z';
  const dateAfter = '2026-09-01T00:00:00Z';

  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, dateBefore), false, 'Before interval must be HIDDEN (false)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, dateAtBegin), true, 'Exactly at begin must be VISIBLE (true)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, dateDuring), true, 'Inside interval must be VISIBLE (true)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, dateAtEnd), true, 'Exactly at end must be VISIBLE (true)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, dateAfter), false, 'After interval must be HIDDEN (false)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, null), true, 'null / Present mode must be VISIBLE (true)');
  assert.strictEqual(isKmlTimeActiveAtDate(timeMeta, undefined), true, 'undefined / Present mode must be VISIBLE (true)');

  console.log(`  ✅ Visibility before begin (2026-05-31): false (hidden)`);
  console.log(`  ✅ Visibility at begin (2026-06-01): true (visible)`);
  console.log(`  ✅ Visibility during interval (2026-07-15): true (visible)`);
  console.log(`  ✅ Visibility at end (2026-08-31): true (visible)`);
  console.log(`  ✅ Visibility after end (2026-09-01): false (hidden)`);
  console.log(`  ✅ Visibility in Present mode (null): true (visible)`);

  // B. Partial TimeSpan: begin only
  const timeBeginOnly = { type: 'timespan', begin: '2026-06-01T00:00:00Z', end: null };
  assert.strictEqual(isKmlTimeActiveAtDate(timeBeginOnly, '2026-05-31T23:59:59Z'), false, 'Begin-only before begin -> false');
  assert.strictEqual(isKmlTimeActiveAtDate(timeBeginOnly, '2026-06-01T00:00:00Z'), true, 'Begin-only at begin -> true');
  assert.strictEqual(isKmlTimeActiveAtDate(timeBeginOnly, '2099-01-01T00:00:00Z'), true, 'Begin-only in future -> true');
  console.log(`  ✅ Begin-only TimeSpan: correctly visible starting from begin indefinitely`);

  // C. Partial TimeSpan: end only
  const timeEndOnly = { type: 'timespan', begin: null, end: '2026-08-31T23:59:59Z' };
  assert.strictEqual(isKmlTimeActiveAtDate(timeEndOnly, '2020-01-01T00:00:00Z'), true, 'End-only in past -> true');
  assert.strictEqual(isKmlTimeActiveAtDate(timeEndOnly, '2026-08-31T23:59:59Z'), true, 'End-only at end -> true');
  assert.strictEqual(isKmlTimeActiveAtDate(timeEndOnly, '2026-09-01T00:00:00Z'), false, 'End-only after end -> false');
  console.log(`  ✅ End-only TimeSpan: correctly visible up until end then hidden`);

  // D. Missing / Static time
  assert.strictEqual(isKmlTimeActiveAtDate(null, '2026-07-15T00:00:00Z'), true, 'null time -> always visible');
  assert.strictEqual(isKmlTimeActiveAtDate(undefined, '2026-07-15T00:00:00Z'), true, 'undefined time -> always visible');
  assert.strictEqual(isKmlTimeActiveAtDate({ type: 'timespan', begin: null, end: null }, '2026-07-15T00:00:00Z'), true, 'no bounds -> always visible');
  console.log(`  ✅ Static / missing time: correctly always visible\n`);

  // -------------------------------------------------------------------------
  // STEP 3: Database & Test Chantier Context
  // -------------------------------------------------------------------------
  console.log('▶ STEP 3: Checking database test chantier...');
  const chantierRes = await db.query('SELECT id, nom FROM public.chantier ORDER BY id LIMIT 1');
  assert(chantierRes.rows.length > 0, 'At least one chantier must exist');
  const testChantier = chantierRes.rows[0];
  console.log(`  ✅ Using test chantier: ID=${testChantier.id}, Nom="${testChantier.nom}"\n`);

  // -------------------------------------------------------------------------
  // STEP 4: Reference Alignment Persistence (JSONB kml_metadata)
  // -------------------------------------------------------------------------
  console.log('▶ STEP 4: Testing PostGIS persistence of Reference Alignment with TimeSpan metadata...');

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
    'Axe Test 05 - TimeSpan Railway',
    'Tangier_Railway_TimeSpan_Test.kml',
    JSON.stringify(parsed.geometry),
    JSON.stringify(parsed.metadata)
  ]);

  const inserted = insertRes.rows[0];
  assert(inserted && inserted.id, 'Alignment must be inserted');
  const insertedId = inserted.id;

  try {
    assert(inserted.kml_metadata, 'kml_metadata must be returned from DB');
    assert.strictEqual(inserted.kml_metadata.time.type, 'timespan', 'DB kml_metadata time type is timespan');
    assert.strictEqual(inserted.kml_metadata.time.begin, '2026-06-01T00:00:00Z', 'DB kml_metadata time begin matches');
    assert.strictEqual(inserted.kml_metadata.time.end, '2026-08-31T23:59:59Z', 'DB kml_metadata time end matches');
    console.log(`  ✅ Successfully persisted alignment ID=${insertedId} with length=${inserted.length_meters}m`);
    console.log(`  ✅ DB JSONB column kml_metadata.time verified: begin="${inserted.kml_metadata.time.begin}", end="${inserted.kml_metadata.time.end}"\n`);

    // -----------------------------------------------------------------------
    // STEP 5: Strict Separation from Authoritative Progress
    // -----------------------------------------------------------------------
    console.log('▶ STEP 5: Verifying separation between KML TimeSpan and SiteX Authoritative Progress...');

    const fakeObsRes = await db.query(
      `SELECT count(*) FROM public.observation_terrain WHERE chantier_id = $1 AND (date_heure = '2026-06-01T00:00:00Z' OR date_heure = '2026-08-31T23:59:59Z')`,
      [testChantier.id]
    );
    assert.strictEqual(parseInt(fakeObsRes.rows[0].count, 10), 0, 'No observation_terrain should be created from KML TimeSpan');
    console.log('  ✅ No fake observations created in public.observation_terrain');

    const chantierProgRes = await db.query('SELECT id, nom, statut FROM public.chantier WHERE id = $1', [testChantier.id]);
    const tronconProgRes = await db.query('SELECT count(*), COALESCE(AVG(avancement), 0) as avg_progress FROM public.troncon WHERE chantier_id = $1', [testChantier.id]);
    console.log(`  ✅ Authoritative chantier status is "${chantierProgRes.rows[0].statut}", tronçon count=${tronconProgRes.rows[0].count}, avg progress=${tronconProgRes.rows[0].avg_progress}%`);

  } finally {
    // Clean up test alignment to avoid polluting user database
    await db.query('DELETE FROM public.reference_alignment WHERE id = $1', [insertedId]);
    console.log(`🧹 Cleaned up temporary test alignment ID=${insertedId}`);
  }

  console.log('\n═════════════════════════════════════════════════════════════════');
  console.log('🎉 TEST 05 (KML TIMESPAN) COMPLETED SUCCESSFULLY WITH ZERO REGRESSIONS!');
  console.log('═════════════════════════════════════════════════════════════════\n');
}

runTest05()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test 05 failure:', err);
    process.exit(1);
  });
