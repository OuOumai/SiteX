import React, { useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { GlobalAppDrawer } from '@/components/navigation/GlobalAppDrawer';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  api,
  ResponsableDashboardData,
  AgentDashboardResponse,
} from '@/services/api';
import { ResponsableAnalyticalDashboard } from '@/components/dashboard/ResponsableAnalyticalDashboard';

export default function HomeScreen() {
  const router = useRouter();
  const { token, user, refreshUser } = useAuth();

  const [dashboardData, setDashboardData] = useState<ResponsableDashboardData | null>(null);
  const [agentDashboardData, setAgentDashboardData] = useState<AgentDashboardResponse | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const isPendingRole = user?.role_request?.statut === 'PENDING';
  const isAdmin = user?.role_nom === 'Administrateur' || user?.role_id === 1;
  const isResponsable =
    !isPendingRole &&
    (user?.role_nom === 'Responsable' ||
      user?.role_id === 2 ||
      isAdmin);
  const isAgentTerrain =
    !isPendingRole && (user?.role_nom === 'AgentTerrain' || user?.role_id === 3);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) {
      setIsRefreshing(true);
    }
    setDashboardError(null);

    try {
      if (isAgentTerrain) {
        const res = await api.getAgentDashboard(token);
        setAgentDashboardData(res);
      } else if (isResponsable) {
        const res = await api.getResponsableDashboard(token);
        setDashboardData(res);
      } else {
        // Client or standard user: load project list safely
        const projectsRes = await api.getProjects(token, { limit: 10 });
        setDashboardData({
          stats: {
            totalProjects: projectsRes.pagination?.total || projectsRes.projects?.length || 0,
            projectsEnCours: projectsRes.statusCounts?.['En cours'] || 0,
            projectsTermines: projectsRes.statusCounts?.['Terminés'] || 0,
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
          },
          projects: (projectsRes.projects as any) || [],
          chantiers: [],
          observations: [],
          reclamations: [],
          explications: [],
          clients: [],
          alerts: [],
        });
      }
    } catch (err: any) {
      console.warn('Dashboard fetch notice:', err.message);
      setDashboardError(err.message || 'Impossible de charger les données du tableau de bord');
    } finally {
      setIsLoadingData(false);
      setIsRefreshing(false);
    }
  }, [token, isAgentTerrain, isResponsable]);

  useFocusEffect(
    useCallback(() => {
      refreshUser();
      fetchDashboard();
    }, [refreshUser, fetchDashboard])
  );

  const prenom = user?.prenom?.trim() || 'Utilisateur';

  // Dynamic role badge styling and label
  let badgeLabel = 'ESPACE SiteX';
  let badgeBg = Palette.primary;
  let badgeIcon: any = 'briefcase';

  if (isPendingRole) {
    badgeLabel = 'EN ATTENTE DE VALIDATION';
    badgeBg = '#D97706'; // Amber / Orange
    badgeIcon = 'time-outline';
  } else if (isAdmin) {
    badgeLabel = 'ADMINISTRATEUR';
    badgeBg = '#7C3AED';
    badgeIcon = 'shield-checkmark';
  } else if (isResponsable) {
    badgeLabel = 'RESPONSABLE DE PROJET';
    badgeBg = Palette.primary;
    badgeIcon = 'briefcase';
  } else if (isAgentTerrain) {
    badgeLabel = 'AGENT DE TERRAIN';
    badgeBg = '#0D9488';
    badgeIcon = 'navigate-outline';
  } else if (user?.role_nom === 'Client' || user?.role_id === 4) {
    badgeLabel = 'ESPACE CLIENT';
    badgeBg = '#2563EB';
    badgeIcon = 'business-outline';
  }

  const stats = dashboardData?.stats || {
    totalProjects: 0,
    totalChantiers: 0,
    chantiersPrets: 0,
    avancementMoyen: 0,
    totalObservations: 0,
    totalReclamations: 0,
  };

  const agentStats = agentDashboardData?.stats || {
    totalAssignments: 0,
    totalProjects: 0,
    totalKmAssigned: 0,
    avancementMoyen: 0,
  };

  const agentAssignments = agentDashboardData?.affectations || [];
  const alerts = dashboardData?.alerts || [];
  const projects = dashboardData?.projects || [];
  const observations = dashboardData?.observations || [];
  const reclamations = dashboardData?.reclamations || [];

  if (isResponsable && !isPendingRole) {
    return (
      <ResponsableAnalyticalDashboard
        data={dashboardData}
        isLoading={isLoadingData}
        isRefreshing={isRefreshing}
        error={dashboardError}
        onRefresh={() => fetchDashboard(true)}
        user={user}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDashboard(true)}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 1. Top Management Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            {/* Left Global Navigation Menu Button */}
            <TouchableOpacity
              style={styles.menuBtn}
              onPress={() => setDrawerOpen(true)}
              activeOpacity={0.75}
              accessibilityLabel="Ouvrir le menu de navigation"
            >
              <Ionicons name="menu-outline" size={24} color={Palette.text} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <View style={[styles.roleBadge, { backgroundColor: badgeBg }]}>
                <Ionicons name={badgeIcon} size={12} color="#FFFFFF" />
                <Text style={styles.roleBadgeText}>
                  {badgeLabel}
                </Text>
              </View>
              <Text variant="h1" style={styles.greetingTitle}>
                Bonjour, {prenom} 👋
              </Text>
              <Text style={styles.greetingSubtitle}>
                {isPendingRole
                  ? 'Compte en attente d’approbation par l’administrateur'
                  : isAgentTerrain
                  ? 'Interventions terrain & missions d’inspection linéaires'
                  : 'Supervision des infrastructures et des chantiers'}
              </Text>
            </View>

            <View style={styles.headerRightActions}>
              <NotificationBell />
              {/* Profile Avatar / Quick Link */}
              <TouchableOpacity
                style={[styles.avatarButton, isPendingRole && { borderColor: '#D97706' }]}
                activeOpacity={0.8}
                onPress={() => router.push('/(tabs)/profile')}
                accessibilityLabel="Mon profil"
              >
                {user?.photo_url ? (
                  <Image source={{ uri: user.photo_url }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText} weight="bold">
                      {user?.prenom?.[0] || 'U'}
                      {user?.nom?.[0] || ''}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Pending Role Notice Banner ── */}
        {isPendingRole && (
          <Card variant="flat" style={styles.pendingBannerCard}>
            <View style={styles.pendingBannerRow}>
              <View style={styles.pendingIconBox}>
                <Ionicons name="hourglass-outline" size={22} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingBannerTitle} weight="bold">
                  Validation de profil en cours
                </Text>
                <Text style={styles.pendingBannerText}>
                  Votre demande pour le profil « {user?.role_request?.role_nom || 'Responsable de Projet'} » a bien été enregistrée. L'administrateur validera vos accès prochainement.
                </Text>
                <TouchableOpacity
                  style={styles.pendingBannerLink}
                  onPress={() => router.push('/(tabs)/profile')}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pendingBannerLinkText} weight="semibold">
                    Voir les détails du profil &rarr;
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        )}

        {isAgentTerrain ? (
          /* ── DEDICATED AGENT DE TERRAIN VIEW ("Mes affectations") ── */
          <>
            {/* ── Action & Overview Banner ── */}
            <View style={styles.actionBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionBarTitle} weight="bold">
                  Missions & Linéaires Opérationnels
                </Text>
                <Text style={styles.actionBarSubtitle}>
                  {agentStats.totalAssignments} tronçon{agentStats.totalAssignments > 1 ? 's' : ''} assigné{agentStats.totalAssignments > 1 ? 's' : ''} • {agentStats.totalProjects} projet{agentStats.totalProjects > 1 ? 's' : ''}
                </Text>
              </View>
              <View style={styles.operationalBadge}>
                <View style={styles.operationalDot} />
                <Text style={styles.operationalBadgeText} weight="bold">Terrain Actif</Text>
              </View>
            </View>

            {/* ── KPI Grid for Agent ── */}
            <View style={styles.statsGrid}>
              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#CCFBF1' }]}>
                  <Ionicons name="navigate" size={18} color="#0D9488" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {agentStats.totalAssignments}
                </Text>
                <Text style={styles.statLabel}>Affectations</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="folder" size={18} color="#2563EB" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {agentStats.totalProjects}
                </Text>
                <Text style={styles.statLabel}>Projets</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#FAF5FF' }]}>
                  <Ionicons name="resize-outline" size={18} color="#9333EA" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {agentStats.totalKmAssigned} km
                </Text>
                <Text style={styles.statLabel}>Linéaire total</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="trending-up" size={18} color="#16A34A" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {agentStats.avancementMoyen}%
                </Text>
                <Text style={styles.statLabel}>Avancement</Text>
              </Card>
            </View>

            {/* ── Missions Section Header ── */}
            <View style={styles.sectionHeaderRow}>
              <Text variant="h2" style={styles.sectionTitle}>
                Missions d'inspection assignées ({agentAssignments.length})
              </Text>
            </View>

            {agentAssignments.length > 0 ? (
              <View style={styles.assignmentsList}>
                {agentAssignments.map((assignment) => {
                  const tStatut = assignment.troncon_statut || 'NON_COMMENCE';
                  const tStatutColor =
                    tStatut === 'TERMINE'
                      ? '#16A34A'
                      : tStatut === 'EN_COURS'
                      ? '#F4A261'
                      : tStatut === 'PROBLEME'
                      ? '#DC2626'
                      : '#94A3B8';
                  const tStatutLabel =
                    tStatut === 'TERMINE'
                      ? 'Terminé'
                      : tStatut === 'EN_COURS'
                      ? 'En cours'
                      : tStatut === 'PROBLEME'
                      ? 'Problème'
                      : 'Non commencé';

                  return (
                    <Card key={assignment.affectation_id} variant="elevated" style={styles.assignmentCard}>
                      {/* Project & Status Top Bar */}
                      <View style={styles.assignmentCardTop}>
                        <View style={styles.projectPill}>
                          <Ionicons name="folder-outline" size={12} color={Palette.primary} />
                          <Text style={styles.projectPillText} weight="bold">
                            {assignment.projet_nom}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.tronconStatutBadge,
                            { backgroundColor: `${tStatutColor}18`, borderColor: tStatutColor },
                          ]}
                        >
                          <View style={[styles.tronconStatutDot, { backgroundColor: tStatutColor }]} />
                          <Text style={[styles.tronconStatutText, { color: tStatutColor }]} weight="bold">
                            {tStatutLabel}
                          </Text>
                        </View>
                      </View>

                      {/* Tronçon Main Details */}
                      <View style={styles.assignmentCardBody}>
                        <Text variant="h3" style={styles.assignmentTronconNom}>
                          {assignment.troncon_nom}
                        </Text>
                        <Text style={styles.assignmentChantierMeta}>
                          Chantier : {assignment.chantier_nom}
                        </Text>

                        <View style={styles.assignmentPkRow}>
                          <View style={styles.pkBadge}>
                            <Ionicons name="flag-outline" size={13} color={Palette.primaryDark} />
                            <Text style={styles.pkBadgeText} weight="semibold">
                              PK {assignment.pk_debut || 0} &rarr; PK {assignment.pk_fin || 0}
                            </Text>
                          </View>
                          <Text style={styles.lengthText}>
                            {assignment.length_km || 0} km ({assignment.length_meters || 0} m)
                          </Text>
                        </View>

                        {/* Progress Indicator */}
                        <View style={styles.progressRow}>
                          <Text style={styles.progressLabel}>Avancement du tronçon :</Text>
                          <Text style={styles.progressValue} weight="bold">
                            {assignment.troncon_avancement || 0}%
                          </Text>
                        </View>
                        <View style={styles.progressBarBg}>
                          <View
                            style={[
                              styles.progressBarFill,
                              { width: `${Math.min(assignment.troncon_avancement || 0, 100)}%` },
                            ]}
                          />
                        </View>

                        {/* Responsable & Date Info */}
                        <View style={styles.assignmentFooter}>
                          <Text style={styles.assignmentResponsableText}>
                            {assignment.responsable_nom ? `Responsable : ${assignment.responsable_nom}` : 'SiteX'}
                          </Text>
                          {assignment.date_affectation ? (
                            <Text style={styles.assignmentDateText}>
                              Affecté le {assignment.date_affectation}
                            </Text>
                          ) : null}
                        </View>

                        {/* Open Tronçon Detail Button */}
                        <Button
                          title="Accéder au tronçon &rarr;"
                          variant="primary"
                          size="sm"
                          onPress={() => router.push(`/agent/troncon/${assignment.troncon_id}` as any)}
                          style={{ marginTop: 12 }}
                        />
                      </View>
                    </Card>
                  );
                })}
              </View>
            ) : (
              <Card variant="flat" style={styles.emptyAssignmentsCard}>
                <View style={styles.emptyIconBox}>
                  <Ionicons name="navigate-circle-outline" size={44} color="#0D9488" />
                </View>
                <Text style={styles.emptyAssignmentsTitle} weight="bold">
                  Aucune affectation active
                </Text>
                <Text style={styles.emptyAssignmentsDesc}>
                  Vous n'avez pas encore été affecté à un tronçon de chantier. Dès que votre Responsable de Projet vous assignera à un linéaire, il apparaîtra ici avec son tracé et ses métadonnées.
                </Text>
              </Card>
            )}
          </>
        ) : isResponsable ? (
          /* ── RESPONSABLE DEDICATED VIEW ── */
          <>
            {/* ── 2. Quick Action & Management Action Bar ── */}
            <View style={styles.actionBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionBarTitle} weight="bold">
                  Supervision Globale
                </Text>
                <Text style={styles.actionBarSubtitle}>
                  {stats.totalProjects} projets • {stats.totalChantiers} chantiers actifs
                </Text>
              </View>
              <Button
                title="+ Nouveau Projet"
                variant="primary"
                size="sm"
                onPress={() => router.push('/responsable/projet/create' as any)}
                style={styles.newProjectBtn}
              />
            </View>

            {/* ── 3. KPI Grid ── */}
            <View style={styles.statsGrid}>
              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="folder" size={18} color="#2563EB" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.totalProjects}
                </Text>
                <Text style={styles.statLabel}>Projets</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="construct" size={18} color="#16A34A" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.totalChantiers}
                </Text>
                <Text style={styles.statLabel}>Chantiers</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#FAF5FF' }]}>
                  <Ionicons name="trending-up" size={18} color="#9333EA" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.avancementMoyen}%
                </Text>
                <Text style={styles.statLabel}>Avancement</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View
                  style={[
                    styles.statIconBadge,
                    { backgroundColor: alerts.length > 0 ? '#FEF2F2' : '#F0FDF4' },
                  ]}
                >
                  <Ionicons
                    name={alerts.length > 0 ? 'alert-circle' : 'checkmark-circle'}
                    size={18}
                    color={alerts.length > 0 ? '#DC2626' : '#16A34A'}
                  />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {alerts.length}
                </Text>
                <Text style={styles.statLabel}>Alertes</Text>
              </Card>
            </View>

            {/* ── Dedicated Section: Équipe terrain ── */}
            <Card variant="elevated" style={styles.equipeCard}>
              <View style={styles.equipeCardHeader}>
                <View style={styles.equipeHeaderLeft}>
                  <View style={styles.equipeIconBox}>
                    <Ionicons name="people" size={20} color="#FFFFFF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.equipeCardTitle} weight="bold">
                      Équipe terrain
                    </Text>
                    <Text style={styles.equipeCardSub}>
                      Gestion & affectation des Agents de Terrain (A.T.)
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.gererEquipeBtn}
                  onPress={() => router.push('/responsable/equipe-terrain' as any)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.gererEquipeBtnText} weight="bold">
                    Gérer l'équipe &rarr;
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Quick Metrics Grid */}
              <View style={styles.equipeMetricsGrid}>
                <View style={styles.equipeMetricItem}>
                  <Text style={styles.equipeMetricValue} weight="bold">
                    {stats.equipeTerrain?.totalAvailable ?? 0}
                  </Text>
                  <Text style={styles.equipeMetricLabel}>A.T. disponibles</Text>
                </View>

                <View style={styles.equipeMetricDivider} />

                <View style={styles.equipeMetricItem}>
                  <Text style={[styles.equipeMetricValue, { color: '#0D9488' }]} weight="bold">
                    {stats.equipeTerrain?.totalAssigned ?? 0}
                  </Text>
                  <Text style={styles.equipeMetricLabel}>A.T. affectés</Text>
                </View>

                <View style={styles.equipeMetricDivider} />

                <View style={styles.equipeMetricItem}>
                  <Text style={[styles.equipeMetricValue, { color: Palette.primary }]} weight="bold">
                    {stats.equipeTerrain?.totalAssignments ?? 0}
                  </Text>
                  <Text style={styles.equipeMetricLabel}>Affectations</Text>
                </View>

                <View style={styles.equipeMetricDivider} />

                <View style={styles.equipeMetricItem}>
                  <Text style={[styles.equipeMetricValue, { color: '#64748B' }]} weight="bold">
                    {stats.equipeTerrain?.totalUnassigned ?? 0}
                  </Text>
                  <Text style={styles.equipeMetricLabel}>Non affectés</Text>
                </View>
              </View>
            </Card>

            {/* ── 4. Action Needed GIS Alerts Banner ── */}
            {alerts.length > 0 && (
              <View style={styles.alertsContainer}>
                {alerts.map((alert) => (
                  <Card
                    key={alert.id}
                    variant="flat"
                    style={[
                      styles.alertCard,
                      alert.severity === 'HIGH' ? styles.alertCardHigh : styles.alertCardMedium,
                    ]}
                  >
                    <View style={styles.alertHeader}>
                      <Ionicons
                        name={alert.severity === 'HIGH' ? 'warning' : 'information-circle'}
                        size={18}
                        color={alert.severity === 'HIGH' ? '#DC2626' : '#D97706'}
                      />
                      <Text
                        style={[
                          styles.alertTitle,
                          { color: alert.severity === 'HIGH' ? '#DC2626' : '#D97706' },
                        ]}
                        weight="bold"
                      >
                        Action Requise • {alert.chantierNom || alert.projetNom}
                      </Text>
                    </View>
                    <Text style={styles.alertMessage}>{alert.message}</Text>
                    {alert.chantierId && (
                      <TouchableOpacity
                        style={styles.alertActionBtn}
                        onPress={() =>
                          router.push(`/responsable/chantier/${alert.chantierId}/gis` as any)
                        }
                      >
                        <Text style={styles.alertActionText} weight="bold">
                          Configurer le GIS &rarr;
                        </Text>
                      </TouchableOpacity>
                    )}
                  </Card>
                ))}
              </View>
            )}

            {/* ── 5. Active Projects List ── */}
            <View style={styles.sectionHeaderRow}>
              <Text variant="h2" style={styles.sectionTitle}>
                Mes Projets ({projects.length})
              </Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/projects')}>
                <Text style={styles.sectionLink} weight="semibold">
                  Voir tout &rarr;
                </Text>
              </TouchableOpacity>
            </View>

            {projects.length > 0 ? (
              <View style={styles.projectsList}>
                {projects.map((p) => (
                  <Card key={p.id} variant="elevated" style={styles.projectProgressCard}>
                    <View style={styles.projectHeaderRow}>
                      <View style={{ flex: 1 }}>
                        <Text variant="h3" style={styles.projectName}>
                          {p.nom}
                        </Text>
                        <Text style={styles.projectMetaText}>
                          {p.type_projet || 'Projet'} • {p.nombre_chantiers} chantiers
                        </Text>
                      </View>
                      <View style={styles.projectStatutBadge}>
                        <Text style={styles.projectStatutText}>{p.statut}</Text>
                      </View>
                    </View>

                    <View style={styles.progressRow}>
                      <Text style={styles.progressLabel}>Avancement moyen :</Text>
                      <Text style={styles.progressValue} weight="bold">
                        {p.avancement_moyen}%
                      </Text>
                    </View>
                    <View style={styles.progressBarBg}>
                      <View
                        style={[styles.progressBarFill, { width: `${p.avancement_moyen}%` }]}
                      />
                    </View>

                    <View style={styles.projectCardFooter}>
                      <Button
                        title="Détails du projet"
                        variant="secondary"
                        size="sm"
                        onPress={() => router.push(`/responsable/projet/${p.id}` as any)}
                        style={{ flex: 1 }}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="folder-open-outline" size={32} color={Palette.textMuted} />
                <Text style={styles.emptyTitle}>Aucun projet créé</Text>
                <Text style={styles.emptySubtitle}>
                  Commencez par créer votre premier projet d'infrastructure.
                </Text>
                <Button
                  title="Créer un projet"
                  variant="primary"
                  size="sm"
                  onPress={() => router.push('/responsable/projet/create' as any)}
                  style={{ marginTop: 12 }}
                />
              </Card>
            )}

            {/* ── 6. Live Activity Stream ── */}
            <View style={styles.sectionHeaderRow}>
              <Text variant="h2" style={styles.sectionTitle}>
                Activités & Événements Récents
              </Text>
            </View>

            {observations.length > 0 || reclamations.length > 0 ? (
              <View style={styles.activityList}>
                {observations.slice(0, 5).map((obs) => (
                  <Card key={`obs_${obs.id}`} variant="flat" style={styles.activityCard}>
                    <View style={[styles.activityIconBg, { backgroundColor: '#F0FDF4' }]}>
                      <Ionicons name="eye" size={16} color="#16A34A" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityTitle} weight="semibold">
                        Relevé terrain • {obs.troncon_nom || obs.chantier_nom}
                      </Text>
                      <Text style={styles.activitySubtitle}>
                        Par {obs.agent_nom || 'Agent'} {obs.chainage ? `• PK ${obs.chainage}` : ''}
                      </Text>
                      {obs.commentaire ? (
                        <Text style={styles.activityComment} numberOfLines={1}>
                          "{obs.commentaire}"
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.activityDate}>{obs.date_heure || 'Récemment'}</Text>
                  </Card>
                ))}

                {reclamations.slice(0, 3).map((rec) => (
                  <Card key={`rec_${rec.id}`} variant="flat" style={styles.activityCard}>
                    <View style={[styles.activityIconBg, { backgroundColor: '#EFF6FF' }]}>
                      <Ionicons name="chatbox-ellipses" size={16} color="#2563EB" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityTitle} weight="semibold">
                        Réclamation • {rec.titre}
                      </Text>
                      <Text style={styles.activitySubtitle}>
                        Chantier : {rec.chantier_nom} • Client : {rec.client_nom || 'Client'}
                      </Text>
                    </View>
                    <Text style={styles.activityDate}>{rec.date_creation || 'Récemment'}</Text>
                  </Card>
                ))}
              </View>
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="time-outline" size={32} color={Palette.textMuted} />
                <Text style={styles.emptyTitle}>Aucune activité récente</Text>
                <Text style={styles.emptySubtitle}>
                  Les relevés des agents terrain s'afficheront ici en direct.
                </Text>
              </Card>
            )}
          </>
        ) : (
          /* ── STANDARD / GENERAL VIEW ── */
          <>
            <View style={styles.statsGrid}>
              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="folder" size={18} color="#2563EB" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.totalProjects}
                </Text>
                <Text style={styles.statLabel}>Projets</Text>
              </Card>

              <Card variant="flat" style={styles.statCard}>
                <View style={[styles.statIconBadge, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="construct" size={18} color="#16A34A" />
                </View>
                <Text style={styles.statValue} weight="bold">
                  {stats.totalChantiers}
                </Text>
                <Text style={styles.statLabel}>Chantiers</Text>
              </Card>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text variant="h2" style={styles.sectionTitle}>
                Chantiers ({dashboardData?.chantiers?.length || 0})
              </Text>
            </View>

            <View style={styles.projectsList}>
              {dashboardData?.chantiers?.map((ch: any) => (
                <Card key={ch.id} variant="elevated" style={styles.projectProgressCard}>
                  <Text variant="h3" style={styles.projectName}>
                    {ch.nom}
                  </Text>
                  <Text style={styles.projectMetaText}>Projet : {ch.projet_nom}</Text>
                  <Button
                    title="Consulter"
                    variant="secondary"
                    size="sm"
                    onPress={() => router.push(`/chantier/${ch.id}` as any)}
                    style={{ marginTop: 8 }}
                  />
                </Card>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* ── Global Role-Aware Sliding Drawer ── */}
      <GlobalAppDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        activeTronconId={agentAssignments[0]?.troncon_id}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  pendingBannerCard: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  pendingBannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  pendingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FDE68A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBannerTitle: {
    fontSize: 14,
    color: '#92400E',
    marginBottom: 4,
  },
  pendingBannerText: {
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  pendingBannerLink: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  pendingBannerLinkText: {
    fontSize: 12,
    color: '#92400E',
  },
  greetingTitle: {
    fontSize: 22,
    color: Palette.text,
    letterSpacing: -0.3,
  },
  greetingSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  avatarButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Palette.primary,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: Palette.primary,
    fontSize: 15,
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionBarTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  actionBarSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  operationalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  operationalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0D9488',
  },
  operationalBadgeText: {
    fontSize: 11,
    color: '#0D9488',
  },
  newProjectBtn: {
    paddingHorizontal: 12,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  statIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  statValue: {
    fontSize: 14,
    color: Palette.text,
  },
  statLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    marginTop: 1,
    textAlign: 'center',
  },
  alertsContainer: {
    gap: 8,
    marginBottom: 16,
  },
  alertCard: {
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 4,
  },
  alertCardHigh: {
    backgroundColor: '#FEF2F2',
    borderLeftColor: '#DC2626',
  },
  alertCardMedium: {
    backgroundColor: '#FFFBEB',
    borderLeftColor: '#D97706',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 12,
  },
  alertMessage: {
    fontSize: 12,
    color: Palette.text,
    lineHeight: 16,
  },
  alertActionBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  alertActionText: {
    fontSize: 11,
    color: Palette.primary,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  sectionLink: {
    fontSize: 12,
    color: Palette.primary,
  },
  projectsList: {
    gap: 12,
    marginBottom: 20,
  },
  projectProgressCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  projectHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  projectName: {
    fontSize: 14,
    color: Palette.text,
  },
  projectMetaText: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  projectStatutBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  projectStatutText: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  progressValue: {
    fontSize: 11,
    color: Palette.text,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Palette.primary,
    borderRadius: 3,
  },
  projectCardFooter: {
    flexDirection: 'row',
    gap: 8,
  },
  activityList: {
    gap: 8,
    marginBottom: 20,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  activityIconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityTitle: {
    fontSize: 12,
    color: Palette.text,
  },
  activitySubtitle: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  activityComment: {
    fontSize: 11,
    color: Palette.text,
    fontStyle: 'italic',
    marginTop: 2,
  },
  activityDate: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  emptyCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  /* ── Agent Assignments Styles ── */
  assignmentsList: {
    gap: 12,
    marginBottom: 20,
  },
  assignmentCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  assignmentCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  projectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    flex: 1,
    marginRight: 8,
  },
  projectPillText: {
    fontSize: 11,
    color: Palette.primary,
  },
  tronconStatutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  tronconStatutDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tronconStatutText: {
    fontSize: 10,
  },
  assignmentCardBody: {
    gap: 4,
  },
  assignmentTronconNom: {
    fontSize: 15,
    color: Palette.text,
  },
  assignmentChantierMeta: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  assignmentPkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  pkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pkBadgeText: {
    fontSize: 11,
    color: Palette.primaryDark,
  },
  lengthText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  assignmentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  assignmentResponsableText: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  assignmentDateText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  emptyAssignmentsCard: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyAssignmentsTitle: {
    fontSize: 15,
    color: Palette.text,
    marginBottom: 6,
  },
  emptyAssignmentsDesc: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* Équipe terrain Dashboard Card */
  equipeCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: Palette.primary,
  },
  equipeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 8,
  },
  equipeHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  equipeIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipeCardTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  equipeCardSub: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  gererEquipeBtn: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.2)',
  },
  gererEquipeBtnText: {
    fontSize: 11,
    color: Palette.primary,
  },
  equipeMetricsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  equipeMetricItem: {
    flex: 1,
    alignItems: 'center',
  },
  equipeMetricValue: {
    fontSize: 16,
    color: Palette.text,
    marginBottom: 2,
  },
  equipeMetricLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  equipeMetricDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
});
