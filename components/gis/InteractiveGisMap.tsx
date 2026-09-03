import React, { useMemo, useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator, DimensionValue } from 'react-native';
import { WebView } from 'react-native-webview';
import { Palette } from '@/constants/theme';
import { LEAFLET_CSS, LEAFLET_JS, PROJ4_JS } from './leafletAssets';

export interface GisFeatureGeometry {
  type: string;
  coordinates: any;
}

export interface GisTronconSegment {
  id?: number | string;
  nom: string;
  pk_debut: number;
  pk_fin: number;
  statut?: 'NON_COMMENCE' | 'EN_COURS' | 'TERMINE' | 'PROBLEME' | string;
  length_km?: number;
  geometry: GisFeatureGeometry;
  color?: string;
}

export interface GisCandidateCorridor {
  id: number;
  nom: string;
  length_km: number;
  length_meters: number;
  points_count?: number;
  start_point?: [number, number];
  end_point?: [number, number];
  intersects_aoi?: boolean;
  length_in_aoi_km?: number;
  length_in_aoi_meters?: number;
  coverage_aoi_percent?: number;
  distance_to_aoi_meters?: number;
  is_recommended?: boolean;
  status?: string;
  recommendation_reason?: string;
  geometry: GisFeatureGeometry;
}

export interface InteractiveGisMapProps {
  referenceGeometry?: GisFeatureGeometry | null;
  rawGeoJson?: any | null;
  searchLocation?: { lat: number; lon: number; label?: string } | null;
  troncons?: GisTronconSegment[] | null;
  corridors?: GisCandidateCorridor[] | null;
  selectedCorridorId?: number | null;
  aoiGeometry?: GisFeatureGeometry | null;
  enableAoiDrawing?: boolean;
  onAoiChange?: (coordinates: [number, number][]) => void;
  onSelectCorridor?: (corridorId: number) => void;
  selectedTronconId?: number | string;
  center?: [number, number];
  zoom?: number;
  height?: DimensionValue;
  style?: any;
  showSatelliteToggle?: boolean;
  fitPaddingBottom?: number;
  optimizePkLabels?: boolean;
  customMarkers?: {
    lat: number;
    lng: number;
    label?: string;
    sublabel?: string;
    color?: string;
    iconName?: string;
  }[] | null;
  customLines?: {
    start: { lat: number; lng: number };
    end: { lat: number; lng: number };
    label?: string;
    color?: string;
  }[] | null;
  onInteractionChange?: (interacting: boolean) => void;
}

const TRONCON_COLORS = [
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EF4444',
  '#06B6D4',
  '#EC4899',
  '#14B8A6',
  '#6366F1',
  '#84CC16',
];

export function InteractiveGisMap({
  referenceGeometry,
  rawGeoJson,
  searchLocation,
  troncons,
  corridors,
  selectedCorridorId,
  aoiGeometry,
  enableAoiDrawing = false,
  onAoiChange,
  onSelectCorridor,
  selectedTronconId,
  center = [34.12, -6.70],
  zoom = 11,
  height = 340,
  style,
  fitPaddingBottom = 35,
  optimizePkLabels = false,
  customMarkers = null,
  customLines = null,
  onInteractionChange,
}: InteractiveGisMapProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen to messages from Leaflet (Web)
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleMessage = (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'AOI_CHANGED' && Array.isArray(event.data.coordinates)) {
          if (onAoiChange) onAoiChange(event.data.coordinates);
        }
        if (event.data.type === 'SELECT_CORRIDOR' && event.data.corridorId !== undefined) {
          if (onSelectCorridor) onSelectCorridor(event.data.corridorId);
        }
        if (event.data.type === 'MAP_INTERACTION') onInteractionChange?.(!!event.data.active);
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [onAoiChange, onSelectCorridor, onInteractionChange]);

  // Handle messages on React Native Mobile WebView
  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'AOI_CHANGED' && Array.isArray(data.coordinates)) {
        if (onAoiChange) onAoiChange(data.coordinates);
      }
      if (data.type === 'SELECT_CORRIDOR' && data.corridorId !== undefined) {
        if (onSelectCorridor) onSelectCorridor(data.corridorId);
      }
      if (data.type === 'MAP_INTERACTION') {
        onInteractionChange?.(!!data.active);
      }
      if (data.type === 'MAP_ERROR') {
        console.warn('GIS Map Warning:', data.error);
      }
    } catch {}
  };

  // Generate self-contained Leaflet HTML with inlined assets and robust corridor selection
  const leafletHtml = useMemo(() => {
    const mapConfig = {
      rawRef: referenceGeometry || null,
      rawGeoJson: rawGeoJson || null,
      rawSearchLoc: searchLocation || null,
      rawTroncons: troncons && troncons.length > 0 ? troncons : [],
      rawCorridors: corridors && corridors.length > 0 ? corridors : [],
      selectedCorridorId: selectedCorridorId !== undefined && selectedCorridorId !== null ? selectedCorridorId : null,
      rawAoi: aoiGeometry || null,
      enableDrawing: !!enableAoiDrawing,
      customMarkers: customMarkers && customMarkers.length > 0 ? customMarkers : [],
      customLines: customLines && customLines.length > 0 ? customLines : [],
      selectedId: selectedTronconId || null,
      center: center || [34.12, -6.70],
      zoom: zoom || 11,
      fitPaddingBottom: fitPaddingBottom || 35,
      optimizePkLabels: !!optimizePkLabels,
      colors: TRONCON_COLORS,
    };

    const serializedConfig = JSON.stringify(mapConfig).replace(/<\/script/gi, '<\\/script');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    ${LEAFLET_CSS}
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #0F172A;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #map {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      touch-action: none;
      -webkit-user-select: none;
      user-select: none;
      background-color: #0F172A;
      background-image: 
        radial-gradient(circle at 50% 50%, rgba(23, 107, 91, 0.18) 0%, transparent 80%),
        linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px),
        linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
      background-size: 100% 100%, 80px 80px, 80px 80px, 16px 16px, 16px 16px;
      background-position: 0 0, -1px -1px, -1px -1px, -1px -1px, -1px -1px;
    }
    .leaflet-container {
      background: transparent !important;
    }
    .custom-popup .leaflet-popup-content-wrapper {
      background: #1E293B;
      color: #F8FAFC;
      border-radius: 12px;
      padding: 4px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .custom-popup .leaflet-popup-tip {
      background: #1E293B;
    }
    .popup-title {
      font-weight: 700;
      font-size: 13px;
      color: #38BDF8;
      margin-bottom: 4px;
    }
    .popup-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(56, 189, 248, 0.15);
      color: #7DD3FC;
      margin-bottom: 6px;
    }
    .popup-badge-gold {
      background: rgba(245, 158, 11, 0.2);
      color: #FBBF24;
      border: 1px solid rgba(245, 158, 11, 0.4);
    }
    .popup-detail {
      font-size: 11px;
      color: #94A3B8;
      margin: 2px 0;
    }
    .pk-pill {
      background: #0284C7;
      color: #FFFFFF;
      font-weight: bold;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      border: 1.5px solid #FFFFFF;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      white-space: nowrap;
      text-align: center;
    }

    /* Floating Navigation Controls (Left side, below top search bar) */
    .map-nav-toolbar {
      position: absolute;
      top: 76px;
      left: 12px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      padding: 4px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 15px rgba(0,0,0,0.35);
    }
    .map-nav-btn {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      border: none;
      background: #334155;
      color: #FFFFFF;
      font-size: 16px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .map-nav-btn:hover {
      background: #475569;
      transform: scale(1.06);
    }
    .map-nav-btn:active {
      transform: scale(0.92);
      background: #176B5B;
    }
    .map-nav-btn-icon {
      font-size: 13px;
    }

    /* Custom Layers Control Styling with Layers Stack Icon (Right side, below top search bar) */
    .leaflet-top.leaflet-right {
      top: 76px;
      right: 12px;
      z-index: 1000;
    }
    .leaflet-control-layers {
      border-radius: 12px !important;
      border: 1px solid rgba(255, 255, 255, 0.2) !important;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3) !important;
      background: #FFFFFF !important;
      overflow: hidden;
    }
    .leaflet-control-layers-toggle {
      background-image: none !important;
      display: flex !important;
      align-items: center;
      justify-content: center;
      width: 36px !important;
      height: 36px !important;
      background-color: #FFFFFF !important;
      border-radius: 12px !important;
    }
    .leaflet-control-layers-toggle::after {
      content: '';
      display: block;
      width: 20px;
      height: 20px;
      background-repeat: no-repeat;
      background-position: center;
      background-size: contain;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Cpath fill='%23176B5B' d='M12.41 187.52l182.22 95.88a107.09 107.09 0 00122.74 0l182.22-95.88a24 24 0 000-42.51L317.37 49.13a107.09 107.09 0 00-122.74 0L12.41 145.01a24 24 0 000 42.51z'/%3E%3Cpath fill='%23176B5B' d='M256 360a107 107 0 01-61.37-19.12L12.41 245a24 24 0 00-12.41 21.26v3.74a24 24 0 0012.41 21.25L194.63 387.1a107.09 107.09 0 00122.74 0l182.22-95.88A24 24 0 00512 270v-3.74a24 24 0 00-12.41-21.26l-182.22 95.88A107 107 0 01256 360z'/%3E%3Cpath fill='%23176B5B' d='M256 464a107 107 0 01-61.37-19.12L12.41 349a24 24 0 00-12.41 21.26v3.74a24 24 0 0012.41 21.25L194.63 491.1a107.09 107.09 0 00122.74 0l182.22-95.88A24 24 0 00512 374v-3.74a24 24 0 00-12.41-21.26l-182.22 95.88A107 107 0 01256 464z'/%3E%3C/svg%3E");
    }

    /* Minimalist Floating AOI Toolbar */
    .aoi-toolbar {
      position: absolute;
      top: 130px;
      right: 12px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
    }
    .aoi-pill-status {
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 20px;
      padding: 5px 12px;
      font-size: 11px;
      color: #F1F5F9;
      box-shadow: 0 4px 12px rgba(0,0,0,0.35);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .aoi-btn-group {
      display: flex;
      gap: 6px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      padding: 4px 6px;
      border-radius: 24px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 4px 15px rgba(0,0,0,0.35);
    }
    .aoi-circle-btn {
      width: 32px;
      height: 32px;
      border-radius: 16px;
      border: none;
      background: #334155;
      color: #FFFFFF;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.15s, background 0.15s;
    }
    .aoi-circle-btn:hover {
      background: #475569;
      transform: scale(1.08);
    }
    .aoi-circle-btn:active {
      transform: scale(0.92);
    }
    .aoi-circle-btn-primary {
      background: #176B5B;
    }
    .aoi-circle-btn-primary:hover {
      background: #125548;
    }
    .aoi-circle-btn-danger {
      background: #991B1B;
    }
    .aoi-circle-btn-danger:hover {
      background: #7F1D1D;
    }
    .aoi-vertex-icon {
      background: #F59E0B;
      border: 2px solid #FFFFFF;
      border-radius: 50%;
      width: 12px;
      height: 12px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <!-- Floating Navigation Controls (+ / - / Fit Bounds) -->
  <div class="map-nav-toolbar">
    <button class="map-nav-btn" id="btn-zoom-in" title="Zoomer">+</button>
    <button class="map-nav-btn" id="btn-zoom-out" title="Dézoomer">−</button>
    <button class="map-nav-btn" id="btn-fit-bounds" title="Recadrer la vue sur le chantier"><span class="map-nav-btn-icon">⛶</span></button>
  </div>

  <!-- Injected Map Configuration Data -->
  <script id="gis-config-data" type="application/json">
    ${serializedConfig}
  </script>

  <!-- Production Communication Bridge -->
  <script>
    function sendToParent(msgObj) {
      try {
        var str = typeof msgObj === 'string' ? msgObj : JSON.stringify(msgObj);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(str);
        } else if (window.parent && window.parent.postMessage) {
          window.parent.postMessage(msgObj, "*");
        }
      } catch (e) {}
    }

    window.handleSelectCorridor = function(corridorId) {
      sendToParent({ type: 'SELECT_CORRIDOR', corridorId: Number(corridorId) });
    };
  </script>

  <!-- Inlined Proj4 Library -->
  <script>
    ${PROJ4_JS}
  </script>

  <!-- Inlined Leaflet Library -->
  <script>
    ${LEAFLET_JS}
  </script>

  <!-- Map Initialization & Production GIS Workflow Logic -->
  <script>
    try {
      var configEl = document.getElementById("gis-config-data");
      var config = {};
      try {
        config = JSON.parse(configEl.textContent || "{}");
      } catch (e) {
        config = {};
      }

      var rawRef = config.rawRef;
      var rawGeoJson = config.rawGeoJson;
      var rawSearchLoc = config.rawSearchLoc;
      var rawTroncons = config.rawTroncons || [];
      var rawCustomMarkers = config.customMarkers || [];
      var rawCustomLines = config.customLines || [];
      var rawCorridors = config.rawCorridors || [];
      var selectedCorridorId = config.selectedCorridorId;
      var rawAoi = config.rawAoi;
      var enableDrawing = !!config.enableDrawing;
      var selectedId = config.selectedId;
      var colors = config.colors || ["#0EA5E9", "#10B981", "#F59E0B"];
      var optimizePkLabels = !!config.optimizePkLabels;
      var fitPaddingBottom = config.fitPaddingBottom || 35;
      var mapContainer = document.getElementById('map');
      if (mapContainer) {
        function startInteracting() {
          sendToParent({ type: 'MAP_INTERACTION', active: true });
        }
        function stopInteracting() {
          sendToParent({ type: 'MAP_INTERACTION', active: false });
        }
        mapContainer.addEventListener('pointerdown', startInteracting, { passive: true });
        mapContainer.addEventListener('touchstart', startInteracting, { passive: true });
        mapContainer.addEventListener('pointermove', function(e) {
          if (e.buttons > 0) startInteracting();
        }, { passive: true });
        window.addEventListener('pointerup', stopInteracting, { passive: true });
        window.addEventListener('touchend', stopInteracting, { passive: true });
        window.addEventListener('pointercancel', stopInteracting, { passive: true });
        window.addEventListener('touchcancel', stopInteracting, { passive: true });
      }

      // Register Morocco Projected Coordinate Systems
      if (typeof proj4 !== 'undefined') {
        proj4.defs('EPSG:26191', '+proj=lcc +lat_1=33.3 +lat_0=33.3 +lon_0=-5.4 +k_0=0.999625769 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs');
        proj4.defs('EPSG:26192', '+proj=lcc +lat_1=29.7 +lat_0=29.7 +lon_0=-5.4 +k_0=0.999615596 +x_0=500000 +y_0=300000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs');
        proj4.defs('EPSG:26194', '+proj=lcc +lat_1=26.1 +lat_0=26.1 +lon_0=-5.4 +k_0=0.999616304 +x_0=1200000 +y_0=400000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs');
        proj4.defs('EPSG:26195', '+proj=lcc +lat_1=22.5 +lat_0=22.5 +lon_0=-5.4 +k_0=0.999616437 +x_0=1500000 +y_0=400000 +a=6378249.2 +b=6356515 +towgs84=31,146,47,0,0,0,0 +units=m +no_defs');
        proj4.defs('EPSG:32629', '+proj=utm +zone=29 +datum=WGS84 +units=m +no_defs');
        proj4.defs('EPSG:32630', '+proj=utm +zone=30 +datum=WGS84 +units=m +no_defs');
      }

      function sanitizeToWgs84(geojson) {
        if (!geojson) return null;
        try {
          var copy = JSON.parse(JSON.stringify(geojson));
          function transformCoord(coord) {
            if (!Array.isArray(coord) || coord.length < 2) return null;
            var x = Number(coord[0]);
            var y = Number(coord[1]);
            if (!isFinite(x) || !isFinite(y)) return null;

            // If already in standard WGS84
            if (Math.abs(x) <= 180 && Math.abs(y) <= 90) {
              return [x, y];
            }

            // Projected (Lambert Maroc)
            if (typeof proj4 !== 'undefined') {
              var sridCode = (y < 250000) ? 'EPSG:26192' : 'EPSG:26191';
              try {
                var wgs = proj4(sridCode, 'EPSG:4326', [x, y]);
                if (wgs && isFinite(wgs[0]) && isFinite(wgs[1]) && Math.abs(wgs[0]) <= 180 && Math.abs(wgs[1]) <= 90) {
                  return [Number(wgs[0].toFixed(6)), Number(wgs[1].toFixed(6))];
                }
              } catch(pe) {}
            }
            return null;
          }

          function walkGeom(geom) {
            if (!geom || !geom.coordinates) return;
            if (geom.type === 'Point') {
              geom.coordinates = transformCoord(geom.coordinates) || [0, 0];
            } else if (geom.type === 'LineString' || geom.type === 'MultiPoint') {
              geom.coordinates = geom.coordinates.map(transformCoord).filter(function(c) { return !!c; });
            } else if (geom.type === 'Polygon' || geom.type === 'MultiLineString') {
              geom.coordinates = geom.coordinates.map(function(ring) {
                if (!Array.isArray(ring)) return [];
                return ring.map(transformCoord).filter(function(c) { return !!c; });
              }).filter(function(r) { return r.length > 0; });
            } else if (geom.type === 'MultiPolygon') {
              geom.coordinates = geom.coordinates.map(function(poly) {
                if (!Array.isArray(poly)) return [];
                return poly.map(function(ring) {
                  if (!Array.isArray(ring)) return [];
                  return ring.map(transformCoord).filter(function(c) { return !!c; });
                }).filter(function(r) { return r.length > 0; });
              }).filter(function(p) { return p.length > 0; });
            }
          }

          if (copy.type === 'FeatureCollection' && Array.isArray(copy.features)) {
            copy.features.forEach(function(f) { if (f && f.geometry) walkGeom(f.geometry); });
          } else if (copy.type === 'Feature' && copy.geometry) {
            walkGeom(copy.geometry);
          } else if (copy.type && copy.coordinates) {
            walkGeom(copy);
          }
          return copy;
        } catch(e) {
          return geojson;
        }
      }

      var initCenter = [34.12, -6.70];
      if (Array.isArray(config.center) && config.center.length >= 2 && isFinite(config.center[0]) && isFinite(config.center[1])) {
        initCenter = config.center;
      }
      var initZoom = config.zoom || 11;

      var map = L.map("map", {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        doubleClickZoom: true,
        dragging: true,
        touchZoom: true,
        inertia: true,
        inertiaDeceleration: 3000
      }).setView(initCenter, initZoom);

      // Nav Toolbar and Zoom / Overview Buttons with robust event handling
      var navToolbar = document.querySelector(".map-nav-toolbar");
      if (navToolbar && typeof L.DomEvent !== "undefined") {
        L.DomEvent.disableClickPropagation(navToolbar);
        L.DomEvent.disableScrollPropagation(navToolbar);
      }

      var btnZoomIn = document.getElementById("btn-zoom-in");
      var btnZoomOut = document.getElementById("btn-zoom-out");
      var btnFitBounds = document.getElementById("btn-fit-bounds");

      if (btnZoomIn && typeof L.DomEvent !== "undefined") {
        L.DomEvent.on(btnZoomIn, "click", function(e) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          map.zoomIn();
        });
      }
      if (btnZoomOut && typeof L.DomEvent !== "undefined") {
        L.DomEvent.on(btnZoomOut, "click", function(e) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          map.zoomOut();
        });
      }
      if (btnFitBounds && typeof L.DomEvent !== "undefined") {
        L.DomEvent.on(btnFitBounds, "click", function(e) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
          fitAllFeatures(true);
        });
      }

      // Multi-provider Tile Layers (Google Maps + Carto Voyager + Esri + OSM)
      var googleStreets = L.tileLayer("https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}", {
        maxZoom: 20,
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        attribution: "Google Maps"
      });

      var googleHybrid = L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
        maxZoom: 20,
        subdomains: ["mt0", "mt1", "mt2", "mt3"],
        attribution: "Google Satellite"
      });

      var cartoVoyager = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; CARTO &copy; OpenStreetMap"
      });

      var esriStreet = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri"
      });

      var osmLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        subdomains: ["a", "b", "c"],
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap"
      });

      // Default to Google Streets / Carto with seamless fallback
      googleStreets.addTo(map);

      googleStreets.on("tileerror", function() {
        if (map.hasLayer(googleStreets)) {
          map.removeLayer(googleStreets);
          cartoVoyager.addTo(map);
        }
      });

      cartoVoyager.on("tileerror", function() {
        if (map.hasLayer(cartoVoyager)) {
          map.removeLayer(cartoVoyager);
          esriStreet.addTo(map);
        }
      });

      L.control.layers({
        "Google Plan": googleStreets,
        "Google Satellite": googleHybrid,
        "Plan Urbain (CARTO)": cartoVoyager,
        "Rues & Relief (Esri)": esriStreet,
        "OpenStreetMap": osmLayer
      }, null, { position: "topright" }).addTo(map);

      L.control.scale({ imperial: false, metric: true, position: "bottomleft" }).addTo(map);

      var featureGroup = L.featureGroup().addTo(map);
      var aoiLayerGroup = L.layerGroup().addTo(map);
      var referenceStartCoord = null;
      var referenceEndCoord = null;
      var searchMarker = null;

      function fitAllFeatures(isUserTriggered) {
        try {
          map.invalidateSize();

          // Calculate combined bounds across all displayed vector layers
          var combinedBounds = null;

          if (featureGroup && featureGroup.getLayers && featureGroup.getLayers().length > 0) {
            var fgBounds = featureGroup.getBounds();
            if (fgBounds && fgBounds.isValid && fgBounds.isValid()) {
              combinedBounds = L.latLngBounds(fgBounds.getSouthWest(), fgBounds.getNorthEast());
            }
          }

          // Include any interactive drawing polygon points
          if (typeof drawnPoints !== 'undefined' && Array.isArray(drawnPoints) && drawnPoints.length > 0) {
            drawnPoints.forEach(function(pt) {
              if (Array.isArray(pt) && pt.length >= 2 && isFinite(pt[0]) && isFinite(pt[1])) {
                var latLng = [pt[1], pt[0]];
                if (!combinedBounds) {
                  combinedBounds = L.latLngBounds([latLng, latLng]);
                } else {
                  combinedBounds.extend(latLng);
                }
              }
            });
          }

          // Fit bounds with comfortable top padding for search bar and bottom padding for monitoring sheet
          if (combinedBounds && combinedBounds.isValid && combinedBounds.isValid()) {
            var n = combinedBounds.getNorth();
            var s = combinedBounds.getSouth();
            var e = combinedBounds.getEast();
            var w = combinedBounds.getWest();
            if (isFinite(n) && isFinite(s) && isFinite(e) && isFinite(w) && Math.abs(n) <= 90 && Math.abs(s) <= 90) {
              map.fitBounds(combinedBounds, {
                paddingTopLeft: [35, 76],
                paddingBottomRight: [35, fitPaddingBottom || 35],
                maxZoom: 16,
                animate: !!isUserTriggered
              });
              return;
            }
          }

          // If only search location is present
          if (rawSearchLoc && typeof rawSearchLoc.lat === "number" && typeof rawSearchLoc.lon === "number" && isFinite(rawSearchLoc.lat) && isFinite(rawSearchLoc.lon)) {
            map.setView([rawSearchLoc.lat, rawSearchLoc.lon], 13, { animate: !!isUserTriggered });
            if (searchMarker && searchMarker.openPopup) searchMarker.openPopup();
            return;
          }

          // Safe fallback to project initial center
          map.setView(initCenter, initZoom, { animate: !!isUserTriggered });
        } catch(e) {
          map.setView(initCenter, initZoom);
        }
      }

      // Render Searched Location Pin
      if (rawSearchLoc && typeof rawSearchLoc.lat === "number" && typeof rawSearchLoc.lon === "number") {
        var searchIcon = L.divIcon({
          className: 'search-pin-icon',
          html: '<div style="background:#EF4444;color:#FFF;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.5);border:2px solid #FFF;font-size:13px;">📍</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        searchMarker = L.marker([rawSearchLoc.lat, rawSearchLoc.lon], { icon: searchIcon, zIndexOffset: 2000 })
          .bindPopup('<div class="custom-popup"><div class="popup-title">📍 ' + (rawSearchLoc.label || 'Localisation sélectionnée') + '</div><div class="popup-detail">Zone cadrée pour le chantier</div></div>')
          .addTo(featureGroup);
      }

      // Render Background Source Infrastructure GeoJSON
      var safeGeoJson = sanitizeToWgs84(rawGeoJson);
      if (safeGeoJson) {
        try {
          L.geoJSON(safeGeoJson, {
            style: {
              color: "#38BDF8",
              weight: 8,
              opacity: 0.35,
              lineCap: "round",
              lineJoin: "round"
            }
          }).addTo(featureGroup);

          L.geoJSON(safeGeoJson, {
            style: {
              color: "#0284C7",
              weight: 4.5,
              opacity: 0.95,
              lineCap: "round",
              lineJoin: "round"
            },
            onEachFeature: function(feat, layer) {
              var label = (feat.properties && (feat.properties.name || feat.properties.nom || feat.properties.type)) || "Tracé d'infrastructure importé";
              layer.bindPopup('<div class="custom-popup"><div class="popup-title">📍 ' + label + '</div><div class="popup-detail">Infrastructure importée (Source SIG)</div></div>');
            }
          }).addTo(featureGroup);

          function getFirstPoint(obj) {
            if (!obj) return null;
            if (obj.type === 'FeatureCollection' && Array.isArray(obj.features) && obj.features[0]) {
              return getFirstPoint(obj.features[0]);
            }
            if (obj.type === 'Feature' && obj.geometry) {
              return getFirstPoint(obj.geometry);
            }
            if (obj.coordinates && Array.isArray(obj.coordinates)) {
              var c = obj.coordinates;
              while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
              if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
                return c;
              }
            }
            return null;
          }

          var firstPt = getFirstPoint(safeGeoJson);
          if (firstPt) {
            var startIcon = L.divIcon({
              className: 'raw-start-marker',
              html: '<div style="display:flex;align-items:center;background:#0284C7;color:#FFFFFF;border:2px solid #FFFFFF;border-radius:18px;padding:3px 9px;font-size:11px;font-weight:bold;box-shadow:0 3px 8px rgba(0,0,0,0.45);white-space:nowrap;"><span style="font-size:12px;margin-right:4px;">📍</span> Tracé importé</div>',
              iconAnchor: [55, 14]
            });
            L.marker([firstPt[1], firstPt[0]], { icon: startIcon, zIndexOffset: 800 })
              .bindPopup('<div class="custom-popup"><div class="popup-title">📍 Tracé Source SIG</div><div class="popup-detail">Point de repère du tracé importé</div></div>')
              .addTo(featureGroup);
          }
        } catch(e) {}
      }

      // Render AOI Polygon (Zone d'Étude)
      function renderAoiPolygon(aoiGeom) {
        aoiLayerGroup.clearLayers();
        if (!aoiGeom) return;
        try {
          var aoiLayer = L.geoJSON(aoiGeom, {
            style: {
              color: "#F59E0B",
              fillColor: "#F59E0B",
              fillOpacity: 0.22,
              weight: 2.5,
              dashArray: "6, 6"
            }
          });
          aoiLayer.bindPopup('<div class="custom-popup"><div class="popup-title" style="color:#F59E0B;">📍 Zone d&apos;Étude du Chantier (AOI)</div><div class="popup-detail">Emprise spatiale enregistrée pour le filtrage des corridors.</div></div>');
          aoiLayer.addTo(aoiLayerGroup);
          aoiLayer.addTo(featureGroup);
        } catch(e) {}
      }

      if (rawAoi) {
        renderAoiPolygon(rawAoi);
      }

      function formatPK(val) {
        if (val === undefined || val === null) return "PK 0+000";
        var num = Number(val);
        var km = Math.floor(num);
        var m = Math.round((num - km) * 1000);
        var mStr = m < 10 ? "00" + m : (m < 100 ? "0" + m : "" + m);
        return "PK " + km + "+" + mStr;
      }

      function getStatusColor(statut, idx) {
        if (!statut) return "#64748B";
        var s = String(statut).toUpperCase();
        if (s === "TERMINE" || s === "TERMINÉ") return "#16A34A";
        if (s === "EN_COURS") return "#2563EB";
        if (s === "PROBLEME" || s === "PROBLÈME" || s === "RETARD") return "#DC2626";
        return "#64748B";
      }

      // Render Reference Alignment
      if (rawRef && rawRef.coordinates) {
        try {
          var hasTroncons = rawTroncons && rawTroncons.length > 0;
          if (!hasTroncons) {
            L.geoJSON({
              type: "Feature",
              geometry: rawRef
            }, {
              style: {
                color: "#0284C7",
                weight: 8,
                opacity: 0.35
              }
            }).addTo(featureGroup);
          }

          L.geoJSON({
            type: "Feature",
            geometry: rawRef
          }, {
            style: {
              color: hasTroncons ? "#64748B" : "#0284C7",
              weight: hasTroncons ? 3.5 : 4.5,
              opacity: hasTroncons ? 0.65 : 0.95,
              dashArray: hasTroncons ? "5, 6" : undefined
            }
          }).addTo(featureGroup);

          var coords = [];
          if (rawRef.type === "LineString") coords = rawRef.coordinates;
          else if (rawRef.type === "MultiLineString" && rawRef.coordinates.length > 0) coords = rawRef.coordinates[0];

          if (coords && coords.length >= 2) {
            var startCoord = coords[0];
            var endCoord = coords[coords.length - 1];
            if (Array.isArray(startCoord) && Array.isArray(endCoord) && typeof startCoord[0] === 'number') {
              referenceStartCoord = startCoord;
              referenceEndCoord = endCoord;

              var startLatLng = [startCoord[1], startCoord[0]];
              var endLatLng = [endCoord[1], endCoord[0]];

              var originIcon = L.divIcon({
                className: "origin-marker",
                html: "<div style='display:flex;align-items:center;background:#16A34A;color:#FFFFFF;border:2px solid #FFFFFF;border-radius:18px;padding:3px 9px;font-size:11px;font-weight:bold;box-shadow:0 3px 8px rgba(0,0,0,0.45);white-space:nowrap;'><span style='font-size:12px;margin-right:4px;'>🟢</span> PK 0+000 (Début)</div>",
                iconAnchor: optimizePkLabels ? [55, 34] : [55, 14]
              });
              L.marker(startLatLng, { icon: originIcon, zIndexOffset: 1000 })
                .bindPopup("<div class='custom-popup'><div class='popup-title' style='color:#16A34A;'>🟢 Origine du Chantier — PK 0+000</div><div class='popup-detail'>Point d'entrée du linéaire dans la zone d'étude.</div></div>")
                .addTo(featureGroup);

              var endIcon = L.divIcon({
                className: "end-marker",
                html: "<div style='display:flex;align-items:center;background:#DC2626;color:#FFFFFF;border:2px solid #FFFFFF;border-radius:18px;padding:3px 9px;font-size:11px;font-weight:bold;box-shadow:0 3px 8px rgba(0,0,0,0.45);white-space:nowrap;'><span style='font-size:12px;margin-right:4px;'>🔴</span> Fin du Chantier</div>",
                iconAnchor: optimizePkLabels ? [50, 34] : [50, 14]
              });
              L.marker(endLatLng, { icon: endIcon, zIndexOffset: 1000 })
                .bindPopup("<div class='custom-popup'><div class='popup-title' style='color:#DC2626;'>🔴 Fin du Chantier</div><div class='popup-detail'>Point de fin du linéaire dans la zone d'étude.</div></div>")
                .addTo(featureGroup);

              var midIdx = Math.floor(coords.length / 2);
              if (midIdx > 0 && midIdx < coords.length) {
                var p1 = coords[midIdx - 1];
                var p2 = coords[midIdx];
                var dx = p2[0] - p1[0];
                var dy = p2[1] - p1[1];
                var angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
                var midLatLng = [(p1[1] + p2[1]) / 2, (p1[0] + p2[0]) / 2];

                var arrowIcon = L.divIcon({
                  className: "dir-arrow-icon",
                  html: "<div style='transform:rotate(" + (-angleDeg) + "deg);width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:#0284C7;color:#FFF;border-radius:50%;font-size:13px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.45);border:2px solid #FFF;'>➜</div>",
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                });
                L.marker(midLatLng, { icon: arrowIcon, zIndexOffset: 800 })
                  .bindPopup("<div class='custom-popup'><div class='popup-title' style='color:#0284C7;'>➡ Sens de Progression</div><div class='popup-detail'>Direction croissante des points kilométriques.</div></div>")
                  .addTo(featureGroup);
              }
            }
          }
        } catch(e) {}
      }

      // Render Candidate Corridors with robust selection
      if (rawCorridors && rawCorridors.length > 0) {
        rawCorridors.forEach(function(c) {
          if (!c.geometry) return;
          var isSelected = selectedCorridorId !== null && Number(c.id) === Number(selectedCorridorId);
          var isRec = !!c.is_recommended;
          var intersects = !!c.intersects_aoi;
          var color = isSelected ? "#10B981" : (isRec ? "#F59E0B" : (intersects ? "#38BDF8" : "#64748B"));
          var weight = isSelected ? 7 : (isRec ? 6 : 4);
          var opacity = isSelected ? 1.0 : (intersects ? 0.9 : 0.6);

          if (isSelected || isRec) {
            L.geoJSON(c.geometry, {
              style: {
                color: isSelected ? "#34D399" : "#FBBF24",
                weight: weight + 6,
                opacity: 0.4,
                lineCap: "round"
              }
            }).addTo(featureGroup);
          }

          var cLayer = L.geoJSON(c.geometry, {
            style: {
              color: color,
              weight: weight,
              opacity: opacity,
              lineCap: "round"
            }
          }).addTo(featureGroup);

          var safeReason = c.recommendation_reason ? String(c.recommendation_reason).replace(/"/g, '&quot;') : '';
          var popupContent = '<div class="custom-popup">' +
            '<div class="popup-title">' + (isRec ? '⭐ ' : '') + c.nom + '</div>' +
            (isRec ? '<div class="popup-badge popup-badge-gold">🏆 TRACÉ RECOMMANDÉ</div><br/>' : '') +
            '<div class="popup-detail"><b>Longueur Totale :</b> ' + parseFloat(c.length_km).toFixed(2) + ' km</div>' +
            (c.length_in_aoi_km !== undefined ? ('<div class="popup-detail"><b>Dans la Zone d&apos;Étude :</b> ' + parseFloat(c.length_in_aoi_km).toFixed(2) + ' km (' + (c.coverage_aoi_percent || 0) + '%)</div>') : '') +
            '<div class="popup-detail"><b>Intersection AOI :</b> ' + (intersects ? '✅ Oui' : '❌ Non') + '</div>' +
            (safeReason ? ('<div class="popup-detail" style="color:#FBBF24; margin-top:4px;"><i>' + safeReason + '</i></div>') : '') +
            '<div style="margin-top:8px;"><button style="background:#176B5B;color:#FFF;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;" onclick="window.handleSelectCorridor(' + c.id + ')">Choisir ce tracé</button></div>' +
          '</div>';

          cLayer.bindPopup(popupContent);
          cLayer.on("click", function() {
            window.handleSelectCorridor(c.id);
          });
        });
      }

      // Render Tronçons (Linear Referencing)
      if (rawTroncons && rawTroncons.length > 0) {
        rawTroncons.forEach(function(tr, idx) {
          if (!tr.geometry) return;
          var isSelected = selectedId && (String(tr.id) === String(selectedId) || String(idx + 1) === String(selectedId));
          var color = tr.color || getStatusColor(tr.statut, idx);

          if (isSelected) {
            L.geoJSON({
              type: "Feature",
              geometry: tr.geometry
            }, {
              style: {
                color: "#FACC15",
                weight: 14,
                opacity: 0.45,
                lineCap: "round"
              }
            }).addTo(featureGroup);
          }

          var tLayer = L.geoJSON({
            type: "Feature",
            geometry: tr.geometry,
            properties: tr
          }, {
            style: {
              color: color,
              weight: isSelected ? 8 : 6,
              opacity: 0.95,
              lineCap: "round"
            }
          }).addTo(featureGroup);

          var popupContent = '<div class="custom-popup">' +
            '<div class="popup-title">' + (tr.nom || ('Tronçon ' + (idx + 1))) + '</div>' +
            '<div class="popup-badge" style="background:' + color + '22; color:' + color + '">' +
              formatPK(tr.pk_debut) + ' &rarr; ' + formatPK(tr.pk_fin) +
            '</div>' +
            '<div class="popup-detail"><b>Longueur :</b> ' + (tr.length_km ? parseFloat(tr.length_km).toFixed(2) + ' km' : '—') + '</div>' +
            (tr.statut ? ('<div class="popup-detail"><b>Statut :</b> ' + tr.statut + '</div>') : '') +
          '</div>';

          tLayer.bindPopup(popupContent);

          if (!optimizePkLabels) try {
            var coords = tr.geometry.coordinates;
            if (coords && coords.length > 0) {
              var firstCoord = coords[0];
              while (Array.isArray(firstCoord) && Array.isArray(firstCoord[0])) firstCoord = firstCoord[0];
              if (Array.isArray(firstCoord) && typeof firstCoord[0] === 'number') {
                var pkIcon = L.divIcon({
                  className: "custom-pk-icon",
                  html: '<div class="pk-pill" style="background:' + color + ';' + (isSelected ? 'border:2px solid #FACC15; transform:scale(1.1);' : '') + '">' + formatPK(tr.pk_debut) + '</div>',
                  iconSize: [60, 20],
                  iconAnchor: [30, 10]
                });
                L.marker([firstCoord[1], firstCoord[0]], { icon: pkIcon }).addTo(featureGroup);
              }
            }
          } catch(e) {}
        });
      }

      // Minimalist AOI Drawing Mode
      var drawnPoints = [];
      var drawnMarkers = [];
      var drawingPolyline = null;
      var drawingPolygon = null;

      if (enableDrawing) {
        var toolbarDiv = document.createElement("div");
        toolbarDiv.className = "aoi-toolbar";
        toolbarDiv.innerHTML = 
          '<div class="aoi-pill-status" id="aoiStatusPill">' +
            '<span>✏️</span><span id="aoiStatusText">Mode dessin actif (min. 4 sommets)</span>' +
          '</div>' +
          '<div class="aoi-btn-group">' +
            '<button class="aoi-circle-btn" id="btnUndo" title="Annuler le dernier sommet">↶</button>' +
            '<button class="aoi-circle-btn aoi-circle-btn-danger" id="btnClear" title="Effacer la zone">↺</button>' +
            '<button class="aoi-circle-btn aoi-circle-btn-primary" id="btnClose" title="Fermer le polygone">✓</button>' +
          '</div>';
        document.body.appendChild(toolbarDiv);

        function updateDrawingUI() {
          var count = drawnPoints.length;
          var statusText = document.getElementById("aoiStatusText");
          if (statusText) {
            if (count === 0) statusText.innerText = "Touchez la carte pour placer le 1er sommet";
            else if (count < 4) statusText.innerText = count + " sommet(s) placé(s) (min. 4 requis)";
            else statusText.innerText = count + " sommets — Touchez ✓ pour finaliser";
          }

          if (drawingPolyline) map.removeLayer(drawingPolyline);
          if (drawingPolygon) map.removeLayer(drawingPolygon);

          if (count >= 2) {
            var latlngs = drawnPoints.map(function(pt) { return [pt[1], pt[0]]; });
            drawingPolyline = L.polyline(latlngs, {
              color: "#F59E0B",
              weight: 3,
              dashArray: "5, 5"
            }).addTo(map);

            if (count >= 3) {
              drawingPolygon = L.polygon(latlngs, {
                color: "#F59E0B",
                fillColor: "#F59E0B",
                fillOpacity: 0.25,
                weight: 2
              }).addTo(map);
            }
          }
        }

        function notifyParentAOI() {
          if (drawnPoints.length >= 4) {
            var coords = drawnPoints.slice();
            var first = coords[0];
            var last = coords[coords.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              coords.push([first[0], first[1]]);
            }
            sendToParent({ type: "AOI_CHANGED", coordinates: coords });
          }
        }

        map.on("click", function(e) {
          var lng = Number(e.latlng.lng.toFixed(6));
          var lat = Number(e.latlng.lat.toFixed(6));
          drawnPoints.push([lng, lat]);

          var marker = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "aoi-vertex-marker",
              html: '<div class="aoi-vertex-icon"></div>',
              iconSize: [12, 12],
              iconAnchor: [6, 6]
            }),
            draggable: true
          }).addTo(map);

          var ptIdx = drawnPoints.length - 1;
          marker.on("drag", function(dragEvt) {
            var newPos = dragEvt.target.getLatLng();
            drawnPoints[ptIdx] = [Number(newPos.lng.toFixed(6)), Number(newPos.lat.toFixed(6))];
            updateDrawingUI();
            notifyParentAOI();
          });

          drawnMarkers.push(marker);
          updateDrawingUI();
          notifyParentAOI();
        });

        var btnUndo = document.getElementById("btnUndo");
        var btnClear = document.getElementById("btnClear");
        var btnClose = document.getElementById("btnClose");

        if (btnUndo) {
          btnUndo.onclick = function() {
            if (drawnPoints.length > 0) {
              drawnPoints.pop();
              var m = drawnMarkers.pop();
              if (m) map.removeLayer(m);
              updateDrawingUI();
              notifyParentAOI();
            }
          };
        }

        if (btnClear) {
          btnClear.onclick = function() {
            drawnPoints = [];
            drawnMarkers.forEach(function(m) { map.removeLayer(m); });
            drawnMarkers = [];
            updateDrawingUI();
            sendToParent({ type: "AOI_CHANGED", coordinates: [] });
          };
        }

        if (btnClose) {
          btnClose.onclick = function() {
            if (drawnPoints.length >= 4) {
              notifyParentAOI();
            }
          };
        }
      }

      // Render real-to-projected offset lines before their markers.
      rawCustomLines.forEach(function(line) {
        if (!line || !line.start || !line.end) return;
        var offsetLine = L.polyline(
          [[line.start.lat, line.start.lng], [line.end.lat, line.end.lng]],
          { color: line.color || "#F59E0B", weight: 2, dashArray: "5, 5", opacity: 0.9 }
        ).addTo(featureGroup);
        if (line.label) offsetLine.bindTooltip(line.label, { sticky: true });
      });

      // Render Custom / GPS Observation Markers
      if (rawCustomMarkers && rawCustomMarkers.length > 0) {
        rawCustomMarkers.forEach(function(m) {
          if (!m || typeof m.lat !== "number" || typeof m.lng !== "number") return;
          var color = m.color || "#0284C7";
          var isGps = m.iconName === "gps" || (m.label && m.label.toLowerCase().indexOf("gps") !== -1);

          var markerHtml = isGps
            ? "<div style='position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;'><div style='position:absolute;width:32px;height:32px;border-radius:16px;background:" + color + "44;border:1px solid " + color + "88;'></div><div style='width:16px;height:16px;border-radius:8px;background:" + color + ";border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.5);'></div></div>"
            : "<div style='background:" + color + ";color:#FFF;font-size:12px;font-weight:bold;width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;border:2.5px solid #FFF;box-shadow:0 3px 8px rgba(0,0,0,0.4);'>📍</div>";

          var cIcon = L.divIcon({
            className: "custom-point-marker",
            html: markerHtml,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });

          var marker = L.marker([m.lat, m.lng], { icon: cIcon, zIndexOffset: 1500 }).addTo(featureGroup);
          if (m.label) {
            marker.bindPopup("<div class='custom-popup'><div class='popup-title' style='color:" + color + ";'>" + m.label + "</div>" + (m.sublabel ? ("<div class='popup-detail'>" + m.sublabel + "</div>") : "") + "</div>");
          }
        });
      }

      // Fit map to features immediately
      fitAllFeatures();
      setTimeout(function() { fitAllFeatures(); }, 150);
      setTimeout(function() { map.invalidateSize(); }, 500);
      window.addEventListener("resize", function() { map.invalidateSize(); });

    } catch (err) {
      console.error("GIS map init error:", err);
      sendToParent({ type: "MAP_ERROR", error: String(err) });
    }
  </script>
</body>
</html>`;
  }, [
    referenceGeometry,
    rawGeoJson,
    searchLocation,
    troncons,
    corridors,
    selectedCorridorId,
    aoiGeometry,
    enableAoiDrawing,
    selectedTronconId,
    center,
    zoom,
    fitPaddingBottom,
    optimizePkLabels,
    customMarkers,
    customLines,
  ]);

  if (Platform.OS === 'web') {
    return (
      <View
        style={[styles.container, { height }, style]}
        onTouchStart={() => onInteractionChange?.(true)}
        onTouchEnd={() => onInteractionChange?.(false)}
        onTouchCancel={() => onInteractionChange?.(false)}
        onResponderGrant={() => onInteractionChange?.(true)}
        onResponderRelease={() => onInteractionChange?.(false)}
      >
        <iframe
          ref={iframeRef}
          srcDoc={leafletHtml}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            borderRadius: 16,
          }}
          title="Interactive GIS Map"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { height }, style]}
      onTouchStart={() => onInteractionChange?.(true)}
      onTouchEnd={() => onInteractionChange?.(false)}
      onTouchCancel={() => onInteractionChange?.(false)}
      onResponderGrant={() => onInteractionChange?.(true)}
      onResponderRelease={() => onInteractionChange?.(false)}
    >
      <WebView
        originWhitelist={['*']}
        source={{
          html: leafletHtml,
          baseUrl: 'https://unpkg.com',
        }}
        onMessage={handleWebViewMessage}
        style={styles.webview}
        scrollEnabled={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mixedContentMode="always"
        allowFileAccess={true}
        allowUniversalAccessFromFileURLs={true}
        androidLayerType="hardware"
        androidHardwareAccelerationDisabled={false}
        scalesPageToFit={false}
        renderLoading={() => (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Palette.primary} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
    width: '100%',
    height: '100%',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
});
