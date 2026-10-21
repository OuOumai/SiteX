import { kmlMetadataForSource } from '@/lib/kmlPanorama';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { InteractiveGisMap, GisChantierAlignment, GisTronconSegment } from '@/components/gis/InteractiveGisMap';
import { InteractiveGis3DMap } from '@/components/gis/InteractiveGis3DMap';
import { KmlImageModal } from '@/components/gis/KmlImageModal';
import { MapDesktopPanel } from '@/components/map/MapDesktopPanel';
import { MapMonitoringSheet } from '@/components/map/MapMonitoringSheet';
import { StationDetailModal } from '@/components/map/StationDetailModal';
import { ProjectMapSearch } from '@/components/map/ProjectMapSearch';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { SiteXHeader } from '@/components/navigation/SiteXHeader';
import {
  api,
  AgentAssignmentItem,
  ReferenceAlignment,
  ResponsableChantierItem,
  ResponsableDashboardData,
  ResponsableProjectItem,
  TronconItem,
  TerrainObservationItem,
  getMediaUrl,
  KmlGroundOverlay,
  KmlPhotoOverlay,
  KmlMetadata,
} from '@/services/api';

function chooseDefaultChantier(chantiers: ResponsableChantierItem[]) {
  return (
    chantiers.find((item) => item.gis_status === 'PRET_POUR_SUIVI') ||
    chantiers.find((item) => item.gis_status === 'ALIGNEMENT_IMPORTE') ||
    chantiers[0] ||
    null
  );
}

let lastLogged2dSig = '';
let lastLogged3dSig = '';

export default function MapScreen() {
  const params = useLocalSearchParams<{
    chantierId?: string;
    tronconId?: string;
    projectId?: string;
    observationId?: string;
  }>();
  const router = useRouter();
  const { token, user } = useAuth();
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= 900;

  const [dashboardData, setDashboardData] = useState<ResponsableDashboardData | null>(null);
  const [agentAssignments, setAgentAssignments] = useState<AgentAssignmentItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedChantierId, setSelectedChantierId] = useState<number | null>(null);
  const [selectedTronconId, setSelectedTronconId] = useState<number | null>(params.tronconId ? Number(params.tronconId) : null);
  const [activeReference, setActiveReference] = useState<ReferenceAlignment | null>(null);
  const [projectAlignments, setProjectAlignments] = useState<(GisChantierAlignment & { kml_metadata?: KmlMetadata | null; source?: string; original_filename?: string })[]>([]);
  const [activeTroncons, setActiveTroncons] = useState<TronconItem[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [isLoadingGis, setIsLoadingGis] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);
  const [stationObservations, setStationObservations] = useState<TerrainObservationItem[]>([]);
  const [selectedObservation, setSelectedObservation] = useState<TerrainObservationItem | null>(null);
  const [focusedStationId, setFocusedStationId] = useState<number | null>(null);
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('2d');
  const [selectedKmlImage, setSelectedKmlImage] = useState<KmlGroundOverlay | KmlPhotoOverlay | null>(null);
  const [isKmlImagesVisible, setIsKmlImagesVisible] = useState(false);

  useEffect(() => {
    setSelectedKmlImage(null);
  }, [selectedChantierId, selectedProjectId]);

  // Helper to apply navigation params to project/chantier selection
  const applyRequestedSelection = useCallback((data: ResponsableDashboardData) => {
    const requestedChantierId = params.chantierId ? Number(params.chantierId) : null;
    const requestedProjectId = params.projectId ? Number(params.projectId) : null;
    const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;

    // 1. Explicit Chantier ID requested
    if (requestedChantierId) {
      const requestedChantier = data.chantiers.find((item) => item.id === requestedChantierId);
      if (requestedChantier) {
        setSelectedProjectId((prev) => (prev === requestedChantier.projet_id ? prev : requestedChantier.projet_id));
        setSelectedChantierId((prev) => (prev === requestedChantier.id ? prev : requestedChantier.id));
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
        const nextChantierId = isAgent ? targetChantier?.id || null : null;
        setSelectedProjectId((prev) => (prev === requestedProject.id ? prev : requestedProject.id));
        setSelectedChantierId((prev) => (prev === nextChantierId ? prev : nextChantierId));
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
    const nextProjId = initialProject?.id || null;
    const nextChantierId = isAgent ? initialChantier?.id || null : null;

    setSelectedProjectId((prev) => (prev === nextProjId ? prev : nextProjId));
    setSelectedChantierId((prev) => (prev === nextChantierId ? prev : nextChantierId));
  }, [params.chantierId, params.projectId, user?.role_id, user?.role_nom]);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      if (!token) return;
      setIsLoadingDashboard(true);
      setLoadError(null);

      try {
        let data: ResponsableDashboardData;
        const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
        const isClient = user?.role_nom === 'Client' || user?.role_id === 4;
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
        } else if (isClient) {
          setAgentAssignments([]);
          const projectsResponse = await api.getProjects(token, { limit: 100 });
          const details = await Promise.all(projectsResponse.projects.map((project) => api.getProjectDetails(token, project.id)));
          const projects: ResponsableProjectItem[] = details.map(({ project }) => ({
            id: project.id, nom: project.nom, description: project.description, type_projet: project.type_projet,
            date_debut: project.date_debut, date_fin: project.date_fin, statut: project.statut,
            nombre_chantiers: project.indicateurs.nombreChantiers,
            avancement_moyen: project.indicateurs.avancementGlobal,
          }));
          const chantiers: ResponsableChantierItem[] = details.flatMap(({ project }) => project.chantiers.map((chantier) => ({
            ...chantier, projet_nom: project.nom, projet_type: project.type_projet,
          })));
          data = {
            stats: { totalProjects: projects.length, totalChantiers: chantiers.length, chantiersPrets: chantiers.filter((c) => c.gis_status === 'PRET_POUR_SUIVI').length, avancementMoyen: projects.length ? Math.round(projects.reduce((sum, p) => sum + Number(p.avancement_moyen || 0), 0) / projects.length) : 0, totalObservations: 0, totalReclamations: 0 },
            projects, chantiers, observations: [], reclamations: [],
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

  const loadedChantierIdRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;

    async function loadSelectedChantierLayers() {
      if (!token || !selectedChantierId) {
        loadedChantierIdRef.current = null;
        setActiveReference(null);
        setActiveTroncons([]);
        return;
      }

      if (loadedChantierIdRef.current === selectedChantierId) {
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

      loadedChantierIdRef.current = selectedChantierId;
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

  useEffect(() => {
    const requested = params.tronconId ? Number(params.tronconId) : null;
    if (requested) { setSelectedTronconId(requested); return; }
    const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
    if (isAgent && selectedChantierId) {
      setSelectedTronconId(agentAssignments.find((item) => item.chantier_id === selectedChantierId)?.troncon_id || null);
    } else {
      setSelectedTronconId(null);
    }
  }, [params.tronconId, selectedChantierId, agentAssignments, user?.role_id, user?.role_nom]);

  useEffect(() => {
    let active = true;
    async function loadStations() {
      if (!token || !selectedTronconId) { setStationObservations([]); return; }
      try {
        const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
        const isClient = user?.role_nom === 'Client' || user?.role_id === 4;
        if (isClient) { setStationObservations([]); return; }
        const details = isAgent
          ? await api.getAgentTronconDetails(token, selectedTronconId)
          : await api.getTronconDetails(token, selectedTronconId);
        if (active) {
          const obsList = details.observations || [];
          setStationObservations(obsList);
          if (params.observationId) {
            const obsNum = Number(params.observationId);
            const matchingObs = obsList.find((o) => Number(o.id) === obsNum);
            if (matchingObs) {
              setFocusedStationId(matchingObs.id);
              setSelectedObservation(matchingObs);
            }
          }
        }
      } catch { if (active) setStationObservations([]); }
    }
    loadStations();
    return () => { active = false; };
  }, [token, selectedTronconId, params.observationId, user?.role_id, user?.role_nom]);

  const projects = useMemo(() => dashboardData?.projects || [], [dashboardData]);
  const allChantiers = useMemo(() => dashboardData?.chantiers || [], [dashboardData]);
  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const projectChantiers = useMemo(
    () => allChantiers.filter((chantier) => chantier.projet_id === selectedProjectId),
    [allChantiers, selectedProjectId]
  );
  const projectChantierIds = useMemo(
    () => projectChantiers.map((c) => c.id).sort((a, b) => Number(a) - Number(b)).join(','),
    [projectChantiers]
  );
  const selectedChantier =
    allChantiers.find((chantier) => chantier.id === selectedChantierId) || null;

  const loadedAlignmentsProjectIdRef = useRef<number | null>(null);
  const loadedAlignmentsChantierIdsRef = useRef<string>('');

  useEffect(() => {
    let active = true;
    async function loadProjectAlignments() {
      if (!token || !selectedProjectId) {
        loadedAlignmentsProjectIdRef.current = null;
        loadedAlignmentsChantierIdsRef.current = '';
        setProjectAlignments([]);
        return;
      }

      if (
        loadedAlignmentsProjectIdRef.current === selectedProjectId &&
        loadedAlignmentsChantierIdsRef.current === projectChantierIds &&
        projectAlignments.length > 0
      ) {
        return;
      }

      const results = await Promise.allSettled(projectChantiers.map(async (chantier) => {
        const response = await api.getReferenceAlignment(token, chantier.id);
        const alignment = response.reference_alignment;
        return alignment?.geometry ? {
          id: chantier.id,
          nom: chantier.nom,
          length_km: alignment.length_km,
          geometry: alignment.geometry,
          chantier_id: chantier.id,
          projet_id: chantier.projet_id,
          source: alignment.source,
          original_filename: alignment.original_filename || alignment.nom,
          ref_id: alignment.id,
          kml_metadata: alignment.kml_metadata,
        } : null;
      }));
      if (!active) return;
      loadedAlignmentsProjectIdRef.current = selectedProjectId;
      loadedAlignmentsChantierIdsRef.current = projectChantierIds;
      setProjectAlignments(results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []));
    }
    loadProjectAlignments();
    return () => { active = false; };
  }, [token, selectedProjectId, projectChantierIds, projectChantiers]);

  const handleSelectProject = useCallback(
    (project: ResponsableProjectItem) => {
      const relatedChantiers = allChantiers.filter(
        (chantier) => chantier.projet_id === project.id
      );
      const defaultChantier = chooseDefaultChantier(relatedChantiers);
      const agentRole = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
      setSelectedProjectId(project.id);
      setSelectedChantierId(agentRole ? defaultChantier?.id || null : null);
      setSelectedTronconId(null);
      setSelectedObservation(null);
      setIsSheetExpanded(false);
    },
    [allChantiers, user?.role_id, user?.role_nom]
  );

  const handleSelectChantier = useCallback((chantier: ResponsableChantierItem) => {
    setSelectedChantierId(chantier.id);
    setSelectedTronconId(null);
    setSelectedObservation(null);
    if (!isDesktop) setIsSheetExpanded(true);
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

  const isAgent = user?.role_nom === 'AgentTerrain' || user?.role_id === 3;
  const isClient = user?.role_nom === 'Client' || user?.role_id === 4;
  const assignedTronconId = isAgent ? agentAssignments.find((item) => item.chantier_id === selectedChantierId)?.troncon_id : undefined;
  const selectedTroncon = activeTroncons.find((item) => Number(item.id) === Number(selectedTronconId)) || null;

  const kmlImages = useMemo(() => {
    const metadata = isAgent || selectedChantierId
      ? [kmlMetadataForSource(activeReference)]
      : projectAlignments.map((alignment) => kmlMetadataForSource({ ...alignment, source: alignment.source || '' }));
    return {
      photoOverlays: metadata.flatMap((item) => item?.photoOverlays || []),
      groundOverlays: metadata.flatMap((item) => item?.groundOverlays || []),
    };
  }, [isAgent, selectedChantierId, activeReference, projectAlignments]);

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
        progress_percentage: troncon.avancement,
        isPrimary: !!assignedTronconId && Number(troncon.id) === Number(assignedTronconId),
        isSecondary: !!assignedTronconId && Number(troncon.id) !== Number(assignedTronconId),
        showProgress: !assignedTronconId || Number(troncon.id) === Number(assignedTronconId),
      })),
    [activeTroncons, assignedTronconId]
  );

  const mapStations: NonNullable<React.ComponentProps<typeof InteractiveGisMap>['customMarkers']> = useMemo(() => stationObservations
    .filter((obs) => Number.isFinite(Number(obs.projected_lat)) && Number.isFinite(Number(obs.projected_lng)))
    .map((obs) => ({
      id: obs.id,
      lat: Number(obs.projected_lat), lng: Number(obs.projected_lng), iconName: 'road',
      label: `Station PK ${Math.round(Number(obs.distance_from_start) || 0)} m`,
      sublabel: obs.validation_status === 'exceptional' ? 'Validation exceptionnelle' : 'Observation validée',
      color: '#10B981', photoUrl: obs.photos?.[0]?.url ? getMediaUrl(obs.photos[0].url) : undefined,
      dateTime: obs.date_heure, phase: obs.phase, workStatus: obs.phase_statut,
      remarks: obs.commentaire, distanceOffset: Number(obs.distance_offset || 0),
      dailyMeters: Number(obs.daily_progress_meters || 0), dailyPercentage: Number(obs.daily_progress_percentage || 0),
      totalPercentage: Number(obs.authoritative_progress_percentage ?? obs.progress_percentage),
      validationStatus: obs.validation_status,
    })), [stationObservations]);

  const handleSelectObservation = useCallback((observation: TerrainObservationItem) => {
    setFocusedStationId(observation.id);
    setSelectedObservation(observation);
    setIsSheetExpanded(false);
  }, []);

  const handleSelectTroncon = useCallback((id: number | string) => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return;
    if (isAgent && Number(assignedTronconId) !== numericId) return;
    setSelectedTronconId(numericId);
    setSelectedObservation(null);
    if (!isDesktop) setIsSheetExpanded(true);
  }, [isAgent, assignedTronconId, isDesktop]);

  const handleDeclareObservation = useCallback(() => {
    if (selectedTronconId) router.push(`/agent/troncon/${selectedTronconId}` as never);
  }, [router, selectedTronconId]);

  const handleBackToChantier = useCallback(() => {
    setSelectedTronconId(null);
    setSelectedObservation(null);
    setFocusedStationId(null);
  }, []);

  const handleBackToProject = useCallback(() => {
    if (isAgent) return;
    setSelectedChantierId(null);
    setSelectedTronconId(null);
    setSelectedObservation(null);
    setStationObservations([]);
  }, [isAgent]);

  // ── Diagnostics: Section 2 [2D KML DEBUG] and Section 3 [3D KML DEBUG] ──
  const kmlElements2D = useMemo(() => {
    if (isAgent) {
      return activeReference?.geometry ? [{
        id: activeReference.id,
        name: activeReference.original_filename || activeReference.nom || 'Alignement',
        chantierId: selectedChantierId ?? 'N/A',
        projectId: selectedProjectId ?? 'N/A',
        source: activeReference.source || 'KML',
        geometry: activeReference.geometry?.type || 'LineString',
      }] : [];
    }
    return projectAlignments.map((a) => ({
      id: a.ref_id || a.id,
      name: a.original_filename || a.nom,
      chantierId: a.chantier_id || a.id,
      projectId: a.projet_id || selectedProjectId || 'N/A',
      source: a.source || 'KML',
      geometry: a.geometry?.type || 'LineString',
    }));
  }, [isAgent, activeReference, projectAlignments, selectedChantierId, selectedProjectId]);

  const kmlElements3D = useMemo(() => {
    const list: Array<{
      id: any;
      name: string;
      chantierId: any;
      projectId: any;
      geometry: string;
    }> = [];
    if (!isAgent && projectAlignments && projectAlignments.length > 0) {
      projectAlignments.forEach((a) => {
        list.push({
          id: a.ref_id || a.id,
          name: a.original_filename || a.nom,
          chantierId: a.chantier_id || a.id,
          projectId: a.projet_id || selectedProjectId || 'N/A',
          geometry: a.geometry?.type || 'LineString',
        });
      });
    }
    if (activeReference?.original_geometry) {
      list.push({
        id: activeReference.id,
        name: activeReference.original_filename || `${activeReference.nom} (original_geometry)`,
        chantierId: selectedChantierId ?? 'N/A',
        projectId: selectedProjectId ?? 'N/A',
        geometry: activeReference.original_geometry?.type || 'LineString',
      });
    }
    return list;
  }, [isAgent, projectAlignments, activeReference, selectedChantierId, selectedProjectId]);

  useEffect(() => {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;

    if (mapMode === '2d') {
      if (kmlElements2D.length === 0) return;
      const sig = JSON.stringify(kmlElements2D);
      if (lastLogged2dSig !== sig) {
        lastLogged2dSig = sig;
        let msg = `[2D KML DEBUG]\ncount: ${kmlElements2D.length}\n`;
        kmlElements2D.forEach((k, idx) => {
          msg += `\nKML ${idx + 1}\nid: ${k.id}\nname: ${k.name}\nchantierId: ${k.chantierId}\nprojectId: ${k.projectId}\nsource: ${k.source}\ngeometry: ${k.geometry}\n`;
        });
        console.log(msg.trim());
      }
    } else {
      if (kmlElements3D.length === 0) return;
      const sig = JSON.stringify(kmlElements3D) + `_${selectedChantierId}_${Boolean(activeReference?.geometry)}`;
      if (lastLogged3dSig !== sig) {
        lastLogged3dSig = sig;
        let msg = `[3D KML DEBUG]\ncount: ${kmlElements3D.length}\n`;
        kmlElements3D.forEach((k, idx) => {
          msg += `\nKML ${idx + 1}\nid: ${k.id}\nname: ${k.name}\nchantierId: ${k.chantierId}\nprojectId: ${k.projectId}\ngeometry: ${k.geometry}\n`;
        });
        console.log(msg.trim());
      }
    }
  }, [mapMode, kmlElements2D, kmlElements3D, selectedChantierId, activeReference]);

  const mobileSheetHeight = Math.min(height * 0.62, 540);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── Global SiteX Header with 2D / 3D Mode Switcher ── */}
      <SiteXHeader
        title="Carte SIG"
        rightContent={
          <View style={styles.headerModeToggle}>
            <TouchableOpacity
              style={[styles.headerModeBtn, width < 420 && styles.headerModeBtnCompact, mapMode === '2d' && styles.headerModeBtnActive]}
              onPress={() => setMapMode('2d')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="map"
                size={13}
                color={mapMode === '2d' ? '#FFFFFF' : '#64748B'}
              />
              <Text
                style={[styles.headerModeText, mapMode === '2d' && styles.headerModeTextActive]}
                weight="bold"
              >
                2D
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerModeBtn, width < 420 && styles.headerModeBtnCompact, mapMode === '3d' && styles.headerModeBtnActive]}
              onPress={() => setMapMode('3d')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="cube"
                size={13}
                color={mapMode === '3d' ? '#FFFFFF' : '#64748B'}
              />
              <Text
                style={[styles.headerModeText, mapMode === '3d' && styles.headerModeTextActive]}
                weight="bold"
              >
                3D
              </Text>
            </TouchableOpacity>
            {(kmlImages.photoOverlays.length > 0 || kmlImages.groundOverlays.length > 0) && <TouchableOpacity
              accessibilityRole="switch"
              accessibilityLabel="KML"
              accessibilityState={{ checked: isKmlImagesVisible }}
              onPress={() => setIsKmlImagesVisible((visible) => !visible)}
              style={[styles.headerModeBtn, width < 420 && styles.headerModeBtnCompact, isKmlImagesVisible && styles.headerModeBtnActive]}
              activeOpacity={0.8}
            >
              <Ionicons name="camera-outline" size={13} color={isKmlImagesVisible ? '#FFFFFF' : '#64748B'} />
              <Text style={[styles.headerModeText, isKmlImagesVisible && styles.headerModeTextActive]} weight="bold">
                KML
              </Text>
            </TouchableOpacity>}
          </View>
        }
      />
      <View style={styles.workspace}>
        {isDesktop && (
          <MapDesktopPanel
            projects={projects}
            project={selectedProject}
            chantier={selectedChantier}
            chantiers={projectChantiers}
            onSelectProject={handleSelectProject}
            onSelectChantier={handleSelectChantier}
            onOpenGis={isClient ? undefined : handleOpenGis}
            selectedTroncon={selectedTroncon}
            observations={stationObservations}
            isAgent={isAgent}
            onSelectObservation={handleSelectObservation}
            onDeclareObservation={isAgent ? handleDeclareObservation : undefined}
            troncons={activeTroncons}
            onSelectTroncon={(troncon) => handleSelectTroncon(troncon.id || 0)}
            onBackToProject={handleBackToProject}
            onBackToChantier={handleBackToChantier}
          />
        )}

        <View style={styles.mapArea}>

          {mapMode === '2d' ? (
            <InteractiveGisMap
              referenceGeometry={isAgent ? activeReference?.geometry : undefined}
              chantierAlignments={isAgent ? null : projectAlignments}
              selectedChantierId={selectedChantierId}
              onSelectChantierAlignment={(id) => {
                const chantier = projectChantiers.find((item) => String(item.id) === String(id));
                if (chantier) handleSelectChantier(chantier);
              }}
              troncons={mapTroncons.length > 0 ? mapTroncons : null}
              selectedTronconId={selectedTronconId || undefined}
              onSelectTroncon={handleSelectTroncon}
              height="100%"
              fitPaddingBottom={!isDesktop ? (isSheetExpanded ? mobileSheetHeight : 145) : 35}
              optimizePkLabels
              customMarkers={mapStations}
              kmlSourceFormat="KML"
              kmlMetadata={kmlMetadataForSource(activeReference)}
              kmlPhotoOverlays={kmlImages.photoOverlays}
              kmlGroundOverlays={kmlImages.groundOverlays}
              showKmlImages={isKmlImagesVisible}
              showKmlImagesControl={false}
              onToggleKmlImagesVisibility={setIsKmlImagesVisible}
              onSelectKmlImage={setSelectedKmlImage}
              selectedMarkerId={focusedStationId}
              onSelectMarker={(id) => {
                const observation = stationObservations.find((item) => String(item.id) === String(id));
                if (observation) handleSelectObservation(observation);
              }}
            />
          ) : (
            <InteractiveGis3DMap
              referenceGeometry={isAgent ? activeReference?.geometry : (activeReference?.geometry || null)}
              kmlGeometry={activeReference?.original_geometry || undefined}
              kmlSourceFormat="KML"
              kmlMetadata={kmlMetadataForSource(activeReference)}
              kmlPhotoOverlays={kmlImages.photoOverlays}
              kmlGroundOverlays={kmlImages.groundOverlays}
              showKmlImages={isKmlImagesVisible}
              showKmlImagesControl={false}
              onSelectKmlImage={setSelectedKmlImage}
              chantierAlignments={isAgent ? null : projectAlignments}
              selectedChantierId={selectedChantierId}
              onSelectChantierAlignment={(id) => {
                const chantier = projectChantiers.find((item) => String(item.id) === String(id));
                if (chantier) handleSelectChantier(chantier);
              }}
              troncons={mapTroncons.length > 0 ? mapTroncons : null}
              selectedTronconId={selectedTronconId || undefined}
              onSelectTroncon={handleSelectTroncon}
              aoiGeometry={selectedChantier?.localisation}
              customMarkers={mapStations}
              selectedMarkerId={focusedStationId}
              onSelectMarker={(id) => {
                const observation = stationObservations.find((item) => String(item.id) === String(id));
                if (observation) handleSelectObservation(observation);
              }}
              height="100%"
            />
          )}

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
              onOpenGis={isClient ? undefined : handleOpenGis}
              selectedTroncon={selectedTroncon}
              observations={stationObservations}
              isAgent={isAgent}
              onSelectObservation={handleSelectObservation}
              onDeclareObservation={isAgent ? handleDeclareObservation : undefined}
              troncons={activeTroncons}
              onSelectTroncon={(troncon) => handleSelectTroncon(troncon.id || 0)}
              onBackToProject={handleBackToProject}
              onBackToChantier={handleBackToChantier}
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
      <StationDetailModal
        observation={selectedObservation}
        visible={!!selectedObservation}
        onClose={() => setSelectedObservation(null)}
        onLocate={() => setSelectedObservation(null)}
      />
      <KmlImageModal
        sourceFormat="KML"
        selectedKmlImage={selectedKmlImage}
        visible={!!selectedKmlImage}
        isKmlImagesVisible={isKmlImagesVisible}
        onClose={() => setSelectedKmlImage(null)}
        onToggleImages={() => setIsKmlImagesVisible((visible) => !visible)}
      />
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
  headerModeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    padding: 2,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  headerModeBtnCompact: {
    paddingHorizontal: 6,
  },
  headerModeBtnActive: {
    backgroundColor: Palette.primary,
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  headerModeText: {
    fontSize: 11,
    color: '#64748B',
  },
  headerModeTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
