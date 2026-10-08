/**
 * server/src/services/kml.service.js
 *
 * SiteX — Level 1 & Level 2 KML Integration Service
 * Extraction adapter converting Google Earth KML Placemark with LineString
 * into a normalized WGS 84 (EPSG:4326) GeoJSON LineString representation
 * while extracting and preserving rich KML intelligence (metadata) separately
 * from SiteX authoritative business data.
 *
 * Level 2 Intelligence features:
 * - Placemark name
 * - Folder hierarchy preservation
 * - Description extraction
 * - Style references (styleUrl)
 * - Basic style definitions (Style, StyleMap, LineStyle color & width)
 * - ExtendedData extraction (Data/value, SchemaData/SimpleData)
 * - Temporal metadata (TimeStamp, TimeSpan)
 * - Document name and generator attribution
 *
 * Level 1 invariants preserved:
 * - Geometry is normalized to LineString in EPSG:4326.
 * - Altitude is ignored for 2D baseline.
 * - Multiple LineStrings are rejected with a clear message (no silent merge).
 * - Unsupported geometries (Point, Polygon, MultiGeometry, etc.) are detected and rejected.
 * - Safe local XML parsing (no remote/entity lookups).
 */

'use strict';

const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const KML_NAMESPACE_URI = 'http://www.opengis.net/kml/2.2';

/**
 * Checks whether content or filename corresponds to a KML file.
 * @param {string} contentOrPath - File content or filename.
 * @returns {boolean}
 */
function isKml(contentOrPath) {
  if (!contentOrPath || typeof contentOrPath !== 'string') return false;
  const trimmed = contentOrPath.trim();
  if (trimmed.toLowerCase().endsWith('.kml')) return true;
  if (trimmed.startsWith('<?xml') && trimmed.includes('<kml')) return true;
  if (trimmed.startsWith('<kml') || trimmed.includes(KML_NAMESPACE_URI)) return true;
  return false;
}

/**
 * Parses raw coordinate string from KML <coordinates> tag with 3D altitude preservation.
 * Returns both 2D baseline coordinates [lon, lat] and optional 3D coordinates [lon, lat, alt],
 * preserving the exact elevation values for Level 5 3D visualization.
 *
 * @param {string} rawCoordinates 
 * @returns {{
 *   coordinates2D: Array<[number, number]>,
 *   coordinates3D: Array<[number, number, number]>,
 *   hasAltitude: boolean,
 *   altitudeRange: { min: number, max: number } | null
 * }}
 */
function parseKmlCoordinatesWithAltitude(rawCoordinates) {
  if (!rawCoordinates || typeof rawCoordinates !== 'string') {
    throw new Error('Les coordonnées du tracé KML sont vides ou introuvables.');
  }

  const tokens = rawCoordinates.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('Aucun point de coordonnées trouvé dans la balise <coordinates>.');
  }

  const coordinates2D = [];
  const coordinates3D = [];
  let hasAltitude = false;
  let minAlt = Infinity;
  let maxAlt = -Infinity;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    if (!token) continue;

    const parts = token.split(',');
    if (parts.length < 2) {
      throw new Error(`Format de coordonnée invalide au sommet ${i + 1} : "${token}". Format attendu: lon,lat[,alt]`);
    }

    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);

    if (isNaN(lon) || isNaN(lat)) {
      throw new Error(`Valeur non numérique détectée au sommet ${i + 1} : "${token}".`);
    }

    // Geographic boundary validation (WGS 84)
    if (lon < -180 || lon > 180) {
      throw new Error(`Coordonnée longitude hors limites au sommet ${i + 1} : ${lon}. La valeur doit être comprise entre -180 et 180.`);
    }
    if (lat < -90 || lat > 90) {
      throw new Error(`Coordonnée latitude hors limites au sommet ${i + 1} : ${lat}. La valeur doit être comprise entre -90 et 90.`);
    }

    coordinates2D.push([lon, lat]);

    let alt = 0;
    if (parts.length >= 3 && parts[2] !== undefined && parts[2].trim() !== '') {
      const parsedAlt = parseFloat(parts[2]);
      if (!isNaN(parsedAlt)) {
        alt = parsedAlt;
        hasAltitude = true;
        if (alt < minAlt) minAlt = alt;
        if (alt > maxAlt) maxAlt = alt;
      }
    }
    coordinates3D.push([lon, lat, alt]);
  }

  if (coordinates2D.length < 2) {
    throw new Error(`Le tracé linéaire KML doit contenir au moins 2 points de coordonnées valides (${coordinates2D.length} trouvé).`);
  }

  return {
    coordinates2D,
    coordinates3D,
    hasAltitude,
    altitudeRange: hasAltitude ? { min: minAlt, max: maxAlt } : null,
  };
}

/**
 * Parses raw coordinate string from KML <coordinates> tag.
 * Handles space, tab, newline separation and tuple formats (lon,lat or lon,lat,alt).
 * Altitude is ignored for 2D baseline geometry.
 *
 * @param {string} rawCoordinates 
 * @returns {Array<[number, number]>} Array of [longitude, latitude]
 */
function parseKmlCoordinates(rawCoordinates) {
  return parseKmlCoordinatesWithAltitude(rawCoordinates).coordinates2D;
}

/**
 * Extracts structured key-value pairs from <ExtendedData>.
 * Supports both <Data name="..."><value>...</value></Data>
 * and <SchemaData><SimpleData name="...">...</SimpleData></SchemaData>.
 *
 * @param {any} extNode 
 * @returns {Record<string, string>}
 */
function extractExtendedData(extNode) {
  if (!extNode || typeof extNode !== 'object') return {};
  const result = {};

  // 1. Standard <Data name="..."><value>...</value></Data>
  if (extNode.Data) {
    const dataItems = Array.isArray(extNode.Data) ? extNode.Data : [extNode.Data];
    for (const item of dataItems) {
      if (!item || typeof item !== 'object') continue;
      const key = item['@_name'] || item.name;
      if (key !== undefined) {
        let val = item.value;
        if (typeof val === 'object' && val !== null) {
          val = val['#text'] !== undefined ? val['#text'] : JSON.stringify(val);
        }
        result[String(key).trim()] = val !== undefined ? String(val).trim() : '';
      }
    }
  }

  // 2. <SchemaData><SimpleData name="...">...</SimpleData></SchemaData>
  if (extNode.SchemaData) {
    const schemaItems = Array.isArray(extNode.SchemaData) ? extNode.SchemaData : [extNode.SchemaData];
    for (const sItem of schemaItems) {
      if (!sItem || typeof sItem !== 'object') continue;
      if (sItem.SimpleData) {
        const simpleItems = Array.isArray(sItem.SimpleData) ? sItem.SimpleData : [sItem.SimpleData];
        for (const simp of simpleItems) {
          if (!simp) continue;
          const key = simp['@_name'] || simp.name;
          const val = simp['#text'] !== undefined ? simp['#text'] : (typeof simp === 'string' || typeof simp === 'number' ? simp : '');
          if (key !== undefined) {
            result[String(key).trim()] = String(val).trim();
          }
        }
      }
    }
  }

  return result;
}

/**
 * Extracts temporal metadata from <TimeStamp> or <TimeSpan>.
 *
 * @param {any} node 
 * @returns {object|null}
 */
function extractTimeInfo(node) {
  if (!node || typeof node !== 'object') return null;

  // TimeStamp: <TimeStamp><when>...</when></TimeStamp>
  if (node.TimeStamp) {
    const ts = node.TimeStamp;
    const when = typeof ts === 'object' ? (ts.when?.['#text'] || ts.when) : null;
    if (when) {
      return {
        type: 'timestamp',
        when: String(when).trim(),
      };
    }
  }

  // TimeSpan: <TimeSpan><begin>...</begin><end>...</end></TimeSpan>
  if (node.TimeSpan) {
    const span = node.TimeSpan;
    const begin = typeof span === 'object' && span.begin ? (span.begin?.['#text'] || span.begin) : null;
    const end = typeof span === 'object' && span.end ? (span.end?.['#text'] || span.end) : null;
    if (begin || end) {
      return {
        type: 'timespan',
        begin: begin ? String(begin).trim() : null,
        end: end ? String(end).trim() : null,
      };
    }
  }

  return null;
}

/**
 * Collects all <Style> and <StyleMap> elements into a global registry.
 *
 * @param {any} node 
 * @param {object} registry 
 */
function collectStylesRegistry(node, registry) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectStylesRegistry(item, registry);
    return;
  }

  // Collect <Style id="...">
  if (node.Style) {
    const styles = Array.isArray(node.Style) ? node.Style : [node.Style];
    for (const s of styles) {
      if (s && typeof s === 'object') {
        const rawId = s['@_id'] || s.id || '';
        const id = String(rawId).replace(/^#/, '').trim();
        if (id) {
          const styleObj = { id };
          if (s.LineStyle && typeof s.LineStyle === 'object') {
            const widthVal = parseFloat(s.LineStyle.width);
            styleObj.line = {
              color: s.LineStyle.color ? String(s.LineStyle.color).trim() : null,
              width: !isNaN(widthVal) ? widthVal : null,
            };
          }
          if (s.IconStyle && typeof s.IconStyle === 'object') {
            styleObj.icon = {
              color: s.IconStyle.color ? String(s.IconStyle.color).trim() : null,
              scale: s.IconStyle.scale !== undefined ? parseFloat(s.IconStyle.scale) : null,
              href: s.IconStyle.Icon?.href ? String(s.IconStyle.Icon.href).trim() : null,
            };
          }
          registry.styles[id] = styleObj;
        }
      }
    }
  }

  // Collect <StyleMap id="...">
  if (node.StyleMap) {
    const styleMaps = Array.isArray(node.StyleMap) ? node.StyleMap : [node.StyleMap];
    for (const sm of styleMaps) {
      if (sm && typeof sm === 'object') {
        const rawId = sm['@_id'] || sm.id || '';
        const id = String(rawId).replace(/^#/, '').trim();
        if (id) {
          const pairs = [];
          if (sm.Pair) {
            const pairItems = Array.isArray(sm.Pair) ? sm.Pair : [sm.Pair];
            for (const p of pairItems) {
              if (p && typeof p === 'object') {
                pairs.push({
                  key: p.key ? String(p.key).trim() : 'normal',
                  styleUrl: p.styleUrl ? String(p.styleUrl).trim() : '',
                });
              }
            }
          }
          registry.styleMaps[id] = { id, pairs };
        }
      }
    }
  }

  for (const k of Object.keys(node)) {
    if (k !== 'Style' && k !== 'StyleMap' && typeof node[k] === 'object') {
      collectStylesRegistry(node[k], registry);
    }
  }
}

/**
 * Resolves style information for a given styleUrl reference.
 * Handles indirection through StyleMap (e.g. #m_ylw-pushpin -> #s_ylw-pushpin).
 *
 * @param {string|null} styleUrl 
 * @param {object} stylesRegistry 
 * @returns {object}
 */
function resolveStyle(styleUrl, stylesRegistry) {
  if (!styleUrl || typeof styleUrl !== 'string') {
    return {
      styleUrl: null,
      line: null,
      styleMap: null,
      definedStylesCount: Object.keys(stylesRegistry.styles).length,
      definedStyleMapsCount: Object.keys(stylesRegistry.styleMaps).length,
    };
  }

  const cleanId = styleUrl.replace(/^#/, '').trim();
  let resolvedStyleMap = null;
  let targetStyleId = cleanId;

  // 1. If pointing to a StyleMap, resolve the normal pair
  if (stylesRegistry.styleMaps[cleanId]) {
    resolvedStyleMap = stylesRegistry.styleMaps[cleanId];
    const normalPair =
      resolvedStyleMap.pairs.find((p) => p.key === 'normal') ||
      resolvedStyleMap.pairs[0];
    if (normalPair && normalPair.styleUrl) {
      targetStyleId = normalPair.styleUrl.replace(/^#/, '').trim();
    }
  }

  // 2. Look up the style definition
  const foundStyle = stylesRegistry.styles[targetStyleId];

  return {
    styleUrl,
    line: foundStyle?.line || null,
    styleMap: resolvedStyleMap,
    definedStylesCount: Object.keys(stylesRegistry.styles).length,
    definedStyleMapsCount: Object.keys(stylesRegistry.styleMaps).length,
  };
}

/**
 * Validates, categorizes, and sanitizes KML asset image references (<href>).
 * Differentiates remote URLs vs local relative assets vs dangerous references.
 * Strictly prevents directory traversal, root paths, and dangerous URI schemes.
 * Does NOT perform server-side network fetching (prevents SSRF).
 *
 * @param {string|any} rawHref 
 * @returns {{ href: string, isRemote: boolean, isSafe: boolean, isAvailable: boolean, warning: string|null }}
 */
function validateAndSanitizeAssetHref(rawHref, options = {}) {
  if (!rawHref || typeof rawHref !== 'string') {
    return {
      href: '',
      isRemote: false,
      isSafe: false,
      isAvailable: false,
      warning: "Référence d'image vide ou manquante",
    };
  }

  const trimmed = rawHref.trim();
  const lower = trimmed.toLowerCase();

  // 1. Reject dangerous URI schemes (XSS / file access / SSRF)
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return {
      href: null,
      originalHref: trimmed,
      isRemote: false,
      isSafe: false,
      isAvailable: false,
      warning: "Protocole non sécurisé rejeté pour des raisons de sécurité.",
    };
  }

  // 2. Remote URLs (HTTP / HTTPS)
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return {
          href: null,
          originalHref: trimmed,
          isRemote: true,
          isSafe: false,
          isAvailable: false,
          warning: "Protocole distant non autorisé.",
        };
      }
      return {
        href: trimmed,
        originalHref: trimmed,
        isRemote: true,
        isSafe: true,
        isAvailable: true, // Safe for client-side display in Leaflet; server does NOT fetch
        warning: null,
      };
    } catch {
      return {
        href: null,
        originalHref: trimmed,
        isRemote: true,
        isSafe: false,
        isAvailable: false,
        warning: "URL distante malformée.",
      };
    }
  }

  // 3. Reject directory traversal attempts and absolute filesystem paths
  if (
    trimmed.includes('..') ||
    trimmed.includes('\\') ||
    trimmed.startsWith('/') ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    return {
      href: null,
      originalHref: trimmed,
      isRemote: false,
      isSafe: false,
      isAvailable: false,
      warning: "Chemin de fichier non sécurisé (tentative de traversée de répertoire rejetée).",
    };
  }

  // Normalize path using posix standard
  const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/')).replace(/^\/+/, '');
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    return {
      href: null,
      originalHref: trimmed,
      isRemote: false,
      isSafe: false,
      isAvailable: false,
      warning: "Chemin de fichier non sécurisé (tentative de traversée de répertoire rejetée).",
    };
  }

  // 4. Resolve against local companion assets if provided
  const assetMap = options.assetMap || null;
  const baseName = path.basename(normalized);

  if (assetMap && typeof assetMap === 'object') {
    let resolvedUrl = null;
    if (assetMap[normalized]) {
      resolvedUrl = assetMap[normalized];
    } else if (assetMap[baseName]) {
      resolvedUrl = assetMap[baseName];
    } else {
      // Case-insensitive lookup across mapped keys
      const lowerNorm = normalized.toLowerCase();
      const lowerBase = baseName.toLowerCase();
      for (const k of Object.keys(assetMap)) {
        const lowerK = k.toLowerCase();
        if (lowerK === lowerNorm || lowerK === lowerBase || path.basename(lowerK) === lowerBase) {
          resolvedUrl = assetMap[k];
          break;
        }
      }
    }

    if (resolvedUrl) {
      return {
        href: resolvedUrl,
        originalHref: trimmed,
        isRemote: false,
        isSafe: true,
        isAvailable: true,
        warning: null,
      };
    }
  }

  if (typeof options.assetResolver === 'function') {
    try {
      const customRes = options.assetResolver(normalized);
      if (customRes && customRes.href) {
        return {
          href: customRes.href,
          originalHref: trimmed,
          isRemote: !!customRes.isRemote,
          isSafe: true,
          isAvailable: customRes.isAvailable !== false,
          warning: customRes.warning || null,
        };
      }
    } catch {}
  }

  if (options.assetBaseUrl) {
    const combined = options.assetBaseUrl.replace(/\/+$/, '') + '/' + normalized;
    return {
      href: combined,
      originalHref: trimmed,
      isRemote: false,
      isSafe: true,
      isAvailable: true,
      warning: null,
    };
  }

  return {
    href: normalized,
    originalHref: trimmed,
    isRemote: false,
    isSafe: true,
    // Standalone KML uploads do not bundle companion local assets yet; mark as unavailable cleanly
    isAvailable: false,
    warning: "Ressource image locale référencée dans le KML (fichier compagnon non disponible localement / non présent sur le serveur).",
  };
}

/**
 * Parses and validates LatLonBox bounding coordinates for GroundOverlay.
 *
 * @param {any} boxNode 
 * @returns {{ north: number, south: number, east: number, west: number, rotation: number }|null}
 */
function parseLatLonBox(boxNode) {
  if (!boxNode || typeof boxNode !== 'object') return null;

  const north = parseFloat(boxNode.north);
  const south = parseFloat(boxNode.south);
  const east = parseFloat(boxNode.east);
  const west = parseFloat(boxNode.west);
  const rotation = !isNaN(parseFloat(boxNode.rotation)) ? parseFloat(boxNode.rotation) : 0;

  if (isNaN(north) || isNaN(south) || isNaN(east) || isNaN(west)) {
    return null;
  }

  // WGS 84 coordinate limits
  if (north < -90 || north > 90 || south < -90 || south > 90) {
    return null;
  }
  if (east < -180 || east > 180 || west < -180 || west > 180) {
    return null;
  }

  // Latitudinal ordering
  if (south >= north) {
    return null;
  }

  return {
    north,
    south,
    east,
    west,
    rotation,
  };
}

/**
 * Extracts 2D geographic position and camera orientation for PhotoOverlay.
 *
 * @param {any} photoNode 
 * @returns {{ position: [number, number]|null, altitude: number|null, heading: number|null, tilt: number|null, roll: number|null }}
 */
function extractPhotoOverlayPosition(photoNode) {
  if (!photoNode || typeof photoNode !== 'object') {
    return { position: null, altitude: null, heading: null, tilt: null, roll: null };
  }

  let position = null;
  let altitude = null;
  let heading = !isNaN(parseFloat(photoNode.heading)) ? parseFloat(photoNode.heading) : null;
  let tilt = !isNaN(parseFloat(photoNode.tilt)) ? parseFloat(photoNode.tilt) : null;
  let roll = !isNaN(parseFloat(photoNode.roll)) ? parseFloat(photoNode.roll) : null;

  // 1. Camera element
  if (photoNode.Camera && typeof photoNode.Camera === 'object') {
    const cam = photoNode.Camera;
    const lon = parseFloat(cam.longitude);
    const lat = parseFloat(cam.latitude);
    const alt = parseFloat(cam.altitude);
    if (!isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
      position = [lon, lat];
      if (!isNaN(alt)) altitude = alt;
    }
    if (!isNaN(parseFloat(cam.heading))) heading = parseFloat(cam.heading);
    if (!isNaN(parseFloat(cam.tilt))) tilt = parseFloat(cam.tilt);
    if (!isNaN(parseFloat(cam.roll))) roll = parseFloat(cam.roll);
  }

  // 2. Point element (if position not yet resolved from Camera)
  if (!position && photoNode.Point && typeof photoNode.Point === 'object') {
    const rawCoords = photoNode.Point.coordinates;
    if (typeof rawCoords === 'string') {
      const parts = rawCoords.trim().split(',');
      if (parts.length >= 2) {
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const alt = parts[2] ? parseFloat(parts[2]) : null;
        if (!isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
          position = [lon, lat];
          if (!isNaN(alt)) altitude = alt;
        }
      }
    }
  }

  // 3. LookAt element (as secondary camera target)
  if (photoNode.LookAt && typeof photoNode.LookAt === 'object') {
    const la = photoNode.LookAt;
    if (!position) {
      const lon = parseFloat(la.longitude);
      const lat = parseFloat(la.latitude);
      const alt = parseFloat(la.altitude);
      if (!isNaN(lon) && !isNaN(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90) {
        position = [lon, lat];
        if (!isNaN(alt)) altitude = alt;
      }
    }
    if (heading === null && !isNaN(parseFloat(la.heading))) heading = parseFloat(la.heading);
    if (tilt === null && !isNaN(parseFloat(la.tilt))) tilt = parseFloat(la.tilt);
    if (roll === null && !isNaN(parseFloat(la.roll))) roll = parseFloat(la.roll);
  }

  return { position, altitude, heading, tilt, roll };
}

/**
 * Parses optional ViewVolume fields for PhotoOverlay.
 *
 * @param {any} vNode 
 * @returns {object|null}
 */
function parseViewVolume(vNode) {
  if (!vNode || typeof vNode !== 'object') return null;
  const leftFov = parseFloat(vNode.leftFov);
  const rightFov = parseFloat(vNode.rightFov);
  const bottomFov = parseFloat(vNode.bottomFov);
  const topFov = parseFloat(vNode.topFov);
  const near = parseFloat(vNode.near);

  return {
    leftFov: !isNaN(leftFov) ? leftFov : null,
    rightFov: !isNaN(rightFov) ? rightFov : null,
    bottomFov: !isNaN(bottomFov) ? bottomFov : null,
    topFov: !isNaN(topFov) ? topFov : null,
    near: !isNaN(near) ? near : null,
  };
}

/**
 * Processes a single <GroundOverlay> node to collect 2D georeferenced image metadata.
 *
 * @param {any} goNode 
 * @param {object} collector 
 * @param {Array<string>} currentFolderStack 
 */
function processGroundOverlay(goNode, collector, currentFolderStack, options = {}) {
  const index = collector.groundOverlays.length + 1;
  const rawId = goNode['@_id'] || goNode.id || `ground-overlay-${index}`;
  const name = goNode.name ? String(goNode.name).trim() : `GroundOverlay ${index}`;
  const description = goNode.description ? String(goNode.description).trim() : null;
  const color = goNode.color ? String(goNode.color).trim() : null;
  const drawOrder = !isNaN(parseInt(goNode.drawOrder, 10)) ? parseInt(goNode.drawOrder, 10) : 0;

  // Icon / Href extraction
  const iconNode = goNode.Icon || goNode.icon || {};
  const rawHref = typeof iconNode === 'object' ? iconNode.href : (typeof iconNode === 'string' ? iconNode : '');
  const assetInfo = validateAndSanitizeAssetHref(rawHref, options);

  const refreshMode = iconNode.refreshMode ? String(iconNode.refreshMode).trim() : null;
  const refreshInterval = !isNaN(parseFloat(iconNode.refreshInterval)) ? parseFloat(iconNode.refreshInterval) : null;
  const viewBoundScale = !isNaN(parseFloat(iconNode.viewBoundScale)) ? parseFloat(iconNode.viewBoundScale) : null;

  // LatLonBox
  const latLonBox = parseLatLonBox(goNode.LatLonBox || goNode.latLonBox);
  const time = extractTimeInfo(goNode);
  const altitude = !isNaN(parseFloat(goNode.altitude)) ? parseFloat(goNode.altitude) : null;
  const altitudeMode = goNode.altitudeMode ? String(goNode.altitudeMode).trim() : null;

  // Opacity derived from AABBGGRR color or default 1.0
  let opacity = 1.0;
  if (color) {
    const conv = convertKmlColorToLeaflet(color, '#FFFFFF', 1.0);
    opacity = conv.opacity;
  }

  if (assetInfo.warning && collector.warnings) {
    collector.warnings.push(assetInfo.warning);
  }

  collector.groundOverlays.push({
    id: String(rawId),
    type: 'GroundOverlay',
    name,
    description,
    folders: [...currentFolderStack],
    icon: {
      href: assetInfo.href,
      originalHref: assetInfo.originalHref || (rawHref ? String(rawHref).trim() : null),
      refreshMode,
      refreshInterval,
      viewBoundScale,
    },
    latLonBox,
    altitude,
    altitudeMode,
    time,
    color,
    opacity,
    drawOrder,
    isRemote: assetInfo.isRemote,
    isSafe: assetInfo.isSafe,
    isAvailable: assetInfo.isAvailable,
    securityWarning: assetInfo.warning,
  });
}

/**
 * Processes a single <PhotoOverlay> node to collect 2D georeferenced photo metadata.
 *
 * @param {any} poNode 
 * @param {object} collector 
 * @param {Array<string>} currentFolderStack 
 */
function processPhotoOverlay(poNode, collector, currentFolderStack, options = {}) {
  const index = collector.photoOverlays.length + 1;
  const rawId = poNode['@_id'] || poNode.id || `photo-overlay-${index}`;
  const name = poNode.name ? String(poNode.name).trim() : `PhotoOverlay ${index}`;
  const description = poNode.description ? String(poNode.description).trim() : null;

  // Icon / Href extraction
  const iconNode = poNode.Icon || poNode.icon || {};
  const rawHref = typeof iconNode === 'object' ? iconNode.href : (typeof iconNode === 'string' ? iconNode : '');
  const assetInfo = validateAndSanitizeAssetHref(rawHref, options);

  if (assetInfo.warning && collector.warnings) {
    collector.warnings.push(assetInfo.warning);
  }

  // Spatial & Orientation extraction
  const spatial = extractPhotoOverlayPosition(poNode);
  const viewVolume = parseViewVolume(poNode.ViewVolume || poNode.viewVolume);
  const shape = poNode.shape ? String(poNode.shape).trim() : 'rectangle';
  const time = extractTimeInfo(poNode);

  collector.photoOverlays.push({
    id: String(rawId),
    type: 'PhotoOverlay',
    name,
    description,
    folders: [...currentFolderStack],
    icon: {
      href: assetInfo.href,
    },
    position: spatial.position,
    altitude: spatial.altitude,
    heading: spatial.heading,
    tilt: spatial.tilt,
    roll: spatial.roll,
    viewVolume,
    shape,
    time,
    isRemote: assetInfo.isRemote,
    isSafe: assetInfo.isSafe,
    isAvailable: assetInfo.isAvailable,
    securityWarning: assetInfo.warning,
  });
}

/**
 * Evaluates whether a KML temporal entity is active at a given target date.
 * If timeObj is null/undefined, it is considered static (always active).
 *
 * @param {object|null} timeObj - { type: 'timestamp' | 'timespan', when?: string, begin?: string, end?: string }
 * @param {string|Date} targetDate - Date to check against
 * @returns {boolean}
 */
function isKmlTimeActiveAtDate(timeObj, targetDate) {
  if (!timeObj || !timeObj.type) return true; // Static element is always active
  if (!targetDate) return true;

  const targetMs = new Date(targetDate).getTime();
  if (isNaN(targetMs)) return true;

  if (timeObj.type === 'timestamp') {
    if (!timeObj.when) return true;
    const whenMs = new Date(timeObj.when).getTime();
    if (isNaN(whenMs)) return true;
    return targetMs >= whenMs;
  }

  if (timeObj.type === 'timespan') {
    const beginMs = timeObj.begin ? new Date(timeObj.begin).getTime() : -Infinity;
    const endMs = timeObj.end ? new Date(timeObj.end).getTime() : Infinity;

    const validBegin = isNaN(beginMs) ? -Infinity : beginMs;
    const validEnd = isNaN(endMs) ? Infinity : endMs;

    return targetMs >= validBegin && targetMs <= validEnd;
  }

  return true;
}

/**
 * Recursively traverses the KML document tree to collect Placemarks and Image Overlays,
 * preserving Folder hierarchy and metadata context.
 *
 * @param {any} node 
 * @param {object} collector 
 * @param {Array<string>} currentFolderStack 
 */
function traverseKmlTree(node, collector, currentFolderStack = [], options = {}) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) {
      traverseKmlTree(item, collector, currentFolderStack, options);
    }
    return;
  }

  for (const key of Object.keys(node)) {
    const val = node[key];

    if (key === 'Folder') {
      const folders = Array.isArray(val) ? val : [val];
      for (const f of folders) {
        if (!f || typeof f !== 'object') continue;
        const folderName = f.name ? String(f.name).trim() : 'Folder';
        const nextFolderStack = [...currentFolderStack, folderName];
        traverseKmlTree(f, collector, nextFolderStack, options);
      }
    } else if (key === 'Placemark') {
      const placemarks = Array.isArray(val) ? val : [val];
      for (const p of placemarks) {
        if (!p || typeof p !== 'object') continue;
        processPlacemark(p, collector, currentFolderStack, options);
      }
    } else if (key === 'GroundOverlay') {
      const overlays = Array.isArray(val) ? val : [val];
      for (const go of overlays) {
        if (!go || typeof go !== 'object') continue;
        processGroundOverlay(go, collector, currentFolderStack, options);
      }
    } else if (key === 'PhotoOverlay') {
      const photos = Array.isArray(val) ? val : [val];
      for (const po of photos) {
        if (!po || typeof po !== 'object') continue;
        processPhotoOverlay(po, collector, currentFolderStack, options);
      }
    } else if (
      key !== 'Style' &&
      key !== 'StyleMap' &&
      key !== 'Folder' &&
      key !== 'Placemark' &&
      key !== 'GroundOverlay' &&
      key !== 'PhotoOverlay' &&
      typeof val === 'object'
    ) {
      traverseKmlTree(val, collector, currentFolderStack, options);
    }
  }
}

/**
 * Processes a single <Placemark> node to collect geometries and Level 2 intelligence.
 *
 * @param {any} pNode 
 * @param {object} collector 
 * @param {Array<string>} currentFolderStack 
 * @param {object} options
 */
function processPlacemark(pNode, collector, currentFolderStack, options = {}) {
  const pExtendedData = extractExtendedData(pNode.ExtendedData);
  let pName = pNode.name ? String(pNode.name).trim() : null;
  // Fallbacks: if no direct <name>, check SimpleData / ExtendedData fields
  if (!pName && pExtendedData) {
    pName = pExtendedData.kml_name || pExtendedData.name || pExtendedData.full_id || pExtendedData.osm_id || pExtendedData.ref || null;
    if (pName) pName = String(pName).trim();
  }

  const pDesc = pNode.description ? String(pNode.description).trim() : null;
  const pStyleUrl = pNode.styleUrl ? String(pNode.styleUrl).trim() : null;
  const pTime = extractTimeInfo(pNode);

  // Parse inline <Style> if present directly in Placemark without an id
  let inlineLineStyle = null;
  const rawInlineStyle = pNode.Style;
  if (rawInlineStyle && typeof rawInlineStyle === 'object') {
    const s = Array.isArray(rawInlineStyle) ? rawInlineStyle[0] : rawInlineStyle;
    if (s && s.LineStyle && typeof s.LineStyle === 'object') {
      const widthVal = parseFloat(s.LineStyle.width);
      inlineLineStyle = {
        color: s.LineStyle.color ? String(s.LineStyle.color).trim() : null,
        width: !isNaN(widthVal) ? widthVal : null,
      };
    }
  }

  // Extract generator from atom:link if present
  let generator = null;
  const linkNode = pNode['atom:link'] || pNode.link;
  if (linkNode && typeof linkNode === 'object') {
    generator = linkNode['@_title'] || linkNode.title || null;
  }

  const placemarkMeta = {
    name: pName,
    description: pDesc,
    folders: [...currentFolderStack],
    styleUrl: pStyleUrl,
    extendedData: pExtendedData,
    inlineLineStyle,
    time: pTime,
    generator,
  };

  // Check if GroundOverlay or PhotoOverlay was nested inside Placemark
  if (pNode.GroundOverlay) {
    const gos = Array.isArray(pNode.GroundOverlay) ? pNode.GroundOverlay : [pNode.GroundOverlay];
    for (const go of gos) processGroundOverlay(go, collector, currentFolderStack, options);
  }
  if (pNode.PhotoOverlay) {
    const pos = Array.isArray(pNode.PhotoOverlay) ? pNode.PhotoOverlay : [pNode.PhotoOverlay];
    for (const po of pos) processPhotoOverlay(po, collector, currentFolderStack, options);
  }

  // Scan geometries inside Placemark
  scanGeometries(pNode, collector, placemarkMeta);
}

/**
 * Scans a node for spatial geometries and attaches Placemark metadata context.
 *
 * @param {any} node 
 * @param {object} collector 
 * @param {object} placemarkMeta 
 */
function scanGeometries(node, collector, placemarkMeta) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) scanGeometries(item, collector, placemarkMeta);
    return;
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (key === 'LineString') {
      if (Array.isArray(val)) {
        for (const ls of val) {
          collector.lineStrings.push({ node: ls, meta: placemarkMeta });
        }
      } else if (val && typeof val === 'object') {
        collector.lineStrings.push({ node: val, meta: placemarkMeta });
      }
    } else if (key === 'MultiGeometry') {
      scanGeometries(val, collector, placemarkMeta);
    } else if (key === 'Point') {
      collector.unsupportedGeometries.push('Point');
    } else if (key === 'Polygon') {
      collector.unsupportedGeometries.push('Polygon');
    } else if (key === 'Model') {
      collector.unsupportedGeometries.push('Model');
    }
  }
}

/**
 * Parses a KML XML string, extracts the normalized LineString GeoJSON geometry (EPSG:4326),
 * and collects rich KML intelligence (metadata) without modifying SiteX business logic.
 *
 * @param {string} kmlXmlString - Raw KML XML text.
 * @param {object} [options]
 * @returns {object} Normalized GeoJSON Feature with attached kml_metadata
 */
function parseKmlToGeoJson(kmlXmlString, options = {}) {
  if (!kmlXmlString || typeof kmlXmlString !== 'string') {
    throw new Error('Données KML manquantes ou invalides.');
  }

  // 1. Parse XML safely with fast-xml-parser (local processing, no external entities)
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });

  let parsedXml;
  try {
    parsedXml = parser.parse(kmlXmlString);
  } catch (xmlErr) {
    throw new Error(`Fichier KML invalide : structure XML malformée (${xmlErr.message}).`);
  }

  if (!parsedXml || typeof parsedXml !== 'object') {
    throw new Error('Fichier KML invalide : document vide ou inaccessible.');
  }

  // 2. Collect Document name if available
  const docNode = parsedXml.kml?.Document || parsedXml.Document;
  const documentName = docNode?.name ? String(docNode.name).trim() : null;

  // 3. Collect Styles and StyleMaps Registry
  const stylesRegistry = {
    styles: {},
    styleMaps: {},
  };
  collectStylesRegistry(parsedXml, stylesRegistry);

  // 4. Traverse document tree for Folders, Placemarks, and Geometries
  const collector = {
    lineStrings: [],
    unsupportedGeometries: [],
    groundOverlays: [],
    photoOverlays: [],
    warnings: [],
  };

  traverseKmlTree(parsedXml, collector, [], options);

  // Also check if any LineString was defined outside standard Document/Folder tree
  if (collector.lineStrings.length === 0) {
    scanGeometries(parsedXml, collector, {
      name: options.defaultName || null,
      description: null,
      folders: [],
      styleUrl: null,
      extendedData: {},
      time: null,
      generator: null,
    });
  }

  // 5. Validation: No LineString found
  if (collector.lineStrings.length === 0) {
    if (collector.unsupportedGeometries.length > 0) {
      const types = [...new Set(collector.unsupportedGeometries)].join(', ');
      throw new Error(
        `Le fichier KML contient des géométries non supportées (${types}). ` +
        'Seuls les tracés linéaires continus (LineString) sont pris en charge pour l\'alignement de référence.'
      );
    }
    throw new Error('Le fichier KML ne contient aucun tracé linéaire (LineString) valide.');
  }

  // 6. Single LineString Workflow (Level 1 & Level 2 backward-compatible invariant)
  if (collector.lineStrings.length === 1) {
    const target = collector.lineStrings[0];
    const lineNode = target.node;
    const rawCoords = typeof lineNode === 'string' ? lineNode : (lineNode.coordinates || '');

    const parsedSpatial = parseKmlCoordinatesWithAltitude(rawCoords);
    const coordinates = parsedSpatial.coordinates2D;
    const pMeta = target.meta || {};

    const styleInfo = resolveStyle(pMeta.styleUrl, stylesRegistry);
    if (!styleInfo.line && pMeta.inlineLineStyle) {
      styleInfo.line = pMeta.inlineLineStyle;
    }

    const featureName = pMeta.name || documentName || options.defaultName || 'Alignement KML';

    const kmlMetadata = {
      name: featureName,
      description: pMeta.description || null,
      folders: pMeta.folders || [],
      styleUrl: pMeta.styleUrl || null,
      styles: styleInfo,
      extendedData: pMeta.extendedData || {},
      time: pMeta.time || null,
      documentName: documentName,
      generator: pMeta.generator || null,
      groundOverlays: collector.groundOverlays || [],
      photoOverlays: collector.photoOverlays || [],
      warnings: collector.warnings || [],
      altitudeCoordinates: parsedSpatial.hasAltitude ? parsedSpatial.coordinates3D : null,
      hasAltitude: parsedSpatial.hasAltitude,
      altitudeRange: parsedSpatial.altitudeRange,
      isMultiFeature: false,
      featureCount: 1,
    };

    return {
      type: 'Feature',
      properties: {
        name: featureName,
        sourceFormat: 'KML',
        sourceCrs: 'EPSG:4326',
        points_count: coordinates.length,
        kml_metadata: kmlMetadata,
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates,
      },
      sourceFormat: 'KML',
      sourceCrs: 'EPSG:4326',
      metadata: kmlMetadata,
    };
  }

  // 7. Multi-LineString Workflow (Multi-feature spatial mode: preserve all LineStrings separately without merge)
  const features = collector.lineStrings.map((target, idx) => {
    const lineNode = target.node;
    const rawCoords = typeof lineNode === 'string' ? lineNode : (lineNode.coordinates || '');
    const parsedSpatial = parseKmlCoordinatesWithAltitude(rawCoords);
    const coordinates = parsedSpatial.coordinates2D;
    const pMeta = target.meta || {};

    const styleInfo = resolveStyle(pMeta.styleUrl, stylesRegistry);
    if (!styleInfo.line && pMeta.inlineLineStyle) {
      styleInfo.line = pMeta.inlineLineStyle;
    }

    const featureName = pMeta.name || `Tracé ${idx + 1}`;
    const featureMetadata = {
      id: idx + 1,
      name: featureName,
      description: pMeta.description || null,
      folders: pMeta.folders || [],
      styleUrl: pMeta.styleUrl || null,
      styles: styleInfo,
      extendedData: pMeta.extendedData || {},
      time: pMeta.time || null,
      documentName: documentName,
      generator: pMeta.generator || null,
      altitudeCoordinates: parsedSpatial.hasAltitude ? parsedSpatial.coordinates3D : null,
      hasAltitude: parsedSpatial.hasAltitude,
      altitudeRange: parsedSpatial.altitudeRange,
    };

    return {
      type: 'Feature',
      id: idx + 1,
      properties: {
        id: idx + 1,
        feature_id: idx + 1,
        name: featureName,
        sourceFormat: 'KML',
        sourceCrs: 'EPSG:4326',
        points_count: coordinates.length,
        kml_metadata: featureMetadata,
        leaflet_style: resolveKmlLeafletStyle(styleInfo),
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates,
      },
      sourceFormat: 'KML',
      sourceCrs: 'EPSG:4326',
      metadata: featureMetadata,
    };
  });

  const docMetadata = {
    name: documentName || options.defaultName || 'Réseau KML',
    documentName: documentName,
    featureCount: features.length,
    groundOverlays: collector.groundOverlays || [],
    photoOverlays: collector.photoOverlays || [],
    warnings: collector.warnings || [],
    isMultiFeature: true,
  };

  return {
    type: 'FeatureCollection',
    features: features,
    properties: {
      name: documentName || options.defaultName || 'Réseau KML',
      sourceFormat: 'KML',
      sourceCrs: 'EPSG:4326',
      feature_count: features.length,
      kml_metadata: docMetadata,
    },
    sourceFormat: 'KML',
    sourceCrs: 'EPSG:4326',
    metadata: docMetadata,
  };
}

/**
 * Converts a KML AABBGGRR hex color string into Leaflet-compatible styling (#RRGGBB + opacity).
 *
 * @param {string|null} kmlColorHex 
 * @param {string} [defaultColor='#F97316']
 * @param {number} [defaultOpacity=0.95]
 * @returns {{ color: string, opacity: number }}
 */
function convertKmlColorToLeaflet(kmlColorHex, defaultColor = '#F97316', defaultOpacity = 0.95) {
  if (!kmlColorHex || typeof kmlColorHex !== 'string') {
    return { color: defaultColor, opacity: defaultOpacity };
  }

  const clean = kmlColorHex.trim().replace(/^#/, '');

  // 1. Standard 8-character KML format: AABBGGRR
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    const aHex = clean.slice(0, 2);
    const bHex = clean.slice(2, 4);
    const gHex = clean.slice(4, 6);
    const rHex = clean.slice(6, 8);

    const alphaInt = parseInt(aHex, 16);
    const opacity = isNaN(alphaInt) ? defaultOpacity : Math.round((alphaInt / 255) * 100) / 100;
    const color = `#${rHex}${gHex}${bHex}`.toLowerCase();

    return {
      color,
      opacity: Math.max(0, Math.min(1, opacity)),
    };
  }

  // 2. Standard 6-character web format fallback: RRGGBB
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      color: `#${clean.toLowerCase()}`,
      opacity: defaultOpacity,
    };
  }

  // 3. Fallback for invalid formats
  return { color: defaultColor, opacity: defaultOpacity };
}

/**
 * Resolves full Leaflet styling for KML line geometry.
 * Priority:
 * 1. Resolved KML LineStyle
 * 2. Usable KML LineStyle color/width
 * 3. Default SiteX KML visualization style fallback
 *
 * @param {object|null} stylesObj 
 * @returns {{ color: string, weight: number, opacity: number, isDefault: boolean }}
 */
function resolveKmlLeafletStyle(stylesObj) {
  const line = stylesObj && stylesObj.line;
  if (line) {
    const hasColor = Boolean(line.color && typeof line.color === 'string');
    const hasWidth = typeof line.width === 'number' && !isNaN(line.width) && line.width > 0;

    if (hasColor || hasWidth) {
      const converted = convertKmlColorToLeaflet(line.color);
      const weight = hasWidth ? Math.max(1, Math.min(15, Number(line.width))) : 4.5;
      return {
        color: converted.color,
        weight,
        opacity: converted.opacity,
        isDefault: !hasColor,
      };
    }
  }

  return {
    color: '#F97316',
    weight: 4.5,
    opacity: 0.95,
    isDefault: true,
  };
}

module.exports = {
  isKml,
  parseKmlCoordinates,
  parseKmlCoordinatesWithAltitude,
  parseKmlToGeoJson,
  extractExtendedData,
  extractTimeInfo,
  isKmlTimeActiveAtDate,
  convertKmlColorToLeaflet,
  resolveKmlLeafletStyle,
  validateAndSanitizeAssetHref,
  parseLatLonBox,
  extractPhotoOverlayPosition,
  parseViewVolume,
  KML_NAMESPACE_URI,
};

