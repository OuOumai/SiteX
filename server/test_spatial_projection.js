/**
 * server/test_spatial_projection.js
 *
 * Test script verifying PostGIS orthogonal projection and progress calculation.
 */

'use strict';

require('dotenv').config();
const db = require('./src/db');
const crsService = require('./src/services/crs.service');

async function test() {
  console.log('🧪 Testing PostGIS Orthogonal Projection & Distance along Tronçon...');

  // Sample LineString geometry in Rabat-Salé (Merchich Nord Zone 1)
  const lineGeoJSON = {
    type: 'LineString',
    coordinates: [
      [-6.8498, 33.9716],
      [-6.8520, 33.9680],
      [-6.8550, 33.9630],
    ],
  };

  const measCrs = crsService.getMeasurementCrs(lineGeoJSON);
  console.log(`  Selected Measurement CRS: ${measCrs.code} (${measCrs.name})`);

  // Simulated Agent GPS location slightly off the road (15 meters away)
  const agentLat = 33.9690;
  const agentLng = -6.8510;

  const query = `
    WITH base AS (
      SELECT 
        ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS t_geom,
        ST_SetSRID(ST_MakePoint($2, $3), 4326) AS gps_pt,
        $4::int AS meas_srid
    ),
    metric AS (
      SELECT
        t_geom,
        gps_pt,
        meas_srid,
        ST_Transform(t_geom, meas_srid) AS t_metric,
        ST_Transform(gps_pt, meas_srid) AS gps_metric
      FROM base
    ),
    computation AS (
      SELECT
        ST_Length(t_metric) AS total_length_m,
        ST_LineLocatePoint(t_metric, gps_metric) AS locate_fraction,
        ST_ClosestPoint(t_metric, gps_metric) AS closest_pt_metric,
        ST_Distance(t_metric, gps_metric) AS offset_distance_m
      FROM metric
    )
    SELECT
      ROUND(total_length_m::numeric, 2) AS total_length_meters,
      ROUND((total_length_m / 1000.0)::numeric, 3) AS total_length_km,
      ROUND(locate_fraction::numeric, 5) AS fraction,
      ROUND((locate_fraction * total_length_m)::numeric, 2) AS distance_from_start_m,
      ROUND(((locate_fraction * total_length_m) / total_length_m * 100.0)::numeric, 2) AS progress_percentage,
      ST_X(ST_Transform(closest_pt_metric, 4326)) AS projected_lng,
      ST_Y(ST_Transform(closest_pt_metric, 4326)) AS projected_lat,
      ROUND(offset_distance_m::numeric, 2) AS offset_distance_meters
    FROM computation;
  `;

  const res = await db.query(query, [
    JSON.stringify(lineGeoJSON),
    agentLng,
    agentLat,
    measCrs.srid,
  ]);

  const row = res.rows[0];
  console.log('✅ Projection Results:');
  console.log(`   - Total Tronçon Length: ${row.total_length_meters} m (${row.total_length_km} km)`);
  console.log(`   - Distance from Start: ${row.distance_from_start_m} m`);
  console.log(`   - Calculated Progress: ${row.progress_percentage}%`);
  console.log(`   - Projected Point: [${row.projected_lng}, ${row.projected_lat}]`);
  console.log(`   - Perpendicular Distance (Offset from axis): ${row.offset_distance_meters} m`);

  await db.pool.end();
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
