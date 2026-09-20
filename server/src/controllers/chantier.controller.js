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
        ROUND(ST_Length(COALESCE(original_geometry, geometry)::geography)::numeric, 2) AS original_length_meters,
        ROUND((ST_Length(COALESCE(original_geometry, geometry)::geography) / 1000.0)::numeric, 3) AS original_length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_AsGeoJSON(COALESCE(original_geometry, geometry))::json AS original_geometry
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
          t.id,
          t.nom,
          t.pk_debut,
          t.pk_fin,
          COALESCE(t.statut, 'NON_COMMENCE') AS statut,
          COALESCE(t.avancement, 0)::int AS avancement,
          ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS length_meters,
          ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
          ROUND(COALESCE(t.authoritative_progress_meters, 0)::numeric, 2) AS authoritative_progress_meters,
          ST_AsGeoJSON(t.geometry)::json AS geometry,
          t.date_creation,
          u.id AS agent_id,
          u.nom AS agent_nom,
          u.prenom AS agent_prenom,
          NULLIF(TRIM(CONCAT(u.prenom, ' ', u.nom)), '') AS agent_nom_complet,
          u.photo_url AS agent_photo_url
        FROM public.troncon t
        LEFT JOIN LATERAL (
          SELECT u2.id, u2.nom, u2.prenom, u2.photo_url
          FROM public.affectation_troncon a
          JOIN public.utilisateur u2 ON u2.id = a.agent_id
          WHERE a.troncon_id = t.id AND a.statut = 'ACTIF'
          ORDER BY a.date_affectation DESC, a.id DESC
          LIMIT 1
        ) u ON true
        WHERE t.chantier_id = $1
        ORDER BY t.pk_debut ASC;
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

    // 2. PostGIS validation query: transform to WGS84, preserve unclipped original geometry,
    // clip to Chantier AOI (Zone d'étude) if present, and validate continuous ST_LineString
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
      orig_merged AS (
        SELECT 
          CASE 
            WHEN ST_GeometryType(raw_geom) = 'ST_MultiLineString' THEN (
              SELECT d.geom 
              FROM ST_Dump(raw_geom) d 
              ORDER BY ST_Length(d.geom::geography) DESC 
              LIMIT 1
            )
            ELSE raw_geom
          END AS orig_geom
        FROM parsed
      ),
      aoi_src AS (
        SELECT localisation AS aoi_geom FROM public.chantier WHERE id = $3
      ),
      clipped AS (
        SELECT 
          CASE 
            WHEN a.aoi_geom IS NOT NULL AND ST_Intersects(o.orig_geom, a.aoi_geom) THEN
              ST_LineMerge(ST_CollectionExtract(ST_Intersection(o.orig_geom, a.aoi_geom), 2))
            ELSE o.orig_geom
          END AS geom
        FROM orig_merged o
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
        ST_GeometryType(m.geom) AS geom_type,
        ST_NumGeometries(m.geom) AS num_geoms,
        ROUND(ST_Length(m.geom::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(m.geom::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(m.geom)::json AS geometry,
        ST_GeometryType(o.orig_geom) AS orig_geom_type,
        ROUND(ST_Length(o.orig_geom::geography)::numeric, 2) AS original_length_meters,
        ROUND((ST_Length(o.orig_geom::geography) / 1000.0)::numeric, 3) AS original_length_km,
        ST_AsGeoJSON(o.orig_geom)::json AS original_geometry
      FROM merged m
      CROSS JOIN orig_merged o;
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
    // Preserves BOTH the original imported geometry (unclipped) and the AOI-clipped geometry
    const insertQuery = `
      INSERT INTO public.reference_alignment (
        chantier_id,
        nom,
        source,
        original_filename,
        geometry,
        original_geometry,
        direction_reversed,
        source_srid,
        source_crs_name,
        date_import
      )
      VALUES (
        $1, $2, $3, $4,
        ST_SetSRID(ST_GeomFromGeoJSON($5), 4326),
        ST_SetSRID(ST_GeomFromGeoJSON($6), 4326),
        false,
        $7,
        $8,
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
        ROUND(ST_Length(COALESCE(original_geometry, geometry)::geography)::numeric, 2) AS original_length_meters,
        ROUND((ST_Length(COALESCE(original_geometry, geometry)::geography) / 1000.0)::numeric, 3) AS original_length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_AsGeoJSON(COALESCE(original_geometry, geometry))::json AS original_geometry,
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
      JSON.stringify(checked.original_geometry),
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
        ROUND(ST_Length(COALESCE(original_geometry, geometry)::geography)::numeric, 2) AS original_length_meters,
        ROUND((ST_Length(COALESCE(original_geometry, geometry)::geography) / 1000.0)::numeric, 3) AS original_length_km,
        ST_AsGeoJSON(geometry)::json AS geometry,
        ST_AsGeoJSON(COALESCE(original_geometry, geometry))::json AS original_geometry,
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
           original_geometry = CASE 
             WHEN original_geometry IS NOT NULL THEN ST_Reverse(original_geometry) 
             ELSE NULL 
           END,
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
         ROUND(ST_Length(COALESCE(original_geometry, geometry)::geography)::numeric, 2) AS original_length_meters,
         ROUND((ST_Length(COALESCE(original_geometry, geometry)::geography) / 1000.0)::numeric, 3) AS original_length_km,
         ST_AsGeoJSON(geometry)::json AS geometry,
         ST_AsGeoJSON(COALESCE(original_geometry, geometry))::json AS original_geometry,
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
        t.id,
        t.chantier_id,
        t.reference_alignment_id,
        t.nom,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS statut,
        COALESCE(t.avancement, 0)::int AS avancement,
        ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS length_meters,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        ST_AsGeoJSON(t.geometry)::json AS geometry,
        t.date_creation,
        u.id AS agent_id,
        u.nom AS agent_nom,
        u.prenom AS agent_prenom,
        NULLIF(TRIM(CONCAT(u.prenom, ' ', u.nom)), '') AS agent_nom_complet,
        u.photo_url AS agent_photo_url
      FROM public.troncon t
      LEFT JOIN LATERAL (
        SELECT u2.id, u2.nom, u2.prenom, u2.photo_url
        FROM public.affectation_troncon a
        JOIN public.utilisateur u2 ON u2.id = a.agent_id
        WHERE a.troncon_id = t.id AND a.statut = 'ACTIF'
        ORDER BY a.date_affectation DESC, a.id DESC
        LIMIT 1
      ) u ON true
      WHERE t.chantier_id = $1
      ORDER BY t.pk_debut ASC;
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

/**
 * Helper to format a date to French format e.g. "31 août 2026"
 */
function formatFrenchDate(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * GET /chantiers/:id/avancement
 * Returns consolidated avancement statistics, equal-angle segmented tronçon breakdown,
 * operational statistics, daily consolidated timeline (Model A), and field observation feed.
 * Strictly enforces Responsable ownership / Admin privileges.
 */
async function getChantierAvancementStats(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const isAdmin = req.user?.role_nom === 'Administrateur' || req.user?.role_id === 1;

    // 1. Enforce Responsable ownership / Admin scope
    const chantierRes = await db.query(`
      SELECT 
        c.id,
        c.projet_id,
        c.responsable_id,
        c.nom,
        c.statut,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation
      FROM public.chantier c
      WHERE c.id = $1 AND (c.responsable_id = $2 OR $3 = true);
    `, [id, userId, isAdmin]);

    if (chantierRes.rows.length === 0) {
      const existsCheck = await db.query('SELECT id FROM public.chantier WHERE id = $1', [id]);
      if (existsCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Chantier introuvable.' });
      }
      return res.status(403).json({ message: "Accès interdit : vous n'êtes pas le responsable de ce chantier." });
    }

    const chantier = chantierRes.rows[0];

    // 2. Fetch tronçons with bounded physical métrage and active assignments
    const tronconQuery = `
      SELECT 
        t.id,
        t.nom,
        'T' || ROW_NUMBER() OVER (ORDER BY t.pk_debut ASC, t.id ASC) AS code,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS statut,
        COALESCE(t.avancement, 0)::int AS avancement,
        ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS planned_meters,
        ROUND(LEAST(COALESCE(t.authoritative_progress_meters, 0), ST_Length(t.geometry::geography))::numeric, 2) AS completed_meters,
        ROUND(GREATEST(ST_Length(t.geometry::geography) - LEAST(COALESCE(t.authoritative_progress_meters, 0), ST_Length(t.geometry::geography)), 0)::numeric, 2) AS remaining_meters,
        ROUND((ST_Length(t.geometry::geography) / 1000.0)::numeric, 3) AS length_km,
        u.id AS agent_id,
        NULLIF(TRIM(CONCAT(u.prenom, ' ', u.nom)), '') AS agent_nom_complet,
        u.photo_url AS agent_photo_url,
        COALESCE(obs_meta.observations_count, 0)::int AS observations_count,
        obs_meta.latest_observation_date
      FROM public.troncon t
      LEFT JOIN LATERAL (
        SELECT u2.id, u2.nom, u2.prenom, u2.photo_url
        FROM public.affectation_troncon a
        JOIN public.utilisateur u2 ON u2.id = a.agent_id
        WHERE a.troncon_id = t.id AND a.statut = 'ACTIF'
        ORDER BY a.date_affectation DESC, a.id DESC
        LIMIT 1
      ) u ON true
      LEFT JOIN LATERAL (
        SELECT 
          COUNT(*)::int AS observations_count,
          TO_CHAR(MAX(date_heure), 'YYYY-MM-DD HH24:MI') AS latest_observation_date
        FROM public.observation_terrain
        WHERE troncon_id = t.id
      ) obs_meta ON true
      WHERE t.chantier_id = $1
      ORDER BY t.pk_debut ASC, t.id ASC;
    `;
    const tronconsRes = await db.query(tronconQuery, [id]);
    const troncons = tronconsRes.rows.map(t => ({
      ...t,
      avancement: Number(t.avancement) || 0,
      planned_meters: Number(t.planned_meters) || 0,
      completed_meters: Number(t.completed_meters) || 0,
      remaining_meters: Number(t.remaining_meters) || 0,
      length_km: Number(t.length_km) || 0,
      observations_count: Number(t.observations_count) || 0,
    }));

    // 3. Compute Chantier aggregate physical métrage and arithmetic average avancement
    const N = troncons.length;
    const total_planned_meters = Math.round(troncons.reduce((acc, t) => acc + t.planned_meters, 0) * 100) / 100;
    const total_completed_meters = Math.round(troncons.reduce((acc, t) => acc + t.completed_meters, 0) * 100) / 100;
    const total_remaining_meters = Math.round(Math.max(total_planned_meters - total_completed_meters, 0) * 100) / 100;
    const avancement = N > 0 ? Math.round(troncons.reduce((acc, t) => acc + t.avancement, 0) / N) : 0;

    // 4. Fetch operational statistics
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT DATE(date_heure))::int AS jours_avec_releves,
        MAX(date_heure) AS dernier_releve_date,
        COUNT(*)::int AS nombre_total_observations
      FROM public.observation_terrain
      WHERE chantier_id = $1;
    `;
    const statsRes = await db.query(statsQuery, [id]);
    const rawStats = statsRes.rows[0] || {};
    const stats = {
      jours_avec_releves: Number(rawStats.jours_avec_releves) || 0,
      dernier_releve_date: rawStats.dernier_releve_date ? new Date(rawStats.dernier_releve_date).toISOString() : null,
      dernier_releve_label: rawStats.dernier_releve_date ? formatFrenchDate(rawStats.dernier_releve_date) : 'Aucun relevé',
      nombre_total_observations: Number(rawStats.nombre_total_observations) || 0,
      total_planned_meters,
      total_completed_meters,
      total_remaining_meters,
    };

    // 5. Build daily consolidated timeline (Model A)
    const distinctDatesQuery = `
      SELECT 
        DATE(date_heure) AS obs_date,
        TO_CHAR(DATE(date_heure), 'YYYY-MM-DD') AS date_str,
        COUNT(*)::int AS obs_count
      FROM public.observation_terrain
      WHERE chantier_id = $1
      GROUP BY DATE(date_heure)
      ORDER BY obs_date ASC;
    `;
    const distinctDatesRes = await db.query(distinctDatesQuery, [id]);
    const timeline = [];

    if (distinctDatesRes.rows.length > 0 && N > 0) {
      const firstObsDateStr = distinctDatesRes.rows[0].date_str;

      // Synthetic 0% baseline if date_debut is strictly before first observation
      if (chantier.date_debut && chantier.date_debut < firstObsDateStr) {
        const dObj = new Date(chantier.date_debut);
        const dayOfMonth = String(dObj.getDate()).padStart(2, '0');
        const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        const monthLabel = months[dObj.getMonth()];
        timeline.push({
          date: chantier.date_debut,
          dayOfMonth,
          monthLabel,
          fullLabel: `${dayOfMonth} ${monthLabel} ${dObj.getFullYear()} (Démarrage)`,
          avancement: 0,
          observations_count: 0,
          is_synthetic_baseline: true,
        });
      }

      // Query daily latest observation per tronçon up to each observation date
      const dailySnapshotQuery = `
        WITH daily_latest_obs AS (
          SELECT DISTINCT ON (d.obs_date, o.troncon_id)
            d.obs_date,
            o.troncon_id,
            ROUND(COALESCE(o.authoritative_progress_percentage, o.progress_percentage, 0)::numeric)::int AS progress_percentage
          FROM (
            SELECT DISTINCT DATE(date_heure) AS obs_date
            FROM public.observation_terrain
            WHERE chantier_id = $1
          ) d
          JOIN public.observation_terrain o 
            ON o.chantier_id = $1 
           AND o.date_heure <= (d.obs_date + time '23:59:59')
          ORDER BY d.obs_date, o.troncon_id, o.date_heure DESC, o.id DESC
        )
        SELECT 
          obs_date,
          TO_CHAR(obs_date, 'YYYY-MM-DD') AS date_str,
          ROUND(SUM(progress_percentage)::numeric / $2)::int AS consolidated_avancement
        FROM daily_latest_obs
        GROUP BY obs_date
        ORDER BY obs_date ASC;
      `;
      const dailySnapshotRes = await db.query(dailySnapshotQuery, [id, N]);

      const dateCountsMap = {};
      distinctDatesRes.rows.forEach(r => {
        dateCountsMap[r.date_str] = Number(r.obs_count) || 0;
      });

      const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
      for (const row of dailySnapshotRes.rows) {
        const dObj = new Date(row.date_str);
        const dayOfMonth = String(dObj.getDate()).padStart(2, '0');
        const monthLabel = months[dObj.getMonth()];
        timeline.push({
          date: row.date_str,
          dayOfMonth,
          monthLabel,
          fullLabel: `${dayOfMonth} ${monthLabel} ${dObj.getFullYear()}`,
          avancement: Number(row.consolidated_avancement) || 0,
          observations_count: dateCountsMap[row.date_str] || 0,
          is_synthetic_baseline: false,
        });
      }
    }

    // 6. Fetch chronological field observations feed
    const obsQuery = `
      SELECT 
        o.id,
        o.troncon_id,
        t.nom AS troncon_nom,
        'T' || t_rank.code_num AS troncon_code,
        NULLIF(TRIM(CONCAT(u.prenom, ' ', u.nom)), '') AS agent_nom,
        TO_CHAR(o.date_heure, 'YYYY-MM-DD HH24:MI') AS date_heure,
        o.chainage,
        COALESCE(o.progress_percentage, 0)::int AS progress_percentage,
        o.phase,
        o.phase_statut,
        o.commentaire,
        o.agent_lat,
        o.agent_lng,
        o.projected_lat,
        o.projected_lng,
        o.distance_from_start,
        COALESCE(photos.list, '[]'::json) AS photos
      FROM public.observation_terrain o
      JOIN public.troncon t ON t.id = o.troncon_id
      LEFT JOIN public.utilisateur u ON u.id = o.agent_id
      LEFT JOIN (
        SELECT id, ROW_NUMBER() OVER (ORDER BY pk_debut ASC, id ASC) AS code_num
        FROM public.troncon 
        WHERE chantier_id = $1
      ) t_rank ON t_rank.id = t.id
      LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('id', p.id, 'url', p.fichier, 'description', p.description)) AS list
        FROM public.photo_terrain p 
        WHERE p.observation_id = o.id
      ) photos ON true
      WHERE o.chantier_id = $1
      ORDER BY o.date_heure DESC, o.id DESC;
    `;
    const obsRes = await db.query(obsQuery, [id]);
    const observations = obsRes.rows.map(o => ({
      ...o,
      progress_percentage: Number(o.progress_percentage) || 0,
      agent_lat: o.agent_lat != null ? Number(o.agent_lat) : null,
      agent_lng: o.agent_lng != null ? Number(o.agent_lng) : null,
      projected_lat: o.projected_lat != null ? Number(o.projected_lat) : null,
      projected_lng: o.projected_lng != null ? Number(o.projected_lng) : null,
      distance_from_start: o.distance_from_start != null ? Number(o.distance_from_start) : null,
      photos: Array.isArray(o.photos) ? o.photos : [],
    }));

    return res.status(200).json({
      chantier: {
        id: chantier.id,
        nom: chantier.nom,
        statut: chantier.statut,
        date_debut: chantier.date_debut,
        date_fin_prevue: chantier.date_fin_prevue,
        date_creation: chantier.date_creation,
        avancement,
      },
      troncons,
      stats,
      historique: {
        timeline,
        observations,
      },
    });
  } catch (error) {
    console.error('❌ GetChantierAvancementStats error:', error.message);
    return res.status(500).json({
      message: "Erreur lors de la récupération des statistiques d'avancement du chantier.",
    });
  }
}

/**
 * GET /chantiers/:id/journal
 * Returns continuous operational journal for a given month:
 * - Daily calendar grid with categorized status (ACTIVITE, ACTIVITE_PARTIELLE, NON_TRAVAILLE, ABSENCE, CHANTIER_ARRETE, INACTIVITE_A_VERIFIER)
 * - Carried forward authoritative progress per tronçon (flat plateaus, never artificial 0% drop)
 * - Detailed tronçon-level breakdown for every single day
 * - Demandes d'explication and declared agent absences
 * - Monthly operational summary metrics
 */
async function getChantierJournal(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const isAdmin = req.user?.role_nom === 'Administrateur' || req.user?.role_id === 1;

    // 1. Authorize: Responsable of chantier or Admin
    const chantierRes = await db.query(`
      SELECT 
        c.id,
        c.projet_id,
        c.responsable_id,
        c.nom,
        c.statut,
        TO_CHAR(c.date_debut, 'YYYY-MM-DD') AS date_debut,
        TO_CHAR(c.date_fin_prevue, 'YYYY-MM-DD') AS date_fin_prevue,
        c.date_creation
      FROM public.chantier c
      WHERE c.id = $1 AND (c.responsable_id = $2 OR $3 = true);
    `, [id, userId, isAdmin]);

    if (chantierRes.rows.length === 0) {
      const existsCheck = await db.query('SELECT id, nom, responsable_id FROM public.chantier WHERE id = $1', [id]);
      if (existsCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Chantier introuvable.' });
      }
      return res.status(403).json({ message: "Accès interdit : vous n'êtes pas le responsable de ce chantier." });
    }
    const chantier = chantierRes.rows[0];

    // 2. Determine month date range
    const now = new Date();
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const rawMonth = req.query.month || req.query.mois || '';
    const monthParam = /^\d{4}-\d{2}$/.test(String(rawMonth)) ? String(rawMonth) : defaultMonth;
    const [year, monthNum] = monthParam.split('-').map(Number);
    const lastDayOfMonth = new Date(year, monthNum, 0).getDate();

    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // 3. Fetch tronçons with active assignments
    const tronconQuery = `
      SELECT 
        t.id,
        t.nom,
        'T' || ROW_NUMBER() OVER (ORDER BY t.pk_debut ASC, t.id ASC) AS code,
        t.pk_debut,
        t.pk_fin,
        COALESCE(t.statut, 'NON_COMMENCE') AS statut,
        COALESCE(t.avancement, 0)::int AS avancement,
        ROUND(ST_Length(t.geometry::geography)::numeric, 2) AS planned_meters,
        ROUND(LEAST(COALESCE(t.authoritative_progress_meters, 0), ST_Length(t.geometry::geography))::numeric, 2) AS completed_meters,
        u.id AS agent_id,
        NULLIF(TRIM(CONCAT(u.prenom, ' ', u.nom)), '') AS agent_nom_complet,
        u.photo_url AS agent_photo_url
      FROM public.troncon t
      LEFT JOIN LATERAL (
        SELECT u2.id, u2.nom, u2.prenom, u2.photo_url
        FROM public.affectation_troncon a
        JOIN public.utilisateur u2 ON u2.id = a.agent_id
        WHERE a.troncon_id = t.id AND a.statut = 'ACTIF'
        ORDER BY a.date_affectation DESC, a.id DESC
        LIMIT 1
      ) u ON true
      WHERE t.chantier_id = $1
      ORDER BY t.pk_debut ASC, t.id ASC;
    `;
    const tronconsRes = await db.query(tronconQuery, [id]);
    const troncons = tronconsRes.rows.map(t => ({
      ...t,
      avancement: Number(t.avancement) || 0,
      planned_meters: Number(t.planned_meters) || 0,
      completed_meters: Number(t.completed_meters) || 0,
    }));
    const N = troncons.length;
    const agentIds = Array.from(new Set(troncons.map(t => t.agent_id).filter(Boolean)));

    // 4. Chantier calendar configuration (default: Mon-Sat = [1,2,3,4,5,6])
    const calRes = await db.query(
      'SELECT jours_travailles FROM public.chantier_calendrier WHERE chantier_id = $1',
      [id]
    );
    const joursTravailles = calRes.rows.length > 0 && Array.isArray(calRes.rows[0].jours_travailles)
      ? calRes.rows[0].jours_travailles
      : [1, 2, 3, 4, 5, 6];

    // 5. Public holidays
    const ferieRes = await db.query(`
      SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date_str, nom, est_chome
      FROM public.jour_ferie
      WHERE (chantier_id IS NULL OR chantier_id = $1)
        AND date >= $2::date AND date <= $3::date;
    `, [id, startDate, endDate]);
    const holidaysMap = {};
    ferieRes.rows.forEach(r => {
      holidaysMap[r.date_str] = r;
    });

    // 6. Declared Agent Absences
    let absences = [];
    if (agentIds.length > 0) {
      const absRes = await db.query(`
        SELECT 
          a.id,
          a.agent_id,
          TO_CHAR(a.date_debut, 'YYYY-MM-DD') AS date_debut,
          TO_CHAR(a.date_fin, 'YYYY-MM-DD') AS date_fin,
          a.motif,
          a.statut,
          TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom
        FROM public.agent_absence a
        JOIN public.utilisateur u ON u.id = a.agent_id
        WHERE a.agent_id = ANY($1::int[])
          AND a.statut IN ('VALIDE', 'EN_ATTENTE')
          AND a.date_debut <= $3::date AND a.date_fin >= $2::date;
      `, [agentIds, startDate, endDate]);
      absences = absRes.rows;
    }

    // 7. Demandes d'explication
    const demandesRes = await db.query(`
      SELECT 
        d.id,
        d.troncon_id,
        d.agent_id,
        d.responsable_id,
        TO_CHAR(d.date_concernee, 'YYYY-MM-DD') AS date_concernee,
        d.statut,
        d.message_responsable,
        d.motif_agent,
        d.reponse_agent,
        TO_CHAR(d.date_demande, 'YYYY-MM-DD HH24:MI') AS date_demande,
        TO_CHAR(d.date_reponse, 'YYYY-MM-DD HH24:MI') AS date_reponse,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
        TRIM(CONCAT(r.prenom, ' ', r.nom)) AS responsable_nom
      FROM public.demande_explication d
      LEFT JOIN public.utilisateur u ON u.id = d.agent_id
      LEFT JOIN public.utilisateur r ON r.id = d.responsable_id
      WHERE d.chantier_id = $1
        AND d.date_concernee >= $2::date AND d.date_concernee <= $3::date;
    `, [id, startDate, endDate]);
    const demandesMap = {};
    demandesRes.rows.forEach(d => {
      demandesMap[`${d.troncon_id}_${d.date_concernee}`] = d;
    });

    // 8. Field Observations recorded in this month
    const obsRes = await db.query(`
      SELECT 
        o.id,
        o.troncon_id,
        o.agent_id,
        TO_CHAR(o.date_heure, 'YYYY-MM-DD') AS date_str,
        TO_CHAR(o.date_heure, 'HH24:MI') AS heure_str,
        COALESCE(o.progress_percentage, 0)::int AS progress_percentage,
        COALESCE(o.authoritative_progress_percentage, o.progress_percentage, 0)::int AS authoritative_progress_percentage,
        o.chainage,
        o.phase,
        o.phase_statut,
        o.commentaire,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom,
        COALESCE(photos.cnt, 0)::int AS photo_count
      FROM public.observation_terrain o
      LEFT JOIN public.utilisateur u ON u.id = o.agent_id
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS cnt FROM public.photo_terrain p WHERE p.observation_id = o.id
      ) photos ON true
      WHERE o.chantier_id = $1
        AND o.date_heure >= ($2::date + time '00:00:00')
        AND o.date_heure <= ($3::date + time '23:59:59')
      ORDER BY o.date_heure ASC, o.id ASC;
    `, [id, startDate, endDate]);
    const monthObservations = obsRes.rows;

    // 9. Cumulative latest authoritative progress per tronçon across all days of the month
    const dailySnapshotQuery = `
      WITH daily_latest_obs AS (
        SELECT DISTINCT ON (d.obs_date, o.troncon_id)
          d.obs_date,
          o.troncon_id,
          ROUND(COALESCE(o.authoritative_progress_percentage, o.progress_percentage, 0)::numeric)::int AS progress_percentage
        FROM (
          SELECT d::date AS obs_date
          FROM generate_series($2::date, $3::date, '1 day'::interval) d
        ) d
        JOIN public.observation_terrain o 
          ON o.chantier_id = $1 
         AND o.date_heure <= (d.obs_date + time '23:59:59')
        ORDER BY d.obs_date, o.troncon_id, o.date_heure DESC, o.id DESC
      )
      SELECT 
        TO_CHAR(obs_date, 'YYYY-MM-DD') AS date_str,
        troncon_id,
        progress_percentage
      FROM daily_latest_obs;
    `;
    const dailySnapshotRes = await db.query(dailySnapshotQuery, [id, startDate, endDate]);
    const latestProgressMap = {};
    dailySnapshotRes.rows.forEach(r => {
      if (!latestProgressMap[r.date_str]) latestProgressMap[r.date_str] = {};
      latestProgressMap[r.date_str][r.troncon_id] = Number(r.progress_percentage) || 0;
    });

    // 10. Generate continuous calendar days
    const frenchDayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    const days = [];

    let totalJoursCalendrier = 0;
    let joursTravaillesPasses = 0;
    let joursAvecActivite = 0;
    let joursSansReleve = 0;
    let joursFeriesChomes = 0;
    let joursAbsenceAgent = 0;
    let demandesEnAttente = 0;

    for (let d = 1; d <= lastDayOfMonth; d++) {
      totalJoursCalendrier++;
      const dObj = new Date(year, monthNum - 1, d);
      const dateStr = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const jsDay = dObj.getDay(); // 0 = Sunday, 1 = Mon ... 6 = Sat
      const isoDay = jsDay === 0 ? 7 : jsDay;
      const dayLabel = frenchDayNames[jsDay];
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      const isPriorToStart = chantier.date_debut && dateStr < chantier.date_debut;

      const isCalendarWorkingDay = joursTravailles.includes(isoDay);
      const ferie = holidaysMap[dateStr] || null;
      const isFerieChome = ferie && ferie.est_chome;
      const isNonTravaille = !isCalendarWorkingDay || Boolean(isFerieChome);
      if (isFerieChome || (!isCalendarWorkingDay && !isFuture)) {
        joursFeriesChomes++;
      }

      const isChantierArrete = chantier.statut === 'SUSPENDU' || chantier.statut === 'ARRETE';
      const dayObs = monthObservations.filter(o => o.date_str === dateStr);
      const totalDayObsCount = dayObs.length;

      let hasAnyReleve = false;
      let allAssignedHaveReleve = troncons.length > 0;
      let hasAnyAbsence = false;
      let countTronconsSansReleve = 0;

      const dayTroncons = troncons.map(t => {
        const tObs = dayObs.filter(o => o.troncon_id === t.id);
        const authProg = (latestProgressMap[dateStr] && latestProgressMap[dateStr][t.id]) || 0;

        let statut = 'SANS_RELEVE';
        let statut_label = 'Sans relevé';
        let absence_info = null;
        let demande_info = null;

        if (tObs.length > 0) {
          statut = 'RELEVE';
          statut_label = `Relevé (${tObs.length})`;
          hasAnyReleve = true;
        } else if (isFuture) {
          statut = 'A_VENIR';
          statut_label = 'À venir';
          allAssignedHaveReleve = false;
        } else if (isNonTravaille) {
          statut = 'NON_TRAVAILLE';
          statut_label = ferie ? ferie.nom : 'Jour non travaillé';
          allAssignedHaveReleve = false;
        } else if (isChantierArrete) {
          statut = 'CHANTIER_ARRETE';
          statut_label = 'Chantier arrêté / suspendu';
          allAssignedHaveReleve = false;
        } else {
          // Check if assigned agent has declared absence
          const agentAbs = absences.find(a => a.agent_id === t.agent_id && dateStr >= a.date_debut && dateStr <= a.date_fin);
          if (agentAbs) {
            statut = 'ABSENCE_AGENT';
            statut_label = `Absence (${agentAbs.motif})`;
            absence_info = agentAbs;
            hasAnyAbsence = true;
            allAssignedHaveReleve = false;
          } else {
            statut = 'SANS_RELEVE';
            statut_label = 'Sans relevé';
            allAssignedHaveReleve = false;
            countTronconsSansReleve++;
            demande_info = demandesMap[`${t.id}_${dateStr}`] || null;
            if (demande_info && demande_info.statut === 'EN_ATTENTE') {
              demandesEnAttente++;
            }
          }
        }

        return {
          troncon_id: t.id,
          nom: t.nom,
          code: t.code,
          statut,
          statut_label,
          avancement: authProg,
          planned_meters: t.planned_meters,
          agent_id: t.agent_id,
          agent_nom: t.agent_nom_complet,
          agent_photo_url: t.agent_photo_url,
          observations_count: tObs.length,
          derniere_heure: tObs.length > 0 ? tObs[tObs.length - 1].heure_str : null,
          max_progression_jour: tObs.length > 0 ? Math.max(...tObs.map(o => o.progress_percentage)) : null,
          absence_info,
          demande_explication: demande_info,
          observations: tObs,
        };
      });

      // Day Consolidated Classification
      let dayStatus = 'INACTIVITE_A_VERIFIER';
      let dayStatusLabel = 'Inactivité à vérifier';

      if (isFuture) {
        dayStatus = 'A_VENIR';
        dayStatusLabel = 'À venir';
      } else if (isNonTravaille) {
        dayStatus = 'NON_TRAVAILLE';
        dayStatusLabel = ferie ? ferie.nom : 'Non travaillé';
      } else if (isChantierArrete) {
        dayStatus = 'CHANTIER_ARRETE';
        dayStatusLabel = 'Chantier arrêté';
      } else if (hasAnyReleve) {
        if (allAssignedHaveReleve) {
          dayStatus = 'ACTIVITE';
          dayStatusLabel = 'Activité complète';
        } else {
          dayStatus = 'ACTIVITE_PARTIELLE';
          dayStatusLabel = 'Activité partielle';
        }
      } else if (hasAnyAbsence && countTronconsSansReleve === 0) {
        dayStatus = 'ABSENCE';
        dayStatusLabel = 'Absence A.T.';
      } else {
        dayStatus = 'INACTIVITE_A_VERIFIER';
        dayStatusLabel = 'Inactivité à vérifier';
      }

      // Consolidated progress for date D (average of carried-forward progress over N tronçons)
      const consolidatedProgress = N > 0 
        ? Math.round(dayTroncons.reduce((sum, tr) => sum + tr.avancement, 0) / N)
        : 0;

      // Update counters for passed working days
      if (!isFuture && !isNonTravaille && !isChantierArrete) {
        joursTravaillesPasses++;
        if (hasAnyReleve) {
          joursAvecActivite++;
        } else if (dayStatus === 'ABSENCE') {
          joursAbsenceAgent++;
        } else {
          joursSansReleve++;
        }
      }

      days.push({
        date: dateStr,
        day_of_month: d,
        day_of_week: isoDay,
        day_label: dayLabel,
        is_today: isToday,
        is_future: isFuture,
        is_prior_to_start: Boolean(isPriorToStart),
        is_non_travaille: isNonTravaille,
        is_ferie: Boolean(isFerieChome),
        ferie_nom: ferie ? ferie.nom : null,
        statut_jour: dayStatus,
        statut_jour_label: dayStatusLabel,
        consolidated_progress: consolidatedProgress,
        observations_count: totalDayObsCount,
        troncons: dayTroncons,
      });
    }

    return res.status(200).json({
      chantier: {
        id: chantier.id,
        nom: chantier.nom,
        statut: chantier.statut,
        date_debut: chantier.date_debut,
        date_fin_prevue: chantier.date_fin_prevue,
      },
      month: monthParam,
      troncons_count: N,
      summary: {
        total_jours_calendrier: totalJoursCalendrier,
        jours_travailles_passes: joursTravaillesPasses,
        jours_avec_activite: joursAvecActivite,
        jours_sans_releve: joursSansReleve,
        jours_feries_chomes: joursFeriesChomes,
        jours_absence_agent: joursAbsenceAgent,
        demandes_en_attente: demandesEnAttente,
      },
      days,
    });
  } catch (error) {
    console.error('❌ GetChantierJournal error:', error.message);
    return res.status(500).json({
      message: "Erreur lors de la récupération du journal de chantier.",
    });
  }
}

/**
 * POST /chantiers/:id/justifications/demander
 * Transmits an explanation request from Responsable to the assigned Agent de Terrain
 * for a specific tronçon and date without observations.
 */
async function requestExplanation(req, res) {
  try {
    const { id } = req.params;
    const { troncon_id, date_concernee, message } = req.body;
    const userId = req.user.id;
    const isAdmin = req.user.role_nom === 'Administrateur' || req.user.role_id === 1;

    if (!troncon_id || !date_concernee || !message) {
      return res.status(400).json({ message: 'Les champs troncon_id, date_concernee et message sont requis.' });
    }

    // Verify user is Responsable or Admin of chantier
    const chantierRes = await db.query(`
      SELECT c.id, c.nom, c.responsable_id
      FROM public.chantier c
      WHERE c.id = $1 AND (c.responsable_id = $2 OR $3 = true)
    `, [id, userId, isAdmin]);

    if (chantierRes.rows.length === 0) {
      return res.status(403).json({ message: "Accès interdit : vous n'êtes pas le responsable de ce chantier." });
    }
    const chantier = chantierRes.rows[0];

    // Verify tronçon belongs to chantier and get active agent
    const tronconRes = await db.query(`
      SELECT 
        t.id, t.nom,
        a.agent_id,
        TRIM(CONCAT(u.prenom, ' ', u.nom)) AS agent_nom
      FROM public.troncon t
      LEFT JOIN LATERAL (
        SELECT a2.agent_id
        FROM public.affectation_troncon a2
        WHERE a2.troncon_id = t.id AND a2.statut = 'ACTIF'
        ORDER BY a2.date_affectation DESC, a2.id DESC
        LIMIT 1
      ) a ON true
      LEFT JOIN public.utilisateur u ON u.id = a.agent_id
      WHERE t.id = $1 AND t.chantier_id = $2
    `, [troncon_id, id]);

    if (tronconRes.rows.length === 0) {
      return res.status(404).json({ message: 'Tronçon introuvable dans ce chantier.' });
    }

    const troncon = tronconRes.rows[0];
    if (!troncon.agent_id) {
      return res.status(400).json({ message: "Aucun agent de terrain n'est actuellement affecté à ce tronçon." });
    }

    // Duplicate protection: check if an explanation request already exists for this tronçon and date
    const existingReq = await db.query(`
      SELECT d.*, t.nom AS troncon_nom, c.nom AS chantier_nom
      FROM public.demande_explication d
      JOIN public.troncon t ON t.id = d.troncon_id
      JOIN public.chantier c ON c.id = d.chantier_id
      WHERE d.troncon_id = $1 AND d.date_concernee = $2::date
    `, [troncon_id, date_concernee]);

    if (existingReq.rows.length > 0) {
      const cur = existingReq.rows[0];
      if (cur.statut === 'EN_ATTENTE') {
        return res.status(409).json({
          message: "Demande déjà envoyée. Une réponse est déjà en attente de l'agent de terrain.",
          demande: cur,
          already_pending: true,
        });
      }
      if (cur.statut === 'REPONDUE') {
        return res.status(409).json({
          message: "L'agent de terrain a déjà fourni une explication pour cette journée.",
          demande: cur,
          already_answered: true,
        });
      }
    }

    // Insert or update demande_explication
    const insertRes = await db.query(`
      INSERT INTO public.demande_explication (
        chantier_id,
        troncon_id,
        agent_id,
        responsable_id,
        date_concernee,
        statut,
        message_responsable,
        date_demande
      )
      VALUES ($1, $2, $3, $4, $5::date, 'EN_ATTENTE', $6, CURRENT_TIMESTAMP)
      ON CONFLICT (troncon_id, date_concernee)
      DO UPDATE SET 
        message_responsable = EXCLUDED.message_responsable,
        statut = 'EN_ATTENTE',
        date_demande = CURRENT_TIMESTAMP
      RETURNING *;
    `, [id, troncon_id, troncon.agent_id, userId, date_concernee, message]);

    const demande = insertRes.rows[0];

    // Create in-app notification for the agent with complete context metadata
    try {
      const demandeurNom = req.user.prenom ? `${req.user.prenom} ${req.user.nom}` : 'Responsable';
      const metadataJson = JSON.stringify({
        chantier_id: parseInt(id, 10),
        chantier_nom: chantier.nom,
        troncon_id: parseInt(troncon_id, 10),
        troncon_nom: troncon.nom,
        date_concernee: date_concernee,
        demande_id: demande.id,
        demandeur_nom: demandeurNom,
        message_responsable: message,
      });

      await db.query(`
        INSERT INTO public.notification (
          utilisateur_id,
          titre,
          message,
          type,
          related_entity_type,
          related_entity_id,
          metadata,
          date_envoi,
          lu
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, false)
      `, [
        troncon.agent_id,
        "Demande d'explication",
        `Le responsable demande une justification concernant l'absence de relevé le ${date_concernee} sur le tronçon ${troncon.nom} (${chantier.nom}).`,
        'DEMANDE_EXPLICATION',
        'demande_explication',
        demande.id,
        metadataJson,
      ]);
    } catch (notifErr) {
      console.warn('⚠️ Could not insert notification for agent:', notifErr.message);
    }

    return res.status(201).json({
      message: 'Demande d’explication transmise avec succès à l’agent de terrain.',
      demande,
    });
  } catch (error) {
    console.error('❌ RequestExplanation error:', error.message);
    return res.status(500).json({ message: "Erreur lors de l'envoi de la demande d'explication." });
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
  getChantierAvancementStats,
  getChantierJournal,
  requestExplanation,
};

