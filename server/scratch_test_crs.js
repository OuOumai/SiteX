'use strict';
require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/db');

async function test() {
  const points = [
    { name: 'Rabat (Nord)', wgs: [-6.8498, 33.9716] },
    { name: 'Tanger (Nord)', wgs: [-5.8000, 35.7700] },
    { name: 'Casablanca (Nord)', wgs: [-7.6000, 33.5800] },
    { name: 'Oujda (Nord)', wgs: [-1.9000, 34.6800] },
    { name: 'Marrakech (Sud)', wgs: [-8.0000, 31.6300] },
    { name: 'Agadir (Sud)', wgs: [-9.6000, 30.4200] },
    { name: 'Laayoune (Sahara Nord)', wgs: [-13.2000, 27.1500] },
    { name: 'Dakhla (Sahara Sud)', wgs: [-15.9500, 23.7000] },
  ];

  console.log('=== MOROCCAN CITIES PROJECTED COORDINATES ===');
  for (const pt of points) {
    const res = await db.query(`
      SELECT 
        ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 26191)) as z1,
        ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 26192)) as z2,
        ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 26194)) as z3,
        ST_AsText(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 26195)) as z4
    `, [pt.wgs[0], pt.wgs[1]]);
    console.log(`\n📍 ${pt.name} [WGS84: ${pt.wgs[0]}, ${pt.wgs[1]}]:`);
    console.log('  Z1 (Nord  - 26191):', res.rows[0].z1);
    console.log('  Z2 (Sud   - 26192):', res.rows[0].z2);
    console.log('  Z3 (SNord - 26194):', res.rows[0].z3);
    console.log('  Z4 (SSud  - 26195):', res.rows[0].z4);
  }

  process.exit(0);
}

test().catch(err => { console.error(err); process.exit(1); });
