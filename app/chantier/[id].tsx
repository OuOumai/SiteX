import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect, Path, Circle, Defs, LinearGradient, Stop, Line } from 'react-native-svg';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { api, ChantierDetails } from '@/services/api';

/** Helper to format ISO dates into friendly French representation (e.g. "15 janvier 2026") */
function formatFrenchDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

interface StatusTheme {
  color: string;
  bg: string;
  border: string;
  dotColor: string;
}

const STATUS_THEMES: Record<string, StatusTheme> = {
  'En cours': {
    color: '#1D4ED8',      // Blue
    bg: '#EFF6FF',
    border: '#BFDBFE',
    dotColor: '#2563EB',
  },
  'Terminé': {
    color: '#7E22CE',      // Purple
    bg: '#FAF5FF',
    border: '#E9D5FF',
    dotColor: '#9333EA',
  },
  'Terminés': {
    color: '#7E22CE',
    bg: '#FAF5FF',
    border: '#E9D5FF',
    dotColor: '#9333EA',
  },
  'En retard': {
    color: '#C2410C',      // Orange
    bg: '#FFF7ED',
    border: '#FED7AA',
    dotColor: '#EA580C',
  },
  'En attente': {
    color: '#B45309',      // Amber / Yellow
    bg: '#FFFBEB',
    border: '#FDE68A',
    dotColor: '#D97706',
  },
};

const DEFAULT_STATUS_THEME: StatusTheme = {
  color: '#475569',
  bg: '#F8FAFC',
  border: '#E2E8F0',
  dotColor: '#64748B',
};

function getStatusTheme(statut?: string | null): StatusTheme {
  if (!statut) return STATUS_THEMES['En cours'];
  const normalized = statut.trim();
  if (normalized.toLowerCase().includes('retard')) return STATUS_THEMES['En retard'];
  if (normalized.toLowerCase().includes('termin')) return STATUS_THEMES['Terminé'];
  if (normalized.toLowerCase().includes('attente')) return STATUS_THEMES['En attente'];
  if (normalized.toLowerCase().includes('cours')) return STATUS_THEMES['En cours'];
  return STATUS_THEMES[normalized] || DEFAULT_STATUS_THEME;
}

export default function ChantierDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, user, isLoading: isAuthLoading } = useAuth();

  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChantierDetails = useCallback(async (isRefresh = false) => {
    if (!token || !id) {
      if (!isAuthLoading) {
        setIsLoading(false);
      }
      return;
    }

    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      if (__DEV__) console.log(`[ChantierDetails] Fetching chantier #${id}...`);
      const data = await api.getChantierDetails(token, id);
      setChantier(data.chantier);
      if (__DEV__) console.log('[ChantierDetails] Chantier loaded:', data.chantier.nom);
    } catch (err: any) {
      console.error('[ChantierDetails] Error fetching chantier details:', err.message);
      setError(err.message || 'Impossible de charger les détails du chantier.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchChantierDetails();
    }
  }, [fetchChantierDetails, isAuthLoading]);

  const handleOpenAvancement = () => {
    if (!chantier) return;
    router.push({
      pathname: '/chantier/avancement/[id]',
      params: { id: String(chantier.id) },
    });
  };

  const handleOpenImages = () => {
    if (!chantier) return;
    router.push({
      pathname: '/chantier/images/[id]',
      params: { id: String(chantier.id) },
    });
  };

  const handleOpenMap = () => {
    if (!chantier) return;
    const firstTronconId = chantier.troncons?.[0]?.id;
    router.push({
      pathname: '/(tabs)/map',
      params: {
        chantierId: String(chantier.id),
        tronconId: firstTronconId ? String(firstTronconId) : undefined,
      },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Projets
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerStateContainer}>
          <ActivityIndicator size="large" color={Palette.primary} />
          <Text variant="muted" style={styles.stateText}>
            Chargement des détails du chantier...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !chantier) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Projets
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerStateContainer}>
          <Card variant="elevated" style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={32} color={Palette.alert} />
            <Text variant="error" style={styles.stateErrorText}>
              {error || 'Chantier introuvable.'}
            </Text>
            <TouchableOpacity onPress={() => fetchChantierDetails()} style={styles.retryButton}>
              <Text style={styles.retryButtonText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const statusTheme = getStatusTheme(chantier.statut);
  const avancementPct = chantier.avancement || 0;

  // PK string formatting (displays "—" if not populated in GIS tables)
  const pkString =
    chantier.pk_debut !== null && chantier.pk_debut !== undefined &&
    chantier.pk_fin !== null && chantier.pk_fin !== undefined
      ? `PK ${chantier.pk_debut} → PK ${chantier.pk_fin}`
      : '—';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── 1. Top Navigation Bar ── */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.primary} />
          <Text style={styles.backButtonText} weight="semibold">
            Projets
          </Text>
        </TouchableOpacity>

        <Text variant="subtitle" style={styles.screenHeaderTitle} numberOfLines={1}>
          Chantier
        </Text>

        <View style={styles.rightNavActions}>
          <TouchableOpacity style={styles.threeDotButton} activeOpacity={0.7}>
            <Ionicons name="ellipsis-horizontal" size={20} color={Palette.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchChantierDetails(true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 2. Chantier Identity Card ── */}
        <Card variant="elevated" style={[styles.identityCard, { borderLeftColor: statusTheme.dotColor }]}>
          {/* Visual Map Preview (Clickable to Map screen) */}
          <Pressable
            style={({ pressed }) => [
              styles.mapPreviewContainer,
              pressed && styles.mapPreviewPressed,
            ]}
            onPress={handleOpenMap}
          >
            {/* SVG Map Canvas Illustration */}
            <View style={styles.mapCanvasWrapper}>
              <Svg width="100%" height="100%" viewBox="0 0 400 140" preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id="mapBgGrad" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor="#E6ECE9" />
                    <Stop offset="50%" stopColor="#DCE5E1" />
                    <Stop offset="100%" stopColor="#D3DFDA" />
                  </LinearGradient>
                  <LinearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0%" stopColor="#2A9D8F" stopOpacity="0.7" />
                    <Stop offset="40%" stopColor="#176B5B" stopOpacity="1" />
                    <Stop offset="100%" stopColor="#208774" stopOpacity="0.8" />
                  </LinearGradient>
                </Defs>

                {/* Base Map Terrain */}
                <Rect x="0" y="0" width="400" height="140" fill="url(#mapBgGrad)" />

                {/* Secondary Roads / Land Contours */}
                <Path d="M-20,110 Q90,70 180,95 T380,60" fill="none" stroke="#C8D6CF" strokeWidth="6" />
                <Path d="M40,-10 Q110,60 160,150" fill="none" stroke="#D3E0D9" strokeWidth="4" />
                <Path d="M260,-10 Q280,60 360,150" fill="none" stroke="#D3E0D9" strokeWidth="4" />
                
                {/* Secondary Water / Zone Accent */}
                <Path d="M0,0 Q60,35 110,20 T200,5 L200,0 Z" fill="rgba(42, 157, 143, 0.12)" />

                {/* Main Construction Corridor / Axis (Railway / Express Road) */}
                <Path
                  d="M-10,80 C80,75 140,45 220,55 S340,30 410,20"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <Path
                  d="M-10,80 C80,75 140,45 220,55 S340,30 410,20"
                  fill="none"
                  stroke="url(#routeGrad)"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                {/* Railway Ties Effect */}
                <Path
                  d="M-10,80 C80,75 140,45 220,55 S340,30 410,20"
                  fill="none"
                  stroke="#FFFFFF"
                  strokeWidth="3"
                  strokeDasharray="4,6"
                />

                {/* Active Chantier Zone Marker Pulsing Halo */}
                <Circle cx="215" cy="55" r="18" fill="rgba(23, 107, 91, 0.22)" />
                <Circle cx="215" cy="55" r="10" fill="#176B5B" />
                <Circle cx="215" cy="55" r="4" fill="#FFFFFF" />
              </Svg>
            </View>

            {/* Map Overlay Badges */}
            <View style={styles.mapOverlayHeader}>
              <View style={styles.mapPinBadge}>
                <Ionicons name="location" size={12} color="#FFFFFF" />
                <Text style={styles.mapPinBadgeText} weight="bold">
                  Emprise Chantier
                </Text>
              </View>

              <View style={styles.mapTapPrompt}>
                <Ionicons name="scan-outline" size={13} color={Palette.text} />
                <Text style={styles.mapTapPromptText} weight="medium">
                  Agrandir
                </Text>
              </View>
            </View>

            <View style={styles.mapOverlayFooter}>
              <Text style={styles.mapFootprintNotice}>
                Coordonnées & localisation géoréférencée
              </Text>
              <View style={styles.openMapPill}>
                <Ionicons name="map" size={12} color={Palette.primary} />
                <Text style={styles.openMapPillText} weight="semibold">
                  Ouvrir sur la carte
                </Text>
                <Ionicons name="chevron-forward" size={12} color={Palette.primary} />
              </View>
            </View>
          </Pressable>

          <View style={styles.identityBody}>
            <View style={styles.identityHeaderRow}>
              <View style={styles.identityTitleWrapper}>
                <Text variant="h1" style={styles.chantierTitle}>
                  {chantier.nom}
                </Text>
                <Text variant="subtitle" style={styles.projectName}>
                  {chantier.projet_nom || '—'}
                </Text>
              </View>

              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor: statusTheme.bg,
                    borderColor: statusTheme.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusBadgeDot,
                    { backgroundColor: statusTheme.dotColor },
                  ]}
                />
                <Text
                  style={[styles.statusBadgeText, { color: statusTheme.color }]}
                  weight="bold"
                >
                  {chantier.statut || 'En cours'}
                </Text>
              </View>
            </View>

            <View style={styles.idChipRow}>
              <Text style={styles.idChipText}>
                ID : CH-{String(chantier.id).padStart(3, '0')}
              </Text>
            </View>
          </View>
        </Card>

        {/* ── 3. Chantier Information Card ── */}
        <Card variant="elevated" style={styles.infoCard}>
          <Text variant="h2" style={styles.sectionCardTitle}>
            Informations générales
          </Text>

          <View style={styles.infoList}>
            {/* Projet */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="folder-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Projet</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {chantier.projet_nom || '—'}
              </Text>
            </View>

            {/* Localisation */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="location-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Localisation</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {pkString}
              </Text>
            </View>

            {/* Surface */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="cube-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Surface</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {chantier.surface ? `${Number(chantier.surface).toLocaleString('fr-FR')} m²` : '—'}
              </Text>
            </View>

            {/* Date début */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="calendar-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Date début</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {formatFrenchDate(chantier.date_debut)}
              </Text>
            </View>

            {/* Date fin prévue */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="time-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Date fin prévue</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {formatFrenchDate(chantier.date_fin_prevue)}
              </Text>
            </View>

            {/* Responsable */}
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="person-outline" size={16} color={Palette.textMuted} />
                <Text style={styles.infoLabel}>Responsable</Text>
              </View>
              <Text style={styles.infoValue} weight="medium">
                {chantier.responsable_nom || '—'}
              </Text>
            </View>
          </View>
        </Card>

        {/* ── 4. Avancement Global Card ── */}
        <Card variant="elevated" style={styles.avancementCard}>
          <View style={styles.avancementHeaderRow}>
            <View>
              <Text variant="h2" style={styles.sectionCardTitle}>
                Avancement global
              </Text>
              <Text style={styles.lastUpdateText}>
                Dernière mise à jour : {formatFrenchDate(chantier.avancement_date || chantier.date_creation)}
              </Text>
            </View>
            <View style={styles.avancementPercentageBadge}>
              <Text style={styles.avancementPercentageText} weight="bold">
                {avancementPct}%
              </Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${Math.min(100, Math.max(0, avancementPct))}%`,
                  backgroundColor:
                    avancementPct >= 80
                      ? Palette.primary
                      : avancementPct >= 50
                      ? '#2563EB'
                      : '#EA580C',
                },
              ]}
            />
          </View>

          {/* Commentaire if available */}
          {Boolean(chantier.avancement_commentaire) && (
            <View style={styles.commentBox}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={Palette.textMuted} />
              <Text style={styles.commentText}>
                {chantier.avancement_commentaire}
              </Text>
            </View>
          )}
        </Card>

        {/* ── 5. Accès Rapides ── */}
        <Text variant="h2" style={styles.sectionGroupTitle}>
          Accès rapides
        </Text>

        <View style={styles.quickAccessRow}>
          {/* Card 1: Avancement */}
          <Pressable
            style={({ pressed }) => [
              styles.quickAccessCard,
              pressed && styles.quickAccessCardPressed,
            ]}
            onPress={handleOpenAvancement}
          >
            <View style={[styles.quickAccessIconWrapper, { backgroundColor: 'rgba(23, 107, 91, 0.12)' }]}>
              <Ionicons name="trending-up-outline" size={24} color={Palette.primary} />
            </View>
            <Text variant="h3" style={styles.quickAccessTitle}>
              Avancement
            </Text>
            <Text style={styles.quickAccessSubtitle}>
              Voir les statistiques{'\n'}et l'historique détaillé
            </Text>
            <View style={styles.quickAccessFooter}>
              <Text style={styles.quickAccessActionText} weight="semibold">
                Consulter
              </Text>
              <Ionicons name="arrow-forward" size={14} color={Palette.primary} />
            </View>
          </Pressable>

          {/* Card 2: Images */}
          <Pressable
            style={({ pressed }) => [
              styles.quickAccessCard,
              pressed && styles.quickAccessCardPressed,
            ]}
            onPress={handleOpenImages}
          >
            <View style={[styles.quickAccessIconWrapper, { backgroundColor: 'rgba(37, 99, 235, 0.12)' }]}>
              <Ionicons name="images-outline" size={24} color="#2563EB" />
            </View>
            <Text variant="h3" style={styles.quickAccessTitle}>
              Images
            </Text>
            <Text style={styles.quickAccessSubtitle}>
              Voir toutes les images{'\n'}du chantier
            </Text>
            <View style={styles.quickAccessFooter}>
              <Text style={[styles.quickAccessActionText, { color: '#2563EB' }]} weight="semibold">
                Consulter
              </Text>
              <Ionicons name="arrow-forward" size={14} color="#2563EB" />
            </View>
          </Pressable>
        </View>

        {/* ── 6. GIS Configuration & Map Buttons ── */}
        {(user?.role_nom === 'Responsable' || user?.role_id === 2 || user?.role_nom === 'Administrateur' || user?.role_id === 1) && (
          <TouchableOpacity
            style={[styles.mapButton, { backgroundColor: Palette.primary, marginBottom: 12 }]}
            activeOpacity={0.85}
            onPress={() => router.push(`/responsable/chantier/${id}/gis` as any)}
          >
            <Ionicons name="git-network-outline" size={20} color="#FFFFFF" />
            <Text style={styles.mapButtonText} weight="bold">
              ⚙️ Configuration GIS & Tronçons
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.mapButton}
          activeOpacity={0.85}
          onPress={handleOpenMap}
        >
          <Ionicons name="map-outline" size={20} color="#FFFFFF" />
          <Text style={styles.mapButtonText} weight="bold">
            Voir sur la carte
          </Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Palette.background,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  backButtonText: {
    fontSize: 16,
    color: Palette.primary,
  },
  screenHeaderTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  rightNavActions: {
    minWidth: 70,
    alignItems: 'flex-end',
  },
  threeDotButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 36,
  },

  // ── Identity Card & Map Preview
  identityCard: {
    padding: 0,
    marginBottom: 16,
    borderLeftWidth: 4,
    overflow: 'hidden',
  },
  mapPreviewContainer: {
    width: '100%',
    height: 136,
    position: 'relative',
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: '#E6ECE9',
  },
  mapPreviewPressed: {
    opacity: 0.9,
  },
  mapCanvasWrapper: {
    ...StyleSheet.absoluteFillObject,
  },
  mapOverlayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  mapPinBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(23, 107, 91, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  mapPinBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  mapTapPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  mapTapPromptText: {
    fontSize: 11,
    color: Palette.text,
  },
  mapOverlayFooter: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mapFootprintNotice: {
    fontSize: 10,
    color: Palette.textMuted,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  openMapPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  openMapPillText: {
    fontSize: 11,
    color: Palette.primary,
  },
  identityBody: {
    padding: 16,
  },
  identityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  identityTitleWrapper: {
    flex: 1,
  },
  chantierTitle: {
    fontSize: 20,
    color: Palette.text,
    lineHeight: 26,
  },
  projectName: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
  },
  idChipRow: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  idChipText: {
    fontSize: 12,
    color: Palette.textLight,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },

  // ── Info Card
  infoCard: {
    padding: 16,
    marginBottom: 16,
  },
  sectionCardTitle: {
    fontSize: 16,
    color: Palette.text,
    marginBottom: 12,
  },
  infoList: {
    gap: 0,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  infoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  infoValue: {
    fontSize: 13,
    color: Palette.text,
    maxWidth: '55%',
    textAlign: 'right',
  },

  // ── Avancement Card
  avancementCard: {
    padding: 16,
    marginBottom: 20,
  },
  avancementHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  lastUpdateText: {
    fontSize: 11,
    color: Palette.textLight,
    marginTop: 2,
  },
  avancementPercentageBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  avancementPercentageText: {
    fontSize: 18,
    color: Palette.primary,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 4,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  commentBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  commentText: {
    fontSize: 12,
    color: Palette.textMuted,
    flex: 1,
    lineHeight: 17,
  },

  // ── Quick Access
  sectionGroupTitle: {
    fontSize: 16,
    color: Palette.text,
    marginBottom: 12,
  },
  quickAccessRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  quickAccessCard: {
    flex: 1,
    backgroundColor: Palette.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  quickAccessCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  quickAccessIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  quickAccessTitle: {
    fontSize: 15,
    color: Palette.text,
    marginBottom: 4,
  },
  quickAccessSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    lineHeight: 15,
    marginBottom: 12,
    minHeight: 30,
  },
  quickAccessFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 'auto',
  },
  quickAccessActionText: {
    fontSize: 12,
    color: Palette.primary,
  },

  // ── Map Button
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  mapButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
  },

  // ── Loading & Error States
  centerStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  stateText: {
    marginTop: 12,
    fontSize: 14,
  },
  stateCard: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
  },
  stateErrorText: {
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: Palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
