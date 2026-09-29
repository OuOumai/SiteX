/**
 * server/tests/e2e-kml.test.js
 *
 * End-to-End integration test for SiteX Level 1 KML Integration:
 * 1. KML CRS detection (EPSG:4326)
 * 2. Spatial Analysis & Corridor Extraction
 * 3. Reference Alignment persistence in PostGIS (with original_geometry & geometry)
 * 4. LRS Tronçon Generation (ST_LineSubstring)
 * 5. Regression check for standard GeoJSON pipeline
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const fs = require('fs');
const db = require('../src/db');
const kmlService = require('../src/services/kml.service');
const crsService = require('../src/services/crs.service');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runE2eTests() {
  console.log('🚀 Running SiteX Level 1 KML End-to-End & Regression Tests...\n');

  try {
    // Check if test chantier exists
    const chantierRes = await db.query('SELECT id, nom, surface FROM public.chantier ORDER BY id ASC LIMIT 1');
    if (chantierRes.rows.length === 0) {
      console.log('⚠️ No existing chantier found for e2e DB test. Skipping DB-dependent part.');
      return;
    }

    const testChantier = chantierRes.rows[0];
    const chantierId = testChantier.id;
    console.log(`ℹ️ Using test chantier: ID=${chantierId}, Name="${testChantier.nom}"`);

    // Load real Google Earth KML
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const kmlContent = fs.readFileSync(kmlPath, 'utf8');

    // 1. Test KML Parsing & Normalization (Level 1 & Level 2)
    console.log('1️⃣ Testing KML Service normalization & Level 2 metadata extraction...');
    const normalizedGeoJson = kmlService.parseKmlToGeoJson(kmlContent);
    assert(normalizedGeoJson.type === 'Feature', 'Normalized output must be a Feature');
    assert(normalizedGeoJson.geometry.type === 'LineString', 'Geometry must be LineString');
    assert(normalizedGeoJson.geometry.coordinates.length === 5, 'Must have 5 coordinates');
    assert(normalizedGeoJson.properties.sourceCrs === 'EPSG:4326', 'Source CRS is EPSG:4326');
    assert(normalizedGeoJson.metadata, 'Level 2 metadata must be present');
    assert(normalizedGeoJson.metadata.name === 'RP4022_Tangier_Test', 'Placemark name must be preserved');
    assert(normalizedGeoJson.metadata.documentName === 'RP4022_Tangier_Test.kml', 'Document name must be preserved');
    assert(normalizedGeoJson.metadata.styleUrl === '#m_ylw-pushpin', 'StyleUrl must be preserved');
    assert(normalizedGeoJson.metadata.generator === 'Google Earth Pro 7.3.7.1327', 'Generator must be preserved');
    console.log('   ✅ KML normalized to GeoJSON LineString (5 vertices, EPSG:4326)');
    console.log(`   ✅ KML Level 2 metadata preserved: Name="${normalizedGeoJson.metadata.name}", StyleUrl="${normalizedGeoJson.metadata.styleUrl}", Generator="${normalizedGeoJson.metadata.generator}"`);

    // 2. Test PostGIS Insertion & AOI Clipping
    console.log('2️⃣ Testing PostGIS Reference Alignment insertion...');
    const targetGeom = normalizedGeoJson.geometry;
    const sourceSrid = 4326;

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
      orig_merged AS (
        SELECT 
          CASE 
            WHEN ST_GeometryType(raw_geom) = 'ST_MultiLineString' THEN (
              SELECT d.geom 
              FROM ST_Dump(raw_geom) d 
              ORDER BY ST_Length(d.geom::geography) DESC 
              LIMIT 1
            )
            ELSE raw_geom
          END AS orig_geom
        FROM parsed
      ),
      aoi_src AS (
        SELECT localisation AS aoi_geom FROM public.chantier WHERE id = $3
      ),
      clipped AS (
        SELECT 
          CASE 
            WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(o.orig_geom, a.aoi_geom) THEN
              ST_LineMerge(ST_CollectionExtract(ST_Intersection(o.orig_geom, a.aoi_geom), 2))
            ELSE o.orig_geom
          END AS geom
        FROM orig_merged o
        CROSS JOIN aoi_src a
      ),
      merged AS (
        SELECT 
          CASE 
            WHEN ST_GeometryType(geom) = 'ST_MultiLineString' THEN (
              SELECT d.geom 
              FROM ST_Dump(geom) d 
              ORDER BY ST_Length(d.geom::geography) DESC 
              LIMIT 1
            )
            ELSE geom
          END AS geom
        FROM clipped
      )
      SELECT 
        ST_GeometryType(m.geom) AS geom_type,
        ST_NumGeometries(m.geom) AS num_geoms,
        ROUND(ST_Length(m.geom::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(m.geom::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(m.geom)::json AS geometry,
        ST_GeometryType(o.orig_geom) AS orig_geom_type,
        ROUND(ST_Length(o.orig_geom::geography)::numeric, 2) AS original_length_meters,
        ROUND((ST_Length(o.orig_geom::geography) / 1000.0)::numeric, 3) AS original_length_km,
        ST_AsGeoJSON(o.orig_geom)::json AS original_geometry
      FROM merged m
      CROSS JOIN orig_merged o;
    `;

    const checkRes = await db.query(validateAndInsertQuery, [JSON.stringify(targetGeom), sourceSrid, chantierId]);
    assert(checkRes.rows.length > 0, 'PostGIS query must succeed');
    const checked = checkRes.rows[0];

    assert(checked.geom_type === 'ST_LineString', 'Geom must be ST_LineString');
    assert(parseFloat(checked.original_length_meters) > 0, 'Original length must be positive');
    console.log(`   ✅ PostGIS validated: Original length = ${checked.original_length_meters} m, Clipped length = ${checked.length_meters} m`);

    // 3. Test LRS Tronçon Generation on this geometry
    console.log('3️⃣ Testing LRS Segmentation (ST_LineSubstring)...');
    const measCrs = crsService.getMeasurementCrs(checked.geometry);
    const measSrid = measCrs.srid;

    const segmentsQuery = `
      WITH ref AS (
        SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), $2::int) AS geom_proj
      ),
      fractions AS (
        SELECT 
          s.i AS step,
          (0.0::float + (s.i::float / 3::float) * (1.0::float - 0.0::float)) AS start_frac,
          (0.0::float + ((s.i + 1)::float / 3::float) * (1.0::float - 0.0::float)) AS end_frac
        FROM generate_series(0, 2) AS s(i)
      )
      SELECT 
        f.step + 1 AS num,
        ST_AsGeoJSON(ST_Transform(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac), 4326))::json AS geometry,
        ROUND(ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac))::numeric, 2) AS length_meters
      FROM fractions f, ref;
    `;

    const segRes = await db.query(segmentsQuery, [JSON.stringify(checked.geometry), measSrid]);
    assert(segRes.rows.length === 3, 'Must generate exactly 3 tronçons');
    for (const r of segRes.rows) {
      assert(parseFloat(r.length_meters) > 0, `Segment ${r.num} length must be > 0`);
      assert(r.geometry.type === 'LineString', `Segment ${r.num} geometry must be LineString`);
    }
    console.log(`   ✅ 3 tronçons generated successfully with ST_LineSubstring in SRID ${measSrid}`);

    // 4. Test GeoJSON Non-Regression
    console.log('4️⃣ Testing GeoJSON Non-Regression...');
    const sampleGeoJSON = {
      type: 'LineString',
      coordinates: [
        [-5.891811900290772, 35.73431418498011],
        [-5.889824653353914, 35.73423590912699],
        [-5.889760936770346, 35.73593763702176],
        [-5.88790695693689, 35.73739138743712],
        [-5.884922378829673, 35.73722900146829],
      ],
    };

    assert(!kmlService.isKml(JSON.stringify(sampleGeoJSON)), 'Standard GeoJSON must NOT be identified as KML');
    const geojsonCrsDetection = await crsService.detectSourceCrs(sampleGeoJSON, { chantierId });
    assert(geojsonCrsDetection.detected_srid === 4326, 'GeoJSON detection must return EPSG:4326 for decimal degree coordinates');
    console.log('   ✅ GeoJSON detection and workflow intact (non-regression verified)');

    // 5. Test Controller uploadReferenceAlignment and getReferenceAlignment with kml_metadata
    console.log('5️⃣ Testing uploadReferenceAlignment and getReferenceAlignment metadata persistence flow...');
    const chantierController = require('../src/controllers/chantier.controller');

    let uploadStatus = null;
    let uploadJson = null;
    const mockUploadReq = {
      params: { chantierId },
      body: {
        geometry: checked.geometry,
        original_filename: 'test_qgis_flow.kml',
        nom: 'Axe Test KML Metadata Flow',
        source_srid: 4326,
        source_crs_name: 'WGS 84',
        kml_metadata: {
          name: 'RP4022_Tangier_Metadata',
          description: 'Project: SiteX Tangier Test\nInfrastructure: Road\nReference: RP4022',
          folders: ['Tangier Roads'],
          styles: { styleUrl: null, line: { color: 'ff0000ff', width: null } },
          extendedData: { reference: 'RP4022', infrastructure: 'Road' },
        },
      },
    };
    const mockUploadRes = {
      status(s) { uploadStatus = s; return this; },
      json(d) { uploadJson = d; return this; },
    };

    await chantierController.uploadReferenceAlignment(mockUploadReq, mockUploadRes);
    assert(uploadStatus === 201, `Upload status must be 201 (got ${uploadStatus}: ${JSON.stringify(uploadJson)})`);
    assert(uploadJson.reference_alignment, 'Response must contain reference_alignment');
    assert(uploadJson.reference_alignment.kml_metadata, 'Response reference_alignment must contain kml_metadata');
    assert(uploadJson.reference_alignment.kml_metadata.description.includes('Project: SiteX Tangier Test'), 'Persisted description must match');
    assert(uploadJson.reference_alignment.kml_metadata.extendedData.reference === 'RP4022', 'ExtendedData reference must match');
    const createdAlignmentId = uploadJson.reference_alignment.id;

    // Test getReferenceAlignment retrieval
    let getStatus = null;
    let getJson = null;
    const mockGetReq = { params: { chantierId } };
    const mockGetRes = {
      status(s) { getStatus = s; return this; },
      json(d) { getJson = d; return this; },
    };

    await chantierController.getReferenceAlignment(mockGetReq, mockGetRes);
    assert(getStatus === 200, `Get status must be 200 (got ${getStatus})`);
    assert(getJson.reference_alignment, 'Get response must contain reference_alignment');
    assert(getJson.reference_alignment.kml_metadata !== null, 'Get response reference_alignment must include kml_metadata');
    assert(getJson.reference_alignment.kml_metadata.description.includes('Project: SiteX Tangier Test'), 'Retrieved description must be intact');
    assert(getJson.reference_alignment.kml_metadata.name === 'RP4022_Tangier_Metadata', 'Retrieved name must be intact');
    console.log('   ✅ uploadReferenceAlignment successfully persisted kml_metadata');
    console.log(`   ✅ getReferenceAlignment successfully returned kml_metadata with description: "${getJson.reference_alignment.kml_metadata.description.split('\n')[0]}"`);

    // Clean up test alignment record
    if (createdAlignmentId) {
      await db.query('DELETE FROM public.reference_alignment WHERE id = $1', [createdAlignmentId]);
    }

    console.log('\n🎉 ALL END-TO-END TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ E2E Test Failure:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

runE2eTests();
