import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import {
  api,
  getMediaUrl,
  ChantierDetails,
  ChantierImage,
  ChantierObservationHistoryItem,
  ChantierAvancementTroncon,
  ChantierJournalResponse,
  ChantierJournalDay,
} from '@/services/api';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const MONTH_NAMES_SHORT_FR = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

const DAYS_OF_WEEK_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function formatDateYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateYMD(dateStr?: string | null): Date | null {
  if (!dateStr || !dateStr.includes('-')) return null;
  const parts = dateStr.split('T')[0].split('-').map(Number);
  if (parts.length !== 3 || isNaN(parts[0])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatFrenchDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const d = parseDateYMD(dateStr);
  if (!d) return dateStr;
  return `${d.getDate()} ${MONTH_NAMES_FR[d.getMonth()]} ${d.getFullYear()}`;
}

function formatObservationDateFrench(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const [datePart, timePart] = dateStr.split(' ');
    const d = parseDateYMD(datePart);
    if (!d) return dateStr;
    const dateFormatted = `${d.getDate()} ${MONTH_NAMES_FR[d.getMonth()]} ${d.getFullYear()}`;
    return timePart ? `${dateFormatted} · ${timePart}` : dateFormatted;
  } catch {
    return dateStr;
  }
}

type ImageCategory = 'satellite' | 'drone' | 'terrain';
type PeriodMode = 'JOUR' | 'PERIODE' | 'TOUTES';
type SortMode = 'RECENT' | 'ANCIEN' | 'PROGRESSION';

export default function ChantierImagesScreen() {
  const { id, tab, date } = useLocalSearchParams<{ id: string; tab?: string; date?: string }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();

  // Navigation tab
  const initialTab: ImageCategory = tab === 'terrain' ? 'terrain' : tab === 'drone' ? 'drone' : 'satellite';
  const [activeTab, setActiveTab] = useState<ImageCategory>(initialTab);

  // Data
  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [troncons, setTroncons] = useState<ChantierAvancementTroncon[]>([]);
  const [observations, setObservations] = useState<ChantierObservationHistoryItem[]>([]);
  const [journalData, setJournalData] = useState<ChantierJournalResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Current calendar view month (YYYY-MM)
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatDateYMD(today), [today]);
  const [calendarViewMonth, setCalendarViewMonth] = useState<string>(
    date ? date.slice(0, 7) : todayStr.slice(0, 7)
  );

  // Active Filters State
  const [periodMode, setPeriodMode] = useState<PeriodMode>(date ? 'JOUR' : 'TOUTES');
  const [selectedDay, setSelectedDay] = useState<string>(date || todayStr);
  const [startDate, setStartDate] = useState<string>(
    formatDateYMD(new Date(today.getFullYear(), today.getMonth(), 1))
  );
  const [endDate, setEndDate] = useState<string>(todayStr);
  const [selectedTronconId, setSelectedTronconId] = useState<number | 'ALL'>('ALL');
  const [selectedAgent, setSelectedAgent] = useState<string | 'ALL'>('ALL');
  const [sortMode, setSortMode] = useState<SortMode>('RECENT');

  // Modal controls
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const [isDatePickerModalVisible, setIsDatePickerModalVisible] = useState(false);
  const [datePickerTargetMode, setDatePickerTargetMode] = useState<'JOUR' | 'PERIODE'>('JOUR');
  const [datePickerRangeTarget, setDatePickerRangeTarget] = useState<'START' | 'END'>('START');

  // Draft filters inside Filter Bottom Sheet
  const [draftPeriodMode, setDraftPeriodMode] = useState<PeriodMode>(periodMode);
  const [draftSelectedDay, setDraftSelectedDay] = useState<string>(selectedDay);
  const [draftStartDate, setDraftStartDate] = useState<string>(startDate);
  const [draftEndDate, setDraftEndDate] = useState<string>(endDate);
  const [draftTronconId, setDraftTronconId] = useState<number | 'ALL'>(selectedTronconId);
  const [draftAgent, setDraftAgent] = useState<string | 'ALL'>(selectedAgent);
  const [draftSortMode, setDraftSortMode] = useState<SortMode>(sortMode);

  // Photo Lightbox State
  const [lightboxPhoto, setLightboxPhoto] = useState<{
    url: string;
    description?: string | null;
    obs: ChantierObservationHistoryItem;
    photoIndex: number;
    totalPhotos: number;
  } | null>(null);

  // Detail Relevé Modal State
  const [selectedReleveObs, setSelectedReleveObs] = useState<ChantierObservationHistoryItem | null>(null);

  // ── Data Fetching ──────────────────────────────────────────────────────────

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !id) {
      if (!isAuthLoading) setIsLoading(false);
      return;
    }

    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const [detailsRes, avancementRes] = await Promise.all([
        api.getChantierDetails(token, id),
        api.getChantierAvancement(token, id).catch((e) => {
          console.warn('[ImagesScreen] getChantierAvancement error:', e.message);
          return null;
        }),
      ]);

      setChantier(detailsRes.chantier);
      if (avancementRes) {
        setTroncons(avancementRes.troncons || (detailsRes.chantier.troncons as any) || []);
        setObservations(avancementRes.historique?.observations || []);
      } else if (detailsRes.chantier.troncons) {
        setTroncons(detailsRes.chantier.troncons as any);
      }

      // Fetch operational journal for calendar status dots
      try {
        const journalRes = await api.getChantierJournal(token, id, calendarViewMonth);
        setJournalData(journalRes);
      } catch (jErr: any) {
        console.warn('[ImagesScreen] getChantierJournal non-blocking:', jErr.message);
      }
    } catch (err: any) {
      console.error('[ImagesScreen] Error:', err.message);
      setError(err.message || 'Impossible de charger les données du chantier.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading, calendarViewMonth]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchDetails();
    }
  }, [fetchDetails, isAuthLoading]);

  // Handle URL param tab & date navigation from Avancement
  useEffect(() => {
    if (tab === 'terrain') setActiveTab('terrain');
    else if (tab === 'drone') setActiveTab('drone');
    else if (tab === 'satellite') setActiveTab('satellite');
  }, [tab]);

  useEffect(() => {
    if (date) {
      setPeriodMode('JOUR');
      setSelectedDay(date);
      setCalendarViewMonth(date.slice(0, 7));
    }
  }, [date]);

  // ── Filter Counts & Lists ──────────────────────────────────────────────────

  const distinctAgents = useMemo(() => {
    return Array.from(
      new Set(
        observations
          .map((o) => o.agent_nom)
          .filter((nom): nom is string => Boolean(nom && nom.trim()))
      )
    );
  }, [observations]);

  // Compute active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (periodMode !== 'TOUTES') count++;
    if (selectedTronconId !== 'ALL') count++;
    if (selectedAgent !== 'ALL') count++;
    return count;
  }, [periodMode, selectedTronconId, selectedAgent]);

  // Compute draft active filters count in bottom sheet
  const draftFiltersCount = useMemo(() => {
    let count = 0;
    if (draftPeriodMode !== 'TOUTES') count++;
    if (draftTronconId !== 'ALL') count++;
    if (draftAgent !== 'ALL') count++;
    return count;
  }, [draftPeriodMode, draftTronconId, draftAgent]);

  // Filtered & Sorted Observations
  const filteredObservations = useMemo(() => {
    let list = observations.filter((obs) => {
      // 1. Period filter
      if (periodMode === 'JOUR') {
        if (!obs.date_heure.startsWith(selectedDay)) return false;
      } else if (periodMode === 'PERIODE') {
        const obsDate = obs.date_heure.split(' ')[0];
        if (obsDate < startDate || obsDate > endDate) return false;
      }

      // 2. Tronçon filter
      if (selectedTronconId !== 'ALL') {
        if (obs.troncon_id !== selectedTronconId) return false;
      }

      // 3. Agent filter
      if (selectedAgent !== 'ALL') {
        if (selectedAgent === 'NON_AFFECTE') {
          if (Boolean(obs.agent_nom)) return false;
        } else if (obs.agent_nom !== selectedAgent) {
          return false;
        }
      }

      return true;
    });

    // Sort
    list.sort((a, b) => {
      if (sortMode === 'RECENT') {
        return b.date_heure.localeCompare(a.date_heure);
      } else if (sortMode === 'ANCIEN') {
        return a.date_heure.localeCompare(b.date_heure);
      } else if (sortMode === 'PROGRESSION') {
        return b.progress_percentage - a.progress_percentage;
      }
      return 0;
    });

    return list;
  }, [observations, periodMode, selectedDay, startDate, endDate, selectedTronconId, selectedAgent, sortMode]);

  const totalFilteredPhotos = useMemo(() => {
    return filteredObservations.reduce((acc, o) => acc + (o.photos ? o.photos.length : 0), 0);
  }, [filteredObservations]);

  const totalChantierPhotos = useMemo(() => {
    return observations.reduce((acc, o) => acc + (o.photos ? o.photos.length : 0), 0);
  }, [observations]);

  // Open Filter Bottom Sheet and sync draft states
  const openFilterSheet = () => {
    setDraftPeriodMode(periodMode);
    setDraftSelectedDay(selectedDay);
    setDraftStartDate(startDate);
    setDraftEndDate(endDate);
    setDraftTronconId(selectedTronconId);
    setDraftAgent(selectedAgent);
    setDraftSortMode(sortMode);
    setIsFilterSheetVisible(true);
  };

  const applyDraftFilters = () => {
    setPeriodMode(draftPeriodMode);
    setSelectedDay(draftSelectedDay);
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
    setSelectedTronconId(draftTronconId);
    setSelectedAgent(draftAgent);
    setSortMode(draftSortMode);
    setIsFilterSheetVisible(false);
  };

  const resetAllFilters = () => {
    setPeriodMode('TOUTES');
    setSelectedTronconId('ALL');
    setSelectedAgent('ALL');
    setSortMode('RECENT');
    setDraftPeriodMode('TOUTES');
    setDraftTronconId('ALL');
    setDraftAgent('ALL');
    setDraftSortMode('RECENT');
  };

  // Open Map Navigation
  const handleOpenMap = (tronconId?: number, observationId?: number) => {
    router.push({
      pathname: '/chantier/map/[id]',
      params: {
        id: String(id),
        ...(tronconId ? { tronconId: String(tronconId) } : {}),
        ...(observationId ? { observationId: String(observationId) } : {}),
      },
    } as any);
  };

  // Download / Share photo
  const handleDownloadPhoto = async (photoUrl: string) => {
    try {
      const fullUrl = getMediaUrl(photoUrl);
      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.open(fullUrl, '_blank');
        return;
      }
      const filename = photoUrl.split('/').pop() || 'photo_terrain.jpg';
      const localUri = `${FileSystem.cacheDirectory}${filename}`;
      const downloadRes = await FileSystem.downloadAsync(fullUrl, localUri);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(downloadRes.uri);
      } else {
        Alert.alert('Succès', 'Photo téléchargée avec succès.');
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de télécharger la photo.');
    }
  };

  // ── Calendar Helpers ───────────────────────────────────────────────────────

  const [calYear, calMonthNum] = calendarViewMonth.split('-').map(Number);
  const monthTitle = `${MONTH_NAMES_FR[(calMonthNum || 1) - 1]} ${calYear || 2026}`;

  const handlePrevCalMonth = () => {
    const prev = new Date(calYear, calMonthNum - 2, 1);
    setCalendarViewMonth(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleNextCalMonth = () => {
    const next = new Date(calYear, calMonthNum, 1);
    setCalendarViewMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  // Build calendar matrix (Monday = 1)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonthNum - 1, 1);
    const lastDay = new Date(calYear, calMonthNum, 0);
    const numDays = lastDay.getDate();

    // JS getDay(): 0 is Sunday, 1 is Monday ... convert so Monday is 0
    let startDayIndex = firstDay.getDay() - 1;
    if (startDayIndex === -1) startDayIndex = 6;

    const days: Array<{
      dayNum: number | null;
      dateStr: string | null;
      status: 'RELEVE' | 'SANS_RELEVE' | 'NON_TRAVAILLE' | 'A_VENIR';
    }> = [];

    // Leading empty slots
    for (let i = 0; i < startDayIndex; i++) {
      days.push({ dayNum: null, dateStr: null, status: 'A_VENIR' });
    }

    // Days of month
    for (let d = 1; d <= numDays; d++) {
      const dateStr = `${calYear}-${String(calMonthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dObj = new Date(calYear, calMonthNum - 1, d);
      const dayOfWeek = dObj.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Check if observations exist on this day in memory
      const hasObs = observations.some((o) => o.date_heure.startsWith(dateStr));
      const journalDay = journalData?.days?.find((jd) => jd.date === dateStr);

      let status: 'RELEVE' | 'SANS_RELEVE' | 'NON_TRAVAILLE' | 'A_VENIR' = 'NON_TRAVAILLE';

      if (hasObs || (journalDay && journalDay.observations_count > 0)) {
        status = 'RELEVE';
      } else if (journalDay && (journalDay.is_non_travaille || journalDay.is_ferie)) {
        status = 'NON_TRAVAILLE';
      } else if (dateStr > todayStr) {
        status = 'A_VENIR';
      } else if (isWeekend) {
        status = 'NON_TRAVAILLE';
      } else {
        status = 'SANS_RELEVE';
      }

      days.push({
        dayNum: d,
        dateStr,
        status,
      });
    }

    // Trailing empty slots to complete full weeks
    while (days.length % 7 !== 0) {
      days.push({ dayNum: null, dateStr: null, status: 'A_VENIR' });
    }

    return days;
  }, [calYear, calMonthNum, observations, journalData, todayStr]);

  // Period Shortcuts
  const applyPeriodShortcut = (type: 'TODAY' | 'YESTERDAY' | 'WEEK' | 'MONTH' | 'PREV_MONTH' | 'LAST_3_MONTHS') => {
    const t = new Date();
    if (type === 'TODAY') {
      const dStr = formatDateYMD(t);
      setDraftPeriodMode('JOUR');
      setDraftSelectedDay(dStr);
    } else if (type === 'YESTERDAY') {
      const y = new Date(t);
      y.setDate(y.getDate() - 1);
      const dStr = formatDateYMD(y);
      setDraftPeriodMode('JOUR');
      setDraftSelectedDay(dStr);
    } else if (type === 'WEEK') {
      const monday = new Date(t);
      const day = monday.getDay() || 7;
      monday.setDate(monday.getDate() - day + 1);
      setDraftPeriodMode('PERIODE');
      setDraftStartDate(formatDateYMD(monday));
      setDraftEndDate(formatDateYMD(t));
    } else if (type === 'MONTH') {
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      setDraftPeriodMode('PERIODE');
      setDraftStartDate(formatDateYMD(start));
      setDraftEndDate(formatDateYMD(t));
    } else if (type === 'PREV_MONTH') {
      const start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const end = new Date(t.getFullYear(), t.getMonth(), 0);
      setDraftPeriodMode('PERIODE');
      setDraftStartDate(formatDateYMD(start));
      setDraftEndDate(formatDateYMD(end));
    } else if (type === 'LAST_3_MONTHS') {
      const start = new Date(t.getFullYear(), t.getMonth() - 2, 1);
      setDraftPeriodMode('PERIODE');
      setDraftStartDate(formatDateYMD(start));
      setDraftEndDate(formatDateYMD(t));
    }
  };

  // ── Render Loading / Error ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Palette.primary} />
          <Text variant="muted" style={styles.loadingText}>
            Chargement de la médiathèque...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !chantier) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Card variant="elevated" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={32} color={Palette.alert} />
            <Text variant="error" style={styles.errorText}>
              {error || 'Données introuvables.'}
            </Text>
            <TouchableOpacity onPress={() => fetchDetails()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const satelliteImages: ChantierImage[] = chantier.images || [];

  // Selected Tronçon object
  const activeTronconObj = troncons.find((t) => t.id === selectedTronconId);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── 1. Top Navigation Bar ── */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.primary} />
          <Text style={styles.backButtonText} weight="semibold">
            Chantier
          </Text>
        </TouchableOpacity>
        <Text variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          Images & Télédétection
        </Text>
        <View style={{ width: 70 }} />
      </View>

      {/* ── 2. Category Tabs ── */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'satellite' && styles.tabButtonActive]}
          onPress={() => setActiveTab('satellite')}
        >
          <Text
            style={[styles.tabText, activeTab === 'satellite' && styles.tabTextActive]}
            weight={activeTab === 'satellite' ? 'bold' : 'normal'}
          >
            Satellite ({satelliteImages.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'drone' && styles.tabButtonActive]}
          onPress={() => setActiveTab('drone')}
        >
          <Text
            style={[styles.tabText, activeTab === 'drone' && styles.tabTextActive]}
            weight={activeTab === 'drone' ? 'bold' : 'normal'}
          >
            Drone (0)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'terrain' && styles.tabButtonActive]}
          onPress={() => setActiveTab('terrain')}
        >
          <Text
            style={[styles.tabText, activeTab === 'terrain' && styles.tabTextActive]}
            weight={activeTab === 'terrain' ? 'bold' : 'normal'}
          >
            Photos terrain ({totalChantierPhotos})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDetails(true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ══════════════ TAB 1: SATELLITE ══════════════ */}
        {activeTab === 'satellite' && (
          <View style={styles.tabSection}>
            {satelliteImages.length === 0 ? (
              <Card variant="elevated" style={styles.emptyCard}>
                <Ionicons name="planet-outline" size={48} color={Palette.textLight} />
                <Text variant="h3" style={styles.emptyTitle}>
                  Aucune image satellite
                </Text>
                <Text variant="muted" style={styles.emptyText}>
                  Les acquisitions Sentinel-2 et PlanetScope liées à ce chantier apparaîtront ici.
                </Text>
              </Card>
            ) : (
              satelliteImages.map((img) => (
                <Card key={img.id} variant="elevated" style={styles.imageCard}>
                  <View style={styles.imageCardHeader}>
                    <View style={styles.satelliteBadge}>
                      <Ionicons name="planet" size={14} color="#2563EB" />
                      <Text style={styles.satelliteBadgeText} weight="bold">
                        {img.source || 'Satellite'}
                      </Text>
                    </View>
                    <Text style={styles.imageDateText}>
                      {formatFrenchDate(img.date_acquisition)}
                    </Text>
                  </View>

                  <View style={styles.satellitePreviewBanner}>
                    <Ionicons name="earth-outline" size={36} color={Palette.primary} />
                    <Text style={styles.satellitePreviewLabel}>
                      {img.type_image || 'Optique Multispectrale'}
                    </Text>
                    <Text style={styles.satelliteIndexBadge}>
                      Indice : {img.indice_spectral || 'NDVI'} • Résolution : {img.resolution || 10}m
                    </Text>
                  </View>

                  <View style={styles.metaGrid}>
                    <View style={styles.metaCol}>
                      <Text style={styles.metaColLabel}>Couverture nuageuse</Text>
                      <Text style={styles.metaColValue} weight="medium">
                        {img.cloud_coverage !== null && img.cloud_coverage !== undefined
                          ? `${img.cloud_coverage}%`
                          : '0%'}
                      </Text>
                    </View>

                    <View style={styles.metaCol}>
                      <Text style={styles.metaColLabel}>Fichier source</Text>
                      <Text style={styles.metaColValue} numberOfLines={1} weight="medium">
                        {img.url_fichier?.split('/').pop() || 'raster.tif'}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* ══════════════ TAB 2: DRONE ══════════════ */}
        {activeTab === 'drone' && (
          <Card variant="elevated" style={styles.emptyCard}>
            <Ionicons name="airplane-outline" size={48} color={Palette.textLight} />
            <Text variant="h3" style={styles.emptyTitle}>
              Aucune mission drone
            </Text>
            <Text variant="muted" style={styles.emptyText}>
              Les orthophotos et modèles numériques d'élévation (MNE) par drone seront accessibles après validation opérationnelle.
            </Text>
          </Card>
        )}

        {/* ══════════════ TAB 3: PHOTOS TERRAIN (Exact Target UI) ══════════════ */}
        {activeTab === 'terrain' && (
          <View style={styles.tabSection}>
            {/* ── 1. Date Selector Bar + Filters Button ── */}
            <View style={styles.topControlRow}>
              {/* Date Button (opens date picker) */}
              <TouchableOpacity
                style={styles.dateSelectorBtn}
                activeOpacity={0.8}
                onPress={() => {
                  setDatePickerTargetMode(periodMode === 'PERIODE' ? 'PERIODE' : 'JOUR');
                  setIsDatePickerModalVisible(true);
                }}
              >
                <Ionicons name="calendar-outline" size={16} color={Palette.primary} />
                <Text style={styles.dateSelectorBtnText} weight="medium" numberOfLines={1}>
                  {periodMode === 'JOUR'
                    ? formatFrenchDate(selectedDay)
                    : periodMode === 'PERIODE'
                    ? `${formatFrenchDate(startDate)} → ${formatFrenchDate(endDate)}`
                    : 'Toutes les dates'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={Palette.textLight} />
              </TouchableOpacity>

              {/* Filtres Button with count badge */}
              <TouchableOpacity
                style={styles.filterTriggerBtn}
                activeOpacity={0.8}
                onPress={openFilterSheet}
              >
                <Ionicons name="options-outline" size={16} color={Palette.primary} />
                <Text style={styles.filterTriggerBtnText} weight="semibold">
                  Filtres
                </Text>
                {activeFiltersCount > 0 && (
                  <View style={styles.filterBadge}>
                    <Text style={styles.filterBadgeText}>{activeFiltersCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {/* ── 2. Active Filter Chips Row ── */}
            {activeFiltersCount > 0 && (
              <View style={styles.activeChipsContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeChipsRow}>
                  {periodMode === 'JOUR' && (
                    <View style={styles.activeChip}>
                      <Text style={styles.activeChipText}>{formatFrenchDate(selectedDay)}</Text>
                      <TouchableOpacity onPress={() => setPeriodMode('TOUTES')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close" size={14} color={Palette.text} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {periodMode === 'PERIODE' && (
                    <View style={styles.activeChip}>
                      <Text style={styles.activeChipText}>
                        {formatFrenchDate(startDate)} - {formatFrenchDate(endDate)}
                      </Text>
                      <TouchableOpacity onPress={() => setPeriodMode('TOUTES')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close" size={14} color={Palette.text} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {selectedTronconId !== 'ALL' && activeTronconObj && (
                    <View style={styles.activeChip}>
                      <Text style={styles.activeChipText}>{(activeTronconObj as any).code || 'T'}</Text>
                      <TouchableOpacity onPress={() => setSelectedTronconId('ALL')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close" size={14} color={Palette.text} />
                      </TouchableOpacity>
                    </View>
                  )}

                  {selectedAgent !== 'ALL' && (
                    <View style={styles.activeChip}>
                      <Text style={styles.activeChipText}>
                        {selectedAgent === 'NON_AFFECTE' ? 'Non affecté' : selectedAgent}
                      </Text>
                      <TouchableOpacity onPress={() => setSelectedAgent('ALL')} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close" size={14} color={Palette.text} />
                      </TouchableOpacity>
                    </View>
                  )}

                  <TouchableOpacity onPress={resetAllFilters} style={styles.clearAllLink}>
                    <Text style={styles.clearAllLinkText} weight="semibold">
                      Tout effacer
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            )}

            {/* ── 3. Results Header & Sort Dropdown ── */}
            <View style={styles.resultsHeaderRow}>
              <View>
                <Text style={styles.resultsMainTitle} weight="bold">
                  Photos et observations
                </Text>
                <Text style={styles.resultsSubtitle}>
                  {filteredObservations.length} résultat{filteredObservations.length > 1 ? 's' : ''} •{' '}
                  {totalFilteredPhotos} photo{totalFilteredPhotos > 1 ? 's' : ''} •{' '}
                  {filteredObservations.length} relevé{filteredObservations.length > 1 ? 's' : ''}
                </Text>
              </View>

              {/* Sort Selector Button */}
              <TouchableOpacity
                style={styles.sortDropdownBtn}
                activeOpacity={0.8}
                onPress={() => {
                  if (sortMode === 'RECENT') setSortMode('ANCIEN');
                  else if (sortMode === 'ANCIEN') setSortMode('PROGRESSION');
                  else setSortMode('RECENT');
                }}
              >
                <Text style={styles.sortDropdownBtnText} weight="medium">
                  {sortMode === 'RECENT' ? 'Plus récent' : sortMode === 'ANCIEN' ? 'Plus ancien' : 'Progression ↑'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {/* ── 4. Observations List ── */}
            {filteredObservations.length === 0 ? (
              <Card variant="elevated" style={styles.emptyCard}>
                <Ionicons name="camera-outline" size={48} color={Palette.textLight} />
                <Text variant="h3" style={styles.emptyTitle}>
                  Aucune photo de terrain
                </Text>
                <Text variant="muted" style={styles.emptyText}>
                  Modifiez la période ou les filtres pour afficher les observations disponibles.
                </Text>
                <TouchableOpacity onPress={resetAllFilters} style={[styles.retryBtn, { marginTop: 16 }]}>
                  <Text style={styles.retryBtnText} weight="semibold">
                    Réinitialiser les filtres
                  </Text>
                </TouchableOpacity>
              </Card>
            ) : (
              filteredObservations.map((obs) => {
                const photos = obs.photos || [];
                const photoCount = photos.length;
                const heroPhoto = photoCount > 0 ? photos[0] : null;

                return (
                  <Card key={obs.id} variant="elevated" style={styles.observationCard}>
                    {/* Top Row: Tronçon badge, Date, and Progress badge */}
                    <View style={styles.obsCardTopRow}>
                      <View style={styles.obsTopLeft}>
                        <View style={styles.tronconCodeBadge}>
                          <Text style={styles.tronconCodeBadgeText} weight="bold">
                            {obs.troncon_code}
                          </Text>
                        </View>
                        <Text style={styles.obsDateTitle} weight="semibold">
                          {formatObservationDateFrench(obs.date_heure)}
                        </Text>
                      </View>

                      <View style={styles.progressPillBadge}>
                        <Text style={styles.progressPillText} weight="bold">
                          {obs.progress_percentage}%
                        </Text>
                      </View>
                    </View>

                    {/* Hero Photo with Badge */}
                    {heroPhoto ? (
                      <TouchableOpacity
                        style={styles.heroPhotoWrapper}
                        activeOpacity={0.9}
                        onPress={() =>
                          setLightboxPhoto({
                            url: heroPhoto.url,
                            description: heroPhoto.description,
                            obs,
                            photoIndex: 0,
                            totalPhotos: photoCount,
                          })
                        }
                      >
                        <Image
                          source={{ uri: getMediaUrl(heroPhoto.url) }}
                          style={styles.heroPhotoImage}
                          resizeMode="cover"
                        />
                        {/* Photo count badge */}
                        <View style={styles.photoCountBadge}>
                          <Ionicons name="camera" size={13} color="#FFFFFF" />
                          <Text style={styles.photoCountBadgeText} weight="bold">
                            {photoCount}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <View style={styles.noPhotoPlaceholder}>
                        <Ionicons name="image-outline" size={24} color="#94A3B8" />
                        <Text style={styles.noPhotoPlaceholderText}>
                          Relevé enregistré sans photo jointe
                        </Text>
                      </View>
                    )}

                    {/* Metadata Row: Agent, PK, Activity */}
                    <View style={styles.obsMetaSection}>
                      <View style={styles.obsMetaRow}>
                        <View style={styles.obsMetaItem}>
                          <Ionicons name="person-outline" size={14} color={Palette.textLight} />
                          <Text style={styles.obsMetaItemText}>
                            {obs.agent_nom || 'Agent Terrain'}
                          </Text>
                        </View>
                        {Boolean(obs.chainage) && (
                          <View style={styles.obsMetaItem}>
                            <Ionicons name="pin-outline" size={14} color={Palette.textLight} />
                            <Text style={styles.obsMetaItemText}>PK {obs.chainage}</Text>
                          </View>
                        )}
                      </View>

                      {Boolean(obs.phase) && (
                        <View style={styles.obsMetaItem}>
                          <Ionicons name="construct-outline" size={14} color={Palette.textLight} />
                          <Text style={styles.obsMetaItemText}>
                            {obs.phase}{obs.phase_statut ? ` (${obs.phase_statut})` : ''}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Comment Quote Box */}
                    {Boolean(obs.commentaire) && (
                      <View style={styles.commentQuoteBox}>
                        <Text style={styles.commentQuoteText}>
                          « {obs.commentaire} »
                        </Text>
                      </View>
                    )}

                    {/* View Details and View on Map Action Buttons */}
                    <View style={styles.obsCardFooter}>
                      <TouchableOpacity
                        style={styles.viewReleveBtn}
                        activeOpacity={0.7}
                        onPress={() => setSelectedReleveObs(obs)}
                      >
                        <Ionicons name="document-text-outline" size={15} color={Palette.primary} />
                        <Text style={styles.viewReleveBtnText} weight="semibold">
                          Voir le relevé
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.viewMapBtn}
                        activeOpacity={0.85}
                        onPress={() => handleOpenMap(obs.troncon_id, obs.id)}
                      >
                        <Ionicons name="map-outline" size={15} color="#FFFFFF" />
                        <Text style={styles.viewMapBtnText} weight="semibold">
                          Voir sur la carte
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })
            )}

            {/* ── 5. Bottom Overview Map Button ── */}
            {filteredObservations.length > 0 && (
              <TouchableOpacity
                style={styles.floatingMapBtn}
                activeOpacity={0.88}
                onPress={() => handleOpenMap()}
              >
                <Ionicons name="images-outline" size={18} color="#FFFFFF" />
                <Text style={styles.floatingMapBtnText} weight="bold">
                  Voir toutes les photos sur la carte ({filteredObservations.length})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════════════
          2. PANNEAU DE FILTRES (BOTTOM SHEET MODAL)
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isFilterSheetVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsFilterSheetVisible(false)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable style={styles.bottomSheetDismissArea} onPress={() => setIsFilterSheetVisible(false)} />
          <View style={styles.bottomSheetContainer}>
            {/* Header */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeaderTitle} weight="bold">
                Filtres
              </Text>
              <TouchableOpacity onPress={() => setIsFilterSheetVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color={Palette.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={styles.sheetBody}>
              {/* SECTION: Période */}
              <View style={styles.sheetSection}>
                <View style={styles.sheetSectionTitleRow}>
                  <Ionicons name="calendar-outline" size={16} color={Palette.primary} />
                  <Text style={styles.sheetSectionTitle} weight="bold">
                    Période
                  </Text>
                </View>

                {/* Segmented Period Tabs: [ Jour | Période | Toutes ] */}
                <View style={styles.periodSegmentedBar}>
                  <TouchableOpacity
                    style={[styles.periodSegmentBtn, draftPeriodMode === 'JOUR' && styles.periodSegmentBtnActive]}
                    onPress={() => setDraftPeriodMode('JOUR')}
                  >
                    <Text style={[styles.periodSegmentBtnText, draftPeriodMode === 'JOUR' && styles.periodSegmentBtnTextActive]}>
                      Jour
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.periodSegmentBtn, draftPeriodMode === 'PERIODE' && styles.periodSegmentBtnActive]}
                    onPress={() => setDraftPeriodMode('PERIODE')}
                  >
                    <Text style={[styles.periodSegmentBtnText, draftPeriodMode === 'PERIODE' && styles.periodSegmentBtnTextActive]}>
                      Période
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.periodSegmentBtn, draftPeriodMode === 'TOUTES' && styles.periodSegmentBtnActive]}
                    onPress={() => setDraftPeriodMode('TOUTES')}
                  >
                    <Text style={[styles.periodSegmentBtnText, draftPeriodMode === 'TOUTES' && styles.periodSegmentBtnTextActive]}>
                      Toutes
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Date Input Button based on mode */}
                {draftPeriodMode === 'JOUR' && (
                  <TouchableOpacity
                    style={styles.sheetDateInputBtn}
                    onPress={() => {
                      setDatePickerTargetMode('JOUR');
                      setIsDatePickerModalVisible(true);
                    }}
                  >
                    <Ionicons name="calendar" size={16} color={Palette.primary} />
                    <Text style={styles.sheetDateInputBtnText} weight="medium">
                      {formatFrenchDate(draftSelectedDay)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={Palette.textLight} />
                  </TouchableOpacity>
                )}

                {draftPeriodMode === 'PERIODE' && (
                  <View style={styles.sheetDateRangeRow}>
                    <TouchableOpacity
                      style={styles.sheetRangeInputBtn}
                      onPress={() => {
                        setDatePickerTargetMode('PERIODE');
                        setDatePickerRangeTarget('START');
                        setIsDatePickerModalVisible(true);
                      }}
                    >
                      <Text style={styles.sheetRangeInputLabel}>Date début</Text>
                      <View style={styles.sheetRangeInputInner}>
                        <Ionicons name="calendar-outline" size={14} color={Palette.primary} />
                        <Text style={styles.sheetRangeInputText}>{formatFrenchDate(draftStartDate)}</Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.sheetRangeInputBtn}
                      onPress={() => {
                        setDatePickerTargetMode('PERIODE');
                        setDatePickerRangeTarget('END');
                        setIsDatePickerModalVisible(true);
                      }}
                    >
                      <Text style={styles.sheetRangeInputLabel}>Date fin</Text>
                      <View style={styles.sheetRangeInputInner}>
                        <Ionicons name="calendar-outline" size={14} color={Palette.primary} />
                        <Text style={styles.sheetRangeInputText}>{formatFrenchDate(draftEndDate)}</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Raccourcis chips */}
                <Text style={styles.shortcutsLabel}>Raccourcis</Text>
                <View style={styles.shortcutsWrap}>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('TODAY')}>
                    <Text style={styles.shortcutChipText}>Aujourd'hui</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('YESTERDAY')}>
                    <Text style={styles.shortcutChipText}>Hier</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('WEEK')}>
                    <Text style={styles.shortcutChipText}>Cette semaine</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('MONTH')}>
                    <Text style={styles.shortcutChipText}>Ce mois</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('PREV_MONTH')}>
                    <Text style={styles.shortcutChipText}>Mois précédent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('LAST_3_MONTHS')}>
                    <Text style={styles.shortcutChipText}>Les 3 derniers mois</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* SECTION: Tronçon */}
              <View style={styles.sheetSection}>
                <View style={styles.sheetSectionTitleRow}>
                  <Ionicons name="git-commit-outline" size={16} color={Palette.primary} />
                  <Text style={styles.sheetSectionTitle} weight="bold">
                    Tronçon
                  </Text>
                </View>

                {/* Radio: Tous les tronçons */}
                <TouchableOpacity
                  style={styles.radioOptionRow}
                  activeOpacity={0.7}
                  onPress={() => setDraftTronconId('ALL')}
                >
                  <View style={[styles.radioCircle, draftTronconId === 'ALL' && styles.radioCircleActive]}>
                    {draftTronconId === 'ALL' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.radioLabel} weight={draftTronconId === 'ALL' ? 'semibold' : 'normal'}>
                    Tous les tronçons
                  </Text>
                </TouchableOpacity>

                {/* Radio options for each tronçon */}
                {troncons.map((t, idx) => {
                  const tCode = (t as any).code || `T${idx + 1}`;
                  const isSelected = draftTronconId === t.id;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.radioOptionRow}
                      activeOpacity={0.7}
                      onPress={() => setDraftTronconId(t.id)}
                    >
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleActive]}>
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                      <Text style={styles.radioLabel} weight={isSelected ? 'semibold' : 'normal'}>
                        {tCode} — {t.nom}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* SECTION: Agent de terrain */}
              <View style={styles.sheetSection}>
                <View style={styles.sheetSectionTitleRow}>
                  <Ionicons name="people-outline" size={16} color={Palette.primary} />
                  <Text style={styles.sheetSectionTitle} weight="bold">
                    Agent de terrain
                  </Text>
                </View>

                {/* Radio: Tous les A.T. */}
                <TouchableOpacity
                  style={styles.radioOptionRow}
                  activeOpacity={0.7}
                  onPress={() => setDraftAgent('ALL')}
                >
                  <View style={[styles.radioCircle, draftAgent === 'ALL' && styles.radioCircleActive]}>
                    {draftAgent === 'ALL' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.radioLabel} weight={draftAgent === 'ALL' ? 'semibold' : 'normal'}>
                    Tous les A.T.
                  </Text>
                </TouchableOpacity>

                {/* Radio: Agents réels */}
                {distinctAgents.map((ag) => {
                  const isSelected = draftAgent === ag;
                  return (
                    <TouchableOpacity
                      key={ag}
                      style={styles.radioOptionRow}
                      activeOpacity={0.7}
                      onPress={() => setDraftAgent(ag)}
                    >
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleActive]}>
                        {isSelected && <View style={styles.radioDot} />}
                      </View>
                      <Text style={styles.radioLabel} weight={isSelected ? 'semibold' : 'normal'}>
                        {ag}
                      </Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Radio: Non affecté */}
                <TouchableOpacity
                  style={styles.radioOptionRow}
                  activeOpacity={0.7}
                  onPress={() => setDraftAgent('NON_AFFECTE')}
                >
                  <View style={[styles.radioCircle, draftAgent === 'NON_AFFECTE' && styles.radioCircleActive]}>
                    {draftAgent === 'NON_AFFECTE' && <View style={styles.radioDot} />}
                  </View>
                  <Text style={styles.radioLabel} weight={draftAgent === 'NON_AFFECTE' ? 'semibold' : 'normal'}>
                    Non affecté
                  </Text>
                </TouchableOpacity>
              </View>

              {/* SECTION: Tri des résultats */}
              <View style={styles.sheetSection}>
                <View style={styles.sheetSectionTitleRow}>
                  <Ionicons name="swap-vertical-outline" size={16} color={Palette.primary} />
                  <Text style={styles.sheetSectionTitle} weight="bold">
                    Tri des résultats
                  </Text>
                </View>

                <View style={styles.sortOptionsRow}>
                  <TouchableOpacity
                    style={[styles.sortChip, draftSortMode === 'RECENT' && styles.sortChipActive]}
                    onPress={() => setDraftSortMode('RECENT')}
                  >
                    <Text style={[styles.sortChipText, draftSortMode === 'RECENT' && styles.sortChipTextActive]}>
                      Plus récent
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.sortChip, draftSortMode === 'ANCIEN' && styles.sortChipActive]}
                    onPress={() => setDraftSortMode('ANCIEN')}
                  >
                    <Text style={[styles.sortChipText, draftSortMode === 'ANCIEN' && styles.sortChipTextActive]}>
                      Plus ancien
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.sortChip, draftSortMode === 'PROGRESSION' && styles.sortChipActive]}
                    onPress={() => setDraftSortMode('PROGRESSION')}
                  >
                    <Text style={[styles.sortChipText, draftSortMode === 'PROGRESSION' && styles.sortChipTextActive]}>
                      Progression ↑
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            {/* Footer Actions: [ Réinitialiser ] [ Appliquer (X) ] */}
            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.sheetResetBtn}
                onPress={() => {
                  setDraftPeriodMode('TOUTES');
                  setDraftTronconId('ALL');
                  setDraftAgent('ALL');
                  setDraftSortMode('RECENT');
                }}
              >
                <Text style={styles.sheetResetBtnText} weight="semibold">
                  Réinitialiser
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetApplyBtn}
                activeOpacity={0.85}
                onPress={applyDraftFilters}
              >
                <Text style={styles.sheetApplyBtnText} weight="bold">
                  Appliquer{draftFiltersCount > 0 ? ` (${draftFiltersCount})` : ''}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════
          3. SÉLECTEUR DE DATE (CALENDRIER MODAL)
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isDatePickerModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsDatePickerModalVisible(false)}
      >
        <View style={styles.calendarModalOverlay}>
          <View style={styles.calendarCardContainer}>
            {/* Modal Title Bar */}
            <View style={styles.calendarModalHeader}>
              <Text style={styles.calendarModalTitle} weight="bold">
                Sélectionner une {datePickerTargetMode === 'JOUR' ? 'date' : 'période'}
              </Text>
              <TouchableOpacity onPress={() => setIsDatePickerModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {/* Segmented Switcher [ Jour | Période ] */}
            <View style={styles.calendarSegmentedRow}>
              <TouchableOpacity
                style={[styles.calSegmentBtn, datePickerTargetMode === 'JOUR' && styles.calSegmentBtnActive]}
                onPress={() => setDatePickerTargetMode('JOUR')}
              >
                <Text style={[styles.calSegmentBtnText, datePickerTargetMode === 'JOUR' && styles.calSegmentBtnTextActive]}>
                  Jour
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.calSegmentBtn, datePickerTargetMode === 'PERIODE' && styles.calSegmentBtnActive]}
                onPress={() => setDatePickerTargetMode('PERIODE')}
              >
                <Text style={[styles.calSegmentBtnText, datePickerTargetMode === 'PERIODE' && styles.calSegmentBtnTextActive]}>
                  Période
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── MODE 1: JOUR ── */}
            {datePickerTargetMode === 'JOUR' && (
              <View style={styles.calendarModeView}>
                {/* Month Navigation < Août 2026 > */}
                <View style={styles.calMonthNavRow}>
                  <TouchableOpacity onPress={handlePrevCalMonth} style={styles.calMonthNavArrow}>
                    <Ionicons name="chevron-back" size={18} color={Palette.text} />
                  </TouchableOpacity>
                  <Text style={styles.calMonthTitle} weight="bold">
                    {monthTitle}
                  </Text>
                  <TouchableOpacity onPress={handleNextCalMonth} style={styles.calMonthNavArrow}>
                    <Ionicons name="chevron-forward" size={18} color={Palette.text} />
                  </TouchableOpacity>
                </View>

                {/* Day of Week Headers */}
                <View style={styles.calWeekdaysRow}>
                  {DAYS_OF_WEEK_SHORT.map((wd) => (
                    <Text key={wd} style={styles.calWeekdayText}>
                      {wd}
                    </Text>
                  ))}
                </View>

                {/* Days Grid */}
                <View style={styles.calDaysGrid}>
                  {calendarDays.map((item, idx) => {
                    if (!item.dayNum || !item.dateStr) {
                      return <View key={`empty-${idx}`} style={styles.calDayCell} />;
                    }

                    const isSelected = item.dateStr === draftSelectedDay;

                    return (
                      <TouchableOpacity
                        key={item.dateStr}
                        style={[styles.calDayCell, isSelected && styles.calDayCellSelected]}
                        onPress={() => {
                          setDraftSelectedDay(item.dateStr!);
                          setDraftPeriodMode('JOUR');
                        }}
                      >
                        <Text style={[styles.calDayNumText, isSelected && styles.calDayNumTextSelected]}>
                          {item.dayNum}
                        </Text>

                        {/* Status Dot */}
                        {!isSelected && (
                          <View
                            style={[
                              styles.calDayStatusDot,
                              item.status === 'RELEVE'
                                ? styles.dotGreen
                                : item.status === 'SANS_RELEVE'
                                ? styles.dotRed
                                : item.status === 'NON_TRAVAILLE'
                                ? styles.dotGrey
                                : styles.dotClear,
                            ]}
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Status Legend */}
                <View style={styles.calLegendRow}>
                  <View style={styles.calLegendItem}>
                    <View style={[styles.calLegendDot, { backgroundColor: '#16A34A' }]} />
                    <Text style={styles.calLegendLabel}>Relevé</Text>
                  </View>
                  <View style={styles.calLegendItem}>
                    <View style={[styles.calLegendDot, { backgroundColor: '#DC2626' }]} />
                    <Text style={styles.calLegendLabel}>Sans relevé</Text>
                  </View>
                  <View style={styles.calLegendItem}>
                    <View style={[styles.calLegendDot, { backgroundColor: '#94A3B8' }]} />
                    <Text style={styles.calLegendLabel}>Non travaillé</Text>
                  </View>
                </View>

                {/* Button Aujourd'hui */}
                <TouchableOpacity
                  style={styles.calTodayBtn}
                  onPress={() => {
                    setDraftSelectedDay(todayStr);
                    setDraftPeriodMode('JOUR');
                    setCalendarViewMonth(todayStr.slice(0, 7));
                  }}
                >
                  <Text style={styles.calTodayBtnText} weight="semibold">
                    Aujourd'hui
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── MODE 2: PÉRIODE ── */}
            {datePickerTargetMode === 'PERIODE' && (
              <View style={styles.calendarModeView}>
                <View style={styles.sheetDateRangeRow}>
                  <View style={[styles.sheetRangeInputBtn, datePickerRangeTarget === 'START' && styles.rangeBtnActive]}>
                    <Text style={styles.sheetRangeInputLabel}>Date début</Text>
                    <View style={styles.sheetRangeInputInner}>
                      <Ionicons name="calendar-outline" size={14} color={Palette.primary} />
                      <Text style={styles.sheetRangeInputText}>{formatFrenchDate(draftStartDate)}</Text>
                    </View>
                  </View>

                  <View style={[styles.sheetRangeInputBtn, datePickerRangeTarget === 'END' && styles.rangeBtnActive]}>
                    <Text style={styles.sheetRangeInputLabel}>Date fin</Text>
                    <View style={styles.sheetRangeInputInner}>
                      <Ionicons name="calendar-outline" size={14} color={Palette.primary} />
                      <Text style={styles.sheetRangeInputText}>{formatFrenchDate(draftEndDate)}</Text>
                    </View>
                  </View>
                </View>

                {/* Raccourcis chips */}
                <Text style={[styles.shortcutsLabel, { marginTop: 12 }]}>Raccourcis</Text>
                <View style={styles.shortcutsWrap}>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('WEEK')}>
                    <Text style={styles.shortcutChipText}>Cette semaine</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('MONTH')}>
                    <Text style={styles.shortcutChipText}>Ce mois</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('PREV_MONTH')}>
                    <Text style={styles.shortcutChipText}>Mois précédent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.shortcutChip} onPress={() => applyPeriodShortcut('LAST_3_MONTHS')}>
                    <Text style={styles.shortcutChipText}>Les 3 derniers mois</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Modal Bottom Actions: [ Annuler ] [ Appliquer ] */}
            <View style={styles.calModalFooter}>
              <TouchableOpacity
                style={styles.calCancelBtn}
                onPress={() => setIsDatePickerModalVisible(false)}
              >
                <Text style={styles.calCancelBtnText} weight="semibold">
                  Annuler
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.calApplyBtn}
                onPress={() => {
                  if (datePickerTargetMode === 'JOUR') {
                    setPeriodMode('JOUR');
                    setSelectedDay(draftSelectedDay);
                  } else {
                    setPeriodMode('PERIODE');
                    setStartDate(draftStartDate);
                    setEndDate(draftEndDate);
                  }
                  setIsDatePickerModalVisible(false);
                  if (isFilterSheetVisible) {
                    setDraftPeriodMode(datePickerTargetMode);
                  }
                }}
              >
                <Text style={styles.calApplyBtnText} weight="bold">
                  Appliquer
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════
          4. VISIONNEUSE PHOTO (FULLSCREEN LIGHTBOX MODAL)
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={Boolean(lightboxPhoto)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLightboxPhoto(null)}
      >
        <View style={styles.lightboxBackdrop}>
          {lightboxPhoto && (
            <SafeAreaView style={styles.lightboxSafeContainer} edges={['top', 'bottom']}>
              {/* Top Bar: [ ✕ ]  Counter 1 / 1 */}
              <View style={styles.lightboxTopBar}>
                <TouchableOpacity
                  style={styles.lightboxCloseBtn}
                  onPress={() => setLightboxPhoto(null)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="close" size={26} color="#FFFFFF" />
                </TouchableOpacity>

                <Text style={styles.lightboxCounterText} weight="bold">
                  {lightboxPhoto.photoIndex + 1} / {lightboxPhoto.totalPhotos}
                </Text>

                <View style={{ width: 40 }} />
              </View>

              {/* Large Image with Navigation Arrows */}
              <View style={styles.lightboxImageContainer}>
                <Image
                  source={{ uri: getMediaUrl(lightboxPhoto.url) }}
                  style={styles.lightboxImage}
                  resizeMode="contain"
                />

                {/* Left Arrow */}
                {lightboxPhoto.totalPhotos > 1 && lightboxPhoto.photoIndex > 0 && (
                  <TouchableOpacity
                    style={[styles.lightboxNavArrow, { left: 12 }]}
                    onPress={() => {
                      const prevIdx = lightboxPhoto.photoIndex - 1;
                      const prevP = lightboxPhoto.obs.photos[prevIdx];
                      setLightboxPhoto({
                        url: prevP.url,
                        description: prevP.description,
                        obs: lightboxPhoto.obs,
                        photoIndex: prevIdx,
                        totalPhotos: lightboxPhoto.totalPhotos,
                      });
                    }}
                  >
                    <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                )}

                {/* Right Arrow */}
                {lightboxPhoto.totalPhotos > 1 && lightboxPhoto.photoIndex < lightboxPhoto.totalPhotos - 1 && (
                  <TouchableOpacity
                    style={[styles.lightboxNavArrow, { right: 12 }]}
                    onPress={() => {
                      const nextIdx = lightboxPhoto.photoIndex + 1;
                      const nextP = lightboxPhoto.obs.photos[nextIdx];
                      setLightboxPhoto({
                        url: nextP.url,
                        description: nextP.description,
                        obs: lightboxPhoto.obs,
                        photoIndex: nextIdx,
                        totalPhotos: lightboxPhoto.totalPhotos,
                      });
                    }}
                  >
                    <Ionicons name="chevron-forward" size={24} color="#FFFFFF" />
                  </TouchableOpacity>
                )}
              </View>

              {/* Bottom Information Card Overlay */}
              <View style={styles.lightboxInfoCard}>
                {/* Header: Tronçon badge, Date, Progress */}
                <View style={styles.lightboxInfoHeaderRow}>
                  <View style={styles.lightboxTronconPill}>
                    <Text style={styles.lightboxTronconPillText} weight="bold">
                      {lightboxPhoto.obs.troncon_code}
                    </Text>
                  </View>
                  <Text style={styles.lightboxInfoDateText} weight="semibold">
                    {formatObservationDateFrench(lightboxPhoto.obs.date_heure)}
                  </Text>
                  <View style={styles.lightboxProgressPill}>
                    <Text style={styles.lightboxProgressPillText} weight="bold">
                      {lightboxPhoto.obs.progress_percentage}%
                    </Text>
                  </View>
                </View>

                {/* Metadata: Agent, PK, Activity */}
                <View style={styles.lightboxMetaGrid}>
                  <View style={styles.lightboxMetaItem}>
                    <Ionicons name="person-outline" size={13} color="#CBD5E1" />
                    <Text style={styles.lightboxMetaItemText}>
                      {lightboxPhoto.obs.agent_nom || 'Agent Terrain'}
                    </Text>
                  </View>
                  {Boolean(lightboxPhoto.obs.chainage) && (
                    <View style={styles.lightboxMetaItem}>
                      <Ionicons name="pin-outline" size={13} color="#CBD5E1" />
                      <Text style={styles.lightboxMetaItemText}>PK {lightboxPhoto.obs.chainage}</Text>
                    </View>
                  )}
                  {Boolean(lightboxPhoto.obs.phase) && (
                    <View style={styles.lightboxMetaItem}>
                      <Ionicons name="construct-outline" size={13} color="#CBD5E1" />
                      <Text style={styles.lightboxMetaItemText}>
                        {lightboxPhoto.obs.phase}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Comment */}
                {Boolean(lightboxPhoto.obs.commentaire) && (
                  <View style={styles.lightboxCommentBox}>
                    <Text style={styles.lightboxCommentText} numberOfLines={2}>
                      « {lightboxPhoto.obs.commentaire} »
                    </Text>
                  </View>
                )}

                {/* Geolocation Row */}
                <View style={styles.lightboxGeoRow}>
                  <View style={styles.lightboxGeoLeft}>
                    <Ionicons name="location-outline" size={15} color="#86EFAC" />
                    <Text style={styles.lightboxGeoText} numberOfLines={1}>
                      Position géographique : {lightboxPhoto.obs.chainage ? `PK ${lightboxPhoto.obs.chainage}` : 'Chantier'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      const obs = lightboxPhoto.obs;
                      setLightboxPhoto(null);
                      handleOpenMap(obs.troncon_id, obs.id);
                    }}
                  >
                    <Text style={styles.lightboxGeoLink} weight="bold">
                      Voir sur la carte
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Bottom Action Buttons: [ Télécharger ] [ Voir le relevé ] */}
                <View style={styles.lightboxActionRow}>
                  <TouchableOpacity
                    style={styles.lightboxDownloadBtn}
                    activeOpacity={0.8}
                    onPress={() => handleDownloadPhoto(lightboxPhoto.url)}
                  >
                    <Ionicons name="download-outline" size={16} color={Palette.text} />
                    <Text style={styles.lightboxDownloadBtnText} weight="semibold">
                      Télécharger
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.lightboxViewReleveBtn}
                    activeOpacity={0.85}
                    onPress={() => {
                      const obs = lightboxPhoto.obs;
                      setLightboxPhoto(null);
                      setSelectedReleveObs(obs);
                    }}
                  >
                    <Ionicons name="document-text-outline" size={16} color="#FFFFFF" />
                    <Text style={styles.lightboxViewReleveBtnText} weight="bold">
                      Voir le relevé
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </SafeAreaView>
          )}
        </View>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════════
          5. MODAL DÉTAIL DU RELEVÉ (« Voir le relevé »)
      ══════════════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={Boolean(selectedReleveObs)}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setSelectedReleveObs(null)}
      >
        <View style={styles.bottomSheetOverlay}>
          <Pressable style={styles.bottomSheetDismissArea} onPress={() => setSelectedReleveObs(null)} />
          <View style={styles.bottomSheetContainer}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetHeaderTitle} weight="bold">
                Détail du relevé
              </Text>
              <TouchableOpacity onPress={() => setSelectedReleveObs(null)}>
                <Ionicons name="close" size={24} color={Palette.text} />
              </TouchableOpacity>
            </View>

            {selectedReleveObs && (
              <ScrollView showsVerticalScrollIndicator={false} style={styles.sheetBody}>
                {/* Tronçon & Statut */}
                <View style={styles.releveCardHeader}>
                  <View style={styles.tronconCodeBadge}>
                    <Text style={styles.tronconCodeBadgeText} weight="bold">
                      {selectedReleveObs.troncon_code}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.releveTronconTitle} weight="bold">
                      {selectedReleveObs.troncon_nom}
                    </Text>
                    <Text style={styles.releveDateText}>
                      {formatObservationDateFrench(selectedReleveObs.date_heure)}
                    </Text>
                  </View>
                  <View style={styles.progressPillBadge}>
                    <Text style={styles.progressPillText} weight="bold">
                      {selectedReleveObs.progress_percentage}%
                    </Text>
                  </View>
                </View>

                {/* Details Grid */}
                <View style={styles.releveMetaGrid}>
                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Agent de terrain</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {selectedReleveObs.agent_nom || 'Non affecté'}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Chaînage PK</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {selectedReleveObs.chainage ? `PK ${selectedReleveObs.chainage}` : '—'}
                    </Text>
                  </View>

                  <View style={styles.releveMetaRow}>
                    <Text style={styles.releveMetaLabel}>Phase de travaux</Text>
                    <Text style={styles.releveMetaValue} weight="semibold">
                      {selectedReleveObs.phase || '—'}{selectedReleveObs.phase_statut ? ` (${selectedReleveObs.phase_statut})` : ''}
                    </Text>
                  </View>
                </View>

                {/* Comment */}
                {Boolean(selectedReleveObs.commentaire) && (
                  <View style={styles.releveCommentSection}>
                    <Text style={styles.releveCommentLabel}>Commentaire</Text>
                    <View style={styles.commentQuoteBox}>
                      <Text style={styles.commentQuoteText}>
                        « {selectedReleveObs.commentaire} »
                      </Text>
                    </View>
                  </View>
                )}

                {/* Photos Grid */}
                {selectedReleveObs.photos && selectedReleveObs.photos.length > 0 && (
                  <View style={styles.relevePhotosSection}>
                    <Text style={styles.releveCommentLabel}>
                      Photographies ({selectedReleveObs.photos.length})
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.relevePhotosRow}>
                      {selectedReleveObs.photos.map((p, pIdx) => (
                        <TouchableOpacity
                          key={p.id || pIdx}
                          style={styles.relevePhotoThumb}
                          activeOpacity={0.88}
                          onPress={() => {
                            const obs = selectedReleveObs;
                            setSelectedReleveObs(null);
                            setLightboxPhoto({
                              url: p.url,
                              description: p.description,
                              obs,
                              photoIndex: pIdx,
                              totalPhotos: obs.photos.length,
                            });
                          }}
                        >
                          <Image
                            source={{ uri: getMediaUrl(p.url) }}
                            style={{ width: '100%', height: '100%', borderRadius: 8 }}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.sheetFooter}>
              <TouchableOpacity
                style={styles.sheetResetBtn}
                onPress={() => setSelectedReleveObs(null)}
              >
                <Text style={styles.sheetResetBtnText} weight="semibold">
                  Fermer
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sheetApplyBtn}
                onPress={() => {
                  const obs = selectedReleveObs;
                  setSelectedReleveObs(null);
                  if (obs) {
                    handleOpenMap(obs.troncon_id, obs.id);
                  }
                }}
              >
                <Ionicons name="map-outline" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                <Text style={styles.sheetApplyBtnText} weight="bold">
                  Voir sur la carte
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
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
  headerTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: '#E5EBE8',
    borderRadius: 10,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: Palette.primary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  tabSection: {
    gap: 12,
    marginTop: 4,
  },

  // ── Top Control Bar
  topControlRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dateSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dateSelectorBtnText: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
  },
  filterTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterTriggerBtnText: {
    fontSize: 13,
    color: Palette.text,
  },
  filterBadge: {
    backgroundColor: Palette.primary,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },

  // ── Active Chips Row
  activeChipsContainer: {
    marginTop: -4,
  },
  activeChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E6F4F1',
    borderWidth: 1,
    borderColor: '#B2DFDB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  activeChipText: {
    fontSize: 12,
    color: Palette.primary,
    fontWeight: '500',
  },
  clearAllLink: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  clearAllLinkText: {
    fontSize: 12,
    color: Palette.primary,
  },

  // ── Results Header & Sort
  resultsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  resultsMainTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  resultsSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  sortDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortDropdownBtnText: {
    fontSize: 12,
    color: Palette.text,
  },

  // ── Observation Cards
  observationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  obsCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  obsTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  tronconCodeBadge: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tronconCodeBadgeText: {
    fontSize: 12,
    color: '#16A34A',
  },
  obsDateTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  progressPillBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  progressPillText: {
    fontSize: 12,
    color: '#15803D',
  },
  heroPhotoWrapper: {
    width: '100%',
    height: 190,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  heroPhotoImage: {
    width: '100%',
    height: '100%',
  },
  photoCountBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  photoCountBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  noPhotoPlaceholder: {
    height: 100,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  noPhotoPlaceholderText: {
    fontSize: 12,
    color: Palette.textLight,
  },
  obsMetaSection: {
    gap: 4,
  },
  obsMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  obsMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  obsMetaItemText: {
    fontSize: 12,
    color: Palette.textLight,
  },
  commentQuoteBox: {
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: Palette.primary,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
  },
  commentQuoteText: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  obsCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 4,
  },
  viewReleveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  viewReleveBtnText: {
    fontSize: 13,
    color: Palette.primary,
  },
  viewMapBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Palette.primary,
    shadowColor: Palette.primary,
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  viewMapBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ── Floating Map Action Button
  floatingMapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#176B5B',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
    shadowColor: '#176B5B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  floatingMapBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
  },

  // ── Bottom Sheet (Filters)
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  bottomSheetDismissArea: {
    flex: 1,
  },
  bottomSheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: SCREEN_HEIGHT * 0.85,
    paddingBottom: 24,
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
  sheetHeaderTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  sheetBody: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  sheetSection: {
    marginBottom: 20,
  },
  sheetSectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  sheetSectionTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  periodSegmentedBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 3,
    marginBottom: 10,
  },
  periodSegmentBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 6,
  },
  periodSegmentBtnActive: {
    backgroundColor: '#176B5B',
  },
  periodSegmentBtnText: {
    fontSize: 13,
    color: Palette.textMuted,
    fontWeight: '500',
  },
  periodSegmentBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  sheetDateInputBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  sheetDateInputBtnText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: Palette.text,
  },
  sheetDateRangeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  sheetRangeInputBtn: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  rangeBtnActive: {
    borderColor: Palette.primary,
    backgroundColor: '#E6F4F1',
  },
  sheetRangeInputLabel: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 2,
  },
  sheetRangeInputInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetRangeInputText: {
    fontSize: 12,
    color: Palette.text,
    fontWeight: '500',
  },
  shortcutsLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  shortcutsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  shortcutChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  shortcutChipText: {
    fontSize: 12,
    color: Palette.text,
  },
  radioOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: '#176B5B',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#176B5B',
  },
  radioLabel: {
    fontSize: 14,
    color: Palette.text,
  },
  sortOptionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sortChip: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortChipActive: {
    backgroundColor: '#E6F4F1',
    borderColor: '#B2DFDB',
  },
  sortChipText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  sortChipTextActive: {
    color: Palette.primary,
    fontWeight: 'bold',
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  sheetResetBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sheetResetBtnText: {
    fontSize: 14,
    color: Palette.text,
  },
  sheetApplyBtn: {
    flex: 1.5,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#176B5B',
  },
  sheetApplyBtnText: {
    fontSize: 14,
    color: '#FFFFFF',
  },

  // ── Calendar Modal
  calendarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  calendarCardContainer: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
  },
  calendarModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  calendarModalTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  calendarSegmentedRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 3,
    marginBottom: 14,
  },
  calSegmentBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  calSegmentBtnActive: {
    backgroundColor: '#176B5B',
  },
  calSegmentBtnText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  calSegmentBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  calendarModeView: {
    gap: 10,
  },
  calMonthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  calMonthNavArrow: {
    padding: 6,
  },
  calMonthTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  calWeekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  calWeekdayText: {
    width: 38,
    textAlign: 'center',
    fontSize: 11,
    color: Palette.textMuted,
    fontWeight: '500',
  },
  calDaysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  calDayCell: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
    borderRadius: 19,
  },
  calDayCellSelected: {
    backgroundColor: '#176B5B',
  },
  calDayNumText: {
    fontSize: 13,
    color: Palette.text,
  },
  calDayNumTextSelected: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  calDayStatusDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 2,
  },
  dotGreen: {
    backgroundColor: '#16A34A',
  },
  dotRed: {
    backgroundColor: '#DC2626',
  },
  dotGrey: {
    backgroundColor: '#94A3B8',
  },
  dotClear: {
    backgroundColor: 'transparent',
  },
  calLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    paddingTop: 6,
  },
  calLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  calLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  calLegendLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  calTodayBtn: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    marginTop: 4,
  },
  calTodayBtnText: {
    fontSize: 12,
    color: Palette.primary,
  },
  calModalFooter: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  calCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  calCancelBtnText: {
    fontSize: 13,
    color: Palette.text,
  },
  calApplyBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#176B5B',
  },
  calApplyBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ── Lightbox Modal
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  lightboxSafeContainer: {
    flex: 1,
    justifyContent: 'space-between',
  },
  lightboxTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  lightboxCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxCounterText: {
    fontSize: 16,
    color: '#FFFFFF',
  },
  lightboxImageContainer: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.46,
  },
  lightboxNavArrow: {
    position: 'absolute',
    top: '45%',
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxInfoCard: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 8,
  },
  lightboxInfoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lightboxTronconPill: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lightboxTronconPillText: {
    color: '#86EFAC',
    fontSize: 12,
  },
  lightboxInfoDateText: {
    color: '#FFFFFF',
    fontSize: 13,
    flex: 1,
    marginLeft: 8,
  },
  lightboxProgressPill: {
    backgroundColor: 'rgba(22, 163, 74, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lightboxProgressPillText: {
    color: '#86EFAC',
    fontSize: 12,
  },
  lightboxMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  lightboxMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  lightboxMetaItemText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  lightboxCommentBox: {
    backgroundColor: '#0F172A',
    borderLeftWidth: 3,
    borderLeftColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  lightboxCommentText: {
    color: '#F1F5F9',
    fontSize: 12,
    fontStyle: 'italic',
  },
  lightboxGeoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  lightboxGeoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  lightboxGeoText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  lightboxGeoLink: {
    color: '#86EFAC',
    fontSize: 12,
  },
  lightboxActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  lightboxDownloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingVertical: 10,
    borderRadius: 8,
  },
  lightboxDownloadBtnText: {
    fontSize: 13,
    color: Palette.text,
  },
  lightboxViewReleveBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingVertical: 10,
    borderRadius: 8,
  },
  lightboxViewReleveBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ── Relevé Detail Modal
  releveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  releveTronconTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  releveDateText: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  releveMetaGrid: {
    paddingVertical: 10,
    gap: 8,
  },
  releveMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  releveMetaLabel: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  releveMetaValue: {
    fontSize: 13,
    color: Palette.text,
  },
  releveCommentSection: {
    paddingTop: 8,
    gap: 4,
  },
  releveCommentLabel: {
    fontSize: 13,
    color: Palette.textMuted,
    fontWeight: '600',
  },
  relevePhotosSection: {
    paddingTop: 12,
    gap: 6,
  },
  relevePhotosRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  relevePhotoThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },

  // ── Common States
  emptyCard: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  emptyTitle: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: Palette.textMuted,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorCard: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  errorText: {
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  retryBtn: {
    backgroundColor: Palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  // ── Satellite / Drone tab styles
  imageCard: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  imageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  satelliteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  satelliteBadgeText: {
    fontSize: 12,
    color: '#2563EB',
  },
  imageDateText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  satellitePreviewBanner: {
    height: 120,
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 12,
  },
  satellitePreviewLabel: {
    fontSize: 13,
    color: Palette.text,
    fontWeight: '600',
  },
  satelliteIndexBadge: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  metaCol: {
    flex: 1,
  },
  metaColLabel: {
    fontSize: 10,
    color: Palette.textLight,
    marginBottom: 2,
  },
  metaColValue: {
    fontSize: 12,
    color: Palette.text,
  },
});
