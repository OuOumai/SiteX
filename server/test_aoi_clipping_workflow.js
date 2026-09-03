/**
 * Test AOI Clipping and Linear Referencing Workflow
 */
const { Pool } = require('pg');
require('dotenv').config({ path: __dirname + '/.env' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'sitex_db',
});

const SAMPLE_LINE = {
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
};

// AOI that only covers the southern half of the line
const AOI_POLYGON = {
  type: 'Polygon',
  coordinates: [
    [
      [-6.75, 34.09],
      [-6.65, 34.09],
      [-6.80, 33.95],
      [-6.90, 33.95],
      [-6.75, 34.09],
    ],
  ],
};

async function testAoiClipping() {
  console.log('🧪 Testing AOI Clipping & Linear Referencing in PostGIS...');

  const client = await pool.connect();
  try {
    // 1. Create a dummy project and chantier with AOI
    const projRes = await client.query(
      `INSERT INTO public.projet (nom, date_debut, statut) 
       VALUES ('Projet Test Clipping', CURRENT_DATE, 'En cours') 
       RETURNING id;`
    );
    const projId = projRes.rows[0].id;

    const chantierRes = await client.query(
      `INSERT INTO public.chantier (projet_id, nom, statut, responsable_id, localisation) 
       VALUES ($1, 'Chantier Test Clipping', 'En cours', 11, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)) 
       RETURNING id;`,
      [projId, JSON.stringify(AOI_POLYGON)]
    );
    const chantierId = chantierRes.rows[0].id;
    console.log(`✅ Chantier #${chantierId} created with AOI polygon.`);

    // 2. Query raw length vs clipped length
    const rawLenRes = await client.query(
      `SELECT ROUND((ST_Length(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography) / 1000.0)::numeric, 3) AS raw_km`,
      [JSON.stringify(SAMPLE_LINE)]
    );
    const rawKm = parseFloat(rawLenRes.rows[0].raw_km);
    console.log(`📏 Raw Infrastructure Total Length: ${rawKm} km`);

    // 3. Test validate and clip query as implemented in uploadReferenceAlignment
    const validateAndInsertQuery = `
      WITH raw_input AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS src_geom
      ),
      parsed AS (
        SELECT src_geom AS raw_geom FROM raw_input
      ),
      aoi_src AS (
        SELECT localisation AS aoi_geom FROM public.chantier WHERE id = $2
      ),
      clipped AS (
        SELECT 
          CASE 
            WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(p.raw_geom, a.aoi_geom) THEN
              ST_LineMerge(ST_CollectionExtract(ST_Intersection(p.raw_geom, a.aoi_geom), 2))
            ELSE p.raw_geom
          END AS geom
        FROM parsed p
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
        ST_GeometryType(geom) AS geom_type,
        ROUND(ST_Length(geom::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geom::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geom)::json AS geometry,
        ST_X(ST_StartPoint(geom)) AS start_lng,
        ST_Y(ST_StartPoint(geom)) AS start_lat,
        ST_X(ST_EndPoint(geom)) AS end_lng,
        ST_Y(ST_EndPoint(geom)) AS end_lat
      FROM merged;
    `;

    const clipRes = await client.query(validateAndInsertQuery, [JSON.stringify(SAMPLE_LINE), chantierId]);
    const clippedRow = clipRes.rows[0];
    const clippedKm = parseFloat(clippedRow.length_km);

    console.log(`✂️ Clipped Infrastructure Length in AOI: ${clippedKm} km (Meters: ${clippedRow.length_meters})`);
    console.log(`📍 Entry Point / Origin (PK 0+000): Lon: ${clippedRow.start_lng}, Lat: ${clippedRow.start_lat}`);
    console.log(`📍 Exit Point / End: Lon: ${clippedRow.end_lng}, Lat: ${clippedRow.end_lat}`);

    if (clippedKm < rawKm && clippedKm > 0) {
      console.log(`🎉 SUCCESS: Clipped length (${clippedKm} km) is strictly inside AOI (Raw: ${rawKm} km)!`);
    } else {
      throw new Error('Clipping did not reduce length as expected.');
    }

    // Cleanup
    await client.query(`DELETE FROM public.chantier WHERE id = $1`, [chantierId]);
    await client.query(`DELETE FROM public.projet WHERE id = $1`, [projId]);
    console.log('🧹 Test cleanup completed.');
  } finally {
    client.release();
    await pool.end();
  }
}

testAoiClipping().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
