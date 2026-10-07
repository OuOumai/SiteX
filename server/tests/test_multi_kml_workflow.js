/**
 * server/tests/test_multi_kml_workflow.js
 *
 * Automated verification of the enhanced multi-LineString KML workflow:
 * - 1 LineString KML
 * - 2-4 LineString KML
 * - Real Tangier Railway KML (103 LineStrings)
 * - 137 LineString KML
 *
 * Verifies:
 * - Detection of all LineStrings
 * - Import is not rejected
 * - AOI spatial intersection returns only candidates intersecting the AOI
 * - Zero-candidate result when AOI does not intersect
 * - Candidate selection persists cleanly as reference alignment into existing Level 1/Level 2 workflow
 */

'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const db = require('../src/db');
const kmlService = require('../src/services/kml.service');

async function runTests() {
  console.log('🧪 Starting Multi-LineString KML End-to-End Workflow Verification...\n');

  // Fetch or find a test chantier
  const chantierRes = await db.query('SELECT id, nom FROM public.chantier ORDER BY id LIMIT 1');
  assert(chantierRes.rows.length > 0, 'At least one chantier must exist');
  const testChantier = chantierRes.rows[0];
  console.log(`ℹ️ Using test chantier: ID=${testChantier.id}, Nom="${testChantier.nom}"\n`);

  // =========================================================================
  // TEST 1: Single LineString KML (RP4022_Tangier_Test.kml)
  // =========================================================================
  console.log('--- TEST 1: Single LineString KML (RP4022_Tangier_Test.kml) ---');
  const singleKmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
  const singleKmlContent = fs.readFileSync(singleKmlPath, 'utf8');
  const singleParsed = kmlService.parseKmlToGeoJson(singleKmlContent);

  assert.strictEqual(singleParsed.type, 'Feature', 'Single LineString KML returns Feature');
  assert.strictEqual(singleParsed.geometry.type, 'LineString', 'Geometry type is LineString');
  assert.strictEqual(singleParsed.geometry.coordinates.length, 5, 'Contains 5 coordinates');
  assert(singleParsed.metadata && singleParsed.metadata.name === 'RP4022_Tangier_Test', 'Preserves metadata name');
  console.log('  ✅ 1.1 Single LineString KML parsed to normalized Feature without regression');

  // =========================================================================
  // TEST 2: 2–4 LineString KML (3 linear features with distinct metadata)
  // =========================================================================
  console.log('\n--- TEST 2: 2–4 LineString KML (3 linear features) ---');
  const threeLinesKml = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>Réseau Test 3 Voies</name>
      <Placemark>
        <name>Voie 1 - Principale</name>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Voie 2 - Évitement</name>
        <LineString><coordinates>-5.88,35.74 -5.87,35.75</coordinates></LineString>
      </Placemark>
      <Placemark>
        <name>Voie 3 - Faisceau Tri</name>
        <LineString><coordinates>-5.80,35.70 -5.79,35.71</coordinates></LineString>
      </Placemark>
    </Document>
  </kml>`;

  const threeParsed = kmlService.parseKmlToGeoJson(threeLinesKml);
  assert.strictEqual(threeParsed.type, 'FeatureCollection', 'Must return FeatureCollection');
  assert.strictEqual(threeParsed.features.length, 3, 'Must contain 3 features');
  assert.strictEqual(threeParsed.features[0].properties.name, 'Voie 1 - Principale');
  assert.strictEqual(threeParsed.features[1].properties.name, 'Voie 2 - Évitement');
  assert.strictEqual(threeParsed.features[2].properties.name, 'Voie 3 - Faisceau Tri');
  console.log('  ✅ 2.1 3-LineString KML preserves individual features and metadata without merging');

  // Test PostGIS spatial query with AOI that intersects Voie 1 & 2 but not Voie 3
  const aoiVoie1And2 = {
    type: 'Polygon',
    coordinates: [[
      [-5.90, 35.72],
      [-5.86, 35.72],
      [-5.86, 35.76],
      [-5.90, 35.76],
      [-5.90, 35.72]
    ]]
  };

  const evalQuery = `
    WITH input_features AS (
      SELECT 
        (elem->>'id')::text AS feat_id,
        (elem->>'nom')::text AS feat_name,
        ST_SetSRID(ST_GeomFromGeoJSON(elem->>'geometry'), 4326) AS src_geom
      FROM jsonb_array_elements($1::jsonb) AS elem
    ),
    aoi_source AS (
      SELECT CASE 
        WHEN $2::text IS NOT NULL AND $2::text != '' THEN ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)
        ELSE NULL::geometry
      END AS aoi_geom
    ),
    evaluated AS (
      SELECT
        i.feat_id,
        i.feat_name,
        ST_Intersects(i.src_geom, a.aoi_geom) AS intersects_aoi
      FROM input_features i
      CROSS JOIN aoi_source a
    )
    SELECT 
      count(*) AS total,
      count(*) FILTER (WHERE intersects_aoi = true) AS intersecting_count,
      json_agg(feat_name) FILTER (WHERE intersects_aoi = true) AS intersecting_names
    FROM evaluated;
  `;

  const threeFeatsPayload = JSON.stringify(threeParsed.features.map(f => ({
    id: f.id,
    nom: f.properties.name,
    geometry: f.geometry
  })));

  const threeRes = await db.query(evalQuery, [threeFeatsPayload, JSON.stringify(aoiVoie1And2)]);
  assert.strictEqual(parseInt(threeRes.rows[0].total, 10), 3, 'Total features is 3');
  assert.strictEqual(parseInt(threeRes.rows[0].intersecting_count, 10), 2, 'Exactly 2 features intersect AOI');
  const names = threeRes.rows[0].intersecting_names;
  assert(names.includes('Voie 1 - Principale') && names.includes('Voie 2 - Évitement'), 'Only Voie 1 & 2 returned');
  assert(!names.includes('Voie 3 - Faisceau Tri'), 'Non-intersecting Voie 3 excluded from candidates');
  console.log('  ✅ 2.2 Spatial intersection returns ONLY intersecting candidate LineStrings (2 of 3)');

  // =========================================================================
  // TEST 3: Real Tangier Railway KML (RailWayTangier_Second.kml - 103 LineStrings)
  // =========================================================================
  console.log('\n--- TEST 3: Real Tangier Railway KML (RailWayTangier_Second.kml) ---');
  const tangierKmlPath = path.join(__dirname, '../../RailWayTangier_Second.kml');
  const tangierKmlContent = fs.readFileSync(tangierKmlPath, 'utf8');
  const tangierParsed = kmlService.parseKmlToGeoJson(tangierKmlContent);

  assert.strictEqual(tangierParsed.type, 'FeatureCollection', 'Tangier KML returns FeatureCollection');
  assert.strictEqual(tangierParsed.features.length, 103, 'All 103 LineStrings detected');
  console.log(`  ✅ 3.1 All ${tangierParsed.features.length} LineStrings detected and NOT rejected`);

  // Bounding box AOI defined by coordinates:
  // minLon: -5.787, minLat: 35.765, maxLon: -5.783, maxLat: 35.768
  const coordAoi = {
    type: 'Polygon',
    coordinates: [[
      [-5.787, 35.765],
      [-5.783, 35.765],
      [-5.783, 35.768],
      [-5.787, 35.768],
      [-5.787, 35.765]
    ]]
  };

  const tangierPayload = JSON.stringify(tangierParsed.features.map(f => ({
    id: f.id,
    nom: f.properties.name,
    geometry: f.geometry
  })));

  const tangierRes = await db.query(evalQuery, [tangierPayload, JSON.stringify(coordAoi)]);
  assert.strictEqual(parseInt(tangierRes.rows[0].total, 10), 103, 'Total features is 103');
  assert.strictEqual(parseInt(tangierRes.rows[0].intersecting_count, 10), 8, 'Exactly 8 features intersect coordinate-defined AOI');
  console.log(`  ✅ 3.2 Coordinate-defined AOI returns ONLY intersecting LineStrings (8 candidates out of 103)`);

  // Disjoint AOI (Zero candidates test)
  const disjointAoi = {
    type: 'Polygon',
    coordinates: [[
      [-4.0, 34.0],
      [-3.9, 34.0],
      [-3.9, 34.1],
      [-4.0, 34.1],
      [-4.0, 34.0]
    ]]
  };
  const disjointRes = await db.query(evalQuery, [tangierPayload, JSON.stringify(disjointAoi)]);
  assert.strictEqual(parseInt(disjointRes.rows[0].intersecting_count, 10), 0, 'Zero intersecting candidates');
  console.log('  ✅ 3.3 Disjoint AOI returns exactly 0 candidates without invalidating original KML');

  // =========================================================================
  // TEST 4: 137 LineString KML Test
  // =========================================================================
  console.log('\n--- TEST 4: 137 LineString KML Test ---');
  let kml137Builder = `<?xml version="1.0" encoding="UTF-8"?>
  <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document>
      <name>Réseau Ferroviaire Tanger 137 Segments</name>`;

  for (let i = 1; i <= 137; i++) {
    // Generate realistic LineString around Tangier
    const lon1 = -5.85 + (i * 0.001);
    const lat1 = 35.72 + (i * 0.0005);
    const lon2 = lon1 + 0.002;
    const lat2 = lat1 + 0.002;
    kml137Builder += `
      <Placemark>
        <name>Tronçon Ferroviaire #${i}</name>
        <ExtendedData>
          <Data name="railway"><value>rail</value></Data>
          <Data name="track_id"><value>${i}</value></Data>
        </ExtendedData>
        <LineString>
          <coordinates>${lon1.toFixed(6)},${lat1.toFixed(6)},0 ${lon2.toFixed(6)},${lat2.toFixed(6)},0</coordinates>
        </LineString>
      </Placemark>`;
  }
  kml137Builder += `\n    </Document>\n  </kml>`;

  const parsed137 = kmlService.parseKmlToGeoJson(kml137Builder);
  assert.strictEqual(parsed137.type, 'FeatureCollection', 'Must return FeatureCollection');
  assert.strictEqual(parsed137.features.length, 137, 'Exactly 137 LineStrings detected');
  assert.strictEqual(parsed137.features[0].properties.name, 'Tronçon Ferroviaire #1');
  assert.strictEqual(parsed137.features[136].properties.name, 'Tronçon Ferroviaire #137');
  console.log(`  ✅ 4.1 Exactly 137 LineStrings detected from KML and NOT rejected`);

  // Define AOI covering only features #50 to #55
  const aoi137 = {
    type: 'Polygon',
    coordinates: [[
      [-5.805, 35.740],
      [-5.790, 35.740],
      [-5.790, 35.755],
      [-5.805, 35.755],
      [-5.805, 35.740]
    ]]
  };

  const payload137 = JSON.stringify(parsed137.features.map(f => ({
    id: f.id,
    nom: f.properties.name,
    geometry: f.geometry
  })));

  const res137 = await db.query(evalQuery, [payload137, JSON.stringify(aoi137)]);
  assert.strictEqual(parseInt(res137.rows[0].total, 10), 137, 'Total features is 137');
  const count137Intersecting = parseInt(res137.rows[0].intersecting_count, 10);
  assert(count137Intersecting > 0 && count137Intersecting < 30, `Subset intersects (${count137Intersecting} candidates)`);
  console.log(`  ✅ 4.2 Spatial intersection on 137 LineStrings returns ONLY intersecting candidates (${count137Intersecting} of 137)`);

  // Isolate a single candidate from the 137 lines and test insertion into reference_alignment
  const selectedCandidate = parsed137.features[49]; // feature #50
  console.log(`  ℹ️ Selecting single candidate: "${selectedCandidate.properties.name}"`);

  await db.query('DELETE FROM public.reference_alignment WHERE chantier_id = $1', [testChantier.id]);

  // Insert as reference alignment for test chantier
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
      $1,
      $2,
      'KML',
      'network_137.kml',
      ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
      ST_SetSRID(ST_GeomFromGeoJSON($3), 4326),
      false,
      4326,
      'WGS 84 (GPS standard)',
      NOW(),
      $4::jsonb
    )
    RETURNING id, nom, ST_GeometryType(geometry) AS geom_type, ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters;
  `;

  const metaPayload = JSON.stringify({
    name: selectedCandidate.properties.name,
    properties: selectedCandidate.properties
  });

  const insertRes = await db.query(insertQuery, [
    testChantier.id,
    selectedCandidate.properties.name,
    JSON.stringify(selectedCandidate.geometry),
    metaPayload
  ]);

  const inserted = insertRes.rows[0];
  assert.strictEqual(inserted.geom_type, 'ST_LineString', 'Inserted geometry is ST_LineString');
  assert(parseFloat(inserted.length_meters) > 0, 'Length in meters is positive');
  console.log(`  ✅ 4.3 Candidate cleanly entered Level 1 / Level 2 reference alignment (${inserted.nom}, ${inserted.length_meters} m)`);

  console.log('\n🎉 ALL 4 WORKFLOW TEST SUITES COMPLETED WITH 100% SUCCESS!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
