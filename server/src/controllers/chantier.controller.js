/**
 * server/src/controllers/chantier.controller.js
 *
 * Controller handling Chantier entity resources & GIS Setup Workflow.
 * Implements:
 *   - getChantierDetails
 *   - createChantier
 *   - uploadReferenceAlignment
 *   - getReferenceAlignment
 *   - generateTronconsPreview
 *   - saveTroncons
 *   - getChantierTroncons
 */

'use strict';

const fs = require('fs');
const path = require('path');
const db = require('../db');
const crsService = require('../services/crs.service');

/**
 * Helper: Normalizes input GeoJSON to a single LineString geometry object
 */
function extractLineStringGeometry(rawJson) {
  let parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

  // 1. If FeatureCollection
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features) && parsed.features.length > 0) {
    const lineFeatures = parsed.features.filter(
      (f) => f && f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
    );
    if (lineFeatures.length === 0) {
      throw new Error('Le fichier GeoJSON ne contient aucune géométrie de type LineString ou MultiLineString.');
    }
    // If single line feature, take its geometry
    if (lineFeatures.length === 1) {
      parsed = lineFeatures[0].geometry;
    } else {
      // Merge multiple LineStrings into MultiLineString
      const allCoords = [];
      for (const feat of lineFeatures) {
        if (feat.geometry.type === 'LineString') {
          allCoords.push(feat.geometry.coordinates);
        } else if (feat.geometry.type === 'MultiLineString') {
          allCoords.push(...feat.geometry.coordinates);
        }
      }
      parsed = {
        type: 'MultiLineString',
        coordinates: allCoords,
      };
    }
  }

  // 2. If Feature
  if (parsed.type === 'Feature' && parsed.geometry) {
    parsed = parsed.geometry;
  }

  // 3. Validate geometry type
  if (parsed.type !== 'LineString' && parsed.type !== 'MultiLineString') {
    throw new Error(`Type de géométrie non supporté : ${parsed.type}. Seuls LineString et MultiLineString sont acceptés.`);
  }

  if (!Array.isArray(parsed.coordinates) || parsed.coordinates.length < 2) {
    throw new Error('La géométrie contient des coordonnées insuffisantes (minimum 2 points).');
  }

  return parsed;
}

/**
 * GET /chantiers/:id
 * Returns detailed chantier information with latest avancement, satellite images,
 * reference alignment status, and troncon data.
 */
async function getChantierDetails(req, res) {
  try {
    const { id } = req.params;

    // 1. Fetch chantier with joined project & responsable info
    const chantierQuery = `
      SELECT 
        c.id,
        c.projet_id,
        c.responsable_id,
        c.nom,
        c.statut,
        c.surface,
        c.surface_reference,
        c.d_max_position_meters,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation,
        ST_AsGeoJSON(c.localisation)::json AS localisation,
        p.nom AS projet_nom,
        p.description AS projet_description,
        p.type_projet AS projet_type,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS responsable_nom
      FROM public.chantier c
      LEFT JOIN public.projet p ON p.id = c.projet_id
      LEFT JOIN public.utilisateur u ON u.id = c.responsable_id
      WHERE c.id = $1;
    `;
    const chantierRes = await db.query(chantierQuery, [id]);

    if (chantierRes.rows.length === 0) {
      return res.status(404).json({ message: 'Chantier introuvable.' });
    }

    const chantier = chantierRes.rows[0];

    // 2. Fetch latest avancement & avancement history
    const avancementQuery = `
      SELECT 
        id,
        chantier_id,
        COALESCE(pourcentage, 0)::int AS pourcentage,
        TO_CHAR(date, 'YYYY-MM-DD') AS date,
        commentaire
      FROM public.avancement
      WHERE chantier_id = $1
      ORDER BY date DESC, id DESC;
    `;
    const avancementRes = await db.query(avancementQuery, [id]);
    const avancements = avancementRes.rows;
    const latestAvancement = avancements.length > 0 ? avancements[0] : null;

    // 3. Fetch related satellite images
    const imagesQuery = `
      SELECT 
        id,
        chantier_id,
        TO_CHAR(date_acquisition, 'YYYY-MM-DD') AS date_acquisition,
        source,
        type_image,
        url_fichier,
        resolution,
        cloud_coverage,
        indice_spectral
      FROM public.image_satellite
      WHERE chantier_id = $1
      ORDER BY date_acquisition DESC, id DESC;
    `;
    const imagesRes = await db.query(imagesQuery, [id]);
    const images = imagesRes.rows;

    // 4. Fetch reference alignment info if exists
    const refAlignQuery = `
      SELECT 
        id,
        nom,
        source,
        original_filename,
        direction_reversed,
        COALESCE(source_srid, 4326)::int AS source_srid,
        COALESCE(source_crs_name, 'WGS 84') AS source_crs_name,
        TO_CHAR(date_import, 'YYYY-MM-DD HH24:MI') AS date_import,
        ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geometry)::json AS geometry
      FROM public.reference_alignment
      WHERE chantier_id = $1
      ORDER BY id DESC
      LIMIT 1;
    `;
    const refAlignRes = await db.query(refAlignQuery, [id]);
    const referenceAlignment = refAlignRes.rows.length > 0 ? refAlignRes.rows[0] : null;

    // 5. Fetch PK range / Troncon data if populated in GIS tables
    let pk_debut = null;
    let pk_fin = null;
    let troncons = [];
    try {
      const tronconQuery = `
        SELECT 
          id,
          nom,
          pk_debut,
          pk_fin,
          COALESCE(statut, 'NON_COMMENCE') AS statut,
          COALESCE(avancement, 0)::int AS avancement,
          ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
          ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
          ST_AsGeoJSON(geometry)::json AS geometry,
          date_creation
        FROM public.troncon
        WHERE chantier_id = $1
        ORDER BY pk_debut ASC;
      `;
      const tronconRes = await db.query(tronconQuery, [id]);
      troncons = tronconRes.rows;

      if (troncons.length > 0) {
        pk_debut = troncons[0].pk_debut;
        pk_fin = troncons[troncons.length - 1].pk_fin;
      }
    } catch (e) {
      pk_debut = null;
      pk_fin = null;
    }

    // Determine GIS setup status
    let gis_status = 'NON_CONFIGURE'; // 'NON_CONFIGURE' | 'ALIGNEMENT_IMPORTE' | 'PRET_POUR_SUIVI'
    if (troncons.length > 0) {
      gis_status = 'PRET_POUR_SUIVI';
    } else if (referenceAlignment) {
      gis_status = 'ALIGNEMENT_IMPORTE';
    }

    const tronconsAvancement = troncons.length > 0
      ? Math.round(troncons.reduce((sum, t) => sum + (Number(t.avancement) || 0), 0) / troncons.length)
      : 0;

    return res.status(200).json({
      chantier: {
        ...chantier,
        avancement: tronconsAvancement,
        avancement_date: latestAvancement ? latestAvancement.date : null,
        avancement_commentaire: latestAvancement ? latestAvancement.commentaire : null,
        pk_debut,
        pk_fin,
        gis_status,
        reference_alignment: referenceAlignment,
        avancements,
        images,
        troncons,
      },
    });
  } catch (error) {
    console.error('❌ GetChantierDetails error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des détails du chantier.',
    });
  }
}

/**
 * POST /projects/:projectId/chantiers OR POST /chantiers
 * Creates a structural chantier belonging to a project.
 * Uses authenticated user ID as responsable_id.
 * Distinguishes calculated surface (from polygon geometry if provided) vs manual surface_reference.
 */
async function createChantier(req, res) {
  try {
    const projectId = req.params.projectId || req.body.projet_id;
    const { nom, surface_reference, surface, date_debut, date_fin_prevue, statut, localisation, d_max_position_meters } = req.body;
    const responsableId = req.user.id;

    if (!projectId) {
      return res.status(400).json({ message: 'Identifiant du projet (projet_id) requis.' });
    }
    if (!nom || !nom.trim()) {
      return res.status(400).json({ message: 'Le nom du chantier est obligatoire.' });
    }
    const dMax = d_max_position_meters === undefined ? 50 : Number(d_max_position_meters);
    if (!Number.isFinite(dMax) || dMax <= 0) {
      return res.status(400).json({ message: 'La distance maximale recommandée doit être un nombre strictement positif.' });
    }

    // Verify project exists
    const projCheck = await db.query('SELECT id, nom FROM public.projet WHERE id = $1', [projectId]);
    if (projCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Projet associé introuvable.' });
    }

    // If localisation polygon is passed, compute calculated surface via PostGIS ST_Area
    let calculatedSurface = null;
    let localisationGeom = null;
    if (localisation) {
      try {
        const parsedGeom = typeof localisation === 'string' ? JSON.parse(localisation) : localisation;
        if (parsedGeom.type === 'Polygon' || parsedGeom.type === 'MultiPolygon') {
          const areaRes = await db.query(
            `SELECT ROUND(ST_Area(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography)::numeric, 2) AS calc_surface`,
            [JSON.stringify(parsedGeom)]
          );
          if (areaRes.rows.length > 0 && areaRes.rows[0].calc_surface) {
            calculatedSurface = parseFloat(areaRes.rows[0].calc_surface);
          }
          localisationGeom = JSON.stringify(parsedGeom);
        }
      } catch (e) {
        console.warn('Could not parse localisation polygon for area calculation:', e.message);
      }
    }

    // Use surface_reference if explicitly given, or fallback to legacy surface field input
    const refSurface = surface_reference !== undefined ? (surface_reference ? parseFloat(surface_reference) : null) : (surface ? parseFloat(surface) : null);

    const insertQuery = `
      INSERT INTO public.chantier (
        projet_id, 
        responsable_id, 
        nom, 
        surface,
        surface_reference,
        localisation,
        date_creation, 
        date_debut, 
        date_fin_prevue, 
        statut,
        d_max_position_meters
      )
      VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::text IS NOT NULL THEN ST_SetSRID(ST_GeomFromGeoJSON($6), 4326) ELSE NULL END, NOW(), $7, $8, $9, $10)
      RETURNING 
        id, 
        projet_id, 
        responsable_id, 
        nom, 
        surface, 
        surface_reference,
        date_creation, 
        TO_CHAR(date_debut, 'YYYY-MM-DD') AS date_debut, 
        TO_CHAR(date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue, 
        statut,
        d_max_position_meters;
    `;

    const values = [
      projectId,
      responsableId,
      nom.trim(),
      calculatedSurface,
      refSurface,
      localisationGeom,
      date_debut || null,
      date_fin_prevue || null,
      statut || 'En attente',
      dMax,
    ];

    const result = await db.query(insertQuery, values);
    const createdChantier = result.rows[0];

    return res.status(201).json({
      message: 'Chantier créé avec succès.',
      chantier: createdChantier,
    });
  } catch (error) {
    console.error('❌ CreateChantier error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la création du chantier: ' + error.message,
    });
  }
}

async function updateChantierConfiguration(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;
    const dMax = Number(req.body.d_max_position_meters);
    if (!Number.isFinite(dMax) || dMax <= 0) {
      return res.status(400).json({ message: 'La distance maximale recommandée doit être un nombre strictement positif.' });
    }
    const result = await db.query(
      `UPDATE public.chantier
       SET d_max_position_meters = $1
       WHERE id = $2 AND (responsable_id = $3 OR $4 = true)
       RETURNING id, d_max_position_meters`,
      [dMax, id, userId, isAdmin]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'Chantier introuvable ou modification non autorisée.' });
    }
    return res.status(200).json({ message: 'Distance maximale recommandée mise à jour.', chantier: result.rows[0] });
  } catch (error) {
    console.error('❌ UpdateChantierConfiguration error:', error.message);
    return res.status(500).json({ message: 'Erreur lors de la mise à jour de la configuration du chantier.' });
  }
}

/**
 * Helper: Validates WGS 84 coordinate boundaries [-180, 180], [-90, 90]
 */
function validateCoordinatesRange(coords) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const lng = coords[0];
    const lat = coords[1];
    if (isNaN(lng) || isNaN(lat)) {
      throw new Error('Coordonnées géographiques non numériques détectées.');
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error(
        `Coordonnées hors limites WGS 84 (EPSG:4326) : [${lng}, ${lat}]. ` +
        `Veuillez exporter votre tracé en coordonnées géographiques WGS 84 standard (degrés décimaux).`
      );
    }
    return;
  }
  for (const item of coords) {
    validateCoordinatesRange(item);
  }
}

/**
 * Helper: Normalizes input AOI data (array of points, GeoJSON Feature, Polygon, or string)
 * into a canonical GeoJSON Polygon object with closed linear ring.
 */
function extractAoiPolygonGeometry(rawAoi) {
  if (!rawAoi) {
    throw new Error("La géométrie de la zone d'étude (AOI) est requise.");
  }

  let aoiData = rawAoi;
  if (typeof aoiData === 'string') {
    try {
      aoiData = JSON.parse(aoiData);
    } catch {
      throw new Error("Le corps de l'AOI n'est pas un JSON valide.");
    }
  }

  if (Array.isArray(aoiData)) {
    let coords = [...aoiData];
    if (coords.length >= 3) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
    }
    aoiData = {
      type: 'Polygon',
      coordinates: [coords],
    };
  } else if (aoiData.type === 'Feature' && aoiData.geometry) {
    aoiData = aoiData.geometry;
  }

  if (aoiData.type !== 'Polygon' && aoiData.type !== 'MultiPolygon') {
    throw new Error(`Type de géométrie AOI non supporté : ${aoiData.type}. Seul Polygon est accepté.`);
  }

  validateCoordinatesRange(aoiData.coordinates);
  return aoiData;
}

/**
 * Helper: Validates proposed AOI against sibling chantiers belonging to the same project.
 * Returns an array of conflicting chantiers where ST_Area(ST_Intersection(...)::geography) > 1.0 m².
 * Touching boundaries/edges/vertices (area <= 1 m²) are considered valid.
 */
async function findAoiConflicts(clientOrDb, chantierId, aoiGeoJson) {
  const conflictQuery = `
    WITH current_ch AS (
      SELECT projet_id FROM public.chantier WHERE id = $1
    ),
    raw_input AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS src_geom
    ),
    proposed_geom AS (
      SELECT CASE 
        WHEN ST_IsValid(src_geom) THEN src_geom
        ELSE ST_MakeValid(src_geom)
      END AS geom
      FROM raw_input
    ),
    sibling_chantiers AS (
      SELECT 
        c.id AS chantier_id,
        c.nom AS chantier_nom,
        c.localisation AS sibling_geom
      FROM public.chantier c
      JOIN current_ch curr ON c.projet_id = curr.projet_id
      WHERE c.id != $1
        AND c.localisation IS NOT NULL
    ),
    intersections AS (
      SELECT 
        s.chantier_id,
        s.chantier_nom,
        ST_Intersection(s.sibling_geom, p.geom) AS inter_geom
      FROM sibling_chantiers s
      CROSS JOIN proposed_geom p
      WHERE ST_Intersects(s.sibling_geom, p.geom)
    )
    SELECT 
      chantier_id,
      chantier_nom,
      ROUND(ST_Area(inter_geom::geography)::numeric, 2) AS overlap_area_m2
    FROM intersections
    WHERE ST_Area(inter_geom::geography) > 1.0
    ORDER BY overlap_area_m2 DESC;
  `;

  const result = await clientOrDb.query(conflictQuery, [chantierId, JSON.stringify(aoiGeoJson)]);
  return result.rows.map((row) => ({
    chantierId: row.chantier_id,
    chantierName: row.chantier_nom,
    overlapAreaM2: parseFloat(row.overlap_area_m2),
  }));
}

/**
 * POST /chantiers/:id/aoi/check-conflict
 * Pre-checks a proposed AOI polygon for positive area overlaps against sibling chantiers
 * belonging to the same project, without committing changes.
 */
async function checkChantierAoiConflict(req, res) {
  try {
    const { id } = req.params;
    const rawAoi = req.body.aoi || req.body.geometry || req.body.localisation;
    const aoiData = extractAoiPolygonGeometry(rawAoi);

    const conflicts = await findAoiConflicts(db, id, aoiData);
    const hasConflict = conflicts.length > 0;

    return res.status(200).json({
      conflict: hasConflict,
      conflicts,
      message: hasConflict
        ? `Conflit d'emprise spatiale détecté avec ${conflicts.length} chantier(s).`
        : "Aucun conflit d'emprise spatiale.",
    });
  } catch (error) {
    console.error('❌ CheckChantierAoiConflict error:', error.message);
    return res.status(400).json({
      message: "Erreur lors de la vérification du conflit d'AOI : " + error.message,
    });
  }
}

/**
 * GET /chantiers/:chantierId/sibling-aois
 * Returns existing sibling chantiers and their saved AOI geometries for visual reference on the map.
 */
async function getSiblingChantierAois(req, res) {
  try {
    const { chantierId } = req.params;
    const query = `
      SELECT 
        c.id,
        c.nom,
        ST_AsGeoJSON(c.localisation)::json AS geometry,
        ROUND(COALESCE(c.surface, 0)::numeric, 2) AS surface_m2
      FROM public.chantier c
      WHERE c.projet_id = (SELECT projet_id FROM public.chantier WHERE id = $1)
        AND c.id != $1
        AND c.localisation IS NOT NULL
      ORDER BY c.id ASC;
    `;
    const result = await db.query(query, [chantierId]);
    return res.status(200).json({
      chantiers: result.rows,
    });
  } catch (error) {
    console.error('❌ GetSiblingChantierAois error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des zones des chantiers voisins.',
    });
  }
}

/**
 * PUT /chantiers/:id/aoi
 * Saves the Area of Interest (AOI) polygon on public.chantier.localisation
 * and automatically calculates the surface in square meters via PostGIS ST_Area.
 * Strictly enforces that the AOI does not overlap with sibling chantiers (> 1 m²).
 */
async function saveChantierAoi(req, res) {
  try {
    const { id } = req.params;
    const rawAoi = req.body.aoi || req.body.geometry || req.body.localisation;
    const aoiData = extractAoiPolygonGeometry(rawAoi);

    // Enforce positive area overlap rule against sibling chantiers
    const conflicts = await findAoiConflicts(db, id, aoiData);
    if (conflicts.length > 0) {
      const first = conflicts[0];
      return res.status(409).json({
        conflict: true,
        conflicts,
        message: `Zone en conflit : Cette zone chevauche l'emprise du chantier "${first.chantierName}" (${first.overlapAreaM2} m² de chevauchement).`,
      });
    }

    const updateQuery = `
      WITH parsed AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) AS raw_geom
      ),
      valid_geom AS (
        SELECT 
          CASE 
            WHEN ST_IsValid(raw_geom) THEN raw_geom
            ELSE ST_MakeValid(raw_geom)
          END AS geom
        FROM parsed
      )
      UPDATE public.chantier
      SET localisation = (SELECT geom FROM valid_geom),
          surface = (SELECT ROUND(ST_Area(geom::geography)::numeric, 2) FROM valid_geom)
      WHERE id = $2
      RETURNING 
        id, 
        nom, 
        surface, 
        surface_reference, 
        statut,
        ST_AsGeoJSON(localisation)::json AS localisation,
        ROUND((surface / 10000.0)::numeric, 2) AS surface_hectares;
    `;

    const updateRes = await db.query(updateQuery, [JSON.stringify(aoiData), id]);
    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: 'Chantier introuvable.' });
    }

    return res.status(200).json({
      message: "Zone d'étude (AOI) enregistrée avec succès.",
      chantier: updateRes.rows[0],
    });
  } catch (error) {
    console.error('❌ SaveChantierAoi error:', error.message);
    return res.status(400).json({
      message: "Erreur lors de l'enregistrement de la zone d'étude : " + error.message,
    });
  }
}

/**
 * POST /chantiers/:chantierId/crs/detect
 * Automatically analyzes incoming spatial file data and detects the Source CRS / SRID.
 */
async function detectSourceCrs(req, res) {
  try {
    const { chantierId } = req.params;
    let geojsonData = null;

    if (req.file) {
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      try {
        geojsonData = JSON.parse(fileContent);
      } catch {
        return res.status(400).json({ message: "Le fichier téléchargé n'est pas un JSON valide." });
      }
    } else if (req.body && (req.body.geojson || req.body.geometry)) {
      geojsonData = req.body.geojson || req.body.geometry;
      if (typeof geojsonData === 'string') {
        try {
          geojsonData = JSON.parse(geojsonData);
        } catch {
          return res.status(400).json({ message: "Le corps GeoJSON n'est pas un JSON valide." });
        }
      }
    } else {
      return res.status(400).json({ message: 'Aucune donnée spatiale fournie pour la détection du CRS.' });
    }

    const passedAoi = req.body ? (req.body.aoi || req.body.aoi_geometry) : null;
    const explicitSrid = req.body.source_srid || req.body.srid;

    const detectionResult = await crsService.detectSourceCrs(geojsonData, {
      chantierId,
      aoiGeometry: passedAoi,
      explicitSrid,
    });

    return res.status(200).json({
      message: 'Détection du système de coordonnées effectuée.',
      ...detectionResult,
      supported_crs: crsService.SUPPORTED_CRS,
    });
  } catch (error) {
    console.error('❌ DetectSourceCrs error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la détection du CRS : ' + error.message,
    });
  }
}

/**
 * POST /chantiers/:chantierId/reference-alignment/analyze
 * Analyzes raw GeoJSON source data with automatic CRS detection,
 * transforms from source CRS to canonical WGS 84, cross-analyzes with Chantier AOI (if defined),
 * calculates intersection metrics, and returns candidate corridors ranked by relevance.
 */
async function analyzeGeoJSONSource(req, res) {
  try {
    const { chantierId } = req.params;
    let geojsonData = null;
    let originalFilename = 'source.geojson';
    let passedAoi = req.body ? (req.body.aoi || req.body.aoi_geometry) : null;

    if (req.file) {
      originalFilename = req.file.originalname || req.file.filename;
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      try {
        geojsonData = JSON.parse(fileContent);
      } catch (err) {
        return res.status(400).json({ message: 'Le fichier téléchargé n\'est pas un JSON valide.' });
      }
    } else if (req.body && (req.body.geojson || req.body.geometry)) {
      geojsonData = req.body.geojson || req.body.geometry;
      if (typeof geojsonData === 'string') {
        try {
          geojsonData = JSON.parse(geojsonData);
        } catch {
          return res.status(400).json({ message: 'Le corps GeoJSON n\'est pas un JSON valide.' });
        }
      }
      originalFilename = req.body.original_filename || 'source.geojson';
    } else {
      return res.status(400).json({ message: 'Aucun fichier GeoJSON ni géométrie fournie.' });
    }

    // 1. Automatic Multi-Criteria CRS Detection
    const requestedSrid = req.body.source_srid || req.body.srid;
    const crsInfo = await crsService.detectSourceCrs(geojsonData, {
      chantierId,
      aoiGeometry: passedAoi,
      explicitSrid: requestedSrid,
    });

    const sourceSrid = crsInfo.detected_srid || (requestedSrid ? parseInt(requestedSrid, 10) : 4326);

    // 2. Extract line features
    let lineFeatures = [];
    if (geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features)) {
      lineFeatures = geojsonData.features.filter(
        (f) => f && f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
      );
    } else if (geojsonData.type === 'Feature' && geojsonData.geometry) {
      if (geojsonData.geometry.type === 'LineString' || geojsonData.geometry.type === 'MultiLineString') {
        lineFeatures = [geojsonData];
      }
    } else if (geojsonData.type === 'LineString' || geojsonData.type === 'MultiLineString') {
      lineFeatures = [{ type: 'Feature', geometry: geojsonData, properties: {} }];
    }

    if (lineFeatures.length === 0) {
      return res.status(400).json({
        message: 'Le fichier GeoJSON ne contient aucune géométrie linéaire (LineString ou MultiLineString).',
      });
    }

    // 3. Process via PostGIS to transform from source CRS to WGS84, test ST_LineMerge and perform AOI spatial intersection
    const allLinesCoordinates = [];
    lineFeatures.forEach((feat) => {
      if (feat.geometry.type === 'LineString') {
        allLinesCoordinates.push(feat.geometry.coordinates);
      } else if (feat.geometry.type === 'MultiLineString') {
        allLinesCoordinates.push(...feat.geometry.coordinates);
      }
    });

    const multiGeomPayload = {
      type: 'MultiLineString',
      coordinates: allLinesCoordinates,
    };

    let aoiJsonParam = null;
    if (passedAoi) {
      if (Array.isArray(passedAoi)) {
        let coords = [...passedAoi];
        if (coords.length >= 3) {
          const first = coords[0];
          const last = coords[coords.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            coords.push([first[0], first[1]]);
          }
        }
        aoiJsonParam = JSON.stringify({ type: 'Polygon', coordinates: [coords] });
      } else if (typeof passedAoi === 'object') {
        aoiJsonParam = JSON.stringify(passedAoi.geometry || passedAoi);
      }
    }

    const analysisQuery = `
      WITH raw_input AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $4) AS src_geom
      ),
      parsed AS (
        SELECT CASE 
          WHEN $4 = 4326 THEN src_geom
          ELSE ST_Transform(src_geom, 4326)
        END AS raw_geom
        FROM raw_input
      ),
      merged AS (
        SELECT 
          raw_geom,
          ST_LineMerge(raw_geom) AS merged_geom,
          ST_Length(raw_geom::geography) AS total_len_m
        FROM parsed
      ),
      corridors AS (
        SELECT 
          (ST_Dump(merged_geom)).path[1] AS corridor_idx,
          (ST_Dump(merged_geom)).geom AS corridor_geom
        FROM merged
      ),
      aoi_source AS (
        SELECT CASE 
          WHEN $2::text IS NOT NULL AND $2::text != '' THEN ST_SetSRID(ST_GeomFromGeoJSON($2), 4326)
          ELSE (SELECT localisation FROM public.chantier WHERE id = $3)
        END AS aoi_geom
      )
      SELECT 
        (SELECT ST_GeometryType(merged_geom) FROM merged) AS merged_type,
        (SELECT ROUND(total_len_m::numeric / 1000.0, 3) FROM merged) AS total_network_km,
        (SELECT ROUND(total_len_m::numeric, 2) FROM merged) AS total_network_meters,
        (SELECT ST_AsGeoJSON(aoi_geom)::json FROM aoi_source) AS aoi_geometry,
        (SELECT ROUND(ST_Area(aoi_geom::geography)::numeric, 2) FROM aoi_source) AS aoi_surface_m2,
        (SELECT ROUND((ST_Area(aoi_geom::geography) / 10000.0)::numeric, 2) FROM aoi_source) AS aoi_surface_hectares,
        json_agg(
          json_build_object(
            'id', c.corridor_idx,
            'nom', 'Corridor ' || c.corridor_idx,
            'length_km', ROUND((ST_Length(c.corridor_geom::geography) / 1000.0)::numeric, 3),
            'length_meters', ROUND(ST_Length(c.corridor_geom::geography)::numeric, 2),
            'points_count', ST_NPoints(c.corridor_geom),
            'start_point', json_build_array(ST_X(ST_StartPoint(c.corridor_geom)), ST_Y(ST_StartPoint(c.corridor_geom))),
            'end_point', json_build_array(ST_X(ST_EndPoint(c.corridor_geom)), ST_Y(ST_EndPoint(c.corridor_geom))),
            'intersects_aoi', CASE 
              WHEN a.aoi_geom IS NOT NULL THEN ST_Intersects(c.corridor_geom, a.aoi_geom)
              ELSE false 
            END,
            'length_in_aoi_meters', CASE 
              WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(c.corridor_geom, a.aoi_geom) THEN 
                ROUND(ST_Length(ST_Intersection(c.corridor_geom, a.aoi_geom)::geography)::numeric, 2)
              ELSE 0 
            END,
            'length_in_aoi_km', CASE 
              WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(c.corridor_geom, a.aoi_geom) THEN 
                ROUND((ST_Length(ST_Intersection(c.corridor_geom, a.aoi_geom)::geography) / 1000.0)::numeric, 3)
              ELSE 0 
            END,
            'coverage_aoi_percent', CASE 
              WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(c.corridor_geom, a.aoi_geom) AND ST_Length(c.corridor_geom::geography) > 0 THEN 
                ROUND(((ST_Length(ST_Intersection(c.corridor_geom, a.aoi_geom)::geography) / ST_Length(c.corridor_geom::geography)) * 100.0)::numeric, 1)
              ELSE 0 
            END,
            'distance_to_aoi_meters', CASE 
              WHEN a.aoi_geom IS NOT NULL AND NOT ST_Intersects(c.corridor_geom, a.aoi_geom) THEN 
                ROUND(ST_Distance(c.corridor_geom::geography, a.aoi_geom::geography)::numeric, 2)
              ELSE 0 
            END,
            'geometry', ST_AsGeoJSON(c.corridor_geom)::json
          ) 
          ORDER BY 
            CASE WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(c.corridor_geom, a.aoi_geom) THEN 1 ELSE 0 END DESC,
            CASE WHEN a.aoi_geom IS NOT NULL THEN ST_Length(ST_Intersection(c.corridor_geom, a.aoi_geom)::geography) ELSE 0 END DESC,
            ST_Length(c.corridor_geom::geography) DESC
        ) AS candidate_corridors
      FROM corridors c
      CROSS JOIN aoi_source a;
    `;

    const analysisRes = await db.query(analysisQuery, [
      JSON.stringify(multiGeomPayload),
      aoiJsonParam,
      chantierId,
      sourceSrid,
    ]);
    const analysis = analysisRes.rows[0];

    const isSingleContinuous = analysis.merged_type === 'ST_LineString';
    let rawCorridors = analysis.candidate_corridors || [];
    const hasAoi = !!analysis.aoi_geometry;

    // Apply ranking and recommendation logic
    const candidateCorridors = rawCorridors.map((c, idx) => {
      let isRecommended = false;
      let recommendationReason = '';
      let status = 'DISPONIBLE';

      if (hasAoi) {
        if (c.intersects_aoi) {
          if (idx === 0) {
            isRecommended = true;
            status = 'RECOMMANDE';
            recommendationReason = `Alignement le plus pertinent au sein de la zone d'étude (${c.length_in_aoi_km} km dans l'AOI, ${c.coverage_aoi_percent}% de couverture)`;
          } else {
            status = 'PERTINENT';
            recommendationReason = `${c.length_in_aoi_km} km dans l'AOI (${c.coverage_aoi_percent}% couvert)`;
          }
        } else {
          status = 'HORS_ZONE';
          const distKm = (c.distance_to_aoi_meters / 1000.0).toFixed(2);
          recommendationReason = `Non-intersectant — situé à ~${distKm} km de la zone d'étude`;
        }
      } else {
        if (idx === 0) {
          isRecommended = true;
          status = 'RECOMMANDE';
          recommendationReason = `Corridor principal par longueur linéaire (${c.length_km} km)`;
        }
      }

      return {
        ...c,
        is_recommended: isRecommended,
        status,
        recommendation_reason: recommendationReason,
      };
    });

    return res.status(200).json({
      message: 'Source GeoJSON analysée avec succès.',
      original_filename: originalFilename,
      total_features: lineFeatures.length,
      is_single_continuous: isSingleContinuous,
      total_network_km: parseFloat(analysis.total_network_km) || 0,
      total_network_meters: parseFloat(analysis.total_network_meters) || 0,
      has_aoi: hasAoi,
      aoi_geometry: analysis.aoi_geometry,
      aoi_surface_m2: parseFloat(analysis.aoi_surface_m2) || 0,
      aoi_surface_hectares: parseFloat(analysis.aoi_surface_hectares) || 0,
      corridors_count: candidateCorridors.length,
      candidate_corridors: candidateCorridors,
      selected_alignment_geometry: candidateCorridors.length > 0 ? candidateCorridors[0].geometry : null,
      selected_alignment_length_km: candidateCorridors.length > 0 ? candidateCorridors[0].length_km : null,
      crs_info: crsInfo,
      source_srid: sourceSrid,
    });
  } catch (error) {
    console.error('❌ AnalyzeGeoJSONSource error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de l\'analyse de la source GeoJSON : ' + error.message,
    });
  }
}

/**
 * POST /chantiers/:chantierId/reference-alignment
 * Transforms the selected alignment geometry to canonical WGS 84 (if from a projected CRS),
 * strictly validates that it forms ONE continuous LineString,
 * and persists the reference_alignment record with CRS audit metadata.
 */
async function uploadReferenceAlignment(req, res) {
  try {
    const { chantierId } = req.params;
    let geojsonData = null;
    let originalFilename = 'reference_alignment.geojson';

    // 1. Check if uploaded via Multer or body
    if (req.file) {
      originalFilename = req.file.originalname || req.file.filename;
      const fileContent = fs.readFileSync(req.file.path, 'utf8');
      try {
        geojsonData = JSON.parse(fileContent);
      } catch (err) {
        return res.status(400).json({ message: 'Le fichier téléchargé n\'est pas un JSON valide.' });
      }
    } else if (req.body && (req.body.geojson || req.body.geometry)) {
      geojsonData = req.body.geojson || req.body.geometry;
      if (typeof geojsonData === 'string') {
        try {
          geojsonData = JSON.parse(geojsonData);
        } catch {
          return res.status(400).json({ message: 'Le corps GeoJSON n\'est pas un JSON valide.' });
        }
      }
      originalFilename = req.body.original_filename || 'reference_alignment.geojson';
    } else {
      return res.status(400).json({ message: 'Aucune donnée d\'alignement fournie.' });
    }

    // Verify chantier exists
    const chantierRes = await db.query('SELECT id, nom FROM public.chantier WHERE id = $1', [chantierId]);
    if (chantierRes.rows.length === 0) {
      return res.status(404).json({ message: 'Chantier introuvable.' });
    }
    const chantier = chantierRes.rows[0];

    // Normalize input to geometry object
    let targetGeom = geojsonData;
    if (geojsonData.type === 'Feature' && geojsonData.geometry) {
      targetGeom = geojsonData.geometry;
    } else if (geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features) && geojsonData.features.length === 1) {
      targetGeom = geojsonData.features[0].geometry;
    }

    // Determine Source CRS (explicit or auto-detected)
    let sourceSrid = req.body.source_srid ? parseInt(req.body.source_srid, 10) : null;
    let sourceCrsName = req.body.source_crs_name || null;

    if (!sourceSrid) {
      const crsDetection = await crsService.detectSourceCrs(targetGeom, { chantierId });
      sourceSrid = crsDetection.detected_srid || 4326;
      sourceCrsName = crsDetection.crs_name;
    }

    if (!sourceCrsName) {
      const crsDef = crsService.getCrsBySrid(sourceSrid);
      sourceCrsName = crsDef ? crsDef.name : `EPSG:${sourceSrid}`;
    }

    const alignmentName = req.body.nom || `Alignement Référence - ${chantier.nom}`;
    const source = req.body.source || 'GeoJSON';

    // 2. PostGIS validation query: transform to WGS84, clip to Chantier AOI (Zone d'étude) if present, and validate continuous ST_LineString
    const validateAndInsertQuery = `
      WITH raw_input AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), $2) AS src_geom
      ),
      parsed AS (
        SELECT CASE 
          WHEN $2 = 4326 THEN src_geom
          ELSE ST_Transform(src_geom, 4326)
        END AS raw_geom
        FROM raw_input
      ),
      aoi_src AS (
        SELECT localisation AS aoi_geom FROM public.chantier WHERE id = $3
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
        ST_NumGeometries(geom) AS num_geoms,
        ROUND(ST_Length(geom::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geom::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geom)::json AS geometry
      FROM merged;
    `;

    const checkRes = await db.query(validateAndInsertQuery, [JSON.stringify(targetGeom), sourceSrid, chantierId]);
    if (checkRes.rows.length === 0) {
      return res.status(400).json({ message: 'Validation géométrique impossible sur les données fournies.' });
    }

    const checked = checkRes.rows[0];

    // Check if result is strictly a single LineString
    if (checked.geom_type !== 'ST_LineString') {
      return res.status(400).json({
        message:
          'Le tracé sélectionné contient plusieurs branches ou segments non connectés. ' +
          'Veuillez sélectionner un alignement de référence continu unique pour permettre le chaînage linéaire.',
      });
    }

    if (!checked.length_meters || parseFloat(checked.length_meters) <= 0) {
      return res.status(400).json({
        message: 'L\'alignement de référence doit avoir une longueur supérieure à 0 mètre.',
      });
    }

    // 3. Insert validated canonical LineString (EPSG:4326) into public.reference_alignment with CRS audit metadata
    const insertQuery = `
      INSERT INTO public.reference_alignment (
        chantier_id,
        nom,
        source,
        original_filename,
        geometry,
        direction_reversed,
        source_srid,
        source_crs_name,
        date_import
      )
      VALUES (
        $1, $2, $3, $4,
        ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
        false,
        $6,
        $7,
        NOW()
      )
      RETURNING 
        id,
        chantier_id,
        nom,
        source,
        original_filename,
        direction_reversed,
        source_srid,
        source_crs_name,
        TO_CHAR(date_import, 'YYYY-MM-DD HH24:MI:SS') AS date_import,
        ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_X(ST_StartPoint(geometry)) AS start_lng,
        ST_Y(ST_StartPoint(geometry)) AS start_lat,
        ST_X(ST_EndPoint(geometry)) AS end_lng,
        ST_Y(ST_EndPoint(geometry)) AS end_lat;
    `;

    const insertRes = await db.query(insertQuery, [
      chantierId,
      alignmentName,
      source,
      originalFilename,
      JSON.stringify(checked.geometry),
      sourceSrid,
      sourceCrsName,
    ]);

    const savedAlignment = insertRes.rows[0];

    return res.status(201).json({
      message: 'Alignement de référence validé, transformé et enregistré avec succès.',
      reference_alignment: savedAlignment,
    });
  } catch (error) {
    console.error('❌ UploadReferenceAlignment error:', error.message);
    return res.status(400).json({
      message: 'Erreur lors de la validation de l\'alignement : ' + error.message,
    });
  }
}

/**
 * GET /chantiers/:chantierId/reference-alignment
 * Retrieves the latest reference alignment for a chantier.
 */
async function getReferenceAlignment(req, res) {
  try {
    const { chantierId } = req.params;

    const query = `
      SELECT 
        id,
        chantier_id,
        nom,
        source,
        original_filename,
        direction_reversed,
        COALESCE(source_srid, 4326)::int AS source_srid,
        COALESCE(source_crs_name, 'WGS 84') AS source_crs_name,
        TO_CHAR(date_import, 'YYYY-MM-DD HH24:MI:SS') AS date_import,
        ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_X(ST_StartPoint(geometry)) AS start_lng,
        ST_Y(ST_StartPoint(geometry)) AS start_lat,
        ST_X(ST_EndPoint(geometry)) AS end_lng,
        ST_Y(ST_EndPoint(geometry)) AS end_lat
      FROM public.reference_alignment
      WHERE chantier_id = $1
      ORDER BY id DESC
      LIMIT 1;
    `;

    const result = await db.query(query, [chantierId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Aucun alignement de référence trouvé pour ce chantier.' });
    }

    return res.status(200).json({
      reference_alignment: result.rows[0],
    });
  } catch (error) {
    console.error('❌ GetReferenceAlignment error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération de l\'alignement de référence.',
    });
  }
}

/**
 * PUT /chantiers/:chantierId/reference-alignment/direction
 * Inverts the geometry vertex order using ST_Reverse in PostGIS,
 * and toggles the direction_reversed flag so PK 0+000 starts from the opposite end.
 */
async function toggleAlignmentDirection(req, res) {
  try {
    const { chantierId } = req.params;

    const updateRes = await db.query(
      `UPDATE public.reference_alignment
       SET geometry = ST_Reverse(geometry),
           direction_reversed = NOT COALESCE(direction_reversed, false)
       WHERE chantier_id = $1
       RETURNING 
         id,
         chantier_id,
         nom,
         source,
         original_filename,
         direction_reversed,
         TO_CHAR(date_import, 'YYYY-MM-DD HH24:MI:SS') AS date_import,
         ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
         ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
         ST_AsGeoJSON(geometry)::json AS geometry,
         ST_X(ST_StartPoint(geometry)) AS start_lng,
         ST_Y(ST_StartPoint(geometry)) AS start_lat,
         ST_X(ST_EndPoint(geometry)) AS end_lng,
         ST_Y(ST_EndPoint(geometry)) AS end_lat;`,
      [chantierId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: 'Alignement introuvable pour ce chantier.' });
    }

    return res.status(200).json({
      message: 'Direction de l\'alignement inversée spatialement avec succès (PK 0+000 réorienté).',
      reference_alignment: updateRes.rows[0],
    });
  } catch (error) {
    console.error('❌ ToggleAlignmentDirection error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors du changement de direction de l\'alignement.',
    });
  }
}

/**
 * POST /chantiers/:chantierId/troncons/generate
 * Calculates linear segmentation along the portion of reference_alignment inside the AOI (Zone d'Étude).
 * Uses the appropriate Projected Metric CRS (Measurement CRS) for exact metric LRS chainage and segmentation,
 * while outputting canonical WGS 84 (EPSG:4326) geometries for map display.
 * Supports count OR target_length_km.
 * Does NOT persist to DB; returns calculated tronçons preview with geometries and PKs.
 */
async function generateTronconsPreview(req, res) {
  try {
    const { chantierId } = req.params;
    let count = req.body.count ? parseInt(req.body.count, 10) : null;
    const targetLengthKm = req.body.target_length_km ? parseFloat(req.body.target_length_km) : null;

    // 1. Fetch latest reference alignment and chantier AOI
    const refRes = await db.query(
      `SELECT r.id, r.nom, r.direction_reversed, r.geometry,
              c.localisation AS aoi_geometry,
              r.source_srid, r.source_crs_name,
              ST_AsGeoJSON(r.geometry)::json AS geometry_json,
              ST_AsGeoJSON(c.localisation)::json AS aoi_geometry_json
       FROM public.reference_alignment r
       JOIN public.chantier c ON c.id = r.chantier_id
       WHERE r.chantier_id = $1
       ORDER BY r.id DESC LIMIT 1`,
      [chantierId]
    );

    if (refRes.rows.length === 0) {
      return res.status(400).json({ message: 'Aucun alignement de référence n\'est configuré pour ce chantier.' });
    }

    const refAlignment = refRes.rows[0];

    // 2. Determine Measurement CRS (Projected Metric)
    const measCrs = crsService.getMeasurementCrs(refAlignment.geometry_json || refAlignment.geometry);
    const measSrid = measCrs.srid;

    // 3. Obtain total projected length in Measurement CRS
    const totalLenRes = await db.query(
      `SELECT 
        ROUND(ST_Length(ST_Transform(geometry, $2::int))::numeric, 2) AS length_meas_meters,
        ROUND((ST_Length(ST_Transform(geometry, $2::int)) / 1000.0)::numeric, 4) AS length_meas_km
       FROM public.reference_alignment
       WHERE id = $1`,
      [refAlignment.id, measSrid]
    );

    const totalLengthMeters = parseFloat(totalLenRes.rows[0].length_meas_meters);
    const totalLengthKm = parseFloat(totalLenRes.rows[0].length_meas_km);

    // 4. AOI Intersection & Sub-interval calculation in Measurement CRS
    let startFrac = 0.0;
    let endFrac = 1.0;
    let aoiConstrained = false;
    let aoiLengthKm = totalLengthKm;
    let aoiLengthMeters = totalLengthMeters;
    let aoiPkStart = 0.0;
    let aoiPkEnd = totalLengthKm;

    if (refAlignment.aoi_geometry) {
      const aoiIntersectRes = await db.query(
        `WITH proj AS (
          SELECT 
            ST_Transform(r.geometry, $3::int) AS r_proj,
            ST_Transform(c.localisation, $3::int) AS c_proj
          FROM public.reference_alignment r, public.chantier c
          WHERE r.id = $1 AND c.id = $2
        ),
        intersected AS (
          SELECT 
            ST_LineMerge(ST_CollectionExtract(ST_Intersection(r_proj, c_proj), 2)) AS aoi_line_proj,
            r_proj
          FROM proj
        )
        SELECT 
          ST_GeometryType(aoi_line_proj) AS geom_type,
          ROUND(ST_Length(aoi_line_proj)::numeric, 2) AS aoi_len_m,
          ROUND((ST_Length(aoi_line_proj) / 1000.0)::numeric, 4) AS aoi_len_km,
          ST_LineLocatePoint(r_proj, ST_StartPoint(aoi_line_proj)) AS raw_start_frac,
          ST_LineLocatePoint(r_proj, ST_EndPoint(aoi_line_proj)) AS raw_end_frac
        FROM intersected;`,
        [refAlignment.id, chantierId, measSrid]
      );

      if (aoiIntersectRes.rows.length > 0 && aoiIntersectRes.rows[0].aoi_len_m > 5) {
        const row = aoiIntersectRes.rows[0];
        const sF = parseFloat(row.raw_start_frac);
        const eF = parseFloat(row.raw_end_frac);

        const fMin = Math.max(0.0, Math.min(sF, eF));
        const fMax = Math.min(1.0, Math.max(sF, eF));

        if (fMax - fMin > 0.0001) {
          startFrac = fMin;
          endFrac = fMax;
          aoiConstrained = true;
          aoiLengthKm = Number(((fMax - fMin) * totalLengthKm).toFixed(3));
          aoiLengthMeters = Number((aoiLengthKm * 1000.0).toFixed(2));
          aoiPkStart = Number((fMin * totalLengthKm).toFixed(3));
          aoiPkEnd = Number((fMax * totalLengthKm).toFixed(3));
        }
      } else {
        return res.status(400).json({
          message: 'Aucun tracé de l\'axe de référence ne se trouve dans la zone d\'étude (AOI) définie. Veuillez modifier le polygone AOI.',
        });
      }
    }

    // Determine count from target_length_km if requested
    const targetSegmentableLength = aoiConstrained ? aoiLengthKm : totalLengthKm;
    if (!count && targetLengthKm && targetLengthKm > 0) {
      count = Math.max(1, Math.round(targetSegmentableLength / targetLengthKm));
    }
    if (!count || isNaN(count) || count < 1 || count > 50) {
      count = 4;
    }

    // 5. Generate segments in Measurement CRS and transform back to EPSG:4326 for display
    const segmentsQuery = `
      WITH ref AS (
        SELECT ST_Transform(geometry, $5::int) AS geom_proj 
        FROM public.reference_alignment 
        WHERE id = $1
      ),
      fractions AS (
        SELECT 
          s.i AS step,
          ($2::float + (s.i::float / $4::float) * ($3::float - $2::float)) AS start_frac,
          ($2::float + ((s.i + 1)::float / $4::float) * ($3::float - $2::float)) AS end_frac
        FROM generate_series(0, $4 - 1) AS s(i)
      )
      SELECT 
        f.step + 1 AS num,
        f.start_frac,
        f.end_frac,
        ST_AsGeoJSON(ST_Transform(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac), 4326))::json AS geometry,
        ROUND(ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac))::numeric, 2) AS length_meters,
        ROUND((ST_Length(ST_LineSubstring(ref.geom_proj, f.start_frac, f.end_frac)) / 1000.0)::numeric, 3) AS length_km
      FROM fractions f, ref;
    `;

    const segmentsRes = await db.query(segmentsQuery, [refAlignment.id, startFrac, endFrac, count, measSrid]);
    const rows = segmentsRes.rows;

    let cumulativePk = aoiPkStart;
    const troncons = rows.map((r, idx) => {
      const segLengthKm = parseFloat(r.length_km);
      const pkDebut = cumulativePk;
      const pkFin = idx === rows.length - 1 ? aoiPkEnd : cumulativePk + segLengthKm;
      cumulativePk = pkFin;

      return {
        step: r.num,
        reference_alignment_id: refAlignment.id,
        nom: `Tronçon ${r.num}`,
        pk_debut: Number(pkDebut.toFixed(3)),
        pk_fin: Number(pkFin.toFixed(3)),
        length_meters: parseFloat(r.length_meters),
        length_km: Number((pkFin - pkDebut).toFixed(3)),
        statut: 'NON_COMMENCE',
        avancement: 0,
        geometry: r.geometry,
      };
    });

    return res.status(200).json({
      reference_alignment_id: refAlignment.id,
      direction_reversed: !!refAlignment.direction_reversed,
      measurement_srid: measSrid,
      measurement_crs_name: measCrs.name,
      total_length_meters: totalLengthMeters,
      total_length_km: totalLengthKm,
      aoi_constrained: aoiConstrained,
      aoi_pk_start: aoiPkStart,
      aoi_pk_end: aoiPkEnd,
      aoi_length_km: aoiLengthKm,
      aoi_length_meters: aoiLengthMeters,
      count: troncons.length,
      average_length_km: Number((aoiLengthKm / count).toFixed(3)),
      troncons,
    });
  } catch (error) {
    console.error('❌ GenerateTronconsPreview error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la génération des tronçons: ' + error.message,
    });
  }
}

/**
 * POST /chantiers/:chantierId/troncons/recalculate-chainage
 * Linear Referencing System (LRS) dynamic recalculation & propagation.
 * Recalculates all subsequent PKs and uses PostGIS ST_LineSubstring in the appropriate Measurement CRS
 * to regenerate exact metric spatial sub-geometries transformed back to EPSG:4326.
 */
async function recalculateTronconsChainage(req, res) {
  try {
    const { chantierId } = req.params;
    const {
      troncons,
      modified_index,
      new_pk_debut,
      new_pk_fin,
      reference_alignment_id,
    } = req.body;

    if (!Array.isArray(troncons) || troncons.length === 0) {
      return res.status(400).json({ message: 'La liste des tronçons est requise.' });
    }

    // 1. Fetch reference alignment
    let refQuery = `
      SELECT id, nom, direction_reversed, geometry,
             source_srid, source_crs_name,
             ST_AsGeoJSON(geometry)::json AS geometry_json
      FROM public.reference_alignment
      WHERE chantier_id = $1
    `;
    const params = [chantierId];
    if (reference_alignment_id) {
      refQuery += ` AND id = $2`;
      params.push(reference_alignment_id);
    }
    refQuery += ` ORDER BY id DESC LIMIT 1`;

    const refRes = await db.query(refQuery, params);
    if (refRes.rows.length === 0) {
      return res.status(404).json({ message: 'Alignement de référence introuvable.' });
    }

    const refAlignment = refRes.rows[0];

    // Determine Measurement CRS
    const measCrs = crsService.getMeasurementCrs(refAlignment.geometry_json || refAlignment.geometry);
    const measSrid = measCrs.srid;

    // Obtain total length in Measurement CRS
    const lenRes = await db.query(
      `SELECT 
        ROUND(ST_Length(ST_Transform(geometry, $2::int))::numeric, 2) AS length_meas_meters,
        ROUND((ST_Length(ST_Transform(geometry, $2::int)) / 1000.0)::numeric, 4) AS length_meas_km
       FROM public.reference_alignment
       WHERE id = $1`,
      [refAlignment.id, measSrid]
    );

    const totalLengthKm = parseFloat(lenRes.rows[0].length_meas_km);
    const totalLengthMeters = parseFloat(lenRes.rows[0].length_meas_meters);

    // 2. Perform sequential LRS propagation on PK intervals
    const N = troncons.length;
    const updatedBounds = troncons.map((t, idx) => {
      return {
        nom: t.nom || `Tronçon ${idx + 1}`,
        pk_debut: parseFloat(t.pk_debut),
        pk_fin: parseFloat(t.pk_fin),
        prev_length: parseFloat(t.length_km) || (parseFloat(t.pk_fin) - parseFloat(t.pk_debut)) || 0,
        statut: t.statut || 'NON_COMMENCE',
        avancement: t.avancement || 0,
      };
    });

    const modIdx = typeof modified_index === 'number' ? modified_index : -1;

    if (modIdx >= 0 && modIdx < N) {
      const targetDebut = typeof new_pk_debut === 'number' ? new_pk_debut : updatedBounds[modIdx].pk_debut;
      const targetFin = typeof new_pk_fin === 'number' ? new_pk_fin : updatedBounds[modIdx].pk_fin;

      if (targetFin <= targetDebut) {
        return res.status(400).json({
          message: `Le PK fin (${targetFin} km) doit être strictement supérieur au PK début (${targetDebut} km).`,
        });
      }

      // Update modified troncon
      updatedBounds[modIdx].pk_debut = targetDebut;
      updatedBounds[modIdx].pk_fin = targetFin;

      // Propagate forward to all subsequent tronçons
      let currentAnchor = targetFin;
      for (let i = modIdx + 1; i < N; i++) {
        const segLength = updatedBounds[i].prev_length > 0 ? updatedBounds[i].prev_length : 1.0;
        updatedBounds[i].pk_debut = Number(currentAnchor.toFixed(3));
        const nextFin = currentAnchor + segLength;
        updatedBounds[i].pk_fin = Number(nextFin.toFixed(3));
        currentAnchor = updatedBounds[i].pk_fin;
      }
    } else {
      // General normalization & continuity check across all troncons
      let currentAnchor = updatedBounds[0].pk_debut || 0.0;
      for (let i = 0; i < N; i++) {
        updatedBounds[i].pk_debut = Number(currentAnchor.toFixed(3));
        if (updatedBounds[i].pk_fin <= updatedBounds[i].pk_debut) {
          updatedBounds[i].pk_fin = Number((currentAnchor + (updatedBounds[i].prev_length || 1.0)).toFixed(3));
        }
        currentAnchor = updatedBounds[i].pk_fin;
      }
    }

    // 3. Vectorized PostGIS Query to extract sub-geometries via ST_LineSubstring in Measurement CRS
    const calculations = [];
    for (let i = 0; i < N; i++) {
      const b = updatedBounds[i];
      const startFrac = Math.max(0.0, Math.min(1.0, b.pk_debut / totalLengthKm));
      const endFrac = Math.max(0.0, Math.min(1.0, b.pk_fin / totalLengthKm));

      calculations.push({
        idx: i,
        nom: b.nom,
        pk_debut: b.pk_debut,
        pk_fin: b.pk_fin,
        start_frac: startFrac,
        end_frac: endFrac,
        statut: b.statut,
        avancement: b.avancement,
      });
    }

    // PostGIS query with UNNEST in Measurement CRS, returning WGS84 GeoJSON
    const postgisQuery = `
      WITH ref AS (
        SELECT ST_Transform(geometry, $10::int) AS geom_proj 
        FROM public.reference_alignment 
        WHERE id = $1
      ),
      inputs AS (
        SELECT 
          unnest($2::int[]) AS idx,
          unnest($3::text[]) AS nom,
          unnest($4::numeric[]) AS pk_debut,
          unnest($5::numeric[]) AS pk_fin,
          unnest($6::float[]) AS start_frac,
          unnest($7::float[]) AS end_frac,
          unnest($8::text[]) AS statut,
          unnest($9::int[]) AS avancement
      )
      SELECT 
        i.idx,
        i.nom,
        i.pk_debut::float AS pk_debut,
        i.pk_fin::float AS pk_fin,
        ST_AsGeoJSON(
          ST_Transform(
            CASE 
              WHEN i.start_frac >= i.end_frac THEN ST_LineSubstring(ref.geom_proj, i.start_frac, LEAST(1.0, i.start_frac + 0.001))
              ELSE ST_LineSubstring(ref.geom_proj, i.start_frac, i.end_frac)
            END,
            4326
          )
        )::json AS geometry,
        ROUND(
          ST_Length(
            CASE 
              WHEN i.start_frac >= i.end_frac THEN ST_LineSubstring(ref.geom_proj, i.start_frac, LEAST(1.0, i.start_frac + 0.001))
              ELSE ST_LineSubstring(ref.geom_proj, i.start_frac, i.end_frac)
            END
          )::numeric, 2
        )::float AS length_meters,
        ROUND(
          (ST_Length(
            CASE 
              WHEN i.start_frac >= i.end_frac THEN ST_LineSubstring(ref.geom_proj, i.start_frac, LEAST(1.0, i.start_frac + 0.001))
              ELSE ST_LineSubstring(ref.geom_proj, i.start_frac, i.end_frac)
            END
          ) / 1000.0)::numeric, 3
        )::float AS length_km,
        i.statut,
        i.avancement
      FROM inputs i, ref
      ORDER BY i.idx ASC;
    `;

    const pgRes = await db.query(postgisQuery, [
      refAlignment.id,
      calculations.map((c) => c.idx),
      calculations.map((c) => c.nom),
      calculations.map((c) => c.pk_debut),
      calculations.map((c) => c.pk_fin),
      calculations.map((c) => c.start_frac),
      calculations.map((c) => c.end_frac),
      calculations.map((c) => c.statut),
      calculations.map((c) => c.avancement),
      measSrid,
    ]);

    const recalculatedTroncons = pgRes.rows.map((r, i) => ({
      step: i + 1,
      reference_alignment_id: refAlignment.id,
      nom: r.nom,
      pk_debut: Number(r.pk_debut.toFixed(3)),
      pk_fin: Number(r.pk_fin.toFixed(3)),
      length_meters: r.length_meters,
      length_km: Number((r.pk_fin - r.pk_debut).toFixed(3)),
      statut: r.statut,
      avancement: r.avancement,
      geometry: r.geometry,
    }));

    return res.status(200).json({
      message: 'Chaînage et géométries spatiales recalculés avec succès.',
      reference_alignment_id: refAlignment.id,
      measurement_srid: measSrid,
      measurement_crs_name: measCrs.name,
      total_length_km: totalLengthKm,
      total_length_meters: totalLengthMeters,
      troncons: recalculatedTroncons,
    });
  } catch (error) {
    console.error('❌ RecalculateTronconsChainage error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors du recalcul spatial du chaînage: ' + error.message,
    });
  }
}

/**
 * POST /chantiers/:chantierId/troncons
 * Validates and saves generated / edited troncons to public.troncon in a single transaction.
 */
async function saveTroncons(req, res) {
  const client = await db.pool.connect();
  try {
    const { chantierId } = req.params;
    const { troncons, reference_alignment_id } = req.body;

    if (!Array.isArray(troncons) || troncons.length === 0) {
      return res.status(400).json({ message: 'La liste des tronçons est requise.' });
    }

    // Verify chantier
    const chantierRes = await client.query('SELECT id FROM public.chantier WHERE id = $1', [chantierId]);
    if (chantierRes.rows.length === 0) {
      return res.status(404).json({ message: 'Chantier introuvable.' });
    }

    // Determine reference_alignment_id
    let refId = reference_alignment_id || troncons[0].reference_alignment_id;
    if (!refId) {
      const activeRef = await client.query(
        'SELECT id FROM public.reference_alignment WHERE chantier_id = $1 ORDER BY id DESC LIMIT 1',
        [chantierId]
      );
      if (activeRef.rows.length === 0) {
        return res.status(400).json({ message: 'Alignement de référence introuvable pour ce chantier.' });
      }
      refId = activeRef.rows[0].id;
    }

    // Begin database transaction
    await client.query('BEGIN');

    // 1. Delete previous tronçons for this chantier to avoid stale duplicates
    await client.query('DELETE FROM public.troncon WHERE chantier_id = $1', [chantierId]);

    // 2. Validate and insert each troncon
    const insertedTroncons = [];
    for (let i = 0; i < troncons.length; i++) {
      const t = troncons[i];
      const nom = t.nom ? t.nom.trim() : `Tronçon ${i + 1}`;
      const pkDebut = parseFloat(t.pk_debut);
      const pkFin = parseFloat(t.pk_fin);
      const statut = t.statut || 'NON_COMMENCE';
      const avancement = t.avancement !== undefined ? parseInt(t.avancement, 10) : 0;

      if (isNaN(pkDebut) || isNaN(pkFin) || pkDebut >= pkFin) {
        throw new Error(`Le tronçon "${nom}" a des bornes PK invalides (PK début: ${t.pk_debut}, PK fin: ${t.pk_fin}).`);
      }

      if (!t.geometry) {
        throw new Error(`La géométrie du tronçon "${nom}" est manquante.`);
      }

      const geomJson = typeof t.geometry === 'string' ? t.geometry : JSON.stringify(t.geometry);

      const insertRes = await client.query(
        `INSERT INTO public.troncon (
          chantier_id,
          reference_alignment_id,
          nom,
          pk_debut,
          pk_fin,
          statut,
          avancement,
          geometry,
          date_creation
        )
        SELECT
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          CASE
            WHEN ST_LineLocatePoint(ra.geometry, ST_StartPoint(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)))
               <= ST_LineLocatePoint(ra.geometry, ST_EndPoint(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)))
            THEN ST_SetSRID(ST_GeomFromGeoJSON($8), 4326)
            ELSE ST_Reverse(ST_SetSRID(ST_GeomFromGeoJSON($8), 4326))
          END,
          NOW()
        FROM public.reference_alignment ra
        WHERE ra.id = $2
        RETURNING 
          id, 
          chantier_id, 
          reference_alignment_id, 
          nom, 
          pk_debut, 
          pk_fin, 
          statut,
          avancement,
          ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters, 
          ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km, 
          ST_AsGeoJSON(geometry)::json AS geometry, 
          date_creation;`,
        [chantierId, refId, nom, pkDebut, pkFin, statut, avancement, geomJson]
      );

      insertedTroncons.push(insertRes.rows[0]);
    }

    // Commit transaction
    await client.query('COMMIT');

    return res.status(201).json({
      message: `${insertedTroncons.length} tronçons enregistrés avec succès. Le chantier est prêt pour le suivi terrain.`,
      troncons: insertedTroncons,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ SaveTroncons error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de l\'enregistrement des tronçons: ' + error.message,
    });
  } finally {
    client.release();
  }
}

/**
 * GET /chantiers/:chantierId/troncons
 * Retrieves all troncons for a chantier ordered by PK début.
 */
async function getChantierTroncons(req, res) {
  try {
    const { chantierId } = req.params;

    const query = `
      SELECT 
        id,
        chantier_id,
        reference_alignment_id,
        nom,
        pk_debut,
        pk_fin,
        COALESCE(statut, 'NON_COMMENCE') AS statut,
        COALESCE(avancement, 0)::int AS avancement,
        ROUND(ST_Length(geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        date_creation
      FROM public.troncon
      WHERE chantier_id = $1
      ORDER BY pk_debut ASC;
    `;

    const result = await db.query(query, [chantierId]);

    return res.status(200).json({
      troncons: result.rows,
    });
  } catch (error) {
    console.error('❌ GetChantierTroncons error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des tronçons.',
    });
  }
}

module.exports = {
  getChantierDetails,
  createChantier,
  updateChantierConfiguration,
  saveChantierAoi,
  checkChantierAoiConflict,
  getSiblingChantierAois,
  detectSourceCrs,
  analyzeGeoJSONSource,
  uploadReferenceAlignment,
  getReferenceAlignment,
  toggleAlignmentDirection,
  generateTronconsPreview,
  recalculateTronconsChainage,
  saveTroncons,
  getChantierTroncons,
};
