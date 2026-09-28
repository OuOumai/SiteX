import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { GlobalAppDrawer } from '@/components/navigation/GlobalAppDrawer';
import { SiteXHeader } from '@/components/navigation/SiteXHeader';
import {
  ResponsableDashboardData,
  ResponsableProjectItem,
  ResponsableDashboardAlert,
  getMediaUrl,
} from '@/services/api';
import { ReportGenerationModal } from './ReportGenerationModal';
import { ProjectCoverModal } from './ProjectCoverModal';
import { getProjectCover, PROJECT_CATEGORY_IMAGES } from '@/constants/projectCover';

interface ResponsableAnalyticalDashboardProps {
  data: ResponsableDashboardData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  user: any;
  showAdvancedTools?: boolean;
  error?: string | null;
}

/** Formats date into friendly badge format e.g. "Septembre 2026" */
function formatProjectDateBadge(dateStr?: string | null): string {
  if (dateStr) {
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const month = d.toLocaleDateString('fr-FR', { month: 'long' });
        const year = d.getFullYear();
        return `${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
      }
    } catch {
      // ignore
    }
  }
  const now = new Date();
  const month = now.toLocaleDateString('fr-FR', { month: 'long' });
  const year = now.getFullYear();
  return `${month.charAt(0).toUpperCase() + month.slice(1)} ${year}`;
}

/** Format linear km safely */
function formatKm(km?: string | number | null): string {
  if (km === undefined || km === null) return '0 km';
  const num = Number(km);
  if (isNaN(num)) return '0 km';
  return `${num % 1 === 0 ? num.toString() : num.toFixed(1)} km`;
}

interface CircularProgressProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
}

/** SVG circular progress ring matching the primary visual reference */
function CircularProgressRing({
  percentage,
  size = 62,
  strokeWidth = 5.5,
  color = '#10B981',
  trackColor = 'rgba(255, 255, 255, 0.22)',
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const validPercent = Math.min(Math.max(Math.round(percentage), 0), 100);
  const strokeDashoffset = circumference - (circumference * validPercent) / 100;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.ringCenterTextWrapper} pointerEvents="none">
        <Text style={styles.ringPercentageText} weight="bold">
          {validPercent}%
        </Text>
      </View>
    </View>
  );
}

export function ResponsableAnalyticalDashboard({
  data,
  isLoading,
  isRefreshing,
  onRefresh,
  user,
  showAdvancedTools = false,
  error = null,
}: ResponsableAnalyticalDashboardProps) {
  const router = useRouter();
  const { width } = useWindowDimensions();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [coverModalVisible, setCoverModalVisible] = useState(false);
  const [selectedProjectForCover, setSelectedProjectForCover] = useState<ResponsableProjectItem | null>(null);
  const [localCoverOverrides, setLocalCoverOverrides] = useState<Record<number, string | null>>({});
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [selectedAlertCategory, setSelectedAlertCategory] = useState<string>('TOUS');
  const [selectedProjectIdForActions, setSelectedProjectIdForActions] = useState<number | null>(null);

  const carouselScrollRef = useRef<ScrollView>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  const handleCoverUpdated = (projectId: number, newCoverUrl: string | null) => {
    setLocalCoverOverrides((prev) => ({ ...prev, [projectId]: newCoverUrl }));
    onRefresh();
  };

  // Responsive carousel slide width: takes screen width minus margins, capped for tablet/web
  const carouselWidth = Math.min(width - 32, 600);
  // Compact hero height matching mockup (approx 220-245dp)
  const heroHeight = Math.min(Math.max(Math.round(width * 0.58), 220), 245);
  // Vertically centered navigation arrows (38dp target)
  const arrowTop = Math.round((heroHeight - 38) / 2);

  const stats = data?.stats || {
    totalProjects: 0,
    projectsEnCours: 0,
    projectsTermines: 0,
    totalChantiers: 0,
    chantiersEnCours: 0,
    chantiersEnAttente: 0,
    chantiersTermines: 0,
    chantiersPrets: 0,
    avancementMoyen: 0,
    totalObservations: 0,
    totalReclamations: 0,
    totalAlerts: 0,
    chantiersDistribution: [],
    equipeTerrain: {
      totalAvailable: 0,
      totalAssigned: 0,
      totalAssignments: 0,
      totalUnassigned: 0,
    },
  };

  const projects = data?.projects || [];
  const chantiers = data?.chantiers || [];
  const alerts = data?.alerts || [];
  const observations = data?.observations || [];
  const reclamations = data?.reclamations || [];
  const explications = data?.explications || [];
  const clients = data?.clients || [];

  // Total linear KM of the entire portfolio
  const totalPortfolioKm = useMemo(() => {
    return projects.reduce((sum, p) => sum + (Number(p.total_km) || 0), 0).toFixed(1);
  }, [projects]);

  const scrollToSlide = (index: number) => {
    const total = Math.max(1, projects.length);
    const validIndex = Math.max(0, Math.min(index, total - 1));
    setActiveSlideIndex(validIndex);
    carouselScrollRef.current?.scrollTo({
      x: validIndex * (carouselWidth + 12),
      animated: true,
    });
  };

  // In-hero pagination dots (max 5 dots representing carousel state)
  const heroDots = useMemo(() => {
    const count = projects.length;
    if (count <= 1) return [];
    if (count <= 5) {
      return Array.from({ length: count }, (_, i) => ({
        index: i,
        active: i === activeSlideIndex,
      }));
    }
    // Sliding window of 5 dots
    const start = Math.max(0, Math.min(activeSlideIndex - 2, count - 5));
    return Array.from({ length: 5 }, (_, i) => {
      const idx = start + i;
      return {
        index: idx,
        active: idx === activeSlideIndex,
      };
    });
  }, [projects.length, activeSlideIndex]);

  // Filtered alerts by category
  const alertCategories = useMemo(() => {
    const counts: Record<string, number> = {
      TOUS: alerts.length,
      GIS: 0,
      TRONCON: 0,
      AT: 0,
      RECLAMATION: 0,
    };
    alerts.forEach((a) => {
      const cat = (a.category || 'AUTRE').toUpperCase();
      if (counts[cat] !== undefined) {
        counts[cat]++;
      }
    });
    return counts;
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    if (selectedAlertCategory === 'TOUS') return alerts;
    return alerts.filter(
      (a) => (a.category || 'AUTRE').toUpperCase() === selectedAlertCategory
    );
  }, [alerts, selectedAlertCategory]);

  // Combined compact recent activity (max 5 items)
  const combinedRecentActivity = useMemo(() => {
    const list: Array<{
      id: string;
      type: 'OBSERVATION' | 'RECLAMATION' | 'EXPLICATION';
      title: string;
      subtitle: string;
      date: string;
      route?: string;
    }> = [];

    observations.slice(0, 3).forEach((obs) => {
      list.push({
        id: `obs_${obs.id}`,
        type: 'OBSERVATION',
        title: `Relevé terrain • ${obs.troncon_nom || obs.chantier_nom}`,
        subtitle: `Par ${obs.agent_nom || 'Agent'} ${obs.chainage ? `• PK ${obs.chainage}` : ''} ${obs.commentaire ? `("${obs.commentaire}")` : ''}`,
        date: obs.date_heure || 'Récemment',
        route: `/chantier/${obs.chantier_id}`,
      });
    });

    reclamations.slice(0, 2).forEach((rec) => {
      list.push({
        id: `rec_${rec.id}`,
        type: 'RECLAMATION',
        title: `Réclamation • ${rec.titre}`,
        subtitle: `Chantier : ${rec.chantier_nom} • Client : ${rec.client_nom || 'Client'}`,
        date: rec.date_creation || 'Récemment',
        route: `/chantier/${rec.chantier_id}`,
      });
    });

    explications.slice(0, 2).forEach((exp) => {
      list.push({
        id: `exp_${exp.id}`,
        type: 'EXPLICATION',
        title: `Explication A.T. • ${exp.statut === 'EN_ATTENTE' ? 'En attente' : 'Répondue'}`,
        subtitle: `${exp.agent_nom} (${exp.troncon_nom || exp.chantier_nom})`,
        date: exp.date_demande || 'Récemment',
        route: '/responsable/equipe-terrain',
      });
    });

    return list.slice(0, 5);
  }, [observations, reclamations, explications]);

  const displayName = user?.prenom?.trim() || user?.nom?.trim() || 'Responsable';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── 1. Global SiteX Header with Brand & Notification (Dashboard Only) ── */}
      <SiteXHeader onBrandPress={() => setDrawerOpen(true)} showNotification={true} />

      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 2. User Identity & Standalone Direct Actions (Side-by-side matching mockup) ── */}
        <View style={styles.headerIdentityActionsRow}>
          <View style={styles.identityLeftCol}>
            <Text variant="h1" style={styles.identityNameText} weight="bold" numberOfLines={1}>
              {displayName}
            </Text>
            <View style={styles.identityRoleRow}>
              <Ionicons name="briefcase-outline" size={14} color="#059669" />
              <Text style={styles.identityRoleText}>
                Responsable de projet
              </Text>
            </View>
          </View>

          <View style={styles.headerButtonsRow}>
            <TouchableOpacity
              style={styles.directReportBtn}
              onPress={() => setReportModalVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Générer un rapport client"
            >
              <Ionicons name="document-text-outline" size={17} color="#047857" />
              <Text style={styles.directReportBtnText} weight="bold">
                Rapport
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.directNewProjectBtn}
              onPress={() => router.push('/responsable/projet/create' as any)}
              activeOpacity={0.8}
              accessibilityLabel="Créer un nouveau projet"
            >
              <Ionicons name="add" size={19} color="#FFFFFF" />
              <Text style={styles.directNewProjectBtnText} weight="bold">
                Projet
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Error Banner if API failed ── */}
        {error && !data && (
          <View style={styles.globalErrorBanner}>
            <Ionicons name="alert-circle" size={22} color="#DC2626" />
            <View style={{ flex: 1 }}>
              <Text style={styles.globalErrorTitle} weight="bold">
                Erreur de chargement des données
              </Text>
              <Text style={styles.globalErrorText}>
                {error}
              </Text>
            </View>
            <TouchableOpacity onPress={onRefresh} style={styles.globalErrorRetryBtn} activeOpacity={0.7}>
              <Ionicons name="refresh" size={14} color="#FFFFFF" />
              <Text style={styles.globalErrorRetryText} weight="bold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── 3. ÉTAT GLOBAL — MAIN PROJECT CAROUSEL ── */}
        {/* Notice: No large "État global" title outside the card as requested */}
        <View style={styles.carouselSection}>
          <ScrollView
            ref={carouselScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            pagingEnabled={false}
            snapToInterval={carouselWidth + 12}
            decelerationRate="fast"
            contentContainerStyle={styles.carouselContainer}
            onMomentumScrollEnd={(e) => {
              const offsetX = e.nativeEvent.contentOffset.x;
              const idx = Math.round(offsetX / (carouselWidth + 12));
              const total = Math.max(1, projects.length);
              setActiveSlideIndex(Math.max(0, Math.min(idx, total - 1)));
            }}
          >
            {projects.length > 0 ? (
              projects.map((proj) => {
                const effectiveProj: ResponsableProjectItem = {
                  ...proj,
                  cover_image_url:
                    localCoverOverrides[proj.id] !== undefined
                      ? localCoverOverrides[proj.id]
                      : proj.cover_image_url,
                };
                const cover = getProjectCover(effectiveProj);
                const dateBadgeText = formatProjectDateBadge(proj.date_debut);
                const linearKmText = formatKm(proj.total_km);

                return (
                  <View key={proj.id} style={[styles.mainCarouselCard, { width: carouselWidth }]}>
                    <TouchableOpacity
                      activeOpacity={0.92}
                      style={styles.cardInteractiveArea}
                      onPress={() => router.push(`/responsable/projet/${proj.id}` as any)}
                      accessibilityLabel={`Consulter le projet ${proj.nom}`}
                    >
                      {/* Top / Image Area: Full-width rounded image with dedicated visual zones */}
                      <View style={[styles.projectImageHero, { height: heroHeight }]}>
                        <Image
                          source={cover.source}
                          style={styles.projectHeroImage}
                          resizeMode="cover"
                        />
                        {/* Dark Gradient Overlay for text contrast */}
                        <View style={styles.projectHeroDarkOverlay} />
                        <View style={styles.projectHeroTopGradient} />
                        <View style={styles.projectHeroBottomGradient} />

                        {/* Top Badges Row (Left: Type, Right: Date) */}
                        <View style={styles.heroTopBadgesRow}>
                          {/* Project Type Badge */}
                          <View style={styles.heroCategoryBadge}>
                            <Ionicons name={cover.categoryIcon as any} size={14} color="#FFFFFF" />
                            <Text style={styles.heroCategoryBadgeText} weight="bold" numberOfLines={1}>
                              {cover.categoryLabel}
                            </Text>
                          </View>

                          {/* Date Badge */}
                          <View style={styles.heroDateBadge}>
                            <Ionicons name="calendar-outline" size={14} color="#FFFFFF" />
                            <Text style={styles.heroDateBadgeText} weight="bold" numberOfLines={1}>
                              {dateBadgeText}
                            </Text>
                          </View>
                        </View>

                        {/* Middle: Project Title & Description (Safe Margins between Arrows) */}
                        <View style={styles.heroTitleContainer}>
                          <Text style={styles.heroProjectTitle} weight="bold" numberOfLines={2}>
                            Projet : {proj.nom}
                          </Text>
                          {proj.description ? (
                            <Text style={styles.heroProjectDesc} numberOfLines={2}>
                              {proj.description}
                            </Text>
                          ) : null}
                        </View>

                        {/* Dedicated Bottom-Left: Average Advancement */}
                        <View style={styles.heroAdvancementContainer}>
                          <CircularProgressRing
                            percentage={proj.avancement_moyen}
                            size={68}
                            strokeWidth={6}
                            color="#10B981"
                          />
                          <View style={styles.heroAdvancementTextGroup}>
                            <Text style={styles.heroAdvancementMainLabel} weight="bold">
                              Avancement moyen
                            </Text>
                            <Text style={styles.heroAdvancementSubLabel} weight="bold">
                              des chantiers
                            </Text>
                          </View>
                        </View>

                        {/* Dedicated Bottom Center-Right: In-Hero Pagination Dots */}
                        {heroDots.length > 1 && (
                          <View style={styles.heroInImagePaginationRow} pointerEvents="none">
                            {heroDots.map((d) => (
                              <View
                                key={d.index}
                                style={[
                                  styles.heroInImageDot,
                                  d.active && styles.heroInImageDotActive,
                                ]}
                              />
                            ))}
                          </View>
                        )}
                      </View>

                      {/* Clean White Rounded Metric Strip Underneath with 3 Columns */}
                      <View style={styles.metricStripContainer}>
                        {/* Metric 1: Chantiers */}
                        <View style={styles.metricStripColumn}>
                          <View style={styles.metricStripContentRow}>
                            <Ionicons name="construct" size={22} color="#059669" />
                            <View style={styles.metricTextWrapper}>
                              <Text style={styles.metricStripValue} weight="bold">
                                {proj.nombre_chantiers}
                              </Text>
                              <Text style={styles.metricStripLabel} numberOfLines={1}>
                                Chantiers
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.metricStripSeparator} />

                        {/* Metric 2: Linéaire total */}
                        <View style={styles.metricStripColumn}>
                          <View style={styles.metricStripContentRow}>
                            <Ionicons name="resize-outline" size={22} color="#0284C7" />
                            <View style={styles.metricTextWrapper}>
                              <Text style={styles.metricStripValue} weight="bold">
                                {linearKmText}
                              </Text>
                              <Text style={styles.metricStripLabel} numberOfLines={1}>
                                Linéaire total
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.metricStripSeparator} />

                        {/* Metric 3: A.T. affectés */}
                        <View style={styles.metricStripColumn}>
                          <View style={styles.metricStripContentRow}>
                            <Ionicons name="people" size={22} color="#6366F1" />
                            <View style={styles.metricTextWrapper}>
                              <Text style={styles.metricStripValue} weight="bold">
                                {proj.agents_count || 0}
                              </Text>
                              <Text style={styles.metricStripLabel} numberOfLines={1}>
                                A.T. affectés
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Touch-Friendly Floating Left / Right Navigation Arrows (>= 44dp target) */}
                    {projects.length > 1 && (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.heroArrowBtn,
                            styles.heroArrowBtnLeft,
                            { top: arrowTop },
                            activeSlideIndex === 0 && styles.heroArrowBtnDisabled,
                          ]}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={(e) => {
                            e.stopPropagation();
                            scrollToSlide(activeSlideIndex - 1);
                          }}
                          disabled={activeSlideIndex === 0}
                          activeOpacity={0.7}
                          accessibilityLabel="Projet précédent"
                        >
                          <Ionicons
                            name="chevron-back"
                            size={22}
                            color={activeSlideIndex === 0 ? 'rgba(255,255,255,0.25)' : '#FFFFFF'}
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.heroArrowBtn,
                            styles.heroArrowBtnRight,
                            { top: arrowTop },
                            activeSlideIndex >= projects.length - 1 && styles.heroArrowBtnDisabled,
                          ]}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={(e) => {
                            e.stopPropagation();
                            scrollToSlide(activeSlideIndex + 1);
                          }}
                          disabled={activeSlideIndex >= projects.length - 1}
                          activeOpacity={0.7}
                          accessibilityLabel="Projet suivant"
                        >
                          <Ionicons
                            name="chevron-forward"
                            size={22}
                            color={
                              activeSlideIndex >= projects.length - 1
                                ? 'rgba(255,255,255,0.25)'
                                : '#FFFFFF'
                            }
                          />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })
            ) : error ? (
              /* Error State Card when backend API fails */
              <View style={[styles.mainCarouselCard, { width: carouselWidth }]}>
                <View style={[styles.projectImageHero, { height: heroHeight, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 }]}>
                  <Ionicons name="cloud-offline-outline" size={42} color="#F87171" style={{ marginBottom: 8 }} />
                  <Text style={{ color: '#FFFFFF', fontSize: 15, textAlign: 'center', marginBottom: 4 }} weight="bold">
                    Erreur de chargement des projets
                  </Text>
                  <Text style={{ color: '#94A3B8', fontSize: 11.5, textAlign: 'center', marginBottom: 12, lineHeight: 16 }}>
                    {error || 'Impossible de joindre le serveur. Vos projets existants restent en sécurité dans la base.'}
                  </Text>
                  <TouchableOpacity
                    style={{ backgroundColor: '#059669', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    onPress={onRefresh}
                    activeOpacity={0.8}
                    accessibilityLabel="Réessayer de charger les projets"
                  >
                    <Ionicons name="refresh" size={15} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: 13 }} weight="bold">
                      Réessayer
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.metricStripContainer}>
                  <View style={{ flex: 1, alignItems: 'center', paddingVertical: 2 }}>
                    <Text style={{ color: '#DC2626', fontSize: 11.5 }} weight="semibold">
                      Serveur indisponible • Données préservées
                    </Text>
                  </View>
                </View>
              </View>
            ) : (
              /* Fallback Overview Card when no projects exist yet */
              <View style={[styles.mainCarouselCard, { width: carouselWidth }]}>
                <TouchableOpacity
                  activeOpacity={0.92}
                  style={styles.cardInteractiveArea}
                  onPress={() => router.push('/responsable/projet/create' as any)}
                  accessibilityLabel="Créer un premier projet"
                >
                  <View style={[styles.projectImageHero, { height: heroHeight }]}>
                    <Image
                      source={PROJECT_CATEGORY_IMAGES.AUTRE}
                      style={styles.projectHeroImage}
                      resizeMode="cover"
                    />
                    <View style={styles.projectHeroDarkOverlay} />
                    <View style={styles.projectHeroTopGradient} />
                    <View style={styles.projectHeroBottomGradient} />

                    <View style={styles.heroTopBadgesRow}>
                      <View style={styles.heroCategoryBadge}>
                        <Ionicons name="business-outline" size={14} color="#FFFFFF" />
                        <Text style={styles.heroCategoryBadgeText} weight="bold" numberOfLines={1}>
                          Infrastructure
                        </Text>
                      </View>
                      <View style={styles.heroDateBadge}>
                        <Ionicons name="calendar-outline" size={14} color="#FFFFFF" />
                        <Text style={styles.heroDateBadgeText} weight="bold" numberOfLines={1}>
                          {formatProjectDateBadge()}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.heroTitleContainer}>
                      <Text style={styles.heroProjectTitle} weight="bold" numberOfLines={2}>
                        Aucun projet actif
                      </Text>
                      <Text style={styles.heroProjectDesc} numberOfLines={2}>
                        Appuyez pour créer votre premier projet d'infrastructure
                      </Text>
                    </View>

                    <View style={styles.heroAdvancementContainer}>
                      <CircularProgressRing
                        percentage={0}
                        size={68}
                        strokeWidth={6}
                        color="#10B981"
                      />
                      <View style={styles.heroAdvancementTextGroup}>
                        <Text style={styles.heroAdvancementMainLabel} weight="bold">
                          Avancement moyen
                        </Text>
                        <Text style={styles.heroAdvancementSubLabel} weight="bold">
                          des chantiers
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.metricStripContainer}>
                    <View style={styles.metricStripColumn}>
                      <View style={styles.metricStripContentRow}>
                        <Ionicons name="construct" size={22} color="#059669" />
                        <View style={styles.metricTextWrapper}>
                          <Text style={styles.metricStripValue} weight="bold">0</Text>
                          <Text style={styles.metricStripLabel} numberOfLines={1}>Chantiers</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.metricStripSeparator} />
                    <View style={styles.metricStripColumn}>
                      <View style={styles.metricStripContentRow}>
                        <Ionicons name="resize-outline" size={22} color="#0284C7" />
                        <View style={styles.metricTextWrapper}>
                          <Text style={styles.metricStripValue} weight="bold">0 km</Text>
                          <Text style={styles.metricStripLabel} numberOfLines={1}>Linéaire total</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.metricStripSeparator} />
                    <View style={styles.metricStripColumn}>
                      <View style={styles.metricStripContentRow}>
                        <Ionicons name="people" size={22} color="#6366F1" />
                        <View style={styles.metricTextWrapper}>
                          <Text style={styles.metricStripValue} weight="bold">0</Text>
                          <Text style={styles.metricStripLabel} numberOfLines={1}>A.T. affectés</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>

          {/* Project Counter and Progress Underneath Card */}
          {projects.length > 0 && (
            <View style={styles.projectCounterContainer}>
              <Text style={styles.projectCounterText} weight="semibold">
                Projet {activeSlideIndex + 1} sur {projects.length}
              </Text>
              {projects.length > 1 && (
                <View style={styles.projectCounterTrack}>
                  <View
                    style={[
                      styles.projectCounterThumb,
                      {
                        width: `${Math.max(12, ((activeSlideIndex + 1) / projects.length) * 100)}%`,
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          )}
        </View>

        {/* ── 4. “INDICATEURS CLÉS” (2x2 Grid Matching Mockup) ── */}
        <View style={styles.kpiSection}>
          <View style={styles.kpiHeaderRow}>
            <Text style={styles.sectionHeading} weight="bold">
              INDICATEURS CLÉS
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/projects')}
              style={styles.kpiSeeMoreBtn}
              activeOpacity={0.7}
              accessibilityLabel="Voir plus d'indicateurs"
            >
              <Text style={styles.kpiSeeMoreText} weight="bold">
                Voir plus →
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.kpiGrid}>
            {/* KPI 1: Projets */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => router.push('/(tabs)/projects')}
              accessibilityLabel="Voir tous les projets"
            >
              <View style={styles.kpiTopRow}>
                <View style={[styles.kpiIconBox, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="folder" size={18} color="#2563EB" />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text style={styles.kpiValue} weight="bold">
                {stats.totalProjects}
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                Projets
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                {stats.projectsEnCours || stats.totalProjects} en cours · {stats.projectsTermines || 0} terminés
              </Text>
            </TouchableOpacity>

            {/* KPI 2: Chantiers */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => router.push('/(tabs)/projects')}
              accessibilityLabel="Voir tous les chantiers"
            >
              <View style={styles.kpiTopRow}>
                <View style={[styles.kpiIconBox, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="construct" size={18} color="#16A34A" />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text style={styles.kpiValue} weight="bold">
                {stats.totalChantiers}
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                Chantiers
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                {totalPortfolioKm} km au total
              </Text>
            </TouchableOpacity>

            {/* KPI 3: Avancement moyen */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => {
                scrollViewRef.current?.scrollTo({ y: 780, animated: true });
              }}
              accessibilityLabel="Voir l'avancement détaillé des projets"
            >
              <View style={styles.kpiTopRow}>
                <View style={[styles.kpiIconBox, { backgroundColor: '#F0FDFA' }]}>
                  <Ionicons name="stats-chart" size={18} color="#0D9488" />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text style={styles.kpiValue} weight="bold">
                {stats.avancementMoyen}%
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                Avancement moyen
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                Sur l'ensemble des projets
              </Text>
            </TouchableOpacity>

            {/* KPI 4: Équipe terrain */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => router.push('/responsable/equipe-terrain' as any)}
              accessibilityLabel="Gérer l'équipe terrain"
            >
              <View style={styles.kpiTopRow}>
                <View style={[styles.kpiIconBox, { backgroundColor: '#F5F3FF' }]}>
                  <Ionicons name="people" size={18} color="#8B5CF6" />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text style={styles.kpiValue} weight="bold">
                {stats.equipeTerrain?.totalAvailable || 4}
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                Équipe terrain
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                {stats.equipeTerrain?.totalAssigned || 4} A.T. actifs
              </Text>
            </TouchableOpacity>

            {/* KPI 5: À surveiller */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => {
                setSelectedAlertCategory('TOUS');
                scrollViewRef.current?.scrollTo({ y: 440, animated: true });
              }}
              accessibilityLabel="Voir les alertes opérationnelles"
            >
              <View style={styles.kpiTopRow}>
                <View
                  style={[
                    styles.kpiIconBox,
                    { backgroundColor: alerts.length > 0 ? '#FEF2F2' : '#F0FDF4' },
                  ]}
                >
                  <Ionicons
                    name={alerts.length > 0 ? 'warning' : 'checkmark-circle'}
                    size={18}
                    color={alerts.length > 0 ? '#DC2626' : '#16A34A'}
                  />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text
                style={[
                  styles.kpiValue,
                  alerts.length > 0 && { color: '#DC2626' },
                ]}
                weight="bold"
              >
                {alerts.length}
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                À surveiller
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                {alerts.length > 0
                  ? `${alerts.length} action${alerts.length > 1 ? 's' : ''} requise${alerts.length > 1 ? 's' : ''}`
                  : 'Système opérationnel'}
              </Text>
            </TouchableOpacity>

            {/* KPI 6: Réclamations */}
            <TouchableOpacity
              style={styles.kpiCard}
              activeOpacity={0.75}
              onPress={() => {
                setSelectedAlertCategory('RECLAMATION');
                scrollViewRef.current?.scrollTo({ y: 440, animated: true });
              }}
              accessibilityLabel="Voir les réclamations clients"
            >
              <View style={styles.kpiTopRow}>
                <View
                  style={[
                    styles.kpiIconBox,
                    {
                      backgroundColor:
                        (stats.totalReclamations || reclamations.length) > 0
                          ? '#FEF3C7'
                          : '#F8FAFC',
                    },
                  ]}
                >
                  <Ionicons
                    name="chatbox-ellipses"
                    size={18}
                    color={
                      (stats.totalReclamations || reclamations.length) > 0
                        ? '#D97706'
                        : '#64748B'
                    }
                  />
                </View>
                <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
              </View>
              <Text style={styles.kpiValue} weight="bold">
                {stats.totalReclamations || reclamations.length}
              </Text>
              <Text style={styles.kpiLabel} weight="semibold">
                Réclamations
              </Text>
              <Text style={styles.kpiContext} numberOfLines={1}>
                {(stats.totalReclamations || reclamations.length) > 0
                  ? `${stats.totalReclamations || reclamations.length} signalement${(stats.totalReclamations || reclamations.length) > 1 ? 's' : ''}`
                  : 'Aucun litige client'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 5. “À SURVEILLER” (Actionable Items Section with Categories) ── */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionHeading} weight="bold">
                À SURVEILLER ({alerts.length})
              </Text>
              <Text style={styles.sectionSubHeading}>
                Points d'attention opérationnels et configurations requises
              </Text>
            </View>
          </View>

          {/* Filter Pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterPillsRow}>
            {[
              { key: 'TOUS', label: `Tous (${alertCategories.TOUS || 0})` },
              { key: 'GIS', label: `GIS (${alertCategories.GIS || 0})` },
              { key: 'TRONCON', label: `Tronçons (${alertCategories.TRONCON || 0})` },
              { key: 'AT', label: `A.T. (${alertCategories.AT || 0})` },
              { key: 'RECLAMATION', label: `Réclamations (${alertCategories.RECLAMATION || 0})` },
            ].map((f) => {
              const isSelected = selectedAlertCategory === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterPill, isSelected && styles.filterPillActive]}
                  onPress={() => setSelectedAlertCategory(f.key)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[styles.filterPillText, isSelected && styles.filterPillTextActive]}
                    weight={isSelected ? 'bold' : 'normal'}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Actionable List */}
          {filteredAlerts.length > 0 ? (
            <View style={styles.alertsList}>
              {filteredAlerts.slice(0, 6).map((item) => {
                const isHigh = item.severity === 'HIGH';
                const isMed = item.severity === 'MEDIUM';

                return (
                  <Card key={item.id} variant="flat" style={styles.alertItemCard}>
                    <View style={styles.alertItemHeader}>
                      <View
                        style={[
                          styles.severityDot,
                          { backgroundColor: isHigh ? '#DC2626' : isMed ? '#F59E0B' : '#3B82F6' },
                        ]}
                      />
                      <Text style={styles.alertItemCategory} weight="bold">
                        {item.category || item.type}
                      </Text>
                      {item.projetNom ? (
                        <Text style={styles.alertItemProjet} numberOfLines={1}>
                          • {item.projetNom}
                        </Text>
                      ) : null}
                    </View>

                    <Text style={styles.alertItemTitle} weight="bold">
                      {item.title || item.chantierNom || 'Alerte'}
                    </Text>
                    <Text style={styles.alertItemMessage}>{item.message}</Text>

                    {item.actionLabel && (
                      <TouchableOpacity
                        style={styles.alertActionTouchBtn}
                        onPress={() => {
                          if (item.actionRoute) {
                            router.push(item.actionRoute as any);
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.alertActionTouchBtnText} weight="bold">
                          {item.actionLabel}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                );
              })}
            </View>
          ) : (
            <Card variant="flat" style={styles.emptyAlertsCard}>
              <Ionicons name="checkmark-circle-outline" size={32} color="#16A34A" />
              <Text style={styles.emptyAlertsText} weight="semibold">
                Aucun élément à surveiller dans cette catégorie
              </Text>
            </Card>
          )}
        </View>

        {/* ── 6. “RÉPARTITION DES CHANTIERS” (Analytical Chart) ── */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading} weight="bold">
            RÉPARTITION DES CHANTIERS
          </Text>
          <Text style={styles.sectionSubHeading}>
            État opérationnel des {stats.totalChantiers} chantiers déclarés
          </Text>

          <Card variant="elevated" style={styles.chartCard}>
            {/* Segmented Horizontal Progress Bar */}
            <View style={styles.segmentedBarTrack}>
              {(stats.chantiersDistribution || []).map((seg, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.segmentedBarPart,
                    {
                      width: `${Math.max(seg.percentage, 4)}%`,
                      backgroundColor: seg.color,
                    },
                  ]}
                />
              ))}
            </View>

            {/* Chart Legend */}
            <View style={styles.chartLegendGrid}>
              {(stats.chantiersDistribution || []).map((seg, idx) => (
                <View key={idx} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: seg.color }]} />
                  <View>
                    <Text style={styles.legendLabel} weight="semibold">
                      {seg.statut}
                    </Text>
                    <Text style={styles.legendValue}>
                      {seg.count} chantier{seg.count > 1 ? 's' : ''} ({seg.percentage}%)
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </View>

        {/* ── 7. “AVANCEMENT DES PROJETS” (Projects Section with Contextual Cover Modifier) ── */}
        <View style={styles.sectionContainer}>
          <View style={styles.sectionHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionHeading} weight="bold">
                AVANCEMENT DES PROJETS
              </Text>
              <Text style={styles.sectionSubHeading}>
                Comparatif de progression sur les axes prioritaires
              </Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/(tabs)/projects')}>
              <Text style={styles.viewAllLink} weight="bold">
                Voir tout &rarr;
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.projectsAnalysisList}>
            {projects.slice(0, 5).map((p) => {
              const effectiveP = {
                ...p,
                cover_image_url:
                  localCoverOverrides[p.id] !== undefined
                    ? localCoverOverrides[p.id]
                    : p.cover_image_url,
              };
              const cover = getProjectCover(effectiveP);
              const isSelected = selectedProjectIdForActions === p.id;

              return (
                <View key={p.id} style={styles.projectAnalysisCard}>
                  <TouchableOpacity
                    style={styles.projectAnalysisMainRow}
                    activeOpacity={0.8}
                    onPress={() => setSelectedProjectIdForActions(isSelected ? null : p.id)}
                  >
                    {/* Thumbnail with Category / Custom Cover */}
                    <View style={styles.projectThumbnailBox}>
                      <Image source={cover.source} style={styles.projectThumbnailImage} resizeMode="cover" />
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={styles.projectAnalysisMetaRow}>
                        <Text style={styles.projectAnalysisName} weight="bold" numberOfLines={1}>
                          {p.nom}
                        </Text>
                        <Text style={styles.projectAnalysisPercent} weight="bold">
                          {p.avancement_moyen}%
                        </Text>
                      </View>

                      <Text style={styles.projectAnalysisMetrics}>
                        {cover.categoryLabel} • {p.nombre_chantiers} chantiers • {formatKm(p.total_km)}
                      </Text>

                      {/* Progress Bar */}
                      <View style={styles.projectAnalysisBarBg}>
                        <View
                          style={[
                            styles.projectAnalysisBarFill,
                            { width: `${Math.min(p.avancement_moyen, 100)}%` },
                          ]}
                        />
                      </View>
                    </View>

                    {/* Quick Camera Icon Button to open Cover Modal */}
                    <TouchableOpacity
                      style={styles.quickCoverChangeBtn}
                      onPress={(e) => {
                        e.stopPropagation();
                        setSelectedProjectForCover(effectiveP);
                        setCoverModalVisible(true);
                      }}
                      accessibilityLabel={`Modifier la couverture de ${p.nom}`}
                    >
                      <Ionicons name="camera" size={17} color={Palette.primary} />
                    </TouchableOpacity>
                  </TouchableOpacity>

                  {/* Contextual Action Bar when selected from Projects section */}
                  {isSelected && (
                    <View style={styles.projectSelectedActionsBar}>
                      <TouchableOpacity
                        style={styles.projectCoverActionBtn}
                        onPress={() => {
                          setSelectedProjectForCover(effectiveP);
                          setCoverModalVisible(true);
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="camera" size={15} color={Palette.primary} />
                        <Text style={styles.projectCoverActionBtnText} weight="bold">
                          Modifier l'image de couverture
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.projectDetailActionBtn}
                        onPress={() => router.push(`/responsable/projet/${p.id}` as any)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.projectDetailActionBtnText} weight="bold">
                          Consulter &rarr;
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* ── 8. “ÉQUIPE TERRAIN” (Team Snapshot) ── */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading} weight="bold">
            ÉQUIPE TERRAIN
          </Text>

          <Card variant="elevated" style={styles.teamCard}>
            <View style={styles.teamHeaderRow}>
              <View style={styles.teamIconBox}>
                <Ionicons name="people" size={22} color="#FFFFFF" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.teamCardTitle} weight="bold">
                  {stats.equipeTerrain?.totalAvailable || 0} Agents de Terrain actifs
                </Text>
                <Text style={styles.teamCardSubtitle}>
                  {stats.equipeTerrain?.totalAssigned || 0} affectés sur tronçons • {stats.equipeTerrain?.totalUnassigned || 0} disponibles
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.teamCardActionBtn}
              onPress={() => router.push('/responsable/equipe-terrain' as any)}
              activeOpacity={0.8}
              accessibilityLabel="Gérer les affectations de l'équipe terrain"
            >
              <Text style={styles.teamCardActionBtnText} weight="bold">
                Gérer l'équipe &rarr;
              </Text>
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── 9. “RAPPORTS” (Report Generation Entry) ── */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading} weight="bold">
            RAPPORTS DE SUIVI
          </Text>

          <Card variant="elevated" style={styles.reportCard}>
            <View style={styles.reportRow}>
              <View style={styles.reportIconBox}>
                <Ionicons name="document-text" size={24} color={Palette.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportCardTitle} weight="bold">
                  Générer un rapport de suivi
                </Text>
                <Text style={styles.reportCardSub}>
                  Exportez l'état d'avancement officiel et certifié pour le maître d'ouvrage ou le client.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.reportCardActionBtn}
              onPress={() => setReportModalVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Ouvrir l'assistant de génération de rapport"
            >
              <Text style={styles.reportCardActionBtnText} weight="bold">
                Créer un rapport &rarr;
              </Text>
            </TouchableOpacity>
          </Card>
        </View>

        {/* ── 10. “ACTIVITÉ RÉCENTE” (Compact Activity Stream) ── */}
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionHeading} weight="bold">
            ACTIVITÉ RÉCENTE
          </Text>

          {combinedRecentActivity.length > 0 ? (
            <View style={styles.activityList}>
              {combinedRecentActivity.map((act) => (
                <TouchableOpacity
                  key={act.id}
                  style={styles.activityRow}
                  activeOpacity={0.8}
                  onPress={() => {
                    if (act.route) router.push(act.route as any);
                  }}
                >
                  <View
                    style={[
                      styles.activityIconBg,
                      {
                        backgroundColor:
                          act.type === 'OBSERVATION'
                            ? '#F0FDF4'
                            : act.type === 'RECLAMATION'
                            ? '#EFF6FF'
                            : '#FEF3C7',
                      },
                    ]}
                  >
                    <Ionicons
                      name={
                        act.type === 'OBSERVATION'
                          ? 'eye'
                          : act.type === 'RECLAMATION'
                          ? 'chatbox-ellipses'
                          : 'help-circle'
                      }
                      size={16}
                      color={
                        act.type === 'OBSERVATION'
                          ? '#16A34A'
                          : act.type === 'RECLAMATION'
                          ? '#2563EB'
                          : '#D97706'
                      }
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityTitle} weight="semibold" numberOfLines={1}>
                      {act.title}
                    </Text>
                    <Text style={styles.activitySubtitle} numberOfLines={1}>
                      {act.subtitle}
                    </Text>
                  </View>

                  <Text style={styles.activityDate}>{act.date}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Card variant="flat" style={styles.emptyCard}>
              <Ionicons name="time-outline" size={28} color={Palette.textMuted} />
              <Text style={styles.emptyCardText}>Aucune activité récente enregistrée</Text>
            </Card>
          )}
        </View>
      </ScrollView>

      {/* ── Report Generation Modal Wizard ── */}
      <ReportGenerationModal
        visible={reportModalVisible}
        onClose={() => setReportModalVisible(false)}
        projects={projects}
        clients={clients}
      />

      {/* ── Project Cover Replacement / Customization Modal ── */}
      <ProjectCoverModal
        visible={coverModalVisible}
        onClose={() => {
          setCoverModalVisible(false);
          setSelectedProjectForCover(null);
        }}
        project={selectedProjectForCover}
        onCoverUpdated={handleCoverUpdated}
      />

      {/* ── Global Role-Aware Sliding Drawer ── */}
      <GlobalAppDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  headerIdentityActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  globalErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 14,
    gap: 10,
  },
  globalErrorTitle: {
    fontSize: 13,
    color: '#991B1B',
    marginBottom: 2,
  },
  globalErrorText: {
    fontSize: 11.5,
    color: '#B91C1C',
    lineHeight: 15,
  },
  globalErrorRetryBtn: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  globalErrorRetryText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  identityLeftCol: {
    flex: 1,
    marginRight: 10,
  },
  identityNameText: {
    fontSize: 22,
    color: '#0F172A',
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  identityRoleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  identityRoleText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '600',
  },
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  directReportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
    borderRadius: 12,
    height: 42,
    paddingHorizontal: 13,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  directReportBtnText: {
    fontSize: 13.5,
    color: '#065F46',
    fontWeight: '700',
  },
  directNewProjectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#047857',
    borderRadius: 12,
    height: 42,
    paddingHorizontal: 14,
    shadowColor: '#047857',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  directNewProjectBtnText: {
    fontSize: 13.5,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  /* ── Main Project Carousel Styles (Reference Mockup #1) ── */
  carouselSection: {
    marginBottom: 18,
  },
  carouselContainer: {
    paddingRight: 16,
    gap: 12,
  },
  mainCarouselCard: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    position: 'relative',
  },
  cardInteractiveArea: {
    width: '100%',
  },
  projectImageHero: {
    backgroundColor: '#0F172A',
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 19,
    borderTopRightRadius: 19,
  },
  projectHeroImage: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  projectHeroDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(11, 23, 22, 0.32)',
  },
  projectHeroTopGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 70,
    backgroundColor: 'rgba(11, 23, 22, 0.42)',
  },
  projectHeroBottomGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 110,
    backgroundColor: 'rgba(5, 15, 13, 0.62)',
  },
  heroTopBadgesRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 4,
  },
  heroCategoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: '52%',
  },
  heroCategoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  heroDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: '44%',
  },
  heroDateBadgeText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  heroTitleContainer: {
    position: 'absolute',
    top: 48,
    left: 48,
    right: 48,
    zIndex: 3,
  },
  heroProjectTitle: {
    fontSize: 15.5,
    color: '#FFFFFF',
    lineHeight: 20,
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1.5 },
    textShadowRadius: 4,
  },
  heroProjectDesc: {
    fontSize: 11.5,
    color: '#E2E8F0',
    marginTop: 2,
    lineHeight: 15,
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroAdvancementContainer: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 3,
    maxWidth: '65%',
  },
  ringCenterTextWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPercentageText: {
    color: '#FFFFFF',
    fontSize: 14,
    letterSpacing: -0.5,
  },
  heroAdvancementTextGroup: {
    flexShrink: 1,
  },
  heroAdvancementMainLabel: {
    color: '#FFFFFF',
    fontSize: 12.5,
    lineHeight: 16,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroAdvancementSubLabel: {
    color: '#34D399',
    fontSize: 12,
    lineHeight: 15,
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  heroInImagePaginationRow: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    zIndex: 3,
  },
  heroInImageDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
  },
  heroInImageDotActive: {
    width: 14,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10B981',
  },
  metricStripContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderBottomLeftRadius: 19,
    borderBottomRightRadius: 19,
  },
  metricStripColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricStripContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  metricTextWrapper: {
    alignItems: 'flex-start',
  },
  metricStripValue: {
    fontSize: 16,
    color: '#0F172A',
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  metricStripLabel: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 1,
  },
  metricStripSeparator: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  heroArrowBtn: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  heroArrowBtnLeft: {
    left: 8,
  },
  heroArrowBtnRight: {
    right: 8,
  },
  heroArrowBtnDisabled: {
    backgroundColor: 'rgba(15, 23, 42, 0.2)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    opacity: 0.35,
  },
  projectCounterContainer: {
    alignItems: 'center',
    marginTop: 14,
    gap: 8,
  },
  projectCounterText: {
    fontSize: 13,
    color: '#475569',
  },
  projectCounterTrack: {
    width: 140,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  projectCounterThumb: {
    height: '100%',
    backgroundColor: '#059669',
    borderRadius: 3,
  },

  /* ── KPI Section Styles ── */
  kpiSection: {
    marginBottom: 24,
  },
  kpiHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  kpiSeeMoreBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  kpiSeeMoreText: {
    fontSize: 13,
    color: '#059669',
    fontWeight: '700',
  },
  sectionHeading: {
    fontSize: 12,
    color: Palette.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  kpiCard: {
    width: '48.5%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    minHeight: 110,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  kpiTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  kpiIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiValue: {
    fontSize: 20,
    color: '#0F172A',
  },
  kpiLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  kpiContext: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 3,
  },

  /* ── General Sections ── */
  sectionContainer: {
    marginBottom: 24,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionSubHeading: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  viewAllLink: {
    fontSize: 13,
    color: Palette.primary,
  },
  filterPillsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterPillActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  filterPillText: {
    fontSize: 12,
    color: Palette.text,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  alertsList: {
    gap: 10,
  },
  alertItemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  alertItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  severityDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  alertItemCategory: {
    fontSize: 10,
    color: Palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  alertItemProjet: {
    fontSize: 11,
    color: Palette.textMuted,
    flex: 1,
  },
  alertItemTitle: {
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 3,
  },
  alertItemMessage: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  alertActionTouchBtn: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  alertActionTouchBtnText: {
    fontSize: 12,
    color: Palette.primary,
  },
  emptyAlertsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyAlertsText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  segmentedBarTrack: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
    marginBottom: 16,
  },
  segmentedBarPart: {
    height: '100%',
  },
  chartLegendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    fontSize: 12,
    color: '#0F172A',
  },
  legendValue: {
    fontSize: 11,
    color: Palette.textMuted,
  },

  /* ── Projects Analysis Section with Contextual Cover Modifier ── */
  projectsAnalysisList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  projectAnalysisCard: {
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  projectAnalysisMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  projectThumbnailBox: {
    width: 58,
    height: 58,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  projectThumbnailImage: {
    width: '100%',
    height: '100%',
  },
  projectAnalysisMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  projectAnalysisName: {
    fontSize: 14,
    color: '#0F172A',
    flex: 1,
    marginRight: 8,
  },
  projectAnalysisPercent: {
    fontSize: 14,
    color: Palette.primary,
  },
  projectAnalysisMetrics: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  projectAnalysisBarBg: {
    height: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 2.5,
    overflow: 'hidden',
  },
  projectAnalysisBarFill: {
    height: '100%',
    backgroundColor: Palette.primary,
    borderRadius: 2.5,
  },
  quickCoverChangeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  projectSelectedActionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 10,
  },
  projectCoverActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 40,
  },
  projectCoverActionBtnText: {
    fontSize: 12,
    color: Palette.primary,
  },
  projectDetailActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minHeight: 40,
  },
  projectDetailActionBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
  },

  /* ── Team & Report Cards ── */
  teamCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  teamHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamCardTitle: {
    fontSize: 14,
    color: '#0F172A',
  },
  teamCardSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reportIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportCardTitle: {
    fontSize: 14,
    color: '#0F172A',
  },
  reportCardSub: {
    fontSize: 11,
    color: Palette.textMuted,
    lineHeight: 15,
    marginTop: 2,
  },
  teamCardActionBtn: {
    marginTop: 14,
    backgroundColor: Palette.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  teamCardActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  reportCardActionBtn: {
    marginTop: 14,
    backgroundColor: Palette.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  reportCardActionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
  },

  /* ── Activity Stream ── */
  activityList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 10,
  },
  activityIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: {
    fontSize: 12,
    color: '#0F172A',
  },
  activitySubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  activityDate: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  emptyCardText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
});
