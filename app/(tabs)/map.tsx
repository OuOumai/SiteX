import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { InteractiveGisMap, GisTronconSegment } from '@/components/gis/InteractiveGisMap';
import { MapDesktopPanel } from '@/components/map/MapDesktopPanel';
import { MapMonitoringSheet } from '@/components/map/MapMonitoringSheet';
import { ProjectMapSearch } from '@/components/map/ProjectMapSearch';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  AgentAssignmentItem,
  ReferenceAlignment,
  ResponsableChantierItem,
  ResponsableDashboardData,
  ResponsableProjectItem,
  TronconItem,
} from '@/services/api';

function chooseDefaultChantier(chantiers: ResponsableChantierItem[]) {
  return (
    chantiers.find((item) => item.gis_status === 'PRET_POUR_SUIVI') ||
    chantiers.find((item) => item.gis_status === 'ALIGNEMENT_IMPORTE') ||
    chantiers[0] ||
    null
  );
}

export default function MapScreen() {
  const params = useLocalSearchParams<{ chantierId?: string; tronconId?: string; projectId?: string }>();
  const router = useRouter();
  const { token, user } = useAuth();
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 900;

  const [dashboardData, setDashboardData] = useState<ResponsableDashboardData | null>(null);
  const [agentAssignments, setAgentAssignments] = useState<AgentAssignmentItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedChantierId, setSelectedChantierId] = useState<number | null>(null);
  const [activeReference, setActiveReference] = useState<ReferenceAlignment | null>(null);
  const [activeTroncons, setActiveTroncons] = useState<TronconItem[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isLoadingGis, setIsLoadingGis] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  // Helper to apply navigation params to project/chantier selection
  const applyRequestedSelection = useCallback((data: ResponsableDashboardData) => {
    const requestedChantierId = params.chantierId ? Number(params.chantierId) : null;
    const requestedProjectId = params.projectId ? Number(params.projectId) : null;

    // 1. Explicit Chantier ID requested
    if (requestedChantierId) {
      const requestedChantier = data.chantiers.find((item) => item.id === requestedChantierId);
      if (requestedChantier) {
        setSelectedProjectId(requestedChantier.projet_id);
        setSelectedChantierId(requestedChantier.id);
        return;
      }
    }

    // 2. Explicit Project ID requested
    if (requestedProjectId) {
      const requestedProject = data.projects.find((item) => item.id === requestedProjectId);
      if (requestedProject) {
        const projectChantiers = data.chantiers.filter(
          (chantier) => chantier.projet_id === requestedProject.id
        );
        const targetChantier = chooseDefaultChantier(projectChantiers);
        setSelectedProjectId(requestedProject.id);
        setSelectedChantierId(targetChantier?.id || null);
        return;
      }
    }

    // 3. Fallback: only if no specific project or chantier was requested
    const firstProjectWithGis = data.projects.find((project) =>
      data.chantiers.some(
        (chantier) =>
          chantier.projet_id === project.id && chantier.gis_status !== 'NON_CONFIGURE'
      )
    );
    const initialProject = firstProjectWithGis || data.projects[0] || null;
    const projectChantiers = initialProject
      ? data.chantiers.filter((chantier) => chantier.projet_id === initialProject.id)
      : [];
    const initialChantier = chooseDefaultChantier(projectChantiers);

    setSelectedProjectId(initialProject?.id || null);
    setSelectedChantierId(initialChantier?.id || null);
  }, [params.chantierId, params.projectId]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (!token) return;
      setIsLoadingDashboard(true);
      setLoadError(null);

      try {
        let data: ResponsableDashboardData;
        const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
        if (isAgent) {
          const agentData = await api.getAgentDashboard(token);
          setAgentAssignments(agentData.affectations);
          const projectMap = new Map<number, ResponsableProjectItem>();
          const chantierMap = new Map<number, ResponsableChantierItem>();
          agentData.affectations.forEach((assignment) => {
            if (!projectMap.has(assignment.projet_id)) {
              projectMap.set(assignment.projet_id, {
                id: assignment.projet_id,
                nom: assignment.projet_nom,
                type_projet: assignment.type_projet,
                nombre_chantiers: 0,
                avancement_moyen: assignment.troncon_avancement || 0,
              });
            }
            if (!chantierMap.has(assignment.chantier_id)) {
              chantierMap.set(assignment.chantier_id, {
                id: assignment.chantier_id,
                projet_id: assignment.projet_id,
                nom: assignment.chantier_nom,
                projet_nom: assignment.projet_nom,
                projet_type: assignment.type_projet,
                statut: assignment.troncon_statut,
                avancement: assignment.troncon_avancement || 0,
                nombre_troncons: 1,
                gis_status: 'PRET_POUR_SUIVI',
              });
              const project = projectMap.get(assignment.projet_id)!;
              project.nombre_chantiers += 1;
            }
          });
          data = {
            stats: {
              totalProjects: projectMap.size,
              totalChantiers: chantierMap.size,
              chantiersPrets: chantierMap.size,
              avancementMoyen: agentData.stats.avancementMoyen,
              totalObservations: 0,
              totalReclamations: 0,
              equipeTerrain: { totalAvailable: 0, totalAssigned: agentData.stats.totalAssignments, totalAssignments: agentData.stats.totalAssignments, totalUnassigned: 0 },
            },
            projects: Array.from(projectMap.values()),
            chantiers: Array.from(chantierMap.values()),
            observations: [],
            reclamations: [],
          };
        } else {
          setAgentAssignments([]);
          data = await api.getResponsableDashboard(token);
        }
        if (!active) return;
        setDashboardData(data);
        applyRequestedSelection(data);
      } catch (error: any) {
        if (active) setLoadError(error.message || 'Impossible de charger les projets.');
      } finally {
        if (active) setIsLoadingDashboard(false);
      }
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, [token, user?.role_id, user?.role_nom, applyRequestedSelection]);

  // React to URL search parameters changes when dashboardData is already loaded
  useEffect(() => {
    if (dashboardData) {
      applyRequestedSelection(dashboardData);
    }
  }, [dashboardData, applyRequestedSelection]);

  useEffect(() => {
    let active = true;

    async function loadSelectedChantierLayers() {
      if (!token || !selectedChantierId) {
        setActiveReference(null);
        setActiveTroncons([]);
        return;
      }

      setIsLoadingGis(true);
      setActiveReference(null);
      setActiveTroncons([]);

      const [referenceResult, tronconsResult] = await Promise.allSettled([
        api.getReferenceAlignment(token, selectedChantierId),
        api.getChantierTroncons(token, selectedChantierId),
      ]);

      if (!active) return;

      setActiveReference(
        referenceResult.status === 'fulfilled'
          ? referenceResult.value.reference_alignment
          : null
      );
      setActiveTroncons(
        tronconsResult.status === 'fulfilled' ? tronconsResult.value.troncons || [] : []
      );
      setIsLoadingGis(false);
    }

    loadSelectedChantierLayers();
    return () => {
      active = false;
    };
  }, [token, selectedChantierId]);

  const projects = useMemo(() => dashboardData?.projects || [], [dashboardData]);
  const allChantiers = useMemo(() => dashboardData?.chantiers || [], [dashboardData]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const projectChantiers = useMemo(
    () => allChantiers.filter((chantier) => chantier.projet_id === selectedProjectId),
    [allChantiers, selectedProjectId]
  );
  const selectedChantier =
    allChantiers.find((chantier) => chantier.id === selectedChantierId) || null;

  const handleSelectProject = useCallback(
    (project: ResponsableProjectItem) => {
      const relatedChantiers = allChantiers.filter(
        (chantier) => chantier.projet_id === project.id
      );
      const defaultChantier = chooseDefaultChantier(relatedChantiers);
      setSelectedProjectId(project.id);
      setSelectedChantierId(defaultChantier?.id || null);
      setIsSheetExpanded(false);
    },
    [allChantiers]
  );

  const handleSelectChantier = useCallback((chantier: ResponsableChantierItem) => {
    setSelectedChantierId(chantier.id);
    if (!isDesktop) setIsSheetExpanded(false);
  }, [isDesktop]);

  const handleOpenGis = useCallback((chantier: ResponsableChantierItem) => {
    const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
    if (isAgent) {
      const assigned = agentAssignments.find((item) => item.chantier_id === chantier.id);
      if (assigned) router.push(`/agent/troncon/${assigned.troncon_id}` as never);
      return;
    }
    router.push(`/responsable/chantier/${chantier.id}/gis` as never);
  }, [router, user?.role_id, user?.role_nom, agentAssignments]);

  const mapTroncons: GisTronconSegment[] = useMemo(
    () =>
      activeTroncons.map((troncon, index) => ({
        id: troncon.id || index + 1,
        nom: troncon.nom,
        pk_debut: troncon.pk_debut,
        pk_fin: troncon.pk_fin,
        statut: troncon.statut,
        length_km: troncon.length_km,
        geometry: troncon.geometry,
      })),
    [activeTroncons]
  );

  const mobileSheetHeight = Math.min(height * 0.62, 540);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.workspace}>
        {isDesktop && (
          <MapDesktopPanel
            projects={projects}
            project={selectedProject}
            chantier={selectedChantier}
            chantiers={projectChantiers}
            onSelectProject={handleSelectProject}
            onSelectChantier={handleSelectChantier}
            onOpenGis={handleOpenGis}
          />
        )}

        <View style={styles.mapArea}>
          <InteractiveGisMap
            referenceGeometry={activeReference?.geometry}
            troncons={mapTroncons.length > 0 ? mapTroncons : null}
            selectedTronconId={params.tronconId}
            height="100%"
            fitPaddingBottom={!isDesktop ? (isSheetExpanded ? mobileSheetHeight : 145) : 35}
            optimizePkLabels
          />

          {!isDesktop && (
            <View style={styles.mobileSearch}>
              <ProjectMapSearch
                projects={projects}
                selectedProjectId={selectedProjectId}
                onSelectProject={handleSelectProject}
              />
            </View>
          )}

          {isLoadingGis && (
            <View style={styles.layerLoading} pointerEvents="none">
              <View style={styles.loadingPill}>
                <ActivityIndicator size="small" color={Palette.primary} />
                <Text style={styles.loadingText}>Chargement du chantier…</Text>
              </View>
            </View>
          )}

          {!isLoadingGis && selectedChantier && !activeReference && (
            <View style={styles.noGisNotice} pointerEvents="none">
              <Ionicons name="map-outline" size={17} color="#D97706" />
              <Text style={styles.noGisText}>Ce chantier n&apos;a pas encore de tracé GIS.</Text>
            </View>
          )}

          {loadError && (
            <View style={styles.errorNotice}>
              <Ionicons name="cloud-offline-outline" size={18} color="#B91C1C" />
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          )}

          {!isDesktop && (
            <MapMonitoringSheet
              project={selectedProject}
              chantier={selectedChantier}
              chantiers={projectChantiers}
              expanded={isSheetExpanded}
              onToggle={() => setIsSheetExpanded((value) => !value)}
              onSelectChantier={handleSelectChantier}
              onOpenGis={handleOpenGis}
            />
          )}
        </View>
      </View>

      {isLoadingDashboard && (
        <View style={styles.initialLoading}>
          <View style={styles.initialLoadingCard}>
            <View style={styles.loadingIcon}><Ionicons name="map" size={24} color="#FFFFFF" /></View>
            <ActivityIndicator size="small" color={Palette.primary} />
            <Text style={styles.initialLoadingText}>Préparation de la carte SiteX…</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E2E8F0' },
  workspace: { flex: 1, flexDirection: 'row' },
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#DCE7E3' },
  mobileSearch: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    maxWidth: 400,
    alignSelf: 'center',
    zIndex: 25,
  },
  layerLoading: { position: 'absolute', top: 124, left: 0, right: 0, alignItems: 'center', zIndex: 12 },
  loadingPill: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.94)', shadowColor: '#0F172A', shadowOpacity: 0.12, shadowRadius: 8, elevation: 4 },
  loadingText: { fontSize: 11, color: Palette.text },
  noGisNotice: { position: 'absolute', top: 124, left: 16, right: 16, zIndex: 10, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: 'rgba(255, 251, 235, 0.94)', borderWidth: 1, borderColor: '#FDE68A' },
  noGisText: { color: '#92400E', fontSize: 11 },
  errorNotice: { position: 'absolute', top: 124, left: 16, right: 16, zIndex: 26, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA' },
  errorText: { flex: 1, color: '#991B1B', fontSize: 11 },
  initialLoading: { ...StyleSheet.absoluteFillObject, zIndex: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(240,247,245,0.82)' },
  initialLoadingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16, backgroundColor: '#FFFFFF', shadowColor: '#0F172A', shadowOpacity: 0.16, shadowRadius: 16, elevation: 8 },
  loadingIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: Palette.primary, alignItems: 'center', justifyContent: 'center' },
  initialLoadingText: { fontSize: 12, color: Palette.text },
});
