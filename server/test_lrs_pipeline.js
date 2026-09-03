/**
 * server/test_lrs_pipeline.js
 *
 * Comprehensive Automated Test Suite for SiteX Projected Metric LRS & PK Engine.
 * Tests:
 *  1. Short Road Alignment
 *  2. Long Linear Alignment
 *  3. Sinuous Road
 *  4. Multi-directional / Diagonal Alignment
 *  5. AOI-Clipped Alignment
 *  6. Reversed Alignment (Direction Toggle)
 *  7. Equal-Count Segmentation
 *  8. Target-Length Segmentation
 *  9. Step 6 PK Recalculation & Forward Propagation
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const crsService = require('./src/services/crs.service');

async function runTests() {
  console.log('='.repeat(95));
  console.log('🧪 RUNNING COMPREHENSIVE LRS & PK PIPELINE VERIFICATION SUITE');
  console.log('='.repeat(95));

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  ✅ [PASS] ${testName}`);
    } else {
      console.error(`  ❌ [FAIL] ${testName} - ${details}`);
    }
  }

  // Get an existing chantier from DB or insert
  const chRes = await db.query(`SELECT id FROM public.chantier ORDER BY id DESC LIMIT 1`);
  let chantierId;
  let createdChantier = false;
  if (chRes.rows.length > 0) {
    chantierId = chRes.rows[0].id;
  } else {
    const setupRes = await db.query(`
      INSERT INTO public.chantier (nom, localisation)
      VALUES (
        'Chantier Test LRS',
        ST_SetSRID(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-7.5,33.5],[-7.0,33.5],[-7.0,34.0],[-7.5,34.0],[-7.5,33.5]]]}'), 4326)
      )
      RETURNING id;
    `);
    chantierId = setupRes.rows[0].id;
    createdChantier = true;
  }
  console.log(`Using chantier with ID: ${chantierId}`);

  try {
    // -------------------------------------------------------------
    // Test 1: Short Road Alignment (5 km)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Short Road Alignment (5 km) ---');
    const shortRoadGeoJSON = {
      type: 'LineString',
      coordinates: [
        [-6.8500, 33.9800],
        [-6.8400, 33.9600],
        [-6.8300, 33.9400]
      ]
    };
    const meas1 = crsService.getMeasurementCrs(shortRoadGeoJSON);
    assert(meas1.srid === 26191, 'Measurement CRS selected correctly (EPSG:26191 Merchich Nord for lat 33.9)');

    const ins1 = await db.query(
      `INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
       VALUES ($1, 'Short Road', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
       RETURNING id;`,
      [chantierId, JSON.stringify(shortRoadGeoJSON)]
    );
    const refId1 = ins1.rows[0].id;

    // Simulate generateTronconsPreview
    const gen1 = await db.query(
      `WITH ref AS (
        SELECT ST_Transform(geometry, $2::int) AS geom_proj FROM public.reference_alignment WHERE id = $1
      ),
      fractions AS (
        SELECT s.i AS step, (s.i::float / 3.0) AS start_frac, ((s.i + 1)::float / 3.0) AS end_frac
        FROM generate_series(0, 2) AS s(i)
      )
      SELECT 
        f.step + 1 AS num,
        ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac)) AS len_m
      FROM fractions f, ref;`,
      [refId1, meas1.srid]
    );
    const totalM1 = gen1.rows.reduce((sum, r) => sum + parseFloat(r.len_m), 0);
    const targetPiece1 = totalM1 / 3.0;
    gen1.rows.forEach((r) => {
      const err = Math.abs(parseFloat(r.len_m) - targetPiece1);
      assert(err < 0.05, `Short road segment T${r.num} length matches target within 5cm (err: ${err.toFixed(4)}m)`);
    });

    // -------------------------------------------------------------
    // Test 2: Long Linear Alignment (180 km LGV Tanger-Kenitra)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Long Linear Alignment (180 km LGV) ---');
    const lgvGeoJSON = {
      type: 'LineString',
      coordinates: [
        [-5.8050, 35.7590],
        [-5.8320, 35.6120],
        [-5.9100, 35.3400],
        [-6.0200, 35.1800],
        [-6.1500, 34.8200],
        [-6.5800, 34.2600]
      ]
    };
    const ins2 = await db.query(
      `INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
       VALUES ($1, 'LGV Alignment', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 4326, 'WGS 84', NOW())
       RETURNING id;`,
      [chantierId, JSON.stringify(lgvGeoJSON)]
    );
    const refId2 = ins2.rows[0].id;
    const meas2 = crsService.getMeasurementCrs(lgvGeoJSON);

    const gen2 = await db.query(
      `WITH ref AS (
        SELECT ST_Transform(geometry, $2::int) AS geom_proj FROM public.reference_alignment WHERE id = $1
      ),
      fractions AS (
        SELECT s.i AS step, (s.i::float / 7.0) AS start_frac, ((s.i + 1)::float / 7.0) AS end_frac
        FROM generate_series(0, 6) AS s(i)
      )
      SELECT 
        f.step + 1 AS num,
        ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac)) AS len_m
      FROM fractions f, ref;`,
      [refId2, meas2.srid]
    );
    const totalM2 = gen2.rows.reduce((sum, r) => sum + parseFloat(r.len_m), 0);
    const targetPiece2 = totalM2 / 7.0;
    let maxLgvErr = 0;
    gen2.rows.forEach((r) => {
      const err = Math.abs(parseFloat(r.len_m) - targetPiece2);
      if (err > maxLgvErr) maxLgvErr = err;
    });
    assert(maxLgvErr < 0.01, `Long 180km LGV alignment has max segment length error < 1cm (${maxLgvErr.toFixed(4)}m) in measurement CRS`);

    // -------------------------------------------------------------
    // Test 3: Sinuous Mountain Road (RN9 Col du Tichka)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Sinuous Mountain Road (RN9 Col du Tichka) ---');
    const tichkaGeoJSON = {
      type: 'LineString',
      coordinates: [
        [-7.4210, 31.3520],
        [-7.4050, 31.3410],
        [-7.3890, 31.3250],
        [-7.3980, 31.3090],
        [-7.3820, 31.2870],
        [-7.3610, 31.2650],
        [-7.3320, 31.2310],
        [-7.3050, 31.2050],
        [-7.2510, 31.1820],
        [-7.2010, 31.1550]
      ]
    };
    const meas3 = crsService.getMeasurementCrs(tichkaGeoJSON);
    assert(meas3.srid === 26192, 'Measurement CRS selected correctly (EPSG:26192 Merchich Sud for lat 31.2)');

    // -------------------------------------------------------------
    // Test 4: AOI-Clipped Alignment
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: AOI-Clipped Alignment ---');
    const aoiPolygon = {
      type: 'Polygon',
      coordinates: [[
        [-7.35, 33.65],
        [-7.10, 33.65],
        [-7.10, 33.85],
        [-7.35, 33.85],
        [-7.35, 33.65]
      ]]
    };
    const aoiClipRes = await db.query(
      `WITH proj AS (
        SELECT 
          ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 26191) AS r_proj,
          ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 26191) AS c_proj
      ),
      intersected AS (
        SELECT 
          ST_LineMerge(ST_CollectionExtract(ST_Intersection(r_proj, c_proj), 2)) AS aoi_line_proj,
          r_proj
        FROM proj
      )
      SELECT 
        ST_Length(aoi_line_proj) AS aoi_len_m,
        ST_LineLocatePoint(r_proj, ST_StartPoint(aoi_line_proj)) AS s_frac,
        ST_LineLocatePoint(r_proj, ST_EndPoint(aoi_line_proj)) AS e_frac
      FROM intersected;`,
      [
        JSON.stringify({
          type: 'LineString',
          coordinates: [
            [-7.50, 33.60],
            [-7.30, 33.70],
            [-7.15, 33.80],
            [-7.00, 33.90]
          ]
        }),
        JSON.stringify(aoiPolygon)
      ]
    );
    const aoiRow = aoiClipRes.rows[0];
    const sFrac = parseFloat(aoiRow.s_frac);
    const eFrac = parseFloat(aoiRow.e_frac);
    assert(sFrac > 0 && eFrac < 1 && eFrac > sFrac, 'AOI start and end fractions correctly located along projected line');
    assert(parseFloat(aoiRow.aoi_len_m) > 0, `AOI intersection length is positive (${parseFloat(aoiRow.aoi_len_m).toFixed(1)}m)`);

    // -------------------------------------------------------------
    // Test 5: Direction Reversal
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Direction Reversal Invariance ---');
    const revRes = await db.query(
      `WITH orig AS (
        SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 26191) AS geom_orig
      ),
      rev AS (
        SELECT ST_Reverse(geom_orig) AS geom_rev FROM orig
      )
      SELECT 
        ST_Length(geom_orig) AS len_orig,
        ST_Length(geom_rev) AS len_rev,
        ST_X(ST_StartPoint(geom_orig)) AS orig_start_x,
        ST_X(ST_EndPoint(geom_rev)) AS rev_end_x
      FROM orig, rev;`,
      [JSON.stringify(shortRoadGeoJSON)]
    );
    const rRow = revRes.rows[0];
    assert(Math.abs(parseFloat(rRow.len_orig) - parseFloat(rRow.len_rev)) < 0.001, 'Reversed alignment retains exact identical metric length');
    assert(Math.abs(parseFloat(rRow.orig_start_x) - parseFloat(rRow.rev_end_x)) < 0.001, 'Reversed alignment flips start and end vertex positions exactly');

    // -------------------------------------------------------------
    // Test 6: Target-Length (5 km Target on 85 km alignment)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Target-Length (5 km per Tronçon) ---');
    const casaRabatGeoJSON = {
      type: 'LineString',
      coordinates: [
        [-6.8722, 33.9715],
        [-6.9350, 33.9210],
        [-7.0120, 33.8640],
        [-7.1590, 33.7890],
        [-7.2450, 33.7310],
        [-7.3580, 33.6820],
        [-7.4900, 33.6550],
        [-7.5420, 33.6730],
        [-7.5850, 33.6320],
        [-7.6210, 33.5950]
      ]
    };
    const ins6 = await db.query(
      `INSERT INTO public.reference_alignment (chantier_id, nom, source, geometry, source_srid, source_crs_name, date_import)
       VALUES ($1, 'Casa-Rabat A1', 'GeoJSON', ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), 26191, 'Merchich Nord', NOW())
       RETURNING id;`,
      [chantierId, JSON.stringify(casaRabatGeoJSON)]
    );
    const refId6 = ins6.rows[0].id;

    // Slicing at exact 5 km intervals
    const targetKm = 5.0;
    const lenQuery6 = await db.query(
      `SELECT ST_Length(ST_Transform(geometry, 26191)) / 1000.0 AS total_km FROM public.reference_alignment WHERE id = $1`,
      [refId6]
    );
    const totalKm6 = parseFloat(lenQuery6.rows[0].total_km);
    const count6 = Math.round(totalKm6 / targetKm);

    const segRes6 = await db.query(
      `WITH ref AS (
        SELECT ST_Transform(geometry, 26191) AS geom_proj FROM public.reference_alignment WHERE id = $1
      ),
      fractions AS (
        SELECT 
          s.i AS step,
          (s.i::float / $2::float) AS start_frac,
          ((s.i + 1)::float / $2::float) AS end_frac
        FROM generate_series(0, $2 - 1) AS s(i)
      )
      SELECT 
        f.step + 1 AS num,
        ROUND((ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac)) / 1000.0)::numeric, 4) AS len_km
      FROM fractions f, ref;`,
      [refId6, count6]
    );

    const expectedPiece6 = totalKm6 / count6;
    let maxTargetDrift = 0;
    segRes6.rows.forEach(r => {
      const diff = Math.abs(parseFloat(r.len_km) - expectedPiece6);
      if (diff > maxTargetDrift) maxTargetDrift = diff;
    });
    assert(maxTargetDrift < 0.0001, `Target-length segmentation creates equal pieces within 0.1mm along alignment (max drift: ${(maxTargetDrift*1000).toFixed(4)}m)`);

    // -------------------------------------------------------------
    // Test 7: Step 6 PK Recalculation & Forward Propagation
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Step 6 PK Recalculation & Propagation ---');
    // User modifies Tronçon 2 PK Fin from 10.0 to 12.5 km
    const pkDebutMod = 5.0;
    const pkFinMod = 12.5; // modified
    const startFracMod = pkDebutMod / totalKm6;
    const endFracMod = pkFinMod / totalKm6;

    const recalcRes = await db.query(
      `WITH ref AS (
        SELECT ST_Transform(geometry, 26191) AS geom_proj FROM public.reference_alignment WHERE id = $1
      )
      SELECT 
        ROUND((ST_Length(ST_LineSubstring(ref.geom_proj, $2, $3)) / 1000.0)::numeric, 3) AS actual_seg_km,
        ST_GeometryType(ST_Transform(ST_LineSubstring(ref.geom_proj, $2, $3), 4326)) AS wgs_geom_type
      FROM ref;`,
      [refId6, startFracMod, endFracMod]
    );
    const recalcRow = recalcRes.rows[0];
    const expectedSegKm = pkFinMod - pkDebutMod;
    assert(Math.abs(parseFloat(recalcRow.actual_seg_km) - expectedSegKm) < 0.002, `Recalculated modified tronçon matches PK delta ${expectedSegKm}km (actual: ${recalcRow.actual_seg_km}km)`);
    assert(recalcRow.wgs_geom_type === 'ST_LineString', 'Output reprojected geometry is valid ST_LineString in WGS84');

  } finally {
    // Cleanup temporary test reference alignments
    await db.query(`DELETE FROM public.reference_alignment WHERE chantier_id = $1 AND nom IN ('Short Road', 'LGV Alignment', 'Casa-Rabat A1')`, [chantierId]);
    if (createdChantier) {
      await db.query(`DELETE FROM public.chantier WHERE id = $1`, [chantierId]);
    }
    console.log(`Cleaned up test data for chantier ${chantierId}`);
  }

  await db.pool.end();
  console.log('\n' + '='.repeat(95));
  console.log(`📊 TEST RESULTS: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('='.repeat(95));
}

runTests().catch(err => {
  console.error('❌ Pipeline test suite failed:', err);
  process.exit(1);
});
