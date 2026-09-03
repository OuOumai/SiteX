/**
 * server/scratch_srs.js
 */
'use strict';
require('dotenv').config();
const db = require('./src/db');

async function inspectSRS() {
  const res = await db.query(`
    SELECT srid, auth_name, auth_srid, proj4text, srtext 
    FROM spatial_ref_sys 
    WHERE srid IN (4326, 3857, 26191, 26192, 26194, 26195, 32629, 32630)
       OR auth_srid IN (26191, 26192, 26194, 26195, 32629, 32630);
  `);
  console.log('Found SRS entries:', res.rows.length);
  res.rows.forEach(r => console.log('SRID:', r.srid, 'auth_srid:', r.auth_srid, 'proj4:', r.proj4text));
  await db.pool.end();
}
inspectSRS().catch(e => console.error(e));
