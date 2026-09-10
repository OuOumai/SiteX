import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  Modal,
  TextInput,
  Image,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  getMediaUrl,
  AgentTronconDetailsResponse,
  SpatialProjectionPreview,
  TerrainObservationItem,
} from '@/services/api';
import { InteractiveGisMap, GisTronconSegment } from '@/components/gis/InteractiveGisMap';
import { getCurrentDeviceLocation, DeviceLocationResult } from '@/services/location';
import { ObservationCalendar } from '@/components/agent/ObservationCalendar';

const ALLOWED_PHASES = [
  'Terrassement',
  'Assainissement',
  'Fondation',
  'Chaussée',
  'Revêtement',
  'Signalisation',
  'Autre',
];

const ALLOWED_PHASE_STATUSES = [
  'Non commencée',
  'En cours',
  'Terminée',
];

function formatPK(val?: number | null, isReversed = false): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}${isReversed ? ' (Inv)' : ''}`;
}

export default function AgentTronconDetailScreen() {
  const { tronconId } = useLocalSearchParams<{ tronconId: string }>();
  const router = useRouter();
  const { token } = useAuth();

  const [data, setData] = useState<AgentTronconDetailsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [screenScrollEnabled, setScreenScrollEnabled] = useState(true);
  const handleMapInteractionChange = useCallback((interacting: boolean) => {
    setScreenScrollEnabled(!interacting);
  }, []);
  const [technicalExpanded, setTechnicalExpanded] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [historyObservations, setHistoryObservations] = useState<TerrainObservationItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Observation Modal & GPS State
  const [isObsModalOpen, setIsObsModalOpen] = useState(false);
  const [isAcquiringGps, setIsAcquiringGps] = useState(false);
  const [isComputingProjection, setIsComputingProjection] = useState(false);
  const [isSubmittingObs, setIsSubmittingObs] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<DeviceLocationResult | null>(null);
  const [projectionResult, setProjectionResult] = useState<SpatialProjectionPreview | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Field Observation Form Inputs
  const [selectedPhase, setSelectedPhase] = useState<string>('Terrassement');
  const [selectedPhaseStatut, setSelectedPhaseStatut] = useState<string>('En cours');
  const [commentaire, setCommentaire] = useState<string>('');
  const [selectedPhotos, setSelectedPhotos] = useState<{ uri: string; base64?: string }[]>([]);

  // Full Screen Photo Viewer Modal
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !tronconId) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const res = await api.getAgentTronconDetails(token, tronconId);
      setData(res);
      const initial = res.observations || [];
      const initialDate = initial[0]?.date_heure?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const initialMonth = initialDate.slice(0, 7);
      setHistoryMonth(initialMonth);
      setSelectedHistoryDate(initialDate);
      try {
        const history = await api.getTronconObservationHistory(token, tronconId, initialMonth);
        setHistoryObservations(history.observations || []);
      } catch {
        setHistoryObservations(initial.filter((item) => item.date_heure?.startsWith(initialMonth)));
      }
    } catch (err: any) {
      console.error('Erreur chargement détails tronçon agent:', err.message);
      Alert.alert('Accès refusé', err.message || 'Impossible d\'accéder à ce tronçon.');
      router.back();
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, tronconId, router]);

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const loadHistoryMonth = useCallback(async (month: string) => {
    if (!token || !tronconId) return;
    setHistoryLoading(true);
    try {
      const result = await api.getTronconObservationHistory(token, tronconId, month);
      setHistoryObservations(result.observations || []);
      const firstDate = result.observations?.[0]?.date_heure?.slice(0, 10);
      setSelectedHistoryDate(firstDate || `${month}-01`);
    } catch (error: any) {
      Alert.alert('Historique indisponible', error.message || 'Impossible de charger les observations de ce mois.');
    } finally { setHistoryLoading(false); }
  }, [token, tronconId]);

  const handleHistoryMonthChange = (month: string) => {
    setHistoryMonth(month);
    loadHistoryMonth(month);
  };

  const toggleTechnical = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTechnicalExpanded((value) => !value);
  };

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Capture GPS & Compute Projection
  const handleStartObservation = async () => {
    if (!token || !tronconId) return;
    setIsObsModalOpen(true);
    setGpsError(null);
    setProjectionResult(null);
    setGpsLocation(null);
    setIsAcquiringGps(true);
    setSelectedPhase('Terrassement');
    setSelectedPhaseStatut('En cours');
    setCommentaire('');
    setSelectedPhotos([]);

    try {
      // 1. Get Device GPS position
      const loc = await getCurrentDeviceLocation();
      setGpsLocation(loc);
      setIsAcquiringGps(false);

      // 2. Request PostGIS projection & progress calculation from server
      setIsComputingProjection(true);
      const proj = await api.calculateTronconProjection(token, tronconId, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy || undefined,
      });
      setProjectionResult(proj);
    } catch (err: any) {
      console.error('Erreur capture GPS/projection:', err.message);
      setGpsError(err.message || 'Impossible d\'obtenir la position GPS.');
    } finally {
      setIsAcquiringGps(false);
      setIsComputingProjection(false);
    }
  };

  // Re-acquire GPS position
  const handleRefreshGps = () => {
    handleStartObservation();
  };

  // Pick Photo from Camera
  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à l\'appareil photo.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const base64Data = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setSelectedPhotos((prev) => [...prev, { uri: asset.uri, base64: base64Data }]);
      }
    } catch (e: any) {
      console.error('Erreur prise de photo:', e.message);
      Alert.alert('Erreur', 'Impossible de capturer la photo.');
    }
  };

  // Pick Photo from Gallery
  const handlePickFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission requise', 'Veuillez autoriser l\'accès à la galerie photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        allowsMultipleSelection: true,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const newPhotos = result.assets.map((asset) => ({
          uri: asset.uri,
          base64: asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri,
        }));
        setSelectedPhotos((prev) => [...prev, ...newPhotos]);
      }
    } catch (e: any) {
      console.error('Erreur sélection galerie:', e.message);
      Alert.alert('Erreur', 'Impossible de sélectionner les photos.');
    }
  };

  // Remove photo from selection
  const handleRemovePhoto = (indexToRemove: number) => {
    setSelectedPhotos((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Confirm & Save Observation
  const handleConfirmObservation = async (exceptionalConfirmation = false) => {
    if (!token || !tronconId || !gpsLocation) {
      Alert.alert('Erreur', 'Données GPS non disponibles.');
      return;
    }

    setIsSubmittingObs(true);
    try {
      const photoPayload = selectedPhotos.map((p) => p.base64 || p.uri);

      const res = await api.createTronconObservation(token, tronconId, {
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        accuracy: gpsLocation.accuracy || undefined,
        phase: selectedPhase,
        phase_statut: selectedPhaseStatut,
        commentaire: commentaire.trim() || undefined,
        photos: photoPayload,
        exceptional_confirmation: exceptionalConfirmation,
      });

      Alert.alert(
        'Observation enregistrée ✓',
        `Métrage atteint :\nPK ${Math.round(res.observation.distance_from_start || 0)} m\n\n` +
        `Avancement aujourd'hui :\n+${Math.round(res.observation.daily_progress_meters || 0)} m (+${res.observation.daily_progress_percentage || 0}%)\n\n` +
        `Avancement total du tronçon :\n${res.observation.authoritative_progress_percentage ?? res.observation.progress_percentage}%\n\n` +
        `Distance à l'axe (D_min) :\n${Number(res.observation.distance_offset || 0).toFixed(2)} m`
      );

      setIsObsModalOpen(false);
      fetchDetails();
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible d\'enregistrer l\'observation.');
    } finally {
      setIsSubmittingObs(false);
    }
  };

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement de votre affectation terrain...</Text>
      </SafeAreaView>
    );
  }

  const troncon = data?.troncon;
  const siblings = data?.siblings || [];
  const observations: TerrainObservationItem[] = data?.observations || [];
  const displayedHistory = historyObservations.filter((item) => item.date_heure?.startsWith(selectedHistoryDate));
  const observationDates = new Set(
    historyObservations.map((item) => item.date_heure?.slice(0, 10)).filter(Boolean) as string[],
  );
  const latestObs = troncon?.latest_observation || (observations.length > 0 ? observations[0] : null);
  const currentId = Number(tronconId);

  // Map segments
  const mapSegments: GisTronconSegment[] = siblings.map((t) => ({
    id: t.id!,
    nom: t.nom,
    pk_debut: t.pk_debut,
    pk_fin: t.pk_fin,
    statut: t.statut || 'NON_COMMENCE',
    length_km: t.length_km,
    geometry: t.geometry,
    progress_percentage: Number(t.id) === currentId ? Number(troncon?.avancement || 0) : Number(t.avancement || 0),
  }));

  // Custom Map Markers (GPS + Projected point)
  const furthestMeters = Math.max(0, ...observations.map((item) => Number(item.distance_from_start) || 0));
  const mapMarkers: NonNullable<React.ComponentProps<typeof InteractiveGisMap>['customMarkers']> = [];
  const mapLines: { start: { lat: number; lng: number }; end: { lat: number; lng: number }; label: string; color: string }[] = [];
  observations.forEach((obs) => {
    if (Number.isFinite(Number(obs.agent_lat)) && Number.isFinite(Number(obs.agent_lng)) &&
        Number.isFinite(Number(obs.projected_lat)) && Number.isFinite(Number(obs.projected_lng))) {
      mapMarkers.push({
        lat: Number(obs.agent_lat), lng: Number(obs.agent_lng),
        label: `Position GPS réelle — observation #${obs.id}`,
        sublabel: `D_min = ${obs.distance_offset ?? 0} m`, color: '#0284C7', iconName: 'gps',
      });
      mapMarkers.push({
        lat: Number(obs.projected_lat), lng: Number(obs.projected_lng),
        label: `Position projetée — observation #${obs.id}`,
        sublabel: `PK ${obs.chainage ?? 0} • ${obs.validation_status === 'exceptional' ? 'Validation exceptionnelle' : 'Validation normale'}`,
        color: obs.validation_status === 'exceptional' ? '#DC2626' : '#10B981', iconName: 'road',
        photoUrl: obs.photos?.[0]?.url ? getMediaUrl(obs.photos[0].url) : undefined,
        dateTime: obs.date_heure,
        phase: obs.phase,
        workStatus: obs.phase_statut,
        remarks: obs.commentaire,
        distanceOffset: Number(obs.distance_offset || 0),
        dailyMeters: Number(obs.daily_progress_meters || 0),
        dailyPercentage: Number(obs.daily_progress_percentage || 0),
        totalPercentage: Number(obs.authoritative_progress_percentage ?? obs.progress_percentage),
        validationStatus: obs.validation_status,
        isFurthest: Number(obs.distance_from_start) === furthestMeters,
      });
      mapLines.push({
        start: { lat: Number(obs.agent_lat), lng: Number(obs.agent_lng) },
        end: { lat: Number(obs.projected_lat), lng: Number(obs.projected_lng) },
        label: `D_min = ${obs.distance_offset ?? 0} m`, color: obs.validation_status === 'exceptional' ? '#DC2626' : '#F59E0B',
      });
    }
  });
  if (projectionResult) {
    mapMarkers.push({
      lat: projectionResult.agent_location.latitude,
      lng: projectionResult.agent_location.longitude,
      label: 'Position GPS Réelle',
      sublabel: `Précision ±${projectionResult.agent_location.accuracy || 5} m`,
      color: '#0284C7',
      iconName: 'gps',
    });
    mapMarkers.push({
      lat: projectionResult.projected_location.latitude,
      lng: projectionResult.projected_location.longitude,
      label: `Point Projeté (PK ${projectionResult.calculated_pk})`,
      sublabel: `Avancement calculé : ${projectionResult.progress_percentage}%`,
      color: '#10B981',
      iconName: 'road',
    });
    mapLines.push({
      start: { lat: projectionResult.agent_location.latitude, lng: projectionResult.agent_location.longitude },
      end: { lat: projectionResult.projected_location.latitude, lng: projectionResult.projected_location.longitude },
      label: `D_min = ${projectionResult.offset_distance_meters} m`, color: '#F59E0B',
    });
  }

  const statut = troncon?.statut || 'NON_COMMENCE';
  const statutColor =
    statut === 'TERMINE'
      ? '#16A34A'
      : statut === 'EN_COURS'
      ? '#F4A261'
      : statut === 'PROBLEME'
      ? '#DC2626'
      : '#94A3B8';

  const statutLabel =
    statut === 'TERMINE'
      ? 'Terminé'
      : statut === 'EN_COURS'
      ? 'En cours'
      : statut === 'PROBLEME'
      ? 'Problème / Retard'
      : 'Non commencé';

  const currentAvancement = troncon?.avancement || 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── Hierarchy Header: Projet -> Chantier -> Tronçon ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityLabel="Retour au tableau de bord"
        >
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <View style={styles.agentTagRow}>
            <View style={styles.agentBadge}>
              <Ionicons name="navigate-outline" size={12} color="#0D9488" />
              <Text style={styles.agentBadgeText} weight="bold">MISSION TERRAIN</Text>
            </View>
          </View>
          <Text style={styles.hierarchyText} numberOfLines={1}>
            {troncon?.projet_nom} &bull; {troncon?.chantier_nom}
          </Text>
          <Text variant="h1" style={styles.headerTitle} numberOfLines={1}>
            {troncon?.nom}
          </Text>
        </View>
      </View>

      <ScrollView
        scrollEnabled={screenScrollEnabled}
        nestedScrollEnabled={true}
        disableScrollViewPanResponder
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDetails(true)}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 1. Map Position on the Linear Corridor ── */}
        <Card variant="elevated" style={styles.mapCard}>
          <View style={styles.mapHeaderRow}>
            <View style={styles.mapHeaderTitleRow}>
              <Ionicons name="map-outline" size={18} color={Palette.primary} />
              <Text style={styles.mapCardTitle} weight="bold">
                Tracé & Emplacement Spatial
              </Text>
            </View>
            <View style={[styles.statutBadge, { backgroundColor: `${statutColor}18`, borderColor: statutColor }]}>
              <View style={[styles.statutDot, { backgroundColor: statutColor }]} />
              <Text style={[styles.statutBadgeText, { color: statutColor }]} weight="bold">
                {statutLabel}
              </Text>
            </View>
          </View>

          <InteractiveGisMap
            height={Platform.OS === 'web' ? 440 : 420}
            troncons={mapSegments}
            selectedTronconId={currentId}
            customMarkers={mapMarkers}
            customLines={mapLines}
            onInteractionChange={handleMapInteractionChange}
          />
        </Card>

        {/* ── 2. Primary Action Bar: DÉCLARER UNE OBSERVATION ── */}
        <Card variant="elevated" style={styles.actionHeroCard}>
          <View style={styles.actionHeroRow}>
            <View style={styles.actionHeroIconBox}>
              <Ionicons name="navigate" size={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionHeroTitle} weight="bold">
                {"Relevé d'Avancement par GPS"}
              </Text>
              <Text style={styles.actionHeroSubtitle}>
                {"Déclarez une observation terrain avec localisation satellite, phase de travaux, remarques et photos."}
              </Text>
            </View>
          </View>
          <Button
            title="📍 Déclarer une observation"
            variant="primary"
            size="md"
            onPress={handleStartObservation}
            style={styles.declareBtn}
          />
        </Card>

        {/* ── 3. Latest Observation Card (Timeline snapshot) ── */}
        {latestObs ? (
          <Card variant="elevated" style={styles.latestObsCard}>
            <View style={styles.latestObsHeader}>
              <View style={styles.latestObsIconBadge}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.latestObsHeading} weight="bold">
                  Dernière Observation Enregistrée
                </Text>
                <Text style={styles.latestObsDate}>{latestObs.date_heure}</Text>
              </View>
              <View style={styles.progressPillBadge}>
                <Text style={styles.progressPillText} weight="bold">
                  {latestObs.progress_percentage}%
                </Text>
              </View>
            </View>

            <View style={styles.latestObsDetailsRow}>
              <View style={styles.phaseBadgeRow}>
                <View style={styles.phaseTag}>
                  <Text style={styles.phaseTagText} weight="bold">
                    {latestObs.phase || 'Terrassement'}
                  </Text>
                </View>
                <View style={[styles.statusTag, {
                  backgroundColor: latestObs.phase_statut === 'Terminée' ? '#DCFCE7' : latestObs.phase_statut === 'En cours' ? '#FEF3C7' : '#F1F5F9'
                }]}>
                  <Text style={[styles.statusTagText, {
                    color: latestObs.phase_statut === 'Terminée' ? '#16A34A' : latestObs.phase_statut === 'En cours' ? '#B45309' : '#64748B'
                  }]} weight="semibold">
                    {latestObs.phase_statut || 'En cours'}
                  </Text>
                </View>
              </View>

              {latestObs.commentaire ? (
                <Text style={styles.obsCommentText}>{`"${latestObs.commentaire}"`}</Text>
              ) : null}
            </View>

            <View style={styles.latestObsGrid}>
              <View style={styles.latestObsMetric}>
                <Text style={styles.obsMetricLabel}>Chaînage estimé</Text>
                <Text style={styles.obsMetricVal} weight="semibold">
                  PK {latestObs.chainage || 0}
                </Text>
              </View>
              <View style={styles.latestObsMetric}>
                <Text style={styles.obsMetricLabel}>Distance début</Text>
                <Text style={styles.obsMetricVal} weight="semibold">
                  {latestObs.distance_from_start || 0} m
                </Text>
              </View>
              <View style={styles.latestObsMetric}>
                <Text style={styles.obsMetricLabel}>Déport axe</Text>
                <Text style={styles.obsMetricVal} weight="semibold">
                  {latestObs.distance_offset || 0} m
                </Text>
              </View>
            </View>
          </Card>
        ) : null}

        {/* ── 4. Technical Summary Card ── */}
        <Card variant="elevated" style={styles.summaryCard}>
          <TouchableOpacity style={styles.summaryAccordionHeader} onPress={toggleTechnical} activeOpacity={0.75}>
            <Ionicons name={technicalExpanded ? 'chevron-down' : 'chevron-forward'} size={20} color={Palette.primary} />
            <Text style={styles.summaryCardHeading} weight="bold">Fiche Technique & Chaînage</Text>
          </TouchableOpacity>

          {technicalExpanded && <View style={styles.summaryGrid}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Projet :</Text>
              <Text style={styles.summaryValue} weight="semibold">
                {troncon?.projet_nom} ({troncon?.type_projet || 'Projet Linéaire'})
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Chantier :</Text>
              <Text style={styles.summaryValue}>{troncon?.chantier_nom}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Chaînage Début :</Text>
              <Text style={styles.summaryValue} weight="semibold">
                {formatPK(troncon?.pk_debut, troncon?.direction_reversed)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Chaînage Fin :</Text>
              <Text style={styles.summaryValue} weight="semibold">
                {formatPK(troncon?.pk_fin, troncon?.direction_reversed)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Longueur Linéaire :</Text>
              <Text style={styles.summaryValue} weight="bold">
                {troncon?.length_km} km ({troncon?.length_meters} m)
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Avancement calculé :</Text>
              <Text style={styles.summaryValue} weight="bold">
                {currentAvancement}%
              </Text>
            </View>

            {/* Progress Bar */}
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.min(currentAvancement, 100)}%` },
                ]}
              />
            </View>
          </View>}
        </Card>

        {/* ── 5. Historique des Observations (Newest First) ── */}
        <View style={styles.historySectionHeader}>
          <Ionicons name="time-outline" size={18} color={Palette.primary} />
          <Text style={styles.historySectionTitle} weight="bold">
            Historique des observations ({observations.length})
          </Text>
        </View>

        <ObservationCalendar month={historyMonth} selectedDate={selectedHistoryDate} observationDates={observationDates} onMonthChange={handleHistoryMonthChange} onSelectDate={setSelectedHistoryDate} />
        {historyLoading && <ActivityIndicator color={Palette.primary} style={{ marginBottom: 12 }} />}

        {displayedHistory.length > 0 ? (
          <View style={styles.historyList}>
            {displayedHistory.map((obs) => {
              const statusBg =
                obs.phase_statut === 'Terminée'
                  ? '#DCFCE7'
                  : obs.phase_statut === 'En cours'
                  ? '#FEF3C7'
                  : '#F1F5F9';
              const statusColor =
                obs.phase_statut === 'Terminée'
                  ? '#16A34A'
                  : obs.phase_statut === 'En cours'
                  ? '#B45309'
                  : '#64748B';

              return (
                <Card key={obs.id} variant="elevated" style={styles.historyCard}>
                  {/* History Item Header */}
                  <View style={styles.historyCardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyAgentName} weight="bold">
                        {obs.agent_nom || 'Agent de Terrain'}
                      </Text>
                      <Text style={styles.historyDate}>{obs.date_heure}</Text>
                    </View>
                    <View style={styles.historyProgressBadge}>
                      <Text style={styles.historyProgressText} weight="bold">
                        {obs.progress_percentage}%
                      </Text>
                    </View>
                  </View>

                  {/* Phase & Status Tags */}
                  <View style={styles.historyTagsRow}>
                    <View style={styles.historyPhaseTag}>
                      <Text style={styles.historyPhaseText} weight="bold">
                        {obs.phase || 'Terrassement'}
                      </Text>
                    </View>
                    <View style={[styles.historyStatusTag, { backgroundColor: statusBg }]}>
                      <Text style={[styles.historyStatusText, { color: statusColor }]} weight="semibold">
                        {obs.phase_statut || 'En cours'}
                      </Text>
                    </View>
                    {obs.distance_from_start ? (
                      <Text style={styles.historyDistanceText}>
                        {obs.distance_from_start} m &bull; PK {obs.chainage || 0} &bull; D_min {obs.distance_offset ?? 0} m
                      </Text>
                    ) : null}
                    <View style={[styles.historyStatusTag, { backgroundColor: obs.validation_status === 'exceptional' ? '#FEE2E2' : '#DCFCE7' }]}>
                      <Text style={[styles.historyStatusText, { color: obs.validation_status === 'exceptional' ? '#B91C1C' : '#15803D' }]} weight="semibold">
                        {obs.validation_status === 'exceptional' ? 'Validation exceptionnelle' : 'Validation normale'}
                      </Text>
                    </View>
                  </View>

                  {/* Comment */}
                  {obs.commentaire ? (
                    <Text style={styles.historyComment}>
                      {`"${obs.commentaire}"`}
                    </Text>
                  ) : null}

                  {/* Attached Photos */}
                  {obs.photos && obs.photos.length > 0 ? (
                    <View style={styles.historyPhotosContainer}>
                      <Text style={styles.historyPhotosHeading}>
                        Photos associées ({obs.photos.length}) :
                      </Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.historyPhotosScroll}
                      >
                        {obs.photos.map((p, pIdx) => {
                          const fullUrl = getMediaUrl(p.url);
                          return (
                            <TouchableOpacity
                              key={p.id || pIdx}
                              activeOpacity={0.85}
                              onPress={() => setPreviewPhotoUrl(fullUrl)}
                            >
                              <Image
                                source={{ uri: fullUrl }}
                                style={styles.historyThumbnail}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyHistoryCard}>
            <Ionicons name="document-text-outline" size={32} color={Palette.textMuted} />
            <Text style={styles.emptyHistoryTitle}>Aucune observation enregistrée pour cette date.</Text>
            <Text style={styles.emptyHistorySub}>
              Sélectionnez une date marquée ou changez de mois.
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* ── OBSERVATION MODAL (GPS, Projection, Phase, Status, Comment & Photos) ── */}
      <Modal
        visible={isObsModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsObsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header with Hierarchy */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} weight="bold">
                  Nouvelle observation
                </Text>
                <Text style={styles.modalHierarchy}>
                  {troncon?.projet_nom} &bull; {troncon?.chantier_nom}
                </Text>
                <Text style={styles.modalTronconText}>
                  Tronçon : {troncon?.nom} ({formatPK(troncon?.pk_debut)} &rarr; {formatPK(troncon?.pk_fin)})
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setIsObsModalOpen(false)}
              >
                <Ionicons name="close" size={20} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Modal Content */}
            {isAcquiringGps || isComputingProjection ? (
              <View style={styles.gpsLoadingBox}>
                <ActivityIndicator size="large" color={Palette.primary} />
                <Text style={styles.gpsLoadingTitle} weight="bold">
                  {isAcquiringGps
                    ? '📡 Acquisition de la position GPS...'
                    : '📐 Projection orthogonale sur le tracé...'}
                </Text>
                <Text style={styles.gpsLoadingSub}>
                  Calcul géométrique métrique selon le système projeté marocain.
                </Text>
              </View>
            ) : gpsError ? (
              <View style={styles.gpsErrorBox}>
                <Ionicons name="alert-circle-outline" size={40} color="#DC2626" />
                <Text style={styles.gpsErrorTitle} weight="bold">
                  Erreur de géolocalisation
                </Text>
                <Text style={styles.gpsErrorText}>{gpsError}</Text>
                <Button
                  title="Réessayer la détection GPS"
                  variant="primary"
                  size="md"
                  onPress={handleRefreshGps}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : projectionResult ? (
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {/* ── Section A: LOCALISATION ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="location" size={16} color="#0284C7" />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      LOCALISATION
                    </Text>
                  </View>
                  <View style={styles.obsInfoCard}>
                    <Text style={styles.obsGpsDetectedText} weight="semibold">
                      Position GPS détectée
                    </Text>
                    <Text style={styles.obsGpsCoordsMono}>
                      Lat: {projectionResult.agent_location.latitude.toFixed(6)}, Lng:{' '}
                      {projectionResult.agent_location.longitude.toFixed(6)}
                    </Text>
                    <Text style={styles.obsGpsAccuracy}>
                      {"Précision GPS : ±"}{Math.round(projectionResult.agent_location.accuracy || 5)} mètres
                    </Text>
                    <View style={styles.obsDivider} />
                    <View style={styles.obsRow}>
                      <Text style={styles.obsRowLabel}>Position projetée sur tronçon :</Text>
                      <Text style={styles.obsRowValueMono}>
                        {projectionResult.projected_location.latitude.toFixed(6)},{' '}
                        {projectionResult.projected_location.longitude.toFixed(6)}
                      </Text>
                    </View>
                    <View style={styles.obsRow}>
                      <Text style={styles.obsRowLabel}>Distance depuis le début :</Text>
                      <Text style={styles.obsRowHighlight} weight="bold">
                        {projectionResult.distance_from_start_meters} m ({projectionResult.distance_from_start_km} km)
                      </Text>
                    </View>
                    <View style={styles.obsRow}>
                      <Text style={styles.obsRowLabel}>{"Déport (écart à l'axe) :"}</Text>
                      <Text style={styles.obsRowValue}>
                        {projectionResult.offset_distance_meters} m
                      </Text>
                    </View>
                  </View>
                </View>

                {projectionResult.requires_exceptional_confirmation ? (
                  <View style={styles.proximityWarning}>
                    <Text style={styles.proximityWarningTitle} weight="bold">{"⚠️ Vous êtes à "}{projectionResult.offset_distance_meters}{" m de l'infrastructure."}</Text>
                    <Text style={styles.proximityWarningText}>
                      La distance maximale recommandée pour ce chantier est de {projectionResult.d_max_position_meters} m.{"\n\n"}
                      Votre position réelle sera conservée et votre position projetée sur le tronçon sera utilisée pour calculer le métrage.
                    </Text>
                  </View>
                ) : null}

                {/* ── Section B: AVANCEMENT CALCULÉ AUTOMATIQUEMENT ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="pie-chart" size={16} color="#F59E0B" />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      AVANCEMENT SPATIAL CALCULÉ
                    </Text>
                  </View>
                  <View style={styles.progressResultCard}>
                    <Text style={styles.progressPercentLarge} weight="bold">
                      {projectionResult.progress_percentage} %
                    </Text>
                    <Text style={styles.progressCalculationNote}>
                      ({projectionResult.distance_from_start_meters} m / {projectionResult.total_length_meters} m) &bull; PK {projectionResult.calculated_pk}
                    </Text>
                    <View style={styles.progressBarBgModal}>
                      <View
                        style={[
                          styles.progressBarFillModal,
                          { width: `${projectionResult.progress_percentage}%` },
                        ]}
                      />
                    </View>
                  </View>
                </View>

                {/* ── Section C: PHASE DE CONSTRUCTION ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="construct" size={16} color={Palette.primary} />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      PHASE DE TRAVAUX
                    </Text>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillsScroll}>
                    {ALLOWED_PHASES.map((p) => {
                      const isSelected = selectedPhase === p;
                      return (
                        <TouchableOpacity
                          key={p}
                          style={[styles.pillBtn, isSelected && styles.pillBtnSelected]}
                          onPress={() => setSelectedPhase(p)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.pillBtnText, isSelected && styles.pillBtnTextSelected]} weight={isSelected ? 'bold' : 'normal'}>
                            {p}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* ── Section D: ÉTAT DE LA PHASE ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="flag" size={16} color="#10B981" />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      ÉTAT DE LA PHASE
                    </Text>
                  </View>
                  <View style={styles.statusChipsRow}>
                    {ALLOWED_PHASE_STATUSES.map((st) => {
                      const isSelected = selectedPhaseStatut === st;
                      const chipColor =
                        st === 'Terminée'
                          ? '#16A34A'
                          : st === 'En cours'
                          ? '#F59E0B'
                          : '#64748B';

                      return (
                        <TouchableOpacity
                          key={st}
                          style={[
                            styles.statusChipBtn,
                            isSelected && { backgroundColor: `${chipColor}20`, borderColor: chipColor, borderWidth: 2 },
                          ]}
                          onPress={() => setSelectedPhaseStatut(st)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.statusChipDot, { backgroundColor: chipColor }]} />
                          <Text
                            style={[
                              styles.statusChipText,
                              isSelected && { color: chipColor, fontWeight: 'bold' },
                            ]}
                          >
                            {st}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {/* ── Section E: OBSERVATION / REMARQUE ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="chatbox-ellipses" size={16} color="#6366F1" />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      OBSERVATION & COMMENTAIRE
                    </Text>
                  </View>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Ex : Coulage du radier terminé sur cette section, approvisionnement gravier en attente..."
                    placeholderTextColor={Palette.textMuted}
                    multiline
                    numberOfLines={3}
                    value={commentaire}
                    onChangeText={setCommentaire}
                  />
                </View>

                {/* ── Section F: PHOTOS TERRAIN ── */}
                <View style={styles.obsDataSection}>
                  <View style={styles.obsSectionTitleRow}>
                    <Ionicons name="camera" size={16} color="#EC4899" />
                    <Text style={styles.obsSectionTitle} weight="bold">
                      PHOTOS TERRAIN ({selectedPhotos.length})
                    </Text>
                  </View>

                  {/* Photo Action Buttons */}
                  <View style={styles.photoActionButtonsRow}>
                    <TouchableOpacity
                      style={styles.addPhotoBtn}
                      onPress={handleTakePhoto}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="camera-outline" size={18} color={Palette.primary} />
                      <Text style={styles.addPhotoBtnText} weight="semibold">
                        Prendre une photo
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.addPhotoBtn}
                      onPress={handlePickFromGallery}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="images-outline" size={18} color={Palette.primary} />
                      <Text style={styles.addPhotoBtnText} weight="semibold">
                        Depuis la galerie
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Selected Photos Preview Scroll */}
                  {selectedPhotos.length > 0 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.selectedPhotosScroll}
                    >
                      {selectedPhotos.map((photo, index) => (
                        <View key={index} style={styles.selectedPhotoWrapper}>
                          <Image
                            source={{ uri: photo.uri }}
                            style={styles.selectedPhotoThumb}
                            resizeMode="cover"
                          />
                          <TouchableOpacity
                            style={styles.removePhotoBadge}
                            onPress={() => handleRemovePhoto(index)}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.noPhotosText}>
                      Aucune photo sélectionnée (optionnel).
                    </Text>
                  )}
                </View>

                {/* ── Modal Footer Actions ── */}
                <View style={styles.modalActionsRow}>
                  <TouchableOpacity
                    style={styles.refreshGpsBtn}
                    onPress={handleRefreshGps}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="refresh" size={16} color={Palette.primary} />
                    <Text style={styles.refreshGpsText} weight="semibold">
                      {projectionResult.requires_exceptional_confirmation ? 'Réessayer ma position' : 'GPS'}
                    </Text>
                  </TouchableOpacity>

                  <Button
                    title={isSubmittingObs ? "Enregistrement..." : projectionResult.requires_exceptional_confirmation ? "Valider exceptionnellement" : "Confirmer l'observation"}
                    variant="primary"
                    size="md"
                    style={{ flex: 1 }}
                    disabled={isSubmittingObs}
                    onPress={() => handleConfirmObservation(projectionResult.requires_exceptional_confirmation)}
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* ── FULL SCREEN PHOTO PREVIEW MODAL ── */}
      <Modal
        visible={!!previewPhotoUrl}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewPhotoUrl(null)}
      >
        <View style={styles.photoPreviewOverlay}>
          <TouchableOpacity
            style={styles.closePhotoPreviewBtn}
            onPress={() => setPreviewPhotoUrl(null)}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          {previewPhotoUrl ? (
            <Image
              source={{ uri: previewPhotoUrl }}
              style={styles.photoPreviewImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
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
    alignItems: 'flex-start',
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
    marginTop: 2,
  },
  agentTagRow: {
    marginBottom: 4,
  },
  agentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  agentBadgeText: {
    fontSize: 10,
    color: '#0D9488',
    letterSpacing: 0.5,
  },
  hierarchyText: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 18,
    color: Palette.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 50,
  },
  mapCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  mapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mapHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapCardTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statutDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statutBadgeText: {
    fontSize: 11,
  },

  /* Action Hero Card */
  actionHeroCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(23, 107, 91, 0.3)',
    shadowColor: Palette.primary,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  actionHeroRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  actionHeroIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionHeroTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  actionHeroSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
  declareBtn: {
    width: '100%',
  },

  /* Latest Obs Card */
  latestObsCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#16A34A',
  },
  latestObsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  latestObsIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  latestObsHeading: {
    fontSize: 13,
    color: Palette.text,
  },
  latestObsDate: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  progressPillBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  progressPillText: {
    fontSize: 13,
    color: '#16A34A',
  },
  latestObsDetailsRow: {
    marginBottom: 10,
  },
  phaseBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  phaseTag: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  phaseTagText: {
    fontSize: 11,
    color: Palette.primary,
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusTagText: {
    fontSize: 11,
  },
  obsCommentText: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
    marginTop: 4,
  },
  latestObsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
  },
  latestObsMetric: {
    alignItems: 'center',
  },
  obsMetricLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    marginBottom: 2,
  },
  obsMetricVal: {
    fontSize: 12,
    color: Palette.text,
  },

  /* Technical Summary Card */
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  summaryCardHeading: {
    fontSize: 14,
    color: Palette.text,
  },
  summaryAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 38,
  },
  summaryGrid: {
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  summaryValue: {
    fontSize: 12,
    color: Palette.text,
    textAlign: 'right',
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Palette.primary,
    borderRadius: 3,
  },

  /* History Section */
  historySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  historySectionTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  historyList: {
    gap: 12,
    marginBottom: 16,
  },
  historyCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  historyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  historyAgentName: {
    fontSize: 13,
    color: Palette.text,
  },
  historyDate: {
    fontSize: 10,
    color: Palette.textMuted,
    marginTop: 1,
  },
  historyProgressBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  historyProgressText: {
    fontSize: 12,
    color: '#B45309',
  },
  historyTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  historyPhaseTag: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  historyPhaseText: {
    fontSize: 11,
    color: Palette.primary,
  },
  historyStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  historyStatusText: {
    fontSize: 11,
  },
  historyDistanceText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  proximityWarning: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FB923C',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  proximityWarningTitle: {
    color: '#9A3412',
    fontSize: 13,
    marginBottom: 6,
  },
  proximityWarningText: {
    color: '#7C2D12',
    fontSize: 12,
    lineHeight: 18,
  },
  historyComment: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
  },
  historyPhotosContainer: {
    marginTop: 4,
  },
  historyPhotosHeading: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  historyPhotosScroll: {
    gap: 8,
  },
  historyThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  emptyHistoryCard: {
    padding: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyHistoryTitle: {
    fontSize: 14,
    color: Palette.text,
    fontWeight: 'bold',
    marginTop: 8,
  },
  emptyHistorySub: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  /* Affectation Card */
  affectationCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#0D9488',
  },
  affectationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
  },
  affectationTitle: {
    flex: 1,
    fontSize: 14,
    color: Palette.text,
  },
  activePill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  activePillText: {
    fontSize: 10,
    color: '#16A34A',
  },
  affectationBody: {
    gap: 8,
  },
  affectationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  affectationLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  affectationValue: {
    fontSize: 12,
    color: Palette.text,
  },
  notesBox: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  notesLabel: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 2,
  },
  notesText: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
  },
  contactActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  contactBtnText: {
    fontSize: 11,
    color: Palette.primary,
  },

  /* Observation Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  modalHierarchy: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  modalTronconText: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
  },
  gpsLoadingBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsLoadingTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 14,
  },
  gpsLoadingSub: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  gpsErrorBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsErrorTitle: {
    fontSize: 15,
    color: '#DC2626',
    marginTop: 8,
  },
  gpsErrorText: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  modalScroll: {
    maxHeight: 520,
  },
  obsDataSection: {
    marginBottom: 14,
  },
  obsSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  obsSectionTitle: {
    fontSize: 12,
    color: '#475569',
    letterSpacing: 0.5,
  },
  obsInfoCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 4,
  },
  obsGpsDetectedText: {
    fontSize: 12,
    color: '#0284C7',
  },
  obsGpsCoordsMono: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Palette.text,
  },
  obsGpsAccuracy: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  obsDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  obsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  obsRowLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  obsRowValue: {
    fontSize: 11,
    color: Palette.text,
  },
  obsRowValueMono: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Palette.text,
  },
  obsRowHighlight: {
    fontSize: 12,
    color: '#8B5CF6',
  },
  progressResultCard: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
  },
  progressPercentLarge: {
    fontSize: 26,
    color: '#92400E',
  },
  progressCalculationNote: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 2,
    marginBottom: 6,
  },
  progressBarBgModal: {
    width: '100%',
    height: 7,
    backgroundColor: '#FDE68A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFillModal: {
    height: '100%',
    backgroundColor: '#D97706',
    borderRadius: 4,
  },

  /* Phase & Status Pills */
  pillsScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pillBtnSelected: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  pillBtnText: {
    fontSize: 12,
    color: Palette.text,
  },
  pillBtnTextSelected: {
    color: '#FFFFFF',
  },
  statusChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statusChipBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusChipText: {
    fontSize: 12,
    color: Palette.text,
  },

  /* Comment Input */
  commentInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: Palette.text,
    minHeight: 70,
    textAlignVertical: 'top',
  },

  /* Photos in Modal */
  photoActionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  addPhotoBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.2)',
    paddingVertical: 8,
    borderRadius: 10,
  },
  addPhotoBtnText: {
    fontSize: 11,
    color: Palette.primary,
  },
  selectedPhotosScroll: {
    gap: 10,
    paddingVertical: 4,
  },
  selectedPhotoWrapper: {
    position: 'relative',
  },
  selectedPhotoThumb: {
    width: 68,
    height: 68,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  removePhotoBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  noPhotosText: {
    fontSize: 11,
    color: Palette.textMuted,
    fontStyle: 'italic',
  },

  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 10,
  },
  refreshGpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: '#F8FAFC',
  },
  refreshGpsText: {
    fontSize: 12,
    color: Palette.primary,
  },

  /* Photo Preview Overlay */
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePhotoPreviewBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  photoPreviewImage: {
    width: '94%',
    height: '80%',
  },
});
