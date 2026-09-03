const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./src/db.js');

async function inspect() {
  try {
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    console.log('=== ALL TABLES IN PUBLIC SCHEMA ===');
    console.table(tables.rows);

    const fks = await pool.query(`
      SELECT
        tc.table_schema, 
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM information_schema.table_constraints AS tc 
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
    `);
    console.log('=== ALL FOREIGN KEYS ===');
    console.table(fks.rows);

    // Test a sample LineString linear referencing and length calculation
    // LineString in Morocco (Rabat - Kenitra approx)
    const testGeojson = {
      type: "LineString",
      coordinates: [
        [-6.8498, 33.9716],
        [-6.7500, 34.0500],
        [-6.6500, 34.1500],
        [-6.5800, 34.2600]
      ]
    };

    const testGeo = await pool.query(`
      WITH geom_input AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS geom
      )
      SELECT 
        ST_GeometryType(geom) as geom_type,
        ST_SRID(geom) as srid,
        ST_Length(geom::geography) as length_meters,
        ST_Length(geom::geography) / 1000.0 as length_km,
        ST_AsGeoJSON(ST_LineSubstring(geom, 0.0, 0.25)) as sub_geom_1,
        ST_AsGeoJSON(ST_LineSubstring(geom, 0.25, 0.50)) as sub_geom_2
      FROM geom_input;
    `, [JSON.stringify(testGeojson)]);

    console.log('\n=== PostGIS Linear Substring Test ===');
    console.log('Length (m):', testGeo.rows[0].length_meters);
    console.log('Length (km):', testGeo.rows[0].length_km);
    console.log('Sub-geom 1:', testGeo.rows[0].sub_geom_1);
    console.log('Sub-geom 2:', testGeo.rows[0].sub_geom_2);

  } catch (err) {
    console.error('Error inspecting PostGIS:', err);
  } finally {
    await pool.end();
  }
}

inspect();



