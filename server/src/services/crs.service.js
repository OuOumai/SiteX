/**
 * server/src/services/crs.service.js
 *
 * Geomatics & Coordinate Reference System (CRS) Detection and Transformation Service.
 * Supports:
 *   - EPSG:4326  : WGS 84 (Coordonnées géographiques en degrés décimaux)
 *   - EPSG:26191 : Merchich / Nord Maroc (Lambert Conforme Conique 1SP - Zone 1)
 *   - EPSG:26192 : Merchich / Sud Maroc (Lambert Conforme Conique 1SP - Zone 2)
 *   - EPSG:26194 : Merchich / Sahara Nord (Lambert Conforme Conique 1SP - Zone 3)
 *   - EPSG:26195 : Merchich / Sahara Sud (Lambert Conforme Conique 1SP - Zone 4)
 *   - EPSG:3857  : WGS 84 / Pseudo-Mercator (Web Mercator en mètres)
 */

'use strict';

const db = require('../db');

/**
 * Registry of Supported Coordinate Reference Systems
 */
const SUPPORTED_CRS = [
  {
    srid: 4326,
    code: 'EPSG:4326',
    name: 'WGS 84 (Degrés décimaux)',
    zone_label: 'Mondial / Maroc',
    type: 'geographic',
    unit: 'degrés décimaux',
    description: 'Coordonnées géographiques mondiales standard [longitude, latitude].',
    target_lat: { min: 20.5, max: 36.2 },
    target_lon: { min: -17.5, max: -0.5 },
  },
  {
    srid: 26191,
    code: 'EPSG:26191',
    name: 'Merchich / Nord Maroc (Zone 1)',
    zone_label: 'Nord & Centre-Nord (Rabat, Casablanca, Tanger, Fès, Oujda, Kénitra)',
    type: 'projected',
    unit: 'mètres',
    description: 'Projection métrique conique conforme Lambert — Maroc Zone 1 (Latitudes 31.5°N à 36.0°N).',
    target_lat: { min: 31.5, max: 36.2 },
    target_lon: { min: -10.5, max: -0.5 },
  },
  {
    srid: 26192,
    code: 'EPSG:26192',
    name: 'Merchich / Sud Maroc (Zone 2)',
    zone_label: 'Centre & Sud (Marrakech, Agadir, Ouarzazate, Safi, Souss-Massa)',
    type: 'projected',
    unit: 'mètres',
    description: 'Projection métrique conique conforme Lambert — Maroc Zone 2 (Latitudes 27.6°N à 32.5°N).',
    target_lat: { min: 27.5, max: 32.5 },
    target_lon: { min: -12.5, max: -2.5 },
  },
  {
    srid: 26194,
    code: 'EPSG:26194',
    name: 'Merchich / Sahara Nord (Zone 3)',
    zone_label: 'Sahara Nord (Laâyoune, Smara, Boujdour, Tarfaya, Tan-Tan)',
    type: 'projected',
    unit: 'mètres',
    description: 'Projection métrique conique conforme Lambert — Maroc Zone 3 (Latitudes 24.0°N à 27.7°N).',
    target_lat: { min: 23.8, max: 27.8 },
    target_lon: { min: -14.5, max: -8.0 },
  },
  {
    srid: 26195,
    code: 'EPSG:26195',
    name: 'Merchich / Sahara Sud (Zone 4)',
    zone_label: 'Sahara Sud (Dakhla, Aousserd, Lagouira)',
    type: 'projected',
    unit: 'mètres',
    description: 'Projection métrique conique conforme Lambert — Maroc Zone 4 (Latitudes 20.8°N à 24.2°N).',
    target_lat: { min: 20.5, max: 24.5 },
    target_lon: { min: -17.5, max: -11.5 },
  },
  {
    srid: 3857,
    code: 'EPSG:3857',
    name: 'WGS 84 / Pseudo-Mercator',
    zone_label: 'Projection Web Mercator (mètres)',
    type: 'projected',
    unit: 'mètres',
    description: 'Projection cartographique Web standard (utilisée par Google/OSM/Esri tiles).',
    target_lat: { min: 20.0, max: 36.5 },
    target_lon: { min: -18.0, max: 0.0 },
  },
];

/**
 * Helper: Find CRS definition by SRID
 */
function getCrsBySrid(srid) {
  const num = parseInt(srid, 10);
  return SUPPORTED_CRS.find((c) => c.srid === num) || null;
}

/**
 * Helper: Extracts coordinate sample from GeoJSON object
 */
function extractCoordinateSample(rawJson) {
  let parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
  const sample = [];

  function walk(coords) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      sample.push([coords[0], coords[1]]);
      return;
    }
    for (const item of coords) walk(item);
  }

  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    for (const f of parsed.features) {
      if (f && f.geometry && f.geometry.coordinates) walk(f.geometry.coordinates);
    }
  } else if (parsed.geometry && parsed.geometry.coordinates) {
    walk(parsed.geometry.coordinates);
  } else if (parsed.coordinates) {
    walk(parsed.coordinates);
  }

  return sample;
}

/**
 * Automatically detects the Source CRS of a spatial file using multi-criteria evidence:
 * 1. File metadata (explicit CRS URN/name)
 * 2. Coordinate range & magnitude (decimal degrees vs. metric projected)
 * 3. Mathematical PostGIS ST_Transform feasibility
 * 4. Transformed coordinates bounding box inside Morocco and zone-specific area of use
 * 5. Spatial proximity with Chantier AOI (if provided)
 *
 * @param {Object} geojsonData - Input GeoJSON payload
 * @param {Object} [options] - Optional context: { aoiGeometry, chantierId, explicitSrid }
 * @returns {Promise<Object>} Detection result with confidence and candidates
 */
async function detectSourceCrs(geojsonData, options = {}) {
  const { aoiGeometry, chantierId, explicitSrid } = options;

  // If user explicitly specified a valid SRID, validate and return
  if (explicitSrid && explicitSrid !== 'auto') {
    const matched = getCrsBySrid(explicitSrid);
    if (matched) {
      return {
        detected_srid: matched.srid,
        crs_name: matched.name,
        epsg_code: matched.code,
        confidence: 'HIGH',
        unit: matched.unit,
        type: matched.type,
        explanation: `Système ${matched.name} sélectionné explicitement.`,
        is_ambiguous: false,
        candidates: [matched],
      };
    }
  }

  // 1. Inspect explicit CRS metadata inside GeoJSON if present
  let fileDeclaredSrid = null;
  if (geojsonData && geojsonData.crs && geojsonData.crs.properties && geojsonData.crs.properties.name) {
    const crsName = String(geojsonData.crs.properties.name);
    const epsgMatch = crsName.match(/EPSG:{0,2}(\d+)/i) || crsName.match(/(\d{4,5})$/);
    if (epsgMatch) {
      fileDeclaredSrid = parseInt(epsgMatch[1], 10);
    }
  }

  // 2. Extract coordinate sample & bounds
  const coords = extractCoordinateSample(geojsonData);
  if (coords.length === 0) {
    throw new Error('Le fichier ne contient aucune coordonnée spatiale exploitable.');
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of coords) {
    const x = pt[0], y = pt[1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const rawBounds = { minX, maxX, minY, maxY, samplePointsCount: coords.length };

  // 3. Check if coordinates are in standard Geographic degree range [-180, 180] and [-90, 90]
  if (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90) {
    // Check if within Morocco geographic bounding box
    const inMorocco = minX >= -17.5 && maxX <= 0.0 && minY >= 20.5 && maxY <= 36.2;
    const wgsCrs = SUPPORTED_CRS[0]; // EPSG:4326

    return {
      detected_srid: 4326,
      crs_name: wgsCrs.name,
      epsg_code: wgsCrs.code,
      confidence: inMorocco ? 'HIGH' : 'HIGH',
      unit: 'degrés décimaux',
      type: 'geographic',
      explanation: inMorocco
        ? 'Coordonnées géographiques WGS 84 (degrés décimaux) situées au Maroc.'
        : 'Coordonnées géographiques WGS 84 (degrés décimaux).',
      is_ambiguous: false,
      candidates: [wgsCrs],
      raw_bounds: rawBounds,
    };
  }

  // 4. Projected / Metric Coordinates Detection via PostGIS ST_Transform
  let sampleGeom = null;
  if (geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features) && geojsonData.features.length > 0) {
    sampleGeom = geojsonData.features[0].geometry;
  } else if (geojsonData.geometry) {
    sampleGeom = geojsonData.geometry;
  } else if (geojsonData.coordinates) {
    sampleGeom = geojsonData;
  }

  if (!sampleGeom) {
    throw new Error('Géométrie introuvable dans le GeoJSON pour l\'analyse de projection.');
  }

  // Prepare AOI for proximity cross-analysis if available
  let aoiParam = null;
  if (aoiGeometry) {
    aoiParam = typeof aoiGeometry === 'string' ? aoiGeometry : JSON.stringify(aoiGeometry);
  }

  const projectedCandidates = SUPPORTED_CRS.filter((c) => c.srid !== 4326);
  const evaluationResults = [];

  for (const crs of projectedCandidates) {
    try {
      const query = `
        WITH input AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $2) AS raw_geom
        ),
        transformed AS (
          SELECT 
            ST_Transform(raw_geom, 4326) AS wgs_geom,
            ST_IsValid(ST_Transform(raw_geom, 4326)) AS is_valid
          FROM input
        ),
        aoi AS (
          SELECT CASE 
            WHEN $3::text IS NOT NULL AND $3::text != '' THEN ST_SetSRID(ST_GeomFromGeoJSON($3), 4326)
            ELSE (SELECT localisation FROM public.chantier WHERE id = $4)
          END AS aoi_geom
        )
        SELECT 
          t.is_valid,
          ST_XMin(t.wgs_geom) AS min_lon,
          ST_YMin(t.wgs_geom) AS min_lat,
          ST_XMax(t.wgs_geom) AS max_lon,
          ST_YMax(t.wgs_geom) AS max_lat,
          ROUND(ST_Length(t.wgs_geom::geography)::numeric, 2) AS length_m,
          CASE 
            WHEN a.aoi_geom IS NOT NULL THEN ST_Intersects(t.wgs_geom, a.aoi_geom)
            ELSE false 
          END AS intersects_aoi,
          CASE 
            WHEN a.aoi_geom IS NOT NULL THEN ROUND(ST_Distance(t.wgs_geom::geography, a.aoi_geom::geography)::numeric, 2)
            ELSE NULL 
          END AS dist_to_aoi_m
        FROM transformed t
        CROSS JOIN aoi a;
      `;

      const res = await db.query(query, [
        JSON.stringify(sampleGeom),
        crs.srid,
        aoiParam,
        chantierId || null,
      ]);

      if (res.rows.length > 0) {
        const row = res.rows[0];
        const minLon = parseFloat(row.min_lon);
        const minLat = parseFloat(row.min_lat);
        const maxLon = parseFloat(row.max_lon);
        const maxLat = parseFloat(row.max_lat);
        const isValid = !!row.is_valid;
        const lengthM = parseFloat(row.length_m) || 0;
        const intersectsAoi = !!row.intersects_aoi;
        const distToAoiM = row.dist_to_aoi_m !== null ? parseFloat(row.dist_to_aoi_m) : null;

        // Check if inside general Morocco bounding box
        const insideMorocco = minLon >= -18.0 && maxLon <= 0.0 && minLat >= 20.0 && maxLat <= 36.5;

        // Check if inside specific zone target area
        const insideZone =
          crs.target_lat &&
          minLat >= crs.target_lat.min &&
          maxLat <= crs.target_lat.max &&
          minLon >= crs.target_lon.min &&
          maxLon <= crs.target_lon.max;

        evaluationResults.push({
          srid: crs.srid,
          crs,
          isValid,
          minLon,
          minLat,
          maxLon,
          maxLat,
          insideMorocco,
          insideZone,
          lengthM,
          intersectsAoi,
          distToAoiM,
          fileDeclared: fileDeclaredSrid === crs.srid,
        });
      }
    } catch (err) {
      // Transformation failed mathematically
      evaluationResults.push({
        srid: crs.srid,
        crs,
        isValid: false,
        insideMorocco: false,
        insideZone: false,
        error: err.message,
      });
    }
  }

  // 5. Evaluation & Decision Tree
  // A. Check if declared in file metadata and valid
  const declaredMatch = evaluationResults.find((r) => r.fileDeclared && r.isValid && r.insideMorocco);
  if (declaredMatch) {
    return {
      detected_srid: declaredMatch.srid,
      crs_name: declaredMatch.crs.name,
      epsg_code: declaredMatch.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: `Système ${declaredMatch.crs.name} spécifié dans les métadonnées du fichier et validé spatialement.`,
      is_ambiguous: false,
      candidates: [declaredMatch.crs],
      raw_bounds: rawBounds,
    };
  }

  // B. Check if AOI match exists (distance < 60km or intersects)
  const aoiMatches = evaluationResults.filter((r) => r.isValid && (r.intersectsAoi || (r.distToAoiM !== null && r.distToAoiM < 60000)));
  if (aoiMatches.length === 1) {
    const top = aoiMatches[0];
    return {
      detected_srid: top.srid,
      crs_name: top.crs.name,
      epsg_code: top.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: `Projection ${top.crs.name} identifiée avec certitude (correspondance exacte avec l'emprise du chantier).`,
      is_ambiguous: false,
      candidates: [top.crs],
      raw_bounds: rawBounds,
    };
  }

  // C. Check Web Mercator EPSG:3857
  const webMerc = evaluationResults.find((r) => r.srid === 3857 && r.isValid && r.insideMorocco);
  // In Morocco, Web Mercator coordinates have X < 0 and Y > 2,000,000 m
  if (webMerc && minX < 0 && minY > 2000000) {
    return {
      detected_srid: 3857,
      crs_name: webMerc.crs.name,
      epsg_code: webMerc.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: 'Projection Web Mercator (EPSG:3857) détectée automatiquement.',
      is_ambiguous: false,
      candidates: [webMerc.crs],
      raw_bounds: rawBounds,
    };
  }

  // D. Filter valid Moroccan Lambert candidates
  const validMoroccoLambert = evaluationResults.filter((r) => r.srid !== 3857 && r.isValid && r.insideMorocco);
  const primaryZoneCandidates = validMoroccoLambert.filter((r) => r.insideZone);

  // If exactly one primary zone candidate matches
  if (primaryZoneCandidates.length === 1) {
    const best = primaryZoneCandidates[0];
    return {
      detected_srid: best.srid,
      crs_name: best.crs.name,
      epsg_code: best.crs.code,
      confidence: 'HIGH',
      unit: 'mètres',
      type: 'projected',
      explanation: `Projection métrique ${best.crs.name} détectée (coordonnées conformes à l'emprise géographique de la zone).`,
      is_ambiguous: false,
      candidates: [best.crs],
      raw_bounds: rawBounds,
    };
  }

  // If multiple candidates are plausible (e.g. Zone 1 vs Zone 2 boundary overlap or no AOI context)
  if (primaryZoneCandidates.length > 1 || validMoroccoLambert.length > 0) {
    const list = primaryZoneCandidates.length > 0 ? primaryZoneCandidates : validMoroccoLambert;
    return {
      detected_srid: list[0].srid,
      crs_name: list[0].crs.name,
      epsg_code: list[0].crs.code,
      confidence: 'UNCERTAIN',
      unit: 'mètres',
      type: 'projected',
      explanation: `Ambigüité détectée : Plusieurs zones de projection marocaines sont plausibles (${list.map((l) => l.crs.code).join(', ')}). Veuillez confirmer la zone.`,
      is_ambiguous: true,
      candidates: list.map((l) => l.crs),
      raw_bounds: rawBounds,
    };
  }

  // E. No valid Moroccan or standard CRS match
  return {
    detected_srid: null,
    crs_name: 'Système de coordonnées non reconnu',
    epsg_code: null,
    confidence: 'NONE',
    unit: 'inconnu',
    type: 'unknown',
    explanation: 'Impossible de déterminer automatiquement le système de projection. Veuillez sélectionner manuellement le système source.',
    is_ambiguous: true,
    candidates: SUPPORTED_CRS,
    raw_bounds: rawBounds,
  };
}

/**
 * Normalizes input GeoJSON and transforms it to canonical WGS84 (EPSG:4326)
 * using real PostGIS ST_Transform if source_srid !== 4326.
 *
 * @param {Object|string} rawJson - Input GeoJSON geometry or feature
 * @param {number} [sourceSrid=4326] - Source CRS SRID
 * @returns {Promise<Object>} GeoJSON geometry in canonical WGS84 (EPSG:4326)
 */
async function normalizeAndTransformGeometry(rawJson, sourceSrid = 4326) {
  let parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

  // Extract LineStrings if FeatureCollection
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features) && parsed.features.length > 0) {
    const lineFeatures = parsed.features.filter(
      (f) => f && f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
    );
    if (lineFeatures.length === 0) {
      throw new Error('Le fichier GeoJSON ne contient aucune géométrie linéaire (LineString / MultiLineString).');
    }
    if (lineFeatures.length === 1) {
      parsed = lineFeatures[0].geometry;
    } else {
      const allCoords = [];
      for (const feat of lineFeatures) {
        if (feat.geometry.type === 'LineString') {
          allCoords.push(feat.geometry.coordinates);
        } else if (feat.geometry.type === 'MultiLineString') {
          allCoords.push(...feat.geometry.coordinates);
        }
      }
      parsed = { type: 'MultiLineString', coordinates: allCoords };
    }
  } else if (parsed.type === 'Feature' && parsed.geometry) {
    parsed = parsed.geometry;
  }

  if (parsed.type !== 'LineString' && parsed.type !== 'MultiLineString') {
    throw new Error(`Type de géométrie non supporté : ${parsed.type}. Seuls LineString et MultiLineString sont acceptés.`);
  }

  const sridNum = parseInt(sourceSrid, 10) || 4326;

  // If source is already WGS84, return parsed
  if (sridNum === 4326) {
    return parsed;
  }

  // Real PostGIS coordinate transformation
  const transformQuery = `
    WITH input AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $2) AS raw_geom
    )
    SELECT 
      ST_AsGeoJSON(ST_Transform(raw_geom, 4326))::json AS wgs_geom
    FROM input;
  `;

  return result.rows[0].wgs_geom;
}

/**
 * Determines the optimal Projected Metric CRS (Measurement CRS) for LRS and linear calculations
 * based on spatial location (latitude/longitude in WGS 84).
 *
 * For Morocco:
 *   - Latitude >= 31.5°N : EPSG:26191 (Merchich / Nord Maroc — Zone 1)
 *   - 27.5°N <= Latitude < 31.5°N : EPSG:26192 (Merchich / Sud Maroc — Zone 2)
 *   - 23.8°N <= Latitude < 27.5°N : EPSG:26194 (Merchich / Sahara Nord — Zone 3)
 *   - Latitude < 23.8°N : EPSG:26195 (Merchich / Sahara Sud — Zone 4)
 * Outside Morocco:
 *   - UTM Zone 29N (EPSG:32629) or 30N (EPSG:32630) based on longitude
 *
 * @param {Object|Array} inputGeom - GeoJSON geometry or coordinates sample
 * @returns {Object} { srid, code, name, unit: 'mètres' }
 */
function getMeasurementCrs(inputGeom) {
  let coords = [];
  if (Array.isArray(inputGeom)) {
    coords = inputGeom;
  } else if (inputGeom) {
    coords = extractCoordinateSample(inputGeom);
  }

  // Default to Merchich Nord Zone 1 if empty
  if (!coords || coords.length === 0) {
    const defaultCrs = getCrsBySrid(26191);
    return { srid: defaultCrs.srid, code: defaultCrs.code, name: defaultCrs.name, unit: 'mètres' };
  }

  // Compute average latitude & longitude
  let sumLat = 0, sumLon = 0, count = 0;
  for (const pt of coords) {
    if (Array.isArray(pt) && pt.length >= 2) {
      sumLon += pt[0];
      sumLat += pt[1];
      count++;
    }
  }

  const avgLon = count > 0 ? sumLon / count : -6.8;
  const avgLat = count > 0 ? sumLat / count : 33.5;

  // Determine Moroccan Lambert Zone based on latitude
  if (avgLat >= 31.5) {
    const c = getCrsBySrid(26191);
    return { srid: 26191, code: 'EPSG:26191', name: c ? c.name : 'Merchich / Nord Maroc (Zone 1)', unit: 'mètres' };
  } else if (avgLat >= 27.5) {
    const c = getCrsBySrid(26192);
    return { srid: 26192, code: 'EPSG:26192', name: c ? c.name : 'Merchich / Sud Maroc (Zone 2)', unit: 'mètres' };
  } else if (avgLat >= 23.8) {
    const c = getCrsBySrid(26194);
    return { srid: 26194, code: 'EPSG:26194', name: c ? c.name : 'Merchich / Sahara Nord (Zone 3)', unit: 'mètres' };
  } else if (avgLat >= 20.0) {
    const c = getCrsBySrid(26195);
    return { srid: 26195, code: 'EPSG:26195', name: c ? c.name : 'Merchich / Sahara Sud (Zone 4)', unit: 'mètres' };
  }

  // Fallback for coordinates outside Morocco: UTM projected system
  const utmZone = Math.max(1, Math.min(60, Math.floor((avgLon + 180) / 6) + 1));
  const utmSrid = avgLat >= 0 ? 32600 + utmZone : 32700 + utmZone;
  return {
    srid: utmSrid,
    code: `EPSG:${utmSrid}`,
    name: `WGS 84 / UTM Zone ${utmZone}${avgLat >= 0 ? 'N' : 'S'}`,
    unit: 'mètres',
  };
}

module.exports = {
  SUPPORTED_CRS,
  getCrsBySrid,
  detectSourceCrs,
  normalizeAndTransformGeometry,
  getMeasurementCrs,
};

