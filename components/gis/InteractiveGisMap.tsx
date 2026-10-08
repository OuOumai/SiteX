import React, { useMemo, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator, DimensionValue } from 'react-native';
import { WebView } from 'react-native-webview';
import { Palette } from '@/constants/theme';
import { KmlMetadata, KmlGroundOverlay, KmlPhotoOverlay, getMediaUrl } from '@/services/api';
import { LEAFLET_CSS, LEAFLET_JS, PROJ4_JS } from './leafletAssets';
import type { DerivedTemporalState } from '@/lib/temporal';
import { applyTemporalProgressToSegments, isKmlElementVisible } from '@/lib/temporal';

export interface InteractiveGisMapRef {
  undo: () => void;
  clear: () => void;
  finish: () => void;
  recenter?: () => void;
  toggleSatellite?: () => void;
  toggleKml?: () => void;
  toggleKmlImages?: () => void;
  setAoiCoordinates?: (coordinates: [number, number][]) => void;
}

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
  progress_percentage?: number;
  isPrimary?: boolean;
  isSecondary?: boolean;
  showProgress?: boolean;
}

export interface GisChantierAlignment {
  id: number | string;
  nom: string;
  length_km?: number | null;
  geometry: GisFeatureGeometry;
  color?: string;
  chantier_id?: number | string;
  projet_id?: number | string;
  source?: string;
  original_filename?: string;
  ref_id?: number | string;
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
  ref?: React.Ref<InteractiveGisMapRef>;
  mapRef?: React.Ref<InteractiveGisMapRef>;
  referenceGeometry?: GisFeatureGeometry | null;
  chantierAlignments?: GisChantierAlignment[] | null;
  selectedChantierId?: number | string | null;
  onSelectChantierAlignment?: (chantierId: number | string) => void;
  rawGeoJson?: any | null;
  searchLocation?: { lat: number; lon: number; label?: string } | null;
  troncons?: GisTronconSegment[] | null;
  corridors?: GisCandidateCorridor[] | null;
  selectedCorridorId?: number | null;
  aoiGeometry?: GisFeatureGeometry | null;
  refinePreviousAoiGeometry?: GisFeatureGeometry | null;
  isRefineMode?: boolean;
  existingAois?: Array<{
    id?: number | string;
    chantierId?: number | string;
    nom: string;
    geometry: any;
    color?: string;
    surface_m2?: number;
  }> | null;
  enableAoiDrawing?: boolean;
  onAoiChange?: (coordinates: [number, number][], pointCount?: number) => void;
  onSelectCorridor?: (corridorId: number) => void;
  selectedTronconId?: number | string;
  onSelectTroncon?: (tronconId: number | string) => void;
  center?: [number, number];
  zoom?: number;
  height?: DimensionValue;
  style?: any;
  showSatelliteToggle?: boolean;
  fitPaddingBottom?: number;
  optimizePkLabels?: boolean;
  customMarkers?: {
    id?: number | string;
    lat: number;
    lng: number;
    label?: string;
    sublabel?: string;
    color?: string;
    iconName?: string;
    photoUrl?: string;
    dateTime?: string;
    phase?: string;
    workStatus?: string;
    remarks?: string;
    distanceOffset?: number;
    dailyMeters?: number;
    dailyPercentage?: number;
    totalPercentage?: number;
    validationStatus?: string;
    isFurthest?: boolean;
  }[] | null;
  selectedMarkerId?: number | string | null;
  onSelectMarker?: (markerId: number | string) => void;
  customLines?: {
    start: { lat: number; lng: number };
    end: { lat: number; lng: number };
    label?: string;
    color?: string;
  }[] | null;
  onInteractionChange?: (interacting: boolean) => void;
  // Level 3 — KML 2D Visualization
  kmlGeometry?: GisFeatureGeometry | null;
  kmlMetadata?: KmlMetadata | null;
  showKmlLayer?: boolean;
  onToggleKmlVisibility?: (visible: boolean) => void;
  onSelectKml?: (metadata: KmlMetadata) => void;
  // Level 4 — KML Images (GroundOverlay & PhotoOverlay)
  kmlGroundOverlays?: KmlGroundOverlay[] | null;
  kmlPhotoOverlays?: KmlPhotoOverlay[] | null;
  showKmlImages?: boolean;
  onToggleKmlImagesVisibility?: (visible: boolean) => void;
  onSelectKmlImage?: (overlay: KmlGroundOverlay | KmlPhotoOverlay) => void;
  // Level 6B — Temporal synchronization
  temporalState?: DerivedTemporalState | null;
}

export const TRONCON_PALETTE = [
  '#10B981', // Tronçon 1: Green / Emerald
  '#0EA5E9', // Tronçon 2: Blue / Sky
  '#F59E0B', // Tronçon 3: Orange / Amber
  '#EF4444', // Tronçon 4: Red / Coral
  '#8B5CF6', // Tronçon 5: Purple / Violet
  '#06B6D4', // Tronçon 6: Cyan
  '#EC4899', // Tronçon 7: Pink / Magenta
  '#14B8A6', // Tronçon 8: Teal
  '#6366F1', // Tronçon 9: Indigo
  '#84CC16', // Tronçon 10: Lime
];

export function getTronconColor(index: number): string {
  return TRONCON_PALETTE[Math.abs(index) % TRONCON_PALETTE.length];
}

const TRONCON_COLORS = TRONCON_PALETTE;

export function InteractiveGisMap({
  ref,
  mapRef,
  referenceGeometry,
  chantierAlignments = null,
  selectedChantierId = null,
  onSelectChantierAlignment,
  rawGeoJson,
  searchLocation,
  troncons,
  corridors,
  selectedCorridorId,
  aoiGeometry,
  refinePreviousAoiGeometry = null,
  isRefineMode = false,
  existingAois = null,
  enableAoiDrawing = false,
  onAoiChange,
  onSelectCorridor,
  selectedTronconId,
  onSelectTroncon,
  center = [34.12, -6.70],
  zoom = 11,
  height = 340,
  style,
  fitPaddingBottom = 35,
  optimizePkLabels = false,
  customMarkers = null,
  selectedMarkerId = null,
  onSelectMarker,
  customLines = null,
  onInteractionChange,
  kmlGeometry = null,
  kmlMetadata = null,
  showKmlLayer = true,
  onToggleKmlVisibility,
  onSelectKml,
  kmlGroundOverlays = null,
  kmlPhotoOverlays = null,
  showKmlImages = true,
  onToggleKmlImagesVisibility,
  onSelectKmlImage,
  temporalState = null,
}: InteractiveGisMapProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const webViewRef = useRef<WebView | null>(null);

  const executeAction = (action: 'undo' | 'clear' | 'finish' | 'recenter' | 'toggleSatellite' | 'toggleKml' | 'toggleKmlImages') => {
    if (Platform.OS === 'web') {
      try {
        const iframe = iframeRef.current;
        if (iframe && iframe.contentWindow) {
          (iframe.contentWindow as any).gisMapAction?.(action);
          iframe.contentWindow.postMessage({ type: 'GIS_ACTION', action }, '*');
        }
      } catch (e) {}
    } else {
      try {
        webViewRef.current?.injectJavaScript(`
          (function() {
            if (window.gisMapAction) {
              window.gisMapAction('${action}');
            }
          })();
          true;
        `);
      } catch (e) {}
    }
  };

  const targetRef = ref || mapRef;
  useImperativeHandle(targetRef, () => ({
    undo: () => executeAction('undo'),
    clear: () => executeAction('clear'),
    finish: () => executeAction('finish'),
    recenter: () => executeAction('recenter'),
    toggleSatellite: () => executeAction('toggleSatellite'),
    toggleKml: () => executeAction('toggleKml'),
    toggleKmlImages: () => executeAction('toggleKmlImages'),
    setAoiCoordinates: (coords: [number, number][]) => {
      if (Platform.OS === 'web') {
        try {
          (iframeRef.current?.contentWindow as any)?.setAoiCoordinates?.(coords);
        } catch (e) {}
      } else {
        try {
          webViewRef.current?.injectJavaScript(`
            (function() {
              if (typeof window.setAoiCoordinates === 'function') {
                window.setAoiCoordinates(${JSON.stringify(coords)});
              }
            })();
            true;
          `);
        } catch (e) {}
      }
    },
  }));

    // Listen to messages from Leaflet (Web)
    useEffect(() => {
      if (Platform.OS === 'web') {
        const handleMessage = (event: MessageEvent) => {
          if (!event.data || typeof event.data !== 'object') return;
          if (event.data.type === 'AOI_CHANGED' && Array.isArray(event.data.coordinates)) {
            if (onAoiChange) onAoiChange(event.data.coordinates, event.data.pointCount);
          }
          if (event.data.type === 'SELECT_CORRIDOR' && event.data.corridorId !== undefined) {
            if (onSelectCorridor) onSelectCorridor(event.data.corridorId);
          }
          if (event.data.type === 'SELECT_TRONCON' && event.data.tronconId !== undefined) onSelectTroncon?.(event.data.tronconId);
          if (event.data.type === 'SELECT_MARKER' && event.data.markerId !== undefined) onSelectMarker?.(event.data.markerId);
          if (event.data.type === 'SELECT_CHANTIER' && event.data.chantierId !== undefined) onSelectChantierAlignment?.(event.data.chantierId);
          if (event.data.type === 'MAP_INTERACTION') onInteractionChange?.(!!event.data.active);
          if (event.data.type === 'SELECT_KML' && event.data.metadata !== undefined) onSelectKml?.(event.data.metadata);
          if (event.data.type === 'TOGGLE_KML_VISIBILITY' && typeof event.data.visible === 'boolean') onToggleKmlVisibility?.(event.data.visible);
          if (event.data.type === 'SELECT_KML_IMAGE' && event.data.overlay !== undefined) onSelectKmlImage?.(event.data.overlay);
          if (event.data.type === 'TOGGLE_KML_IMAGES_VISIBILITY' && typeof event.data.visible === 'boolean') onToggleKmlImagesVisibility?.(event.data.visible);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
      }
    }, [onAoiChange, onSelectCorridor, onSelectTroncon, onSelectMarker, onSelectChantierAlignment, onInteractionChange, onSelectKml, onToggleKmlVisibility, onSelectKmlImage, onToggleKmlImagesVisibility]);

    // Handle messages on React Native Mobile WebView
    const handleWebViewMessage = (event: any) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === 'AOI_CHANGED' && Array.isArray(data.coordinates)) {
          if (onAoiChange) onAoiChange(data.coordinates, data.pointCount);
        }
        if (data.type === 'SELECT_CORRIDOR' && data.corridorId !== undefined) {
          if (onSelectCorridor) onSelectCorridor(data.corridorId);
        }
        if (data.type === 'SELECT_TRONCON' && data.tronconId !== undefined) onSelectTroncon?.(data.tronconId);
        if (data.type === 'SELECT_MARKER' && data.markerId !== undefined) onSelectMarker?.(data.markerId);
        if (data.type === 'SELECT_CHANTIER' && data.chantierId !== undefined) onSelectChantierAlignment?.(data.chantierId);
        if (data.type === 'MAP_INTERACTION') {
          onInteractionChange?.(!!data.active);
        }
        if (data.type === 'SELECT_KML' && data.metadata !== undefined) {
          onSelectKml?.(data.metadata);
        }
        if (data.type === 'TOGGLE_KML_VISIBILITY' && typeof data.visible === 'boolean') {
          onToggleKmlVisibility?.(data.visible);
        }
        if (data.type === 'SELECT_KML_IMAGE' && data.overlay !== undefined) {
          onSelectKmlImage?.(data.overlay);
        }
        if (data.type === 'TOGGLE_KML_IMAGES_VISIBILITY' && typeof data.visible === 'boolean') {
          onToggleKmlImagesVisibility?.(data.visible);
        }
        if (data.type === 'MAP_ERROR') {
          console.warn('GIS Map Warning:', data.error);
        }
      } catch {}
    };

  // Stabilize AOI reference during active drawing/refining to prevent WebView reloads on every vertex
  const initialDrawingAoiRef = useRef<GisFeatureGeometry | null>(null);
  const prevDrawingFlagRef = useRef<boolean>(false);

  if (enableAoiDrawing && !prevDrawingFlagRef.current) {
    initialDrawingAoiRef.current = aoiGeometry || null;
  } else if (!enableAoiDrawing) {
    initialDrawingAoiRef.current = null;
  }
  prevDrawingFlagRef.current = !!enableAoiDrawing;

  const effectiveAoi = enableAoiDrawing ? initialDrawingAoiRef.current : (aoiGeometry || null);

  // Generate self-contained Leaflet HTML with inlined assets and robust corridor selection
  const leafletHtml = useMemo(() => {
    // ── Level 6B: Apply temporal filtering before building config ──────────
    const isHistorical = temporalState && temporalState.mode === 'historical';

    // Filter tronçons: inject historical progress/statut (geometry unchanged)
    const temporalTroncons = isHistorical && troncons && troncons.length > 0
      ? applyTemporalProgressToSegments(troncons, temporalState!)
      : (troncons && troncons.length > 0 ? troncons : []);

    // Filter customMarkers: only show observations visible at selected date
    const temporalMarkers = (() => {
      if (!customMarkers || customMarkers.length === 0) return [];
      if (!isHistorical || !temporalState!.visibleObservationIds) return customMarkers;
      return customMarkers.filter(m => {
        if (m.id === undefined || m.id === null) return true; // unknown date — keep
        const numId = typeof m.id === 'number' ? m.id : Number(m.id);
        return temporalState!.visibleObservationIds!.has(numId);
      });
    })();

    // Filter KML main geometry by its temporal metadata
    const showKmlLayerTemporal = showKmlLayer !== false && (
      !isHistorical ||
      isKmlElementVisible(kmlMetadata?.time, temporalState?.selectedDateTime ?? null)
    );

    const mapConfig = {
      rawRef: referenceGeometry || null,
      rawChantierAlignments: chantierAlignments && chantierAlignments.length > 0 ? chantierAlignments : [],
      selectedChantierId: selectedChantierId ?? null,
      rawGeoJson: rawGeoJson || null,
      kmlGeometry: kmlGeometry || null,
      rawKmlGeom: kmlGeometry || null,
      rawKmlMeta: kmlMetadata || null,
      rawKmlGroundOverlays: (kmlGroundOverlays || (kmlMetadata && kmlMetadata.groundOverlays) || []).map((go) => {
        if (!go || !go.icon || !go.icon.href) return go;
        return {
          ...go,
          icon: {
            ...go.icon,
            href: getMediaUrl(go.icon.href),
          },
        };
      }),
      rawKmlPhotoOverlays: (kmlPhotoOverlays || (kmlMetadata && kmlMetadata.photoOverlays) || []).map((po) => {
        if (!po || !po.icon || !po.icon.href) return po;
        return {
          ...po,
          icon: {
            ...po.icon,
            href: getMediaUrl(po.icon.href),
          },
        };
      }),
      showKmlImages: showKmlImages !== false,
      rawSearchLoc: searchLocation || null,
      rawTroncons: temporalTroncons,
      rawCorridors: corridors && corridors.length > 0 ? corridors : [],
      selectedCorridorId: selectedCorridorId !== undefined && selectedCorridorId !== null ? selectedCorridorId : null,
      rawAoi: effectiveAoi,
      rawRefinePreviousAoi: refinePreviousAoiGeometry || null,
      isRefineMode: !!isRefineMode,
      rawExistingAois: existingAois && existingAois.length > 0 ? existingAois : [],
      enableDrawing: !!enableAoiDrawing,
      customMarkers: temporalMarkers,
      customLines: customLines && customLines.length > 0 ? customLines : [],
      selectedId: selectedTronconId || null,
      selectedMarkerId: selectedMarkerId ?? null,
      center: center || [34.12, -6.70],
      zoom: zoom || 11,
      fitPaddingBottom: fitPaddingBottom || 35,
      optimizePkLabels: !!optimizePkLabels,
      colors: TRONCON_COLORS,
      // Level 6B: temporal info for the Leaflet overlay badge
      temporalMode: isHistorical ? 'historical' : 'current',
      temporalDate: temporalState?.selectedDateLabel ?? null,
      temporalProgress: isHistorical ? temporalState!.chantierProgress : -1,
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
    .station-card { width: min(270px, 72vw); max-height: 300px; overflow-y: auto; }
    .station-photo { width: 100%; height: 112px; object-fit: cover; border-radius: 9px; margin-bottom: 8px; }
    .station-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-size: 11px; }
    .station-key { color: #94A3B8; }
    .station-value { color: #F8FAFC; font-weight: 600; }
    .existing-aoi-label {
      background: rgba(238, 242, 255, 0.95) !important;
      border: 1px solid #818CF8 !important;
      border-radius: 6px !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25) !important;
      padding: 2px 6px !important;
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

    /* Tronçon Compact Map Tooltip & Visual Hierarchy */
    .troncon-leaflet-tooltip {
      pointer-events: none !important;
      background: rgba(15, 23, 42, 0.92) !important;
      border: 1px solid rgba(255, 255, 255, 0.22) !important;
      border-radius: 8px !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45) !important;
      padding: 0 !important;
      color: #F8FAFC !important;
      white-space: nowrap !important;
      backdrop-filter: blur(4px);
    }
    .troncon-leaflet-tooltip::before {
      display: none !important;
    }
    .troncon-badge-wrap {
      display: flex;
      flex-direction: column;
      padding: 4px 7px 4px 6px;
      gap: 2px;
    }
    .troncon-badge-header {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .troncon-badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 5px currentColor;
    }
    .troncon-badge-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.2px;
      line-height: 1.2;
    }
    .troncon-badge-pk {
      font-size: 9px;
      color: #94A3B8;
      font-weight: 500;
      margin-left: 13px;
      line-height: 1.1;
    }
    .troncon-tooltip-selected {
      background: rgba(15, 23, 42, 0.98) !important;
      border: 2px solid #FACC15 !important;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.65), 0 0 10px rgba(250, 204, 21, 0.4) !important;
      z-index: 1000 !important;
      transform: scale(1.06);
    }
    .troncon-tooltip-selected .troncon-badge-title {
      font-size: 12px;
      font-weight: 800;
    }
    .troncon-tooltip-selected .troncon-badge-pk {
      color: #E2E8F0;
      font-weight: 600;
    }
    .troncon-endpoint-icon {
      pointer-events: none !important;
    }

    /* KML Source Layer Tooltip & Floating Toggle */
    .kml-source-tooltip {
      background: rgba(15, 23, 42, 0.94) !important;
      border: 1.5px solid #F97316 !important;
      border-radius: 8px !important;
      color: #FFFFFF !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      padding: 4px 8px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
    }
    .kml-toggles-container {
      position: absolute;
      bottom: 22px;
      right: 12px;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-end;
    }
    .kml-toggle-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #1E293B;
      border: 1.5px solid rgba(249, 115, 22, 0.7);
      border-radius: 20px;
      padding: 6px 12px;
      color: #F8FAFC;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      user-select: none;
      -webkit-user-select: none;
      transition: all 0.2s ease;
    }
    .kml-toggle-badge:active {
      transform: scale(0.96);
    }
    .kml-toggle-badge-off {
      border-color: #64748B;
      background: #0F172A;
      color: #94A3B8;
      opacity: 0.85;
    }
    .kml-photo-marker {
      transition: transform 0.15s ease;
    }
    .kml-photo-marker:hover {
      transform: scale(1.15);
    }
    .kml-toggle-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #F97316;
      box-shadow: 0 0 6px #F97316;
    }
    .kml-toggle-dot-off {
      background: #64748B;
      box-shadow: none;
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

    /* AOI vertex marker icon - optimized for touch interaction */
    .aoi-vertex-marker {
      cursor: grab;
      touch-action: none;
    }
    .aoi-vertex-icon {
      background: #F59E0B;
      border: 2.5px solid #FFFFFF;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      box-shadow: 0 3px 8px rgba(0,0,0,0.45);
      transition: transform 0.15s ease;
    }
    .aoi-vertex-marker:active .aoi-vertex-icon {
      background: #D97706;
      transform: scale(1.3);
    }
    /* Refinement vertex marker icon - RED dots */
    .aoi-refine-vertex-icon {
      background: #EF4444 !important;
      border: 2.5px solid #FFFFFF !important;
      border-radius: 50% !important;
      width: 18px !important;
      height: 18px !important;
      box-shadow: 0 2px 8px rgba(220, 38, 38, 0.7) !important;
      transition: transform 0.15s ease;
    }
    .aoi-vertex-marker:active .aoi-refine-vertex-icon {
      background: #DC2626 !important;
      transform: scale(1.3);
    }

    @keyframes markerPulse {
      0% { transform: scale(0.9); opacity: 0.85; }
      50% { transform: scale(1.35); opacity: 0.2; }
      100% { transform: scale(0.9); opacity: 0.85; }
    }

    /* Level 6B — Temporal mode indicator badge */
    #temporal-badge {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1200;
      display: flex;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, rgba(124,58,237,0.92) 0%, rgba(79,70,229,0.88) 100%);
      border: 1.5px solid rgba(167,139,250,0.6);
      border-radius: 20px;
      padding: 5px 13px 5px 10px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: #F8FAFC;
      box-shadow: 0 4px 20px rgba(124,58,237,0.5), 0 2px 6px rgba(0,0,0,0.4);
      pointer-events: none;
      white-space: nowrap;
      backdrop-filter: blur(6px);
      letter-spacing: 0.3px;
    }
    #temporal-badge.hidden { display: none !important; }
    .temporal-clock-icon {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(253,230,138,0.9);
      position: relative;
      flex-shrink: 0;
    }
    .temporal-clock-icon::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 4px;
      height: 1.5px;
      background: rgba(253,230,138,0.9);
      transform-origin: left center;
      transform: translate(-1px,-50%) rotate(-45deg);
    }
    .temporal-clock-icon::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 3px;
      height: 1.5px;
      background: rgba(253,230,138,0.9);
      transform-origin: left center;
      transform: translate(-1px,-50%) rotate(75deg);
    }
    #temporal-date { color: #FDE68A; }
    #temporal-sep { color: rgba(248,250,252,0.4); margin: 0 1px; }
    #temporal-pct { color: rgba(167,243,208,0.9); }
  </style>
</head>
<body>
  <div id="map"></div>

  <!-- Level 6B: Temporal mode indicator (hidden by default, shown by JS) -->
  <div id="temporal-badge" class="hidden">
    <div class="temporal-clock-icon"></div>
    <span>HISTORIQUE</span>
    <span id="temporal-sep">·</span>
    <span id="temporal-date"></span>
    <span id="temporal-sep2" style="color:rgba(248,250,252,0.4);margin:0 1px">·</span>
    <span id="temporal-pct"></span>
  </div>

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
      var rawChantierAlignments = config.rawChantierAlignments || [];
      var rawGeoJson = config.rawGeoJson;
      var rawKmlGeom = config.rawKmlGeom;
      var rawKmlMeta = config.rawKmlMeta;
      var showKmlLayer = config.showKmlLayer !== false;
      var rawSearchLoc = config.rawSearchLoc;
      var rawTroncons = config.rawTroncons || [];
      var rawCustomMarkers = config.customMarkers || [];
      var rawCustomLines = config.customLines || [];
      var rawCorridors = config.rawCorridors || [];
      var selectedCorridorId = config.selectedCorridorId;
      var rawAoi = config.rawAoi;
      var rawRefinePreviousAoi = config.rawRefinePreviousAoi || null;
      var isRefineMode = !!config.isRefineMode;
      var enableDrawing = !!config.enableDrawing;
      var selectedId = config.selectedId;
      var colors = config.colors || ["#0EA5E9", "#10B981", "#F59E0B"];
      var optimizePkLabels = !!config.optimizePkLabels;
      var fitPaddingBottom = config.fitPaddingBottom || 35;

      // KML AABBGGRR hex color converter to Leaflet (#RRGGBB + opacity)
      function convertKmlColorToLeaflet(kmlColor, defaultColor, defaultOpacity) {
        var defCol = defaultColor || '#F97316';
        var defOp = defaultOpacity !== undefined ? defaultOpacity : 0.95;
        if (!kmlColor || typeof kmlColor !== 'string') {
          return { color: defCol, opacity: defOp };
        }
        var raw = kmlColor.trim().replace(/^#/, '');
        if (/^[0-9a-fA-F]{8}$/.test(raw)) {
          var aHex = raw.slice(0, 2);
          var bHex = raw.slice(2, 4);
          var gHex = raw.slice(4, 6);
          var rHex = raw.slice(6, 8);
          var alpha = parseInt(aHex, 16) / 255;
          var opacity = isNaN(alpha) ? defOp : Math.round(alpha * 100) / 100;
          var color = '#' + rHex + gHex + bHex;
          return { color: color.toLowerCase(), opacity: Math.max(0, Math.min(1, opacity)) };
        }
        if (/^[0-9a-fA-F]{6}$/.test(raw)) {
          return { color: '#' + raw.toLowerCase(), opacity: defOp };
        }
        return { color: defCol, opacity: defOp };
      }
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

      // Default to OpenStreetMap (public, robust, no API key required)
      osmLayer.addTo(map);

      osmLayer.on("tileerror", function() {
        if (map.hasLayer(osmLayer)) {
          map.removeLayer(osmLayer);
          esriStreet.addTo(map);
        }
      });

      googleStreets.on("tileerror", function() {
        if (map.hasLayer(googleStreets)) {
          map.removeLayer(googleStreets);
          osmLayer.addTo(map);
        }
      });

      cartoVoyager.on("tileerror", function() {
        if (map.hasLayer(cartoVoyager)) {
          map.removeLayer(cartoVoyager);
          osmLayer.addTo(map);
        }
      });

      var overlayLayers = {};
      var kmlLayerGroup = L.layerGroup();
      if (rawKmlGeom) {
        overlayLayers["🗺️ Tracé Source KML"] = kmlLayerGroup;
      }
      if (showKmlLayer && rawKmlGeom) {
        kmlLayerGroup.addTo(map);
      }

      var rawKmlGroundOverlays = config.rawKmlGroundOverlays || [];
      var rawKmlPhotoOverlays = config.rawKmlPhotoOverlays || [];
      var showKmlImages = config.showKmlImages !== false;
      var kmlImageLayerGroup = L.layerGroup();
      var hasKmlImages = (rawKmlGroundOverlays && rawKmlGroundOverlays.length > 0) || (rawKmlPhotoOverlays && rawKmlPhotoOverlays.length > 0);

      if (hasKmlImages) {
        overlayLayers["🖼️ Images KML"] = kmlImageLayerGroup;
      }
      if (showKmlImages && hasKmlImages) {
        kmlImageLayerGroup.addTo(map);
      }

      L.control.layers({
        "OpenStreetMap": osmLayer,
        "Google Satellite": googleHybrid,
        "Google Plan": googleStreets,
        "Rues & Relief (Esri)": esriStreet,
        "Plan Urbain (CARTO)": cartoVoyager
      }, Object.keys(overlayLayers).length > 0 ? overlayLayers : null, { position: "topright" }).addTo(map);

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

          // Include KML source geometry if visible on map
          if (map.hasLayer(kmlLayerGroup) && kmlLayerGroup.getLayers && kmlLayerGroup.getLayers().length > 0) {
            kmlLayerGroup.eachLayer(function(l) {
              if (l.getBounds && l.getBounds().isValid && l.getBounds().isValid()) {
                if (!combinedBounds) {
                  combinedBounds = L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast());
                } else {
                  combinedBounds.extend(l.getBounds());
                }
              }
            });
          }

          // Include KML image overlays if visible on map
          if (map.hasLayer(kmlImageLayerGroup) && kmlImageLayerGroup.getLayers && kmlImageLayerGroup.getLayers().length > 0) {
            kmlImageLayerGroup.eachLayer(function(l) {
              if (l.getBounds && l.getBounds().isValid && l.getBounds().isValid()) {
                if (!combinedBounds) {
                  combinedBounds = L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast());
                } else {
                  combinedBounds.extend(l.getBounds());
                }
              } else if (l.getLatLng && l.getLatLng()) {
                var ll = l.getLatLng();
                if (!combinedBounds) {
                  combinedBounds = L.latLngBounds([ll, ll]);
                } else {
                  combinedBounds.extend(ll);
                }
              }
            });
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

          // In refinement mode, focus snugly on the previous AOI to be refined
          if (rawRefinePreviousAoi) {
            try {
              var pLayer = L.geoJSON(rawRefinePreviousAoi);
              var pb = pLayer.getBounds();
              if (pb && pb.isValid && pb.isValid()) {
                map.fitBounds(pb, {
                  paddingTopLeft: [40, 50],
                  paddingBottomRight: [40, fitPaddingBottom || 35],
                  maxZoom: 16,
                  animate: !!isUserTriggered
                });
                return;
              }
            } catch(e) {}
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
              iconSize: [130, 28],
              iconAnchor: [14, 14]
            });
            L.marker([firstPt[1], firstPt[0]], { icon: startIcon, zIndexOffset: 800 })
              .bindPopup('<div class="custom-popup"><div class="popup-title">📍 Tracé Source SIG</div><div class="popup-detail">Point de repère du tracé importé</div></div>')
              .addTo(featureGroup);
          }
        } catch(e) {}
      }

      // Render KML Source Geometry Layer (Level 3 Visualization)
      var safeKmlGeom = sanitizeToWgs84(rawKmlGeom);
      if (safeKmlGeom) {
        try {
          var kmlStyle = {
            color: "#F97316",
            weight: 4.5,
            opacity: 0.95
          };

          if (rawKmlMeta && rawKmlMeta.styles && rawKmlMeta.styles.line) {
            var lineStyle = rawKmlMeta.styles.line;
            if (lineStyle.color) {
              var conv = convertKmlColorToLeaflet(lineStyle.color, "#F97316", 0.95);
              kmlStyle.color = conv.color;
              kmlStyle.opacity = conv.opacity;
            }
            if (typeof lineStyle.width === "number" && !isNaN(lineStyle.width) && lineStyle.width > 0) {
              kmlStyle.weight = Math.max(1, Math.min(15, lineStyle.width));
            }
          }

          // 1. Subtle dark casing underneath the KML line so it stays visible over satellite/terrain
          L.geoJSON(safeKmlGeom, {
            style: {
              color: "#0F172A",
              weight: kmlStyle.weight + 3,
              opacity: 0.65,
              lineCap: "round",
              lineJoin: "round"
            },
            interactive: false
          }).addTo(kmlLayerGroup);

          // 2. Main styled KML source line
          var kmlLine = L.geoJSON(safeKmlGeom, {
            style: {
              color: kmlStyle.color,
              weight: kmlStyle.weight,
              opacity: kmlStyle.opacity,
              lineCap: "round",
              lineJoin: "round"
            }
          }).addTo(kmlLayerGroup);

          var kmlPlacemarkName = (rawKmlMeta && rawKmlMeta.name) || "Tracé source KML";
          kmlLine.bindTooltip(
            '<span class="kml-source-tooltip">🗺️ ' + escapeHtml(kmlPlacemarkName) + ' (Source KML)</span>',
            { sticky: true, direction: "top" }
          );

          // Interactive click handler: select KML element and show metadata
          // DomEvent.stopPropagation ensures clicking KML does not trigger AOI drawing or other actions
          kmlLine.on("click", function(e) {
            if (e && e.originalEvent) {
              L.DomEvent.stopPropagation(e);
            }
            var payload = rawKmlMeta || {
              name: kmlPlacemarkName,
              sourceFormat: "KML",
              sourceCrs: "EPSG:4326"
            };
            sendToParent({ type: "SELECT_KML", metadata: payload });
          });

          // Floating KML Layer Toggles Container
          var kmlTogglesContainer = null;
          function getOrCreateKmlTogglesContainer() {
            if (!kmlTogglesContainer) {
              kmlTogglesContainer = document.createElement("div");
              kmlTogglesContainer.className = "kml-toggles-container";
              L.DomEvent.disableClickPropagation(kmlTogglesContainer);
              L.DomEvent.disableScrollPropagation(kmlTogglesContainer);
              document.body.appendChild(kmlTogglesContainer);
            }
            return kmlTogglesContainer;
          }

          // 1. Floating KML line toggle button
          var kmlVisibleState = showKmlLayer;
          var toggleBadge = document.createElement("div");
          toggleBadge.className = "kml-toggle-badge" + (kmlVisibleState ? "" : " kml-toggle-badge-off");
          toggleBadge.id = "kml-visibility-toggle";
          toggleBadge.innerHTML = '<span class="kml-toggle-dot' + (kmlVisibleState ? "" : " kml-toggle-dot-off") + '"></span><span>🗺️ Ligne KML ' + (kmlVisibleState ? 'ON' : 'OFF') + '</span>';
          L.DomEvent.on(toggleBadge, "click", function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            kmlVisibleState = !kmlVisibleState;
            if (kmlVisibleState) {
              map.addLayer(kmlLayerGroup);
              toggleBadge.className = "kml-toggle-badge";
              toggleBadge.innerHTML = '<span class="kml-toggle-dot"></span><span>🗺️ Ligne KML ON</span>';
            } else {
              map.removeLayer(kmlLayerGroup);
              toggleBadge.className = "kml-toggle-badge kml-toggle-badge-off";
              toggleBadge.innerHTML = '<span class="kml-toggle-dot kml-toggle-dot-off"></span><span>🗺️ Ligne KML OFF</span>';
            }
            sendToParent({ type: "TOGGLE_KML_VISIBILITY", visible: kmlVisibleState });
          });
          getOrCreateKmlTogglesContainer().appendChild(toggleBadge);
        } catch(e) {
          console.warn("KML layer render warning:", e);
        }
      }

      // Render KML Images Layer (Level 4: GroundOverlay & PhotoOverlay)
      if (hasKmlImages) {
        try {
          // A. GroundOverlays
          if (rawKmlGroundOverlays && rawKmlGroundOverlays.length > 0) {
            rawKmlGroundOverlays.forEach(function(go) {
              if (!go || !go.latLonBox) return;
              var box = go.latLonBox;
              if (typeof box.north !== "number" || typeof box.south !== "number" || typeof box.east !== "number" || typeof box.west !== "number") return;
              if (box.south >= box.north) return;

              var bounds = L.latLngBounds([box.south, box.west], [box.north, box.east]);
              var overlayName = escapeHtml(go.name || "GroundOverlay");
              var opacity = typeof go.opacity === "number" ? Math.max(0, Math.min(1, go.opacity)) : 1.0;
              var zIndex = typeof go.drawOrder === "number" ? go.drawOrder : 1;

              var canRenderImage = Boolean(go.isSafe && go.isAvailable && go.icon && go.icon.href);
              if (canRenderImage) {
                try {
                  var imgOverlay = L.imageOverlay(go.icon.href, bounds, {
                    opacity: opacity,
                    zIndex: zIndex,
                    interactive: true
                  }).addTo(kmlImageLayerGroup);

                  var rotNotice = (box.rotation && box.rotation !== 0) ? ' <span style="color:#F59E0B;">(Rot: ' + box.rotation + '°)</span>' : '';
                  imgOverlay.bindTooltip('<span class="kml-source-tooltip">🖼️ ' + overlayName + ' (GroundOverlay)' + rotNotice + '</span>', { sticky: true, direction: "top" });

                  imgOverlay.on("click", function(e) {
                    if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
                    sendToParent({ type: "SELECT_KML_IMAGE", overlay: go });
                  });

                  imgOverlay.on("error", function() {
                    console.warn("Leaflet error loading GroundOverlay image:", go.icon.href);
                    if (kmlImageLayerGroup.hasLayer(imgOverlay)) {
                      kmlImageLayerGroup.removeLayer(imgOverlay);
                    }
                    var fallbackRect = L.rectangle(bounds, {
                      color: "#F97316",
                      weight: 1.5,
                      dashArray: "5, 5",
                      fillColor: "#F97316",
                      fillOpacity: Math.min(0.25, opacity * 0.25),
                      interactive: true
                    }).addTo(kmlImageLayerGroup);
                    fallbackRect.bindTooltip('<span class="kml-source-tooltip">🖼️ ' + overlayName + ' (Image non chargée)</span>', { sticky: true, direction: "top" });
                    fallbackRect.on("click", function(ev) {
                      if (ev && ev.originalEvent) L.DomEvent.stopPropagation(ev);
                      sendToParent({ type: "SELECT_KML_IMAGE", overlay: go });
                    });
                  });
                } catch(imgErr) {
                  canRenderImage = false;
                }
              }

              if (!canRenderImage) {
                // Safe visual footprint fallback for local or unavailable images
                var rect = L.rectangle(bounds, {
                  color: "#F97316",
                  weight: 1.5,
                  dashArray: "5, 5",
                  fillColor: "#F97316",
                  fillOpacity: Math.min(0.25, opacity * 0.25),
                  interactive: true
                }).addTo(kmlImageLayerGroup);

                var statusNotice = go.isAvailable ? '' : ' <span style="color:#EF4444;">(Image non disponible)</span>';
                rect.bindTooltip('<span class="kml-source-tooltip">🖼️ ' + overlayName + ' (GroundOverlay)' + statusNotice + '</span>', { sticky: true, direction: "top" });

                rect.on("click", function(e) {
                  if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
                  sendToParent({ type: "SELECT_KML_IMAGE", overlay: go });
                });
              }
            });
          }

          // B. PhotoOverlays
          if (rawKmlPhotoOverlays && rawKmlPhotoOverlays.length > 0) {
            rawKmlPhotoOverlays.forEach(function(po) {
              if (!po || !po.position || !Array.isArray(po.position) || po.position.length < 2) return;
              var lon = po.position[0];
              var lat = po.position[1];
              if (typeof lon !== "number" || typeof lat !== "number" || isNaN(lon) || isNaN(lat)) return;
              if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return;

              var photoIcon = L.divIcon({
                className: 'kml-photo-marker',
                html: '<div style="background:#F97316;color:#FFF;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.5);border:2px solid #FFF;font-size:14px;cursor:pointer;">📷</div>',
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              });

              var pMarker = L.marker([lat, lon], {
                icon: photoIcon,
                zIndexOffset: 950,
                interactive: true
              }).addTo(kmlImageLayerGroup);

              var poName = escapeHtml(po.name || "PhotoOverlay");
              pMarker.bindTooltip('<span class="kml-source-tooltip">📷 ' + poName + ' (PhotoOverlay)</span>', { sticky: true, direction: "top" });

              pMarker.on("click", function(e) {
                if (e && e.originalEvent) L.DomEvent.stopPropagation(e);
                sendToParent({ type: "SELECT_KML_IMAGE", overlay: po });
              });
            });
          }

          // Floating KML Images visibility toggle badge
          var kmlImagesVisibleState = showKmlImages;
          var imgToggleBadge = document.createElement("div");
          imgToggleBadge.className = "kml-toggle-badge" + (kmlImagesVisibleState ? "" : " kml-toggle-badge-off");
          imgToggleBadge.id = "kml-images-visibility-toggle";
          imgToggleBadge.innerHTML = '<span class="kml-toggle-dot' + (kmlImagesVisibleState ? "" : " kml-toggle-dot-off") + '"></span><span>🖼️ Images KML ' + (kmlImagesVisibleState ? 'ON' : 'OFF') + '</span>';
          L.DomEvent.on(imgToggleBadge, "click", function(e) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            kmlImagesVisibleState = !kmlImagesVisibleState;
            if (kmlImagesVisibleState) {
              map.addLayer(kmlImageLayerGroup);
              imgToggleBadge.className = "kml-toggle-badge";
              imgToggleBadge.innerHTML = '<span class="kml-toggle-dot"></span><span>🖼️ Images KML ON</span>';
            } else {
              map.removeLayer(kmlImageLayerGroup);
              imgToggleBadge.className = "kml-toggle-badge kml-toggle-badge-off";
              imgToggleBadge.innerHTML = '<span class="kml-toggle-dot kml-toggle-dot-off"></span><span>🖼️ Images KML OFF</span>';
            }
            sendToParent({ type: "TOGGLE_KML_IMAGES_VISIBILITY", visible: kmlImagesVisibleState });
          });

          // Ensure container exists if only images exist (without line geometry)
          if (!kmlTogglesContainer) {
            kmlTogglesContainer = document.createElement("div");
            kmlTogglesContainer.className = "kml-toggles-container";
            L.DomEvent.disableClickPropagation(kmlTogglesContainer);
            L.DomEvent.disableScrollPropagation(kmlTogglesContainer);
            document.body.appendChild(kmlTogglesContainer);
          }
          kmlTogglesContainer.appendChild(imgToggleBadge);
        } catch(imgErr) {
          console.warn("KML images layer render warning:", imgErr);
        }
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
            },
            interactive: !enableDrawing
          });
          // Only show popup in view mode, never in drawing/refinement mode to prevent interaction blocking
          if (!enableDrawing) {
            aoiLayer.bindPopup('<div class="custom-popup"><div class="popup-title" style="color:#F59E0B;">📍 Zone d&apos;Étude du Chantier (AOI)</div><div class="popup-detail">Emprise spatiale enregistrée pour le filtrage des corridors.</div></div>');
          }
          aoiLayer.addTo(aoiLayerGroup);
          aoiLayer.addTo(featureGroup);
        } catch(e) {}
      }

      if (rawAoi && !enableDrawing) {
        renderAoiPolygon(rawAoi);
      }

      // Render Previous Reference AOI in Orange during refinement mode
      if (rawRefinePreviousAoi) {
        try {
          var prevAoiLayer = L.geoJSON(rawRefinePreviousAoi, {
            style: {
              color: "#F59E0B",
              fillColor: "#F59E0B",
              fillOpacity: 0.14,
              weight: 2.5,
              dashArray: "5, 5"
            },
            interactive: false
          });
          prevAoiLayer.addTo(aoiLayerGroup);
          prevAoiLayer.addTo(featureGroup);
        } catch(e) {}
      }

      // Render Existing Sibling Chantier AOIs (Visual reference for other chantiers)
      var rawExistingAois = config.rawExistingAois || [];
      if (rawExistingAois && rawExistingAois.length > 0) {
        rawExistingAois.forEach(function(item) {
          if (!item || !item.geometry) return;
          try {
            var color = item.color || "#6366F1";
            var existingLayer = L.geoJSON(item.geometry, {
              style: {
                color: color,
                fillColor: color,
                fillOpacity: 0.16,
                weight: 2,
                dashArray: "4, 4"
              }
            });
            var label = escapeHtml(item.nom || 'Autre chantier');
            existingLayer.bindTooltip('<span style="font-weight:700;font-size:11px;color:#3730A3;">🏢 ' + label + '</span>', {
              permanent: true,
              direction: 'center',
              className: 'existing-aoi-label'
            });
            existingLayer.bindPopup('<div class="custom-popup"><div class="popup-title" style="color:#4F46E5;">🏢 ' + label + '</div><div class="popup-detail">Emprise déjà enregistrée pour ce chantier du projet.</div></div>');
            existingLayer.addTo(featureGroup);
          } catch(e) {}
        });
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

      function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }

      function sliceLineByFraction(geometry, fraction) {
        if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
        var coords = geometry.coordinates;
        if (coords.length < 2) return null;
        var targetFraction = Math.max(0, Math.min(1, Number(fraction) || 0));
        var lengths = [], total = 0;
        for (var i = 1; i < coords.length; i++) {
          var length = map.distance([coords[i - 1][1], coords[i - 1][0]], [coords[i][1], coords[i][0]]);
          lengths.push(length); total += length;
        }
        var target = total * targetFraction, travelled = 0, result = [coords[0]];
        for (var j = 1; j < coords.length; j++) {
          if (travelled + lengths[j - 1] <= target) {
            result.push(coords[j]); travelled += lengths[j - 1]; continue;
          }
          var local = lengths[j - 1] > 0 ? (target - travelled) / lengths[j - 1] : 0;
          result.push([
            coords[j - 1][0] + (coords[j][0] - coords[j - 1][0]) * local,
            coords[j - 1][1] + (coords[j][1] - coords[j - 1][1]) * local
          ]);
          break;
        }
        return { type: 'LineString', coordinates: result };
      }

      // Project-level chantier hierarchy: each line is the authoritative clipped
      // reference alignment owned by that chantier, never an invented connector.
      var selectedChantierLayer = null;
      rawChantierAlignments.forEach(function(ch, idx) {
        if (!ch || !ch.geometry) return;
        var selected = config.selectedChantierId !== null && String(ch.id) === String(config.selectedChantierId);
        var palette = ["#0284C7", "#7C3AED", "#D97706", "#0F766E", "#BE123C", "#4F46E5"];
        var chantierColor = ch.color || palette[idx % palette.length];
        if (selected) {
          L.geoJSON({ type: "Feature", geometry: ch.geometry }, { style: {
            color: "#FACC15", weight: 15, opacity: 0.42, lineCap: "round", lineJoin: "round"
          }}).addTo(featureGroup);
        }
        var chantierLayer = L.geoJSON({ type: "Feature", geometry: ch.geometry }, { style: {
          color: selected ? chantierColor : chantierColor,
          weight: selected ? 9 : 6,
          opacity: selected ? 1 : 0.62,
          lineCap: "round",
          lineJoin: "round"
        }}).addTo(featureGroup);
        chantierLayer.bindTooltip(escapeHtml(ch.nom), { sticky: true, direction: "top" });
        chantierLayer.on("click", function() { sendToParent({ type: "SELECT_CHANTIER", chantierId: ch.id }); });
        if (selected) selectedChantierLayer = chantierLayer;
      });

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
                iconSize: [145, 28],
                iconAnchor: optimizePkLabels ? [14, -6] : [14, 14]
              });
              L.marker(startLatLng, { icon: originIcon, zIndexOffset: 1000 })
                .bindPopup("<div class='custom-popup'><div class='popup-title' style='color:#16A34A;'>🟢 Origine du Chantier — PK 0+000</div><div class='popup-detail'>Point d'entrée du linéaire dans la zone d'étude.</div></div>")
                .addTo(featureGroup);

              var endIcon = L.divIcon({
                className: "end-marker",
                html: "<div style='display:flex;align-items:center;background:#DC2626;color:#FFFFFF;border:2px solid #FFFFFF;border-radius:18px;padding:3px 9px;font-size:11px;font-weight:bold;box-shadow:0 3px 8px rgba(0,0,0,0.45);white-space:nowrap;'><span style='font-size:12px;margin-right:4px;'>🔴</span> Fin du Chantier</div>",
                iconSize: [130, 28],
                iconAnchor: optimizePkLabels ? [14, -6] : [14, 14]
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

      // Render Tronçons (Linear Referencing) with distinct deterministic palette & visual hierarchy
      var selectedTronconLayer = null;
      if (rawTroncons && rawTroncons.length > 0) {
        var hasSelected = !!(selectedId && rawTroncons.some(function(t, i) {
          return String(t.id) === String(selectedId) || String(i + 1) === String(selectedId);
        }));

        rawTroncons.forEach(function(tr, idx) {
          if (!tr.geometry) return;
          var isSelected = selectedId && (String(tr.id) === String(selectedId) || String(idx + 1) === String(selectedId));
          var isPrimary = !!tr.isPrimary;
          var isSecondary = !!tr.isSecondary;

          // Deterministic color assignment: Tronçon 1 -> Green, 2 -> Blue, 3 -> Orange, 4 -> Red...
          var color = tr.color || colors[idx % colors.length];

          // 1. Selection halo for active tronçon
          if (isSelected) {
            L.geoJSON({
              type: "Feature",
              geometry: tr.geometry
            }, {
              style: {
                color: "#FFFFFF",
                weight: 15,
                opacity: 0.5,
                lineCap: "round",
                lineJoin: "round"
              },
              interactive: false
            }).addTo(featureGroup);
          }

          // 2. Basemap contrast casing (dark outline behind the colored line)
          L.geoJSON({
            type: "Feature",
            geometry: tr.geometry
          }, {
            style: {
              color: "#0F172A",
              weight: isSelected ? 10 : (hasSelected ? 6 : 7.5),
              opacity: isSelected ? 0.95 : (hasSelected ? 0.55 : 0.75),
              lineCap: "round",
              lineJoin: "round"
            },
            interactive: false
          }).addTo(featureGroup);

          // 3. Main colored tronçon line
          var tLayer = L.geoJSON({
            type: "Feature",
            geometry: tr.geometry,
            properties: tr
          }, {
            style: {
              color: color,
              weight: isSelected || isPrimary ? 7 : (hasSelected ? 4.2 : 5.5),
              opacity: isSecondary ? 0.55 : (isSelected ? 1.0 : (hasSelected ? 0.75 : 0.95)),
              dashArray: isSecondary ? "7, 8" : undefined,
              lineCap: "round",
              lineJoin: "round"
            }
          }).addTo(featureGroup);

          if (isSelected) {
            selectedTronconLayer = tLayer;
          }

          tLayer.on("click", function() {
            sendToParent({ type: "SELECT_TRONCON", tronconId: tr.id });
          });

          // 4. Subtle inner progress line if progress exists (preserves tronçon color identity)
          var progressFraction = Math.max(0, Math.min(1, Number(tr.progress_percentage || 0) / 100));
          if (tr.showProgress !== false && !isSecondary && progressFraction > 0 && tr.geometry.type === 'LineString') {
            var completedGeometry = sliceLineByFraction(tr.geometry, progressFraction);
            if (completedGeometry) {
              L.geoJSON(completedGeometry, {
                style: {
                  color: '#FFFFFF',
                  weight: isSelected ? 2.5 : 2,
                  opacity: 0.85,
                  lineCap: 'round',
                  lineJoin: 'round'
                },
                interactive: false
              }).addTo(featureGroup);
            }
          }

          // 5. Selected Tronçon Start/End Node markers
          if (isSelected) {
            try {
              var coords = tr.geometry.coordinates;
              if (coords && coords.length > 0) {
                var startPt = coords[0];
                var endPt = coords[coords.length - 1];
                while (Array.isArray(startPt) && Array.isArray(startPt[0])) startPt = startPt[0];
                while (Array.isArray(endPt) && Array.isArray(endPt[0])) endPt = endPt[0];
                if (Array.isArray(startPt) && typeof startPt[0] === 'number') {
                  var startIcon = L.divIcon({
                    className: "troncon-endpoint-icon",
                    html: '<div style="width:10px;height:10px;border-radius:50%;background:#FFFFFF;border:2.5px solid ' + color + ';box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>',
                    iconSize: [10, 10],
                    iconAnchor: [5, 5]
                  });
                  L.marker([startPt[1], startPt[0]], { icon: startIcon, interactive: false }).addTo(featureGroup);
                }
                if (Array.isArray(endPt) && typeof endPt[0] === 'number') {
                  var endIcon = L.divIcon({
                    className: "troncon-endpoint-icon",
                    html: '<div style="width:10px;height:10px;border-radius:50%;background:#FFFFFF;border:2.5px solid ' + color + ';box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>',
                    iconSize: [10, 10],
                    iconAnchor: [5, 5]
                  });
                  L.marker([endPt[1], endPt[0]], { icon: endIcon, interactive: false }).addTo(featureGroup);
                }
              }
            } catch (e) {}
          }

          // 6. Compact Tronçon Label Tooltip
          var tronconTitle = escapeHtml(tr.nom || ('Tronçon ' + (idx + 1)));
          var hasPkInfo = tr.pk_debut !== undefined && tr.pk_debut !== null && tr.pk_fin !== undefined && tr.pk_fin !== null;
          var pkLabelStr = hasPkInfo
            ? ('PK ' + Number(tr.pk_debut).toFixed(3) + ' &ndash; ' + Number(tr.pk_fin).toFixed(3))
            : '';

          var tooltipHtml =
            '<div class="troncon-badge-wrap">' +
              '<div class="troncon-badge-header">' +
                '<span class="troncon-badge-dot" style="background:' + color + ';"></span>' +
                '<span class="troncon-badge-title" style="color:' + color + ';">' + tronconTitle + '</span>' +
              '</div>' +
              (pkLabelStr ? ('<div class="troncon-badge-pk">' + pkLabelStr + '</div>') : '') +
            '</div>';

          tLayer.bindTooltip(tooltipHtml, {
            permanent: true,
            direction: 'center',
            className: 'troncon-leaflet-tooltip' + (isSelected ? ' troncon-tooltip-selected' : ''),
            interactive: false
          });

          // 7. Rich detail popup for inspection
          var popupContent = '<div class="custom-popup">' +
            '<div class="popup-title" style="color:' + color + ';">' + tronconTitle + '</div>' +
            '<div class="popup-badge" style="background:' + color + '22; color:' + color + '">' +
              (pkLabelStr || (formatPK(tr.pk_debut) + ' &rarr; ' + formatPK(tr.pk_fin))) +
            '</div>' +
            '<div class="popup-detail"><b>Longueur :</b> ' + (tr.length_km ? parseFloat(tr.length_km).toFixed(2) + ' km' : '—') + '</div>' +
            (tr.statut ? ('<div class="popup-detail"><b>Statut :</b> ' + tr.statut + '</div>') : '') +
            (tr.progress_percentage !== undefined ? ('<div class="popup-detail"><b>Avancement :</b> ' + tr.progress_percentage + '%</div>') : '') +
          '</div>';

          tLayer.bindPopup(popupContent);
        });

        // Bring selected tronçon layer to top
        if (selectedTronconLayer) {
          try {
            selectedTronconLayer.bringToFront();
          } catch (e) {}
        }
      }

      // Minimalist AOI Drawing Mode (Controls managed externally by React Native)
      var drawnPoints = [];
      var drawnMarkers = [];
      var drawingPolyline = null;
      var drawingPolygon = null;

      window.gisMapAction = function() {};

      if (enableDrawing) {
        var drawColor = isRefineMode ? "#EF4444" : "#F59E0B";
        var drawFill = isRefineMode ? "#EF4444" : "#F59E0B";
        var vertexClass = isRefineMode ? "aoi-refine-vertex-icon" : "aoi-vertex-icon";

        function updateDrawingUI() {
          var count = drawnPoints.length;

          if (drawingPolyline) map.removeLayer(drawingPolyline);
          if (drawingPolygon) map.removeLayer(drawingPolygon);

          if (count >= 2) {
            var latlngs = drawnPoints.map(function(pt) { return [pt[1], pt[0]]; });
            drawingPolyline = L.polyline(latlngs, {
              color: drawColor,
              weight: 3,
              dashArray: isRefineMode ? "4, 4" : "5, 5",
              interactive: false
            }).addTo(map);

            if (count >= 3) {
              drawingPolygon = L.polygon(latlngs, {
                color: drawColor,
                fillColor: drawFill,
                fillOpacity: 0.22,
                weight: 2.5,
                interactive: false
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
            sendToParent({ type: "AOI_CHANGED", coordinates: coords, pointCount: drawnPoints.length });
          } else {
            sendToParent({ type: "AOI_CHANGED", coordinates: drawnPoints.slice(), pointCount: drawnPoints.length });
          }
        }

        function createVertexMarker(lng, lat) {
          var marker = L.marker([lat, lng], {
            icon: L.divIcon({
              className: "aoi-vertex-marker",
              html: '<div class="' + vertexClass + '"></div>',
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            }),
            draggable: true
          }).addTo(map);

          marker.on("drag", function(dragEvt) {
            var idx = drawnMarkers.indexOf(dragEvt.target);
            if (idx !== -1) {
              var newPos = dragEvt.target.getLatLng();
              drawnPoints[idx] = [Number(newPos.lng.toFixed(6)), Number(newPos.lat.toFixed(6))];
              updateDrawingUI();
              notifyParentAOI();
            }
          });

          return marker;
        }

        // Initialize drawnPoints from existing rawAoi if present (only when not in refinement mode)
        if (!isRefineMode && rawAoi) {
          try {
            var initialRing = null;
            if (rawAoi.type === 'Polygon' && Array.isArray(rawAoi.coordinates) && rawAoi.coordinates[0]) {
              initialRing = rawAoi.coordinates[0];
            } else if (rawAoi.type === 'Feature' && rawAoi.geometry && rawAoi.geometry.type === 'Polygon' && Array.isArray(rawAoi.geometry.coordinates)) {
              initialRing = rawAoi.geometry.coordinates[0];
            }

            if (initialRing && initialRing.length >= 3) {
              for (var k = 0; k < initialRing.length; k++) {
                var p = initialRing[k];
                // Skip duplicate closing point if identical to first
                if (k === initialRing.length - 1 && initialRing.length >= 4) {
                  var p0 = initialRing[0];
                  if (Math.abs(p[0] - p0[0]) < 0.000001 && Math.abs(p[1] - p0[1]) < 0.000001) {
                    continue;
                  }
                }
                var pLng = Number(Number(p[0]).toFixed(6));
                var pLat = Number(Number(p[1]).toFixed(6));
                drawnPoints.push([pLng, pLat]);
                var m = createVertexMarker(pLng, pLat);
                drawnMarkers.push(m);
              }
              updateDrawingUI();
            }
          } catch(err) {
            console.warn("Error loading existing AOI vertices for drawing:", err);
          }
        }

        map.on("click", function(e) {
          var lng = Number(e.latlng.lng.toFixed(6));
          var lat = Number(e.latlng.lat.toFixed(6));
          drawnPoints.push([lng, lat]);
          var marker = createVertexMarker(lng, lat);
          drawnMarkers.push(marker);
          updateDrawingUI();
          notifyParentAOI();
        });

        window.setAoiCoordinates = function(coords) {
          if (!Array.isArray(coords)) return;
          drawnPoints = [];
          drawnMarkers.forEach(function(m) { map.removeLayer(m); });
          drawnMarkers = [];
          for (var i = 0; i < coords.length; i++) {
            var pt = coords[i];
            if (i === coords.length - 1 && coords.length >= 4 && coords[0][0] === pt[0] && coords[0][1] === pt[1]) continue;
            var cLng = Number(Number(pt[0]).toFixed(6));
            var cLat = Number(Number(pt[1]).toFixed(6));
            drawnPoints.push([cLng, cLat]);
            var mk = createVertexMarker(cLng, cLat);
            drawnMarkers.push(mk);
          }
          updateDrawingUI();
          notifyParentAOI();
          if (drawingPolygon && drawingPolygon.getBounds) {
            try {
              map.fitBounds(drawingPolygon.getBounds(), { padding: [35, 35], maxZoom: 16 });
            } catch(e) {}
          }
        };

        window.gisMapAction = function(action) {
          if (action === 'undo') {
            if (drawnPoints.length > 0) {
              drawnPoints.pop();
              var m = drawnMarkers.pop();
              if (m) map.removeLayer(m);
              updateDrawingUI();
              notifyParentAOI();
            }
          } else if (action === 'clear') {
            drawnPoints = [];
            drawnMarkers.forEach(function(m) { map.removeLayer(m); });
            drawnMarkers = [];
            if (aoiLayerGroup) aoiLayerGroup.clearLayers();
            updateDrawingUI();
            sendToParent({ type: "AOI_CHANGED", coordinates: [], pointCount: 0 });
          } else if (action === 'finish' || action === 'close') {
            if (drawnPoints.length >= 4) {
              notifyParentAOI();
            }
          } else if (action === 'toggleKml') {
            var btn = document.getElementById('kml-visibility-toggle');
            if (btn) btn.click();
          } else if (action === 'toggleKmlImages') {
            var imgBtn = document.getElementById('kml-images-visibility-toggle');
            if (imgBtn) imgBtn.click();
          }
        };

        window.addEventListener('message', function(e) {
          try {
            var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d && d.type === 'GIS_ACTION' && typeof window.gisMapAction === 'function') {
              window.gisMapAction(d.action);
            }
          } catch(err) {}
        });

        document.addEventListener('message', function(e) {
          try {
            var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (d && d.type === 'GIS_ACTION' && typeof window.gisMapAction === 'function') {
              window.gisMapAction(d.action);
            }
          } catch(err) {}
        });
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
      var activeSelectedMarker = null;
      if (rawCustomMarkers && rawCustomMarkers.length > 0) {
        var hasExplicitSelectedId = config.selectedMarkerId !== null && config.selectedMarkerId !== undefined;
        rawCustomMarkers.forEach(function(m) {
          if (!m || typeof m.lat !== "number" || typeof m.lng !== "number") return;
          var isSelected = hasExplicitSelectedId && String(config.selectedMarkerId) === String(m.id);
          var color = m.color || (isSelected ? "#F59E0B" : "#0284C7");
          var isGps = m.iconName === "gps" || (m.label && m.label.toLowerCase().indexOf("gps") !== -1);

          var markerHtml = "";
          var iconSize = [32, 32];
          var iconAnchor = [16, 16];

          if (isSelected) {
            activeSelectedMarker = m;
            markerHtml = "<div style='position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;cursor:pointer;'>" +
              "<div style='position:absolute;width:40px;height:40px;border-radius:50%;background:" + color + "44;border:2px solid " + color + ";animation:markerPulse 2s infinite;'></div>" +
              "<div style='width:30px;height:30px;border-radius:15px;background:" + color + ";display:flex;align-items:center;justify-content:center;border:2.5px solid #FFFFFF;box-shadow:0 4px 12px rgba(0,0,0,0.5);z-index:2;'>" +
                "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='#FFFFFF' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'></path><circle cx='12' cy='13' r='4'></circle></svg>" +
              "</div>" +
            "</div>";
            iconSize = [42, 42];
            iconAnchor = [21, 21];
          } else if (hasExplicitSelectedId) {
            // Secondary marker on the same tronçon (small grey circle with white border)
            markerHtml = "<div style='width:22px;height:22px;display:flex;align-items:center;justify-content:center;cursor:pointer;'>" +
              "<div style='width:14px;height:14px;border-radius:50%;background:#64748B;border:2.5px solid #FFFFFF;box-shadow:0 2px 6px rgba(0,0,0,0.45);'></div>" +
            "</div>";
            iconSize = [22, 22];
            iconAnchor = [11, 11];
          } else if (isGps) {
            markerHtml = "<div style='position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center;'><div style='position:absolute;width:32px;height:32px;border-radius:16px;background:" + color + "44;border:1px solid " + color + "88;'></div><div style='width:16px;height:16px;border-radius:8px;background:" + color + ";border:2.5px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.5);'></div></div>";
          } else {
            markerHtml = "<div style='width:32px;height:32px;display:flex;align-items:center;justify-content:center;'><div style='background:" + color + ";color:#FFF;font-size:12px;font-weight:bold;width:26px;height:26px;border-radius:13px;display:flex;align-items:center;justify-content:center;border:2.5px solid #FFF;box-shadow:0 3px 8px rgba(0,0,0,0.4);'>📍</div></div>";
          }

          var cIcon = L.divIcon({
            className: "custom-point-marker",
            html: markerHtml,
            iconSize: iconSize,
            iconAnchor: iconAnchor
          });

          var zOffset = isSelected ? 3000 : 1200;
          var marker = L.marker([m.lat, m.lng], { icon: cIcon, zIndexOffset: zOffset }).addTo(featureGroup);
          if (m.id !== undefined && m.id !== null) {
            marker.on("click", function() { sendToParent({ type: "SELECT_MARKER", markerId: m.id }); });
          }
          if (m.label && (m.id === undefined || m.id === null)) {
            var stationDetails = m.dateTime || m.phase || m.photoUrl;
            var popup = "<div class='custom-popup" + (stationDetails ? " station-card" : "") + "'><div class='popup-title' style='color:" + color + ";'>" + escapeHtml(m.label) + "</div>";
            if (m.photoUrl) popup += "<img class='station-photo' src='" + escapeHtml(m.photoUrl) + "' alt='Photo observation' />";
            if (m.sublabel) popup += "<div class='popup-badge'>" + escapeHtml(m.sublabel) + "</div>";
            if (stationDetails) popup += "<div class='station-grid'>" +
              "<span class='station-key'>Date</span><span class='station-value'>" + escapeHtml(m.dateTime || '—') + "</span>" +
              "<span class='station-key'>Phase</span><span class='station-value'>" + escapeHtml(m.phase || '—') + "</span>" +
              "<span class='station-key'>Statut</span><span class='station-value'>" + escapeHtml(m.workStatus || '—') + "</span>" +
              "<span class='station-key'>D_min</span><span class='station-value'>" + escapeHtml(m.distanceOffset) + " m</span>" +
              "<span class='station-key'>Aujourd'hui</span><span class='station-value'>+" + escapeHtml(m.dailyMeters || 0) + " m (+" + escapeHtml(m.dailyPercentage || 0) + "%)</span>" +
              "<span class='station-key'>Total</span><span class='station-value'>" + escapeHtml(m.totalPercentage || 0) + "%</span></div>";
            if (m.remarks) popup += "<div class='popup-detail' style='margin-top:8px'>" + escapeHtml(m.remarks) + "</div>";
            if (m.validationStatus === 'exceptional') popup += "<div class='popup-badge popup-badge-gold'>Validation exceptionnelle</div>";
            popup += "</div>";
            marker.bindPopup(popup, { maxWidth: 290, autoPanPadding: [18, 18] });
          }
        });
      }

      // Action listener for recenter and satellite toggle
      var originalWindowGisMapAction = window.gisMapAction;
      window.gisMapAction = function(action, payload) {
        if (typeof originalWindowGisMapAction === 'function') {
          try { originalWindowGisMapAction(action, payload); } catch(e) {}
        }
        if (action === 'recenter') {
          if (activeSelectedMarker) {
            map.setView([activeSelectedMarker.lat, activeSelectedMarker.lng], 17, { animate: true });
          } else {
            var fLayer = selectedTronconLayer || selectedChantierLayer;
            if (fLayer && fLayer.getBounds && fLayer.getBounds().isValid()) {
              map.fitBounds(fLayer.getBounds(), { paddingTopLeft: [35, 76], paddingBottomRight: [35, fitPaddingBottom || 35], maxZoom: 17, animate: true });
            }
          }
        } else if (action === 'toggleSatellite') {
          if (map.hasLayer(googleHybrid) || map.hasLayer(googleSat) || map.hasLayer(esriSatellite)) {
            map.removeLayer(googleHybrid);
            map.removeLayer(googleSat);
            map.removeLayer(esriSatellite);
            map.addLayer(googleStreets);
          } else {
            map.removeLayer(googleStreets);
            map.addLayer(googleHybrid);
          }
        } else if (action === 'toggleKml') {
          var toggleEl = document.getElementById('kml-visibility-toggle');
          if (map.hasLayer(kmlLayerGroup)) {
            map.removeLayer(kmlLayerGroup);
            if (toggleEl) {
              toggleEl.className = 'kml-toggle-badge kml-toggle-badge-off';
              toggleEl.innerHTML = '<span class="kml-toggle-dot kml-toggle-dot-off"></span><span>KML OFF</span>';
            }
            sendToParent({ type: 'TOGGLE_KML_VISIBILITY', visible: false });
          } else {
            map.addLayer(kmlLayerGroup);
            if (toggleEl) {
              toggleEl.className = 'kml-toggle-badge';
              toggleEl.innerHTML = '<span class="kml-toggle-dot"></span><span>KML ON</span>';
            }
            sendToParent({ type: 'TOGGLE_KML_VISIBILITY', visible: true });
          }
        }
      };

      // Fit map to features / center on active observation
      if (activeSelectedMarker) {
        setTimeout(function() {
          map.setView([activeSelectedMarker.lat, activeSelectedMarker.lng], 17, { animate: true });
        }, 150);
      } else {
        fitAllFeatures();
        setTimeout(function() { fitAllFeatures(); }, 150);
        var focusLayer = selectedTronconLayer || selectedChantierLayer;
        if (focusLayer && focusLayer.getBounds) {
          setTimeout(function() {
            var selectedBounds = focusLayer.getBounds();
            if (selectedBounds && selectedBounds.isValid()) map.fitBounds(selectedBounds, {
              paddingTopLeft: [35, 76], paddingBottomRight: [35, fitPaddingBottom || 35], maxZoom: 17, animate: true
            });
          }, 260);
        }
      }
      setTimeout(function() { map.invalidateSize(); }, 500);
      window.addEventListener("resize", function() { map.invalidateSize(); });

      // Level 6B: Activate temporal indicator badge
      (function() {
        var badge = document.getElementById('temporal-badge');
        var dateEl = document.getElementById('temporal-date');
        var pctEl = document.getElementById('temporal-pct');
        if (!badge) return;
        var tMode = config.temporalMode;
        var tDate = config.temporalDate;
        var tPct = config.temporalProgress;
        if (tMode === 'historical' && tDate) {
          if (dateEl) dateEl.textContent = tDate;
          if (pctEl) pctEl.textContent = (tPct >= 0) ? Math.round(tPct) + '% av.' : '';
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      })();

    } catch (err) {
      console.error("GIS map init error:", err);
      sendToParent({ type: "MAP_ERROR", error: String(err) });
    }
  </script>
</body>
</html>`;
  }, [
    referenceGeometry,
    chantierAlignments,
    selectedChantierId,
    rawGeoJson,
    kmlGeometry,
    kmlMetadata,
    showKmlLayer,
    searchLocation,
    troncons,
    corridors,
    selectedCorridorId,
    effectiveAoi,
    refinePreviousAoiGeometry,
    isRefineMode,
    enableAoiDrawing,
    selectedTronconId,
    selectedMarkerId,
    center,
    zoom,
    fitPaddingBottom,
    optimizePkLabels,
    customMarkers,
    customLines,
    temporalState,
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
        ref={webViewRef}
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

export default InteractiveGisMap;

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
