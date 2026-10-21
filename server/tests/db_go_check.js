require('dotenv').config({ path: '../.env' });
const { Pool } = require('pg');
const pool = new Pool();
pool.query(
  "SELECT id, chantier_id, (kml_metadata::text LIKE '%groundOverlays%') as has_go FROM reference_alignment WHERE kml_metadata IS NOT NULL ORDER BY id DESC LIMIT 10"
).then(r => {
  console.log(JSON.stringify(r.rows, null, 2));
  pool.end();
}).catch(e => {
  console.error(e.message);
  pool.end();
});
