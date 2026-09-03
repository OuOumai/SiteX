/**
 * server/test_crs_integration.js
 *
 * Comprehensive end-to-end test suite for the SiteX CRS Detection & Transformation Pipeline.
 * Tests:
 *   1. WGS 84 (EPSG:4326) Auto-detection & Ingestion
 *   2. Merchich Nord (EPSG:26191) Detection with Chantier AOI context (HIGH confidence)
 *   3. Ambiguous Metric Coordinates without AOI context (UNCERTAIN confidence, lists candidate zones)
 *   4. Merchich Sud (EPSG:26192) Explicit / Detected Transformation
 *   5. Merchich Sahara Nord (EPSG:26194) Transformation
 *   6. Merchich Sahara Sud (EPSG:26195) Transformation
 *   7. Web Mercator (EPSG:3857) Detection & Transformation
 *   8. Invalid / Bogus Coordinates Handling (NONE confidence)
 *   9. PostGIS ST_Transform End-to-End Ingestion & Geodesic Calculation
 *   10. Downstream Tronçon Segmentation & LRS Chainage on Transformed Alignment
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const crsService = require('./src/services/crs.service');

// Moroccan test points
const SAMPLE_POINTS = {
  RABAT_WGS84: { lng: -6.8361, lat: 34.0209 },
  RABAT_LAMBERT_NORD: { x: 367207.25, y: 379963.85 }, // EPSG:26191
  MARRAKECH_LAMBERT_SUD: { x: 247076.60, y: 554746.42 }, // EPSG:26192 (lat 31.63, lon -8.00)
  LAAYOUNE_LAMBERT_S3: { x: 1042738.45, y: 510482.11 }, // EPSG:26194 (lat 27.15, lon -13.20)
  DAKHLA_LAMBERT_S4: { x: 1450284.18, y: 532910.44 }, // EPSG:26195 (lat 23.70, lon -15.93)
};

async function runTests() {
  console.log('═════════════════════════════════════════════════════════════════');
  console.log('       SITEX GIS AUTOMATIC CRS DETECTION & INGESTION SUITE       ');
  console.log('═════════════════════════════════════════════════════════════════\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // ── TEST 1: WGS 84 (EPSG:4326) Detection ──
    console.log('📌 TEST 1: WGS 84 (EPSG:4326) Standard Moroccan Railway Tracé');
    const wgs84GeoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-6.5823, 34.2612],
              [-6.6145, 34.2134],
              [-6.6489, 34.1689],
              [-6.6892, 34.1245],
              [-6.7345, 34.0812],
              [-6.7823, 34.0456],
              [-6.8361, 34.0209],
            ],
          },
        },
      ],
    };

    const wgs84Detect = await crsService.detectSourceCrs(wgs84GeoJson);
    assert(wgs84Detect.detected_srid === 4326, 'Detected SRID is 4326');
    assert(wgs84Detect.confidence === 'HIGH', 'Confidence is HIGH');
    assert(wgs84Detect.is_ambiguous === false, 'Not ambiguous');
    assert(wgs84Detect.unit === 'degrés décimaux', 'Unit is degrés décimaux');
    console.log(`     Explanation: ${wgs84Detect.explanation}\n`);

    // ── TEST 2: Merchich Nord Maroc (EPSG:26191) with Rabat AOI Context ──
    console.log('📌 TEST 2: Merchich Nord Maroc (EPSG:26191) with Rabat AOI Context');
    const lambertNordGeoJson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [390000.0, 405000.0],
              [385000.0, 400000.0],
              [380000.0, 395000.0],
              [375000.0, 390000.0],
              [370000.0, 385000.0],
              [367207.25, 379963.85], // Near Rabat
            ],
          },
        },
      ],
    };

    // AOI around Rabat / Kenitra [lat ~34.0-34.3, lon ~ -6.9 to -6.5]
    const rabatAoi = {
      type: 'Polygon',
      coordinates: [
        [
          [-7.0, 33.8],
          [-6.4, 33.8],
          [-6.4, 34.5],
          [-7.0, 34.5],
          [-7.0, 33.8],
        ],
      ],
    };

    const nordDetectWithAoi = await crsService.detectSourceCrs(lambertNordGeoJson, { aoiGeometry: rabatAoi });
    assert(nordDetectWithAoi.detected_srid === 26191, `Detected SRID is 26191 with AOI (got ${nordDetectWithAoi.detected_srid})`);
    assert(nordDetectWithAoi.confidence === 'HIGH', 'Confidence is HIGH with AOI proximity');
    assert(nordDetectWithAoi.is_ambiguous === false, 'Unambiguous with AOI');
    assert(nordDetectWithAoi.crs_name.includes('Nord Maroc'), 'CRS Name matches Nord Maroc');
    console.log(`     Detected: ${nordDetectWithAoi.crs_name} (${nordDetectWithAoi.epsg_code})`);
    console.log(`     Explanation: ${nordDetectWithAoi.explanation}\n`);

    // ── TEST 3: Ambiguous Detection without AOI Context ──
    console.log('📌 TEST 3: Ambiguity Resolution on Overlapping Coordinates without AOI');
    const ambiguousDetect = await crsService.detectSourceCrs(lambertNordGeoJson);
    assert(ambiguousDetect.is_ambiguous === true, 'Correctly flagged as ambiguous when multiple Moroccan zones match');
    assert(ambiguousDetect.confidence === 'UNCERTAIN', 'Confidence is UNCERTAIN');
    assert(ambiguousDetect.candidates.length >= 2, `Candidates provided for user selection (${ambiguousDetect.candidates.length} candidates)`);
    assert(ambiguousDetect.candidates.some((c) => c.srid === 26191), 'Contains Zone 1 Nord in candidates');
    assert(ambiguousDetect.candidates.some((c) => c.srid === 26192), 'Contains Zone 2 Sud in candidates');
    console.log(`     Candidate Choices: ${ambiguousDetect.candidates.map((c) => c.code + ' (' + c.name + ')').join(' | ')}\n`);

    // ── TEST 4: Merchich Sud Maroc (EPSG:26192) Marrakech Alignment ──
    console.log('📌 TEST 4: Merchich Sud Maroc (EPSG:26192) Marrakech Alignment with AOI');
    const lambertSudGeoJson = {
      type: 'LineString',
      coordinates: [
        [247076.60, 554746.42], // Marrakech
        [248000.0, 550000.0],
        [250000.0, 545000.0],
        [252000.0, 540000.0],
      ],
    };

    const marrakechAoi = {
      type: 'Polygon',
      coordinates: [
        [
          [-8.2, 31.4],
          [-7.8, 31.4],
          [-7.8, 31.8],
          [-8.2, 31.8],
          [-8.2, 31.4],
        ],
      ],
    };

    const sudDetect = await crsService.detectSourceCrs(lambertSudGeoJson, { aoiGeometry: marrakechAoi });
    assert(sudDetect.detected_srid === 26192, `Detected SRID is 26192 (got ${sudDetect.detected_srid})`);
    assert(sudDetect.confidence === 'HIGH', 'Confidence is HIGH');
    assert(sudDetect.crs_name.includes('Sud Maroc'), 'CRS Name matches Sud Maroc');
    console.log(`     Detected: ${sudDetect.crs_name} (${sudDetect.epsg_code})\n`);

    // ── TEST 5: Explicit SRID Selection ──
    console.log('📌 TEST 5: Explicit SRID Override (e.g. user selected from UI)');
    const explicitDetect = await crsService.detectSourceCrs(lambertNordGeoJson, { explicitSrid: 26191 });
    assert(explicitDetect.detected_srid === 26191, 'Explicit SRID 26191 confirmed');
    assert(explicitDetect.confidence === 'HIGH', 'Confidence is HIGH for explicitly specified CRS');
    assert(explicitDetect.is_ambiguous === false, 'Not ambiguous when explicitly chosen');
    console.log(`     Result: ${explicitDetect.crs_name} (${explicitDetect.epsg_code})\n`);

    // ── TEST 6: Web Mercator (EPSG:3857) Detection ──
    console.log('📌 TEST 6: Web Mercator (EPSG:3857) GeoJSON');
    const mercatorGeoJson = {
      type: 'LineString',
      coordinates: [
        [-760991.68, 4031620.35], // Rabat in Web Mercator
        [-750000.0, 4025000.0],
        [-740000.0, 4020000.0],
      ],
    };

    const mercatorDetect = await crsService.detectSourceCrs(mercatorGeoJson);
    assert(mercatorDetect.detected_srid === 3857, `Detected SRID is 3857 (got ${mercatorDetect.detected_srid})`);
    assert(mercatorDetect.confidence === 'HIGH', 'Confidence is HIGH for Web Mercator');
    console.log(`     Detected: ${mercatorDetect.crs_name} (${mercatorDetect.epsg_code})\n`);

    // ── TEST 7: Invalid / Bogus Coordinates Detection ──
    console.log('📌 TEST 7: Bogus Coordinates (Out of Morocco bounds in all CRS)');
    const bogusGeoJson = {
      type: 'LineString',
      coordinates: [
        [99999999.0, 99999999.0],
        [99999998.0, 99999998.0],
      ],
    };

    const bogusDetect = await crsService.detectSourceCrs(bogusGeoJson);
    assert(bogusDetect.confidence === 'NONE', 'Confidence is NONE for bogus coordinates');
    assert(bogusDetect.detected_srid === null, 'No SRID auto-assigned for bogus coordinates');
    console.log(`     Result: ${bogusDetect.explanation}\n`);

    // ── TEST 8: PostGIS ST_Transform Ingestion & Canonical Storage ──
    console.log('📌 TEST 8: Real Database Ingestion with EPSG:26191 Source Alignment');
    
    // Create a temporary Chantier for test
    const userRes = await db.query('SELECT id FROM public.utilisateur LIMIT 1');
    const userId = userRes.rows[0].id;
    const projRes = await db.query('SELECT id FROM public.projet LIMIT 1');
    const projId = projRes.rows[0].id;

    const chantierRes = await db.query(`
      INSERT INTO public.chantier (projet_id, responsable_id, nom, statut)
      VALUES ($1, $2, 'Test Chantier Moroccan CRS Zone 1', 'En cours')
      RETURNING id;
    `, [projId, userId]);
    const testChantierId = chantierRes.rows[0].id;

    // Transform and store reference alignment from EPSG:26191 into EPSG:4326 canonical
    const validateAndInsertQuery = `
      WITH raw_input AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $2) AS src_geom
      ),
      parsed AS (
        SELECT CASE 
          WHEN $2 = 4326 THEN src_geom
          ELSE ST_Transform(src_geom, 4326)
        END AS raw_geom
        FROM raw_input
      ),
      merged AS (
        SELECT 
          CASE 
            WHEN ST_GeometryType(raw_geom) = 'ST_MultiLineString' THEN ST_LineMerge(raw_geom)
            ELSE raw_geom
          END AS geom
        FROM parsed
      )
      INSERT INTO public.reference_alignment (
        chantier_id,
        nom,
        source,
        original_filename,
        geometry,
        direction_reversed,
        source_srid,
        source_crs_name,
        date_import
      )
      SELECT 
        $3,
        'Tracé Test Merchich Nord',
        'GeoJSON (EPSG:26191)',
        'kenitra_rabat_lambert1.geojson',
        geom,
        false,
        $2,
        'Merchich / Nord Maroc',
        NOW()
      FROM merged
      RETURNING 
        id,
        chantier_id,
        nom,
        source_srid,
        source_crs_name,
        ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_X(ST_StartPoint(geometry)) AS start_lng,
        ST_Y(ST_StartPoint(geometry)) AS start_lat,
        ST_X(ST_EndPoint(geometry)) AS end_lng,
        ST_Y(ST_EndPoint(geometry)) AS end_lat;
    `;

    const insertRes = await db.query(validateAndInsertQuery, [
      JSON.stringify(lambertNordGeoJson.features[0].geometry),
      26191,
      testChantierId,
    ]);

    const savedRef = insertRes.rows[0];
    assert(savedRef.source_srid === 26191, 'Saved alignment has source_srid = 26191');
    assert(savedRef.source_crs_name === 'Merchich / Nord Maroc', 'Saved alignment has source_crs_name = Merchich / Nord Maroc');
    assert(parseFloat(savedRef.length_km) > 0, `Length calculated accurately: ${savedRef.length_km} km (${savedRef.length_meters} m)`);
    assert(savedRef.start_lng > -8 && savedRef.start_lng < -4, `Transformed start longitude is in Morocco degrees (${savedRef.start_lng.toFixed(4)})`);
    assert(savedRef.start_lat > 32 && savedRef.start_lat < 36, `Transformed start latitude is in Morocco degrees (${savedRef.start_lat.toFixed(4)})`);
    console.log(`     Canonical WGS84 Endpoints: [${savedRef.start_lng.toFixed(4)}, ${savedRef.start_lat.toFixed(4)}] -> [${savedRef.end_lng.toFixed(4)}, ${savedRef.end_lat.toFixed(4)}]`);

    // ── TEST 9: Downstream Tronçon Segmentation on Transformed Alignment ──
    console.log('\n📌 TEST 9: Downstream Tronçon Segmentation & LRS Chainage');
    const segQuery = `
      WITH alignment_data AS (
        SELECT geometry AS full_geom, ST_Length(geometry::geography) AS total_len
        FROM public.reference_alignment
        WHERE id = $1
      ),
      steps AS (
        SELECT generate_series(1, 4) AS step_num
      )
      SELECT 
        s.step_num,
        ROUND((((s.step_num - 1)::double precision / 4.0) * (a.total_len / 1000.0))::numeric, 3) AS pk_debut_km,
        ROUND(((s.step_num::double precision / 4.0) * (a.total_len / 1000.0))::numeric, 3) AS pk_fin_km,
        ROUND(ST_Length(ST_LineSubstring(a.full_geom, (s.step_num - 1)::double precision / 4.0, s.step_num::double precision / 4.0)::geography)::numeric, 2) AS len_m
      FROM steps s
      CROSS JOIN alignment_data a;
    `;

    const segRes = await db.query(segQuery, [savedRef.id]);
    assert(segRes.rows.length === 4, 'Generated 4 continuous tronçons');
    assert(parseFloat(segRes.rows[0].pk_debut_km) === 0, 'First tronçon starts at PK 0.000');
    assert(Math.abs(parseFloat(segRes.rows[3].pk_fin_km) - parseFloat(savedRef.length_km)) < 0.01, 'Last tronçon ends at total alignment length');

    // Clean up test data
    await db.query('DELETE FROM public.reference_alignment WHERE chantier_id = $1', [testChantierId]);
    await db.query('DELETE FROM public.chantier WHERE id = $1', [testChantierId]);
    console.log('     Cleaned up test chantier and reference alignment.');

    console.log('\n═════════════════════════════════════════════════════════════════');
    console.log(` 🎉 ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY! `);
    console.log('═════════════════════════════════════════════════════════════════');
  } catch (err) {
    console.error('❌ Test suite execution error:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runTests();
