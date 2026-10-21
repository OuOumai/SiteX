import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, ChantierDetails, ChantierTroncon, ChantierTimelineResponse, KmlMetadata, ReferenceAlignment } from '@/services/api';
import { InteractiveGisMap, GisTronconSegment } from '@/components/gis/InteractiveGisMap';
import { InteractiveGis3DMap } from '@/components/gis/InteractiveGis3DMap';
import { ChantierTimeline } from '@/components/gis/ChantierTimeline';
import {
  TemporalViewState,
  DerivedTemporalState,
  deriveTemporalState,
  makeCurrentTemporalState,
  formatTemporalDateShort,
} from '@/lib/temporal';

function formatPK(val?: number | null): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}`;
}

function formatDate(val?: string | null): string {
  if (!val) return '—';
  if (val.includes('T')) return val.split('T')[0];
  return val;
}

function getSourceFormatInfo(refAlign?: ReferenceAlignment | null): {
  format: 'KML' | 'GeoJSON' | string;
  isKml: boolean;
} {
  if (!refAlign) {
    return { format: 'Inconnu', isKml: false };
  }
  const filename = (refAlign.original_filename || '').trim();
  const lowerName = filename.toLowerCase();
  const isKml =
    Boolean(refAlign.kml_metadata) ||
    lowerName.endsWith('.kml') ||
    refAlign.source?.toUpperCase() === 'KML';

  if (isKml) {
    return {
      format: 'KML',
      isKml: true,
    };
  }

  return {
    format: 'GeoJSON',
    isKml: false,
  };
}

function formatCrsDisplay(refAlign?: ReferenceAlignment | null): string {
  if (!refAlign) return 'EPSG:4326 (WGS 84)';
  const srid = refAlign.source_srid || 4326;
  const name = refAlign.source_crs_name || 'WGS 84';
  if (name.includes('EPSG:')) {
    return name;
  }
  if (srid === 4326) {
    return 'EPSG:4326 (WGS 84)';
  }
  return `EPSG:${srid} (${name})`;
}

export default function ChantierDetailResponsableScreen() {
  const { chantierId } = useLocalSearchParams<{ chantierId: string }>();
  const router = useRouter();
  const { token } = useAuth();

  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dMaxPosition, setDMaxPosition] = useState('50');
  const [isSavingDMax, setIsSavingDMax] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isManaging, setIsManaging] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [metadataExpanded, setMetadataExpanded] = useState(false);
  const [tronconsExpanded, setTronconsExpanded] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // ── Level 6B: Temporal synchronization state ──────────────────────────────
  /**
   * Raw temporal selection from ChantierTimeline.
   * Starts in 'current' mode (no filtering).
   */
  const [temporalView, setTemporalView] = useState<TemporalViewState>(
    makeCurrentTemporalState()
  );
  /**
   * Cached full timeline data so we can derive state without re-fetching.
   * Populated from ChantierTimeline's internal load via a shared callback.
   */
  const [timelineData, setTimelineData] = useState<ChantierTimelineResponse | null>(null);
  /** 2D/3D toggle for the GIS monitoring section */
  const [gisMonitorMode, setGisMonitorMode] = useState<'2d' | '3d'>('2d');

  /**
   * Single derived temporal state shared by BOTH maps.
   * Recomputes only when temporalView or timelineData changes.
   */
  const derivedTemporal: DerivedTemporalState = useMemo(
    () => deriveTemporalState(temporalView, timelineData),
    [temporalView, timelineData]
  );

  /**
   * Called by ChantierTimeline whenever the user changes the selection.
   * Updates temporalView; derivedTemporal is then recomputed.
   * Does NOT reset camera/zoom/rotation.
   */
  const handleTemporalChange = useCallback((state: TemporalViewState) => {
    setTemporalView(state);
  }, []);

  /** Resets to live 'current' view */
  const resetToCurrentView = useCallback(() => {
    setTemporalView(makeCurrentTemporalState());
  }, []);
  const showChantierList = () => {
    if (chantier?.projet_id) router.replace(`/responsable/projet/${chantier.projet_id}` as any);
    else router.replace('/(tabs)/projects' as any);
  };

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !chantierId) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);

    try {
      const res = await api.getChantierDetails(token, chantierId);
      if (res.chantier?.reference_alignment && !res.chantier.reference_alignment.kml_metadata) {
        try {
          const refRes = await api.getReferenceAlignment(token, chantierId);
          if (refRes?.reference_alignment?.kml_metadata) {
            res.chantier.reference_alignment.kml_metadata = refRes.reference_alignment.kml_metadata;
          }
        } catch {
          // ignore fallback error
        }
      }
      setChantier(res.chantier);
      setDMaxPosition(String(res.chantier.d_max_position_meters ?? 50));
      setNewName(res.chantier.nom || '');
    } catch (err: any) {
      setLoadError(err.message || 'Impossible de charger le chantier.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, chantierId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const saveDMax = async () => {
    if (!token || !chantierId) return;
    const value = Number(dMaxPosition);
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert('Valeur invalide', 'Saisissez une distance strictement positive en mètres.');
      return;
    }
    setIsSavingDMax(true);
    try {
      await api.updateChantierConfiguration(token, chantierId, { d_max_position_meters: value });
      setChantier((current) => current ? { ...current, d_max_position_meters: value } : current);
      Alert.alert('Configuration enregistrée', 'La distance maximale recommandée a été mise à jour.');
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de mettre à jour la configuration.');
    } finally {
      setIsSavingDMax(false);
    }
  };

  const renameChantier = async () => {
    if (!token || !chantierId || !newName.trim()) return;
    setIsManaging(true);
    try {
      const result = await api.renameResponsableChantier(token, chantierId, newName.trim());
      setChantier((current) => current ? { ...current, nom: result.chantier.nom } : current);
      setIsRenaming(false);
      if (Platform.OS === 'web') {
        window.alert(result.message);
        showChantierList();
      } else {
        Alert.alert('Chantier renommé', result.message, [{ text: 'OK', onPress: showChantierList }]);
      }
    } catch (err: any) { Alert.alert('Erreur', err.message || 'Impossible de renommer le chantier.'); }
    finally { setIsManaging(false); }
  };

  const deleteChantier = async () => {
      if (!token || !chantierId) return;
      setIsManaging(true);
      try {
        const result = await api.deleteResponsableChantier(token, chantierId);
        if (Platform.OS === 'web') {
          window.alert(result.message);
          showChantierList();
        } else {
          Alert.alert('Chantier supprimé', result.message, [{ text: 'OK', onPress: showChantierList }]);
        }
      } catch (err: any) { setIsManaging(false); Alert.alert('Erreur', err.message || 'Impossible de supprimer le chantier.'); }
  };

  const confirmDeleteChantier = () => {
    const message = `Cette action supprimera définitivement « ${chantier?.nom || ''} », tous ses tronçons, observations et données associées.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`Supprimer le chantier ?\n\n${message}`)) void deleteChantier();
      return;
    }
    Alert.alert('Supprimer le chantier ?', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: deleteChantier },
    ]);
  };

  if (isLoading && !chantier) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement du chantier...</Text>
      </SafeAreaView>
    );
  }

  if (!chantier && loadError) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Ionicons name="cloud-offline-outline" size={44} color="#DC2626" />
        <Text style={styles.loadingText}>{loadError}</Text>
        <Button title="Réessayer" onPress={() => fetchDetails()} style={{ marginTop: 16 }} />
        <Button title="Retour" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
      </SafeAreaView>
    );
  }

  const troncons = chantier?.troncons || [];
  const isGisReady = chantier?.gis_status === 'PRET_POUR_SUIVI';
  const hasAlignment = chantier?.gis_status === 'ALIGNEMENT_IMPORTE';

  const mapSegments: GisTronconSegment[] = troncons.map((t: any, idx: number) => ({
    id: t.id || idx + 1,
    nom: t.nom,
    pk_debut: t.pk_debut,
    pk_fin: t.pk_fin,
    statut: t.statut || 'NON_COMMENCE',
    length_km: t.length_km,
    geometry: t.geometry,
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.parentProjectText}>
            Projet : {chantier?.projet_nom || 'Projet'}
          </Text>
          <Text variant="h1" style={styles.headerTitle}>
            {chantier?.nom}
          </Text>
        </View>
      </View>

      <ScrollView
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
        {/* Status & GIS Badge */}
        <Card variant="elevated" style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={{ flex: 1 }}>
              <Text variant="h2" style={styles.chantierNameTitle}>
                {chantier?.nom}
              </Text>
              <Text style={styles.statutLabel}>
                ● {chantier?.statut || 'En attente'}
              </Text>
            </View>

            <View
              style={[
                styles.gisBadge,
                isGisReady
                  ? styles.gisBadgeReady
                  : hasAlignment
                  ? styles.gisBadgeImported
                  : styles.gisBadgeUnset,
              ]}
            >
              <Ionicons
                name={isGisReady ? 'checkmark-circle' : hasAlignment ? 'git-branch' : 'ellipse-outline'}
                size={12}
                color={isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706'}
              />
              <Text
                style={[
                  styles.gisBadgeText,
                  { color: isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706' },
                ]}
                weight="semibold"
              >
                {isGisReady ? 'Configuré' : hasAlignment ? 'Alignement prêt' : 'À configurer'}
              </Text>
            </View>
          </View>
          {isRenaming && (
            <View style={styles.renameBox}>
              <Input label="Nouveau nom du chantier" value={newName} onChangeText={setNewName} />
              <View style={styles.manageActions}>
                <Button title="Annuler" variant="ghost" size="sm" onPress={() => setIsRenaming(false)} />
                <Button title="Enregistrer" size="sm" loading={isManaging} onPress={renameChantier} />
              </View>
            </View>
          )}
          {!isRenaming && (
            <View style={styles.manageActions}>
              <Button title="Renommer" variant="outline" size="sm" onPress={() => setIsRenaming(true)} />
              <Button title="Supprimer le chantier" variant="destructive" size="sm" loading={isManaging} onPress={confirmDeleteChantier} />
            </View>
          )}
        </Card>

        {/* Avancement Global */}
        <Card variant="elevated" style={styles.avancementCard}>
          <View style={styles.avancementHeader}>
            <Text style={styles.sectionLabel} weight="bold">Avancement Global</Text>
            <Text style={styles.avancementPercent} weight="bold">
              {chantier?.avancement || 0}%
            </Text>
          </View>
          {chantier?.avancement_date && (
            <Text style={styles.avancementDate}>
              Dernière mise à jour : {chantier.avancement_date}
            </Text>
          )}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.min(chantier?.avancement || 0, 100)}%` },
              ]}
            />
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={styles.metricSub}>Longueur Chantier</Text>
              <Text style={styles.metricValue} weight="bold">
                {chantier?.reference_alignment?.length_km || 0} km
              </Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricSub}>Tronçons</Text>
              <Text style={styles.metricValue} weight="bold">
                {troncons.length}
              </Text>
            </View>
          </View>
        </Card>

        {/* Accès Rapides */}
        <Text style={styles.quickAccessTitle} weight="bold">Accès rapides</Text>
        <View style={styles.quickAccessRow}>
          <TouchableOpacity
            style={styles.quickAccessCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/chantier/avancement/${chantierId}` as any)}
          >
            <View style={[styles.quickAccessIcon, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="trending-up" size={22} color="#16A34A" />
            </View>
            <Text style={styles.quickAccessLabel} weight="bold">Avancement</Text>
            <Text style={styles.quickAccessSub}>{"Voir les statistiques et l'historique détaillé"}</Text>
            <Text style={styles.quickAccessLink} weight="semibold">Consulter →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAccessCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/chantier/images/${chantierId}` as any)}
          >
            <View style={[styles.quickAccessIcon, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="images-outline" size={22} color="#2563EB" />
            </View>
            <Text style={styles.quickAccessLabel} weight="bold">Images</Text>
            <Text style={styles.quickAccessSub}>Voir les photos et observations terrain</Text>
            <Text style={styles.quickAccessLink} weight="semibold">Consulter →</Text>
          </TouchableOpacity>
        </View>

        {/* ─── Level 6: Chronologie & Replay spatio-temporel ─── */}
        {token && Boolean(chantierId) && (
          <Card variant="elevated" style={styles.sectionCard}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              activeOpacity={0.7}
              onPress={() => setTimelineExpanded(prev => !prev)}
            >
              <View style={styles.collapsibleTitleRow}>
                <Ionicons name="time-outline" size={18} color="#8B5CF6" />
                <Text style={styles.collapsibleTitle} weight="bold">
                  Chronologie & Replay
                </Text>
                <View style={{
                  backgroundColor: 'rgba(139,92,246,0.12)',
                  borderRadius: 5,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  marginLeft: 6,
                }}>
                  <Text style={{ color: '#8B5CF6', fontSize: 10, fontWeight: '700' }}>NOUVEAU</Text>
                </View>
              </View>
              <Ionicons
                name={timelineExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={Palette.textMuted}
              />
            </TouchableOpacity>

            {timelineExpanded && (
              <View style={{ marginTop: 8 }}>
                <ChantierTimeline
                  chantierId={chantierId as string}
                  token={token}
                  onTemporalChange={handleTemporalChange}
                  onTimelineLoad={setTimelineData}
                />
              </View>
            )}
          </Card>
        )}

        {/* Action Buttons */}
        <View style={styles.actionButtonsRow}>
          <Button
            title={isGisReady ? '⚙️ Reconfigurer GIS / Découpage' : '⚙️ Configurer Tracé & Tronçons'}
            variant={isGisReady ? 'secondary' : 'primary'}
            size="md"
            onPress={() => router.push(`/responsable/chantier/${chantierId}/gis` as any)}
            style={{ marginBottom: 8 }}
          />
          <TouchableOpacity
            style={styles.mapButton}
            activeOpacity={0.85}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/map',
                params: {
                  chantierId: String(chantierId),
                  projectId: chantier?.projet_id ? String(chantier.projet_id) : undefined,
                },
              } as any)
            }
          >
            <Ionicons name="map-outline" size={20} color="#FFFFFF" />
            <Text style={styles.mapButtonText} weight="bold">
              Voir sur la carte
            </Text>
          </TouchableOpacity>
        </View>

        {/* Map Preview — GIS Monitoring Panel (Level 6B) */}
        {mapSegments.length > 0 && (
          <Card variant="elevated" style={styles.mapCard}>
            {/* Card Header with 2D/3D toggle */}
            <View style={styles.mapCardHeaderRow}>
              <View style={styles.mapCardHeaderLeft}>
                <Ionicons name="map" size={18} color={Palette.primary} />
                <Text style={styles.mapCardTitle} weight="bold">
                  Vue Cartographique des Tronçons
                </Text>
              </View>
              {/* 2D / 3D toggle */}
              <View style={styles.gisModeToggle}>
                <TouchableOpacity
                  style={[
                    styles.gisModeBtn,
                    gisMonitorMode === '2d' && styles.gisModeBtnActive,
                  ]}
                  onPress={() => setGisMonitorMode('2d')}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="map-outline"
                    size={12}
                    color={gisMonitorMode === '2d' ? '#FFFFFF' : Palette.textMuted}
                  />
                  <Text
                    style={[
                      styles.gisModeBtnText,
                      gisMonitorMode === '2d' && styles.gisModeBtnTextActive,
                    ]}
                    weight="bold"
                  >
                    2D
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.gisModeBtn,
                    gisMonitorMode === '3d' && styles.gisModeBtn3DActive,
                  ]}
                  onPress={() => setGisMonitorMode('3d')}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="cube-outline"
                    size={12}
                    color={gisMonitorMode === '3d' ? '#FFFFFF' : '#10B981'}
                  />
                  <Text
                    style={[
                      styles.gisModeBtnText,
                      gisMonitorMode === '3d' && styles.gisModeBtnTextActive,
                    ]}
                    weight="bold"
                  >
                    3D
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Temporal mode indicator row */}
            {derivedTemporal.mode === 'historical' && (
              <View style={styles.temporalBanner}>
                <View style={styles.temporalBannerLeft}>
                  <Ionicons name="time" size={13} color="#A78BFA" />
                  <Text style={styles.temporalBannerLabel} weight="semibold">
                    HISTORIQUE
                  </Text>
                  {derivedTemporal.selectedDateLabel && (
                    <Text style={styles.temporalBannerDate}>
                      {formatTemporalDateShort(derivedTemporal.selectedDateLabel)}
                    </Text>
                  )}
                  {derivedTemporal.chantierProgress >= 0 && (
                    <View style={styles.temporalProgressBadge}>
                      <Text style={styles.temporalProgressText} weight="bold">
                        {Math.round(derivedTemporal.chantierProgress)}%
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.temporalResetBtn}
                  onPress={resetToCurrentView}
                  activeOpacity={0.75}
                >
                  <Ionicons name="refresh" size={11} color="#10B981" />
                  <Text style={styles.temporalResetText} weight="semibold">
                    Présent
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 2D Map */}
            {gisMonitorMode === '2d' && (
              <InteractiveGisMap
                height={240}
                aoiGeometry={chantier?.localisation}
                referenceGeometry={chantier?.reference_alignment?.geometry}
                kmlGeometry={chantier?.reference_alignment?.geometry}
                kmlSourceFormat={chantier?.reference_alignment?.source}
                kmlMetadata={chantier?.reference_alignment?.kml_metadata}
                kmlGroundOverlays={chantier?.reference_alignment?.kml_metadata?.groundOverlays || null}
                kmlPhotoOverlays={chantier?.reference_alignment?.kml_metadata?.photoOverlays || null}
                troncons={mapSegments}
                temporalState={derivedTemporal}
              />
            )}

            {/* 3D Map */}
            {gisMonitorMode === '3d' && (
              <InteractiveGis3DMap
                height={280}
                aoiGeometry={chantier?.localisation}
                referenceGeometry={chantier?.reference_alignment?.geometry}
                kmlGeometry={chantier?.reference_alignment?.geometry}
                kmlSourceFormat={chantier?.reference_alignment?.source}
                kmlMetadata={chantier?.reference_alignment?.kml_metadata}
                kmlGroundOverlays={chantier?.reference_alignment?.kml_metadata?.groundOverlays || null}
                kmlPhotoOverlays={chantier?.reference_alignment?.kml_metadata?.photoOverlays || null}
                troncons={mapSegments}
                temporalState={derivedTemporal}
              />
            )}

            {/* Map Legend */}
            <View style={styles.legendContainer}>
              <Text style={styles.legendTitle}>{"Légende d'état :"}</Text>
              <View style={styles.legendItemsRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#16A34A' }]} />
                  <Text style={styles.legendText}>Terminé</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#F4A261' }]} />
                  <Text style={styles.legendText}>En cours</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                  <Text style={styles.legendText}>Retard / Alerte</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#94A3B8' }]} />
                  <Text style={styles.legendText}>Non commencé</Text>
                </View>
                <View style={styles.legendItem}>
                  <Text style={{ fontSize: 11, color: '#0284C7', fontWeight: 'bold' }}>➜</Text>
                  <Text style={styles.legendText}>Sens du tracé</Text>
                </View>
              </View>
            </View>
          </Card>
        )}

        {/* Informations Générales (Collapsible, DEFAULT: COLLAPSED) */}
        <Card variant="elevated" style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.collapsibleHeader}
            activeOpacity={0.7}
            onPress={() => setInfoExpanded((prev) => !prev)}
          >
            <View style={styles.collapsibleTitleRow}>
              <Ionicons name="document-text-outline" size={18} color="#0F766E" />
              <Text style={styles.collapsibleTitle} weight="bold">
                Informations Générales
              </Text>
            </View>
            <Ionicons
              name={infoExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={Palette.textMuted}
            />
          </TouchableOpacity>

          {infoExpanded && (
            <View style={styles.collapsibleContent}>
              <View style={styles.infoGrid}>
                <View style={styles.infoRow}>
                  <Ionicons name="folder-outline" size={16} color={Palette.textMuted} />
                  <Text style={styles.infoRowLabel}>Projet</Text>
                  <Text style={styles.infoRowValue} weight="bold">
                    {chantier?.projet_nom || '—'}
                  </Text>
                </View>

                {chantier?.date_debut ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={16} color={Palette.textMuted} />
                    <Text style={styles.infoRowLabel}>Début</Text>
                    <Text style={styles.infoRowValue} weight="bold">
                      {formatDate(chantier.date_debut)}
                    </Text>
                  </View>
                ) : null}

                {chantier?.date_fin_prevue ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="calendar-outline" size={16} color={Palette.textMuted} />
                    <Text style={styles.infoRowLabel}>Fin prévue</Text>
                    <Text style={styles.infoRowValue} weight="bold">
                      {formatDate(chantier.date_fin_prevue)}
                    </Text>
                  </View>
                ) : null}

                {chantier?.surface_reference ? (
                  <View style={styles.infoRow}>
                    <Ionicons name="cube-outline" size={16} color={Palette.textMuted} />
                    <Text style={styles.infoRowLabel}>Surface réf.</Text>
                    <Text style={styles.infoRowValue} weight="bold">
                      {chantier.surface_reference} m²
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          )}
        </Card>

        {/* Métadonnées (Collapsible) - Generic source & contextual metadata for all chantiers */}
        {Boolean(chantier?.reference_alignment) && (() => {
          const refAlign = chantier!.reference_alignment!;
          const { format, isKml } = getSourceFormatInfo(refAlign);
          const kmlMeta = refAlign.kml_metadata;
          const displayName = (isKml && kmlMeta?.name) ? kmlMeta.name : (refAlign.nom || '—');

          return (
            <Card variant="elevated" style={styles.sectionCard}>
              <TouchableOpacity
                style={styles.collapsibleHeader}
                activeOpacity={0.7}
                onPress={() => setMetadataExpanded((prev) => !prev)}
              >
                <View style={styles.collapsibleTitleRow}>
                  <Ionicons name="map-outline" size={18} color="#0F766E" />
                  <Text style={styles.collapsibleTitle} weight="bold">
                    Métadonnées
                  </Text>
                </View>
                <Ionicons
                  name={metadataExpanded ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Palette.textMuted}
                />
              </TouchableOpacity>

              {metadataExpanded && (
                <View style={styles.collapsibleContent}>
                  {/* Generic Source Metadata */}
                  <View style={styles.infoGrid}>
                    <View style={styles.infoRow}>
                      <Ionicons name="layers-outline" size={16} color={Palette.textMuted} />
                      <Text style={styles.infoRowLabel}>Source / Format</Text>
                      <View style={styles.formatBadge}>
                        <Text style={styles.formatBadgeText} weight="bold">
                          {format}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.infoRow}>
                      <Ionicons name="pricetag-outline" size={16} color={Palette.textMuted} />
                      <Text style={styles.infoRowLabel}>Nom</Text>
                      <Text style={styles.infoRowValue} weight="bold">
                        {displayName}
                      </Text>
                    </View>

                    {Boolean(refAlign.original_filename) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="document-attach-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Fichier source</Text>
                        <Text style={styles.infoRowValue} weight="semibold" numberOfLines={1}>
                          {refAlign.original_filename}
                        </Text>
                      </View>
                    )}

                    <View style={styles.infoRow}>
                      <Ionicons name="globe-outline" size={16} color={Palette.textMuted} />
                      <Text style={styles.infoRowLabel}>CRS</Text>
                      <Text style={styles.infoRowValue}>
                        {formatCrsDisplay(refAlign)}
                      </Text>
                    </View>

                    {/* GeoJSON specific geometry attributes */}
                    {!isKml && Boolean(refAlign.geometry?.type) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="shapes-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Géométrie</Text>
                        <Text style={styles.infoRowValue}>
                          {refAlign.geometry.type}
                        </Text>
                      </View>
                    )}

                    {!isKml && (refAlign.length_km !== undefined && refAlign.length_km !== null) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="analytics-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Longueur</Text>
                        <Text style={styles.infoRowValue}>
                          {refAlign.length_km} km{refAlign.length_meters ? ` (${refAlign.length_meters} m)` : ''}
                        </Text>
                      </View>
                    )}

                    {!isKml && Boolean(refAlign.date_import) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="time-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Importé le</Text>
                        <Text style={styles.infoRowValue}>
                          {refAlign.date_import}
                        </Text>
                      </View>
                    )}

                    {/* KML Folder(s) */}
                    {isKml && Boolean(kmlMeta?.folders && kmlMeta.folders.length > 0) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="folder-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Dossier</Text>
                        <Text style={styles.infoRowValue} weight="semibold">
                          {kmlMeta!.folders!.join(' ❯ ')}
                        </Text>
                      </View>
                    )}

                    {/* KML Document name */}
                    {isKml && Boolean(kmlMeta?.documentName) && (
                      <View style={styles.infoRow}>
                        <Ionicons name="document-text-outline" size={16} color={Palette.textMuted} />
                        <Text style={styles.infoRowLabel}>Document</Text>
                        <Text style={styles.infoRowValue}>
                          {kmlMeta!.documentName}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* KML multiline readable description */}
                  {isKml && Boolean(kmlMeta?.description) && (
                    <View style={styles.kmlDescriptionBlock}>
                      <Text style={styles.kmlSubheading} weight="semibold">
                        Description
                      </Text>
                      <View style={styles.kmlDescriptionBox}>
                        <Text style={styles.kmlDescriptionText}>
                          {kmlMeta!.description}
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* KML ExtendedData key/value pairs */}
                  {isKml &&
                    Boolean(
                      kmlMeta?.extendedData &&
                        Object.keys(kmlMeta.extendedData).length > 0
                    ) && (
                      <View style={styles.kmlExtDataBlock}>
                        <Text style={styles.kmlSubheading} weight="semibold">
                          Données étendues (ExtendedData)
                        </Text>
                        <View style={styles.kmlExtDataTable}>
                          {Object.entries(kmlMeta!.extendedData || {}).map(
                            ([key, val], idx, arr) => (
                              <View
                                key={key}
                                style={[
                                  styles.kmlExtDataRow,
                                  idx === arr.length - 1 && styles.kmlExtDataRowLast,
                                ]}
                              >
                                <Text style={styles.kmlExtDataKey} weight="semibold">
                                  {key}
                                </Text>
                                <Text style={styles.kmlExtDataVal}>
                                  {String(val)}
                                </Text>
                              </View>
                            )
                          )}
                        </View>
                      </View>
                    )}

                  {/* KML Style information when available */}
                  {isKml &&
                    (Boolean(kmlMeta?.styleUrl) ||
                      Boolean(kmlMeta?.styles?.line)) && (
                      <View style={styles.kmlStyleBlock}>
                        <Text style={styles.kmlSubheading} weight="semibold">
                          Style KML
                        </Text>
                        <View style={styles.infoGrid}>
                          {Boolean(kmlMeta?.styleUrl) && (
                            <View style={styles.infoRow}>
                              <Ionicons name="color-palette-outline" size={16} color={Palette.textMuted} />
                              <Text style={styles.infoRowLabel}>Style URL</Text>
                              <Text style={[styles.infoRowValue, styles.monoText]}>
                                {kmlMeta!.styleUrl}
                              </Text>
                            </View>
                          )}

                          {Boolean(kmlMeta?.styles?.line?.color) && (() => {
                            const lineColor = kmlMeta?.styles?.line?.color || '';
                            const hexColor =
                              lineColor.length === 8
                                ? lineColor.slice(6, 8) +
                                  lineColor.slice(4, 6) +
                                  lineColor.slice(2, 4)
                                : 'EA580C';
                            return (
                              <View style={styles.infoRow}>
                                <Ionicons name="color-filter-outline" size={16} color={Palette.textMuted} />
                                <Text style={styles.infoRowLabel}>Couleur</Text>
                                <View style={styles.kmlColorRow}>
                                  <View style={[styles.kmlColorDot, { backgroundColor: '#' + hexColor }]} />
                                  <Text style={styles.infoRowValue}>{lineColor}</Text>
                                </View>
                              </View>
                            );
                          })()}

                          {kmlMeta?.styles?.line?.width !== undefined &&
                            kmlMeta?.styles?.line?.width !== null && (
                              <View style={styles.infoRow}>
                                <Ionicons name="resize-outline" size={16} color={Palette.textMuted} />
                                <Text style={styles.infoRowLabel}>Épaisseur</Text>
                                <Text style={styles.infoRowValue}>
                                  {kmlMeta.styles.line.width} px
                                </Text>
                              </View>
                            )}
                        </View>
                      </View>
                    )}

                  {/* KML Generator Info if available */}
                  {isKml && Boolean(kmlMeta?.generator) && (
                    <View style={styles.infoRow}>
                      <Ionicons name="construct-outline" size={16} color={Palette.textMuted} />
                      <Text style={styles.infoRowLabel}>Générateur</Text>
                      <Text style={styles.infoRowValue}>
                        {kmlMeta!.generator}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Card>
          );
        })()}

        {/* Tronçons & Agents de Terrain (Collapsible) */}
        <Card variant="elevated" style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.collapsibleHeader}
            activeOpacity={0.7}
            onPress={() => setTronconsExpanded((prev) => !prev)}
          >
            <View style={styles.collapsibleTitleRow}>
              <Ionicons name="people-outline" size={18} color="#0F766E" />
              <Text style={styles.collapsibleTitle} weight="bold">
                Tronçons & Agents de Terrain
              </Text>
            </View>
            <Ionicons
              name={tronconsExpanded ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={Palette.textMuted}
            />
          </TouchableOpacity>

          {tronconsExpanded && (
            <View style={styles.collapsibleContent}>
              {troncons.length > 0 ? (
                <View style={styles.agentTable}>
                  <View style={styles.agentTableHeader}>
                    <Text style={styles.agentTableColHeaderTroncon} weight="semibold">
                      Tronçon
                    </Text>
                    <Text style={styles.agentTableColHeaderAgent} weight="semibold">
                      Agent de Terrain
                    </Text>
                  </View>

                  {troncons.map((t: ChantierTroncon, index: number) => {
                    const agentName =
                      t.agent_nom_complet ||
                      (t.agent_prenom && t.agent_nom
                        ? `${t.agent_prenom} ${t.agent_nom}`
                        : t.agent_nom || null);
                    const isAssigned = !!(t.agent_id && agentName);

                    const avatarColors = [
                      { bg: '#DCFCE7', text: '#16A34A' },
                      { bg: '#E0F2FE', text: '#0284C7' },
                      { bg: '#F3E8FF', text: '#9333EA' },
                      { bg: '#FEF3C7', text: '#D97706' },
                    ];
                    const color = isAssigned
                      ? avatarColors[index % avatarColors.length]
                      : { bg: '#F1F5F9', text: '#94A3B8' };

                    return (
                      <View
                        key={t.id || index}
                        style={[
                          styles.agentTableRow,
                          index === troncons.length - 1 && styles.agentTableRowLast,
                        ]}
                      >
                        <View style={styles.agentTableTronconCol}>
                          <Text style={styles.agentTronconName} numberOfLines={1}>
                            {t.nom}
                          </Text>
                        </View>

                        <View style={styles.agentTableAgentCol}>
                          <View style={[styles.agentAvatarCircle, { backgroundColor: color.bg }]}>
                            <Ionicons name="person" size={12} color={color.text} />
                          </View>
                          <Text
                            style={[
                              styles.agentNameText,
                              !isAssigned && styles.agentUnassignedText,
                            ]}
                            numberOfLines={1}
                          >
                            {isAssigned ? agentName : 'Non affecté'}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.emptyAgentListText}>
                  Aucun tronçon configuré pour ce chantier.
                </Text>
              )}
            </View>
          )}
        </Card>

        {/* Configuration de la position terrain */}
        <Card variant="elevated" style={styles.sectionCard}>
          <View style={styles.cardHeaderWithIcon}>
            <Ionicons name="locate-outline" size={18} color="#0F766E" />
            <Text style={styles.collapsibleTitle} weight="bold">
              Configuration de la position terrain
            </Text>
          </View>
          <View style={styles.dMaxContent}>
            <Text style={styles.dMaxInputLabel}>Distance maximale recommandée (m)</Text>
            <View style={styles.dMaxRow}>
              <View style={styles.dMaxInputContainer}>
                <Ionicons
                  name="resize-outline"
                  size={16}
                  color={Palette.textMuted}
                  style={styles.dMaxInputIcon}
                />
                <TextInput
                  style={styles.dMaxTextInput}
                  value={dMaxPosition}
                  onChangeText={setDMaxPosition}
                  keyboardType="numeric"
                  placeholder="50"
                  placeholderTextColor={Palette.textMuted}
                />
              </View>
              <TouchableOpacity
                style={[styles.dMaxSaveBtn, isSavingDMax && { opacity: 0.7 }]}
                onPress={saveDMax}
                disabled={isSavingDMax}
                activeOpacity={0.8}
              >
                {isSavingDMax ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.dMaxSaveBtnText} weight="bold">
                    Enregistrer le seuil
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.dMaxHelp}>
              {"Distance maximale entre la position GPS de l'agent et l'infrastructure."}
            </Text>
          </View>
        </Card>

        {/* Tronçons List */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="h2" style={styles.sectionTitle}>
            Tronçons du Chantier ({troncons.length})
          </Text>
        </View>

        {troncons.length > 0 ? (
          <View style={styles.tronconsList}>
            {troncons.map((t: ChantierTroncon) => {
              const statut = t.statut || 'NON_COMMENCE';
              const dotColor =
                statut === 'TERMINE'
                  ? '#16A34A'
                  : statut === 'EN_COURS'
                  ? '#F4A261'
                  : statut === 'PROBLEME'
                  ? '#DC2626'
                  : '#94A3B8';

              const segLenKm = t.length_km || (t.pk_debut !== null && t.pk_fin !== null ? Number((Number(t.pk_fin) - Number(t.pk_debut)).toFixed(3)) : null);

              return (
                <Card key={t.id} variant="elevated" style={styles.tronconCard}>
                  <View style={styles.tronconHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.tronconTitleRow}>
                        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                        <Text variant="h3" style={styles.tronconTitle}>
                          {t.nom}
                        </Text>
                      </View>
                      <Text style={styles.tronconPk}>
                        Bornes : {formatPK(t.pk_debut)} &rarr; {formatPK(t.pk_fin)}
                      </Text>
                      {segLenKm !== null ? (
                        <Text style={styles.tronconLen}>
                          Longueur : {segLenKm} km
                        </Text>
                      ) : null}
                    </View>

                    <Button
                      title="Superviser →"
                      variant="primary"
                      size="sm"
                      onPress={() => router.push(`/responsable/troncon/${t.id}` as any)}
                    />
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyCard}>
            <Ionicons name="git-network-outline" size={40} color={Palette.textMuted} />
            <Text style={styles.emptyTitle}>Aucun tronçon découpé</Text>
            <Text style={styles.emptySubtitle}>
              {"Calibrez l'axe de référence et générez le découpage kilométrique des tronçons."}
            </Text>
            <Button
              title="Configurer GIS maintenant"
              variant="primary"
              size="sm"
              onPress={() => router.push(`/responsable/chantier/${chantierId}/gis` as any)}
              style={{ marginTop: 10 }}
            />
          </Card>
        )}
      </ScrollView>
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
  parentProjectText: {
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
    paddingBottom: 40,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  renameBox: { marginTop: 14, gap: 10 },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statutLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  chantierNameTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  gisBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  gisBadgeReady: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  gisBadgeImported: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  gisBadgeUnset: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  gisBadgeText: {
    fontSize: 10,
  },
  // Info & Collapsible Sections
  sectionCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 14,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collapsibleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsibleTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  collapsibleContent: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  cardHeaderWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  dMaxContent: {
    gap: 6,
  },
  dMaxInputLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  dMaxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dMaxInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    height: 44,
  },
  dMaxInputIcon: {
    marginRight: 8,
  },
  dMaxTextInput: {
    flex: 1,
    fontSize: 14,
    color: Palette.text,
    height: '100%',
    padding: 0,
  },
  dMaxSaveBtn: {
    backgroundColor: '#2A9D8F',
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dMaxSaveBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  dMaxHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: Palette.textMuted,
    marginTop: 4,
  },
  // Tronçons & Agents table
  agentTable: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    overflow: 'hidden',
  },
  agentTableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F8FAFC',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  agentTableColHeaderTroncon: {
    width: '42%',
    fontSize: 12,
    color: '#64748B',
  },
  agentTableColHeaderAgent: {
    width: '58%',
    fontSize: 12,
    color: '#64748B',
  },
  agentTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
    backgroundColor: '#FFFFFF',
  },
  agentTableRowLast: {
    borderBottomWidth: 0,
  },
  agentTableTronconCol: {
    width: '42%',
    paddingRight: 8,
  },
  agentTronconName: {
    fontSize: 13,
    color: Palette.text,
  },
  agentTableAgentCol: {
    width: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentAvatarCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentNameText: {
    fontSize: 13,
    color: Palette.text,
    flexShrink: 1,
  },
  agentUnassignedText: {
    color: Palette.textMuted,
  },
  emptyAgentListText: {
    fontSize: 12,
    color: Palette.textMuted,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  infoCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 13,
    color: Palette.text,
    marginBottom: 10,
  },
  infoGrid: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoRowLabel: {
    fontSize: 13,
    color: Palette.textMuted,
    width: 90,
  },
  infoRowValue: {
    fontSize: 13,
    color: Palette.text,
    flex: 1,
  },
  // Avancement Card
  avancementCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  avancementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  avancementPercent: {
    fontSize: 18,
    color: Palette.primary,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Palette.primary,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  metricCell: {
    flex: 1,
  },
  metricSub: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  metricValue: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 2,
  },
  avancementDate: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  // Quick Access
  quickAccessTitle: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 10,
  },
  quickAccessRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  quickAccessCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  quickAccessIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  quickAccessLabel: {
    fontSize: 13,
    color: Palette.text,
  },
  quickAccessSub: {
    fontSize: 10,
    color: Palette.textMuted,
    marginTop: 2,
    lineHeight: 14,
  },
  quickAccessLink: {
    fontSize: 11,
    color: Palette.primary,
    marginTop: 6,
  },
  // Action Buttons
  actionButtonsRow: {
    marginBottom: 16,
    gap: 8,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#16A34A',
  },
  mapButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  mapCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  mapCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mapCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapCardTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  // 2D/3D toggle
  gisModeToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  gisModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  gisModeBtnActive: {
    backgroundColor: Palette.primary,
  },
  gisModeBtn3DActive: {
    backgroundColor: '#10B981',
  },
  gisModeBtnText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  gisModeBtnTextActive: {
    color: '#FFFFFF',
  },
  // Temporal mode banner
  temporalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(139,92,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.25)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  temporalBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    flex: 1,
  },
  temporalBannerLabel: {
    fontSize: 10,
    color: '#8B5CF6',
    letterSpacing: 0.5,
  },
  temporalBannerDate: {
    fontSize: 11,
    color: '#1E293B',
    fontWeight: '600',
  },
  temporalProgressBadge: {
    backgroundColor: 'rgba(16,185,129,0.12)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  temporalProgressText: {
    fontSize: 11,
    color: '#059669',
  },
  temporalResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16,185,129,0.1)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
  },
  temporalResetText: {
    fontSize: 10,
    color: '#10B981',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  tronconsList: {
    gap: 10,
  },
  tronconCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  tronconHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tronconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tronconTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  tronconPk: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 4,
    marginLeft: 16,
  },
  tronconLen: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginTop: 2,
    marginLeft: 16,
  },
  legendContainer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendTitle: {
    fontSize: 10,
    color: Palette.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendItemsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Palette.text,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: Palette.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },
  // KML Metadata styles
  kmlDescriptionBlock: {
    marginTop: 14,
  },
  kmlSubheading: {
    fontSize: 12,
    color: '#0F766E',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  kmlDescriptionBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
  },
  kmlDescriptionText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#334155',
  },
  kmlExtDataBlock: {
    marginTop: 14,
  },
  kmlExtDataTable: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  kmlExtDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  kmlExtDataRowLast: {
    borderBottomWidth: 0,
  },
  kmlExtDataKey: {
    fontSize: 12,
    color: '#64748B',
    flex: 1,
  },
  kmlExtDataVal: {
    fontSize: 12,
    color: Palette.text,
    flex: 1.2,
    textAlign: 'right',
  },
  kmlStyleBlock: {
    marginTop: 14,
  },
  kmlColorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  kmlColorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
  formatBadge: {
    backgroundColor: '#F0FDFA',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#99F6E4',
    alignSelf: 'flex-start',
  },
  formatBadgeText: {
    fontSize: 11,
    color: '#0F766E',
  },
});
