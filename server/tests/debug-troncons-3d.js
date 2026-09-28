require('dotenv').config({ path: 'server/.env' });
const db = require('../src/db');

async function testChantier185() {
  const cId = 185;
  const refRes = await db.query(
    'SELECT id, nom, ST_AsGeoJSON(geometry)::json AS geometry FROM public.reference_alignment WHERE chantier_id = $1;',
    [cId]
  );
  const trRes = await db.query(
    'SELECT id, nom, pk_debut, pk_fin, statut, avancement, ST_AsGeoJSON(geometry)::json AS geometry FROM public.troncon WHERE chantier_id = $1 ORDER BY pk_debut ASC;',
    [cId]
  );

  console.log(`Chantier ${cId}:`);
  console.log(`  Reference alignment: ${refRes.rows.length} rows`);
  const refCoords = refRes.rows[0].geometry.coordinates;
  console.log(`  Ref coords count: ${refCoords.length}, start: ${JSON.stringify(refCoords[0])}, end: ${JSON.stringify(refCoords[refCoords.length - 1])}`);

  console.log(`  Troncons: ${trRes.rows.length} rows`);
  trRes.rows.forEach((tr, i) => {
    console.log(`  Tronçon ${i + 1} (${tr.nom}): PK ${tr.pk_debut} -> ${tr.pk_fin}`);
    console.log(`    Geometry type: ${tr.geometry?.type}`);
    console.log(`    Coords count: ${tr.geometry?.coordinates?.length}`);
    console.log(`    First coord: ${JSON.stringify(tr.geometry?.coordinates?.[0])}`);
    console.log(`    Last coord: ${JSON.stringify(tr.geometry?.coordinates?.[tr.geometry?.coordinates?.length - 1])}`);
  });

  // Now simulate the Three.js ENU calculation as done in InteractiveGis3DMap.tsx!
  const lats = [];
  const lons = [];
  function addCoords(arr) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      if (Array.isArray(arr[i]) && arr[i].length >= 2) {
        lons.push(arr[i][0]);
        lats.push(arr[i][1]);
      }
    }
  }
  addCoords(refCoords);
  const origin = {
    lat: lats.reduce((a, b) => a + b, 0) / lats.length,
    lon: lons.reduce((a, b) => a + b, 0) / lons.length,
  };
  console.log('\nCalculated ENU origin:', origin);

  const R = 6378137.0;
  const rad = Math.PI / 180.0;
  const lat0Rad = origin.lat * rad;

  function toEnu(lon, lat, alt) {
    const dLat = (lat - origin.lat) * rad;
    const dLon = (lon - origin.lon) * rad;
    const x = R * dLon * Math.cos(lat0Rad);
    const z = -R * dLat;
    const y = alt || 0;
    return { x, y, z };
  }

  // Ref ENU:
  const refEnuStart = toEnu(refCoords[0][0], refCoords[0][1], 1.2);
  const refEnuEnd = toEnu(refCoords[refCoords.length - 1][0], refCoords[refCoords.length - 1][1], 1.2);
  console.log('Ref ENU start:', refEnuStart, 'end:', refEnuEnd);

  // Troncons ENU:
  trRes.rows.forEach((tr, i) => {
    const coords = tr.geometry.coordinates;
    const start = toEnu(coords[0][0], coords[0][1], 1.8);
    const end = toEnu(coords[coords.length - 1][0], coords[coords.length - 1][1], 1.8);
    console.log(`Troncon ${i + 1} ENU start:`, start, 'end:', end);
    const allFinite = coords.every(pt => {
      const enu = toEnu(pt[0], pt[1], 1.8);
      return Number.isFinite(enu.x) && Number.isFinite(enu.y) && Number.isFinite(enu.z);
    });
    console.log(`  All coordinates finite: ${allFinite}`);
  });

  process.exit(0);
}
testChantier185();
