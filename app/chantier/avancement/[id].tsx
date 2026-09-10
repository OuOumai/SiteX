import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Path,
  Circle,
  Line,
  Text as SvgText,
  Defs,
  LinearGradient,
  Stop,
  Rect,
} from 'react-native-svg';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { api, ChantierDetails } from '@/services/api';

/** Helper to format ISO dates into friendly French representation */
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

// ─── TYPES & DATA STRUCTURES FOR HISTORICAL PROGRESS ──────────────────────────

/**
 * Historical Observation Point Structure.
 * Structured to map 1:1 with future API calculations from ObservationTerrain / Calendar.
 */
export interface HistoricalProgressPoint {
  id: number;
  date: string;
  dayOfMonth: string; // e.g. '01', '05', '08'
  monthLabel: string; // e.g. 'août'
  fullLabel: string;  // e.g. '08 août 2026'
  progress: number;   // Cumulative progress percentage (0 - 100)
  dailyGain: number;  // Daily increase in percentage points
  isWorkingDay: boolean;
  holidayName?: string;
  comment?: string;
  agentName?: string;
  chainage?: string;
}

/**
 * DEMO / MOCK DATA FOR UI DEVELOPMENT ONLY
 *
 * NOTE: These are UI-level demonstration records to showcase historical progress
 * curve, holidays/non-working day visualization, and statistics calculation.
 * NO fake records are inserted into PostgreSQL database.
 */
const DEMO_HISTORICAL_POINTS: HistoricalProgressPoint[] = [
  {
    id: 1,
    date: '2026-08-01',
    dayOfMonth: '01',
    monthLabel: 'août',
    fullLabel: '01 août 2026',
    progress: 0,
    dailyGain: 0,
    isWorkingDay: true,
    agentName: 'Agent Terrain #1',
    chainage: 'PK 0+000',
    comment: 'Installation de la base-vie et piquetage de l’axe de référence.',
  },
  {
    id: 2,
    date: '2026-08-05',
    dayOfMonth: '05',
    monthLabel: 'août',
    fullLabel: '05 août 2026',
    progress: 20,
    dailyGain: 20,
    isWorkingDay: true,
    agentName: 'Agent Terrain #1',
    chainage: 'PK 0+800',
    comment: 'Décapage de la terre végétale et terrassement initial.',
  },
  {
    id: 3,
    date: '2026-08-08',
    dayOfMonth: '08',
    monthLabel: 'août',
    fullLabel: '08 août 2026',
    progress: 20, // Progress remains steady at 20% (NOT 0%!)
    dailyGain: 0,
    isWorkingDay: false,
    holidayName: 'Repos hebdomadaire / Férié',
    comment: 'Arrêt planifié des travaux de terrassement (jour chômé).',
  },
  {
    id: 4,
    date: '2026-08-10',
    dayOfMonth: '10',
    monthLabel: 'août',
    fullLabel: '10 août 2026',
    progress: 35,
    dailyGain: 15,
    isWorkingDay: true,
    agentName: 'Agent Terrain #2',
    chainage: 'PK 1+500',
    comment: 'Remblais primaires et compactage de sous-couche.',
  },
  {
    id: 5,
    date: '2026-08-15',
    dayOfMonth: '15',
    monthLabel: 'août',
    fullLabel: '15 août 2026',
    progress: 55,
    dailyGain: 20,
    isWorkingDay: true,
    agentName: 'Agent Terrain #1',
    chainage: 'PK 2+400',
    comment: 'Pose géotextile et stabilisation de la plateforme.',
  },
  {
    id: 6,
    date: '2026-08-18',
    dayOfMonth: '18',
    monthLabel: 'août',
    fullLabel: '18 août 2026',
    progress: 80,
    dailyGain: 25,
    isWorkingDay: true,
    agentName: 'Agent Terrain #1',
    chainage: 'PK 3+200',
    comment: 'Terrassement achevé sur 80% du linéaire prévu.',
  },
];

type TabType = 'resume' | 'historique';

export default function ChantierAvancementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('resume');
  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async (isRefresh = false) => {
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
      const data = await api.getChantierDetails(token, id);
      setChantier(data.chantier);
    } catch (err: any) {
      console.error('[AvancementScreen] Error:', err.message);
      setError(err.message || "Impossible de charger les données d'avancement.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchDetails();
    }
  }, [fetchDetails, isAuthLoading]);

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
            Chargement de l'avancement...
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

  const avancementPct = chantier.avancement || 0;

  // Derive Statistics dynamically from the Historical dataset
  const points = DEMO_HISTORICAL_POINTS;
  const workingDaysCount = points.filter((p) => p.isWorkingDay).length;
  const nonWorkingDaysCount = points.filter((p) => !p.isWorkingDay).length;
  const latestProgress = points[points.length - 1]?.progress ?? avancementPct;
  const averageDailyGain =
    workingDaysCount > 1
      ? Math.round(latestProgress / (workingDaysCount - 1))
      : 0;

  // Chart coordinate calculation constants
  const svgWidth = 320;
  const svgHeight = 180;
  const paddingLeft = 38;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 32;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;

  const yLevels = [100, 80, 60, 40, 20, 0];

  // Map each data point to (x, y) coordinates
  const coords = points.map((p, index) => {
    const x = paddingLeft + (index / (points.length - 1)) * plotWidth;
    const y = paddingTop + (1 - p.progress / 100) * plotHeight;
    return { ...p, x, y };
  });

  // Construct SVG Path definition (Lineto series)
  const linePathD = coords.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
  }, '');

  // Area under curve path
  const areaPathD = `${linePathD} L ${coords[coords.length - 1].x},${paddingTop + plotHeight} L ${coords[0].x},${paddingTop + plotHeight} Z`;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── 1. Header ── */}
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
          Suivi de l'avancement
        </Text>
        <View style={{ width: 70 }} />
      </View>

      {/* ── 2. Tab Switcher (ONLY Résumé & Historique) ── */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'resume' && styles.tabButtonActive]}
          onPress={() => setActiveTab('resume')}
        >
          <Text
            style={[styles.tabText, activeTab === 'resume' && styles.tabTextActive]}
            weight={activeTab === 'resume' ? 'bold' : 'normal'}
          >
            Résumé
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'historique' && styles.tabButtonActive]}
          onPress={() => setActiveTab('historique')}
        >
          <Text
            style={[styles.tabText, activeTab === 'historique' && styles.tabTextActive]}
            weight={activeTab === 'historique' ? 'bold' : 'normal'}
          >
            Historique
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
        {/* ══════════════ TAB 1: RÉSUMÉ (REAL DATABASE DATA) ══════════════ */}
        {activeTab === 'resume' && (
          <View style={styles.tabSection}>
            <Card variant="elevated" style={styles.summaryCard}>
              <Text variant="subtitle" style={styles.summarySub}>
                {chantier.nom}
              </Text>
              <View style={styles.percentageRow}>
                <Text style={styles.bigPercentage} weight="bold">
                  {avancementPct}%
                </Text>
                <Text variant="muted" style={styles.percentageLabel}>
                  d'avancement physique consolidé
                </Text>
              </View>

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

              <View style={styles.summaryMetaGrid}>
                <View style={styles.metaBox}>
                  <Text style={styles.metaBoxLabel}>Dernière mise à jour</Text>
                  <Text style={styles.metaBoxValue} weight="semibold">
                    {formatFrenchDate(chantier.avancement_date || chantier.date_creation)}
                  </Text>
                </View>

                <View style={styles.metaBox}>
                  <Text style={styles.metaBoxLabel}>Statut actuel</Text>
                  <Text style={styles.metaBoxValue} weight="semibold">
                    {chantier.statut || 'En cours'}
                  </Text>
                </View>
              </View>

              {Boolean(chantier.avancement_commentaire) && (
                <View style={styles.latestCommentBox}>
                  <Text style={styles.latestCommentTitle} weight="semibold">
                    Dernier rapport de chantier :
                  </Text>
                  <Text style={styles.latestCommentBody}>
                    {chantier.avancement_commentaire}
                  </Text>
                </View>
              )}
            </Card>
          </View>
        )}

        {/* ══════════════ TAB 2: HISTORIQUE (CHART & DEMO DATA) ══════════════ */}
        {activeTab === 'historique' && (
          <View style={styles.tabSection}>
            {/* 1. Progress Curve Line Chart Card */}
            <Card variant="elevated" style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <View>
                  <Text variant="h3" style={styles.chartTitle}>
                    Historique des avancements
                  </Text>
                  <Text style={styles.chartSubtitle}>
                    Progression cumulée dans le temps
                  </Text>
                </View>
                <View style={styles.chartCurrentBadge}>
                  <Text style={styles.chartCurrentBadgeText} weight="bold">
                    {latestProgress}%
                  </Text>
                </View>
              </View>

              {/* Chart SVG */}
              <View style={styles.svgContainer}>
                <Svg width="100%" height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
                  <Defs>
                    <LinearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0%" stopColor="#176B5B" stopOpacity="0.25" />
                      <Stop offset="100%" stopColor="#176B5B" stopOpacity="0.0" />
                    </LinearGradient>
                  </Defs>

                  {/* Horizontal Gridlines & Y-Axis Percentage Labels */}
                  {yLevels.map((lvl) => {
                    const y = paddingTop + (1 - lvl / 100) * plotHeight;
                    return (
                      <React.Fragment key={`grid-${lvl}`}>
                        <Line
                          x1={paddingLeft}
                          y1={y}
                          x2={svgWidth - paddingRight}
                          y2={y}
                          stroke="#E5E7EB"
                          strokeWidth="1"
                          strokeDasharray={lvl === 0 ? undefined : '3,3'}
                        />
                        <SvgText
                          x={paddingLeft - 6}
                          y={y + 3.5}
                          fill="#9CA3AF"
                          fontSize="9"
                          textAnchor="end"
                          fontWeight="500"
                        >
                          {lvl}%
                        </SvgText>
                      </React.Fragment>
                    );
                  })}

                  {/* Non-working / Holiday Vertical Band */}
                  {coords
                    .filter((pt) => !pt.isWorkingDay)
                    .map((pt) => (
                      <React.Fragment key={`holiday-band-${pt.id}`}>
                        <Rect
                          x={pt.x - 12}
                          y={paddingTop}
                          width={24}
                          height={plotHeight}
                          fill="#FEF3C7"
                          opacity={0.6}
                          rx={4}
                        />
                        <Line
                          x1={pt.x}
                          y1={paddingTop}
                          x2={pt.x}
                          y2={paddingTop + plotHeight}
                          stroke="#F59E0B"
                          strokeWidth="1"
                          strokeDasharray="2,2"
                        />
                      </React.Fragment>
                    ))}

                  {/* Area fill */}
                  <Path d={areaPathD} fill="url(#chartAreaGrad)" />

                  {/* Connecting Line */}
                  <Path
                    d={linePathD}
                    fill="none"
                    stroke={Palette.primary}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Data Points */}
                  {coords.map((pt) => {
                    if (!pt.isWorkingDay) {
                      // Non-working / Holiday Marker
                      return (
                        <React.Fragment key={`dot-${pt.id}`}>
                          <Circle
                            cx={pt.x}
                            cy={pt.y}
                            r={6}
                            fill="#F59E0B"
                            stroke="#FFFFFF"
                            strokeWidth="2"
                          />
                          <Circle cx={pt.x} cy={pt.y} r={2} fill="#FFFFFF" />
                        </React.Fragment>
                      );
                    }

                    // Standard Working Day Marker
                    return (
                      <React.Fragment key={`dot-${pt.id}`}>
                        <Circle
                          cx={pt.x}
                          cy={pt.y}
                          r={5}
                          fill="#FFFFFF"
                          stroke={Palette.primary}
                          strokeWidth="2.5"
                        />
                        <Circle cx={pt.x} cy={pt.y} r={2} fill={Palette.primary} />
                      </React.Fragment>
                    );
                  })}

                  {/* X-Axis Date Labels */}
                  {coords.map((pt) => (
                    <SvgText
                      key={`label-${pt.id}`}
                      x={pt.x}
                      y={svgHeight - 12}
                      fill={pt.isWorkingDay ? Palette.text : '#D97706'}
                      fontSize="10"
                      textAnchor="middle"
                      fontWeight={pt.isWorkingDay ? '500' : '700'}
                    >
                      {pt.dayOfMonth}
                    </SvgText>
                  ))}

                  {/* Month axis sublabel */}
                  <SvgText
                    x={paddingLeft + plotWidth / 2}
                    y={svgHeight}
                    fill="#6B7280"
                    fontSize="9"
                    textAnchor="middle"
                  >
                    août 2026
                  </SvgText>
                </Svg>
              </View>

              {/* Chart Legend */}
              <View style={styles.chartLegendRow}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Palette.primary }]} />
                  <Text style={styles.legendText}>Jour travaillé</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                  <Text style={styles.legendText}>Jour non travaillé / Férié</Text>
                </View>
              </View>
            </Card>

            {/* 2. Historical Statistics Section (Derived dynamically from data) */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <View style={styles.statIconWrapper}>
                  <Ionicons name="construct-outline" size={16} color={Palette.primary} />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {workingDaysCount}
                </Text>
                <Text style={styles.statLabel}>Jours travaillés</Text>
              </View>

              <View style={styles.statBox}>
                <View style={[styles.statIconWrapper, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="calendar-outline" size={16} color="#D97706" />
                </View>
                <Text style={[styles.statValue, { color: '#D97706' }]} weight="bold">
                  {nonWorkingDaysCount}
                </Text>
                <Text style={styles.statLabel}>Jour non travaillé</Text>
              </View>

              <View style={styles.statBox}>
                <View style={[styles.statIconWrapper, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="trending-up-outline" size={16} color="#2563EB" />
                </View>
                <Text style={[styles.statValue, { color: '#2563EB' }]} weight="bold">
                  {latestProgress}%
                </Text>
                <Text style={styles.statLabel}>Progression actuelle</Text>
              </View>
            </View>

            {/* 3. Detailed Chronological Records */}
            <Text variant="h3" style={styles.historyListTitle}>
              Historique des relevés journaliers
            </Text>

            <View style={styles.historyCardsList}>
              {[...points].reverse().map((item) => (
                <Card
                  key={item.id}
                  variant="elevated"
                  style={[
                    styles.observationCard,
                    !item.isWorkingDay && styles.holidayObservationCard,
                  ]}
                >
                  <View style={styles.observationHeader}>
                    <View style={styles.observationDateBlock}>
                      <Ionicons
                        name={item.isWorkingDay ? 'calendar-outline' : 'pause-circle-outline'}
                        size={15}
                        color={item.isWorkingDay ? Palette.primary : '#D97706'}
                      />
                      <Text style={styles.observationDateText} weight="semibold">
                        {item.fullLabel}
                      </Text>
                    </View>

                    {item.isWorkingDay ? (
                      <View style={styles.observationProgressBadge}>
                        <Text style={styles.observationProgressText} weight="bold">
                          {item.progress}%
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.holidayBadge}>
                        <Text style={styles.holidayBadgeText} weight="bold">
                          Jour férié / Repos
                        </Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.observationComment}>
                    {item.comment}
                  </Text>

                  {item.isWorkingDay && item.chainage && (
                    <View style={styles.observationFooter}>
                      <Text style={styles.observationMetaText}>
                        Repère : {item.chainage}
                      </Text>
                      {item.agentName && (
                        <Text style={styles.observationMetaText}>
                          {item.agentName}
                        </Text>
                      )}
                    </View>
                  )}
                </Card>
              ))}
            </View>
          </View>
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
  headerTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
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
    fontSize: 13,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: Palette.primary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  tabSection: {
    gap: 14,
  },

  // ── Résumé Tab Styles
  summaryCard: {
    padding: 18,
  },
  summarySub: {
    fontSize: 14,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  percentageRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 12,
  },
  bigPercentage: {
    fontSize: 36,
    color: Palette.primary,
  },
  percentageLabel: {
    fontSize: 13,
  },
  progressBarBg: {
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  summaryMetaGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  metaBox: {
    flex: 1,
    backgroundColor: '#F7F9F8',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  metaBoxLabel: {
    fontSize: 11,
    color: Palette.textLight,
    marginBottom: 4,
  },
  metaBoxValue: {
    fontSize: 13,
    color: Palette.text,
  },
  latestCommentBox: {
    padding: 12,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Palette.primary,
  },
  latestCommentTitle: {
    fontSize: 12,
    color: Palette.primaryDark,
    marginBottom: 4,
  },
  latestCommentBody: {
    fontSize: 13,
    color: Palette.text,
    lineHeight: 18,
  },

  // ── Historique Tab & Chart Styles
  chartCard: {
    padding: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  chartSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  chartCurrentBadge: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chartCurrentBadgeText: {
    fontSize: 15,
    color: Palette.primary,
  },
  svgContainer: {
    alignItems: 'center',
    marginVertical: 4,
  },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Palette.textMuted,
  },

  // ── Statistics Grid
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  statBox: {
    flex: 1,
    backgroundColor: Palette.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  statIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 18,
    color: Palette.primary,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textAlign: 'center',
  },

  // ── Chronological Observations List
  historyListTitle: {
    fontSize: 15,
    color: Palette.text,
    marginTop: 4,
  },
  historyCardsList: {
    gap: 10,
  },
  observationCard: {
    padding: 14,
  },
  holidayObservationCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
    backgroundColor: '#FFFEF8',
  },
  observationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  observationDateBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  observationDateText: {
    fontSize: 13,
    color: Palette.text,
  },
  observationProgressBadge: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  observationProgressText: {
    fontSize: 12,
    color: Palette.primary,
  },
  holidayBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  holidayBadgeText: {
    fontSize: 11,
    color: '#B45309',
  },
  observationComment: {
    fontSize: 13,
    color: Palette.textMuted,
    lineHeight: 18,
  },
  observationFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  observationMetaText: {
    fontSize: 11,
    color: Palette.textLight,
  },

  // ── State Containers
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
});
