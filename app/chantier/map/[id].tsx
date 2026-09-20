import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import {
  api,
  getMediaUrl,
  ReferenceAlignment,
  TronconItem,
  ChantierObservationHistoryItem,
  ChantierAvancementResponse,
} from '@/services/api';
import {
  InteractiveGisMap,
  InteractiveGisMapRef,
  GisTronconSegment,
  TRONCON_PALETTE,
} from '@/components/gis/InteractiveGisMap';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function formatObservationDateFrench(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const [datePart, timePart] = dateStr.split(' ');
    if (!datePart || !datePart.includes('-')) return dateStr;
    const parts = datePart.split('-').map(Number);
    if (parts.length !== 3 || isNaN(parts[0])) return dateStr;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dateFormatted = `${d.getDate()} ${MONTH_NAMES_FR[d.getMonth()]} ${d.getFullYear()}`;
    return timePart ? `${dateFormatted} • ${timePart}` : dateFormatted;
  } catch {
    return dateStr;
  }
}

export default function ChantierObservationMapScreen() {
  const { id, tronconId, observationId } = useLocalSearchParams<{
    id: string;
    tronconId?: string;
    observationId?: string;
  }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();
  const mapRef = useRef<InteractiveGisMapRef | null>(null);

  // Data states
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chantierNom, setChantierNom] = useState<string>('Chantier');
  const [activeReference, setActiveReference] = useState<ReferenceAlignment | null>(null);
  const [troncons, setTroncons] = useState<TronconItem[]>([]);
  const [allObservations, setAllObservations] = useState<ChantierObservationHistoryItem[]>([]);

  // Selection states
  const [selectedTronconId, setSelectedTronconId] = useState<number | null>(
    tronconId ? Number(tronconId) : null
  );
  const [selectedObsId, setSelectedObsId] = useState<number | null>(
    observationId ? Number(observationId) : null
  );
  const [isDetailModalVisible, setIsDetailModalVisible] = useState(false);

  // Load GIS layers and observations
  const loadData = useCallback(async () => {
    if (!token || !id) return;
    setIsLoading(true);
    setLoadError(null);

    try {
      const [avancementRes, refRes, tronconsRes] = await Promise.allSettled([
        api.getChantierAvancement(token, id),
        api.getReferenceAlignment(token, id),
        api.getChantierTroncons(token, id),
      ]);

      if (avancementRes.status === 'fulfilled') {
        const avData: ChantierAvancementResponse = avancementRes.value;
        setChantierNom(avData.chantier?.nom || `Chantier ${id}`);
        setAllObservations(avData.historique?.observations || []);
      }

      if (refRes.status === 'fulfilled') {
        setActiveReference(refRes.value.reference_alignment);
      }

      let loadedTroncons: TronconItem[] = [];
      if (tronconsRes.status === 'fulfilled') {
        loadedTroncons = tronconsRes.value.troncons || [];
        setTroncons(loadedTroncons);
      }

      // Resolve initial selection
      const obsList = avancementRes.status === 'fulfilled' ? (avancementRes.value.historique?.observations || []) : [];
      let targetObsId = observationId ? Number(observationId) : null;
      let targetTronconId = tronconId ? Number(tronconId) : null;

      if (targetObsId) {
        const matchingObs = obsList.find((o) => o.id === targetObsId);
        if (matchingObs) {
          targetTronconId = matchingObs.troncon_id;
        }
      } else if (targetTronconId) {
        targetObsId = null;
      } else if (loadedTroncons.length > 0) {
        targetTronconId = loadedTroncons[0].id ?? null;
        targetObsId = null;
      }

      setSelectedObsId(targetObsId);
      setSelectedTronconId(targetTronconId);
    } catch (err: any) {
      setLoadError(err.message || 'Impossible de charger les données cartographiques du chantier.');
    } finally {
      setIsLoading(false);
    }
  }, [token, id, tronconId, observationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Active selected Tronçon object
  const activeTroncon = useMemo(() => {
    return troncons.find((t) => Number(t.id) === Number(selectedTronconId)) || troncons[0] || null;
  }, [troncons, selectedTronconId]);

  // Observations relevant to the active tronçon (or all if tronçon not selected)
  const tronconObservations = useMemo(() => {
    if (!selectedTronconId) return allObservations;
    return allObservations.filter((o) => Number(o.troncon_id) === Number(selectedTronconId));
  }, [allObservations, selectedTronconId]);

  // Currently focused observation (null if in overview mode)
  const activeObservation = useMemo(() => {
    if (selectedObsId) {
      const found = allObservations.find((o) => Number(o.id) === Number(selectedObsId));
      if (found) return found;
    }
    return null;
  }, [allObservations, selectedObsId]);

  // Map tronçons with styling
  const mapTroncons: GisTronconSegment[] = useMemo(() => {
    return troncons.map((t, idx) => {
      const isSelected = selectedTronconId ? Number(t.id) === Number(selectedTronconId) : idx === 0;
      const color = TRONCON_PALETTE[idx % TRONCON_PALETTE.length];
      return {
        id: t.id,
        nom: t.nom,
        pk_debut: Number(t.pk_debut || 0),
        pk_fin: Number(t.pk_fin || 0),
        statut: t.statut,
        length_km: t.length_km ? Number(t.length_km) : undefined,
        geometry: t.geometry,
        color,
        isPrimary: isSelected,
        isSecondary: !isSelected,
        progress_percentage: t.avancement,
      };
    });
  }, [troncons, selectedTronconId]);

  // Custom Markers on the map (Authoritative coordinates only)
  const mapMarkers: NonNullable<React.ComponentProps<typeof InteractiveGisMap>['customMarkers']> = useMemo(() => {
    return tronconObservations
      .filter((obs) => {
        const lat = obs.projected_lat != null ? Number(obs.projected_lat) : (obs.agent_lat != null ? Number(obs.agent_lat) : null);
        const lng = obs.projected_lng != null ? Number(obs.projected_lng) : (obs.agent_lng != null ? Number(obs.agent_lng) : null);
        return lat !== null && lng !== null && isFinite(lat) && isFinite(lng);
      })
      .map((obs) => {
        const lat = Number(obs.projected_lat != null ? obs.projected_lat : obs.agent_lat);
        const lng = Number(obs.projected_lng != null ? obs.projected_lng : obs.agent_lng);
        const isSelected = activeObservation ? Number(obs.id) === Number(activeObservation.id) : false;
        return {
          id: obs.id,
          lat,
          lng,
          color: isSelected ? '#F59E0B' : '#64748B',
          label: `PK ${obs.chainage || '—'}`,
          photoUrl: obs.photos?.[0]?.url ? getMediaUrl(obs.photos[0].url) : undefined,
          dateTime: obs.date_heure,
          phase: obs.phase || undefined,
        };
      });
  }, [tronconObservations, activeObservation]);

  // Handle marker selection
  const handleSelectMarker = useCallback((markerId: number | string) => {
    const numericId = Number(markerId);
    setSelectedObsId(numericId);
    const selected = allObservations.find((o) => Number(o.id) === numericId);
    if (selected && selected.troncon_id && Number(selected.troncon_id) !== Number(selectedTronconId)) {
      setSelectedTronconId(selected.troncon_id);
    }
  }, [allObservations, selectedTronconId]);

  // Center on active observation
  const handleRecenter = useCallback(() => {
    mapRef.current?.recenter?.();
  }, []);

  // Toggle map style (satellite / streets)
  const handleToggleSatellite = useCallback(() => {
    mapRef.current?.toggleSatellite?.();
  }, []);

  const heroPhotoUrl = activeObservation?.photos?.[0]?.url
    ? getMediaUrl(activeObservation.photos[0].url)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── Top Bar Header (Screen 2 & 4 of UX Specification) ── */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={Palette.text} />
        </TouchableOpacity>

        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} weight="bold" numberOfLines={1}>
            {chantierNom}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {activeObservation
              ? "Localisation de l'observation"
              : `Vue d'ensemble • ${tronconObservations.length} relevé${tronconObservations.length > 1 ? 's' : ''}`}
          </Text>
        </View>

        <View style={styles.headerRightActions}>
          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleRecenter}
            activeOpacity={0.7}
            accessibilityLabel="Recentrer sur l'observation"
          >
            <Ionicons name="locate-outline" size={20} color={Palette.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionBtn}
            onPress={handleToggleSatellite}
            activeOpacity={0.7}
            accessibilityLabel="Changer de vue cartographique"
          >
            <Ionicons name="layers-outline" size={20} color={Palette.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main Map Area ── */}
      <View style={styles.mapContainer}>
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Palette.primary} />
            <Text style={styles.loadingText} weight="medium">
              Chargement de la géométrie et des observations…
            </Text>
          </View>
        ) : loadError ? (
          <View style={styles.errorContainer}>
            <Ionicons name="alert-circle-outline" size={38} color="#DC2626" />
            <Text style={styles.errorText} weight="semibold">
              {loadError}
            </Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadData}>
              <Text style={styles.retryBtnText} weight="bold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <InteractiveGisMap
              ref={mapRef}
              referenceGeometry={activeReference?.geometry}
              troncons={mapTroncons.length > 0 ? mapTroncons : null}
              selectedTronconId={selectedTronconId || undefined}
              onSelectTroncon={(tId) => setSelectedTronconId(Number(tId))}
              customMarkers={mapMarkers}
              selectedMarkerId={activeObservation?.id || null}
              onSelectMarker={handleSelectMarker}
              height="100%"
              optimizePkLabels
              fitPaddingBottom={120}
            />

            {/* ── Floating Callout Card for Active Observation (Screens 2 & 4) ── */}
            {activeObservation && (
              <View style={styles.floatingCalloutWrapper} pointerEvents="box-none">
                <Card variant="elevated" style={styles.calloutCard}>
                  {/* Close button to return to overview */}
                  <TouchableOpacity
                    style={styles.calloutCloseBtn}
                    onPress={() => setSelectedObsId(null)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={16} color={Palette.textMuted} />
                  </TouchableOpacity>

                  <View style={styles.calloutRow}>
                    {/* Thumbnail Photo */}
                    <TouchableOpacity
                      activeOpacity={0.88}
                      onPress={() => setIsDetailModalVisible(true)}
                      style={styles.calloutThumbContainer}
                    >
                      {heroPhotoUrl ? (
                        <Image
                          source={{ uri: heroPhotoUrl }}
                          style={styles.calloutThumbImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.calloutThumbPlaceholder}>
                          <Ionicons name="camera-outline" size={22} color="#94A3B8" />
                        </View>
                      )}
                    </TouchableOpacity>

                    {/* Metadata Content */}
                    <View style={styles.calloutContent}>
                      <Text style={styles.calloutDateText} weight="bold">
                        {formatObservationDateFrench(activeObservation.date_heure)}
                      </Text>

                      <View style={styles.calloutCodePkRow}>
                        <Text style={styles.calloutCodePkText} weight="semibold">
                          {activeObservation.troncon_code || 'T1'} — PK {activeObservation.chainage || '—'}
                        </Text>
                      </View>

                      <Text style={styles.calloutAgentText} numberOfLines={1}>
                        {activeObservation.agent_nom || 'Agent Terrain'}
                      </Text>

                      {Boolean(activeObservation.phase) && (
                        <Text style={styles.calloutPhaseText} numberOfLines={1}>
                          {activeObservation.phase}
                          {activeObservation.phase_statut ? ` (${activeObservation.phase_statut})` : ''}
                        </Text>
                      )}

                      <TouchableOpacity
                        style={styles.calloutActionLink}
                        onPress={() => setIsDetailModalVisible(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.calloutActionLinkText} weight="bold">
                          Voir le relevé →
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Card>
              </View>
            )}

            {/* ── Floating Legend Card (Bottom-Left) ── */}
            <View style={styles.floatingLegendCard} pointerEvents="none">
              <View style={styles.legendRow}>
                <View
                  style={[
                    styles.legendLineSwatch,
                    { backgroundColor: mapTroncons[0]?.color || '#10B981' },
                  ]}
                />
                <Text style={styles.legendText}>
                  {activeTroncon?.nom || 'Tronçon 1'} ({activeObservation?.troncon_code || 'T1'})
                </Text>
              </View>

              {activeObservation ? (
                <>
                  <View style={styles.legendRow}>
                    <View style={styles.legendPinSwatch}>
                      <Ionicons name="location" size={13} color="#F59E0B" />
                    </View>
                    <Text style={styles.legendText}>Photo sélectionnée</Text>
                  </View>

                  {tronconObservations.length > 1 && (
                    <View style={styles.legendRow}>
                      <View style={styles.legendDotSwatch} />
                      <Text style={styles.legendText}>Autres photos (même tronçon)</Text>
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.legendRow}>
                  <View style={styles.legendDotSwatch} />
                  <Text style={styles.legendText}>
                    Photos du tronçon ({tronconObservations.length})
                  </Text>
                </View>
              )}
            </View>

            {/* ── Bottom Sheet Card (Chantier + Tronçon info) ── */}
            <View style={styles.bottomCardContainer}>
              <View style={styles.dragHandle} />
              <View style={styles.bottomCardContent}>
                <View style={styles.bottomCardLeft}>
                  <Text style={styles.bottomChantierNom} weight="bold">
                    {chantierNom}
                  </Text>
                  <Text style={styles.bottomTronconNom}>
                    {activeObservation?.troncon_code ? `${activeObservation.troncon_code} — ` : ''}
                    {activeTroncon?.nom || 'Tronçon'}
                  </Text>
                </View>

                <View style={styles.bottomCardRight}>
                  <Text style={styles.bottomTronconLength} weight="bold">
                    {activeTroncon?.length_km
                      ? `${Number(activeTroncon.length_km).toFixed(3)} km`
                      : activeTroncon?.length_meters
                      ? `${(Number(activeTroncon.length_meters) / 1000).toFixed(3)} km`
                      : '—'}
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}
      </View>

      {/* ── Detail Relevé Modal ── */}
      <Modal
        visible={isDetailModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsDetailModalVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheetContainer}>
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetTitle} weight="bold">
                  Détail du relevé de terrain
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {activeObservation?.troncon_nom} • {activeObservation?.troncon_code}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsDetailModalVisible(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {activeObservation && (
              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                {/* Meta Grid */}
                <View style={styles.releveMetaCard}>
                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Date et heure</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {formatObservationDateFrench(activeObservation.date_heure)}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Agent de terrain</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {activeObservation.agent_nom || 'Non affecté'}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Chaînage PK</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {activeObservation.chainage ? `PK ${activeObservation.chainage}` : '—'}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Phase de travaux</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {activeObservation.phase || '—'}
                      {activeObservation.phase_statut ? ` (${activeObservation.phase_statut})` : ''}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Avancement déclaré</Text>
                    <Text style={styles.releveMetaValue} weight="bold">
                      {activeObservation.progress_percentage}%
                    </Text>
                  </View>
                </View>

                {/* Comment */}
                {Boolean(activeObservation.commentaire) && (
                  <View style={styles.releveCommentSection}>
                    <Text style={styles.releveCommentLabel}>Commentaire</Text>
                    <View style={styles.commentQuoteBox}>
                      <Text style={styles.commentQuoteText}>
                        « {activeObservation.commentaire} »
                      </Text>
                    </View>
                  </View>
                )}

                {/* Photos */}
                {activeObservation.photos && activeObservation.photos.length > 0 && (
                  <View style={styles.relevePhotosSection}>
                    <Text style={styles.releveCommentLabel}>
                      Photographies ({activeObservation.photos.length})
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relevePhotosRow}>
                      {activeObservation.photos.map((p, pIdx) => (
                        <View key={p.id || pIdx} style={styles.relevePhotoThumb}>
                          <Image
                            source={{ uri: getMediaUrl(p.url) }}
                            style={{ width: '100%', height: '100%', borderRadius: 8 }}
                            resizeMode="cover"
                          />
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.sheetCloseBtn}
                onPress={() => setIsDetailModalVisible(false)}
              >
                <Text style={styles.sheetCloseBtnText} weight="bold">
                  Fermer
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
    zIndex: 20,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  headerTitleContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 8,
  },
  headerTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Map area
  mapContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Palette.primary,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
  },

  // ── Floating Callout Card (Screens 2 & 4)
  floatingCalloutWrapper: {
    position: 'absolute',
    top: 14,
    left: 16,
    right: 16,
    zIndex: 100,
    alignItems: 'center',
  },
  calloutCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
  },
  calloutCloseBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  calloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  calloutThumbContainer: {
    width: 78,
    height: 78,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  calloutThumbImage: {
    width: '100%',
    height: '100%',
  },
  calloutThumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calloutContent: {
    flex: 1,
  },
  calloutDateText: {
    fontSize: 13,
    color: Palette.text,
  },
  calloutCodePkRow: {
    marginTop: 2,
  },
  calloutCodePkText: {
    fontSize: 12,
    color: '#D97706',
  },
  calloutAgentText: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  calloutPhaseText: {
    fontSize: 11,
    color: Palette.textLight,
    marginTop: 1,
  },
  calloutActionLink: {
    marginTop: 4,
  },
  calloutActionLinkText: {
    fontSize: 12,
    color: Palette.primary,
  },

  // ── Floating Legend Card
  floatingLegendCard: {
    position: 'absolute',
    bottom: 84,
    left: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    gap: 6,
    zIndex: 90,
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendLineSwatch: {
    width: 14,
    height: 4,
    borderRadius: 2,
  },
  legendPinSwatch: {
    width: 14,
    alignItems: 'center',
  },
  legendDotSwatch: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#64748B',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  legendText: {
    fontSize: 11,
    color: '#F8FAFC',
    fontWeight: '500',
  },

  // ── Bottom Card Sheet
  bottomCardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    zIndex: 80,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    alignSelf: 'center',
    marginBottom: 8,
  },
  bottomCardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bottomCardLeft: {
    flex: 1,
  },
  bottomChantierNom: {
    fontSize: 14,
    color: Palette.text,
  },
  bottomTronconNom: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  bottomCardRight: {
    alignItems: 'flex-end',
  },
  bottomTronconLength: {
    fontSize: 13,
    color: Palette.primary,
  },

  // ── Bottom Sheet Modals
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  sheetTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  sheetSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  sheetBody: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  releveMetaCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  releveMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  releveMetaLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  releveMetaValue: {
    fontSize: 12,
    color: Palette.text,
  },
  releveCommentSection: {
    marginTop: 14,
  },
  releveCommentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.textMuted,
    marginBottom: 6,
  },
  commentQuoteBox: {
    backgroundColor: '#F0FDF4',
    borderLeftWidth: 3,
    borderLeftColor: Palette.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  commentQuoteText: {
    fontSize: 12,
    color: '#166534',
    fontStyle: 'italic',
  },
  relevePhotosSection: {
    marginTop: 14,
  },
  relevePhotosRow: {
    flexDirection: 'row',
    gap: 10,
  },
  relevePhotoThumb: {
    width: 90,
    height: 90,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sheetCloseBtn: {
    backgroundColor: Palette.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  sheetCloseBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
