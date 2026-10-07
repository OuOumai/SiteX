import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, ProjectDetails, ProjectChantier } from '@/services/api';
import { getProjectCover } from '@/constants/projectCover';
import { ProjectCoverModal } from '@/components/dashboard/ProjectCoverModal';
import { SiteXHeader } from '@/components/navigation/SiteXHeader';

export default function ProjectDetailResponsableScreen() {
  const { projectId, source } = useLocalSearchParams<{
    projectId: string;
    source?: string;
  }>();
  const router = useRouter();
  const { token } = useAuth();
  const isOpenedFromDashboard = source === 'dashboard';

  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [coverModalVisible, setCoverModalVisible] = useState(false);

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !projectId) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const res = await api.getProjectDetails(token, projectId);
      setProject(res.project);
    } catch (err: any) {
      console.error('Erreur chargement projet:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  if (isLoading && !project) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement du projet...</Text>
      </SafeAreaView>
    );
  }

  const chantiers = project?.chantiers || [];
  const globalProgress = project?.indicateurs?.avancementGlobal || 0;
  const cover = project
    ? getProjectCover({
        cover_image_url: project.cover_image_url,
        type_projet: project.type_projet,
        nom: project.nom,
        description: project.description,
      })
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── Global SiteX Contextual Header with Back Navigation ── */}
      <SiteXHeader showBack title={project?.nom || 'Détails du projet'} />

      {/* Screen Title & Badges Banner */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.typeBadgeRow}>
            {project?.type_projet ? (
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{project.type_projet}</Text>
              </View>
            ) : null}
            <Text style={styles.statutBadgeText}>Statut : {project?.statut || 'En cours'}</Text>
          </View>
          <Text variant="h1" style={styles.headerTitle}>
            {project?.nom}
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
        {/* Project Cover Banner */}
        {cover && (
          <View style={styles.coverBannerContainer}>
            <Image source={cover.source} style={styles.coverBannerImage} resizeMode="cover" />
            <View style={styles.coverBannerOverlay} />
            <TouchableOpacity
              style={styles.changeCoverBtn}
              onPress={() => setCoverModalVisible(true)}
              activeOpacity={0.8}
              accessibilityLabel="Modifier la couverture du projet"
            >
              <Ionicons name="camera" size={15} color="#FFFFFF" />
              <Text style={styles.changeCoverBtnText} weight="bold">
                Modifier la couverture
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Project Summary Card with Progress */}
        <Card variant="elevated" style={styles.summaryCard}>
          <Text style={styles.sectionLabel}>Avancement Global du Projet</Text>
          <View style={styles.progressBarRow}>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.min(100, Math.max(0, globalProgress))}%`,
                    backgroundColor:
                      globalProgress >= 80
                        ? '#16A34A'
                        : globalProgress >= 40
                        ? Palette.primary
                        : '#F4A261',
                  },
                ]}
              />
            </View>
            <Text style={styles.progressPercent} weight="bold">
              {globalProgress}%
            </Text>
          </View>

          {project?.description ? (
            <Text style={styles.descriptionText}>{project.description}</Text>
          ) : null}

          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Chantiers / Lots</Text>
              <Text style={styles.metaValue} weight="bold">
                {chantiers.length}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Date de Début</Text>
              <Text style={styles.metaValue} weight="bold">
                {project?.date_debut || 'Non définie'}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Fin Prévue</Text>
              <Text style={styles.metaValue} weight="bold">
                {project?.date_fin || 'Non définie'}
              </Text>
            </View>
          </View>
        </Card>


        {/* Project-level Map Visualizer Button */}
        <TouchableOpacity
          style={styles.mapButton}
          activeOpacity={0.85}
          onPress={() => {
            const firstChantierWithGis =
              chantiers.find((c: ProjectChantier) => c.gis_status !== 'NON_CONFIGURE') ||
              chantiers[0];
            router.push({
              pathname: '/(tabs)/map',
              params: {
                projectId: String(projectId),
                chantierId: firstChantierWithGis ? String(firstChantierWithGis.id) : undefined,
              },
            } as any);
          }}
        >
          <Ionicons name="map-outline" size={18} color="#FFFFFF" />
          <Text style={styles.mapButtonText} weight="bold">
            Visualiser le projet sur la carte
          </Text>
        </TouchableOpacity>

        {/* Chantiers List */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="h2" style={styles.sectionTitle}>
            Chantiers & Lots Associés ({chantiers.length})
          </Text>
          {!isOpenedFromDashboard && (
            <Button
              title="+ Nouveau Lot"
              variant="secondary"
              size="sm"
              onPress={() => router.push(`/responsable/projet/${projectId}/chantier/create` as any)}
            />
          )}
        </View>

        {chantiers.length > 0 ? (
          <View style={styles.chantiersList}>
            {chantiers.map((ch: ProjectChantier) => {
              const isGisReady = ch.gis_status === 'PRET_POUR_SUIVI';
              const hasAlignment = ch.gis_status === 'ALIGNEMENT_IMPORTE';

              return (
                <Card
                  key={ch.id}
                  variant="elevated"
                  style={[
                    styles.chantierCard,
                    !isGisReady && styles.chantierCardUnconfigured,
                  ]}
                >
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => {
                      if (!isGisReady) {
                        router.push(`/responsable/chantier/${ch.id}/gis?projectId=${projectId}` as any);
                      } else {
                        router.push(`/responsable/chantier/${ch.id}` as any);
                      }
                    }}
                  >
                    <View style={styles.chantierHeader}>
                      <View style={{ flex: 1 }}>
                        <Text variant="h3" style={styles.chantierTitle}>
                          {ch.nom}
                        </Text>
                        <Text style={styles.chantierSubtitle}>
                          Responsable : {ch.responsable_nom || 'Responsable'}
                        </Text>
                      </View>

                      {/* Status Badge */}
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
                          name={
                            isGisReady
                              ? 'checkmark-circle'
                              : hasAlignment
                              ? 'git-branch'
                              : 'ellipse-outline'
                          }
                          size={13}
                          color={
                            isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706'
                          }
                        />
                        <Text
                          style={[
                            styles.gisBadgeText,
                            {
                              color: isGisReady
                                ? '#16A34A'
                                : hasAlignment
                                ? '#2563EB'
                                : '#D97706',
                            },
                          ]}
                          weight="semibold"
                        >
                          {isGisReady
                            ? 'Configuré'
                            : hasAlignment
                            ? 'Alignement prêt'
                            : 'À configurer'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.chantierMetaRow}>
                      <View style={styles.metaBadge}>
                        <Ionicons name="speedometer-outline" size={13} color={Palette.primary} />
                        <Text style={styles.metaBadgeText}>{ch.avancement || 0}%</Text>
                      </View>

                      {ch.length_km ? (
                        <View style={styles.metaBadge}>
                          <Ionicons name="git-network-outline" size={13} color="#0284C7" />
                          <Text style={styles.metaBadgeText}>
                            {ch.length_km} km ({ch.nombre_troncons || 0} tronçons)
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.metaBadge}>
                          <Ionicons name="git-network-outline" size={13} color={Palette.textMuted} />
                          <Text style={styles.metaBadgeText}>0 tronçon</Text>
                        </View>
                      )}

                      {ch.surface_reference ? (
                        <View style={styles.metaBadge}>
                          <Ionicons name="cube-outline" size={13} color={Palette.textMuted} />
                          <Text style={styles.metaBadgeText}>Réf: {ch.surface_reference} m²</Text>
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>

                  <View style={styles.chantierActions}>
                    {!isGisReady ? (
                      <>
                        <Button
                          title="⚙️ Configurer le SIG →"
                          variant="primary"
                          size="sm"
                          onPress={() =>
                            router.push(
                              `/responsable/chantier/${ch.id}/gis?projectId=${projectId}` as any
                            )
                          }
                          style={{ flex: 1 }}
                        />
                        <Button
                          title="Détails"
                          variant="secondary"
                          size="sm"
                          onPress={() => router.push(`/responsable/chantier/${ch.id}` as any)}
                        />
                      </>
                    ) : (
                      <>
                        <Button
                          title="Détails →"
                          variant="primary"
                          size="sm"
                          onPress={() => router.push(`/responsable/chantier/${ch.id}` as any)}
                        />

                        <Button
                          title="🗺️ Carte"
                          variant="secondary"
                          size="sm"
                          onPress={() =>
                            router.push({
                              pathname: '/(tabs)/map',
                              params: {
                                projectId: String(projectId),
                                chantierId: String(ch.id),
                              },
                            } as any)
                          }
                        />
                        {!isOpenedFromDashboard && (
                          <Button
                            title="⚙️ Reconfigurer"
                            variant="secondary"
                            size="sm"
                            onPress={() =>
                              router.push(
                                `/responsable/chantier/${ch.id}/gis?projectId=${projectId}` as any
                              )
                            }
                          />
                        )}
                      </>
                    )}
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyCard}>
            <Ionicons name="construct-outline" size={40} color={Palette.textMuted} />
            <Text style={styles.emptyTitle}>Aucun chantier défini</Text>
            <Text style={styles.emptySubtitle}>
              Ajoutez votre premier chantier ou utilisez la configuration spatiale pour découper le tracé.
            </Text>
          </Card>
        )}
      </ScrollView>

      <ProjectCoverModal
        visible={coverModalVisible}
        onClose={() => setCoverModalVisible(false)}
        project={
          project
            ? {
                id: Number(project.id),
                nom: project.nom,
                description: project.description,
                type_projet: project.type_projet,
                cover_image_url: project.cover_image_url,
                statut: project.statut,
                nombre_chantiers: chantiers.length,
                avancement_moyen: globalProgress,
              }
            : null
        }
        onCoverUpdated={() => fetchDetails(true)}
      />


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
  typeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  typeBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  typeBadgeText: {
    fontSize: 10,
    color: '#2563EB',
    fontWeight: 'bold',
  },
  statutBadgeText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  headerTitle: {
    fontSize: 20,
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
    marginBottom: 12,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginBottom: 20,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  mapButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  sectionLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  progressBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  progressBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  progressPercent: {
    fontSize: 14,
    color: Palette.text,
    minWidth: 40,
    textAlign: 'right',
  },
  descriptionText: {
    fontSize: 13,
    color: Palette.text,
    lineHeight: 18,
    marginBottom: 14,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  metaValue: {
    fontSize: 13,
    color: Palette.text,
    marginTop: 2,
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
  chantiersList: {
    gap: 12,
  },
  chantierCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  chantierCardUnconfigured: {
    borderLeftWidth: 3.5,
    borderLeftColor: '#D97706',
  },
  chantierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chantierTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  chantierSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
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
  chantierMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 10,
  },
  metaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  metaBadgeText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  chantierActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
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
  coverBannerContainer: {
    height: 160,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    backgroundColor: '#0F172A',
    position: 'relative',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  coverBannerImage: {
    width: '100%',
    height: '100%',
  },
  coverBannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  changeCoverBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.78)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  changeCoverBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  // Accès Rapides Styles
  quickAccessTitle: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 10,
  },
  quickAccessRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
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
  // Picker Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  modalCloseBtn: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
  },
  modalSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 6,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 10,
  },
  pickerItemNom: {
    fontSize: 14,
    color: Palette.text,
  },
  pickerItemSub: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  pickerItemBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  pickerItemBadgeText: {
    fontSize: 12,
    color: '#2563EB',
  },
});
