import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { api, ProjectDetails, ProjectChantier } from '@/services/api';

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

export default function ProjectDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, user, isLoading: isAuthLoading } = useAuth();

  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectDetails = useCallback(async (isRefresh = false) => {
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
      if (__DEV__) console.log(`[ProjectDetails] Fetching project #${id}...`);
      const data = await api.getProjectDetails(token, id);
      setProject(data.project);
      if (__DEV__) console.log('[ProjectDetails] Project loaded:', data.project.nom);
    } catch (err: any) {
      console.error('[ProjectDetails] Error fetching project details:', err.message);
      setError(err.message || 'Impossible de charger les détails du projet.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchProjectDetails();
    }
  }, [fetchProjectDetails, isAuthLoading]);

  const handleOpenReport = () => {
    if (!project) return;
    router.push({
      pathname: '/project/report-viewer',
      params: { id: String(project.id), title: project.nom },
    });
  };

  const handleSelectChantier = (chantier: ProjectChantier) => {
    const isResponsable =
      user?.role_nom === 'Responsable' || user?.role_id === 2 ||
      user?.role_nom === 'Administrateur' || user?.role_id === 1;

    if (isResponsable) {
      router.push(`/responsable/chantier/${chantier.id}` as any);
    } else {
      router.push({
        pathname: '/chantier/[id]',
        params: { id: String(chantier.id) },
      });
    }
  };

  const handleOpenMap = () => {
    if (!project) return;
    const projectChantiers = project.chantiers || [];
    const firstChantierWithGis =
      projectChantiers.find((c: any) => c.gis_status !== 'NON_CONFIGURE') ||
      projectChantiers[0];
    router.push({
      pathname: '/(tabs)/map',
      params: {
        projectId: String(project.id),
        chantierId: firstChantierWithGis ? String(firstChantierWithGis.id) : undefined,
      },
    });
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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
            Chargement des détails du projet...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !project) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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
              {error || 'Projet introuvable.'}
            </Text>
            <TouchableOpacity onPress={() => fetchProjectDetails()} style={styles.retryButton}>
              <Text style={styles.retryButtonText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const statusTheme = getStatusTheme(project.statut);
  const ind = project.indicateurs;
  const responsable = project.chantiers?.[0]?.responsable_nom;

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
            Projets
          </Text>
        </TouchableOpacity>

        <Text variant="subtitle" style={styles.screenHeaderTitle} numberOfLines={1}>
          Détails du projet
        </Text>

        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchProjectDetails(true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 2. Project Identity Card ── */}
        <Card
          variant="elevated"
          style={[styles.identityCard, { borderLeftColor: statusTheme.dotColor }]}
        >
          <View style={styles.identityHeader}>
            <Text variant="h1" style={styles.projectTitle}>
              {project.nom}
            </Text>

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
                {project.statut || 'En cours'}
              </Text>
            </View>
          </View>

          {Boolean(project.description) && (
            <Text variant="default" style={styles.projectDescription}>
              {project.description}
            </Text>
          )}

          <View style={styles.identityMetaDivider} />

          {/* Dates & Responsable */}
          <View style={styles.identityMetaList}>
            {(project.date_debut || project.date_fin) && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrapper}>
                  <Ionicons name="calendar-outline" size={15} color={Palette.primary} />
                </View>
                <View>
                  <Text style={styles.metaLabel}>Période prévisionnelle</Text>
                  <Text style={styles.metaValue} weight="semibold">
                    {formatFrenchDate(project.date_debut)} → {formatFrenchDate(project.date_fin)}
                  </Text>
                </View>
              </View>
            )}

            {Boolean(responsable) && (
              <View style={styles.metaRow}>
                <View style={styles.metaIconWrapper}>
                  <Ionicons name="person-outline" size={15} color={Palette.secondary} />
                </View>
                <View>
                  <Text style={styles.metaLabel}>Responsable</Text>
                  <Text style={styles.metaValue} weight="semibold">
                    {responsable}
                  </Text>
                </View>
              </View>
            )}
          </View>
        </Card>

        {/* ── 3. Indicateurs Globaux ── */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="h2" style={styles.sectionTitle}>
            Indicateurs globaux
          </Text>
          {Boolean(ind.derniereMiseAJour) && (
            <Text style={styles.lastUpdateText}>
              Mis à jour : {formatFrenchDate(ind.derniereMiseAJour)}
            </Text>
          )}
        </View>

        <View style={styles.indicatorsGrid}>
          {/* Chantiers indicator */}
          <Pressable
            style={({ pressed }) => [
              styles.indicatorCard,
              pressed && styles.indicatorChantiersPressed,
            ]}
          >
            <View
              style={[
                styles.indicatorIconWrapper,
                { backgroundColor: 'rgba(23, 107, 91, 0.12)' },
              ]}
            >
              <Ionicons name="business-outline" size={20} color={Palette.primary} />
            </View>
            <Text style={[styles.indicatorValue, { color: Palette.primary }]} weight="bold">
              {ind.nombreChantiers}
            </Text>
            <Text style={styles.indicatorLabel}>Chantiers</Text>
          </Pressable>

          {/* Avancement global indicator */}
          <Pressable
            style={({ pressed }) => [
              styles.indicatorCard,
              pressed && styles.indicatorAvancementPressed,
            ]}
          >
            <View
              style={[
                styles.indicatorIconWrapper,
                { backgroundColor: 'rgba(37, 99, 235, 0.12)' },
              ]}
            >
              <Ionicons name="trending-up-outline" size={20} color="#1D4ED8" />
            </View>
            <Text style={[styles.indicatorValue, { color: '#1D4ED8' }]} weight="bold">
              {ind.avancementGlobal}%
            </Text>
            <Text style={styles.indicatorLabel}>Avancement</Text>
          </Pressable>

          {/* Rapport PDF indicator (cliquable pour ouvrir la visionneuse intégrée) */}
          <Pressable
            style={({ pressed }) => [
              styles.indicatorCard,
              pressed && styles.indicatorRapportPressed,
            ]}
            onPress={handleOpenReport}
          >
            <View
              style={[
                styles.indicatorIconWrapper,
                { backgroundColor: 'rgba(126, 34, 206, 0.12)' },
              ]}
            >
              <Ionicons name="document-text-outline" size={20} color="#7E22CE" />
            </View>
            <Text
              style={[styles.indicatorValue, { color: '#7E22CE', fontSize: 13 }]}
              weight="bold"
            >
              PDF
            </Text>
            <Text style={styles.indicatorLabel}>Rapport</Text>
          </Pressable>

          {/* Réclamations indicator */}
          <Pressable
            style={({ pressed }) => [
              styles.indicatorCard,
              pressed && styles.indicatorReclamationsPressed,
            ]}
          >
            <View
              style={[
                styles.indicatorIconWrapper,
                { backgroundColor: 'rgba(194, 65, 12, 0.12)' },
              ]}
            >
              <Ionicons name="alert-circle-outline" size={20} color="#C2410C" />
            </View>
            <Text style={[styles.indicatorValue, { color: '#C2410C' }]} weight="bold">
              {ind.reclamations}
            </Text>
            <Text style={styles.indicatorLabel}>Réclamations</Text>
          </Pressable>
        </View>

        {/* ── 4. Chantiers du projet ── */}
        <View style={[styles.sectionHeaderRow, { marginTop: 24, justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text variant="h2" style={styles.sectionTitle}>
            Chantiers du projet ({project.chantiers?.length || 0})
          </Text>
          {(user?.role_nom === 'Responsable' || user?.role_id === 2 || user?.role_nom === 'Administrateur' || user?.role_id === 1) && (
            <TouchableOpacity
              style={styles.addChantierBtn}
              onPress={() => router.push(`/responsable/projet/${project.id}/chantier/create` as any)}
            >
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <Text style={styles.addChantierBtnText} weight="bold">
                + Chantier
              </Text>
            </TouchableOpacity>
          )}
        </View>


        <View style={styles.chantiersList}>
          {(project.chantiers || []).map((chantier) => {
            const chTheme = getStatusTheme(chantier.statut);
            const avancementPct = chantier.avancement || 0;

            return (
              <TouchableOpacity
                key={chantier.id}
                activeOpacity={0.7}
                onPress={() => handleSelectChantier(chantier)}
              >
                <Card variant="elevated" style={styles.chantierCard}>
                  <View style={styles.chantierCardTop}>
                    <View style={styles.chantierInfo}>
                      <Text variant="h3" style={styles.chantierName}>
                        {chantier.nom}
                      </Text>

                      <View
                        style={[
                          styles.statusBadge,
                          {
                            backgroundColor: chTheme.bg,
                            borderColor: chTheme.border,
                            marginTop: 4,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.statusBadgeDot,
                            { backgroundColor: chTheme.dotColor },
                          ]}
                        />
                        <Text
                          style={[styles.statusBadgeText, { color: chTheme.color }]}
                          weight="bold"
                        >
                          {chantier.statut || 'En cours'}
                        </Text>
                      </View>
                    </View>

                    {/* Progress percentage on top right */}
                    <View style={styles.chantierProgressBadge}>
                      <Text style={styles.chantierProgressText} weight="bold">
                        {avancementPct}%
                      </Text>
                    </View>
                  </View>

                  {/* Progress bar */}
                  <View style={styles.progressBarBackground}>
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

                  {/* Chantier meta info */}
                  <View style={styles.chantierCardBottom}>
                    {Boolean(chantier.surface) && (
                      <View style={styles.chantierMetaItem}>
                        <Ionicons name="cube-outline" size={13} color={Palette.textMuted} />
                        <Text style={styles.chantierMetaText}>
                          {chantier.surface} m²
                        </Text>
                      </View>
                    )}

                    <View style={styles.viewChantierLink}>
                      <Text style={styles.viewChantierText} weight="semibold">
                        Détails chantier
                      </Text>
                      <Ionicons name="chevron-forward" size={14} color={Palette.primary} />
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── 5. Voir sur la carte Button ── */}
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
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
    backgroundColor: '#FFFFFF',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonText: {
    fontSize: 15,
    color: Palette.primary,
  },
  screenHeaderTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },

  // ── Project Identity ──
  identityCard: {
    padding: 20,
    borderLeftWidth: 4,
    backgroundColor: '#FFFFFF',
    marginBottom: 20,
  },
  identityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  projectTitle: {
    flex: 1,
    fontSize: 21,
    color: Palette.text,
    lineHeight: 27,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  statusBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  projectDescription: {
    fontSize: 14,
    color: Palette.textMuted,
    lineHeight: 21,
    marginBottom: 12,
  },
  identityMetaDivider: {
    height: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    marginVertical: 12,
  },
  identityMetaList: {
    gap: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  metaIconWrapper: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  metaValue: {
    fontSize: 13,
    color: Palette.text,
  },

  // ── Indicators Section ──
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    color: Palette.text,
    letterSpacing: -0.2,
  },
  lastUpdateText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  indicatorsGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  indicatorCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  indicatorChantiersPressed: {
    borderColor: 'rgba(23, 107, 91, 0.5)',
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    transform: [{ scale: 0.96 }],
  },
  indicatorAvancementPressed: {
    borderColor: 'rgba(37, 99, 235, 0.5)',
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    transform: [{ scale: 0.96 }],
  },
  indicatorRapportPressed: {
    borderColor: 'rgba(126, 34, 206, 0.5)',
    backgroundColor: 'rgba(126, 34, 206, 0.14)',
    transform: [{ scale: 0.96 }],
  },
  indicatorReclamationsPressed: {
    borderColor: 'rgba(194, 65, 12, 0.5)',
    backgroundColor: 'rgba(194, 65, 12, 0.12)',
    transform: [{ scale: 0.96 }],
  },
  indicatorIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  indicatorValue: {
    fontSize: 16,
    marginBottom: 2,
  },
  indicatorLabel: {
    fontSize: 10.5,
    color: Palette.textMuted,
    textAlign: 'center',
  },

  // ── Chantiers List ──
  chantiersList: {
    gap: 12,
    marginBottom: 24,
  },
  chantierCard: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
  },
  chantierCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  chantierInfo: {
    flex: 1,
    paddingRight: 10,
  },
  chantierName: {
    fontSize: 15,
    color: Palette.text,
    lineHeight: 20,
    marginBottom: 4,
  },
  chantierProgressBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  chantierProgressText: {
    fontSize: 13,
    color: Palette.primary,
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  chantierCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  chantierMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chantierMetaText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  viewChantierLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
  },
  viewChantierText: {
    fontSize: 13,
    color: Palette.primary,
  },

  // ── Map Action Button ──
  addChantierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.primary,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addChantierBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  mapButton: {

    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  mapButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
  },

  // ── States ──
  centerStateContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  stateCard: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
  },
  stateText: {
    fontSize: 14,
    marginTop: 8,
  },
  stateErrorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Palette.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
