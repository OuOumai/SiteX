import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator, DimensionValue, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { WebView } from 'react-native-webview';
import { Text } from '@/components/ui/text';
import { Ionicons } from '@expo/vector-icons';
import { Palette } from '@/constants/theme';
import { KmlMetadata, KmlGroundOverlay, KmlPhotoOverlay, getMediaUrl } from '@/services/api';
import {
  GisFeatureGeometry,
  GisTronconSegment,
  GisChantierAlignment,
  TRONCON_PALETTE,
} from './InteractiveGisMap';
import type { DerivedTemporalState } from '@/lib/temporal';
import { applyTemporalProgressToSegments, isKmlElementVisible } from '@/lib/temporal';

export interface LayerVisibilityState {
  aoi: boolean;
  ref: boolean;
  troncons: boolean;
  obs: boolean;
  kml: boolean;
  kmlImages: boolean;
}

const DEFAULT_LAYER_VISIBILITY: LayerVisibilityState = {
  aoi: true,
  ref: true,
  troncons: true,
  obs: true,
  kml: true,
  kmlImages: true,
};

// Global cache to preserve layer toggles across 3D -> 2D -> 3D view changes
let cached3DLayerVisibility: LayerVisibilityState = { ...DEFAULT_LAYER_VISIBILITY };

export const TRONCON_HIGH_CONTRAST_PALETTE_3D = [
  '#2563EB', // Tronçon 1: Vibrant Royal Blue
  '#F97316', // Tronçon 2: Vibrant Bright Orange
  '#8B5CF6', // Tronçon 3: Vibrant Deep Violet
  '#10B981', // Tronçon 4: Vibrant Emerald Green
  '#EF4444', // Tronçon 5: Vibrant Crimson Red
  '#06B6D4', // Tronçon 6: Vibrant Electric Cyan
  '#F59E0B', // Tronçon 7: Vibrant Amber
  '#EC4899', // Tronçon 8: Vibrant Hot Pink
];

export function formatPkDisplay(pk: number | string | undefined | null): string {
  if (pk === undefined || pk === null || pk === '—') return '—';
  if (typeof pk === 'string' && pk.includes('+')) return pk.startsWith('PK ') ? pk : `PK ${pk}`;
  const val = Number(pk);
  if (isNaN(val)) return String(pk);
  const totalMeters = val < 20 ? Math.round(val * 1000) : Math.round(val);
  const km = Math.floor(totalMeters / 1000);
  const m = totalMeters % 1000;
  return `PK ${km}+${m < 10 ? '00' : m < 100 ? '0' : ''}${m}`;
}

export interface InteractiveGis3DMapProps {
  referenceGeometry?: GisFeatureGeometry | null;
  chantierAlignments?: GisChantierAlignment[] | null;
  selectedChantierId?: number | string | null;
  onSelectChantierAlignment?: (chantierId: number | string) => void;
  troncons?: GisTronconSegment[] | null;
  selectedTronconId?: number | string | null;
  onSelectTroncon?: (tronconId: number | string) => void;
  aoiGeometry?: GisFeatureGeometry | null;
  existingAois?: Array<{
    id?: number | string;
    chantierId?: number | string;
    nom: string;
    geometry: any;
    color?: string;
  }> | null;
  kmlGeometry?: GisFeatureGeometry | null;
  kmlMetadata?: KmlMetadata | null;
  kmlGroundOverlays?: KmlGroundOverlay[] | null;
  kmlPhotoOverlays?: KmlPhotoOverlay[] | null;
  showKmlLayer?: boolean;
  showKmlImages?: boolean;
  customMarkers?: Array<{
    id?: number | string;
    lat: number;
    lng: number;
    label?: string;
    sublabel?: string;
    color?: string;
    workStatus?: string;
    dailyPercentage?: number;
    totalPercentage?: number;
    remarks?: string;
    troncon_id?: number | string;
    distance_from_start?: number;
  }> | null;
  selectedMarkerId?: number | string | null;
  onSelectMarker?: (markerId: number | string) => void;
  onSelectAlignment?: () => void;
  onSelectKml?: (metadata: KmlMetadata) => void;
  onSelectKmlImage?: (overlay: KmlGroundOverlay | KmlPhotoOverlay) => void;
  center?: [number, number];
  height?: DimensionValue;
  style?: any;
  // Level 6B — Temporal synchronization
  temporalState?: DerivedTemporalState | null;
  // 3D Object Layer Visibility Controls
  layerVisibility?: Partial<LayerVisibilityState>;
  onLayerVisibilityChange?: (visibility: LayerVisibilityState) => void;
  // Optional button vertical offset (default: 160px, safe from search bars and banners)
  buttonTop?: number;
}

export function InteractiveGis3DMap({
  referenceGeometry,
  chantierAlignments = null,
  selectedChantierId = null,
  onSelectChantierAlignment,
  troncons = null,
  selectedTronconId = null,
  onSelectTroncon,
  aoiGeometry = null,
  existingAois = null,
  kmlGeometry = null,
  kmlMetadata = null,
  kmlGroundOverlays = null,
  kmlPhotoOverlays = null,
  showKmlLayer = true,
  showKmlImages = true,
  customMarkers = null,
  selectedMarkerId = null,
  onSelectMarker,
  onSelectAlignment,
  onSelectKml,
  onSelectKmlImage,
  center = [35.73, -5.89],
  height = 500,
  style,
  temporalState = null,
  layerVisibility: propsLayerVisibility,
  onLayerVisibilityChange,
  buttonTop = 74,
}: InteractiveGis3DMapProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const [selectedHudInfo, setSelectedHudInfo] = useState<any | null>(null);
  const prevLoggedSigRef = useRef<string>('');

  // 3D Layer Visibility UX: Closed by default, state preserved across renders and 3D -> 2D -> 3D
  const [is3DLayersPanelOpen, setIs3DLayersPanelOpen] = useState(false);
  const [layerVisibility, setLayerVisibility] = useState<LayerVisibilityState>(() => ({
    ...cached3DLayerVisibility,
    ...(propsLayerVisibility || {}),
  }));

  useEffect(() => {
    if (propsLayerVisibility) {
      setLayerVisibility((prev) => {
        const next = { ...prev, ...propsLayerVisibility };
        cached3DLayerVisibility = next;
        return next;
      });
    }
  }, [propsLayerVisibility]);

  const send3DMessage = (msg: any) => {
    if (Platform.OS === 'web') {
      try {
        iframeRef.current?.contentWindow?.postMessage(msg, '*');
      } catch (err) {
        console.warn('[InteractiveGis3DMap] Failed to dispatch message to iframe:', err);
      }
    } else {
      try {
        webViewRef.current?.postMessage(JSON.stringify(msg));
      } catch (err) {
        console.warn('[InteractiveGis3DMap] Failed to dispatch message to webview:', err);
      }
    }
  };

  const toggleLayer = (layerKey: keyof LayerVisibilityState) => {
    setLayerVisibility((prev) => {
      const updated = { ...prev, [layerKey]: !prev[layerKey] };
      cached3DLayerVisibility = updated;
      if (onLayerVisibilityChange) {
        onLayerVisibilityChange(updated);
      }
      send3DMessage({
        type: 'SET_LAYER_VISIBILITY',
        layer: layerKey,
        visible: updated[layerKey],
      });
      return updated;
    });
  };

  // Diagnostic 1 & 2: Data reception logging (throttled & dev-only)
  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;

    const refCoordsCount = referenceGeometry?.coordinates?.length || 0;
    const tronconsCount = troncons?.length || 0;
    const obsCount = customMarkers?.length || 0;
    const kmlElementsCount = (kmlGeometry?.coordinates?.length ? 1 : 0)
      + (kmlGroundOverlays?.length || 0)
      + (kmlPhotoOverlays?.length || 0);

    const sig = `${selectedChantierId ?? ''}_${refCoordsCount}_${tronconsCount}_${obsCount}_${kmlElementsCount}`;
    if (prevLoggedSigRef.current === sig) {
      return; // Avoid logging identical dataset on repeated renders
    }
    prevLoggedSigRef.current = sig;

    console.log(
      `[3D DATA DEBUG]\n` +
      `- chantier id: ${selectedChantierId ?? 'N/A'}\n` +
      `- reference alignment present?: ${Boolean(referenceGeometry)}\n` +
      `- reference alignment coordinates count: ${refCoordsCount}\n` +
      `- troncons count: ${tronconsCount}\n` +
      `- observations count: ${obsCount}\n` +
      `- KML elements count: ${kmlElementsCount}`
    );

    if (troncons && troncons.length > 0) {
      troncons.forEach((tr, idx) => {
        let coords: any[] = [];
        if (tr.geometry) {
          if (Array.isArray(tr.geometry.coordinates)) {
            coords = tr.geometry.coordinates;
          } else if (typeof tr.geometry === 'string') {
            try {
              const parsed = JSON.parse(tr.geometry);
              coords = parsed.coordinates || [];
            } catch {}
          }
        }
        const firstCoord = coords.length > 0 ? JSON.stringify(coords[0]) : 'none';
        const lastCoord = coords.length > 0 ? JSON.stringify(coords[coords.length - 1]) : 'none';

        console.log(
          `Tronçon ${idx + 1}\n` +
          `  id: ${tr.id}\n` +
          `  nom: ${tr.nom || 'Tronçon ' + (idx + 1)}\n` +
          `  pk_debut: ${tr.pk_debut}\n` +
          `  pk_fin: ${tr.pk_fin}\n` +
          `  avancement: ${tr.progress_percentage ?? (tr as any).avancement ?? 'N/A'}\n` +
          `  geometry exists?: ${Boolean(tr.geometry)}\n` +
          `  geometry type: ${tr.geometry?.type || (typeof tr.geometry === 'string' ? 'string' : 'N/A')}\n` +
          `  coordinate count: ${coords.length}\n` +
          `  first coordinate: ${firstCoord}\n` +
          `  last coordinate: ${lastCoord}`
        );
      });
    } else if (selectedChantierId && referenceGeometry) {
      // Only warn if chantier & alignment are loaded and tronçons are expected but missing!
      console.warn('[3D DATA DEBUG] WARNING: chantier and alignment are loaded, but troncons count is 0!');
    }
  }, [referenceGeometry, selectedChantierId, troncons, customMarkers, kmlGeometry, kmlGroundOverlays, kmlPhotoOverlays]);

  // Listen to messages from 3D Three.js scene (Web)
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleMessage = (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'object') return;
        if (event.data.type === 'SELECT_3D_OBJECT') {
          setSelectedHudInfo(event.data.payload);
          if (event.data.payload?.category === 'troncon' && onSelectTroncon) {
            onSelectTroncon(event.data.payload.id);
          } else if (event.data.payload?.category === 'marker' && onSelectMarker) {
            onSelectMarker(event.data.payload.id);
          } else if (event.data.payload?.category === 'alignment' && onSelectAlignment) {
            onSelectAlignment();
          } else if (event.data.payload?.category === 'kml' && onSelectKml && kmlMetadata) {
            onSelectKml(kmlMetadata);
          } else if (event.data.payload?.category === 'kml_image' && onSelectKmlImage) {
            onSelectKmlImage(event.data.payload.overlay);
          } else if (event.data.payload?.category === 'chantier_alignment' && onSelectChantierAlignment) {
            onSelectChantierAlignment(event.data.payload.id);
          }
        } else if (event.data.type === 'CLEAR_3D_SELECTION') {
          setSelectedHudInfo(null);
          if (onSelectTroncon) {
            (onSelectTroncon as any)(null);
          }
        }
      };

      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [onSelectTroncon, onSelectMarker, onSelectAlignment, onSelectKml, onSelectKmlImage, onSelectChantierAlignment, kmlMetadata]);

  // Handle messages on React Native Mobile WebView
  const handleWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'SELECT_3D_OBJECT') {
        setSelectedHudInfo(data.payload);
        if (data.payload?.category === 'troncon' && onSelectTroncon) {
          onSelectTroncon(data.payload.id);
        } else if (data.payload?.category === 'marker' && onSelectMarker) {
          onSelectMarker(data.payload.id);
        } else if (data.payload?.category === 'alignment' && onSelectAlignment) {
          onSelectAlignment();
        } else if (data.payload?.category === 'kml' && onSelectKml && kmlMetadata) {
          onSelectKml(kmlMetadata);
        } else if (data.payload?.category === 'kml_image' && onSelectKmlImage) {
          onSelectKmlImage(data.payload.overlay);
        } else if (data.payload?.category === 'chantier_alignment' && onSelectChantierAlignment) {
          onSelectChantierAlignment(data.payload.id);
        }
      } else if (data.type === 'CLEAR_3D_SELECTION') {
        setSelectedHudInfo(null);
        if (onSelectTroncon) {
          (onSelectTroncon as any)(null);
        }
      }
    } catch {}
  };

  // Generate self-contained Three.js 3D HTML
  const threeHtml = useMemo(() => {
    const rawGroundOverlays = (kmlGroundOverlays || (kmlMetadata && kmlMetadata.groundOverlays) || []).map((go) => {
      if (go?.icon?.href) {
        return {
          ...go,
          icon: {
            ...go.icon,
            href: getMediaUrl(go.icon.href),
          },
        };
      }
      return go;
    });
    const rawPhotoOverlays = (kmlPhotoOverlays || (kmlMetadata && kmlMetadata.photoOverlays) || []).map((po) => {
      if (po?.icon?.href) {
        return {
          ...po,
          icon: {
            ...po.icon,
            href: getMediaUrl(po.icon.href),
          },
        };
      }
      return po;
    });

    // ── Level 6B: Apply temporal filtering ────────────────────────────────
    const isHistorical = temporalState && temporalState.mode === 'historical';

    const temporalTroncons = isHistorical && troncons && troncons.length > 0
      ? applyTemporalProgressToSegments(troncons, temporalState!)
      : (troncons || []);

    const temporalMarkers = (() => {
      if (!customMarkers || customMarkers.length === 0) return [];
      if (!isHistorical || !temporalState!.visibleObservationIds) return customMarkers;
      return customMarkers.filter(m => {
        if (m.id === undefined || m.id === null) return true;
        const numId = typeof m.id === 'number' ? m.id : Number(m.id);
        return temporalState!.visibleObservationIds!.has(numId);
      });
    })();

    const showKmlLayerTemporal = showKmlLayer !== false && (
      !isHistorical ||
      isKmlElementVisible(kmlMetadata?.time, temporalState?.selectedDateTime ?? null)
    );

    // Compute observations count per tronçon for rich 3D inspection
    const tronconsWithObs = temporalTroncons.map((tr) => {
      let count = (tr as any).observations_count;
      if (count === undefined && customMarkers) {
        count = customMarkers.filter((m: any) => {
          if (m.troncon_id && String(m.troncon_id) === String(tr.id)) return true;
          if (m.distance_from_start !== undefined && tr.pk_debut !== undefined && tr.pk_fin !== undefined) {
            const pkDebM = Number(tr.pk_debut) < 20 ? Number(tr.pk_debut) * 1000 : Number(tr.pk_debut);
            const pkFinM = Number(tr.pk_fin) < 20 ? Number(tr.pk_fin) * 1000 : Number(tr.pk_fin);
            const d = Number(m.distance_from_start);
            return d >= pkDebM && d <= pkFinM;
          }
          return false;
        }).length;
      }
      return {
        ...tr,
        observations_count: count ?? 0,
      };
    });

    const config = {
      referenceGeometry: referenceGeometry || null,
      chantierAlignments: chantierAlignments || [],
      selectedChantierId: selectedChantierId ?? null,
      troncons: tronconsWithObs,
      selectedTronconId: selectedTronconId ?? null,
      aoiGeometry: aoiGeometry || null,
      existingAois: existingAois || [],
      kmlGeometry: kmlGeometry || null,
      kmlMetadata: kmlMetadata || null,
      kmlGroundOverlays: rawGroundOverlays,
      kmlPhotoOverlays: rawPhotoOverlays,
      showKmlLayer: showKmlLayerTemporal,
      showKmlImages: showKmlImages !== false,
      customMarkers: temporalMarkers,
      selectedMarkerId: selectedMarkerId ?? null,
      center: center || [35.73, -5.89],
      palette: TRONCON_HIGH_CONTRAST_PALETTE_3D,
      isDev: typeof __DEV__ !== 'undefined' ? __DEV__ : false,
      layerVisibility: cached3DLayerVisibility,
      // Level 6B: temporal info for the 3D overlay badge
      temporalMode: isHistorical ? 'historical' : 'current',
      temporalDate: temporalState?.selectedDateLabel ?? null,
      temporalProgress: isHistorical ? temporalState!.chantierProgress : -1,
    };

    const serializedConfig = JSON.stringify(config).replace(/<\/script/gi, '<\\/script');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>SiteX 3D GIS</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: #070D1E;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #F8FAFC;
      user-select: none;
    }
    #canvas-container {
      width: 100%;
      height: 100%;
      position: absolute;
      left: 0;
      top: 0;
    }

    /* Loading Screen */
    #loading-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(circle at center, #0F172A 0%, #070D1E 100%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 999;
      transition: opacity 0.4s ease;
    }
    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid rgba(16, 185, 129, 0.2);
      border-top-color: #10B981;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    #loading-text {
      font-size: 14px;
      font-weight: 600;
      color: #94A3B8;
      letter-spacing: 0.5px;
    }

    /* Part E: Compact Collapsible Aperçu Container */
    .hud-apercu-card {
      position: absolute;
      top: 116px;
      right: 12px;
      width: 100px;
      background: rgba(15, 23, 42, 0.90);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(16, 185, 129, 0.40);
      border-radius: 10px;
      padding: 4px 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      z-index: 100;
      pointer-events: auto;
      transition: all 0.2s ease;
    }
    .hud-apercu-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 2px 3px 4px 3px;
      cursor: pointer;
      user-select: none;
    }
    .hud-apercu-card.collapsed .hud-apercu-header {
      padding-bottom: 2px;
    }
    .hud-apercu-title {
      font-size: 11px;
      font-weight: 700;
      color: #F8FAFC;
      letter-spacing: 0.3px;
    }
    .hud-apercu-chevron {
      font-size: 9px;
      color: #94A3B8;
      transition: transform 0.2s ease;
      line-height: 1;
    }
    .hud-apercu-card.collapsed .hud-apercu-chevron {
      transform: rotate(180deg);
    }
    .hud-apercu-body {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .hud-apercu-card.collapsed .hud-apercu-body {
      display: none;
    }
    .hud-cam-btn {
      background: rgba(30, 41, 59, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      color: #F8FAFC;
      padding: 4px 6px;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: all 0.15s ease;
    }
    .hud-cam-btn:hover {
      background: rgba(16, 185, 129, 0.25);
      border-color: #10B981;
      transform: translateY(-1px);
    }
    .hud-cam-btn:active {
      transform: translateY(1px);
    }
    .cam-icon { font-size: 12px; line-height: 1; }
    .cam-cube-icon { flex-shrink: 0; }
    .cam-text { font-size: 10px; letter-spacing: 0.2px; }

    /* 3D Compass / North Indicator */
    .compass-box {
      position: absolute;
      bottom: 20px;
      left: 20px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 90;
      font-size: 11px;
      font-weight: 800;
      color: #EF4444;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.4);
    }

    /* Metric Scale HUD */
    .metric-scale-box {
      position: absolute;
      bottom: 20px;
      right: 20px;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      color: #94A3B8;
      z-index: 90;
    }

    /* PK Labels Layer */
    #pk-labels-layer {
      position: absolute;
      top: 0; left: 0; width: 100%; height: 100%;
      pointer-events: none;
      overflow: hidden;
      z-index: 85;
    }
    .pk-tag {
      position: absolute;
      transform: translate(-50%, -100%);
      background: rgba(15, 23, 42, 0.90);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 700;
      color: #F8FAFC;
      letter-spacing: 0.5px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      display: none;
      white-space: nowrap;
      transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
    }
    .pk-tag.highlight {
      border-color: #38BDF8;
      background: rgba(14, 116, 144, 0.96);
      color: #FFFFFF;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.7);
      transform: translate(-50%, -100%) scale(1.08);
    }

    /* Level 6B — Temporal mode indicator badge */
    #temporal-badge-3d {
      position: absolute;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, rgba(124,58,237,0.95) 0%, rgba(79,70,229,0.90) 100%);
      border: 1.5px solid rgba(167,139,250,0.7);
      border-radius: 20px;
      padding: 5px 14px 5px 10px;
      font-size: 12px;
      font-weight: 700;
      color: #F8FAFC;
      box-shadow: 0 4px 20px rgba(124,58,237,0.6), 0 2px 8px rgba(0,0,0,0.5);
      pointer-events: none;
      white-space: nowrap;
      backdrop-filter: blur(8px);
      letter-spacing: 0.3px;
    }
    #temporal-badge-3d.hidden { display: none !important; }
    .t3d-clock {
      width: 14px; height: 14px;
      border-radius: 50%;
      border: 2px solid rgba(253,230,138,0.9);
      position: relative; flex-shrink: 0;
    }
    .t3d-clock::before {
      content: ''; position: absolute; top: 50%; left: 50%;
      width: 4px; height: 1.5px; background: rgba(253,230,138,0.9);
      transform-origin: left center;
      transform: translate(-1px,-50%) rotate(-45deg);
    }
    .t3d-clock::after {
      content: ''; position: absolute; top: 50%; left: 50%;
      width: 3px; height: 1.5px; background: rgba(253,230,138,0.9);
      transform-origin: left center;
      transform: translate(-1px,-50%) rotate(75deg);
    }
    #t3d-date { color: #FDE68A; }
    #t3d-pct  { color: rgba(167,243,208,0.9); }
  </style>

  <!-- Load Three.js & OrbitControls from CDN with fallback -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
</head>
<body>
  <div id="loading-overlay">
    <div class="spinner"></div>
    <div id="loading-text">Initialisation du moteur 3D SiteX...</div>
  </div>

  <div id="canvas-container"></div>
  <div id="pk-labels-layer"></div>

  <!-- Level 6B: Temporal indicator badge -->
  <div id="temporal-badge-3d" class="hidden">
    <div class="t3d-clock"></div>
    <span>HISTORIQUE</span>
    <span style="color:rgba(248,250,252,0.4);margin:0 1px">·</span>
    <span id="t3d-date"></span>
    <span style="color:rgba(248,250,252,0.4);margin:0 1px">·</span>
    <span id="t3d-pct"></span>
  </div>

  <!-- Part E: Compact Collapsible Aperçu Container -->
  <div id="hud-apercu-card" class="hud-apercu-card">
    <div id="hud-apercu-header" class="hud-apercu-header" title="Afficher / Masquer Aperçu">
      <span class="hud-apercu-title">Aperçu</span>
      <span id="hud-apercu-chevron" class="hud-apercu-chevron">▲</span>
    </div>
    <div id="hud-apercu-body" class="hud-apercu-body">
      <button class="hud-cam-btn" id="btn-reset" title="Vue Globale">
        <span class="cam-icon">🌐</span>
        <span class="cam-text">Global</span>
      </button>
      <button class="hud-cam-btn" id="btn-center" title="Centrer sur le chantier">
        <span class="cam-icon">🎯</span>
        <span class="cam-text">Chantier</span>
      </button>
      <button class="hud-cam-btn" id="btn-top" title="Vue de dessus">
        <span class="cam-icon">📐</span>
        <span class="cam-text">Top</span>
      </button>
      <button class="hud-cam-btn" id="btn-iso" title="Perspective 3D">
        <svg class="cam-cube-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" fill="#F59E0B" fill-opacity="0.3"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
        <span class="cam-text">3D</span>
      </button>
    </div>
  </div>

  <div class="compass-box" title="Nord Géographique">N ▲</div>
  <div class="metric-scale-box" id="scale-indicator">Échelle 1:1 (Métrique)</div>

  <script>
    (function() {
      var CONFIG = ${serializedConfig};
      if (CONFIG.isDev) {
        console.log('[Three.js Engine] component mounted / script executing');
      }
      var container = document.getElementById('canvas-container');
      var loadingOverlay = document.getElementById('loading-overlay');
      var loadingText = document.getElementById('loading-text');
      var pkLabelsLayer = document.getElementById('pk-labels-layer');

      if (typeof THREE === 'undefined') {
        console.error('[Three.js Engine] Failed: THREE is undefined');
        loadingText.innerText = "Erreur: Le moteur 3D Three.js n'a pas pu être chargé (Vérifiez la connexion réseau).";
        return;
      }
      if (CONFIG.isDev) {
        console.log('[Three.js Engine] Three.js loaded (r' + THREE.REVISION + ')');
      }

      // Robust Coordinate Extraction Helper
      function extractCoords(geom) {
        if (!geom) return null;
        var g = geom;
        if (typeof g === 'string') {
          try { g = JSON.parse(g); } catch(e) { return null; }
        }
        if (g.type === 'Feature' && g.geometry) g = g.geometry;
        if (g.coordinates && Array.isArray(g.coordinates)) {
          if (g.type === 'MultiLineString' && Array.isArray(g.coordinates[0])) return g.coordinates[0];
          return g.coordinates;
        }
        if (Array.isArray(g) && g.length > 0 && Array.isArray(g[0])) return g;
        return null;
      }

      // PK formatting helper
      function formatPkDisplay(pk) {
        if (pk === undefined || pk === null || pk === '—') return '—';
        if (typeof pk === 'string' && pk.indexOf('+') !== -1) return pk.indexOf('PK ') === 0 ? pk : ('PK ' + pk);
        var val = Number(pk);
        if (isNaN(val)) return String(pk);
        var totalMeters = val < 20 ? Math.round(val * 1000) : Math.round(val);
        var km = Math.floor(totalMeters / 1000);
        var m = totalMeters % 1000;
        return 'PK ' + km + '+' + (m < 10 ? '00' : m < 100 ? '0' : '') + m;
      }

      // 1. Calculate Geodetic Origin (ENU local tangent plane)
      var origin = (function() {
        var lats = [];
        var lons = [];

        function addCoords(arr) {
          if (!Array.isArray(arr)) return;
          for (var i = 0; i < arr.length; i++) {
            if (Array.isArray(arr[i]) && arr[i].length >= 2) {
              lons.push(arr[i][0]);
              lats.push(arr[i][1]);
            }
          }
        }

        var refC = extractCoords(CONFIG.referenceGeometry);
        if (refC) addCoords(refC);

        if (CONFIG.aoiGeometry) {
          var aoiC = extractCoords(CONFIG.aoiGeometry);
          if (aoiC) addCoords(aoiC);
        }
        var kmlC = extractCoords(CONFIG.kmlGeometry);
        if (kmlC) addCoords(kmlC);

        if (CONFIG.chantierAlignments && CONFIG.chantierAlignments.length > 0) {
          for (var caI = 0; caI < CONFIG.chantierAlignments.length; caI++) {
            var caC = extractCoords(CONFIG.chantierAlignments[caI].geometry);
            if (caC) addCoords(caC);
          }
        }

        if (CONFIG.troncons && CONFIG.troncons.length > 0) {
          for (var trI = 0; trI < CONFIG.troncons.length; trI++) {
            var trc = extractCoords(CONFIG.troncons[trI].geometry);
            if (trc) addCoords(trc);
          }
        }

        if (lats.length > 0 && lons.length > 0) {
          var sumLat = lats.reduce(function(a, b) { return a + b; }, 0);
          var sumLon = lons.reduce(function(a, b) { return a + b; }, 0);
          return { lat: sumLat / lats.length, lon: sumLon / lons.length };
        }

        return { lat: CONFIG.center[0], lon: CONFIG.center[1] };
      })();

      // Local East-North-Up (ENU) Coordinate Converter (WGS 84 -> metric meters)
      var R = 6378137.0;
      var rad = Math.PI / 180.0;
      var lat0Rad = origin.lat * rad;

      function toEnu(lon, lat, alt) {
        var dLat = (lat - origin.lat) * rad;
        var dLon = (lon - origin.lon) * rad;
        var x = R * dLon * Math.cos(lat0Rad);
        var z = -R * dLat;
        var y = (alt !== undefined && alt !== null && !isNaN(alt)) ? Number(alt) : 0;
        return new THREE.Vector3(x, y, z);
      }

      // 2. Setup Three.js Scene, Camera, Renderer
      var scene = new THREE.Scene();
      scene.background = new THREE.Color(0x070D1E);
      scene.fog = new THREE.FogExp2(0x070D1E, 0.00035);

      var camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 80000);
      var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      container.appendChild(renderer.domElement);

      var controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.maxPolarAngle = Math.PI / 2 - 0.01;
      controls.minDistance = 5;
      controls.maxDistance = 45000;

      // 3. Lighting
      var ambientLight = new THREE.AmbientLight(0xE2E8F0, 0.70);
      scene.add(ambientLight);

      var hemiLight = new THREE.HemisphereLight(0x60A5FA, 0x0F172A, 0.45);
      scene.add(hemiLight);

      var sunLight = new THREE.DirectionalLight(0xFFFFFF, 0.90);
      sunLight.position.set(1500, 2500, 1500);
      scene.add(sunLight);

      // 4. Layer Groups
      var groupAoi = new THREE.Group();
      var groupRef = new THREE.Group();
      var groupTroncons = new THREE.Group();
      var groupObs = new THREE.Group();
      var groupKml = new THREE.Group();
      var groupKmlImages = new THREE.Group();

      scene.add(groupAoi);
      scene.add(groupRef);
      scene.add(groupTroncons);
      scene.add(groupObs);
      scene.add(groupKml);
      scene.add(groupKmlImages);

      // Initialize visibility from CONFIG.layerVisibility
      var initVis = CONFIG.layerVisibility || {};
      if (initVis.aoi !== undefined) groupAoi.visible = !!initVis.aoi;
      if (initVis.ref !== undefined) groupRef.visible = !!initVis.ref;
      if (initVis.troncons !== undefined) groupTroncons.visible = !!initVis.troncons;
      if (initVis.obs !== undefined) groupObs.visible = !!initVis.obs;
      if (initVis.kml !== undefined) groupKml.visible = !!initVis.kml;
      if (initVis.kmlImages !== undefined) groupKmlImages.visible = !!initVis.kmlImages;

      // Stratified Interactive Target Lists (Raycasting Priority)
      var interactiveTroncons = []; // Priority 1
      var interactiveObs = [];      // Priority 2
      var interactiveKml = [];      // Priority 3
      var interactiveRef = [];      // Priority 4
      var pkBadges = [];            // Dynamic PK overlay badges

      var currentSelectedTronconId = CONFIG.selectedTronconId ? String(CONFIG.selectedTronconId) : null;

      // 5. Ground Blueprint Grid with Metric Circles (Hierarchy: Ground)
      var gridSize = 6000;
      var gridHelper = new THREE.GridHelper(gridSize, 60, 0x334155, 0x1E293B);
      gridHelper.position.y = -0.5;
      scene.add(gridHelper);

      [500, 1000, 2000].forEach(function(r) {
        var ringGeom = new THREE.RingGeometry(r - 1.5, r + 1.5, 64);
        var ringMat = new THREE.MeshBasicMaterial({ color: 0x1E293B, side: THREE.DoubleSide });
        var ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = -0.4;
        scene.add(ringMesh);
      });

      // 6. AOI (Zone d'Intérêt) 3D Extrusion & Ground Perimeter
      var aoiCoords = extractCoords(CONFIG.aoiGeometry);
      if (aoiCoords && aoiCoords.length >= 3) {
        var pts3d = [];
        for (var i = 0; i < aoiCoords.length; i++) {
          pts3d.push(toEnu(aoiCoords[i][0], aoiCoords[i][1], 0));
        }

        var aoiLineGeom = new THREE.BufferGeometry().setFromPoints(pts3d);
        var aoiLineMat = new THREE.LineBasicMaterial({ color: 0x3B82F6, linewidth: 2 });
        var aoiLine = new THREE.Line(aoiLineGeom, aoiLineMat);
        groupAoi.add(aoiLine);

        var fenceGeom = new THREE.BufferGeometry();
        var fenceVerts = [];
        for (var j = 0; j < pts3d.length - 1; j++) {
          var p1 = pts3d[j];
          var p2 = pts3d[j + 1];
          fenceVerts.push(p1.x, 0, p1.z,  p1.x, 25, p1.z,  p2.x, 25, p2.z);
          fenceVerts.push(p1.x, 0, p1.z,  p2.x, 25, p2.z,  p2.x, 0, p2.z);
        }
        fenceGeom.setAttribute('position', new THREE.Float32BufferAttribute(fenceVerts, 3));
        var fenceMat = new THREE.MeshBasicMaterial({
          color: 0x3B82F6,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide
        });
        var fenceMesh = new THREE.Mesh(fenceGeom, fenceMat);
        groupAoi.add(fenceMesh);
      }

      var hasTroncons = CONFIG.troncons && CONFIG.troncons.length > 0;

      // 7. Reference Alignment (Hierarchy: Subtle guide at y = 0.8, radius 1.0)
      var refCoords = extractCoords(CONFIG.referenceGeometry);
      if (refCoords && refCoords.length >= 2) {
        var refCurvePts = [];
        for (var k = 0; k < refCoords.length; k++) {
          refCurvePts.push(toEnu(refCoords[k][0], refCoords[k][1], 0.8));
        }

        var refCurve = refCurvePts.length === 2
          ? new THREE.LineCurve3(refCurvePts[0], refCurvePts[1])
          : new THREE.CatmullRomCurve3(refCurvePts, false, 'chordal', 0.2);

        var refTubeGeom = new THREE.TubeGeometry(refCurve, Math.min(refCurvePts.length * 8, 200), 1.0, 8, false);
        var refTubeMat = new THREE.MeshStandardMaterial({
          color: 0x38BDF8,
          roughness: 0.4,
          metalness: 0.2,
          emissive: 0x0284C7,
          emissiveIntensity: hasTroncons ? 0.15 : 0.4,
          transparent: true,
          opacity: hasTroncons ? 0.45 : 0.90
        });
        var refTubeMesh = new THREE.Mesh(refTubeGeom, refTubeMat);
        refTubeMesh.userData = {
          category: 'alignment',
          title: 'Alignement de Référence',
          length_km: (refCurve.getLength() / 1000).toFixed(3) + ' km',
          points_count: refCoords.length
        };
        groupRef.add(refTubeMesh);
        interactiveRef.push(refTubeMesh);

        // Subtle PK 0.000 Start Pin (Green)
        var startPt = refCurvePts[0];
        var startGeom = new THREE.CylinderGeometry(0.5, 0.5, 9, 16);
        var startMat = new THREE.MeshStandardMaterial({ color: 0x10B981, emissive: 0x059669 });
        var startMesh = new THREE.Mesh(startGeom, startMat);
        startMesh.position.set(startPt.x, startPt.y + 4.5, startPt.z);
        groupRef.add(startMesh);

        // Subtle PK Fin End Pin (Amber)
        var endPt = refCurvePts[refCurvePts.length - 1];
        var endGeom = new THREE.CylinderGeometry(0.5, 0.5, 9, 16);
        var endMat = new THREE.MeshStandardMaterial({ color: 0xF59E0B, emissive: 0xD97706 });
        var endMesh = new THREE.Mesh(endGeom, endMat);
        endMesh.position.set(endPt.x, endPt.y + 4.5, endPt.z);
        groupRef.add(endMesh);
      }

      // 7b. Multiple Chantier Alignments (project-level 3D overview)
      if (CONFIG.chantierAlignments && CONFIG.chantierAlignments.length > 0 && !refCoords) {
        for (var caIdx = 0; caIdx < CONFIG.chantierAlignments.length; caIdx++) {
          var ca = CONFIG.chantierAlignments[caIdx];
          var caCoords = extractCoords(ca.geometry);
          if (caCoords && caCoords.length >= 2) {
            var caCurvePts = [];
            for (var cap = 0; cap < caCoords.length; cap++) {
              caCurvePts.push(toEnu(caCoords[cap][0], caCoords[cap][1], 0.8));
            }
            var caCurve = caCurvePts.length === 2
              ? new THREE.LineCurve3(caCurvePts[0], caCurvePts[1])
              : new THREE.CatmullRomCurve3(caCurvePts, false, 'chordal', 0.2);
            var isSel = String(ca.id) === String(CONFIG.selectedChantierId);
            var caTubeGeom = new THREE.TubeGeometry(caCurve, Math.min(caCurvePts.length * 8, 200), isSel ? 2.5 : 1.8, 8, false);
            var caColor = isSel ? 0x10B981 : 0x38BDF8;
            var caTubeMat = new THREE.MeshStandardMaterial({
              color: caColor,
              roughness: 0.25,
              metalness: 0.3,
              emissive: caColor,
              emissiveIntensity: isSel ? 0.4 : 0.2
            });
            var caTubeMesh = new THREE.Mesh(caTubeGeom, caTubeMat);
            caTubeMesh.userData = {
              category: 'chantier_alignment',
              id: ca.id,
              title: ca.nom || ('Chantier ' + ca.id),
              length_km: ca.length_km ? (Number(ca.length_km).toFixed(2) + ' km') : '—'
            };
            groupRef.add(caTubeMesh);
            interactiveRef.push(caTubeMesh);
          }
        }
      }

      // Boundary separator generator function (perpendicular oriented disk)
      function createBoundarySeparator(pt, tangent, pkLabel, tronconIds) {
        var sepGroup = new THREE.Group();
        sepGroup.position.copy(pt);

        // Perpendicular thin disk (radius 5.0, thickness 0.6)
        var sepGeom = new THREE.CylinderGeometry(5.0, 5.0, 0.6, 24);
        var sepMat = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF,
          roughness: 0.15,
          metalness: 0.4,
          emissive: 0xE2E8F0,
          emissiveIntensity: 0.7
        });
        var sepMesh = new THREE.Mesh(sepGeom, sepMat);
        var upAxis = new THREE.Vector3(0, 1, 0);
        sepMesh.quaternion.setFromUnitVectors(upAxis, tangent);
        sepGroup.add(sepMesh);

        // High-contrast dark outer rim ring
        var rimGeom = new THREE.TorusGeometry(5.0, 0.3, 8, 24);
        var rimMat = new THREE.MeshBasicMaterial({ color: 0x0F172A });
        var rimMesh = new THREE.Mesh(rimGeom, rimMat);
        rimMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
        sepGroup.add(rimMesh);

        groupTroncons.add(sepGroup);

        // Dynamic HTML PK Tag Badge
        if (pkLabel && pkLabelsLayer) {
          var tagEl = document.createElement('div');
          tagEl.className = 'pk-tag';
          tagEl.textContent = pkLabel;
          pkLabelsLayer.appendChild(tagEl);

          pkBadges.push({
            pos: pt.clone(),
            label: pkLabel,
            tronconIds: (tronconIds || []).map(function(id) { return String(id); }),
            el: tagEl
          });
        }
      }

      // 8. Tronçons Découpés (Hierarchy: PRIMARY Dominant Linear Meshes at y = 3.2, Radius 3.2)
      if (hasTroncons) {
        for (var t = 0; t < CONFIG.troncons.length; t++) {
          var tr = CONFIG.troncons[t];
          var trCoords = extractCoords(tr.geometry);

          if (trCoords && trCoords.length >= 2) {
            var trPts = [];
            for (var tp = 0; tp < trCoords.length; tp++) {
              trPts.push(toEnu(trCoords[tp][0], trCoords[tp][1], 3.2));
            }

            var trCurve = trPts.length === 2
              ? new THREE.LineCurve3(trPts[0], trPts[1])
              : new THREE.CatmullRomCurve3(trPts, false, 'chordal', 0.2);

            // Deterministic high-contrast palette
            var trColorHex = tr.color || CONFIG.palette[t % CONFIG.palette.length] || '#2563EB';
            var trColor = new THREE.Color(trColorHex);

            var isSelected = currentSelectedTronconId && String(currentSelectedTronconId) === String(tr.id);

            // Dominant thick tube geometry
            var trTubeGeom = new THREE.TubeGeometry(trCurve, Math.max(trPts.length * 8, 24), 3.2, 8, false);
            var trTubeMat = new THREE.MeshStandardMaterial({
              color: trColor,
              roughness: 0.22,
              metalness: 0.18,
              emissive: trColor,
              emissiveIntensity: isSelected ? 0.85 : 0.35,
              transparent: false,
              opacity: 1.0
            });
            var trMesh = new THREE.Mesh(trTubeGeom, trTubeMat);
            if (isSelected) {
              trMesh.scale.set(1.15, 1.15, 1.15);
            }
            trMesh.userData = {
              category: 'troncon',
              id: tr.id,
              title: tr.nom || ('Tronçon ' + (t + 1)),
              pk_debut: tr.pk_debut !== undefined ? tr.pk_debut : '—',
              pk_fin: tr.pk_fin !== undefined ? tr.pk_fin : '—',
              progress: (tr.progress_percentage !== undefined ? tr.progress_percentage : (tr.avancement !== undefined ? tr.avancement : 0)) + '%',
              length_km: tr.length_km ? (Number(tr.length_km).toFixed(2) + ' km') : '—',
              observations_count: tr.observations_count !== undefined ? tr.observations_count : 0,
              color: trColorHex
            };
            groupTroncons.add(trMesh);
            interactiveTroncons.push(trMesh);

            // Boundary separators (Perpendicular orientation along tangent)
            var isFirstTroncon = (t === 0);
            var isLastTroncon = (t === CONFIG.troncons.length - 1);

            if (isFirstTroncon) {
              var tanStart = trPts.length > 1
                ? new THREE.Vector3().subVectors(trPts[1], trPts[0]).normalize()
                : new THREE.Vector3(0, 0, 1);
              createBoundarySeparator(trPts[0], tanStart, formatPkDisplay(tr.pk_debut), [tr.id]);
            }

            var nextTrId = (!isLastTroncon && CONFIG.troncons[t + 1]) ? CONFIG.troncons[t + 1].id : null;
            var tanEnd = trPts.length > 1
              ? new THREE.Vector3().subVectors(trPts[trPts.length - 1], trPts[trPts.length - 2]).normalize()
              : new THREE.Vector3(0, 0, 1);
            var attachedIds = nextTrId ? [tr.id, nextTrId] : [tr.id];
            createBoundarySeparator(trPts[trPts.length - 1], tanEnd, formatPkDisplay(tr.pk_fin), attachedIds);
          }
        }
      }

      // 9. Observations Terrain (Hierarchy: Slender secondary pins at y = 0)
      if (CONFIG.customMarkers && CONFIG.customMarkers.length > 0) {
        for (var m = 0; m < CONFIG.customMarkers.length; m++) {
          var obs = CONFIG.customMarkers[m];
          var obsPos = toEnu(obs.lng, obs.lat, 0);

          var obsColorHex = obs.color || (obs.workStatus === 'TERMINE' ? '#10B981' : (obs.workStatus === 'PROBLEME' ? '#EF4444' : '#F59E0B'));
          var obsColor = new THREE.Color(obsColorHex);

          // Slender pin cone (reduced size so it never obscures tronçon paths)
          var pinGeom = new THREE.ConeGeometry(1.8, 8.0, 16);
          var pinMat = new THREE.MeshStandardMaterial({ color: obsColor, emissive: obsColor, emissiveIntensity: 0.35 });
          var pinMesh = new THREE.Mesh(pinGeom, pinMat);
          pinMesh.rotation.x = Math.PI;
          pinMesh.position.set(obsPos.x, obsPos.y + 7.5, obsPos.z);

          // Slender sphere head
          var headGeom = new THREE.SphereGeometry(2.4, 16, 16);
          var headMesh = new THREE.Mesh(headGeom, pinMat);
          headMesh.position.set(obsPos.x, obsPos.y + 12.0, obsPos.z);

          var obsGroup = new THREE.Group();
          obsGroup.add(pinMesh);
          obsGroup.add(headMesh);
          obsGroup.userData = {
            category: 'marker',
            id: obs.id || m,
            title: obs.label || ('Observation #' + (m + 1)),
            status: obs.workStatus || 'EN_COURS',
            progress: obs.dailyPercentage !== undefined ? (obs.dailyPercentage + '%') : '—',
            remarks: obs.remarks || 'Aucune remarque'
          };
          pinMesh.userData = obsGroup.userData;
          headMesh.userData = obsGroup.userData;

          groupObs.add(obsGroup);
          interactiveObs.push(pinMesh);
          interactiveObs.push(headMesh);
        }
      }

      // 10. KML 3D LineString (Hierarchy: Secondary guide at y = 1.4, radius 1.5)
      var kmlCoords = extractCoords(CONFIG.kmlGeometry);
      if (kmlCoords && kmlCoords.length >= 2) {
        var altCoords = CONFIG.kmlMetadata && CONFIG.kmlMetadata.altitudeCoordinates;
        var hasAlt = CONFIG.kmlMetadata && CONFIG.kmlMetadata.hasAltitude;

        var kmlCurvePts = [];
        for (var kp = 0; kp < kmlCoords.length; kp++) {
          var zAlt = (hasAlt && altCoords && altCoords[kp] && altCoords[kp][2] !== undefined)
            ? altCoords[kp][2]
            : 1.4;
          kmlCurvePts.push(toEnu(kmlCoords[kp][0], kmlCoords[kp][1], zAlt));
        }

        var kmlCurve = kmlCurvePts.length === 2
          ? new THREE.LineCurve3(kmlCurvePts[0], kmlCurvePts[1])
          : new THREE.CatmullRomCurve3(kmlCurvePts, false, 'chordal', 0.2);

        var kmlColorHex = (CONFIG.kmlMetadata && CONFIG.kmlMetadata.styles && CONFIG.kmlMetadata.styles.line && CONFIG.kmlMetadata.styles.line.color)
          ? ('#' + (CONFIG.kmlMetadata.styles.line.color.length === 8 ? CONFIG.kmlMetadata.styles.line.color.slice(6, 8) + CONFIG.kmlMetadata.styles.line.color.slice(4, 6) + CONFIG.kmlMetadata.styles.line.color.slice(2, 4) : 'F97316'))
          : '#F97316';
        var kmlColor = new THREE.Color(kmlColorHex);

        var kmlTubeGeom = new THREE.TubeGeometry(kmlCurve, Math.min(kmlCurvePts.length * 8, 200), 1.5, 8, false);
        var kmlTubeMat = new THREE.MeshStandardMaterial({
          color: kmlColor,
          roughness: 0.3,
          metalness: 0.1,
          emissive: kmlColor,
          emissiveIntensity: 0.30,
          transparent: true,
          opacity: 0.65
        });
        var kmlTubeMesh = new THREE.Mesh(kmlTubeGeom, kmlTubeMat);
        kmlTubeMesh.userData = {
          category: 'kml',
          title: (CONFIG.kmlMetadata && CONFIG.kmlMetadata.name) || 'Tracé KML 3D',
          points_count: kmlCoords.length,
          hasAltitude: hasAlt ? 'Oui (Altitude KML active)' : 'Non (Altitude 2D au sol)',
          altitudeRange: (hasAlt && CONFIG.kmlMetadata && CONFIG.kmlMetadata.altitudeRange)
            ? (CONFIG.kmlMetadata.altitudeRange.min + 'm à ' + CONFIG.kmlMetadata.altitudeRange.max + 'm')
            : '0 m'
        };
        groupKml.add(kmlTubeMesh);
        interactiveKml.push(kmlTubeMesh);
      }

      // 11. KML 3D PhotoOverlays
      if (CONFIG.kmlPhotoOverlays && CONFIG.kmlPhotoOverlays.length > 0) {
        for (var po = 0; po < CONFIG.kmlPhotoOverlays.length; po++) {
          var pOverlay = CONFIG.kmlPhotoOverlays[po];
          if (pOverlay.position && pOverlay.position.length >= 2) {
            var poAlt = (pOverlay.altitude !== undefined && pOverlay.altitude !== null) ? pOverlay.altitude : 15;
            var poPos = toEnu(pOverlay.position[0], pOverlay.position[1], poAlt);

            var camGroup = new THREE.Group();
            camGroup.position.copy(poPos);

            var camBoxGeom = new THREE.BoxGeometry(6, 4, 5);
            var camBoxMat = new THREE.MeshStandardMaterial({ color: 0x06B6D4, emissive: 0x0891B2 });
            var camBox = new THREE.Mesh(camBoxGeom, camBoxMat);
            camGroup.add(camBox);

            var heading = pOverlay.heading || 0;
            var tilt = pOverlay.tilt || 0;
            var fovLength = 25;

            var frustumGeom = new THREE.ConeGeometry(12, fovLength, 4, 1, true);
            var frustumMat = new THREE.MeshBasicMaterial({ color: 0x06B6D4, wireframe: true, transparent: true, opacity: 0.6 });
            var frustumMesh = new THREE.Mesh(frustumGeom, frustumMat);
            frustumMesh.rotation.y = -heading * rad;
            frustumMesh.rotation.x = Math.PI / 2 + (tilt * rad);
            frustumMesh.position.set(0, 0, -fovLength / 2);
            camGroup.add(frustumMesh);

            camGroup.userData = {
              category: 'kml_image',
              overlay: pOverlay,
              title: pOverlay.name || ('PhotoOverlay ' + (po + 1)),
              type: 'PhotoOverlay 3D',
              heading: heading + '°',
              tilt: tilt + '°',
              altitude: poAlt + ' m'
            };
            camBox.userData = camGroup.userData;
            groupKmlImages.add(camGroup);
            interactiveKml.push(camBox);
          }
        }
      }

      // 12. KML 3D GroundOverlays
      var loadedKmlTextures = [];
      if (CONFIG.kmlGroundOverlays && CONFIG.kmlGroundOverlays.length > 0) {
        var textureLoader = new THREE.TextureLoader();
        textureLoader.setCrossOrigin('anonymous');
        for (var go = 0; go < CONFIG.kmlGroundOverlays.length; go++) {
          var gOverlay = CONFIG.kmlGroundOverlays[go];
          if (gOverlay.latLonBox) {
            var b = gOverlay.latLonBox;
            var baseAlt = (gOverlay.altitude !== undefined && gOverlay.altitude !== null && !isNaN(gOverlay.altitude))
              ? Number(gOverlay.altitude)
              : 0.15;
            var sw = toEnu(b.west, b.south, baseAlt);
            var ne = toEnu(b.east, b.north, baseAlt);

            var width = Math.abs(ne.x - sw.x);
            var depth = Math.abs(ne.z - sw.z);
            var centerX = (sw.x + ne.x) / 2;
            var centerZ = (sw.z + ne.z) / 2;

            var goPlaneGeom = new THREE.PlaneGeometry(width, depth);
            var overlayOpacity = (typeof gOverlay.opacity === 'number' && !isNaN(gOverlay.opacity))
              ? gOverlay.opacity
              : 0.85;

            var goPlaneMat = new THREE.MeshBasicMaterial({
              color: 0xF97316,
              transparent: true,
              opacity: overlayOpacity * 0.45,
              side: THREE.DoubleSide
            });
            var goPlane = new THREE.Mesh(goPlaneGeom, goPlaneMat);
            goPlane.rotation.x = -Math.PI / 2;
            if (b.rotation) {
              goPlane.rotateZ(b.rotation * (Math.PI / 180));
            }
            goPlane.position.set(centerX, baseAlt, centerZ);
            goPlane.userData = {
              category: 'kml_image',
              overlay: gOverlay,
              title: gOverlay.name || ('GroundOverlay ' + (go + 1)),
              type: 'GroundOverlay 3D',
              opacity: overlayOpacity,
              bounds: 'N:' + b.north.toFixed(4) + ' S:' + b.south.toFixed(4)
            };

            var imageUrl = (gOverlay.icon && gOverlay.icon.href) ? gOverlay.icon.href : null;
            if (imageUrl && gOverlay.isSafe !== false && gOverlay.isAvailable !== false) {
              (function(plane, meshMat, imgUrl, opacityVal) {
                textureLoader.load(
                  imgUrl,
                  function(texture) {
                    texture.generateMipmaps = true;
                    texture.minFilter = THREE.LinearMipmapLinearFilter;
                    loadedKmlTextures.push(texture);
                    var texturedMat = new THREE.MeshBasicMaterial({
                      map: texture,
                      transparent: true,
                      opacity: opacityVal,
                      side: THREE.DoubleSide,
                      depthWrite: false
                    });
                    plane.material = texturedMat;
                    meshMat.dispose();
                    if (CONFIG.isDev) {
                      console.log('[Three.js Engine] Successfully mapped GroundOverlay texture:', imgUrl);
                    }
                  },
                  undefined,
                  function(err) {
                    console.warn('[Three.js Engine] GroundOverlay texture failed to load, keeping fallback plane:', imgUrl);
                  }
                );
              })(goPlane, goPlaneMat, imageUrl, overlayOpacity);
            }

            groupKmlImages.add(goPlane);
            interactiveKml.push(goPlane);
          }
        }
      }

      window.addEventListener('beforeunload', function() {
        for (var ti = 0; ti < loadedKmlTextures.length; ti++) {
          try { loadedKmlTextures[ti].dispose(); } catch(e) {}
        }
      });

      // Compute Scene Bounding Box & Fit Camera Adaptively
      var sceneBox = new THREE.Box3();
      if (groupRef.children.length > 0) sceneBox.expandByObject(groupRef);
      if (groupTroncons.children.length > 0) sceneBox.expandByObject(groupTroncons);
      if (groupKml.children.length > 0) sceneBox.expandByObject(groupKml);
      if (groupAoi.children.length > 0) sceneBox.expandByObject(groupAoi);

      var sceneCenter = new THREE.Vector3(0, 0, 0);
      var fitDistance = 350;
      if (!sceneBox.isEmpty()) {
        sceneBox.getCenter(sceneCenter);
        var sSize = new THREE.Vector3();
        sceneBox.getSize(sSize);
        var maxDim = Math.max(sSize.x, sSize.z, sSize.y, 60);
        fitDistance = Math.min(Math.max(maxDim * 1.6, 100), 12000);
      }

      var initDistance = fitDistance;
      camera.position.set(sceneCenter.x + initDistance * 0.7, sceneCenter.y + initDistance * 0.65, sceneCenter.z + initDistance * 0.7);
      controls.target.copy(sceneCenter);
      controls.update();

      // Messaging dispatch helpers
      function dispatchSelection(payloadData) {
        var payload = { type: 'SELECT_3D_OBJECT', payload: payloadData };
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        } else if (window.parent) {
          window.parent.postMessage(payload, '*');
        }
      }

      function dispatchClearSelection() {
        var payload = { type: 'CLEAR_3D_SELECTION' };
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        } else if (window.parent) {
          window.parent.postMessage(payload, '*');
        }
      }

      // Tronçon Selection & Highlight Manager
      function setTronconSelected(id, notify) {
        currentSelectedTronconId = (id !== null && id !== undefined) ? String(id) : null;

        var selectedMesh = null;
        for (var i = 0; i < interactiveTroncons.length; i++) {
          var m = interactiveTroncons[i];
          var isMatch = currentSelectedTronconId && String(m.userData.id) === currentSelectedTronconId;
          if (isMatch) {
            m.material.emissiveIntensity = 0.85;
            m.scale.set(1.15, 1.15, 1.15);
            selectedMesh = m;
          } else {
            m.material.emissiveIntensity = 0.35;
            m.scale.set(1.0, 1.0, 1.0);
          }
        }

        if (notify) {
          if (selectedMesh && selectedMesh.userData) {
            dispatchSelection(selectedMesh.userData);
          } else {
            dispatchClearSelection();
          }
        }
      }

      // 13. Raycasting with Strict Priority Ordering
      var raycaster = new THREE.Raycaster();
      var mouse = new THREE.Vector2();

      function onPointerClick(e) {
        var rect = renderer.domElement.getBoundingClientRect();
        var clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
        var clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        // PRIORITY 1: Tronçon Meshes
        if (groupTroncons.visible && interactiveTroncons.length > 0) {
          var trHits = raycaster.intersectObjects(interactiveTroncons, true);
          if (trHits.length > 0) {
            var trHitObj = trHits[0].object;
            if (trHitObj.userData && trHitObj.userData.id) {
              setTronconSelected(trHitObj.userData.id, true);
              return;
            }
          }
        }

        // PRIORITY 2: Observation Markers
        if (groupObs.visible && interactiveObs.length > 0) {
          var obsHits = raycaster.intersectObjects(interactiveObs, true);
          if (obsHits.length > 0) {
            var obsObj = obsHits[0].object;
            if (obsObj.userData && obsObj.userData.title) {
              dispatchSelection(obsObj.userData);
              return;
            }
          }
        }

        // PRIORITY 3: KML Elements
        if ((groupKml.visible || groupKmlImages.visible) && interactiveKml.length > 0) {
          var kmlHits = raycaster.intersectObjects(interactiveKml, true);
          if (kmlHits.length > 0) {
            var kmlObj = kmlHits[0].object;
            if (kmlObj.userData && kmlObj.userData.title) {
              dispatchSelection(kmlObj.userData);
              return;
            }
          }
        }

        // PRIORITY 4: Reference Alignment
        if (groupRef.visible && interactiveRef.length > 0) {
          var refHits = raycaster.intersectObjects(interactiveRef, true);
          if (refHits.length > 0) {
            var refObj = refHits[0].object;
            if (refObj.userData && refObj.userData.title) {
              dispatchSelection(refObj.userData);
              return;
            }
          }
        }

        // PRIORITY 5: Empty space clicked -> Deselect
        setTronconSelected(null, true);
      }
      renderer.domElement.addEventListener('click', onPointerClick);

      // 14. Camera Control Buttons & Aperçu Collapse Toggle
      var apercuCard = document.getElementById('hud-apercu-card');
      var apercuHeader = document.getElementById('hud-apercu-header');
      if (apercuHeader && apercuCard) {
        apercuHeader.onclick = function(e) {
          e.stopPropagation();
          apercuCard.classList.toggle('collapsed');
        };
      }

      document.getElementById('btn-reset').onclick = function() {
        camera.position.set(sceneCenter.x + initDistance * 0.7, sceneCenter.y + initDistance * 0.65, sceneCenter.z + initDistance * 0.7);
        controls.target.copy(sceneCenter);
        controls.update();
      };
      document.getElementById('btn-center').onclick = function() {
        controls.target.copy(sceneCenter);
        controls.update();
      };
      document.getElementById('btn-top').onclick = function() {
        camera.position.set(sceneCenter.x, sceneCenter.y + initDistance * 1.3, sceneCenter.z + 0.001);
        controls.target.copy(sceneCenter);
        controls.update();
      };
      document.getElementById('btn-iso').onclick = function() {
        camera.position.set(sceneCenter.x + initDistance * 0.8, sceneCenter.y + initDistance * 0.5, sceneCenter.z + initDistance * 0.8);
        controls.target.copy(sceneCenter);
        controls.update();
      };

      // 15. Incoming Layer Visibility Controller Bridge
      function handleIncomingLayerMessage(event) {
        var data = event.data;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(e) { return; }
        }
        if (!data || typeof data !== 'object') return;
        if (data.type === 'SET_LAYER_VISIBILITY') {
          var layer = data.layer;
          var visible = !!data.visible;
          if (layer === 'aoi' && groupAoi) groupAoi.visible = visible;
          if (layer === 'ref' && groupRef) groupRef.visible = visible;
          if (layer === 'troncons' && groupTroncons) {
            groupTroncons.visible = visible;
            if (!visible && pkBadges) {
              for (var p = 0; p < pkBadges.length; p++) pkBadges[p].el.style.display = 'none';
            }
          }
          if (layer === 'obs' && groupObs) groupObs.visible = visible;
          if (layer === 'kml' && groupKml) groupKml.visible = visible;
          if (layer === 'kmlImages' && groupKmlImages) groupKmlImages.visible = visible;
        }
      }
      window.addEventListener('message', handleIncomingLayerMessage);
      document.addEventListener('message', handleIncomingLayerMessage);

      // Hide loading screen
      setTimeout(function() {
        loadingOverlay.style.opacity = '0';
        setTimeout(function() { loadingOverlay.style.display = 'none'; }, 400);
      }, 300);

      // 16. Animation Loop (with dynamic PK Badges update)
      var firstRenderDone = false;
      function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);

        // Update PK Badges position & visibility
        if (pkBadges.length > 0) {
          var camPos = camera.position;
          for (var bIdx = 0; bIdx < pkBadges.length; bIdx++) {
            var badgeItem = pkBadges[bIdx];
            var isAttachedToSelected = currentSelectedTronconId && badgeItem.tronconIds.indexOf(currentSelectedTronconId) !== -1;
            var distToCam = camPos.distanceTo(badgeItem.pos);

            // Show badge if camera is sufficiently close (dist < 850m) or if an adjacent tronçon is selected
            if (groupTroncons.visible && (distToCam < 850 || isAttachedToSelected)) {
              var projected = badgeItem.pos.clone().project(camera);
              if (projected.z > -1 && projected.z < 1) {
                var scrX = (projected.x * 0.5 + 0.5) * window.innerWidth;
                var scrY = (-(projected.y * 0.5) + 0.5) * window.innerHeight;
                badgeItem.el.style.left = scrX + 'px';
                badgeItem.el.style.top = (scrY - 14) + 'px';
                badgeItem.el.style.display = 'block';
                if (isAttachedToSelected) {
                  badgeItem.el.classList.add('highlight');
                } else {
                  badgeItem.el.classList.remove('highlight');
                }
              } else {
                badgeItem.el.style.display = 'none';
              }
            } else {
              badgeItem.el.style.display = 'none';
            }
          }
        }

        if (!firstRenderDone) {
          firstRenderDone = true;
          if (CONFIG.isDev) {
            console.log('[Three.js Engine] first render completed successfully');
          }
        }
      }
      animate();

      // Responsive Resize
      window.addEventListener('resize', function() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      });

      // Level 6B: Temporal indicator badge
      (function() {
        var badge = document.getElementById('temporal-badge-3d');
        var dateEl = document.getElementById('t3d-date');
        var pctEl = document.getElementById('t3d-pct');
        if (!badge) return;
        if (CONFIG.temporalMode === 'historical' && CONFIG.temporalDate) {
          if (dateEl) dateEl.textContent = CONFIG.temporalDate;
          if (pctEl) pctEl.textContent = (CONFIG.temporalProgress >= 0) ? Math.round(CONFIG.temporalProgress) + '% av.' : '';
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      })();

    })();
  </script>
</body>
</html>`;
  }, [
    referenceGeometry,
    chantierAlignments,
    selectedChantierId,
    troncons,
    selectedTronconId,
    aoiGeometry,
    existingAois,
    kmlGeometry,
    kmlMetadata,
    kmlGroundOverlays,
    kmlPhotoOverlays,
    showKmlLayer,
    showKmlImages,
    customMarkers,
    selectedMarkerId,
    center,
    temporalState,
  ]);

  return (
    <View style={[styles.container, { height }, style]} collapsable={false}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          srcDoc={threeHtml}
          style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#070D1E' }}
        />
      ) : (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: threeHtml }}
          style={styles.webView}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#10B981" />
              <Text style={styles.loadingText}>Chargement de la scène 3D...</Text>
            </View>
          )}
        />
      )}

      {/* Outside Tap Dismiss Backdrop */}
      {is3DLayersPanelOpen && (
        <TouchableWithoutFeedback onPress={() => setIs3DLayersPanelOpen(false)}>
          <View style={styles.backdropOverlay} />
        </TouchableWithoutFeedback>
      )}

      {/* Floating 3D Couches Button with Compact Styling */}
      <TouchableOpacity
        style={[
          styles.floatingLayersBtn,
          { top: buttonTop },
          is3DLayersPanelOpen && styles.floatingLayersBtnActive,
        ]}
        onPress={() => setIs3DLayersPanelOpen((prev) => !prev)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Afficher et configurer les couches 3D"
      >
        <Ionicons name="options" size={15} color="#10B981" />
        <Text style={styles.floatingLayersBtnText}>COUCHES 3D</Text>
      </TouchableOpacity>

      {/* Collapsible 3D Layer Checkbox Panel */}
      {is3DLayersPanelOpen && (
        <View style={[styles.layersPanel, { top: buttonTop + 42 }]}>
          <View style={styles.layersHeader}>
            <Text style={styles.layersTitle}>COUCHES 3D</Text>
            <TouchableOpacity
              onPress={() => setIs3DLayersPanelOpen(false)}
              style={styles.layersCloseBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.layersDivider} />

          <View style={styles.layersList}>
            {/* 1. Zone d'Intérêt (AOI) */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('aoi')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>🔲</Text>
                <Text style={styles.layerLabelText}>Zone d'Intérêt (AOI)</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.aoi && styles.checkboxBoxChecked]}>
                {layerVisibility.aoi && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>

            {/* 2. Référentiel Linéaire */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('ref')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>🛣️</Text>
                <Text style={styles.layerLabelText}>Référentiel Linéaire</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.ref && styles.checkboxBoxChecked]}>
                {layerVisibility.ref && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>

            {/* 3. Tronçons Découpés */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('troncons')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>📍</Text>
                <Text style={styles.layerLabelText}>Tronçons Découpés</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.troncons && styles.checkboxBoxChecked]}>
                {layerVisibility.troncons && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>

            {/* 4. Observations Terrain */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('obs')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>📸</Text>
                <Text style={styles.layerLabelText}>Observations Terrain</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.obs && styles.checkboxBoxChecked]}>
                {layerVisibility.obs && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>

            {/* 5. Tracé KML 3D */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('kml')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>🗺️</Text>
                <Text style={styles.layerLabelText}>Tracé KML 3D</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.kml && styles.checkboxBoxChecked]}>
                {layerVisibility.kml && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>

            {/* 6. Images KML 3D */}
            <TouchableOpacity
              style={styles.layerItem}
              onPress={() => toggleLayer('kmlImages')}
              activeOpacity={0.7}
            >
              <View style={styles.layerLabelRow}>
                <Text style={styles.layerEmoji}>🖼️</Text>
                <Text style={styles.layerLabelText}>Images KML 3D</Text>
              </View>
              <View style={[styles.checkboxBox, layerVisibility.kmlImages && styles.checkboxBoxChecked]}>
                {layerVisibility.kmlImages && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Selected Object Inspection HUD Card */}
      {selectedHudInfo && (
        <View style={styles.hudCard}>
          <View style={styles.hudCardHeader}>
            <View style={styles.hudBadge}>
              <Text style={styles.hudBadgeText}>{selectedHudInfo.category?.toUpperCase() || 'INFO'}</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedHudInfo(null)} style={styles.hudCloseBtn}>
              <Ionicons name="close" size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>
          <Text style={styles.hudTitle}>{selectedHudInfo.title}</Text>
          {selectedHudInfo.pk_debut !== undefined && (
            <Text style={styles.hudDetail}>
              {formatPkDisplay(selectedHudInfo.pk_debut)} ➔ {formatPkDisplay(selectedHudInfo.pk_fin)} {selectedHudInfo.length_km ? `(${selectedHudInfo.length_km})` : ''}
            </Text>
          )}
          {selectedHudInfo.progress !== undefined && (
            <Text style={styles.hudDetail}>Progression : {selectedHudInfo.progress}</Text>
          )}
          {selectedHudInfo.observations_count !== undefined && (
            <Text style={styles.hudDetail}>Observations : {selectedHudInfo.observations_count}</Text>
          )}
          {selectedHudInfo.status !== undefined && (
            <Text style={styles.hudDetail}>Statut : {selectedHudInfo.status}</Text>
          )}
          {selectedHudInfo.hasAltitude !== undefined && (
            <Text style={styles.hudDetail}>Élévation : {selectedHudInfo.hasAltitude}</Text>
          )}
          {selectedHudInfo.altitudeRange !== undefined && (
            <Text style={styles.hudDetail}>Plage Z : {selectedHudInfo.altitudeRange}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    flex: 1,
    backgroundColor: '#070D1E',
    position: 'relative',
    zIndex: 1,
  },
  webView: {
    flex: 1,
    backgroundColor: '#070D1E',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#070D1E',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#94A3B8',
    fontWeight: '600',
  },
  backdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 998,
  },
  floatingLayersBtn: {
    position: 'absolute',
    right: 12,
    height: 34,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderWidth: 1.5,
    borderColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 25,
    zIndex: 999,
  },
  floatingLayersBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#34D399',
    shadowOpacity: 0.8,
  },
  floatingLayersBtnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  layersPanel: {
    position: 'absolute',
    right: 12,
    width: 235,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#10B981',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.65,
    shadowRadius: 18,
    elevation: 40,
    zIndex: 1000,
  },
  layersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  layersTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  layersCloseBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  layersDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginVertical: 8,
  },
  layersList: {
    gap: 8,
  },
  layerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  layerLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  layerEmoji: {
    fontSize: 13,
  },
  layerLabelText: {
    fontSize: 12,
    color: '#F8FAFC',
    fontWeight: '600',
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(148, 163, 184, 0.6)',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxBoxChecked: {
    borderColor: '#10B981',
    backgroundColor: '#10B981',
  },
  hudCard: {
    position: 'absolute',
    bottom: 24,
    left: '50%',
    transform: [{ translateX: -140 }],
    width: 280,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 110,
  },
  hudCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  hudBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  hudBadgeText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  hudCloseBtn: {
    padding: 2,
  },
  hudTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  hudDetail: {
    fontSize: 12,
    color: '#CBD5E1',
    marginTop: 2,
  },
});
