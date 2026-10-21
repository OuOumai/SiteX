import { isKmlSource } from '@/lib/kmlPanorama';
import { KmlImageModal } from '@/components/gis/KmlImageModal';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  TextInput,
  Platform,
  Modal,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  api,
  ChantierDetails,
  ReferenceAlignment,
  TronconItem,
  GenerateTronconsResponse,
  GeoJSONAnalysisResponse,
  GeoJSONCandidateCorridor,
  SupportedCrs,
  CrsDetectionResponse,
  AoiConflictItem,
  SiblingChantierAoiItem,
  KmlMetadata,
  KmlGroundOverlay,
  KmlPhotoOverlay,
  getMediaUrl,
} from '@/services/api';
import { InteractiveGisMap, InteractiveGisMapRef, GisTronconSegment, GisCandidateCorridor } from '@/components/gis/InteractiveGisMap';
import { InteractiveGis3DMap } from '@/components/gis/InteractiveGis3DMap';

// Sample infrastructure GeoJSON geometry for quick testing
const SAMPLE_INFRASTRUCTURE_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Tracé Linéaire Principal (Section Exemple)',
        type: 'Infrastructure',
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [-6.5823, 34.2612],
          [-6.6145, 34.2134],
          [-6.6489, 34.1689],
          [-6.6892, 34.1245],
          [-6.7345, 34.0812],
          [-6.7790, 34.0456],
          [-6.8123, 34.0189],
          [-6.8498, 33.9716],
        ],
      },
    },
  ],
};

const SAMPLE_AOI_COORDINATES: [number, number][] = [
  [-6.88, 33.95],
  [-6.55, 34.30],
  [-6.50, 34.28],
  [-6.85, 33.92],
  [-6.88, 33.95],
];

function formatPK(val?: number | null, isReversed = false): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}${isReversed ? ' (Inv)' : ''}`;
}

export default function GisSetupScreen() {
  const { chantierId, current, total, projectId } = useLocalSearchParams<{
    chantierId: string;
    current?: string;
    total?: string;
    projectId?: string;
  }>();
  const router = useRouter();
  const { token } = useAuth();
  const [screenScrollEnabled, setScreenScrollEnabled] = useState(true);

  const currentNum = current ? parseInt(current, 10) : 1;
  const totalNum = total ? parseInt(total, 10) : 1;
  const isMultiFlow = Boolean(total && totalNum >= 1);

  const handleMapInteractionChange = useCallback((interacting: boolean) => {
    setScreenScrollEnabled(!interacting);
  }, []);

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoadingChantier, setIsLoadingChantier] = useState(true);

  // Step 1: GeoJSON Source & Automatic CRS Detection
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [geojsonData, setGeojsonData] = useState<any>(null);
  const [crsDetection, setCrsDetection] = useState<CrsDetectionResponse | null>(null);
  const [isDetectingCrs, setIsDetectingCrs] = useState<boolean>(false);
  const [selectedCrsSrid, setSelectedCrsSrid] = useState<number | null>(null);
  const [showCrsModal, setShowCrsModal] = useState<boolean>(false);
  const [supportedCrsList, setSupportedCrsList] = useState<SupportedCrs[]>([]);
  const [crsSearchQuery, setCrsSearchQuery] = useState<string>('');

  // Step 2: Zone d'Étude (AOI) Definition & Geoapify Address/City Autocomplete
  const [searchAddress, setSearchAddress] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<{ lat: number; lon: number; label: string } | null>({
    lat: 34.26,
    lon: -6.58,
    label: 'Kénitra, Maroc',
  });
  const [mapCenter, setMapCenter] = useState<[number, number]>([34.26, -6.58]);
  const [mapZoom, setMapZoom] = useState<number>(11);
  const [aoiMode, setAoiMode] = useState<'draw' | 'coords'>('draw');
  const [aoiCoordinates, setAoiCoordinates] = useState<[number, number][]>([]);
  const [aoiPointCount, setAoiPointCount] = useState<number>(0);
  const [manualCoordsText, setManualCoordsText] = useState<string>('');
  const [coordEntryType, setCoordEntryType] = useState<'bbox' | 'vertices'>('bbox');
  const [bboxMinLon, setBboxMinLon] = useState<string>('');
  const [bboxMinLat, setBboxMinLat] = useState<string>('');
  const [bboxMaxLon, setBboxMaxLon] = useState<string>('');
  const [bboxMaxLat, setBboxMaxLat] = useState<string>('');
  const [isSavingAoi, setIsSavingAoi] = useState(false);
  const [savedAoiGeometry, setSavedAoiGeometry] = useState<any>(null);
  const [savedAoiSurface, setSavedAoiSurface] = useState<number | null>(null);
  const [siblingAois, setSiblingAois] = useState<SiblingChantierAoiItem[]>([]);
  const [conflictData, setConflictData] = useState<AoiConflictItem[]>([]);
  const [showConflictModal, setShowConflictModal] = useState<boolean>(false);
  const mapRef = useRef<InteractiveGisMapRef>(null);

  // Step 2 & 3: AOI Refinement State
  const [isAoiRefineMode, setIsAoiRefineMode] = useState<boolean>(false);
  const [aoiBackup, setAoiBackup] = useState<{
    coordinates: [number, number][];
    pointCount: number;
    manualCoordsText: string;
    bboxMinLon: string;
    bboxMinLat: string;
    bboxMaxLon: string;
    bboxMaxLat: string;
    analysisResult: GeoJSONAnalysisResponse | null;
    selectedCorridor: GeoJSONCandidateCorridor | null;
  } | null>(null);

  const drawingVerticesCount = useMemo(() => {
    if (aoiPointCount > 0) return aoiPointCount;
    if (!aoiCoordinates || aoiCoordinates.length === 0) return 0;
    const isClosed = aoiCoordinates.length >= 4 &&
      aoiCoordinates[0][0] === aoiCoordinates[aoiCoordinates.length - 1][0] &&
      aoiCoordinates[0][1] === aoiCoordinates[aoiCoordinates.length - 1][1];
    return isClosed ? aoiCoordinates.length - 1 : aoiCoordinates.length;
  }, [aoiCoordinates, aoiPointCount]);

  // Step 3: Spatial Analysis & Candidate Corridors
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<GeoJSONAnalysisResponse | null>(null);
  const [selectedCorridor, setSelectedCorridor] = useState<GeoJSONCandidateCorridor | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [kmlMetadata, setKmlMetadata] = useState<KmlMetadata | null>(null);
  const [kmlSourceGeometry, setKmlSourceGeometry] = useState<any>(null);
  const [isKmlLayerVisible, setIsKmlLayerVisible] = useState<boolean>(true);
  const [selectedKmlMetadata, setSelectedKmlMetadata] = useState<KmlMetadata | null>(null);
  const [showKmlInfoModal, setShowKmlInfoModal] = useState<boolean>(false);
  const [isKmlImagesVisible, setIsKmlImagesVisible] = useState<boolean>(true);
  const [selectedKmlImage, setSelectedKmlImage] = useState<KmlGroundOverlay | KmlPhotoOverlay | null>(null);
  const [showKmlImageModal, setShowKmlImageModal] = useState<boolean>(false);
  const [gisViewMode, setGisViewMode] = useState<'2d' | '3d'>('2d');
  const [selectedTronconId, setSelectedTronconId] = useState<number | string | null>(null);

  // Step 3 Corridor Pagination & Lazy Loading States
  const [corridorDisplayLimit, setCorridorDisplayLimit] = useState<number>(5);
  const [corridorSearch, setCorridorSearch] = useState<string>('');
  const [corridorFilter, setCorridorFilter] = useState<'all' | 'aoi'>('all');
  const [corridorPage, setCorridorPage] = useState<number>(1);
  const [corridorViewMode, setCorridorViewMode] = useState<'progressive' | 'pages'>('progressive');

  // Step 4: Direction Inversion & Reference Alignment
  const [referenceAlignment, setReferenceAlignment] = useState<ReferenceAlignment | null>(null);
  const [isReversed, setIsReversed] = useState<boolean>(false);
  const [isTogglingDirection, setIsTogglingDirection] = useState(false);

  // Step 5: Segmentation mode (count or length)
  const [segMode, setSegMode] = useState<'count' | 'length'>('count');
  const [tronconCount, setTronconCount] = useState<number>(4);
  const [targetLengthKm, setTargetLengthKm] = useState<string>('2.5');

  // Step 6: Generated tronçons preview & Modifier
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<GenerateTronconsResponse | null>(null);
  const [editableTroncons, setEditableTroncons] = useState<TronconItem[]>([]);
  const [isEditingCut, setIsEditingCut] = useState(false);
  const [isRecalculatingSpatial, setIsRecalculatingSpatial] = useState(false);
  const recalcTimeoutRef = useRef<any>(null);

  // Step 7: Saving
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [companionAssets, setCompanionAssets] = useState<Array<{ name: string; data?: string; url?: string }>>([]);

  // Load existing chantier and any existing GIS alignment/troncons
  const loadChantierData = useCallback(async () => {
    if (!token || !chantierId) return;
    try {
      const res = await api.getChantierDetails(token, chantierId);
      setChantier(res.chantier);

      if (res.chantier.localisation) {
        setSavedAoiGeometry(res.chantier.localisation);
        if (res.chantier.surface) {
          setSavedAoiSurface(res.chantier.surface);
        }
        if (res.chantier.localisation.coordinates && res.chantier.localisation.coordinates[0]) {
          const coords = res.chantier.localisation.coordinates[0];
          setAoiCoordinates(coords);
          const isClosed = coords.length >= 4 &&
            coords[0][0] === coords[coords.length - 1][0] &&
            coords[0][1] === coords[coords.length - 1][1];
          setAoiPointCount(isClosed ? coords.length - 1 : coords.length);
          setManualCoordsText(coords.map((c: any) => `${c[0]}, ${c[1]}`).join('\n'));
        }
      }

      // Load sibling chantiers' AOIs in the same project for visual reference and awareness
      try {
        const siblingRes = await api.getSiblingChantierAois(token, chantierId);
        if (siblingRes && siblingRes.chantiers) {
          setSiblingAois(siblingRes.chantiers);
        }
      } catch (sibErr) {
        console.warn('Could not load sibling AOIs:', sibErr);
      }

      // Check if reference alignment already exists
      try {
        const refRes = await api.getReferenceAlignment(token, chantierId);
        if (refRes.reference_alignment) {
          setReferenceAlignment(refRes.reference_alignment);
          setIsReversed(!!refRes.reference_alignment.direction_reversed);
          setSelectedFileName(refRes.reference_alignment.original_filename || 'Tracé existant');

          // Restore KML contextual metadata and geometry if stored
          if (refRes.reference_alignment.kml_metadata) {
            setKmlMetadata(refRes.reference_alignment.kml_metadata);
            const kmlGeom = refRes.reference_alignment.original_geometry || refRes.reference_alignment.geometry;
            if (kmlGeom) {
              setKmlSourceGeometry(kmlGeom);
              setIsKmlLayerVisible(true);
            }
          }

          // Check if troncons already exist
          const tronconsRes = await api.getChantierTroncons(token, chantierId);
          if (tronconsRes.troncons && tronconsRes.troncons.length > 0) {
            setEditableTroncons(tronconsRes.troncons);
            setTronconCount(tronconsRes.troncons.length);
            setCurrentStep(6);
          } else {
            setCurrentStep(4);
          }
        }
      } catch {
        // No alignment yet, stay on Step 1
      }
    } catch (err: any) {
      console.error('Erreur chargement chantier:', err.message);
    } finally {
      setIsLoadingChantier(false);
    }
  }, [token, chantierId]);

  useEffect(() => {
    loadChantierData();
  }, [loadChantierData]);

  // Automatic CRS Detection
  // Automatic CRS Detection
  const runCrsDetection = async (
    data: any,
    fileName?: string,
    explicitSrid?: number,
    kmlText?: string,
    assetsToPass?: Array<{ name: string; data?: string; url?: string }>
  ) => {
    if (!token || !chantierId || (!data && !kmlText)) return;
    setIsDetectingCrs(true);
    try {
      const activeAssets = assetsToPass !== undefined ? assetsToPass : companionAssets;
      const res = await api.detectCrs(token, chantierId, {
        geojson: data,
        kmlText: kmlText,
        fileName: fileName || selectedFileName || (kmlText ? 'source.kml' : 'source.geojson'),
        source_srid: explicitSrid,
        assets: activeAssets.length > 0 ? activeAssets : undefined,
      });
      setCrsDetection(res);
      setSelectedCrsSrid(res.detected_srid);
      if (res.supported_crs && res.supported_crs.length > 0) {
        setSupportedCrsList(res.supported_crs);
      }
      if (res.kml_metadata) {
        setKmlMetadata(res.kml_metadata);
        const kmlGeom = res.normalized_geojson?.geometry || (res.normalized_geojson?.type === 'LineString' ? res.normalized_geojson : null);
        setKmlSourceGeometry(kmlGeom);
        setIsKmlLayerVisible(true);
      } else {
        setKmlMetadata(null);
        setKmlSourceGeometry(null);
      }
      if (res.normalized_geojson) {
        setGeojsonData(res.normalized_geojson);
        const centerCoord = extractCenterFromGeoJson(res.normalized_geojson);
        if (centerCoord) {
          setMapCenter(centerCoord);
          setMapZoom(12);
          setSelectedLocation(null);
        }
      }
    } catch (err: any) {
      console.warn('CRS detection warning:', err.message);
      Alert.alert('Erreur d\'analyse spatiale', err.message || 'Échec de lecture du fichier spatial.');
    } finally {
      setIsDetectingCrs(false);
    }
  };

function extractBboxFromGeoJson(geojson: any): [number, number, number, number] | null {
  if (!geojson) return null;
  try {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    let found = false;

    const processCoords = (coordinates: any) => {
      if (!Array.isArray(coordinates)) return;
      if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
        const [lon, lat] = coordinates;
        if (!isNaN(lon) && !isNaN(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          found = true;
        }
      } else {
        for (const c of coordinates) processCoords(c);
      }
    };

    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
      for (const feat of geojson.features) {
        if (feat.geometry?.coordinates) processCoords(feat.geometry.coordinates);
      }
    } else if (geojson.type === 'Feature' && geojson.geometry?.coordinates) {
      processCoords(geojson.geometry.coordinates);
    } else if (geojson.coordinates) {
      processCoords(geojson.coordinates);
    }

    if (found && isFinite(minLon) && isFinite(maxLon) && isFinite(minLat) && isFinite(maxLat)) {
      return [minLon, minLat, maxLon, maxLat];
    }
  } catch (e) {}
  return null;
}

function extractCenterFromGeoJson(geojson: any): [number, number] | null {
  if (!geojson) return null;
  try {
    const bbox = extractBboxFromGeoJson(geojson);
    if (bbox) {
      const [minLon, minLat, maxLon, maxLat] = bbox;
      return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
    }
  } catch (e) {}
  return null;
}

  // Unified File selection via expo-document-picker (Mobile & Web)
  const handlePickGeoJSONFile = async () => {
    try {
      if (Platform.OS === 'web' && fileInputRef.current) {
        fileInputRef.current.click();
        return;
      }

      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/geo+json',
          'application/json',
          'application/vnd.google-earth.kml+xml',
          'application/xml',
          'text/xml',
          'image/*',
          '*/*',
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      // Distinguish primary spatial file and companion images
      const isImg = (name?: string, mime?: string) => {
        const n = (name || '').toLowerCase();
        return (
          n.endsWith('.png') ||
          n.endsWith('.jpg') ||
          n.endsWith('.jpeg') ||
          n.endsWith('.webp') ||
          n.endsWith('.tif') ||
          n.endsWith('.tiff') ||
          n.endsWith('.bmp') ||
          mime?.startsWith('image/')
        );
      };

      const imageAssets = result.assets.filter((a) => isImg(a.name, a.mimeType));
      const spatialAsset = result.assets.find((a) => !isImg(a.name, a.mimeType)) || result.assets[0];
      const fileName = spatialAsset.name || 'document.geojson';

      // Load companion assets into memory
      const loadedAssets: Array<{ name: string; data: string }> = [];
      for (const img of imageAssets) {
        try {
          let base64Data = '';
          if (Platform.OS === 'web') {
            const webFile = img.file;
            if (webFile) {
              base64Data = await new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = (ev) => res(ev.target?.result as string);
                r.onerror = rej;
                r.readAsDataURL(webFile);
              });
            } else if (img.uri) {
              const res = await fetch(img.uri);
              const blob = await res.blob();
              base64Data = await new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = (ev) => res(ev.target?.result as string);
                r.onerror = rej;
                r.readAsDataURL(blob);
              });
            }
          } else {
            const b64 = await FileSystem.readAsStringAsync(img.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            const mime = img.mimeType || 'image/png';
            base64Data = `data:${mime};base64,${b64}`;
          }
          if (base64Data) {
            loadedAssets.push({ name: img.name || 'image.png', data: base64Data });
          }
        } catch (imgErr) {
          console.warn('Erreur chargement asset compagnon:', img.name, imgErr);
        }
      }
      setCompanionAssets(loadedAssets);

      let content = '';
      if (Platform.OS === 'web') {
        if (spatialAsset.file) {
          content = await spatialAsset.file.text();
        } else {
          const res = await fetch(spatialAsset.uri);
          content = await res.text();
        }
      } else {
        content = await FileSystem.readAsStringAsync(spatialAsset.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const isKmlFile = fileName.toLowerCase().endsWith('.kml') || content.trim().startsWith('<') || content.includes('<kml');

      if (isKmlFile) {
        setSelectedFileName(fileName);
        setAnalysisResult(null);
        await runCrsDetection(null, fileName, undefined, content, loadedAssets);
      } else {
        const parsed = JSON.parse(content);
        setSelectedFileName(fileName);
        setGeojsonData(parsed);
        setAnalysisResult(null);

        const centerCoord = extractCenterFromGeoJson(parsed);
        if (centerCoord) {
          setMapCenter(centerCoord);
          setMapZoom(12);
          setSelectedLocation(null);
        }

        runCrsDetection(parsed, fileName, undefined, undefined, loadedAssets);
      }
    } catch (err: any) {
      if (err?.message?.includes('User cancelled') || err?.code === 'DOCUMENT_PICKER_CANCELED') {
        return;
      }
      console.error('Erreur lors du choix du fichier:', err);
      Alert.alert(
        'Fichier invalide',
        err.message || "Le fichier sélectionné n'est pas un fichier spatial (GeoJSON/KML) valide ou n'a pas pu être lu."
      );
    }
  };

  // Web input change handler
  const handleFileSelect = (event: any) => {
    if (Platform.OS === 'web') {
      const fileList: FileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      const isImg = (f: File) => {
        const n = f.name.toLowerCase();
        return (
          n.endsWith('.png') ||
          n.endsWith('.jpg') ||
          n.endsWith('.jpeg') ||
          n.endsWith('.webp') ||
          n.endsWith('.tif') ||
          n.endsWith('.tiff') ||
          n.endsWith('.bmp') ||
          f.type.startsWith('image/')
        );
      };

      const imageFiles = files.filter(isImg);
      const spatialFile = files.find((f) => !isImg(f)) || files[0];

      // Read companion images as base64
      Promise.all(
        imageFiles.map(async (img) => {
          try {
            const b64 = await new Promise<string>((res, rej) => {
              const r = new FileReader();
              r.onload = (e) => res(e.target?.result as string);
              r.onerror = rej;
              r.readAsDataURL(img);
            });
            return { name: img.name, data: b64 };
          } catch {
            return null;
          }
        })
      ).then((loaded) => {
        const validLoaded = loaded.filter(Boolean) as Array<{ name: string; data: string }>;
        setCompanionAssets(validLoaded);

        setSelectedFileName(spatialFile.name);
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const content = e.target?.result as string;
            const isKmlFile = spatialFile.name.toLowerCase().endsWith('.kml') || content.trim().startsWith('<') || content.includes('<kml');

            if (isKmlFile) {
              setAnalysisResult(null);
              await runCrsDetection(null, spatialFile.name, undefined, content, validLoaded);
            } else {
              const parsed = JSON.parse(content);
              setGeojsonData(parsed);
              setAnalysisResult(null);

              const centerCoord = extractCenterFromGeoJson(parsed);
              if (centerCoord) {
                setMapCenter(centerCoord);
                setMapZoom(12);
                setSelectedLocation(null);
              }

              runCrsDetection(parsed, spatialFile.name, undefined, undefined, validLoaded);
            }
          } catch (err: any) {
            Alert.alert('Fichier invalide', err.message || "Le fichier sélectionné n'est pas un fichier spatial (GeoJSON/KML) valide.");
          }
        };
        reader.readAsText(spatialFile);
      });

      // Reset input value so selecting the same file again triggers change
      event.target.value = '';
    }
  };

  const handleUseSampleGeoJSON = () => {
    setSelectedFileName('infrastructure_trace.geojson');
    setCompanionAssets([]);
    setGeojsonData(SAMPLE_INFRASTRUCTURE_GEOJSON);
    setAnalysisResult(null);
    setKmlMetadata(null);
    setKmlSourceGeometry(null);

    const centerCoord = extractCenterFromGeoJson(SAMPLE_INFRASTRUCTURE_GEOJSON);
    if (centerCoord) {
      setMapCenter(centerCoord);
      setMapZoom(12);
      setSelectedLocation(null);
    }

    runCrsDetection(SAMPLE_INFRASTRUCTURE_GEOJSON, 'infrastructure_trace.geojson');
  };

  const handleUseSampleAOI = () => {
    setAoiCoordinates(SAMPLE_AOI_COORDINATES);
    setAoiPointCount(4);
    setManualCoordsText(SAMPLE_AOI_COORDINATES.map((c) => `${c[0]}, ${c[1]}`).join('\n'));
  };

  const handleSelectGeoapifyAddress = (details: {
    adresse: string;
    ville: string;
    latitude?: number | null;
    longitude?: number | null;
  }) => {
    const label = details.adresse || details.ville || 'Localisation sélectionnée';
    setSearchAddress(label);

    if (typeof details.latitude === 'number' && typeof details.longitude === 'number') {
      setSelectedLocation({
        lat: details.latitude,
        lon: details.longitude,
        label,
      });
      setMapCenter([details.latitude, details.longitude]);
      setMapZoom(13);
    }
  };

  // STEP 2: Handle AOI Coordinates from Map drawing or text input
  const handleAoiMapDrawn = (coords: [number, number][], pointCount?: number) => {
    setAoiCoordinates(coords);
    if (typeof pointCount === 'number') {
      setAoiPointCount(pointCount);
    } else {
      const isClosed = coords.length >= 4 &&
        coords[0][0] === coords[coords.length - 1][0] &&
        coords[0][1] === coords[coords.length - 1][1];
      setAoiPointCount(isClosed ? coords.length - 1 : coords.length);
    }
    setManualCoordsText(coords.map((c) => `${c[0]}, ${c[1]}`).join('\n'));
  };

  const handleParseManualCoords = (text: string) => {
    setManualCoordsText(text);
    const lines = text.trim().split('\n');
    const parsed: [number, number][] = [];
    for (const line of lines) {
      const parts = line.split(/[,;\s]+/).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
      if (parts.length >= 2) {
        parsed.push([parts[0], parts[1]]);
      }
    }
    setAoiPointCount(parsed.length);
    if (parsed.length >= 4) {
      const first = parsed[0];
      const last = parsed[parsed.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        parsed.push([first[0], first[1]]);
      }
      setAoiCoordinates(parsed);
    } else {
      setAoiCoordinates(parsed);
    }
  };

  const handleApplyBboxAoi = () => {
    const minLon = parseFloat(bboxMinLon.trim().replace(',', '.'));
    const minLat = parseFloat(bboxMinLat.trim().replace(',', '.'));
    const maxLon = parseFloat(bboxMaxLon.trim().replace(',', '.'));
    const maxLat = parseFloat(bboxMaxLat.trim().replace(',', '.'));

    if (isNaN(minLon) || isNaN(minLat) || isNaN(maxLon) || isNaN(maxLat)) {
      Alert.alert('Coordonnées invalides', 'Veuillez saisir des nombres décimaux valides pour les 4 coordonnées (WGS 84 / EPSG:4326).');
      return;
    }

    const realMinLon = Math.min(minLon, maxLon);
    const realMaxLon = Math.max(minLon, maxLon);
    const realMinLat = Math.min(minLat, maxLat);
    const realMaxLat = Math.max(minLat, maxLat);

    if (realMinLon === realMaxLon || realMinLat === realMaxLat) {
      Alert.alert('Coordonnées invalides', 'La longitude et la latitude doivent délimiter une surface non nulle.');
      return;
    }

    // 5-point closed rectangular polygon in GeoJSON [lon, lat] format: SW -> SE -> NE -> NW -> SW
    const rectCoords: [number, number][] = [
      [realMinLon, realMinLat],
      [realMaxLon, realMinLat],
      [realMaxLon, realMaxLat],
      [realMinLon, realMaxLat],
      [realMinLon, realMinLat],
    ];

    setAoiCoordinates(rectCoords);
    setAoiPointCount(4);
    setManualCoordsText(rectCoords.map((c) => `${c[0]}, ${c[1]}`).join('\n'));
    mapRef.current?.setAoiCoordinates?.(rectCoords);

    // Automatically center and zoom map to the created AOI
    const centerLat = (realMinLat + realMaxLat) / 2;
    const centerLon = (realMinLon + realMaxLon) / 2;
    setMapCenter([centerLat, centerLon]);

    const maxSpan = Math.max(realMaxLon - realMinLon, realMaxLat - realMinLat);
    let zoom = 14;
    if (maxSpan > 1.0) zoom = 9;
    else if (maxSpan > 0.5) zoom = 10;
    else if (maxSpan > 0.2) zoom = 11;
    else if (maxSpan > 0.08) zoom = 12;
    else if (maxSpan > 0.03) zoom = 13;
    else if (maxSpan > 0.01) zoom = 14;
    else zoom = 15;
    setMapZoom(zoom);
  };

  const handleAutoFillBboxFromSource = () => {
    if (!geojsonData) {
      Alert.alert('Aucune donnée', 'Veuillez d\'abord importer un fichier KML ou GeoJSON à l\'étape 1.');
      return;
    }
    const bbox = extractBboxFromGeoJson(geojsonData);
    if (!bbox) {
      Alert.alert('Emprise introuvable', 'Impossible de calculer l\'emprise du fichier importé.');
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const padLon = Math.max(0.002, (maxLon - minLon) * 0.08);
    const padLat = Math.max(0.002, (maxLat - minLat) * 0.08);

    const paddedMinLon = Number((minLon - padLon).toFixed(6));
    const paddedMinLat = Number((minLat - padLat).toFixed(6));
    const paddedMaxLon = Number((maxLon + padLon).toFixed(6));
    const paddedMaxLat = Number((maxLat + padLat).toFixed(6));

    setBboxMinLon(String(paddedMinLon));
    setBboxMinLat(String(paddedMinLat));
    setBboxMaxLon(String(paddedMaxLon));
    setBboxMaxLat(String(paddedMaxLat));
  };

  // STEP 2 -> 3: Save AOI in PostGIS & Launch Spatial Cross-Analysis (min. 4 vertices)
  const handleSaveAoiAndAnalyze = async () => {
    if (!token || !chantierId) return;

    if (aoiCoordinates.length < 4) {
      Alert.alert('Zone d\'étude incomplète', 'Veuillez définir un polygone d\'au moins 4 sommets pour délimiter l\'emprise.');
      return;
    }

    setIsSavingAoi(true);
    try {
      // 0. Pre-check conflict against sibling chantiers belonging to the same project
      try {
        const conflictCheck = await api.checkChantierAoiConflict(token, chantierId, aoiCoordinates);
        if (conflictCheck.conflict && conflictCheck.conflicts && conflictCheck.conflicts.length > 0) {
          setConflictData(conflictCheck.conflicts);
          setShowConflictModal(true);
          setIsSavingAoi(false);
          return;
        }
      } catch (checkErr: any) {
        if (checkErr?.status === 409 || checkErr?.data?.conflict) {
          setConflictData(checkErr.data?.conflicts || []);
          setShowConflictModal(true);
          setIsSavingAoi(false);
          return;
        }
        console.warn('Conflict pre-check warning:', checkErr.message);
      }

      // 1. Save AOI geometry to Chantier (PostGIS ST_Area + localisation)
      const aoiRes = await api.saveChantierAoi(token, chantierId, aoiCoordinates);
      setSavedAoiGeometry(aoiRes.chantier.localisation);
      setSavedAoiSurface(aoiRes.chantier.surface || null);

      // 2. Perform Spatial Intersection Analysis between AOI & Corridors (with detected/selected CRS)
      setIsAnalyzing(true);
      const analysis = await api.analyzeGeoJSONSource(token, chantierId, {
        geojson: geojsonData,
        fileName: selectedFileName || 'source.geojson',
        aoi: aoiCoordinates,
        source_srid: selectedCrsSrid || crsDetection?.detected_srid || undefined,
        assets: companionAssets.length > 0 ? companionAssets : undefined,
      });

      setAnalysisResult(analysis);

      // Auto-select the top recommended candidate corridor
      if (analysis.candidate_corridors && analysis.candidate_corridors.length > 0) {
        setSelectedCorridor(analysis.candidate_corridors[0]);
      }

      setCurrentStep(3);
    } catch (err: any) {
      if (err?.status === 409 || err?.data?.conflict) {
        setConflictData(err.data?.conflicts || []);
        setShowConflictModal(true);
        return;
      }
      Alert.alert('Erreur d\'analyse spatiale', err.message || 'Échec de l\'analyse spatiale PostGIS.');
    } finally {
      setIsSavingAoi(false);
      setIsAnalyzing(false);
    }
  };

  // ── AOI Refinement Workflow ──────────────────────────────────────────────
  const handleStartAoiRefinement = () => {
    // 1. Take a snapshot of current AOI state & candidates for Cancel (Annuler)
    setAoiBackup({
      coordinates: aoiCoordinates ? [...aoiCoordinates] : [],
      pointCount: aoiPointCount,
      manualCoordsText,
      bboxMinLon,
      bboxMinLat,
      bboxMaxLon,
      bboxMaxLat,
      analysisResult,
      selectedCorridor,
    });

    // 2. Clear draft coordinates so user places fresh red refinement points on top of the orange zone
    setAoiCoordinates([]);
    setAoiPointCount(0);
    setManualCoordsText('');

    // 3. Ensure bounding box fields are filled from existing coordinates for coordinate mode
    if (aoiCoordinates && aoiCoordinates.length >= 4) {
      const lons = aoiCoordinates.map((c) => c[0]);
      const lats = aoiCoordinates.map((c) => c[1]);
      const minLon = Math.min(...lons);
      const minLat = Math.min(...lats);
      const maxLon = Math.max(...lons);
      const maxLat = Math.max(...lats);
      setBboxMinLon(minLon.toFixed(5));
      setBboxMinLat(minLat.toFixed(5));
      setBboxMaxLon(maxLon.toFixed(5));
      setBboxMaxLat(maxLat.toFixed(5));
    }

    // 4. Enter Refine Mode & transition to Step 2 in draw mode with red dots
    setIsAoiRefineMode(true);
    setAoiMode('draw');
    setCurrentStep(2);
  };

  const handleCancelAoiRefinement = () => {
    if (aoiBackup) {
      setAoiCoordinates(aoiBackup.coordinates);
      setAoiPointCount(aoiBackup.pointCount);
      setManualCoordsText(aoiBackup.manualCoordsText);
      setBboxMinLon(aoiBackup.bboxMinLon);
      setBboxMinLat(aoiBackup.bboxMinLat);
      setBboxMaxLon(aoiBackup.bboxMaxLon);
      setBboxMaxLat(aoiBackup.bboxMaxLat);
      setAnalysisResult(aoiBackup.analysisResult);
      setSelectedCorridor(aoiBackup.selectedCorridor);
    }
    setIsAoiRefineMode(false);
    setAoiBackup(null);
    setCurrentStep(3);
  };

  const handleValidateAoiRefinement = async () => {
    if (!token || !chantierId) return;

    if (aoiCoordinates.length < 4) {
      Alert.alert(
        'Zone d\'étude incomplète',
        'Veuillez définir un polygone d\'au moins 4 sommets pour délimiter l\'emprise.'
      );
      return;
    }

    setIsSavingAoi(true);
    try {
      // Pre-check conflict against sibling chantiers
      try {
        const conflictCheck = await api.checkChantierAoiConflict(token, chantierId, aoiCoordinates);
        if (conflictCheck.conflict && conflictCheck.conflicts && conflictCheck.conflicts.length > 0) {
          setConflictData(conflictCheck.conflicts);
          setShowConflictModal(true);
          setIsSavingAoi(false);
          return;
        }
      } catch (checkErr: any) {
        if (checkErr?.status === 409 || checkErr?.data?.conflict) {
          setConflictData(checkErr.data?.conflicts || []);
          setShowConflictModal(true);
          setIsSavingAoi(false);
          return;
        }
      }

      // 1. Save modified AOI geometry to Chantier (PostGIS)
      const aoiRes = await api.saveChantierAoi(token, chantierId, aoiCoordinates);
      setSavedAoiGeometry(aoiRes.chantier.localisation);
      setSavedAoiSurface(aoiRes.chantier.surface || null);

      // 2. Recompute spatial intersection against ALL original LineStrings from KML/GeoJSON
      setIsAnalyzing(true);
      const analysis = await api.analyzeGeoJSONSource(token, chantierId, {
        geojson: geojsonData,
        fileName: selectedFileName || 'source.geojson',
        aoi: aoiCoordinates,
        source_srid: selectedCrsSrid || crsDetection?.detected_srid || undefined,
        assets: companionAssets.length > 0 ? companionAssets : undefined,
      });

      setAnalysisResult(analysis);

      // 3. Keep previously selected corridor if still intersecting, otherwise pick best candidate
      if (analysis.candidate_corridors && analysis.candidate_corridors.length > 0) {
        const stillPresent = selectedCorridor
          ? analysis.candidate_corridors.find((c: any) => String(c.id) === String(selectedCorridor.id))
          : null;
        setSelectedCorridor(stillPresent || analysis.candidate_corridors[0]);
      } else {
        setSelectedCorridor(null);
      }

      // 4. Exit refine mode and return to alignment-selection screen
      setIsAoiRefineMode(false);
      setAoiBackup(null);
      setCurrentStep(3);
    } catch (err: any) {
      if (err?.status === 409 || err?.data?.conflict) {
        setConflictData(err.data?.conflicts || []);
        setShowConflictModal(true);
        return;
      }
      Alert.alert('Erreur de validation', err.message || 'Échec du re-calcul spatial de l\'AOI.');
    } finally {
      setIsSavingAoi(false);
      setIsAnalyzing(false);
    }
  };

  // STEP 3 -> 4: Confirm and Create Reference Alignment
  const handleConfirmReferenceAlignment = async () => {
    if (!token || !chantierId || !selectedCorridor) {
      Alert.alert('Sélection requise', 'Veuillez sélectionner un corridor pour servir d\'axe de référence.');
      return;
    }

    setIsUploading(true);
    try {
      const alignRes = await api.uploadReferenceAlignment(token, chantierId, {
        geometry: selectedCorridor.geometry,
        fileName: selectedFileName || 'alignment.geojson',
        nom: `Axe Référence - ${chantier?.nom || 'Chantier'} (${selectedCorridor.nom})`,
        source_srid: selectedCrsSrid || crsDetection?.detected_srid || undefined,
        source_crs_name: crsDetection?.crs_name,
        source: isKmlSource(crsDetection?.source_format, selectedFileName) ? 'KML' : undefined,
        kml_metadata: kmlMetadata || crsDetection?.kml_metadata || null,
        assets: companionAssets.length > 0 ? companionAssets : undefined,
      });

      setReferenceAlignment(alignRes.reference_alignment);
      if (alignRes.reference_alignment?.kml_metadata) {
        setKmlMetadata(alignRes.reference_alignment.kml_metadata);
      }
      setIsReversed(!!alignRes.reference_alignment.direction_reversed);
      setCurrentStep(4);
    } catch (err: any) {
      Alert.alert("Erreur d'alignement", err.message || 'Échec de création de l\'alignement.');
    } finally {
      setIsUploading(false);
    }
  };

  // STEP 4: Direction Inversion (ST_Reverse)
  const handleToggleDirection = async () => {
    if (!token || !chantierId) return;

    setIsTogglingDirection(true);
    try {
      const res = await api.toggleAlignmentDirection(token, chantierId);
      setReferenceAlignment(res.reference_alignment);
      setIsReversed(!!res.reference_alignment.direction_reversed);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Échec de changement de direction.');
    } finally {
      setIsTogglingDirection(false);
    }
  };

  // STEP 5 -> 6: Generate Linear Substring Segments along Curve
  const handleGenerateTroncons = async () => {
    if (!token || !chantierId) return;

    setIsGenerating(true);
    try {
      const payload =
        segMode === 'count'
          ? { count: tronconCount }
          : { target_length_km: parseFloat(targetLengthKm) || 2.5 };

      const res = await api.generateTronconsPreview(token, chantierId, payload);
      setGeneratedData(res);
      setEditableTroncons(res.troncons);
      setTronconCount(res.count);
      setCurrentStep(6);
    } catch (err: any) {
      Alert.alert('Erreur de segmentation', err.message || 'Échec du calcul linéaire PostGIS.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Tronçon Name & PK Editor
  const handleUpdateTronconName = (index: number, newName: string) => {
    const updated = [...editableTroncons];
    updated[index] = { ...updated[index], nom: newName };
    setEditableTroncons(updated);
  };

  // Dynamic Chainage & Linear Referencing System (LRS) Propagation
  const handleUpdateTronconPKs = (index: number, newPkDebut: number | string, newPkFin: number | string) => {
    const N = editableTroncons.length;
    if (N === 0) return;

    const parsedDebut = typeof newPkDebut === 'number' ? newPkDebut : parseFloat(String(newPkDebut)) || 0;
    const parsedFin = typeof newPkFin === 'number' ? newPkFin : parseFloat(String(newPkFin)) || 0;

    const totalLen = Number(referenceAlignment?.length_km) || Number(editableTroncons[N - 1]?.pk_fin) || 20.0;
    const updated = [...editableTroncons];

    // 1. Instant client-side propagation across all subsequent tronçons
    const safeDebut = index === 0 ? 0.0 : Number(parsedDebut.toFixed(3));
    const safeFin = Number(parsedFin.toFixed(3));

    const itemLen = Number(Math.max(0, safeFin - safeDebut).toFixed(3));
    updated[index] = {
      ...updated[index],
      pk_debut: safeDebut,
      pk_fin: safeFin,
      length_km: itemLen,
      length_meters: Number((itemLen * 1000).toFixed(1)),
    };

    // Propagate forward to keep continuity: pk_debut(i) = pk_fin(i-1)
    let currentAnchor = safeFin;
    for (let i = index + 1; i < N; i++) {
      const targetItem = editableTroncons[i];
      const itemLengthKm = targetItem?.length_km !== undefined ? Number(targetItem.length_km) : NaN;
      const itemPkFin = targetItem?.pk_fin !== undefined ? Number(targetItem.pk_fin) : NaN;
      const itemPkDebut = targetItem?.pk_debut !== undefined ? Number(targetItem.pk_debut) : NaN;

      const prevLength = !isNaN(itemLengthKm) && itemLengthKm > 0
        ? itemLengthKm
        : (!isNaN(itemPkFin) && !isNaN(itemPkDebut) ? Math.max(0.1, itemPkFin - itemPkDebut) : 1.0);

      const numPrevLength = Number(prevLength) || 1.0;
      const segDebut = Number(currentAnchor.toFixed(3));
      const segFin = i === N - 1
        ? Number(Math.max(segDebut + 0.05, totalLen).toFixed(3))
        : Number((segDebut + numPrevLength).toFixed(3));

      const len = Number(Math.max(0, segFin - segDebut).toFixed(3));

      updated[i] = {
        ...updated[i],
        pk_debut: segDebut,
        pk_fin: segFin,
        length_km: len,
        length_meters: Number((len * 1000).toFixed(1)),
      };
      currentAnchor = segFin;
    }

    setEditableTroncons(updated);

    // 2. Debounce call to PostGIS LRS to recalculate exact ST_LineSubstring geometries
    if (recalcTimeoutRef.current) {
      clearTimeout(recalcTimeoutRef.current);
    }

    recalcTimeoutRef.current = setTimeout(async () => {
      if (!token || !chantierId || safeFin <= safeDebut) return;
      setIsRecalculatingSpatial(true);
      try {
        const res = await api.recalculateTronconsChainage(token, chantierId, {
          reference_alignment_id: referenceAlignment?.id,
          troncons: updated,
          modified_index: index,
          new_pk_debut: safeDebut,
          new_pk_fin: safeFin,
        });

        if (res && res.troncons && res.troncons.length > 0) {
          setEditableTroncons(res.troncons);
        }
      } catch (err: any) {
        console.error('Erreur recalcul spatial PostGIS:', err.message);
      } finally {
        setIsRecalculatingSpatial(false);
      }
    }, 400);
  };

  // Chainage Invariants Validation
  const chainageValidation = useMemo(() => {
    if (editableTroncons.length === 0) return { isValid: true, error: null };
    const N = editableTroncons.length;

    // Check first troncon start
    const firstDebut = parseFloat(String(editableTroncons[0].pk_debut));
    if (isNaN(firstDebut) || firstDebut < 0) {
      return { isValid: false, error: "Le premier tronçon doit débuter à une borne kilométrique valide (≥ 0)." };
    }

    // Check each segment
    for (let i = 0; i < N; i++) {
      const t = editableTroncons[i];
      const d = parseFloat(String(t.pk_debut));
      const f = parseFloat(String(t.pk_fin));

      if (isNaN(d) || isNaN(f) || d >= f) {
        return { isValid: false, error: `Le tronçon "${t.nom}" a des bornes invalides (PK début: ${t.pk_debut} ≥ PK fin: ${t.pk_fin}).` };
      }
      if (i > 0) {
        const prev = editableTroncons[i - 1];
        const prevF = parseFloat(String(prev.pk_fin));
        if (Math.abs(d - prevF) > 0.005) {
          return {
            isValid: false,
            error: `Discontinuité entre "${prev.nom}" (Fin: ${prev.pk_fin} km) et "${t.nom}" (Début: ${t.pk_debut} km).`,
          };
        }
      }
    }

    return { isValid: true, error: null };
  }, [editableTroncons]);

  // STEP 7: Save Tronçons to PostgreSQL Transactionally
  const handleSaveTroncons = async () => {
    if (!token || !chantierId || editableTroncons.length === 0) return;

    setIsSaving(true);
    try {
      await api.saveTroncons(token, chantierId, {
        troncons: editableTroncons,
        reference_alignment_id: referenceAlignment?.id,
      });

      setSaveSuccess(true);
      setCurrentStep(7);
    } catch (err: any) {
      Alert.alert("Erreur d'enregistrement", err.message || 'Impossible d\'enregistrer les tronçons.');
    } finally {
      setIsSaving(false);
    }
  };

  const stepsList = [
    { num: 1, label: '1. Infrastructure' },
    { num: 2, label: '2. Zone du chantier' },
    { num: 3, label: '3. Alignement de référence' },
    { num: 4, label: '4. Longueur calculée & PK' },
    { num: 5, label: '5. Découpage en tronçons' },
    { num: 6, label: '6. Vérification' },
    { num: 7, label: '7. Finalisation' },
  ];

  const mapTroncons: GisTronconSegment[] = editableTroncons.map((t, idx) => ({
    id: t.id || idx + 1,
    nom: t.nom,
    pk_debut: t.pk_debut,
    pk_fin: t.pk_fin,
    statut: t.statut || 'NON_COMMENCE',
    length_km: t.length_km,
    geometry: t.geometry,
  }));

  const mapCorridors: GisCandidateCorridor[] = (analysisResult?.candidate_corridors || []).map((c) => ({
    id: c.id,
    nom: c.nom,
    length_km: c.length_km,
    length_meters: c.length_meters,
    intersects_aoi: c.intersects_aoi,
    length_in_aoi_km: c.length_in_aoi_km,
    coverage_aoi_percent: c.coverage_aoi_percent,
    is_recommended: c.is_recommended,
    recommendation_reason: c.recommendation_reason,
    geometry: c.geometry,
  }));

  // Step 3: Filtering & Pagination for Candidate Corridors
  const candidateCorridors = useMemo(() => analysisResult?.candidate_corridors || [], [analysisResult]);
  const aoiCorridorsCount = useMemo(() => candidateCorridors.filter((c) => !!c.intersects_aoi).length, [candidateCorridors]);

  const filteredCorridors = useMemo(() => {
    let list = candidateCorridors;
    if (corridorFilter === 'aoi') {
      list = list.filter((c) => !!c.intersects_aoi);
    }
    if (corridorSearch.trim()) {
      const q = corridorSearch.toLowerCase().trim();
      list = list.filter((c) => c.nom.toLowerCase().includes(q) || (c.recommendation_reason && c.recommendation_reason.toLowerCase().includes(q)));
    }
    return list;
  }, [candidateCorridors, corridorFilter, corridorSearch]);

  const CORRIDORS_PER_PAGE = 5;
  const totalCorridorPages = Math.ceil(filteredCorridors.length / CORRIDORS_PER_PAGE) || 1;

  const visibleCorridors = useMemo(() => {
    if (corridorViewMode === 'pages') {
      const start = (corridorPage - 1) * CORRIDORS_PER_PAGE;
      return filteredCorridors.slice(start, start + CORRIDORS_PER_PAGE);
    }
    return filteredCorridors.slice(0, corridorDisplayLimit);
  }, [filteredCorridors, corridorViewMode, corridorPage, corridorDisplayLimit]);

  const handleSelectCorridorWithAutoReveal = (c: GeoJSONCandidateCorridor) => {
    setSelectedCorridor(c);
    const index = filteredCorridors.findIndex((item) => item.id === c.id);
    if (index !== -1) {
      if (corridorViewMode === 'pages') {
        const targetPage = Math.floor(index / CORRIDORS_PER_PAGE) + 1;
        setCorridorPage(targetPage);
      } else {
        if (index >= corridorDisplayLimit) {
          setCorridorDisplayLimit(index + 1);
        }
      }
    }
  };

  const currentAoiGeom = (aoiCoordinates.length >= 4 ? { type: 'Polygon', coordinates: [aoiCoordinates] } : null) || savedAoiGeometry;

  if (isLoadingChantier) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Initialisation du module GIS...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* Hidden File Input on Web */}
      {Platform.OS === 'web' && (
        <input
          type="file"
          ref={fileInputRef as any}
          onChange={handleFileSelect}
          accept=".geojson,.json,.kml,.png,.jpg,.jpeg,.webp"
          multiple
          style={{ display: 'none' }}
        />
      )}

      {/* Header — Blue Zone (Adapted for phone) */}
      <View style={styles.phoneHeaderBar}>
        <View style={styles.phoneHeaderLeftGroup}>
          <TouchableOpacity
            style={styles.phoneBackBtn}
            onPress={() => {
              const pId = projectId || (chantier?.projet_id ? String(chantier.projet_id) : undefined);
              if (pId) {
                router.replace(`/responsable/projet/${pId}` as any);
              } else {
                router.back();
              }
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#1E40AF" />
          </TouchableOpacity>

          <View style={styles.phoneHeaderBadge}>
            <Ionicons name="business-outline" size={15} color="#93C5FD" />
            <Text style={styles.phoneHeaderBadgeText} weight="bold">
              {isMultiFlow ? `CHANTIER ${currentNum} SUR ${totalNum}` : 'CADRAGE SPATIAL'}
            </Text>
          </View>
        </View>

        {Boolean(kmlMetadata) && (
          <TouchableOpacity
            style={styles.phoneKmlInfoBtn}
            onPress={() => {
              setSelectedKmlMetadata(kmlMetadata);
              setShowKmlInfoModal(true);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="information-circle" size={20} color="#EA580C" />
          </TouchableOpacity>
        )}
      </View>

      {gisViewMode === '3d' ? (
        <View style={styles.view3DContainer}>
          {/* 3D Top Status Bar */}
          <View style={styles.view3DTopBar}>
            <View style={{ flex: 1 }}>
              <View style={styles.view3DBadgeRow}>
                <View style={styles.view3DBadge}>
                  <Text style={styles.view3DBadgeText} weight="bold">VUE 3D SPATIALE</Text>
                </View>
                {kmlMetadata?.hasAltitude ? (
                  <View style={[styles.view3DBadge, { backgroundColor: 'rgba(56, 189, 248, 0.2)' }]}>
                    <Text style={[styles.view3DBadgeText, { color: '#38BDF8' }]} weight="bold">
                      ALTITUDE KML ACTIVE
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.view3DBadge, { backgroundColor: 'rgba(148, 163, 184, 0.15)' }]}>
                    <Text style={[styles.view3DBadgeText, { color: '#94A3B8' }]} weight="bold">
                      ALTITUDE 2D AU SOL
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.view3DChantierTitle} weight="bold">
                {chantier?.nom || 'Visualisation 3D du Chantier'}
              </Text>
              <Text style={styles.view3DChantierSubtitle}>
                {referenceAlignment?.length_km ? `${referenceAlignment.length_km.toFixed(2)} km • ` : ''}
                {editableTroncons.length > 0 ? `${editableTroncons.length} tronçons • ` : ''}
                Système géodésique WGS 84 métrique (ENU)
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {Boolean(kmlMetadata) && (
                <TouchableOpacity
                  style={styles.kml3dActionBtn}
                  onPress={() => {
                    setSelectedKmlMetadata(kmlMetadata);
                    setShowKmlInfoModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="information-circle-outline" size={14} color="#EA580C" />
                  <Text style={styles.kml3dActionText} weight="semibold">
                    Métadonnées KML
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.returnTo2dBtn}
                onPress={() => setGisViewMode('2d')}
                activeOpacity={0.8}
              >
                <Ionicons name="map" size={15} color="#FFFFFF" />
                <Text style={styles.returnTo2dText} weight="semibold">
                  Retour Carte 2D
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 3D Map Component */}
          <View style={{ flex: 1, minHeight: 520 }}>
            <InteractiveGis3DMap
              aoiGeometry={savedAoiGeometry || (aoiCoordinates.length >= 3 ? { type: 'Polygon', coordinates: [aoiCoordinates] } : null)}
              referenceGeometry={referenceAlignment?.geometry || (geojsonData?.geometry?.type === 'LineString' ? geojsonData.geometry : null)}
              troncons={mapTroncons.length > 0 ? mapTroncons : null}
              selectedTronconId={selectedTronconId}
              onSelectTroncon={(id) => setSelectedTronconId(id)}
              kmlGeometry={kmlSourceGeometry}
              kmlSourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
              kmlMetadata={kmlMetadata}
              kmlGroundOverlays={kmlMetadata?.groundOverlays || null}
              kmlPhotoOverlays={kmlMetadata?.photoOverlays || null}
              showKmlLayer={isKmlLayerVisible}
              showKmlImages={isKmlImagesVisible}
              onSelectKml={(meta) => {
                setSelectedKmlMetadata(meta);
                setShowKmlInfoModal(true);
              }}
              onSelectKmlImage={(overlay) => {
                setSelectedKmlImage(overlay);
                setShowKmlImageModal(true);
              }}
              center={mapCenter}
              height="100%"
            />
          </View>
        </View>
      ) : (
        <>
          {/* Stepper Header */}
      <View style={styles.stepperContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepperScroll}>
          {stepsList.map((st) => {
            const isCompleted = currentStep > st.num;
            const isCurrent = currentStep === st.num;

            return (
              <TouchableOpacity
                key={st.num}
                style={[
                  styles.stepBadge,
                  isCompleted && styles.stepBadgeCompleted,
                  isCurrent && styles.stepBadgeCurrent,
                ]}
                onPress={() => {
                  if (isCompleted || isCurrent) setCurrentStep(st.num);
                }}
              >
                <Ionicons
                  name={isCompleted ? 'checkmark-circle' : 'ellipse'}
                  size={12}
                  color={isCompleted ? '#16A34A' : isCurrent ? Palette.primary : Palette.textMuted}
                />
                <Text
                  style={[
                    styles.stepBadgeText,
                    isCompleted && styles.stepBadgeTextCompleted,
                    isCurrent && styles.stepBadgeTextCurrent,
                  ]}
                  weight={isCurrent ? 'bold' : 'normal'}
                >
                  {st.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.spatialHierarchyBar}>
        <Text style={styles.spatialHierarchyText} weight="semibold">
          Infrastructure <Text style={styles.spatialHierarchyArrow}>→</Text> portion spatiale du chantier <Text style={styles.spatialHierarchyArrow}>→</Text> alignement de référence <Text style={styles.spatialHierarchyArrow}>→</Text> tronçons
        </Text>
      </View>

      <ScrollView
        scrollEnabled={screenScrollEnabled}
        nestedScrollEnabled
        disableScrollViewPanResponder
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── STEP 1: Source GIS Infrastructure Selection ── */}
        {currentStep === 1 && (
          <Card variant="elevated" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadgeNum}>
                <Text style={styles.stepBadgeNumText}>ÉTAPE 1 / 7</Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                Importer les Données d'Infrastructure (SIG)
              </Text>
              <Text style={styles.stepDescription}>
                Sélectionnez le fichier contenant le tracé de votre infrastructure (WGS 84 / Lambert).
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.dropzone, geojsonData && styles.dropzoneActive]}
              onPress={handlePickGeoJSONFile}
            >
              <View style={styles.dropzoneIconWrapper}>
                <Ionicons
                  name={geojsonData ? 'document-text' : 'cloud-upload-outline'}
                  size={36}
                  color={geojsonData ? '#16A34A' : Palette.primary}
                />
              </View>
              <Text style={styles.dropzoneTitle} weight="bold">
                {selectedFileName ? selectedFileName : 'Cliquez pour sélectionner un fichier de tracé'}
              </Text>
              <Text style={styles.dropzoneSubtitle}>
                {geojsonData
                  ? 'Fichier chargé avec succès (appuyez pour changer).'
                  : 'Formats supportés : Fichiers SIG (GeoJSON, KML...)'}
              </Text>
            </TouchableOpacity>

            {geojsonData && (
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 8 }}>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4, paddingHorizontal: 8 }}
                  onPress={handlePickGeoJSONFile}
                >
                  <Ionicons name="folder-open-outline" size={16} color={Palette.primary} />
                  <Text style={{ fontSize: 13, color: Palette.primary }} weight="semibold">
                    Choisir un autre fichier
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!geojsonData && (
              <View style={styles.sampleSection}>
                <Text style={styles.sampleText}>Vous n'avez pas de fichier sous la main ?</Text>
                <TouchableOpacity style={styles.sampleBtn} onPress={handleUseSampleGeoJSON}>
                  <Ionicons name="sparkles" size={16} color={Palette.primary} />
                  <Text style={styles.sampleBtnText} weight="semibold">
                    Charger un tracé exemple
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* CRS Detection Card & Resolution */}
            {geojsonData && isDetectingCrs && (
              <View style={styles.crsScanningCard}>
                <ActivityIndicator size="small" color={Palette.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.crsScanningTitle} weight="bold">
                    Analyse du système de coordonnées...
                  </Text>
                  <Text style={styles.crsScanningSubtitle}>
                    Inspection géométrique et détection de la projection spatiale
                  </Text>
                </View>
              </View>
            )}

            {geojsonData && !isDetectingCrs && crsDetection && (
              <View style={{ marginTop: 14 }}>
                {/* 1. Unambiguous / High Confidence Detection */}
                {!crsDetection.is_ambiguous && crsDetection.confidence !== 'NONE' && (
                  <View style={styles.crsDetectedCard}>
                    <View style={styles.crsDetectedHeader}>
                      <View style={styles.crsDetectedIcon}>
                        <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.crsDetectedBadgeText}>✓ SYSTÈME DE COORDONNÉES DÉTECTÉ</Text>
                        <Text style={styles.crsDetectedName} weight="bold">
                          {crsDetection.crs_name} ({crsDetection.epsg_code})
                        </Text>
                        <Text style={styles.crsDetectedDesc}>{crsDetection.explanation}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.crsEditLink}
                        onPress={() => setShowCrsModal(true)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="options-outline" size={14} color={Palette.primary} />
                        <Text style={styles.crsEditText}>Modifier</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* 2. Ambiguous / Multiple Candidates Detection */}
                {crsDetection.is_ambiguous && (
                  <View style={styles.crsAmbiguousCard}>
                    <View style={styles.crsAmbiguousHeader}>
                      <Ionicons name="alert-circle" size={22} color="#D97706" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.crsAmbiguousTitle} weight="bold">
                          Confirmation requise : Système de coordonnées
                        </Text>
                        <Text style={styles.crsAmbiguousDesc}>
                          {crsDetection.explanation}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.crsCandidatesPrompt} weight="semibold">
                      Sélectionnez la zone géographique de votre tracé :
                    </Text>
                    <View style={styles.crsCandidatesList}>
                      {crsDetection.candidates.map((c) => {
                        const isSelected = selectedCrsSrid === c.srid;
                        return (
                          <TouchableOpacity
                            key={c.srid}
                            style={[styles.crsCandidateItem, isSelected && styles.crsCandidateItemActive]}
                            onPress={() => setSelectedCrsSrid(c.srid)}
                            activeOpacity={0.75}
                          >
                            <Ionicons
                              name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={isSelected ? Palette.primary : Palette.textMuted}
                            />
                            <View style={{ flex: 1 }}>
                              <View style={styles.crsCandidateTitleRow}>
                                <Text
                                  style={[styles.crsCandidateName, isSelected && { color: Palette.primary }]}
                                  weight={isSelected ? 'bold' : 'medium'}
                                >
                                  {c.name}
                                </Text>
                                <View style={styles.crsCandidateCodeBadge}>
                                  <Text style={styles.crsCandidateCodeText}>{c.code}</Text>
                                </View>
                              </View>
                              {c.zone_label && <Text style={styles.crsCandidateZone}>{c.zone_label}</Text>}
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <TouchableOpacity
                      style={styles.crsOtherLink}
                      onPress={() => setShowCrsModal(true)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.crsOtherText}>Autre système / sélection manuelle avancée...</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* 3. Unknown / Manual Fallback */}
                {crsDetection.confidence === 'NONE' && (
                  <View style={styles.crsAmbiguousCard}>
                    <View style={styles.crsAmbiguousHeader}>
                      <Ionicons name="help-circle" size={22} color="#DC2626" />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.crsAmbiguousTitle} weight="bold">
                          Projection non reconnue automatiquement
                        </Text>
                        <Text style={styles.crsAmbiguousDesc}>
                          {crsDetection.explanation}
                        </Text>
                      </View>
                    </View>
                    <Button
                      title="Choisir manuellement le système de coordonnées"
                      variant="outline"
                      size="sm"
                      onPress={() => setShowCrsModal(true)}
                      style={{ marginTop: 10 }}
                    />
                  </View>
                )}
              </View>
            )}

            {/* Level 3 — KML Visualization & Intelligence Card */}
            {geojsonData && kmlMetadata && (
              <View style={styles.kmlDetectedCard}>
                <View style={styles.kmlDetectedHeader}>
                  <View style={styles.kmlDetectedIcon}>
                    <Ionicons name="map-outline" size={20} color="#F97316" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.kmlDetectedBadgeText}>✓ CALQUE SOURCE KML DÉTECTÉ</Text>
                      <View style={styles.kmlSourceTag}>
                        <Text style={styles.kmlSourceTagText}>Niveau 4 — 2D</Text>
                      </View>
                    </View>
                    <Text style={styles.kmlDetectedName} weight="bold">
                      {kmlMetadata.name}
                    </Text>
                    <Text style={styles.kmlDetectedDesc}>
                      Visualisation 2D prête. Le tracé KML et les images associées (GroundOverlay & PhotoOverlay) sont affichés en 2D et inspectables séparément.
                    </Text>
                  </View>
                </View>

                {/* Overlays Summary if any */}
                {Boolean((kmlMetadata.groundOverlays?.length || 0) + (kmlMetadata.photoOverlays?.length || 0) > 0) && (
                  <View style={styles.kmlImagesSummaryRow}>
                    <Ionicons name="images-outline" size={14} color="#F97316" />
                    <Text style={styles.kmlImagesSummaryText}>
                      Images KML :{' '}
                      <Text weight="bold">
                        {kmlMetadata.groundOverlays?.length || 0} GroundOverlay{(kmlMetadata.groundOverlays?.length || 0) > 1 ? 's' : ''}, {kmlMetadata.photoOverlays?.length || 0} PhotoOverlay{(kmlMetadata.photoOverlays?.length || 0) > 1 ? 's' : ''}
                      </Text>
                    </Text>
                  </View>
                )}

                <View style={styles.kmlActionsRow}>
                  <TouchableOpacity
                    style={styles.kmlInspectBtn}
                    onPress={() => {
                      setSelectedKmlMetadata(kmlMetadata);
                      setShowKmlInfoModal(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="information-circle-outline" size={15} color="#F97316" />
                    <Text style={styles.kmlInspectBtnText} weight="semibold">
                      Métadonnées KML
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.kmlInspectBtn, { backgroundColor: 'rgba(56, 189, 248, 0.12)', borderColor: 'rgba(56, 189, 248, 0.3)' }]}
                    onPress={() => setGisViewMode('3d')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="cube-outline" size={15} color="#0284C7" />
                    <Text style={[styles.kmlInspectBtnText, { color: '#0284C7' }]} weight="semibold">
                      Explorer en 3D
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.kmlToggleLayerBtn, !isKmlLayerVisible && styles.kmlToggleLayerBtnOff]}
                    onPress={() => setIsKmlLayerVisible(!isKmlLayerVisible)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={isKmlLayerVisible ? "eye-outline" : "eye-off-outline"}
                      size={15}
                      color={isKmlLayerVisible ? "#15803D" : "#64748B"}
                    />
                    <Text
                      style={[styles.kmlToggleLayerText, !isKmlLayerVisible && styles.kmlToggleLayerTextOff]}
                      weight="semibold"
                    >
                      {isKmlLayerVisible ? "Lignes : Activé" : "Lignes : Masqué"}
                    </Text>
                  </TouchableOpacity>

                  {Boolean((kmlMetadata.groundOverlays?.length || 0) + (kmlMetadata.photoOverlays?.length || 0) > 0) && (
                    <TouchableOpacity
                      style={[styles.kmlToggleLayerBtn, !isKmlImagesVisible && styles.kmlToggleLayerBtnOff]}
                      onPress={() => setIsKmlImagesVisible(!isKmlImagesVisible)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isKmlImagesVisible ? "image-outline" : "eye-off-outline"}
                        size={15}
                        color={isKmlImagesVisible ? "#EA580C" : "#64748B"}
                      />
                      <Text
                        style={[styles.kmlToggleLayerText, !isKmlImagesVisible && styles.kmlToggleLayerTextOff]}
                        weight="semibold"
                      >
                        {isKmlImagesVisible
                          ? `Images (${(kmlMetadata.groundOverlays?.length || 0) + (kmlMetadata.photoOverlays?.length || 0)}) : Activé`
                          : "Images : Masqué"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {geojsonData && geojsonData.type === 'FeatureCollection' && Array.isArray(geojsonData.features) && geojsonData.features.length > 1 && (
              <View style={styles.multiFeatureDetectedBanner}>
                <View style={styles.multiFeatureDetectedIconWrap}>
                  <Ionicons name="git-network-outline" size={20} color="#0284C7" />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.multiFeatureDetectedTag}>MODE MULTI-ENTITÉS</Text>
                    <Text style={styles.multiFeatureCountTag}>
                      {geojsonData.features.length} LineStrings
                    </Text>
                  </View>
                  <Text style={styles.multiFeatureDetectedTitle} weight="bold">
                    Tracé multi-linéaire chargé avec succès
                  </Text>
                  <Text style={styles.multiFeatureDetectedDesc}>
                    Les {geojsonData.features.length} tracés sont préservés individuellement avec leurs métadonnées. À l'étape suivante, vous pourrez définir une zone d'étude (AOI) pour filtrer et isoler l'alignement de référence souhaité.
                  </Text>
                </View>
              </View>
            )}

            {geojsonData && (
              <Button
                title="Passer à la Zone d'Étude (AOI) →"
                variant="primary"
                size="lg"
                onPress={() => setCurrentStep(2)}
                style={{ marginTop: 18 }}
              />
            )}
          </Card>
        )}

        {/* ── STEP 2: Define Area of Interest (AOI) ── */}
        {currentStep === 2 && (
          <Card variant="elevated" style={styles.stepCard}>
            {/* Mode Modification Banner */}
            {isAoiRefineMode && (
              <View style={styles.refineModeNoticeBar}>
                <View style={styles.refineModeNoticeIconWrap}>
                  <Ionicons name="create" size={18} color="#D97706" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.refineModeNoticeTitle} weight="bold">
                    Mode modification de l'AOI (Points rouges)
                  </Text>
                  <Text style={styles.refineModeNoticeSubtitle}>
                    L'ancienne zone reste en orange. Touchez la carte pour placer des points rouges et affiner l'emprise, puis validez pour recalculer les intersections.
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.stepHeader}>
              <View style={[styles.stepBadgeNum, isAoiRefineMode && styles.stepBadgeNumRefine]}>
                <Text style={[styles.stepBadgeNumText, isAoiRefineMode && styles.stepBadgeNumTextRefine]}>
                  {isAoiRefineMode ? 'AFFINEMENT DE L’AOI' : 'ÉTAPE 2 / 7'}
                </Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                {isAoiRefineMode ? 'Mode modification de l\'AOI' : 'Zone d\'Étude du Chantier (AOI)'}
              </Text>
              <Text style={styles.stepDescription}>
                {isAoiRefineMode
                  ? 'Faites glisser les sommets pour restreindre ou agrandir l\'emprise du chantier.'
                  : 'Délimitez la portion spatiale de l’infrastructure qui appartient à ce chantier (min. 4 points).'}
              </Text>
            </View>

            {/* 1 — Localiser le chantier */}
            <View style={[styles.sectionBlock, { zIndex: 100 }]}>
              <Text style={styles.sectionBlockTitle} weight="bold">
                1 — Localiser le chantier
              </Text>
              <Text style={styles.sectionBlockSubtitle}>
                Recherchez une ville ou une adresse pour centrer la carte.
              </Text>

              <AddressAutocompleteInput
                value={searchAddress}
                onChangeText={setSearchAddress}
                onSelectAddress={handleSelectGeoapifyAddress}
                placeholder="Rechercher une ville, région ou adresse..."
              />

              {selectedLocation && (
                <View style={styles.selectedLocChip}>
                  <Ionicons name="location-sharp" size={16} color="#EF4444" style={{ marginTop: 2 }} />
                  <Text style={styles.selectedLocText}>
                    Position : <Text weight="bold" style={{ color: '#991B1B' }}>{selectedLocation.label}</Text>{' '}
                    <Text style={styles.selectedLocCoords}>({selectedLocation.lat.toFixed(4)}, {selectedLocation.lon.toFixed(4)})</Text>
                  </Text>
                </View>
              )}
            </View>

            {/* 2 — Définir la zone d'étude */}
            <View style={styles.sectionBlock}>
              <View style={styles.sectionBlockHeaderRow}>
                <View>
                  <Text style={styles.sectionBlockTitle} weight="bold">
                    2 — Définir la zone d'étude
                  </Text>
                  <Text style={styles.sectionBlockSubtitle}>
                    Posez au moins 4 sommets autour du tracé.
                  </Text>
                </View>
              </View>

              {/* Mode Toggle with Spacing */}
              <View style={styles.segModeToggle}>
                <TouchableOpacity
                  style={[styles.segModeBtn, aoiMode === 'draw' && styles.segModeBtnActive]}
                  onPress={() => setAoiMode('draw')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="brush-outline"
                    size={16}
                    color={aoiMode === 'draw' ? '#FFFFFF' : Palette.primary}
                  />
                  <Text
                    style={[styles.segModeText, aoiMode === 'draw' && styles.segModeTextActive]}
                    weight="semibold"
                  >
                    Dessiner
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.segModeBtn, aoiMode === 'coords' && styles.segModeBtnActive]}
                  onPress={() => setAoiMode('coords')}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="locate-outline"
                    size={16}
                    color={aoiMode === 'coords' ? '#FFFFFF' : Palette.primary}
                  />
                  <Text
                    style={[styles.segModeText, aoiMode === 'coords' && styles.segModeTextActive]}
                    weight="semibold"
                  >
                    Coordonnées
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Interactive Map with Source GeoJSON & Location Marker */}
              <View style={styles.mapWrapper}>
                <InteractiveGisMap
                  ref={mapRef}
                  mapRef={mapRef}
                  rawGeoJson={geojsonData}
                  kmlGeometry={kmlSourceGeometry}
                  kmlSourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
                  kmlMetadata={kmlMetadata}
                  showKmlLayer={isKmlLayerVisible}
                  onToggleKmlVisibility={setIsKmlLayerVisible}
                  onSelectKml={(meta) => {
                    setSelectedKmlMetadata(meta);
                    setShowKmlInfoModal(true);
                  }}
                  kmlGroundOverlays={kmlMetadata?.groundOverlays || null}
                  kmlPhotoOverlays={kmlMetadata?.photoOverlays || null}
                  showKmlImages={isKmlImagesVisible}
                  onToggleKmlImagesVisibility={setIsKmlImagesVisible}
                  onSelectKmlImage={(overlay) => {
                    setSelectedKmlImage(overlay);
                    setShowKmlImageModal(true);
                  }}
                  searchLocation={selectedLocation}
                  enableAoiDrawing={aoiMode === 'draw'}
                  aoiGeometry={isAoiRefineMode ? null : (savedAoiGeometry || null)}
                  refinePreviousAoiGeometry={
                    isAoiRefineMode && aoiBackup?.coordinates && aoiBackup.coordinates.length >= 4
                      ? { type: 'Polygon', coordinates: [aoiBackup.coordinates] }
                      : (isAoiRefineMode && savedAoiGeometry ? savedAoiGeometry : null)
                  }
                  isRefineMode={isAoiRefineMode}
                  existingAois={siblingAois}
                  center={mapCenter}
                  zoom={mapZoom}
                  onAoiChange={handleAoiMapDrawn}
                  onInteractionChange={handleMapInteractionChange}
                  height={320}
                />
              </View>

              {/* Sibling AOIs Reference Notice */}
              {siblingAois.length > 0 && (
                <View style={styles.siblingAoisNotice}>
                  <Ionicons name="information-circle-outline" size={16} color="#4F46E5" />
                  <Text style={styles.siblingAoisNoticeText}>
                    {siblingAois.length === 1
                      ? `1 chantier voisin configuré (${siblingAois[0].nom}) affiché en violet sur la carte. Les zones ne doivent pas se chevaucher.`
                      : `${siblingAois.length} chantiers voisins configurés affichés en violet sur la carte. Les zones ne doivent pas se chevaucher.`}
                  </Text>
                </View>
              )}

              {/* DRAWING MODE CONTROLS: Mode Indicator + Action Buttons outside map */}
              {aoiMode === 'draw' && (
                <View style={styles.drawingControlsSection}>
                  {/* Drawing Mode Indicator */}
                  <View style={styles.drawingModeBar}>
                    <View style={styles.drawingModeIconWrap}>
                      <Ionicons name="brush" size={13} color="#D97706" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.drawingModeTitle} weight="bold">
                        {isAoiRefineMode ? 'Points rouges d\'affinement actifs' : 'Mode dessin actif'}
                      </Text>
                      <Text style={styles.drawingModeSubtitle}>
                        {isAoiRefineMode
                          ? `${drawingVerticesCount} point${drawingVerticesCount > 1 ? 's' : ''} rouge${drawingVerticesCount > 1 ? 's' : ''} • Touchez la zone pour tracer l'emprise précise`
                          : (drawingVerticesCount === 0
                            ? 'Minimum 4 sommets • Touchez la carte pour commencer'
                            : drawingVerticesCount < 4
                            ? `${drawingVerticesCount} sommet${drawingVerticesCount > 1 ? 's' : ''} placé${drawingVerticesCount > 1 ? 's' : ''} (min. 4 requis)`
                            : `${drawingVerticesCount} sommets placés • Prêt à finaliser`)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.drawingModeBadge,
                        drawingVerticesCount >= 4 && styles.drawingModeBadgeSuccess,
                      ]}
                    >
                      <Text
                        style={[
                          styles.drawingModeBadgeText,
                          drawingVerticesCount >= 4 && styles.drawingModeBadgeTextSuccess,
                        ]}
                        weight="bold"
                      >
                        {drawingVerticesCount >= 4 ? '✓ Prêt' : `${drawingVerticesCount}/4`}
                      </Text>
                    </View>
                  </View>

                  {/* Drawing Action Buttons (Annuler, Effacer, Terminer) */}
                  <View style={styles.drawingToolbarRow}>
                    <TouchableOpacity
                      style={[
                        styles.drawingActionBtn,
                        styles.drawingActionBtnUndo,
                        drawingVerticesCount === 0 && styles.drawingActionBtnDisabled,
                      ]}
                      onPress={() => mapRef.current?.undo()}
                      disabled={drawingVerticesCount === 0}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="arrow-undo-outline"
                        size={16}
                        color={drawingVerticesCount === 0 ? Palette.textLight : '#334155'}
                      />
                      <Text
                        style={[
                          styles.drawingActionText,
                          styles.drawingActionTextUndo,
                          drawingVerticesCount === 0 && styles.drawingActionTextDisabled,
                        ]}
                        weight="semibold"
                      >
                        Annuler
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.drawingActionBtn,
                        styles.drawingActionBtnClear,
                        drawingVerticesCount === 0 && styles.drawingActionBtnDisabled,
                      ]}
                      onPress={() => mapRef.current?.clear()}
                      disabled={drawingVerticesCount === 0}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={drawingVerticesCount === 0 ? Palette.textLight : '#DC2626'}
                      />
                      <Text
                        style={[
                          styles.drawingActionText,
                          styles.drawingActionTextClear,
                          drawingVerticesCount === 0 && styles.drawingActionTextDisabled,
                        ]}
                        weight="semibold"
                      >
                        Effacer
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.drawingActionBtn,
                        styles.drawingActionBtnFinish,
                        drawingVerticesCount < 4 && styles.drawingActionBtnFinishDisabled,
                      ]}
                      onPress={() => mapRef.current?.finish()}
                      disabled={drawingVerticesCount < 4}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={drawingVerticesCount < 4 ? Palette.textLight : '#FFFFFF'}
                      />
                      <Text
                        style={[
                          styles.drawingActionText,
                          styles.drawingActionTextFinish,
                          drawingVerticesCount < 4 && styles.drawingActionTextDisabled,
                        ]}
                        weight="bold"
                      >
                        Terminer
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {aoiMode === 'coords' && (
                <View style={styles.coordsEntryContainer}>
                  {/* Sub-mode selector: Bounding Box (Min/Max) vs Custom Vertices */}
                  <View style={styles.coordSubTabsRow}>
                    <TouchableOpacity
                      style={[styles.coordSubTabBtn, coordEntryType === 'bbox' && styles.coordSubTabBtnActive]}
                      onPress={() => setCoordEntryType('bbox')}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name="scan-outline"
                        size={14}
                        color={coordEntryType === 'bbox' ? Palette.primary : Palette.textMuted}
                      />
                      <Text
                        style={[styles.coordSubTabText, coordEntryType === 'bbox' && styles.coordSubTabTextActive]}
                        weight="semibold"
                      >
                        Rectangle Min / Max (Recommandé)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.coordSubTabBtn, coordEntryType === 'vertices' && styles.coordSubTabBtnActive]}
                      onPress={() => setCoordEntryType('vertices')}
                      activeOpacity={0.75}
                    >
                      <Ionicons
                        name="list-outline"
                        size={14}
                        color={coordEntryType === 'vertices' ? Palette.primary : Palette.textMuted}
                      />
                      <Text
                        style={[styles.coordSubTabText, coordEntryType === 'vertices' && styles.coordSubTabTextActive]}
                        weight="semibold"
                      >
                        Liste de Sommets
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {coordEntryType === 'bbox' ? (
                    <View style={styles.bboxContainer}>
                      <Text style={styles.coordsInputLabel} weight="bold">
                        Coordonnées de l'emprise rectangulaire (WGS 84 / EPSG:4326) :
                      </Text>
                      <Text style={styles.coordsInputHelp}>
                        Saisissez les bornes géographiques minimales et maximales pour cadrer la zone d'étude.
                      </Text>

                      <View style={styles.bboxGrid}>
                        {/* Minimum Longitude */}
                        <View style={styles.bboxInputCol}>
                          <Text style={styles.bboxFieldLabel}>Longitude Min</Text>
                          <TextInput
                            style={styles.bboxTextInput}
                            value={bboxMinLon}
                            onChangeText={setBboxMinLon}
                            placeholder="-5.7950"
                            placeholderTextColor="#94A3B8"
                            keyboardType="numeric"
                          />
                        </View>

                        {/* Minimum Latitude */}
                        <View style={styles.bboxInputCol}>
                          <Text style={styles.bboxFieldLabel}>Latitude Min</Text>
                          <TextInput
                            style={styles.bboxTextInput}
                            value={bboxMinLat}
                            onChangeText={setBboxMinLat}
                            placeholder="35.7450"
                            placeholderTextColor="#94A3B8"
                            keyboardType="numeric"
                          />
                        </View>

                        {/* Maximum Longitude */}
                        <View style={styles.bboxInputCol}>
                          <Text style={styles.bboxFieldLabel}>Longitude Max</Text>
                          <TextInput
                            style={styles.bboxTextInput}
                            value={bboxMaxLon}
                            onChangeText={setBboxMaxLon}
                            placeholder="-5.7800"
                            placeholderTextColor="#94A3B8"
                            keyboardType="numeric"
                          />
                        </View>

                        {/* Maximum Latitude */}
                        <View style={styles.bboxInputCol}>
                          <Text style={styles.bboxFieldLabel}>Latitude Max</Text>
                          <TextInput
                            style={styles.bboxTextInput}
                            value={bboxMaxLat}
                            onChangeText={setBboxMaxLat}
                            placeholder="35.7750"
                            placeholderTextColor="#94A3B8"
                            keyboardType="numeric"
                          />
                        </View>
                      </View>

                      <View style={styles.bboxActionsRow}>
                        <TouchableOpacity
                          style={styles.bboxApplyBtn}
                          onPress={handleApplyBboxAoi}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="checkmark-done" size={16} color="#FFFFFF" />
                          <Text style={styles.bboxApplyBtnText} weight="bold">
                            Appliquer le rectangle AOI
                          </Text>
                        </TouchableOpacity>

                        {Boolean(geojsonData) && (
                          <TouchableOpacity
                            style={styles.bboxAutofillBtn}
                            onPress={handleAutoFillBboxFromSource}
                            activeOpacity={0.75}
                          >
                            <Ionicons name="flash-outline" size={15} color="#0284C7" />
                            <Text style={styles.bboxAutofillBtnText} weight="semibold">
                              Ajuster à l'emprise du tracé
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ) : (
                    <View style={{ marginVertical: 8 }}>
                      <Text style={styles.coordsInputLabel} weight="bold">
                        Saisissez les sommets (Longitude, Latitude par ligne — min. 4 sommets) :
                      </Text>
                      <TextInput
                        style={styles.coordsTextInput}
                        multiline
                        numberOfLines={4}
                        value={manualCoordsText}
                        onChangeText={handleParseManualCoords}
                        placeholder="-6.88, 33.95&#10;-6.55, 34.30&#10;-6.50, 34.28&#10;-6.85, 33.92&#10;-6.88, 33.95"
                      />
                    </View>
                  )}
                </View>
              )}

              {/* Status Box */}
              <View style={styles.aoiStatusBox}>
                <View style={styles.aoiStatusHeader}>
                  <Ionicons
                    name={aoiCoordinates.length >= 4 ? 'checkmark-circle' : 'alert-circle'}
                    size={18}
                    color={aoiCoordinates.length >= 4 ? '#16A34A' : '#D97706'}
                  />
                  <Text style={styles.aoiStatusTitle} weight="bold">
                    {aoiCoordinates.length >= 4
                      ? `Zone d'étude définie (${aoiCoordinates.length} sommets valides)`
                      : `Zone d'étude incomplète (${aoiCoordinates.length}/4 sommets requis)`}
                  </Text>
                </View>
                {aoiCoordinates.length < 4 && (
                  <TouchableOpacity style={styles.sampleAoiBtn} onPress={handleUseSampleAOI}>
                    <Ionicons name="sparkles" size={14} color={Palette.primary} />
                    <Text style={styles.sampleAoiBtnText}>Utiliser une emprise exemple (4 sommets)</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* 3 — Valider la zone / Actions */}
            {isAoiRefineMode ? (
              <View style={styles.refineActionButtonsRow}>
                <TouchableOpacity
                  style={styles.refineCancelBtn}
                  onPress={handleCancelAoiRefinement}
                  disabled={isSavingAoi || isAnalyzing}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle-outline" size={18} color="#475569" />
                  <Text style={styles.refineCancelBtnText} weight="bold">
                    Annuler
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.refineValidateBtn,
                    aoiCoordinates.length < 4 && styles.refineValidateBtnDisabled,
                  ]}
                  onPress={handleValidateAoiRefinement}
                  disabled={aoiCoordinates.length < 4 || isSavingAoi || isAnalyzing}
                  activeOpacity={0.8}
                >
                  {isSavingAoi || isAnalyzing ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
                      <Text style={styles.refineValidateBtnText} weight="bold">
                        Valider l'affinement
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ marginTop: 16 }}>
                <Button
                  title="Analyser →"
                  variant="primary"
                  size="lg"
                  loading={isSavingAoi || isAnalyzing}
                  disabled={aoiCoordinates.length < 4}
                  onPress={handleSaveAoiAndAnalyze}
                />
              </View>
            )}
          </Card>
        )}

        {/* ── STEP 3: Spatial Analysis & Candidate Corridors ── */}
        {currentStep === 3 && analysisResult && (
          <Card variant="elevated" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadgeNum}>
                <Text style={styles.stepBadgeNumText}>ÉTAPE 3 / 7</Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                Analyse Spatiale & Classement des Corridors
              </Text>
              <Text style={styles.stepDescription}>
                {analysisResult.has_aoi
                  ? `Croisement spatial avec la Zone d'Étude. Seule la portion d'infrastructure située dans l'emprise sera retenue pour le chantier.`
                  : 'Infrastructure analysée sans zone d\'étude spécifique.'}
              </Text>

              {/* CRS Provenance Info Badge */}
              <View style={styles.crsProvenanceChip}>
                <Ionicons name="globe-outline" size={14} color={Palette.primary} />
                <Text style={styles.crsProvenanceText}>
                  Système : <Text weight="bold">{analysisResult.crs_info?.crs_name || 'WGS 84'}</Text> ({analysisResult.crs_info?.epsg_code || (analysisResult.source_srid ? `EPSG:${analysisResult.source_srid}` : 'EPSG:4326')}) ➔ Traité en WGS 84
                </Text>
              </View>
            </View>

            {/* Zero-Candidate Warning & Refine Banner */}
            {candidateCorridors.length === 0 && (
              <View style={styles.zeroCandidateBanner}>
                <View style={styles.zeroCandidateHeader}>
                  <Ionicons name="alert-circle" size={24} color="#DC2626" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.zeroCandidateTitle} weight="bold">
                      Aucun tracé linéaire n'intersecte la zone d'étude
                    </Text>
                    <Text style={styles.zeroCandidateSubtitle}>
                      Sur les {analysisResult.total_features} tracés détectés dans le fichier, aucun ne traverse l'emprise définie. Votre fichier spatial reste valide.
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.modifyAoiBtn}
                  onPress={handleStartAoiRefinement}
                  activeOpacity={0.8}
                >
                  <Ionicons name="create-outline" size={16} color="#DC2626" />
                  <Text style={styles.modifyAoiBtnText} weight="bold">
                    ✏️ Modifier / Redessiner la Zone d'Étude (AOI)
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Single-Candidate Confirmation Banner */}
            {candidateCorridors.length === 1 && selectedCorridor && (
              <View style={styles.singleCandidateBanner}>
                <View style={styles.singleCandidateHeader}>
                  <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.singleCandidateTitle} weight="bold">
                      1 seul tracé linéaire intersecte l'emprise !
                    </Text>
                    <Text style={styles.singleCandidateDesc}>
                      « {selectedCorridor.nom} » ({selectedCorridor.length_in_aoi_km} km dans l'AOI) est isolé comme axe unique de référence (sur {analysisResult.total_features} tracés au total).
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.refineAoiGhostBtn}
                  onPress={handleStartAoiRefinement}
                  activeOpacity={0.7}
                >
                  <Ionicons name="locate-outline" size={14} color="#64748B" />
                  <Text style={styles.refineAoiGhostText}>🔍 Affiner davantage l'AOI</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Multi-Candidate Selection & Refinement Banner */}
            {candidateCorridors.length > 1 && (
              <View style={styles.multiCandidateBanner}>
                <View style={styles.multiCandidateHeaderRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <Ionicons name="git-branch-outline" size={20} color="#D97706" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.multiCandidateTitle} weight="bold">
                        {candidateCorridors.length} tracés linéaires intersectent l'emprise (sur {analysisResult.total_features})
                      </Text>
                      <Text style={styles.multiCandidateSubtitle}>
                        Sélectionnez l'axe souhaité ci-dessous, ou affinez l'AOI pour isoler un tronçon précis.
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.refineAoiBtn}
                    onPress={handleStartAoiRefinement}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="locate-outline" size={15} color="#D97706" />
                    <Text style={styles.refineAoiBtnText} weight="semibold">
                      🔍 Affiner l'AOI
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Map with AOI and Candidate Corridors */}
            <View style={styles.mapWrapper}>
              <InteractiveGisMap
                aoiGeometry={analysisResult.aoi_geometry}
                kmlGeometry={kmlSourceGeometry}
                kmlSourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
                kmlMetadata={kmlMetadata}
                showKmlLayer={isKmlLayerVisible}
                onToggleKmlVisibility={setIsKmlLayerVisible}
                onSelectKml={(meta) => {
                  setSelectedKmlMetadata(meta);
                  setShowKmlInfoModal(true);
                }}
                kmlGroundOverlays={kmlMetadata?.groundOverlays || null}
                kmlPhotoOverlays={kmlMetadata?.photoOverlays || null}
                showKmlImages={isKmlImagesVisible}
                onToggleKmlImagesVisibility={setIsKmlImagesVisible}
                onSelectKmlImage={(overlay) => {
                  setSelectedKmlImage(overlay);
                  setShowKmlImageModal(true);
                }}
                corridors={mapCorridors}
                selectedCorridorId={selectedCorridor?.id}
                center={mapCenter}
                zoom={mapZoom}
                onSelectCorridor={(cId) => {
                  const target = analysisResult.candidate_corridors.find((c) => c.id === cId);
                  if (target) handleSelectCorridorWithAutoReveal(target);
                }}
                onInteractionChange={handleMapInteractionChange}
                height={260}
              />
            </View>

            {/* Candidate Corridors Filter Toolbar */}
            <View style={styles.corridorToolbar}>
              <View style={styles.corridorToolbarTop}>
                <Text style={styles.corridorsListTitle} weight="bold">
                  Tracés & Alignements ({filteredCorridors.length}
                  {filteredCorridors.length !== candidateCorridors.length ? ` / ${candidateCorridors.length}` : ''}) :
                </Text>

                {/* View mode toggle (Progressive vs Pages) */}
                <View style={styles.viewModeToggle}>
                  <TouchableOpacity
                    style={[styles.viewModeBtn, corridorViewMode === 'progressive' && styles.viewModeBtnActive]}
                    onPress={() => setCorridorViewMode('progressive')}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="list" size={12} color={corridorViewMode === 'progressive' ? '#FFFFFF' : Palette.textMuted} />
                    <Text style={[styles.viewModeBtnText, corridorViewMode === 'progressive' && styles.viewModeBtnTextActive]}>
                      Défilement
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.viewModeBtn, corridorViewMode === 'pages' && styles.viewModeBtnActive]}
                    onPress={() => { setCorridorViewMode('pages'); setCorridorPage(1); }}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="layers-outline" size={12} color={corridorViewMode === 'pages' ? '#FFFFFF' : Palette.textMuted} />
                    <Text style={[styles.viewModeBtnText, corridorViewMode === 'pages' && styles.viewModeBtnTextActive]}>
                      Pages
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Search & Filter Bar */}
              <View style={styles.corridorSearchRow}>
                <View style={styles.corridorSearchInputWrapper}>
                  <Ionicons name="search-outline" size={14} color={Palette.textMuted} />
                  <TextInput
                    style={styles.corridorSearchInput}
                    placeholder="Filtrer un tracé (ex: Axe 1)..."
                    placeholderTextColor={Palette.textLight}
                    value={corridorSearch}
                    onChangeText={(t) => { setCorridorSearch(t); setCorridorPage(1); }}
                  />
                  {Boolean(corridorSearch) && (
                    <TouchableOpacity onPress={() => { setCorridorSearch(''); setCorridorPage(1); }}>
                      <Ionicons name="close-circle" size={15} color={Palette.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Filter chips */}
                <View style={styles.corridorFilterChips}>
                  <TouchableOpacity
                    style={[styles.corridorChip, corridorFilter === 'all' && styles.corridorChipActive]}
                    onPress={() => { setCorridorFilter('all'); setCorridorPage(1); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.corridorChipText, corridorFilter === 'all' && styles.corridorChipTextActive]}>
                      Tous ({candidateCorridors.length})
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.corridorChip, corridorFilter === 'aoi' && styles.corridorChipActive]}
                    onPress={() => { setCorridorFilter('aoi'); setCorridorPage(1); }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.corridorChipText, corridorFilter === 'aoi' && styles.corridorChipTextActive]}>
                      Dans la Zone d'Étude ({aoiCorridorsCount})
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Empty filter message */}
            {filteredCorridors.length === 0 ? (
              <View style={styles.emptyCorridorBox}>
                <Ionicons name="search-outline" size={24} color={Palette.textMuted} />
                <Text style={styles.emptyCorridorText}>
                  Aucun tracé ne correspond à vos critères de recherche.
                </Text>
              </View>
            ) : (
              visibleCorridors.map((c) => {
                const isSelected = selectedCorridor?.id === c.id;
                const isRec = !!c.is_recommended;
                const intersects = !!c.intersects_aoi;

                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[
                      styles.corridorCard,
                      isSelected && styles.corridorCardActive,
                      isRec && styles.corridorCardRec,
                    ]}
                    onPress={() => setSelectedCorridor(c)}
                  >
                    <View style={styles.corridorCardHeader}>
                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={18}
                        color={isSelected ? Palette.primary : Palette.textMuted}
                      />
                      <Text style={styles.corridorName} weight="bold">
                        {c.nom} : {c.length_km} km au total
                      </Text>
                      {isRec && (
                        <View style={styles.recBadge}>
                          <Text style={styles.recBadgeText}>🏆 RECOMMANDÉ</Text>
                        </View>
                      )}
                    </View>

                    <View style={styles.corridorMetricsRow}>
                      <View style={styles.corridorMetricPill}>
                        <Text style={styles.corridorMetricPillLabel}>Dans la Zone d'Étude :</Text>
                        <Text style={styles.corridorMetricPillVal} weight="bold">
                          {c.length_in_aoi_km !== undefined ? `${c.length_in_aoi_km} km` : '—'} ({c.coverage_aoi_percent || 0}%)
                        </Text>
                      </View>

                      <View style={styles.corridorMetricPill}>
                        <Text style={styles.corridorMetricPillLabel}>Intersection AOI :</Text>
                        <Text
                          style={[
                            styles.corridorMetricPillVal,
                            { color: intersects ? '#16A34A' : '#DC2626' },
                          ]}
                          weight="bold"
                        >
                          {intersects ? '✅ Oui' : '❌ Non'}
                        </Text>
                      </View>
                    </View>

                    {c.recommendation_reason ? (
                      <Text style={styles.corridorReasonText}>
                        💡 {c.recommendation_reason}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            )}

            {/* Progressive Lazy Loading Controls */}
            {corridorViewMode === 'progressive' && filteredCorridors.length > 5 && (
              <View style={styles.corridorLazyActions}>
                {corridorDisplayLimit < filteredCorridors.length ? (
                  <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
                    <TouchableOpacity
                      style={styles.corridorLoadMoreBtn}
                      onPress={() => setCorridorDisplayLimit((prev) => Math.min(prev + 5, filteredCorridors.length))}
                      activeOpacity={0.75}
                    >
                      <Ionicons name="add-circle-outline" size={16} color={Palette.primary} />
                      <Text style={styles.corridorLoadMoreText} weight="semibold">
                        Afficher 5 de plus ({filteredCorridors.length - corridorDisplayLimit} restants)
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.corridorShowAllBtn}
                      onPress={() => setCorridorDisplayLimit(filteredCorridors.length)}
                      activeOpacity={0.75}
                    >
                      <Text style={styles.corridorShowAllText} weight="bold">Tout ({filteredCorridors.length})</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.corridorCollapseBtn}
                    onPress={() => setCorridorDisplayLimit(5)}
                    activeOpacity={0.75}
                  >
                    <Ionicons name="chevron-up" size={16} color={Palette.textMuted} />
                    <Text style={styles.corridorCollapseText} weight="semibold">
                      Réduire l'affichage aux 5 premiers
                    </Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.corridorCountSummary}>
                  Affichage de 1 à {Math.min(corridorDisplayLimit, filteredCorridors.length)} sur {filteredCorridors.length} tracés
                </Text>
              </View>
            )}

            {/* Pagination Controls */}
            {corridorViewMode === 'pages' && totalCorridorPages > 1 && (
              <View style={styles.corridorPaginationContainer}>
                <View style={styles.corridorPaginationRow}>
                  <TouchableOpacity
                    style={[styles.corridorPageNavBtn, corridorPage === 1 && styles.corridorPageNavBtnDisabled]}
                    onPress={() => setCorridorPage((p) => Math.max(1, p - 1))}
                    disabled={corridorPage === 1}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-back" size={16} color={corridorPage === 1 ? Palette.textLight : Palette.primary} />
                    <Text style={[styles.corridorPageNavText, corridorPage === 1 && styles.corridorPageNavTextDisabled]}>
                      Précédent
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.corridorPageNumbers}>
                    {Array.from({ length: totalCorridorPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalCorridorPages || Math.abs(p - corridorPage) <= 1)
                      .map((p, idx, arr) => {
                        const isCurrent = p === corridorPage;
                        const prevVal = arr[idx - 1];
                        const showEllipsis = prevVal && p - prevVal > 1;

                        return (
                          <React.Fragment key={p}>
                            {showEllipsis && <Text style={styles.corridorEllipsis}>…</Text>}
                            <TouchableOpacity
                              style={[styles.corridorPageNumPill, isCurrent && styles.corridorPageNumPillActive]}
                              onPress={() => setCorridorPage(p)}
                              activeOpacity={0.75}
                            >
                              <Text
                                style={[styles.corridorPageNumText, isCurrent && styles.corridorPageNumTextActive]}
                                weight={isCurrent ? 'bold' : 'medium'}
                              >
                                {p}
                              </Text>
                            </TouchableOpacity>
                          </React.Fragment>
                        );
                      })}
                  </View>

                  <TouchableOpacity
                    style={[styles.corridorPageNavBtn, corridorPage >= totalCorridorPages && styles.corridorPageNavBtnDisabled]}
                    onPress={() => setCorridorPage((p) => Math.min(totalCorridorPages, p + 1))}
                    disabled={corridorPage >= totalCorridorPages}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.corridorPageNavText, corridorPage >= totalCorridorPages && styles.corridorPageNavTextDisabled]}>
                      Suivant
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={corridorPage >= totalCorridorPages ? Palette.textLight : Palette.primary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.corridorCountSummary}>
                  Page {corridorPage} sur {totalCorridorPages} • {filteredCorridors.length} tracés au total
                </Text>
              </View>
            )}

            {candidateCorridors.length > 0 ? (
              <Button
                title={`Valider cet Alignement (${selectedCorridor ? selectedCorridor.nom : ''}) →`}
                variant="primary"
                size="lg"
                loading={isUploading}
                disabled={!selectedCorridor}
                onPress={handleConfirmReferenceAlignment}
                style={{ marginTop: 18 }}
              />
            ) : (
              <Button
                title="✏️ Modifier la Zone d'Étude (AOI) pour sélectionner un tracé"
                variant="outline"
                size="lg"
                onPress={handleStartAoiRefinement}
                style={{ marginTop: 18 }}
              />
            )}
          </Card>
        )}

        {/* ── STEP 4: Direction Inversion & PK 0+000 Origin ── */}
        {currentStep === 4 && referenceAlignment && (
          <Card variant="elevated" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadgeNum}>
                <Text style={styles.stepBadgeNumText}>ÉTAPE 4 / 7</Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                Validation de l'Alignement & Direction PK 0+000
              </Text>
              <Text style={styles.stepDescription}>
                Contrôlez l'orientation du tracé. Le point kilométrique PK 0+000 est positionné au point d'entrée du linéaire dans la zone d'étude.
              </Text>

              {Boolean(kmlMetadata) && (
                <TouchableOpacity
                  style={styles.kmlStepActionBtn}
                  onPress={() => {
                    setSelectedKmlMetadata(kmlMetadata);
                    setShowKmlInfoModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="information-circle-outline" size={14} color="#EA580C" />
                  <Text style={styles.kmlStepActionText} weight="semibold">
                    Métadonnées KML
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.mapWrapper}>
              <InteractiveGisMap
                aoiGeometry={savedAoiGeometry}
                referenceGeometry={referenceAlignment.geometry}
                kmlGeometry={kmlSourceGeometry}
                kmlSourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
                kmlMetadata={kmlMetadata}
                showKmlLayer={isKmlLayerVisible}
                onToggleKmlVisibility={setIsKmlLayerVisible}
                onSelectKml={(meta) => {
                  setSelectedKmlMetadata(meta);
                  setShowKmlInfoModal(true);
                }}
                kmlGroundOverlays={kmlMetadata?.groundOverlays || null}
                kmlPhotoOverlays={kmlMetadata?.photoOverlays || null}
                showKmlImages={isKmlImagesVisible}
                onToggleKmlImagesVisibility={setIsKmlImagesVisible}
                onSelectKmlImage={(overlay) => {
                  setSelectedKmlImage(overlay);
                  setShowKmlImageModal(true);
                }}
                center={mapCenter}
                zoom={mapZoom}
                onInteractionChange={handleMapInteractionChange}
                height={220}
              />
            </View>

            {/* Visual Direction & Orientation Legend */}
            <View style={styles.directionLegendBox}>
              <Text style={styles.directionLegendTitle}>LÉGENDE DE DIRECTION DU LINÉAIRE</Text>
              <View style={styles.directionLegendRow}>
                <View style={styles.directionLegendItem}>
                  <View style={[styles.directionLegendDot, { backgroundColor: '#16A34A' }]} />
                  <Text style={styles.directionLegendText} weight="bold">
                    🟢 Début (PK 0+000)
                  </Text>
                </View>

                <View style={styles.directionLegendItem}>
                  <View style={styles.directionArrowBadge}>
                    <Ionicons name="arrow-forward" size={13} color="#0284C7" />
                  </View>
                  <Text style={styles.directionLegendText}>Sens Croissant</Text>
                </View>

                <View style={styles.directionLegendItem}>
                  <View style={[styles.directionLegendDot, { backgroundColor: '#DC2626' }]} />
                  <Text style={styles.directionLegendText} weight="bold">
                    🔴 Fin ({referenceAlignment.length_km} km)
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Longueur du Chantier</Text>
                <Text style={styles.metricValue} weight="bold">
                  {referenceAlignment.length_km} km
                </Text>
                <Text style={styles.metricSub}>Calculée automatiquement sur la géométrie courbe • {Number(referenceAlignment.length_meters).toLocaleString()} m</Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Orientation Chaînage</Text>
                <Text
                  style={[styles.metricValue, { color: isReversed ? '#D97706' : '#16A34A', fontSize: 13 }]}
                  weight="bold"
                >
                  {isReversed ? 'Sens Inversé' : 'Sens Standard'}
                </Text>
                <Text style={styles.metricSub}>
                  {isReversed ? 'Inversé via ST_Reverse' : 'Direct'}
                </Text>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Projection Source</Text>
                <Text style={[styles.metricValue, { fontSize: 12.5 }]} weight="bold" numberOfLines={1}>
                  {referenceAlignment.source_crs_name || 'WGS 84'}
                </Text>
                <Text style={styles.metricSub}>
                  {referenceAlignment.source_srid ? `EPSG:${referenceAlignment.source_srid}` : 'EPSG:4326'}
                </Text>
              </View>
            </View>

            {/* Invert Direction Action */}
            <TouchableOpacity
              style={[styles.directionToggleBtn, isReversed && styles.directionToggleBtnActive]}
              onPress={handleToggleDirection}
              disabled={isTogglingDirection}
            >
              <Ionicons name="swap-horizontal" size={18} color={isReversed ? '#FFFFFF' : Palette.primary} />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.directionToggleText, isReversed && { color: '#FFFFFF' }]}
                  weight="semibold"
                >
                  {isReversed ? 'Direction Inversée' : 'Inverser la direction du tracé (ST_Reverse)'}
                </Text>
                <Text
                  style={[styles.directionToggleSub, isReversed && { color: 'rgba(255,255,255,0.85)' }]}
                >
                  Inverse physiquement les sommets pour que PK 0+000 débute à l'autre extrémité.
                </Text>
              </View>
              {isTogglingDirection && <ActivityIndicator size="small" color="#FFFFFF" />}
            </TouchableOpacity>

            <Button
              title="Passer au Découpage des Tronçons →"
              variant="primary"
              size="lg"
              onPress={() => setCurrentStep(5)}
              style={{ marginTop: 16 }}
            />
          </Card>
        )}

        {/* ── STEP 5: Choose Tronçon Count or Target Length ── */}
        {currentStep === 5 && (
          <Card variant="elevated" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadgeNum}>
                <Text style={styles.stepBadgeNumText}>ÉTAPE 5 / 7</Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                Paramètres de Découpage Linéaire
              </Text>
              <Text style={styles.stepDescription}>
                Définissez la granularité de découpage le long du linéaire du chantier ({referenceAlignment?.length_km || 0} km).
              </Text>
            </View>

            <View style={styles.segModeToggle}>
              <TouchableOpacity
                style={[styles.segModeBtn, segMode === 'count' && styles.segModeBtnActive]}
                onPress={() => setSegMode('count')}
              >
                <Ionicons
                  name="grid-outline"
                  size={16}
                  color={segMode === 'count' ? '#FFFFFF' : Palette.textMuted}
                />
                <Text
                  style={[styles.segModeText, segMode === 'count' && styles.segModeTextActive]}
                  weight="semibold"
                >
                  Par Nombre de Tronçons
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.segModeBtn, segMode === 'length' && styles.segModeBtnActive]}
                onPress={() => setSegMode('length')}
              >
                <Ionicons
                  name="resize-outline"
                  size={16}
                  color={segMode === 'length' ? '#FFFFFF' : Palette.textMuted}
                />
                <Text
                  style={[styles.segModeText, segMode === 'length' && styles.segModeTextActive]}
                  weight="semibold"
                >
                  Par Longueur Cible (km)
                </Text>
              </TouchableOpacity>
            </View>

            {segMode === 'count' ? (
              <View style={styles.stepperControlContainer}>
                <Text style={styles.stepperControlLabel} weight="bold">
                  Nombre de tronçons :
                </Text>
                <View style={styles.stepperBox}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setTronconCount((prev) => Math.max(1, prev - 1))}
                    disabled={tronconCount <= 1}
                  >
                    <Ionicons
                      name="remove"
                      size={20}
                      color={tronconCount <= 1 ? Palette.textMuted : Palette.text}
                    />
                  </TouchableOpacity>

                  <View style={styles.stepperNumberDisplay}>
                    <Text style={styles.stepperNumberText} weight="bold">
                      {tronconCount}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setTronconCount((prev) => Math.min(25, prev + 1))}
                    disabled={tronconCount >= 25}
                  >
                    <Ionicons
                      name="add"
                      size={20}
                      color={tronconCount >= 25 ? Palette.textMuted : Palette.text}
                    />
                  </TouchableOpacity>
                </View>

                {referenceAlignment?.length_km ? (
                  <Text style={styles.calcHint}>
                    📐 Résultat estimé : ~{(referenceAlignment.length_km / tronconCount).toFixed(2)} km / tronçon.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={{ marginVertical: 10 }}>
                <Input
                  label="Longueur cible par tronçon (en kilomètres)"
                  placeholder="ex: 2.5"
                  value={targetLengthKm}
                  onChangeText={setTargetLengthKm}
                  keyboardType="numeric"
                  leftIcon={<Ionicons name="speedometer-outline" size={20} color={Palette.textMuted} />}
                />
                {referenceAlignment?.length_km && parseFloat(targetLengthKm) > 0 ? (
                  <Text style={styles.calcHint}>
                    📐 Découpage estimé en ~
                    {Math.max(1, Math.round(referenceAlignment.length_km / (parseFloat(targetLengthKm) || 1)))}{' '}
                    tronçons.
                  </Text>
                ) : null}
              </View>
            )}

            <Button
              title="Générer les Tronçons du Chantier →"
              variant="primary"
              size="lg"
              loading={isGenerating}
              onPress={handleGenerateTroncons}
              style={{ marginTop: 20 }}
            />
          </Card>
        )}

        {/* ── STEP 6: Review & "Modifier le Découpage" ── */}
        {currentStep === 6 && editableTroncons.length > 0 && (
          <Card variant="elevated" style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadgeNum}>
                <Text style={styles.stepBadgeNumText}>ÉTAPE 6 / 7</Text>
              </View>
              <Text variant="h2" style={styles.stepTitle}>
                Vérification et Validation des Tronçons
              </Text>
              <Text style={styles.stepDescription}>
                {editableTroncons.length} tronçons calculés le long de la portion d'infrastructure située dans la zone d'étude.
              </Text>

              {Boolean(kmlMetadata) && (
                <TouchableOpacity
                  style={styles.kmlStepActionBtn}
                  onPress={() => {
                    setSelectedKmlMetadata(kmlMetadata);
                    setShowKmlInfoModal(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="information-circle-outline" size={14} color="#EA580C" />
                  <Text style={styles.kmlStepActionText} weight="semibold">
                    Métadonnées KML
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.mapWrapper}>
              <InteractiveGisMap
                aoiGeometry={savedAoiGeometry}
                referenceGeometry={referenceAlignment?.geometry}
                kmlGeometry={kmlSourceGeometry}
                kmlSourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
                kmlMetadata={kmlMetadata}
                showKmlLayer={isKmlLayerVisible}
                onToggleKmlVisibility={setIsKmlLayerVisible}
                onSelectKml={(meta) => {
                  setSelectedKmlMetadata(meta);
                  setShowKmlInfoModal(true);
                }}
                kmlGroundOverlays={kmlMetadata?.groundOverlays || null}
                kmlPhotoOverlays={kmlMetadata?.photoOverlays || null}
                showKmlImages={isKmlImagesVisible}
                onToggleKmlImagesVisibility={setIsKmlImagesVisible}
                onSelectKmlImage={(overlay) => {
                  setSelectedKmlImage(overlay);
                  setShowKmlImageModal(true);
                }}
                troncons={mapTroncons}
                center={mapCenter}
                zoom={mapZoom}
                onInteractionChange={handleMapInteractionChange}
                height={230}
              />
            </View>

            {/* Spatial Recalculation & Chainage Status */}
            {isRecalculatingSpatial ? (
              <View style={styles.recalcStatusBox}>
                <ActivityIndicator size="small" color={Palette.primary} />
                <Text style={styles.recalcStatusText}>
                  Recalcul spatial PostGIS (ST_LineSubstring) en cours...
                </Text>
              </View>
            ) : chainageValidation.isValid ? (
              <View style={styles.validStatusBox}>
                <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
                <Text style={styles.validStatusText} weight="semibold">
                  Chaînage linéaire continu et valide (PK {editableTroncons[0]?.pk_debut} ➔ PK {editableTroncons[editableTroncons.length - 1]?.pk_fin})
                </Text>
              </View>
            ) : (
              <View style={styles.invalidStatusBox}>
                <Ionicons name="alert-circle" size={16} color="#DC2626" />
                <Text style={styles.invalidStatusText} weight="semibold">
                  {chainageValidation.error}
                </Text>
              </View>
            )}

            {/* Edit Cut Button */}
            <View style={styles.editCutBar}>
              <Text style={styles.editCutTitle} weight="bold">
                Tronçons Segmentés ({editableTroncons.length})
              </Text>
              <Button
                title={isEditingCut ? '✓ Valider ajustements' : '✏️ Modifier le découpage'}
                variant={isEditingCut ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => setIsEditingCut(!isEditingCut)}
              />
            </View>

            {editableTroncons.map((t, idx) => (
              <View key={idx} style={styles.tronconRow}>
                <View style={styles.tronconHeaderRow}>
                  <View style={styles.tronconDot} />
                  {isEditingCut ? (
                    <TextInput
                      style={styles.tronconNameInput}
                      value={t.nom}
                      onChangeText={(val) => handleUpdateTronconName(idx, val)}
                    />
                  ) : (
                    <Text style={styles.tronconName} weight="bold">
                      {t.nom}
                    </Text>
                  )}
                  <Text style={styles.tronconLength}>{t.length_km} km</Text>
                </View>

                {isEditingCut ? (
                  <View style={styles.pkEditRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pkEditLabel}>PK Début (km)</Text>
                      <TextInput
                        style={styles.pkInput}
                        value={String(t.pk_debut)}
                        keyboardType="numeric"
                        editable={idx > 0} // PK 0+000 must start at 0
                        onChangeText={(val) => handleUpdateTronconPKs(idx, parseFloat(val) || 0, t.pk_fin)}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pkEditLabel}>PK Fin (km)</Text>
                      <TextInput
                        style={styles.pkInput}
                        value={String(t.pk_fin)}
                        keyboardType="numeric"
                        onChangeText={(val) => handleUpdateTronconPKs(idx, t.pk_debut, parseFloat(val) || 0)}
                      />
                    </View>
                  </View>
                ) : (
                  <Text style={styles.tronconPk}>
                    Bornes : {formatPK(t.pk_debut, isReversed)} &rarr; {formatPK(t.pk_fin, isReversed)}
                  </Text>
                )}
              </View>
            ))}

            <Button
              title={
                !chainageValidation.isValid
                  ? 'Chaînage invalide'
                  : isRecalculatingSpatial
                  ? 'Calcul spatial en cours...'
                  : 'Enregistrer et Valider le GIS ✓'
              }
              variant="primary"
              size="lg"
              loading={isSaving}
              disabled={!chainageValidation.isValid || isRecalculatingSpatial}
              onPress={handleSaveTroncons}
              style={{ marginTop: 20 }}
            />
          </Card>
        )}

        {/* ── STEP 7: Success ── */}
        {currentStep === 7 && saveSuccess && (
          <Card variant="elevated" style={styles.successCard}>
            <Ionicons name="checkmark-circle" size={48} color="#16A34A" />
            <Text style={styles.successTitle} weight="bold">
              {isMultiFlow && currentNum < totalNum
                ? `Chantier ${currentNum} sur ${totalNum} Validé !`
                : isMultiFlow
                ? 'Tous les chantiers ont été configurés !'
                : 'Configuration GIS Enregistrée !'}
            </Text>
            <Text style={styles.successSubtitle}>
              {isMultiFlow && currentNum < totalNum
                ? `Le chantier "${chantier?.nom}" et ses ${editableTroncons.length} tronçons ont été enregistrés avec succès. Vous pouvez maintenant passer à la configuration du chantier suivant.`
                : isMultiFlow
                ? `Les ${totalNum} chantiers du projet sont maintenant délimités, dotés de leurs axes de référence et découpés en leurs propres tronçons.`
                : `Le chantier "${chantier?.nom}" dispose maintenant de son emprise spatiale (AOI), de son axe de référence et de ses ${editableTroncons.length} tronçons calibrés.`}
            </Text>
            <View style={{ gap: 10, marginTop: 16 }}>
              {isMultiFlow && currentNum < totalNum ? (
                <>
                  <Button
                    title={`Passer au Chantier ${currentNum + 1} sur ${totalNum} →`}
                    variant="primary"
                    size="lg"
                    onPress={async () => {
                      const pId = projectId || (chantier?.projet_id ? String(chantier.projet_id) : undefined);
                      if (!pId) return;
                      try {
                        if (token) {
                          const pRes = await api.getProjectDetails(token, pId);
                          const chantiers = pRes.project.chantiers || [];
                          const nextIndex = currentNum; // 0-based index: Chantier 1 is 0, Chantier 2 is 1
                          const nextChantier =
                            chantiers[nextIndex] ||
                            chantiers.find((c, idx) => idx === nextIndex || c.nom === `Chantier ${currentNum + 1}`);
                          if (nextChantier) {
                            router.replace(
                              `/responsable/chantier/${nextChantier.id}/gis?current=${currentNum + 1}&total=${totalNum}&projectId=${pId}` as any
                            );
                            return;
                          }
                        }
                      } catch (navErr) {
                        console.warn('Erreur navigation prochain chantier:', navErr);
                      }
                      // Fallback
                      router.replace(
                        `/responsable/projet/${pId}/chantier/create?current=${currentNum + 1}&total=${totalNum}` as any
                      );
                    }}
                  />
                  <Button
                    title="Consulter la liste des chantiers du projet"
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      const pId = projectId || (chantier?.projet_id ? String(chantier.projet_id) : undefined);
                      router.replace(`/responsable/projet/${pId}` as any);
                    }}
                  />
                </>
              ) : (
                <>
                  <Button
                    title="Voir la liste des chantiers du projet →"
                    variant="primary"
                    size="lg"
                    onPress={() => {
                      const pId = projectId || (chantier?.projet_id ? String(chantier.projet_id) : undefined);
                      router.replace(
                        pId
                          ? `/responsable/projet/${pId}`
                          : `/responsable/chantier/${chantierId}` as any
                      );
                    }}
                  />
                  <Button
                    title="🗺️ Visualiser sur la carte"
                    variant="secondary"
                    size="md"
                    onPress={() => {
                      const pId = projectId || (chantier?.projet_id ? String(chantier.projet_id) : undefined);
                      router.replace({
                        pathname: '/(tabs)/map',
                        params: {
                          chantierId: String(chantierId),
                          projectId: pId,
                        },
                      } as any);
                    }}
                  />
                  <Button
                    title="Consulter les détails de ce Chantier"
                    variant="ghost"
                    size="sm"
                    onPress={() => router.replace(`/responsable/chantier/${chantierId}` as any)}
                  />
                </>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
        </>
      )}

      {/* ── Advanced Manual CRS Selection Modal ── */}
      <Modal
        visible={showCrsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCrsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.crsModalContainer}>
            <View style={styles.crsModalHeader}>
              <View>
                <Text variant="h2" style={styles.crsModalTitle} weight="bold">
                  Sélection du Système de Coordonnées (CRS)
                </Text>
                <Text style={{ fontSize: 11.5, color: Palette.textMuted }}>
                  Choisissez la projection spatiale du fichier importé
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowCrsModal(false)}
                style={styles.crsModalCloseBtn}
              >
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.crsModalSearchInput}
              placeholder="Rechercher une projection (ex: Merchich, 26191, Nord, Sud, 4326)..."
              placeholderTextColor={Palette.textLight}
              value={crsSearchQuery}
              onChangeText={setCrsSearchQuery}
            />

            <ScrollView style={styles.crsModalScroll} showsVerticalScrollIndicator={false}>
              {(supportedCrsList.length > 0
                ? supportedCrsList
                : [
                    { srid: 4326, code: 'EPSG:4326', name: 'WGS 84 (GPS / Degrés décimaux)', description: 'Coordonnées géographiques mondiales standards', type: 'geographic', unit: 'degrees' },
                    { srid: 26191, code: 'EPSG:26191', name: 'Merchich / Nord Maroc (Zone 1)', description: 'Rabat, Casablanca, Kenitra, Tanger, Oujda, Fes, Meknes', zone_label: 'Nord Maroc (lat >= 31.5°N)', type: 'projected', unit: 'metres' },
                    { srid: 26192, code: 'EPSG:26192', name: 'Merchich / Sud Maroc (Zone 2)', description: 'Marrakech, Agadir, Ouarzazate, Safi, Souss', zone_label: 'Sud Maroc (27.6°N - 32.5°N)', type: 'projected', unit: 'metres' },
                    { srid: 26194, code: 'EPSG:26194', name: 'Merchich / Sahara Nord (Zone 3)', description: 'Laâyoune, Smara, Boujdour, Tarfaya, Tan-Tan', zone_label: 'Sahara Nord (24.0°N - 27.7°N)', type: 'projected', unit: 'metres' },
                    { srid: 26195, code: 'EPSG:26195', name: 'Merchich / Sahara Sud (Zone 4)', description: 'Dakhla, Aousserd, Lagouira', zone_label: 'Sahara Sud (20.8°N - 24.2°N)', type: 'projected', unit: 'metres' },
                    { srid: 3857, code: 'EPSG:3857', name: 'WGS 84 / Pseudo-Mercator', description: 'Projection Web Mercator (Google Maps, OSM)', type: 'projected', unit: 'metres' },
                  ]
              )
                .filter((c) => {
                  if (!crsSearchQuery.trim()) return true;
                  const q = crsSearchQuery.toLowerCase();
                  return (
                    c.name.toLowerCase().includes(q) ||
                    c.code.toLowerCase().includes(q) ||
                    (c.description && c.description.toLowerCase().includes(q)) ||
                    (c.zone_label && c.zone_label.toLowerCase().includes(q)) ||
                    String(c.srid).includes(q)
                  );
                })
                .map((crs) => {
                  const isSelected = selectedCrsSrid === crs.srid;
                  return (
                    <TouchableOpacity
                      key={crs.srid}
                      style={[styles.crsModalItem, isSelected && styles.crsModalItemActive]}
                      onPress={() => {
                        setSelectedCrsSrid(crs.srid);
                        if (crsDetection) {
                          setCrsDetection({
                            ...crsDetection,
                            detected_srid: crs.srid,
                            crs_name: crs.name,
                            epsg_code: crs.code,
                            unit: crs.unit,
                            confidence: 'HIGH',
                            is_ambiguous: false,
                          });
                        }
                        setShowCrsModal(false);
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.crsModalItemTitle} weight={isSelected ? 'bold' : 'medium'}>
                          {crs.name}
                        </Text>
                        <Text style={styles.crsModalItemSub}>{crs.description}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', marginLeft: 10 }}>
                        <Text style={styles.crsModalItemCode}>{crs.code}</Text>
                        <Ionicons
                          name={isSelected ? 'checkmark-circle' : 'chevron-forward'}
                          size={18}
                          color={isSelected ? '#16A34A' : Palette.textMuted}
                          style={{ marginTop: 4 }}
                        />
                      </View>
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── AOI Overlap Conflict Resolution Modal ── */}
      <Modal
        visible={showConflictModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowConflictModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.conflictModalContainer}>
            <View style={styles.conflictModalHeader}>
              <View style={styles.conflictModalIconWrap}>
                <Ionicons name="warning" size={24} color="#DC2626" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h2" style={styles.conflictModalTitle} weight="bold">
                  Zone en Conflit
                </Text>
                <Text style={styles.conflictModalSubtitle}>
                  Chevauchement d'emprise spatiale détecté
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowConflictModal(false)}
                style={styles.crsModalCloseBtn}
              >
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <View style={styles.conflictBanner}>
                <Text style={styles.conflictBannerText}>
                  {conflictData.length === 1
                    ? `Cette zone chevauche le ${conflictData[0].chantierName}. Les zones des chantiers provenant du même fichier d'infrastructure ne peuvent pas se chevaucher.`
                    : `Cette zone chevauche ${conflictData.length} chantiers existants du même projet. Les zones des chantiers provenant du même fichier d'infrastructure ne peuvent pas se chevaucher.`}
                </Text>
              </View>

              <Text style={styles.conflictListHeading} weight="bold">
                CHANTIERS EN CONFLIT :
              </Text>

              {conflictData.map((conf) => (
                <View key={conf.chantierId} style={styles.conflictItemCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.conflictItemName} weight="bold">
                      🏢 {conf.chantierName}
                    </Text>
                    <Text style={styles.conflictItemArea}>
                      Surface de chevauchement :{' '}
                      <Text weight="semibold" style={{ color: '#DC2626' }}>
                        {Number(conf.overlapAreaM2 || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} m²
                      </Text>
                    </Text>
                  </View>
                  <Button
                    title={`Reconfigurer ${conf.chantierName}`}
                    variant="outline"
                    size="sm"
                    onPress={() => {
                      setShowConflictModal(false);
                      router.push(`/responsable/chantier/${conf.chantierId}/gis` as any);
                    }}
                  />
                </View>
              ))}

              <Text style={styles.conflictHelpNotice}>
                Deux chantiers contigus peuvent partager une limite commune (sommet ou segment mitoyen), mais ne doivent pas empiéter l'un sur l'autre.
              </Text>
            </ScrollView>

            <View style={styles.conflictModalFooter}>
              <Button
                title={`Modifier le chantier actuel (${chantier?.nom || 'Chantier'})`}
                variant="primary"
                size="md"
                onPress={() => setShowConflictModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── LEVEL 3 KML METADATA INFORMATION MODAL ── */}
      <Modal
        visible={showKmlInfoModal && !!selectedKmlMetadata}
        transparent
        animationType="fade"
        onRequestClose={() => setShowKmlInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.kmlModalContainer}>
            {/* Header */}
            <View style={styles.kmlModalHeader}>
              <View style={styles.kmlModalIconWrap}>
                <Ionicons name="map" size={22} color="#F97316" />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.kmlModalBadgeText}>INFORMATION KML</Text>
                  <View style={styles.kmlSourceTag}>
                    <Text style={styles.kmlSourceTagText}>Niveau 3 — 2D</Text>
                  </View>
                </View>
                <Text variant="h2" style={styles.kmlModalTitle} weight="bold" numberOfLines={1}>
                  {selectedKmlMetadata?.name || 'Tracé KML'}
                </Text>
                <Text style={styles.kmlModalSubtitle}>
                  Calque contextuel de visualisation 2D
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowKmlInfoModal(false)}
                style={styles.crsModalCloseBtn}
              >
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {/* Scrollable Metadata Details */}
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {/* General Info Section */}
              <View style={styles.kmlSection}>
                <Text style={styles.kmlSectionTitle}>IDENTIFICATION & GÉOMÉTRIE</Text>
                
                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Nom :</Text>
                  <Text style={styles.kmlInfoValue} weight="bold">
                    {selectedKmlMetadata?.name || '—'}
                  </Text>
                </View>

                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Source :</Text>
                  <Text style={styles.kmlInfoValue}>KML (Keyhole Markup Language)</Text>
                </View>

                <View style={styles.kmlInfoRow}>
                  <Text style={styles.kmlInfoLabel}>Système (CRS) :</Text>
                  <Text style={styles.kmlInfoValue}>EPSG:4326 (WGS 84)</Text>
                </View>

                {Boolean(selectedKmlMetadata?.documentName) && (
                  <View style={styles.kmlInfoRow}>
                    <Text style={styles.kmlInfoLabel}>Document :</Text>
                    <Text style={styles.kmlInfoValue}>{selectedKmlMetadata?.documentName}</Text>
                  </View>
                )}

                {Boolean(selectedKmlMetadata?.folders && selectedKmlMetadata.folders.length > 0) && (
                  <View style={styles.kmlInfoRow}>
                    <Text style={styles.kmlInfoLabel}>Dossier :</Text>
                    <Text style={styles.kmlInfoValue}>{selectedKmlMetadata?.folders?.join(' ❯ ')}</Text>
                  </View>
                )}

                {Boolean(selectedKmlMetadata?.description) && (
                  <View style={styles.kmlInfoRowColumn}>
                    <Text style={styles.kmlInfoLabel}>Description :</Text>
                    <Text style={styles.kmlDescriptionBox}>{selectedKmlMetadata?.description}</Text>
                  </View>
                )}
              </View>

              {/* Style Section */}
              {(Boolean(selectedKmlMetadata?.styleUrl) || Boolean(selectedKmlMetadata?.styles)) && (
                <View style={styles.kmlSection}>
                  <Text style={styles.kmlSectionTitle}>STYLE KML</Text>
                  
                  {Boolean(selectedKmlMetadata?.styleUrl) && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Référence (styleUrl) :</Text>
                      <Text style={[styles.kmlInfoValue, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' }]}>
                        {selectedKmlMetadata?.styleUrl}
                      </Text>
                    </View>
                  )}

                  {selectedKmlMetadata?.styles?.line?.color && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Couleur de ligne :</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <View style={[styles.kmlColorSwatch, { backgroundColor: '#' + (selectedKmlMetadata.styles.line.color.length === 8 ? selectedKmlMetadata.styles.line.color.slice(6, 8) + selectedKmlMetadata.styles.line.color.slice(4, 6) + selectedKmlMetadata.styles.line.color.slice(2, 4) : 'F97316') }]} />
                        <Text style={styles.kmlInfoValue}>
                          {selectedKmlMetadata.styles.line.color} (KML AABBGGRR)
                        </Text>
                      </View>
                    </View>
                  )}

                  {selectedKmlMetadata?.styles?.line?.width !== undefined && selectedKmlMetadata?.styles?.line?.width !== null && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Épaisseur (width) :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlMetadata.styles.line.width} px</Text>
                    </View>
                  )}

                  {selectedKmlMetadata?.styles?.styleMap && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>StyleMap ID :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlMetadata.styles.styleMap.id}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* ExtendedData Section */}
              {Boolean(selectedKmlMetadata?.extendedData && Object.keys(selectedKmlMetadata.extendedData).length > 0) && (
                <View style={styles.kmlSection}>
                  <Text style={styles.kmlSectionTitle}>DONNÉES ÉTENDUES (EXTENDEDDATA)</Text>
                  <View style={styles.kmlExtDataTable}>
                    {Object.entries(selectedKmlMetadata!.extendedData!).map(([key, value]) => (
                      <View key={key} style={styles.kmlExtDataRow}>
                        <Text style={styles.kmlExtDataKey} weight="semibold">{key}</Text>
                        <Text style={styles.kmlExtDataVal}>{String(value)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Temporal Data Section */}
              {Boolean(selectedKmlMetadata?.time) && (
                <View style={styles.kmlSection}>
                  <Text style={styles.kmlSectionTitle}>MÉTADONNÉES TEMPORELLES</Text>
                  {selectedKmlMetadata?.time?.type === 'timestamp' && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Horodatage (TimeStamp) :</Text>
                      <Text style={styles.kmlInfoValue}>{selectedKmlMetadata.time.when || '—'}</Text>
                    </View>
                  )}
                  {selectedKmlMetadata?.time?.type === 'timespan' && (
                    <View style={styles.kmlInfoRow}>
                      <Text style={styles.kmlInfoLabel}>Période (TimeSpan) :</Text>
                      <Text style={styles.kmlInfoValue}>
                        {selectedKmlMetadata.time.begin || '—'} ➔ {selectedKmlMetadata.time.end || '—'}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Generator Info */}
              {Boolean(selectedKmlMetadata?.generator) && (
                <View style={styles.kmlSection}>
                  <Text style={styles.kmlSectionTitle}>PROVENANCE LOGICIELLE</Text>
                  <View style={styles.kmlInfoRow}>
                    <Text style={styles.kmlInfoLabel}>Générateur :</Text>
                    <Text style={styles.kmlInfoValue} weight="semibold">
                      {selectedKmlMetadata?.generator}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.kmlModalFooter}>
              <TouchableOpacity
                style={[styles.kmlModalToggleBtn, !isKmlLayerVisible && styles.kmlModalToggleBtnOff]}
                onPress={() => setIsKmlLayerVisible(!isKmlLayerVisible)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isKmlLayerVisible ? "eye-off-outline" : "eye-outline"}
                  size={16}
                  color={isKmlLayerVisible ? "#DC2626" : "#15803D"}
                />
                <Text style={[styles.kmlModalToggleText, !isKmlLayerVisible && { color: "#15803D" }]} weight="semibold">
                  {isKmlLayerVisible ? "Masquer le calque KML" : "Afficher le calque KML"}
                </Text>
              </TouchableOpacity>

              <Button
                title="Fermer"
                variant="primary"
                size="md"
                onPress={() => setShowKmlInfoModal(false)}
              />
            </View>
          </View>
        </View>
      </Modal>

      <KmlImageModal
        sourceFormat={crsDetection?.source_format || referenceAlignment?.source || (isKmlSource(null, selectedFileName) ? 'KML' : undefined)}
        selectedKmlImage={selectedKmlImage}
        visible={showKmlImageModal}
        isKmlImagesVisible={isKmlImagesVisible}
        onClose={() => setShowKmlImageModal(false)}
        onToggleImages={() => setIsKmlImagesVisible(!isKmlImagesVisible)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.background,
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Palette.textMuted,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  headerTitle: {
    fontSize: 18,
    color: Palette.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  stepperContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    paddingVertical: 10,
  },
  stepperScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  multiFlowHeaderBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  multiFlowHeaderBadge: {
    backgroundColor: '#1E40AF',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 5,
  },
  multiFlowHeaderBadgeText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  multiFlowHeaderText: {
    fontSize: 11.5,
    color: '#1E40AF',
    flex: 1,
  },
  spatialHierarchyBar: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    backgroundColor: '#ECFDF5',
  },
  spatialHierarchyText: { fontSize: 10.5, color: '#065F46', textAlign: 'center' },
  spatialHierarchyArrow: { color: Palette.primary },
  stepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  stepBadgeCurrent: {
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  stepBadgeCompleted: {
    backgroundColor: '#DCFCE7',
  },
  stepBadgeText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  stepBadgeTextCurrent: {
    color: Palette.primary,
    fontWeight: 'bold',
  },
  stepBadgeTextCompleted: {
    color: '#16A34A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  stepCard: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  stepHeader: {
    marginBottom: 14,
  },
  stepBadgeNum: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  stepBadgeNumText: {
    fontSize: 10,
    color: Palette.primary,
    fontWeight: 'bold',
  },
  stepTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  stepDescription: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 3,
  },
  sectionBlock: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  sectionBlockHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionBlockTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  sectionBlockSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
    marginBottom: 10,
  },
  selectedLocChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  selectedLocText: {
    flex: 1,
    fontSize: 11.5,
    color: '#991B1B',
    lineHeight: 16,
  },
  selectedLocCoords: {
    fontSize: 10.5,
    color: '#B91C1C',
    opacity: 0.85,
  },
  dropzone: {
    padding: 24,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    borderStyle: 'dashed',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    marginVertical: 12,
  },
  dropzoneActive: {
    borderColor: '#16A34A',
    backgroundColor: '#F0FDF4',
  },
  dropzoneIconWrapper: {
    marginBottom: 6,
  },
  dropzoneTitle: {
    fontSize: 13,
    color: Palette.text,
    textAlign: 'center',
  },
  dropzoneSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 4,
  },
  sampleSection: {
    marginTop: 8,
    alignItems: 'flex-start',
    gap: 6,
  },
  sampleText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  sampleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  sampleBtnText: {
    fontSize: 12,
    color: Palette.primary,
  },
  coordsInputLabel: {
    fontSize: 12,
    color: Palette.text,
    marginBottom: 6,
  },
  coordsTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 10,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    height: 80,
  },
  drawingControlsSection: {
    marginTop: 10,
    gap: 8,
  },
  drawingModeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    gap: 8,
  },
  drawingModeIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawingModeTitle: {
    fontSize: 11.5,
    color: '#92400E',
    lineHeight: 15,
  },
  drawingModeSubtitle: {
    fontSize: 10.5,
    color: '#B45309',
    lineHeight: 14,
  },
  drawingModeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  drawingModeBadgeSuccess: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  drawingModeBadgeText: {
    fontSize: 11,
    color: '#92400E',
  },
  drawingModeBadgeTextSuccess: {
    color: '#166534',
  },
  drawingToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  drawingActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 6,
  },
  drawingActionBtnUndo: {
    backgroundColor: '#F8FAFC',
    borderColor: '#CBD5E1',
  },
  drawingActionBtnClear: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  drawingActionBtnFinish: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  drawingActionBtnFinishDisabled: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  drawingActionBtnDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.55,
  },
  drawingActionText: {
    fontSize: 12.5,
  },
  drawingActionTextUndo: {
    color: '#334155',
  },
  drawingActionTextClear: {
    color: '#DC2626',
  },
  drawingActionTextFinish: {
    color: '#FFFFFF',
  },
  drawingActionTextDisabled: {
    color: Palette.textMuted,
  },
  aoiStatusBox: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 10,
  },
  aoiStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aoiStatusTitle: {
    fontSize: 12,
    color: Palette.text,
  },
  sampleAoiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingVertical: 4,
  },
  sampleAoiBtnText: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
  },
  mapWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  corridorsListTitle: {
    fontSize: 13,
    color: Palette.text,
    marginTop: 10,
    marginBottom: 8,
  },
  corridorCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  corridorCardActive: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
  },
  corridorCardRec: {
    borderColor: '#F59E0B',
  },
  corridorCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  corridorName: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
  },
  recBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  recBadgeText: {
    fontSize: 10,
    color: '#B45309',
    fontWeight: 'bold',
  },
  corridorMetricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginLeft: 26,
  },
  corridorMetricPill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  corridorMetricPillLabel: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  corridorMetricPillVal: {
    fontSize: 11,
    color: Palette.text,
    marginTop: 2,
  },
  corridorReasonText: {
    fontSize: 11,
    color: '#D97706',
    marginTop: 6,
    marginLeft: 26,
    fontStyle: 'italic',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 10,
  },
  metricItem: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metricLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  metricValue: {
    fontSize: 15,
    color: Palette.text,
    marginTop: 4,
  },
  metricSub: {
    fontSize: 10,
    color: Palette.textLight,
    marginTop: 2,
  },
  directionLegendBox: {
    marginTop: 10,
    marginBottom: 4,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  directionLegendTitle: {
    fontSize: 10,
    color: Palette.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  directionLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  directionLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  directionLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  directionArrowBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(2, 132, 199, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionLegendText: {
    fontSize: 11,
    color: Palette.text,
  },
  directionToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.25)',
    marginVertical: 8,
  },
  directionToggleBtnActive: {
    backgroundColor: '#D97706',
    borderColor: '#B45309',
  },
  directionToggleText: {
    fontSize: 13,
    color: Palette.primary,
  },
  directionToggleSub: {
    fontSize: 10,
    color: Palette.textMuted,
    marginTop: 2,
  },
  segModeToggle: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  segModeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  segModeBtnActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  segModeText: {
    fontSize: 13,
    color: Palette.text,
    fontWeight: '500',
  },
  segModeTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  stepperControlContainer: {
    marginVertical: 10,
  },
  stepperControlLabel: {
    fontSize: 13,
    color: Palette.text,
    marginBottom: 8,
  },
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    justifyContent: 'center',
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperNumberDisplay: {
    width: 60,
    alignItems: 'center',
  },
  stepperNumberText: {
    fontSize: 22,
    color: Palette.primary,
  },
  calcHint: {
    marginTop: 10,
    fontSize: 12,
    color: Palette.primary,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  recalcStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  recalcStatusText: {
    fontSize: 12,
    color: '#1D4ED8',
    fontWeight: '500',
  },
  validStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  validStatusText: {
    fontSize: 12,
    color: '#15803D',
  },
  invalidStatusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 10,
    borderRadius: 8,
    marginVertical: 8,
  },
  invalidStatusText: {
    fontSize: 12,
    color: '#B91C1C',
  },
  editCutBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
  },
  editCutTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  tronconRow: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  tronconHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tronconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.primary,
  },
  tronconName: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
  },
  tronconNameInput: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
    borderBottomWidth: 1,
    borderBottomColor: Palette.primary,
    paddingVertical: 2,
  },
  tronconLength: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  tronconPk: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 4,
    marginLeft: 16,
  },
  pkEditRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginLeft: 16,
  },
  pkEditLabel: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  pkInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 12,
    marginTop: 2,
  },
  successCard: {
    padding: 24,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
  },
  successTitle: {
    fontSize: 18,
    color: Palette.text,
    marginTop: 10,
  },
  successSubtitle: {
    fontSize: 13,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 18,
  },

  // ── Corridor Filter & Pagination Styles ──
  corridorToolbar: {
    marginTop: 14,
    marginBottom: 10,
    gap: 10,
  },
  corridorToolbarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  viewModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  viewModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  viewModeBtnActive: {
    backgroundColor: Palette.primary,
  },
  viewModeBtnText: {
    fontSize: 11,
    color: Palette.textMuted,
    fontWeight: '600',
  },
  viewModeBtnTextActive: {
    color: '#FFFFFF',
  },
  corridorSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  corridorSearchInputWrapper: {
    flex: 1,
    minWidth: 170,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  corridorSearchInput: {
    flex: 1,
    fontSize: 12,
    color: Palette.text,
    padding: 0,
  },
  corridorFilterChips: {
    flexDirection: 'row',
    gap: 6,
  },
  corridorChip: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  corridorChipActive: {
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    borderColor: Palette.primary,
  },
  corridorChipText: {
    fontSize: 11,
    color: Palette.textMuted,
    fontWeight: '500',
  },
  corridorChipTextActive: {
    color: Palette.primary,
    fontWeight: 'bold',
  },
  emptyCorridorBox: {
    padding: 24,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 10,
  },
  emptyCorridorText: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  corridorLazyActions: {
    marginTop: 6,
    marginBottom: 10,
    alignItems: 'center',
    gap: 8,
  },
  corridorLoadMoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Palette.primary,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  corridorLoadMoreText: {
    fontSize: 12,
    color: Palette.primary,
  },
  corridorShowAllBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corridorShowAllText: {
    fontSize: 12,
    color: Palette.primary,
  },
  corridorCollapseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
  },
  corridorCollapseText: {
    fontSize: 11.5,
    color: Palette.textMuted,
  },
  corridorCountSummary: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  corridorPaginationContainer: {
    marginTop: 10,
    marginBottom: 8,
    gap: 8,
    alignItems: 'center',
  },
  corridorPaginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 6,
  },
  corridorPageNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  corridorPageNavBtnDisabled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    opacity: 0.6,
  },
  corridorPageNavText: {
    fontSize: 11.5,
    color: Palette.primary,
    fontWeight: '600',
  },
  corridorPageNavTextDisabled: {
    color: Palette.textLight,
  },
  corridorPageNumbers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  corridorPageNumPill: {
    minWidth: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  corridorPageNumPillActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  corridorPageNumText: {
    fontSize: 11.5,
    color: Palette.text,
  },
  corridorPageNumTextActive: {
    color: '#FFFFFF',
  },
  corridorEllipsis: {
    fontSize: 11,
    color: Palette.textMuted,
    paddingHorizontal: 2,
  },
  crsProvenanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.15)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  crsProvenanceText: {
    fontSize: 11.5,
    color: Palette.primaryDark,
  },

  // CRS UI Styles
  crsScanningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  crsScanningTitle: {
    fontSize: 13,
    color: '#166534',
  },
  crsScanningSubtitle: {
    fontSize: 11.5,
    color: '#15803D',
    marginTop: 2,
  },
  crsDetectedCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 12,
    padding: 14,
  },
  crsDetectedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  crsDetectedIcon: {
    marginTop: 2,
  },
  crsDetectedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
    letterSpacing: 0.5,
  },
  crsDetectedName: {
    fontSize: 13.5,
    color: '#14532D',
    marginTop: 2,
  },
  crsDetectedDesc: {
    fontSize: 11.5,
    color: '#15803D',
    marginTop: 3,
    lineHeight: 16,
  },
  crsEditLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.25)',
    borderRadius: 6,
  },
  crsEditText: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
  },
  crsAmbiguousCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 14,
  },
  crsAmbiguousHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  crsAmbiguousTitle: {
    fontSize: 13,
    color: '#92400E',
  },
  crsAmbiguousDesc: {
    fontSize: 11.5,
    color: '#B45309',
    marginTop: 3,
    lineHeight: 16,
  },
  crsCandidatesPrompt: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 12,
    marginBottom: 6,
  },
  crsCandidatesList: {
    gap: 6,
  },
  crsCandidateItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 10,
  },
  crsCandidateItemActive: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.04)',
  },
  crsCandidateTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  crsCandidateName: {
    fontSize: 12.5,
    color: Palette.text,
  },
  crsCandidateCodeBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  crsCandidateCodeText: {
    fontSize: 10,
    fontWeight: '600',
    color: Palette.textMuted,
  },
  crsCandidateZone: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  crsOtherLink: {
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  crsOtherText: {
    fontSize: 11.5,
    color: Palette.primary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  // CRS Advanced Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  crsModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 540,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  crsModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  crsModalTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  crsModalCloseBtn: {
    padding: 4,
  },
  crsModalSearchInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: Palette.text,
    backgroundColor: '#F8FAFC',
    marginBottom: 12,
  },
  crsModalScroll: {
    maxHeight: 360,
  },
  crsModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    borderRadius: 8,
  },
  crsModalItemActive: {
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
  },
  crsModalItemTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  crsModalItemSub: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  crsModalItemCode: {
    fontSize: 11,
    fontWeight: '700',
    color: Palette.primary,
  },
  conflictModalContainer: {
    width: '92%',
    maxWidth: 520,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  conflictModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  conflictModalIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  conflictModalTitle: {
    fontSize: 18,
    color: '#DC2626',
  },
  conflictModalSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  conflictBanner: {
    backgroundColor: '#FEF2F2',
    borderLeftWidth: 4,
    borderLeftColor: '#DC2626',
    borderRadius: 8,
    padding: 12,
    marginBottom: 14,
  },
  conflictBannerText: {
    fontSize: 13,
    color: '#991B1B',
    lineHeight: 18,
  },
  conflictListHeading: {
    fontSize: 11,
    letterSpacing: 0.6,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  conflictItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  conflictItemName: {
    fontSize: 13.5,
    color: Palette.text,
  },
  conflictItemArea: {
    fontSize: 11.5,
    color: Palette.textMuted,
    marginTop: 3,
  },
  conflictHelpNotice: {
    fontSize: 11,
    color: Palette.textMuted,
    lineHeight: 15,
    marginVertical: 10,
    fontStyle: 'italic',
  },
  conflictModalFooter: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Palette.border,
  },
  siblingAoisNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  siblingAoisNoticeText: {
    flex: 1,
    fontSize: 11.5,
    color: '#3730A3',
    lineHeight: 16,
  },
  // Level 3 — KML Visualization & Intelligence Styles
  kmlDetectedCard: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.5,
    borderColor: '#FFEDD5',
    shadowColor: '#EA580C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  kmlDetectedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  kmlDetectedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kmlDetectedBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#C2410C',
    letterSpacing: 0.5,
  },
  kmlSourceTag: {
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FDBA74',
  },
  kmlSourceTagText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#9A3412',
  },
  kmlDetectedName: {
    fontSize: 14,
    color: '#9A3412',
    marginTop: 3,
  },
  kmlDetectedDesc: {
    fontSize: 11.5,
    color: '#7C2D12',
    lineHeight: 16,
    marginTop: 3,
  },
  kmlActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(249, 115, 22, 0.2)',
  },
  kmlInspectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.2,
    borderColor: '#FDBA74',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  kmlInspectBtnText: {
    fontSize: 11.5,
    color: '#C2410C',
  },
  kmlToggleLayerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.2,
    borderColor: '#BBF7D0',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  kmlToggleLayerBtnOff: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  kmlToggleLayerText: {
    fontSize: 11.5,
    color: '#15803D',
  },
  kmlToggleLayerTextOff: {
    color: '#64748B',
  },
  // KML Information Modal Styles
  kmlModalContainer: {
    width: '92%',
    maxWidth: 540,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 10,
  },
  kmlModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  kmlModalIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFEDD5',
  },
  kmlModalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#EA580C',
    letterSpacing: 0.4,
  },
  kmlModalTitle: {
    fontSize: 16,
    color: Palette.text,
    marginTop: 1,
  },
  kmlModalSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  kmlSection: {
    marginBottom: 14,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  kmlSectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: Palette.primary,
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  kmlInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  kmlInfoRowColumn: {
    paddingVertical: 4,
  },
  kmlInfoLabel: {
    fontSize: 11.5,
    color: Palette.textMuted,
  },
  kmlInfoValue: {
    fontSize: 12,
    color: Palette.text,
    maxWidth: '65%',
    textAlign: 'right',
  },
  kmlDescriptionBox: {
    fontSize: 11.5,
    color: Palette.text,
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
    lineHeight: 16,
  },
  kmlColorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  kmlExtDataTable: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  kmlExtDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  kmlExtDataKey: {
    fontSize: 11,
    color: Palette.primary,
  },
  kmlExtDataVal: {
    fontSize: 11,
    color: Palette.text,
    maxWidth: '60%',
    textAlign: 'right',
  },
  kmlHeaderActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    marginRight: 6,
  },
  kmlHeaderActionText: {
    fontSize: 11,
    color: '#EA580C',
  },
  kml3dActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 9,
  },
  kml3dActionText: {
    fontSize: 11,
    color: '#EA580C',
  },
  kmlStepActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FDBA74',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 8,
  },
  kmlStepActionText: {
    fontSize: 11.5,
    color: '#EA580C',
  },
  kmlModalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  kmlModalToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.2,
    borderColor: '#E2E8F0',
  },
  kmlModalToggleBtnOff: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  kmlModalToggleText: {
    fontSize: 12,
    color: '#DC2626',
  },
  kmlImagesSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.25)',
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginTop: 8,
  },
  kmlImagesSummaryText: {
    fontSize: 11,
    color: '#C2410C',
  },
  kmlImagePreviewWrap: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    marginTop: 4,
  },
  kmlImagePreview: {
    width: '100%',
    height: 180,
    backgroundColor: '#0F172A',
  },
  kmlImageHrefCaption: {
    fontSize: 10,
    color: '#94A3B8',
    padding: 6,
    width: '100%',
    textAlign: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
  },
  kmlImageUnavailableBox: {
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  kmlImageUnavailableTitle: {
    fontSize: 12.5,
    color: Palette.text,
  },
  kmlImageUnavailableDesc: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  kmlImageUnavailableFootnote: {
    fontSize: 10,
    color: '#64748B',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 2,
  },
  // Level 5 — 3D GIS Visualization Mode Styles
  gisViewModeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  gisViewModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  gisViewModeBtnActive: {
    backgroundColor: Palette.primary,
  },
  gisViewModeText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  gisViewModeTextActive: {
    color: '#FFFFFF',
  },
  view3DContainer: {
    flex: 1,
    backgroundColor: '#070D1E',
  },
  view3DTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  view3DBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  view3DBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  view3DBadgeText: {
    color: '#10B981',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  view3DChantierTitle: {
    color: '#F8FAFC',
    fontSize: 15,
  },
  view3DChantierSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 1,
  },
  returnTo2dBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  returnTo2dText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  // Step 1: Multi-Feature Detection Banner
  multiFeatureDetectedBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderColor: 'rgba(2, 132, 199, 0.3)',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
  },
  multiFeatureDetectedIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(2, 132, 199, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  multiFeatureDetectedTag: {
    fontSize: 10,
    fontWeight: '800',
    color: '#0284C7',
    letterSpacing: 0.5,
  },
  multiFeatureCountTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0369A1',
    backgroundColor: 'rgba(2, 132, 199, 0.18)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  multiFeatureDetectedTitle: {
    fontSize: 14,
    color: '#0C4A6E',
    marginTop: 2,
  },
  multiFeatureDetectedDesc: {
    fontSize: 12,
    color: '#0369A1',
    lineHeight: 17,
    marginTop: 4,
  },
  // Step 2: Coordinate Entry (BBox & Vertices)
  coordsEntryContainer: {
    marginVertical: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  coordSubTabsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  coordSubTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  coordSubTabBtnActive: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderColor: Palette.primary,
  },
  coordSubTabText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  coordSubTabTextActive: {
    color: Palette.primary,
  },
  bboxContainer: {
    marginTop: 4,
  },
  coordsInputHelp: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 10,
    lineHeight: 16,
  },
  bboxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  bboxInputCol: {
    flex: 1,
    minWidth: '45%',
  },
  bboxFieldLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 4,
  },
  bboxTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  bboxActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  bboxApplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  bboxApplyBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  bboxAutofillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(2, 132, 199, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(2, 132, 199, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  bboxAutofillBtnText: {
    color: '#0284C7',
    fontSize: 12,
  },
  // Step 3: Candidate Result Banners
  zeroCandidateBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#F87171',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  zeroCandidateHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  zeroCandidateTitle: {
    fontSize: 14,
    color: '#991B1B',
  },
  zeroCandidateSubtitle: {
    fontSize: 12,
    color: '#B91C1C',
    marginTop: 3,
    lineHeight: 17,
  },
  modifyAoiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DC2626',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    alignSelf: 'flex-start',
  },
  modifyAoiBtnText: {
    color: '#DC2626',
    fontSize: 12,
  },
  singleCandidateBanner: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  singleCandidateHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  singleCandidateTitle: {
    fontSize: 14,
    color: '#166534',
  },
  singleCandidateDesc: {
    fontSize: 12,
    color: '#15803D',
    marginTop: 2,
    lineHeight: 17,
  },
  refineAoiGhostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  refineAoiGhostText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '600',
  },
  multiCandidateBanner: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1.5,
    borderColor: '#FCD34D',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  multiCandidateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  multiCandidateTitle: {
    fontSize: 13,
    color: '#92400E',
  },
  multiCandidateSubtitle: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  refineAoiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D97706',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  refineAoiBtnText: {
    color: '#D97706',
    fontSize: 12,
  },
  // AOI Refinement Mode Styles
  refineModeNoticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    gap: 10,
  },
  refineModeNoticeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refineModeNoticeTitle: {
    fontSize: 13.5,
    color: '#92400E',
  },
  refineModeNoticeSubtitle: {
    fontSize: 11.5,
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  stepBadgeNumRefine: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  stepBadgeNumTextRefine: {
    color: '#B45309',
  },
  refineActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  refineCancelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  refineCancelBtnText: {
    color: '#475569',
    fontSize: 14,
  },
  refineValidateBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#D97706',
    shadowColor: '#D97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  refineValidateBtnDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0,
    elevation: 0,
  },
  refineValidateBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  // Phone-Adapted Blue Zone Header
  phoneHeaderBar: {
    marginHorizontal: 16,
    marginTop: Platform.OS === 'ios' ? 6 : 10,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 2,
  },
  phoneHeaderLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  phoneBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  phoneHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#1E40AF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  phoneHeaderBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.7,
  },
  phoneKmlInfoBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFF7ED',
    borderWidth: 1.2,
    borderColor: '#FDBA74',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
