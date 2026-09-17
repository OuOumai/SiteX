import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
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
} from 'react-native-svg';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import {
  api,
  getMediaUrl,
  ChantierAvancementResponse,
  ChantierAvancementTroncon,
  ChantierDailyHistoryPoint,
  ChantierObservationHistoryItem,
} from '@/services/api';

/** Deterministic palette for N tronçons in the segmented diagram and breakdown */
const TRONCON_COLORS = [
  '#0D9488', // Teal
  '#2563EB', // Blue
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#6366F1', // Indigo
  '#D97706', // Orange
  '#4F46E5', // Violet
];

/** Convert polar coordinates to Cartesian */
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

/** Generate an SVG donut slice path between startAngle and endAngle */
function describeDonutArc(
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const delta = Math.min(Math.max(endAngle - startAngle, 0.01), 359.99);
  const actualEndAngle = startAngle + delta;

  const startOuter = polarToCartesian(x, y, outerRadius, actualEndAngle);
  const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, startAngle);
  const endInner = polarToCartesian(x, y, innerRadius, actualEndAngle);

  const arcSweep = delta <= 180 ? '0' : '1';

  return [
    'M', startOuter.x, startOuter.y,
    'A', outerRadius, outerRadius, 0, arcSweep, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', innerRadius, innerRadius, 0, arcSweep, 1, endInner.x, endInner.y,
    'Z',
  ].join(' ');
}

/** Status color helper */
function getStatusBadge(statut?: string) {
  switch (statut) {
    case 'TERMINE':
      return { label: 'Terminé', bg: '#DCFCE7', text: '#15803D' };
    case 'EN_COURS':
      return { label: 'En cours', bg: '#DBEAFE', text: '#1D4ED8' };
    case 'PROBLEME':
      return { label: 'Problème', bg: '#FEE2E2', text: '#B91C1C' };
    case 'NON_COMMENCE':
    default:
      return { label: 'Non commencé', bg: '#F1F5F9', text: '#64748B' };
  }
}

type TabType = 'resume' | 'historique';

export default function ChantierAvancementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('resume');
  const [data, setData] = useState<ChantierAvancementResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; description?: string | null } | null>(null);

  const fetchAvancement = useCallback(async (isRefresh = false) => {
    if (!token || !id) {
      if (!isAuthLoading) setIsLoading(false);
      return;
    }
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const res = await api.getChantierAvancement(token, id);
      setData(res);
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
      fetchAvancement();
    }
  }, [fetchAvancement, isAuthLoading]);

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
            Chargement de l'avancement consolidé...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
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
            <Ionicons name="alert-circle-outline" size={36} color={Palette.alert} />
            <Text variant="error" style={styles.errorText}>
              {error || 'Données introuvables.'}
            </Text>
            <TouchableOpacity onPress={() => fetchAvancement()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const { chantier, troncons, stats, historique } = data;
  const avancementPct = chantier.avancement ?? 0;
  const N = troncons.length;

  // Segmented diagram parameters
  const donutSize = 280;
  const cx = donutSize / 2;
  const cy = donutSize / 2;
  const outerR = 100;
  const innerR = 66;
  const sectorAngle = N > 0 ? 360 / N : 360;
  const sectorGap = N > 1 ? Math.min(3, sectorAngle * 0.1) : 0;

  // S-Curve chart parameters (Historique)
  const timeline = historique.timeline || [];
  const svgChartWidth = 320;
  const svgChartHeight = 180;
  const paddingLeft = 38;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 32;
  const plotWidth = svgChartWidth - paddingLeft - paddingRight;
  const plotHeight = svgChartHeight - paddingTop - paddingBottom;
  const yLevels = [100, 80, 60, 40, 20, 0];

  const chartCoords = timeline.map((p, index) => {
    const x =
      timeline.length === 1
        ? paddingLeft + plotWidth / 2
        : paddingLeft + (index / (timeline.length - 1)) * plotWidth;
    const y = paddingTop + (1 - Math.min(100, Math.max(0, p.avancement)) / 100) * plotHeight;
    return { ...p, x, y };
  });

  const linePathD =
    chartCoords.length > 0
      ? chartCoords.reduce((acc, pt, idx) => {
          return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
        }, '')
      : '';

  const areaPathD =
    chartCoords.length > 0
      ? `${linePathD} L ${chartCoords[chartCoords.length - 1].x},${paddingTop + plotHeight} L ${chartCoords[0].x},${paddingTop + plotHeight} Z`
      : '';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── 1. Header Navigation ── */}
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

      {/* ── 2. Tab Switcher (Résumé & Historique) ── */}
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
            onRefresh={() => fetchAvancement(true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ══════════════ TAB 1: RÉSUMÉ ══════════════ */}
        {activeTab === 'resume' && (
          <View style={styles.tabSection}>
            {/* 1. Header Card: Chantier Title, Status & Consolidated Avancement */}
            <Card variant="elevated" style={styles.summaryCard}>
              <View style={styles.summaryTitleRow}>
                <Text variant="subtitle" style={styles.summarySub} numberOfLines={1}>
                  {chantier.nom}
                </Text>
                <View style={styles.statutPill}>
                  <Text style={styles.statutPillText} weight="semibold">
                    {chantier.statut || 'En cours'}
                  </Text>
                </View>
              </View>

              <View style={styles.percentageRow}>
                <Text style={styles.bigPercentage} weight="bold">
                  {avancementPct}%
                </Text>
                <View style={styles.percentageLabelCol}>
                  <Text style={styles.percentageLabelMain} weight="semibold">
                    avancement consolidé
                  </Text>
                  <Text variant="muted" style={styles.percentageLabelSub}>
                    Moyenne arithmétique des {N} tronçon{N > 1 ? 's' : ''}
                  </Text>
                </View>
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
                          : avancementPct >= 40
                          ? '#2563EB'
                          : '#F59E0B',
                    },
                  ]}
                />
              </View>

              <View style={styles.totalMetrageRow}>
                <Text style={styles.totalMetrageLabel}>Linéaire global réalisé :</Text>
                <Text style={styles.totalMetrageValue} weight="bold">
                  {stats.total_completed_meters.toLocaleString('fr-FR')} m / {stats.total_planned_meters.toLocaleString('fr-FR')} m
                </Text>
              </View>
            </Card>

            {/* 2. Equal-Angle Segmented Circular Diagram Card */}
            <Card variant="elevated" style={styles.diagramCard}>
              <View style={styles.diagramHeader}>
                <Text variant="h3" style={styles.diagramTitle}>
                  Avancement par secteur ({N} tronçon{N > 1 ? 's' : ''})
                </Text>
                <Text style={styles.diagramSubtitle}>
                  Chaque secteur représente 1 tronçon (poids égal {N > 0 ? Math.round(100 / N) : 0}%)
                </Text>
              </View>

              <View style={styles.donutContainer}>
                <Svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`}>
                  {troncons.map((t, idx) => {
                    const startAngle = idx * sectorAngle + sectorGap / 2;
                    const spanAngle = sectorAngle - sectorGap;
                    const endAngle = startAngle + spanAngle;
                    const progressSpan = spanAngle * (Math.min(100, Math.max(0, t.avancement)) / 100);
                    const fillEndAngle = startAngle + progressSpan;
                    const color = TRONCON_COLORS[idx % TRONCON_COLORS.length];

                    return (
                      <React.Fragment key={`sector-${t.id}`}>
                        {/* Sector Background Track */}
                        <Path
                          d={describeDonutArc(cx, cy, innerR, outerR, startAngle, endAngle)}
                          fill="#F1F5F9"
                          stroke="#E2E8F0"
                          strokeWidth={0.5}
                        />

                        {/* Sector Progress Fill */}
                        {t.avancement > 0 && (
                          <Path
                            d={describeDonutArc(cx, cy, innerR, outerR, startAngle, fillEndAngle)}
                            fill={color}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Center of Donut: Consolidated Headline & Physical Summary */}
                  <SvgText
                    x={cx}
                    y={cy - 12}
                    textAnchor="middle"
                    fontSize="32"
                    fontWeight="bold"
                    fill={Palette.text}
                  >
                    {avancementPct}%
                  </SvgText>
                  <SvgText
                    x={cx}
                    y={cy + 10}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill={Palette.textMuted}
                  >
                    avancement consolidé
                  </SvgText>
                  <SvgText
                    x={cx}
                    y={cy + 28}
                    textAnchor="middle"
                    fontSize="10"
                    fill={Palette.primary}
                    fontWeight="500"
                  >
                    {stats.total_completed_meters.toLocaleString('fr-FR')} m / {stats.total_planned_meters.toLocaleString('fr-FR')} m
                  </SvgText>
                </Svg>
              </View>
            </Card>

            {/* 3. Tronçon Breakdown Rows (Legend, Progress Bar, Bounded Métrage) */}
            <View style={styles.tronconsSection}>
              <Text variant="h3" style={styles.sectionTitle}>
                Détail des tronçons
              </Text>

              <View style={styles.tronconsList}>
                {troncons.map((t, idx) => {
                  const color = TRONCON_COLORS[idx % TRONCON_COLORS.length];
                  const stBadge = getStatusBadge(t.statut);

                  return (
                    <Card key={t.id} variant="elevated" style={styles.tronconRowCard}>
                      <View style={styles.tronconRowHeader}>
                        <View style={styles.tronconBadgeGroup}>
                          <View style={[styles.tronconColorBadge, { backgroundColor: color }]}>
                            <Text style={styles.tronconBadgeCode} weight="bold">
                              {t.code}
                            </Text>
                          </View>
                          <Text style={styles.tronconName} weight="semibold" numberOfLines={1}>
                            {t.nom}
                          </Text>
                        </View>

                        <View style={styles.tronconHeaderRight}>
                          <View style={[styles.statusPill, { backgroundColor: stBadge.bg }]}>
                            <Text style={[styles.statusPillText, { color: stBadge.text }]} weight="semibold">
                              {stBadge.label}
                            </Text>
                          </View>
                          <View style={[styles.pctBadge, { backgroundColor: `${color}1A` }]}>
                            <Text style={[styles.pctBadgeText, { color }]} weight="bold">
                              {t.avancement}%
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Individual Progress Bar */}
                      <View style={styles.tronconProgressTrack}>
                        <View
                          style={[
                            styles.tronconProgressFill,
                            {
                              width: `${Math.min(100, Math.max(0, t.avancement))}%`,
                              backgroundColor: color,
                            },
                          ]}
                        />
                      </View>

                      {/* Explicit Physical Métrage Provided by Backend */}
                      <View style={styles.tronconMetrageRow}>
                        <View style={styles.metrageMain}>
                          <Ionicons name="speedometer-outline" size={14} color={Palette.textMuted} />
                          <Text style={styles.metrageText}>
                            <Text weight="bold" style={{ color: Palette.text }}>
                              {t.completed_meters.toLocaleString('fr-FR')} m
                            </Text>
                            {' '}/ {t.planned_meters.toLocaleString('fr-FR')} m
                          </Text>
                        </View>
                        <Text style={styles.metrageRemaining}>
                          ({t.remaining_meters.toLocaleString('fr-FR')} m restants)
                        </Text>
                      </View>

                      {/* Agent de Terrain & Observations Count */}
                      <View style={styles.tronconFooterRow}>
                        <View style={styles.agentMeta}>
                          <Ionicons name="person-outline" size={13} color={Palette.textLight} />
                          <Text style={styles.agentMetaText}>
                            {t.agent_nom_complet || 'Non affecté'}
                          </Text>
                        </View>
                        <Text style={styles.obsCountText}>
                          {t.observations_count} relevé{t.observations_count > 1 ? 's' : ''}
                        </Text>
                      </View>
                    </Card>
                  );
                })}
              </View>
            </View>

            {/* 4. Operational Statistics Grid */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <View style={styles.statIconWrapper}>
                  <Ionicons name="calendar-outline" size={16} color={Palette.primary} />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.jours_avec_releves}
                </Text>
                <Text style={styles.statLabel}>Jours avec relevés</Text>
              </View>

              <View style={styles.statBox}>
                <View style={[styles.statIconWrapper, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="time-outline" size={16} color="#D97706" />
                </View>
                <Text style={[styles.statValue, { color: '#D97706', fontSize: 13 }]} weight="bold" numberOfLines={1}>
                  {stats.dernier_releve_label || 'Aucun'}
                </Text>
                <Text style={styles.statLabel}>Dernier relevé</Text>
              </View>

              <View style={styles.statBox}>
                <View style={[styles.statIconWrapper, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="trending-up-outline" size={16} color="#2563EB" />
                </View>
                <Text style={[styles.statValue, { color: '#2563EB' }]} weight="bold">
                  {avancementPct}%
                </Text>
                <Text style={styles.statLabel}>Progression actuelle</Text>
              </View>
            </View>

            {/* 5. Quick Navigation: Superviser les tronçons */}
            <TouchableOpacity
              style={styles.actionNavigationBtn}
              activeOpacity={0.8}
              onPress={() => router.push(`/responsable/chantier/${id}`)}
            >
              <View style={styles.actionNavContent}>
                <Ionicons name="git-network-outline" size={18} color="#FFFFFF" />
                <Text style={styles.actionNavText} weight="semibold">
                  Superviser les tronçons
                </Text>
              </View>
              <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* ══════════════ TAB 2: HISTORIQUE ══════════════ */}
        {activeTab === 'historique' && (
          <View style={styles.tabSection}>
            {/* 1. Daily Consolidated S-Curve Card */}
            <Card variant="elevated" style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <View>
                  <Text variant="h3" style={styles.chartTitle}>
                    Courbe d'avancement consolidé
                  </Text>
                  <Text style={styles.chartSubtitle}>
                    Instantanés journaliers officiels
                  </Text>
                </View>
                <View style={styles.chartCurrentBadge}>
                  <Text style={styles.chartCurrentBadgeText} weight="bold">
                    {avancementPct}%
                  </Text>
                </View>
              </View>

              {timeline.length === 0 ? (
                <View style={styles.emptyChartBox}>
                  <Ionicons name="calendar-outline" size={36} color={Palette.textLight} />
                  <Text style={styles.emptyChartTitle} weight="semibold">
                    Aucun historique d'avancement
                  </Text>
                  <Text style={styles.emptyChartSubtitle}>
                    Les relevés de terrain enregistrés par les agents permettront de tracer la courbe d'avancement quotidien.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.svgContainer}>
                    <Svg width="100%" height={svgChartHeight} viewBox={`0 0 ${svgChartWidth} ${svgChartHeight}`}>
                      <Defs>
                        <LinearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor="#176B5B" stopOpacity="0.25" />
                          <Stop offset="100%" stopColor="#176B5B" stopOpacity="0.0" />
                        </LinearGradient>
                      </Defs>

                      {/* Gridlines & Y-Axis Percentage Labels */}
                      {yLevels.map((lvl) => {
                        const y = paddingTop + (1 - lvl / 100) * plotHeight;
                        return (
                          <React.Fragment key={`grid-${lvl}`}>
                            <Line
                              x1={paddingLeft}
                              y1={y}
                              x2={svgChartWidth - paddingRight}
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

                      {/* Area Fill */}
                      {chartCoords.length > 1 && (
                        <Path d={areaPathD} fill="url(#chartAreaGrad)" />
                      )}

                      {/* Connecting Line */}
                      {chartCoords.length > 1 && (
                        <Path
                          d={linePathD}
                          fill="none"
                          stroke={Palette.primary}
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* Data Points */}
                      {chartCoords.map((pt, idx) => {
                        if (pt.is_synthetic_baseline) {
                          // Synthetic 0% baseline point (hollow ring)
                          return (
                            <React.Fragment key={`pt-${idx}`}>
                              <Circle
                                cx={pt.x}
                                cy={pt.y}
                                r={6}
                                fill="#FFFFFF"
                                stroke="#64748B"
                                strokeWidth="2"
                                strokeDasharray="3,2"
                              />
                              <Circle cx={pt.x} cy={pt.y} r={2} fill="#64748B" />
                            </React.Fragment>
                          );
                        }

                        // Real field observation consolidated snapshot point
                        return (
                          <React.Fragment key={`pt-${idx}`}>
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
                      {chartCoords.map((pt, idx) => (
                        <SvgText
                          key={`label-${idx}`}
                          x={pt.x}
                          y={svgChartHeight - 12}
                          fill={pt.is_synthetic_baseline ? '#64748B' : Palette.text}
                          fontSize="9"
                          textAnchor="middle"
                          fontWeight={pt.is_synthetic_baseline ? '400' : '600'}
                        >
                          {pt.dayOfMonth} {pt.monthLabel}
                        </SvgText>
                      ))}
                    </Svg>
                  </View>

                  {/* Chart Legend */}
                  <View style={styles.chartLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: Palette.primary }]} />
                      <Text style={styles.legendText}>Relevé consolidé</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#64748B', borderWidth: 1, borderColor: '#94A3B8' }]} />
                      <Text style={styles.legendText}>Démarrage (0% synthétique)</Text>
                    </View>
                  </View>
                </>
              )}
            </Card>

            {/* 2. Chronological Field Observations Feed */}
            <View style={styles.observationsFeedSection}>
              <Text variant="h3" style={styles.sectionTitle}>
                Observations et relevés de terrain
              </Text>

              {historique.observations.length === 0 ? (
                <Card variant="elevated" style={styles.emptyObservationsCard}>
                  <Ionicons name="document-text-outline" size={32} color={Palette.textLight} />
                  <Text style={styles.emptyObservationsTitle} weight="semibold">
                    Aucune observation enregistrée
                  </Text>
                  <Text style={styles.emptyObservationsSubtitle}>
                    Les relevés géolocalisés et photos soumis par les agents de terrain apparaîtront ici.
                  </Text>
                </Card>
              ) : (
                <View style={styles.observationsList}>
                  {historique.observations.map((obs) => (
                    <Card key={obs.id} variant="elevated" style={styles.obsCard}>
                      <View style={styles.obsHeader}>
                        <View style={styles.obsDateBadge}>
                          <Ionicons name="calendar-outline" size={14} color={Palette.primary} />
                          <Text style={styles.obsDateText} weight="semibold">
                            {obs.date_heure}
                          </Text>
                        </View>

                        <View style={styles.obsHeaderRight}>
                          <View style={styles.obsTronconBadge}>
                            <Text style={styles.obsTronconText} weight="bold">
                              {obs.troncon_code}
                            </Text>
                          </View>
                          <View style={styles.obsProgressBadge}>
                            <Text style={styles.obsProgressText} weight="bold">
                              {obs.progress_percentage}%
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Tronçon name and metadata */}
                      <Text style={styles.obsTronconTitle} weight="semibold">
                        {obs.troncon_nom}
                      </Text>

                      <View style={styles.obsMetaRow}>
                        {obs.agent_nom && (
                          <View style={styles.obsMetaItem}>
                            <Ionicons name="person-outline" size={13} color={Palette.textLight} />
                            <Text style={styles.obsMetaItemText}>{obs.agent_nom}</Text>
                          </View>
                        )}
                        {obs.chainage && (
                          <View style={styles.obsMetaItem}>
                            <Ionicons name="pin-outline" size={13} color={Palette.textLight} />
                            <Text style={styles.obsMetaItemText}>PK {obs.chainage}</Text>
                          </View>
                        )}
                        {obs.phase && (
                          <View style={styles.obsMetaItem}>
                            <Ionicons name="construct-outline" size={13} color={Palette.textLight} />
                            <Text style={styles.obsMetaItemText}>
                              {obs.phase}{obs.phase_statut ? ` (${obs.phase_statut})` : ''}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Comment */}
                      {Boolean(obs.commentaire) && (
                        <View style={styles.obsCommentBox}>
                          <Text style={styles.obsCommentText}>
                            « {obs.commentaire} »
                          </Text>
                        </View>
                      )}

                      {/* Attached Photos */}
                      {obs.photos && obs.photos.length > 0 && (
                        <View style={styles.photosRow}>
                          {obs.photos.map((photo) => (
                            <TouchableOpacity
                              key={photo.id}
                              style={styles.photoThumbContainer}
                              activeOpacity={0.8}
                              onPress={() => setSelectedPhoto(photo)}
                            >
                              <Image
                                source={{ uri: getMediaUrl(photo.url) }}
                                style={styles.photoThumb}
                                resizeMode="cover"
                              />
                              <View style={styles.photoZoomOverlay}>
                                <Ionicons name="search" size={12} color="#FFFFFF" />
                              </View>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}
                    </Card>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* ── Photo Preview Modal ── */}
      <Modal
        visible={Boolean(selectedPhoto)}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={styles.modalCloseBtn}
            onPress={() => setSelectedPhoto(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={32} color="#FFFFFF" />
          </TouchableOpacity>

          {selectedPhoto && (
            <View style={styles.modalContent}>
              <Image
                source={{ uri: getMediaUrl(selectedPhoto.url) }}
                style={styles.modalImage}
                resizeMode="contain"
              />
              {Boolean(selectedPhoto.description) && (
                <Text style={styles.modalCaption}>
                  {selectedPhoto.description}
                </Text>
              )}
            </View>
          )}
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

  // ── Tab 1: Résumé Styles
  summaryCard: {
    padding: 16,
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summarySub: {
    fontSize: 15,
    color: Palette.text,
    flex: 1,
  },
  statutPill: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statutPillText: {
    fontSize: 11,
    color: '#15803D',
  },
  percentageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  bigPercentage: {
    fontSize: 38,
    color: Palette.primary,
  },
  percentageLabelCol: {
    flex: 1,
  },
  percentageLabelMain: {
    fontSize: 14,
    color: Palette.text,
  },
  percentageLabelSub: {
    fontSize: 11,
    marginTop: 2,
  },
  progressBarBg: {
    height: 10,
    backgroundColor: '#E5E7EB',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  totalMetrageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  totalMetrageLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  totalMetrageValue: {
    fontSize: 13,
    color: Palette.primary,
  },

  // ── Donut Diagram Card
  diagramCard: {
    padding: 16,
    alignItems: 'center',
  },
  diagramHeader: {
    alignItems: 'center',
    marginBottom: 8,
  },
  diagramTitle: {
    fontSize: 15,
    color: Palette.text,
    textAlign: 'center',
  },
  diagramSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  donutContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },

  // ── Tronçons Section & Breakdown Cards
  tronconsSection: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  tronconsList: {
    gap: 10,
  },
  tronconRowCard: {
    padding: 14,
    gap: 8,
  },
  tronconRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tronconBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  tronconColorBadge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tronconBadgeCode: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  tronconName: {
    fontSize: 14,
    color: Palette.text,
    flex: 1,
  },
  tronconHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  statusPillText: {
    fontSize: 10,
  },
  pctBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pctBadgeText: {
    fontSize: 13,
  },
  tronconProgressTrack: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  tronconProgressFill: {
    height: '100%',
    borderRadius: 3,
  },
  tronconMetrageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  metrageMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metrageText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  metrageRemaining: {
    fontSize: 11,
    color: Palette.textLight,
  },
  tronconFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  agentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  agentMetaText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  obsCountText: {
    fontSize: 11,
    color: Palette.textLight,
  },

  // ── Operational Statistics Grid
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
    fontSize: 16,
    color: Palette.primary,
    marginBottom: 2,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textAlign: 'center',
  },

  // ── Action Navigation Button
  actionNavigationBtn: {
    backgroundColor: Palette.primary,
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  actionNavContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionNavText: {
    fontSize: 14,
    color: '#FFFFFF',
  },

  // ── Tab 2: Historique & S-Curve Styles
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
  emptyChartBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyChartTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 6,
  },
  emptyChartSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
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

  // ── Observations Feed Section
  observationsFeedSection: {
    gap: 10,
  },
  emptyObservationsCard: {
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyObservationsTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 4,
  },
  emptyObservationsSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  observationsList: {
    gap: 10,
  },
  obsCard: {
    padding: 14,
    gap: 8,
  },
  obsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  obsDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  obsDateText: {
    fontSize: 12,
    color: Palette.text,
  },
  obsHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  obsTronconBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  obsTronconText: {
    fontSize: 11,
    color: Palette.text,
  },
  obsProgressBadge: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  obsProgressText: {
    fontSize: 11,
    color: Palette.primary,
  },
  obsTronconTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  obsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  obsMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  obsMetaItemText: {
    fontSize: 11,
    color: Palette.textLight,
  },
  obsCommentBox: {
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: Palette.primary,
    padding: 10,
    borderRadius: 6,
  },
  obsCommentText: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  photoThumbContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoZoomOverlay: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    padding: 2,
  },

  // ── Photo Modal Preview
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  modalContent: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height * 0.7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '85%',
  },
  modalCaption: {
    color: '#FFFFFF',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },

  // ── States & Common
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
