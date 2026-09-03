/**
 * server/scratch_exact_lrs.js
 * Test exact metric interpolation along the WGS84 ellipsoid
 */
'use strict';
require('dotenv').config();
const db = require('./src/db');

async function testExactLRS() {
  const coords = [
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
  ];
  const geojson = JSON.stringify({ type: 'LineString', coordinates: coords });

  // Test PostGIS ST_LocateAlong / ST_AddMeasure on a projected line
  // In PostGIS: ST_AddMeasure(ST_Transform(geom, 26191), 0, ST_Length(ST_Transform(geom, 26191)))
  // Or exact metric slicing using PostGIS:
  const query = `
    WITH raw AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom_4326
    ),
    measured AS (
      -- Add true geodetic length as M coordinate
      SELECT 
        geom_4326,
        ST_Length(geom_4326::geography) AS total_len_m,
        ST_Transform(geom_4326, 26191) AS geom_proj,
        ST_Length(ST_Transform(geom_4326, 26191)) AS proj_len_m
      FROM raw
    ),
    splits AS (
      SELECT 
        m.total_len_m,
        m.proj_len_m,
        generate_series(0, 7) AS i
      FROM measured m
    )
    SELECT 
      i + 1 AS troncon_num,
      ROUND((i * total_len_m / 8.0)::numeric, 2) AS pk_debut_m,
      ROUND(((i + 1) * total_len_m / 8.0)::numeric, 2) AS pk_fin_m,
      ROUND((total_len_m / 8.0)::numeric, 2) AS target_len_m
    FROM splits;
  `;
  const res = await db.query(query, [geojson]);
  console.log('Exact Targets:', res.rows);
  await db.pool.end();
}
testExactLRS();
