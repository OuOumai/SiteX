'use strict';
require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/db');

// Supported CRS catalog
const SUPPORTED_CRS = [
  {
    srid: 4326,
    name: 'WGS 84',
    code: 'EPSG:4326',
    type: 'geographic',
    description: 'Coordonnées géographiques mondiales (degrés décimaux)',
    bbox_wgs84: { minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 },
    morocco_bbox: { minLon: -17.5, minLat: 20.5, maxLon: -0.5, maxLat: 36.0 },
  },
  {
    srid: 26191,
    name: 'Merchich / Nord Maroc',
    code: 'EPSG:26191',
    type: 'projected',
    description: 'Projection métrique Lambert — Maroc Zone 1 (Rabat, Casa, Tanger, Fès, Oujda)',
    target_lat: { min: 31.5, max: 36.2 },
    target_lon: { min: -10.5, max: -0.5 },
  },
  {
    srid: 26192,
    name: 'Merchich / Sud Maroc',
    code: 'EPSG:26192',
    type: 'projected',
    description: 'Projection métrique Lambert — Maroc Zone 2 (Marrakech, Agadir, Ouarzazate, Souss)',
    target_lat: { min: 27.5, max: 32.5 },
    target_lon: { min: -12.5, max: -2.5 },
  },
  {
    srid: 26194,
    name: 'Merchich / Sahara Nord',
    code: 'EPSG:26194',
    type: 'projected',
    description: 'Projection métrique Lambert — Maroc Zone 3 (Laâyoune, Smara, Boujdour)',
    target_lat: { min: 23.8, max: 27.8 },
    target_lon: { min: -14.5, max: -8.0 },
  },
  {
    srid: 26195,
    name: 'Merchich / Sahara Sud',
    code: 'EPSG:26195',
    type: 'projected',
    description: 'Projection métrique Lambert — Maroc Zone 4 (Dakhla, Aousserd, Lagouira)',
    target_lat: { min: 20.5, max: 24.5 },
    target_lon: { min: -17.5, max: -11.5 },
  },
  {
    srid: 3857,
    name: 'WGS 84 / Pseudo-Mercator',
    code: 'EPSG:3857',
    type: 'projected',
    description: 'Projection Web Mercator (mètres)',
    target_lat: { min: 20.0, max: 36.5 },
    target_lon: { min: -18.0, max: 0.0 },
  }
];

async function detectCRS(geojsonData) {
  // Extract coordinate sample to evaluate raw range
  let coords = [];
  function extractPoints(c) {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      coords.push(c);
      return;
    }
    for (const item of c) extractPoints(item);
  }

  if (geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features)) {
    for (const f of geojsonData.features) {
      if (f.geometry && f.geometry.coordinates) extractPoints(f.geometry.coordinates);
    }
  } else if (geojsonData.geometry && geojsonData.geometry.coordinates) {
    extractPoints(geojsonData.geometry.coordinates);
  } else if (geojsonData.coordinates) {
    extractPoints(geojsonData.coordinates);
  }

  if (coords.length === 0) {
    throw new Error('Aucune coordonnée trouvée dans le fichier.');
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of coords) {
    const x = pt[0], y = pt[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  console.log(`\nAnalyzing ${coords.length} points. Raw bounds: X=[${minX.toFixed(2)}, ${maxX.toFixed(2)}], Y=[${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);

  // Check explicit CRS metadata in GeoJSON if present
  let explicitSrid = null;
  if (geojsonData.crs && geojsonData.crs.properties && geojsonData.crs.properties.name) {
    const crsName = String(geojsonData.crs.properties.name);
    const epsgMatch = crsName.match(/EPSG:{0,2}(\d+)/i) || crsName.match(/(\d{4,5})$/);
    if (epsgMatch) explicitSrid = parseInt(epsgMatch[1], 10);
  }

  // 1. If coordinates are clearly in degree range [-180, 180], [-90, 90]
  if (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90) {
    // Check if within Morocco geographic bounds
    const inMorocco = minX >= -18.0 && maxX <= 0.0 && minY >= 20.0 && maxY <= 36.5;
    return {
      detected_srid: 4326,
      crs_name: 'WGS 84 (Coordonnées géographiques)',
      epsg_code: 'EPSG:4326',
      confidence: inMorocco ? 'HIGH' : 'MEDIUM',
      unit: 'degrés décimaux',
      type: 'geographic',
      explanation: inMorocco
        ? 'Coordonnées géographiques WGS 84 valides situées au Maroc.'
        : 'Coordonnées géographiques WGS 84 standard.',
      is_ambiguous: false,
      candidates: [SUPPORTED_CRS[0]]
    };
  }

  // 2. Projected coordinates (large numbers in meters)
  // Test candidate projected SRIDs via PostGIS ST_Transform
  const geomJson = JSON.stringify(geojsonData.type === 'FeatureCollection' ? geojsonData.features[0].geometry : (geojsonData.geometry || geojsonData));
  
  const testResults = [];
  for (const crs of SUPPORTED_CRS.filter(c => c.srid !== 4326)) {
    try {
      const q = await db.query(`
        WITH input AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $2) AS raw_geom
        ),
        transformed AS (
          SELECT 
            ST_Transform(raw_geom, 4326) AS wgs_geom,
            ST_IsValid(ST_Transform(raw_geom, 4326)) AS is_valid
          FROM input
        )
        SELECT 
          is_valid,
          ST_XMin(wgs_geom) AS min_lon,
          ST_YMin(wgs_geom) AS min_lat,
          ST_XMax(wgs_geom) AS max_lon,
          ST_YMax(wgs_geom) AS max_lat,
          ST_Length(wgs_geom::geography) AS length_m
        FROM transformed;
      `, [geomJson, crs.srid]);

      if (q.rows.length > 0) {
        const row = q.rows[0];
        const minLon = parseFloat(row.min_lon);
        const minLat = parseFloat(row.min_lat);
        const maxLon = parseFloat(row.max_lon);
        const maxLat = parseFloat(row.max_lat);
        const isValid = row.is_valid;
        const lengthM = parseFloat(row.length_m) || 0;

        // Check if falls inside candidate zone bounds
        const insideMorocco = minLon >= -18.0 && maxLon <= 0.0 && minLat >= 20.0 && maxLat <= 36.5;
        const insideTargetZone = crs.target_lat && (minLat >= crs.target_lat.min && maxLat <= crs.target_lat.max && minLon >= crs.target_lon.min && maxLon <= crs.target_lon.max);

        testResults.push({
          srid: crs.srid,
          crs,
          isValid,
          minLon, minLat, maxLon, maxLat,
          insideMorocco,
          insideTargetZone,
          lengthM
        });
      }
    } catch (err) {
      // Transformation failed mathematically
      testResults.push({
        srid: crs.srid,
        crs,
        isValid: false,
        error: err.message
      });
    }
  }

  console.log('Transformation candidates evaluation:');
  for (const t of testResults) {
    if (t.isValid) {
      console.log(`  - [EPSG:${t.srid} ${t.crs.name}]: insideMorocco=${t.insideMorocco}, insideTargetZone=${t.insideTargetZone}, transformed Lat=[${t.minLat.toFixed(2)}, ${t.maxLat.toFixed(2)}], Lon=[${t.minLon.toFixed(2)}, ${t.maxLon.toFixed(2)}]`);
    } else {
      console.log(`  - [EPSG:${t.srid} ${t.crs.name}]: Failed (${t.error})`);
    }
  }

  // Filter valid candidates in Morocco
  const validMorocco = testResults.filter(t => t.isValid && t.insideMorocco);
  const primeCandidates = validMorocco.filter(t => t.insideTargetZone);

  if (primeCandidates.length === 1) {
    const best = primeCandidates[0];
    return {
      detected_srid: best.srid,
      crs_name: best.crs.name,
      epsg_code: best.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: `Projection métrique ${best.crs.name} détectée automatiquement avec haute certitude (coordonnées conformes à l'emprise).`,
      is_ambiguous: false,
      candidates: [best.crs]
    };
  }

  if (validMorocco.length === 1) {
    const single = validMorocco[0];
    return {
      detected_srid: single.srid,
      crs_name: single.crs.name,
      epsg_code: single.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: `Projection métrique ${single.crs.name} détectée (coordonnées valides au Maroc).`,
      is_ambiguous: false,
      candidates: [single.crs]
    };
  }

  if (primeCandidates.length > 1 || validMorocco.length > 1) {
    const list = primeCandidates.length > 0 ? primeCandidates : validMorocco;
    return {
      detected_srid: list[0].srid,
      crs_name: list[0].crs.name,
      epsg_code: list[0].crs.code,
      confidence: 'UNCERTAIN',
      unit: 'mètres',
      type: 'projected',
      explanation: `Ambigüité détectée entre ${list.length} zones de projection marocaines plausibles. Veuillez confirmer la zone.`,
      is_ambiguous: true,
      candidates: list.map(l => l.crs)
    };
  }

  return {
    detected_srid: null,
    crs_name: 'Système de coordonnées inconnu',
    epsg_code: null,
    confidence: 'NONE',
    unit: 'inconnu',
    type: 'unknown',
    explanation: 'Impossible de déterminer automatiquement le système de projection. Les coordonnées ne correspondent à aucun système marocain connu.',
    is_ambiguous: true,
    candidates: SUPPORTED_CRS
  };
}

async function runTests() {
  // Test GeoJSON 1: WGS84 railway line (Kenitra - Rabat)
  console.log('\n=== TEST 1: WGS 84 Line ===');
  const wgsGeojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[-6.8498, 33.9716], [-6.75, 34.05], [-6.58, 34.26]]
    }
  };
  console.log(await detectCRS(wgsGeojson));

  // Test GeoJSON 2: Merchich Zone 1 Line (Rabat - Kenitra in Lambert Zone 1 coordinates)
  console.log('\n=== TEST 2: Merchich Zone 1 (Nord) Line in Meters ===');
  const z1Geojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[365912.0, 375686.1], [375500.0, 384000.0], [391500.0, 407000.0]]
    }
  };
  console.log(await detectCRS(z1Geojson));

  // Test GeoJSON 3: Merchich Zone 2 Line (Marrakech - Agadir in Zone 2 coordinates)
  console.log('\n=== TEST 3: Merchich Zone 2 (Sud) Line in Meters ===');
  const z2Geojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[253161.1, 516968.5], [175000.0, 450000.0], [96534.9, 387379.3]]
    }
  };
  console.log(await detectCRS(z2Geojson));

  // Test GeoJSON 4: Web Mercator Line
  console.log('\n=== TEST 4: Web Mercator Line ===');
  const mercGeojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[-762516.5, 4024921.3], [-751383.0, 4035600.0], [-732459.0, 4064000.0]]
    }
  };
  console.log(await detectCRS(mercGeojson));

  // Test GeoJSON 5: Unknown bogus coordinate system [9999999, 9999999]
  console.log('\n=== TEST 5: Bogus coordinates ===');
  const bogusGeojson = {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [[9999999, 9999999], [9999990, 9999990]]
    }
  };
  console.log(await detectCRS(bogusGeojson));

  process.exit(0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
