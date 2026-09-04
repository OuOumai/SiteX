import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import {
  api,
  getMediaUrl,
  TronconDetailsResponse,
  AssignedAgentItem,
  AvailableAgentItem,
} from '@/services/api';
import { InteractiveGisMap, GisTronconSegment } from '@/components/gis/InteractiveGisMap';

function formatPK(val?: number | null, isReversed = false): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}${isReversed ? ' (Inv)' : ''}`;
}

export default function TronconDetailResponsableScreen() {
  const { tronconId } = useLocalSearchParams<{ tronconId: string }>();
  const router = useRouter();
  const { token } = useAuth();

  const [data, setData] = useState<TronconDetailsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRenamingTroncon, setIsRenamingTroncon] = useState(false);
  const [tronconName, setTronconName] = useState('');
  const [isManagingTroncon, setIsManagingTroncon] = useState(false);
  const showTronconList = () => {
    if (data?.troncon.chantier_id) router.replace(`/responsable/chantier/${data.troncon.chantier_id}` as any);
    else router.replace('/(tabs)/projects' as any);
  };

  // Assignment Modal State
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgentItem[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [assignNotes, setAssignNotes] = useState<string>('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);
  const [searchAgentQuery, setSearchAgentQuery] = useState('');

  // Unassign Confirmation State
  const [agentToDelete, setAgentToDelete] = useState<AssignedAgentItem | null>(null);
  const [isDeletingAssign, setIsDeletingAssign] = useState(false);

  // Full Screen Photo Preview State
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !tronconId) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const res = await api.getTronconDetails(token, tronconId);
      setData(res);
      setTronconName(res.troncon.nom || '');
    } catch (err: any) {
      console.error('Erreur chargement détails tronçon:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, tronconId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const renameTroncon = async () => {
    if (!token || !tronconId || !tronconName.trim()) return;
    setIsManagingTroncon(true);
    try {
      const result = await api.renameResponsableTroncon(token, tronconId, tronconName.trim());
      setData((current) => current ? { ...current, troncon: { ...current.troncon, nom: result.troncon.nom } } : current);
      setIsRenamingTroncon(false);
      if (Platform.OS === 'web') {
        window.alert(result.message);
        showTronconList();
      } else {
        Alert.alert('Tronçon renommé', result.message, [{ text: 'OK', onPress: showTronconList }]);
      }
    } catch (err: any) { Alert.alert('Erreur', err.message || 'Impossible de renommer le tronçon.'); }
    finally { setIsManagingTroncon(false); }
  };

  const deleteTroncon = async () => {
      if (!token || !tronconId) return;
      setIsManagingTroncon(true);
      try {
        const result = await api.deleteResponsableTroncon(token, tronconId);
        if (Platform.OS === 'web') {
          window.alert(result.message);
          showTronconList();
        } else {
          Alert.alert('Tronçon supprimé', result.message, [{ text: 'OK', onPress: showTronconList }]);
        }
      } catch (err: any) { setIsManagingTroncon(false); Alert.alert('Erreur', err.message || 'Impossible de supprimer le tronçon.'); }
  };

  const confirmDeleteTroncon = () => {
    const message = `Cette action supprimera définitivement « ${data?.troncon.nom || ''} » et ses observations.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`Supprimer le tronçon ?\n\n${message}`)) void deleteTroncon();
      return;
    }
    Alert.alert('Supprimer le tronçon ?', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: deleteTroncon },
    ]);
  };

  // Open Assign Modal and fetch available agents
  const handleOpenAssignModal = async () => {
    if (!token) return;
    setIsAssignModalOpen(true);
    setSelectedAgentId(null);
    setAssignNotes('');
    setSearchAgentQuery('');
    setIsLoadingAgents(true);

    try {
      const res = await api.getAvailableAgents(token);
      setAvailableAgents(res.agents || []);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de récupérer les agents de terrain.');
    } finally {
      setIsLoadingAgents(false);
    }
  };

  // Submit new assignment
  const handleConfirmAssignment = async () => {
    if (!token || !tronconId || !selectedAgentId) {
      Alert.alert('Sélection requise', 'Veuillez sélectionner un agent de terrain.');
      return;
    }

    setIsSubmittingAssign(true);
    try {
      const res = await api.assignAgentToTroncon(token, tronconId, {
        agent_id: selectedAgentId,
        notes: assignNotes.trim() || undefined,
      });

      Alert.alert('Succès', res.message || 'Agent affecté avec succès !');
      setIsAssignModalOpen(false);
      fetchDetails();
    } catch (err: any) {
      Alert.alert('Affectation impossible', err.message || 'Erreur lors de l\'affectation.');
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // Unassign agent
  const handleConfirmUnassign = async () => {
    if (!token || !tronconId || !agentToDelete) return;

    setIsDeletingAssign(true);
    try {
      const res = await api.removeAgentFromTroncon(token, tronconId, agentToDelete.agent_id);
      Alert.alert('Succès', res.message || 'Affectation retirée avec succès.');
      setAgentToDelete(null);
      fetchDetails();
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de retirer l\'affectation.');
    } finally {
      setIsDeletingAssign(false);
    }
  };

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement des données du tronçon...</Text>
      </SafeAreaView>
    );
  }

  const troncon = data?.troncon;
  const siblings = data?.siblings || [];
  const observations = data?.observations || [];
  const assignedAgents: AssignedAgentItem[] = data?.assigned_agents || troncon?.assigned_agents || [];
  const currentId = Number(tronconId);

  // Map segments with semantic status colors preserved + selected segment highlighted
  const mapSegments: GisTronconSegment[] = siblings.map((t) => ({
    id: t.id!,
    nom: t.nom,
    pk_debut: t.pk_debut,
    pk_fin: t.pk_fin,
    statut: t.statut || 'NON_COMMENCE',
    length_km: t.length_km,
    geometry: t.geometry,
    progress_percentage: Number(t.id) === currentId ? Number(troncon?.avancement || 0) : Number(t.avancement || 0),
  }));

  const furthestMeters = Math.max(0, ...observations.map((item) => Number(item.distance_from_start) || 0));
  const stationMarkers: NonNullable<React.ComponentProps<typeof InteractiveGisMap>['customMarkers']> = observations
    .filter((obs) => Number.isFinite(Number(obs.projected_lat)) && Number.isFinite(Number(obs.projected_lng)))
    .map((obs) => ({
      lat: Number(obs.projected_lat),
      lng: Number(obs.projected_lng),
      label: `Station PK ${Math.round(Number(obs.distance_from_start) || 0)} m`,
      sublabel: obs.validation_status === 'exceptional' ? 'Exceptionnelle' : 'Validée',
      color: Number(obs.distance_from_start) === furthestMeters ? '#F59E0B' : '#10B981',
      iconName: 'road',
      photoUrl: obs.photos?.[0]?.url ? getMediaUrl(obs.photos[0].url) : undefined,
      dateTime: obs.date_heure,
      phase: obs.phase,
      workStatus: obs.phase_statut,
      remarks: obs.commentaire,
      distanceOffset: Number(obs.distance_offset || 0),
      dailyMeters: Number(obs.daily_progress_meters || 0),
      dailyPercentage: Number(obs.daily_progress_percentage || 0),
      totalPercentage: Number(obs.authoritative_progress_percentage ?? obs.progress_percentage),
      validationStatus: obs.validation_status,
      isFurthest: Number(obs.distance_from_start) === furthestMeters,
    }));

  const statut = troncon?.statut || 'NON_COMMENCE';
  const statutColor =
    statut === 'TERMINE'
      ? '#16A34A'
      : statut === 'EN_COURS'
      ? '#F4A261'
      : statut === 'PROBLEME'
      ? '#DC2626'
      : '#94A3B8';

  const statutLabel =
    statut === 'TERMINE'
      ? 'Terminé'
      : statut === 'EN_COURS'
      ? 'En cours'
      : statut === 'PROBLEME'
      ? 'Problème / Retard'
      : 'Non commencé';

  // Filter available agents for modal picker
  const filteredAvailableAgents = availableAgents.filter((a) => {
    const isAlreadyAssigned = assignedAgents.some((assigned) => assigned.agent_id === a.id);
    if (isAlreadyAssigned) return false;
    if (!searchAgentQuery.trim()) return true;
    const query = searchAgentQuery.toLowerCase();
    const fullName = `${a.prenom} ${a.nom}`.toLowerCase();
    const email = (a.email || '').toLowerCase();
    return fullName.includes(query) || email.includes(query);
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.parentText}>
            {troncon?.projet_nom} &bull; {troncon?.chantier_nom}
          </Text>
          <Text variant="h1" style={styles.headerTitle}>
            {troncon?.nom}
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
        {/* ── 1. Map Experience (Siblings visible, semantic colors, selected highlighted, legend) ── */}
        <Card variant="elevated" style={styles.mapCard}>
          <View style={styles.mapHeaderRow}>
            <View style={styles.mapHeaderTitleRow}>
              <Ionicons name="map-outline" size={18} color={Palette.primary} />
              <Text style={styles.mapCardTitle} weight="bold">
                {"Positionnement Spatial sur l'Axe"}
              </Text>
            </View>
            <View style={[styles.statutBadge, { backgroundColor: `${statutColor}18`, borderColor: statutColor }]}>
              <View style={[styles.statutDot, { backgroundColor: statutColor }]} />
              <Text style={[styles.statutBadgeText, { color: statutColor }]} weight="bold">
                {statutLabel}
              </Text>
            </View>
          </View>

          {/* Interactive Map with focused troncon */}
          <InteractiveGisMap
            height={220}
            troncons={mapSegments}
            selectedTronconId={currentId}
            customMarkers={stationMarkers}
          />

          {/* Color Legend */}
          <View style={styles.legendContainer}>
            <Text style={styles.legendTitle}>{"Légende d'état :"}</Text>
            <View style={styles.legendItemsRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#16A34A' }]} />
                <Text style={styles.legendText}>Terminé</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F4A261' }]} />
                <Text style={styles.legendText}>En cours</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#DC2626' }]} />
                <Text style={styles.legendText}>Retard/Alerte</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#94A3B8' }]} />
                <Text style={styles.legendText}>Non débuté</Text>
              </View>
            </View>
          </View>
        </Card>

        <Card variant="elevated" style={styles.manageCard}>
          <Text weight="bold" style={styles.manageTitle}>Gestion du tronçon</Text>
          {isRenamingTroncon ? (
            <>
              <Input label="Nouveau nom du tronçon" value={tronconName} onChangeText={setTronconName} />
              <View style={styles.manageActions}>
                <Button title="Annuler" variant="ghost" size="sm" onPress={() => setIsRenamingTroncon(false)} />
                <Button title="Enregistrer" size="sm" loading={isManagingTroncon} onPress={renameTroncon} />
              </View>
            </>
          ) : (
            <View style={styles.manageActions}>
              <Button title="Renommer" variant="outline" size="sm" onPress={() => setIsRenamingTroncon(true)} />
              <Button title="Supprimer le tronçon" variant="destructive" size="sm" loading={isManagingTroncon} onPress={confirmDeleteTroncon} />
            </View>
          )}
        </Card>

        {/* ── 2. AGENTS DE TERRAIN AFFECTÉS SECTION (New Feature) ── */}
        <Card variant="elevated" style={styles.assignmentSectionCard}>
          <View style={styles.assignmentSectionHeader}>
            <View style={styles.assignmentTitleRow}>
              <View style={styles.assignmentIconBg}>
                <Ionicons name="people" size={18} color={Palette.primary} />
              </View>
              <View>
                <Text style={styles.assignmentSectionTitle} weight="bold">
                  Agents de Terrain Affectés ({assignedAgents.length})
                </Text>
                <Text style={styles.assignmentSectionSubtitle}>
                  Agents autorisés à effectuer des relevés sur ce tronçon
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.addAgentBtn}
              onPress={handleOpenAssignModal}
              activeOpacity={0.8}
            >
              <Ionicons name="person-add" size={14} color="#FFFFFF" />
              <Text style={styles.addAgentBtnText} weight="bold">
                Affecter
              </Text>
            </TouchableOpacity>
          </View>

          {assignedAgents.length > 0 ? (
            <View style={styles.assignedAgentsList}>
              {assignedAgents.map((agent) => (
                <View key={agent.affectation_id} style={styles.assignedAgentItem}>
                  <View style={styles.assignedAgentAvatar}>
                    {agent.photo_url ? (
                      <Image source={{ uri: agent.photo_url }} style={styles.avatarImg} />
                    ) : (
                      <Text style={styles.avatarText} weight="bold">
                        {agent.prenom?.[0] || 'A'}
                        {agent.nom?.[0] || 'T'}
                      </Text>
                    )}
                  </View>
                  <View style={styles.assignedAgentInfo}>
                    <View style={styles.assignedAgentNameRow}>
                      <Text style={styles.assignedAgentName} weight="bold">
                        {agent.prenom} {agent.nom}
                      </Text>
                      <View style={styles.activeBadge}>
                        <Text style={styles.activeBadgeText} weight="bold">ACTIF</Text>
                      </View>
                    </View>
                    <Text style={styles.assignedAgentMeta}>
                      {agent.email} {agent.telephone ? `• ${agent.telephone}` : ''}
                    </Text>
                    {agent.date_affectation ? (
                      <Text style={styles.assignedAgentDate}>
                        Affecté le {agent.date_affectation}
                        {agent.affecte_par_nom ? ` par ${agent.affecte_par_nom}` : ''}
                      </Text>
                    ) : null}
                    {agent.notes ? (
                      <Text style={styles.assignedAgentNotes}>
                        {`Note : "${agent.notes}"`}
                      </Text>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.removeAgentBtn}
                    onPress={() => setAgentToDelete(agent)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={18} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.noAgentsBox}>
              <Ionicons name="person-circle-outline" size={36} color="#CBD5E1" />
              <Text style={styles.noAgentsText} weight="semibold">
                Aucun agent de terrain affecté
              </Text>
              <Text style={styles.noAgentsSubtext}>
                Cliquez sur « Affecter » pour désigner un ou plusieurs agents de terrain sur ce tronçon.
              </Text>
            </View>
          )}
        </Card>

        {/* ── 3. Concise Summary Card ── */}
        <Card variant="elevated" style={styles.summaryCard}>
          <Text style={styles.summaryCardHeading} weight="bold">
            Fiche de Synthèse du Tronçon
          </Text>

          <View style={styles.summaryGrid}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Identifiant :</Text>
              <Text style={styles.summaryValue} weight="bold">
                {troncon?.nom} (ID #{troncon?.id})
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Chantier Parent :</Text>
              <Text style={styles.summaryValue}>{troncon?.chantier_nom}</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Chaînage PK :</Text>
              <Text style={styles.summaryValue} weight="semibold">
                {formatPK(troncon?.pk_debut, troncon?.direction_reversed)} &rarr;{' '}
                {formatPK(troncon?.pk_fin, troncon?.direction_reversed)}
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Longueur Linéaire :</Text>
              <Text style={styles.summaryValue} weight="bold">
                {troncon?.length_km} km ({troncon?.length_meters} m)
              </Text>
            </View>

            {troncon?.start_lat && troncon?.start_lng ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Coordonnées Début :</Text>
                <Text style={styles.summaryValueMono}>
                  {Number(troncon.start_lat).toFixed(5)}, {Number(troncon.start_lng).toFixed(5)}
                </Text>
              </View>
            ) : null}

            {troncon?.end_lat && troncon?.end_lng ? (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Coordonnées Fin :</Text>
                <Text style={styles.summaryValueMono}>
                  {Number(troncon.end_lat).toFixed(5)}, {Number(troncon.end_lng).toFixed(5)}
                </Text>
              </View>
            ) : null}

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Avancement estimé :</Text>
              <Text style={styles.summaryValue} weight="bold">
                {troncon?.avancement || 0}%
              </Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Relevés Terrain :</Text>
              <Text style={styles.summaryValue}>{troncon?.observations_count || 0} observations</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Anomalies signalées :</Text>
              <Text
                style={[
                  styles.summaryValue,
                  (troncon?.anomalies_count || 0) > 0 ? { color: '#DC2626', fontWeight: 'bold' } : {},
                ]}
              >
                {troncon?.anomalies_count || 0} non résolues
              </Text>
            </View>
          </View>
        </Card>

        {/* ── 4. Latest Observation Highlight ── */}
        {troncon?.latest_observation && (
          <Card variant="elevated" style={styles.latestObsCard}>
            <View style={styles.latestObsHeader}>
              <Ionicons name="radio-button-on" size={16} color={Palette.primary} />
              <Text style={styles.latestObsTitle} weight="bold">
                Dernière Observation Terrain
              </Text>
              <Text style={styles.latestObsDate}>
                {troncon.latest_observation.date_heure || 'Récemment'}
              </Text>
            </View>
            <Text style={styles.latestObsComment}>
              {`"${troncon.latest_observation.commentaire || 'Aucun commentaire.'}"`}
            </Text>
            <Text style={styles.latestObsAgent}>
              Enregistrée par {troncon.latest_observation.agent_nom || 'Agent Terrain'}
              {troncon.latest_observation.chainage ? ` au PK ${troncon.latest_observation.chainage}` : ''}
            </Text>
          </Card>
        )}

        {/* ── 4. Recent Terrain Observations List ── */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="h2" style={styles.sectionTitle}>
            Historique des Observations Terrain ({observations.length})
          </Text>
        </View>

        {observations.length > 0 ? (
          <View style={styles.obsList}>
            {observations.map((obs) => {
              const statusBg =
                obs.phase_statut === 'Terminée'
                  ? '#DCFCE7'
                  : obs.phase_statut === 'En cours'
                  ? '#FEF3C7'
                  : '#F1F5F9';
              const statusColor =
                obs.phase_statut === 'Terminée'
                  ? '#16A34A'
                  : obs.phase_statut === 'En cours'
                  ? '#B45309'
                  : '#64748B';

              return (
                <Card key={obs.id} variant="elevated" style={styles.obsCard}>
                  {/* Obs Header */}
                  <View style={styles.obsHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.obsAgentName} weight="bold">
                        {obs.agent_nom || 'Agent de Terrain'}
                      </Text>
                      <Text style={styles.obsMeta}>
                        {obs.chainage ? `PK ${obs.chainage}` : 'PK non spécifié'} &bull; {obs.date_heure}
                      </Text>
                    </View>
                    {obs.progress_percentage !== null && obs.progress_percentage !== undefined ? (
                      <View style={styles.obsProgressBadge}>
                        <Text style={styles.obsProgressText} weight="bold">
                          {obs.progress_percentage}%
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Phase & Status Tags */}
                  <View style={styles.obsTagsRow}>
                    <View style={styles.obsPhaseTag}>
                      <Text style={styles.obsPhaseText} weight="bold">
                        {obs.phase || 'Terrassement'}
                      </Text>
                    </View>
                    <View style={[styles.obsStatusTag, { backgroundColor: statusBg }]}>
                      <Text style={[styles.obsStatusText, { color: statusColor }]} weight="semibold">
                        {obs.phase_statut || 'En cours'}
                      </Text>
                    </View>
                    {obs.distance_from_start ? (
                      <Text style={styles.obsDistanceText}>
                        {obs.distance_from_start} m du début
                      </Text>
                    ) : null}
                  </View>

                  {/* Comment */}
                  {obs.commentaire ? (
                    <Text style={styles.obsComment}>{`"${obs.commentaire}"`}</Text>
                  ) : null}

                  {/* Attached Photos */}
                  {obs.photos && obs.photos.length > 0 ? (
                    <View style={styles.obsPhotosContainer}>
                      <Text style={styles.obsPhotosHeading}>Photos du relevé ({obs.photos.length}) :</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.obsPhotosScroll}
                      >
                        {obs.photos.map((p, pIdx) => {
                          const fullUrl = getMediaUrl(p.url);
                          return (
                            <TouchableOpacity
                              key={p.id || pIdx}
                              activeOpacity={0.85}
                              onPress={() => setPreviewPhotoUrl(fullUrl)}
                            >
                              <Image
                                source={{ uri: fullUrl }}
                                style={styles.obsThumbnail}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyCard}>
            <Ionicons name="eye-off-outline" size={32} color={Palette.textMuted} />
            <Text style={styles.emptyTitle}>Aucune observation enregistrée</Text>
            <Text style={styles.emptySubtitle}>
              Les relevés mobiles effectués par les Agents de Terrain sur ce tronçon apparaîtront ici.
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* ── ASSIGN AGENT MODAL ── */}
      <Modal
        visible={isAssignModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAssignModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle} weight="bold">
                  Affecter un Agent de Terrain
                </Text>
                <Text style={styles.modalSubtitle}>
                  Tronçon : {troncon?.nom} ({formatPK(troncon?.pk_debut)} &rarr; {formatPK(troncon?.pk_fin)})
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setIsAssignModalOpen(false)}
              >
                <Ionicons name="close" size={20} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Search filter input */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color={Palette.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher un agent par nom ou email..."
                placeholderTextColor={Palette.textMuted}
                value={searchAgentQuery}
                onChangeText={setSearchAgentQuery}
              />
            </View>

            {/* Available Agents List */}
            {isLoadingAgents ? (
              <View style={styles.modalLoadingBox}>
                <ActivityIndicator size="small" color={Palette.primary} />
                <Text style={styles.modalLoadingText}>Chargement des agents disponibles...</Text>
              </View>
            ) : filteredAvailableAgents.length > 0 ? (
              <ScrollView style={styles.agentsPickerScroll} showsVerticalScrollIndicator={false}>
                {filteredAvailableAgents.map((agent) => {
                  const isSelected = selectedAgentId === agent.id;
                  return (
                    <TouchableOpacity
                      key={agent.id}
                      style={[styles.agentOptionRow, isSelected && styles.agentOptionRowSelected]}
                      onPress={() => setSelectedAgentId(agent.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.agentOptionAvatar}>
                        <Text style={styles.avatarText} weight="bold">
                          {agent.prenom?.[0] || 'A'}
                          {agent.nom?.[0] || 'T'}
                        </Text>
                      </View>
                      <View style={styles.agentOptionInfo}>
                        <Text style={styles.agentOptionName} weight="bold">
                          {agent.prenom} {agent.nom}
                        </Text>
                        <Text style={styles.agentOptionMeta}>
                          {agent.email} {agent.profession ? `• ${agent.profession}` : ''}
                        </Text>
                      </View>
                      <View style={[styles.radioCircle, isSelected && styles.radioCircleSelected]}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            ) : (
              <View style={styles.modalEmptyBox}>
                <Ionicons name="people-outline" size={32} color={Palette.textMuted} />
                <Text style={styles.modalEmptyText}>
                  {searchAgentQuery ? 'Aucun agent correspondant à la recherche.' : 'Tous les agents actifs sont déjà affectés à ce tronçon.'}
                </Text>
              </View>
            )}

            {/* Optional Notes Input */}
            <View style={styles.notesContainer}>
              <Text style={styles.notesLabel}>Notes ou consignes spécifiques (optionnel) :</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Ex : Inspection des couches de forme..."
                placeholderTextColor={Palette.textMuted}
                value={assignNotes}
                onChangeText={setAssignNotes}
                multiline
                numberOfLines={2}
              />
            </View>

            {/* Modal Actions */}
            <View style={styles.modalActionsRow}>
              <Button
                title="Annuler"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setIsAssignModalOpen(false)}
              />
              <Button
                title={isSubmittingAssign ? "Affectation..." : "Confirmer l'affectation"}
                variant="primary"
                size="md"
                style={{ flex: 1.5 }}
                disabled={!selectedAgentId || isSubmittingAssign}
                onPress={handleConfirmAssignment}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── UNASSIGN CONFIRMATION MODAL ── */}
      <Modal
        visible={!!agentToDelete}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setAgentToDelete(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContainer}>
            <View style={styles.confirmIconBox}>
              <Ionicons name="warning-outline" size={28} color="#DC2626" />
            </View>
            <Text style={styles.confirmTitle} weight="bold">
              {"Retirer l'affectation ?"}
            </Text>
            <Text style={styles.confirmMessage}>
              {"Êtes-vous sûr de vouloir retirer l'accès du tronçon « "}{troncon?.nom}{" » à l'agent "}{' '}
              <Text weight="bold">{agentToDelete?.prenom} {agentToDelete?.nom}</Text>{" ? L'agent ne verra plus ce tronçon sur son tableau de bord."}
            </Text>
            <View style={styles.confirmActionsRow}>
              <Button
                title="Annuler"
                variant="secondary"
                size="md"
                style={{ flex: 1 }}
                onPress={() => setAgentToDelete(null)}
              />
              <Button
                title={isDeletingAssign ? "Retrait..." : "Retirer"}
                variant="destructive"
                size="md"
                style={{ flex: 1 }}
                disabled={isDeletingAssign}
                onPress={handleConfirmUnassign}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* ── FULL SCREEN PHOTO PREVIEW MODAL ── */}
      <Modal
        visible={!!previewPhotoUrl}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewPhotoUrl(null)}
      >
        <View style={styles.photoPreviewOverlay}>
          <TouchableOpacity
            style={styles.closePhotoPreviewBtn}
            onPress={() => setPreviewPhotoUrl(null)}
          >
            <Ionicons name="close" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          {previewPhotoUrl ? (
            <Image
              source={{ uri: previewPhotoUrl }}
              style={styles.photoPreviewImage}
              resizeMode="contain"
            />
          ) : null}
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
  parentText: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 18,
    color: Palette.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  mapCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  mapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mapHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mapCardTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  statutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statutDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statutBadgeText: {
    fontSize: 11,
  },
  legendContainer: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendTitle: {
    fontSize: 10,
    color: Palette.textMuted,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  legendItemsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Palette.text,
  },

  /* Assignment Section Styles */
  assignmentSectionCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  assignmentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  assignmentTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  assignmentIconBg: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignmentSectionTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  assignmentSectionSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  addAgentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Palette.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  addAgentBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
  },
  assignedAgentsList: {
    gap: 10,
  },
  assignedAgentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  assignedAgentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(23, 107, 91, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontSize: 13,
    color: Palette.primary,
  },
  assignedAgentInfo: {
    flex: 1,
  },
  assignedAgentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assignedAgentName: {
    fontSize: 13,
    color: Palette.text,
  },
  activeBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  activeBadgeText: {
    fontSize: 9,
    color: '#16A34A',
  },
  assignedAgentMeta: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  assignedAgentDate: {
    fontSize: 10,
    color: '#94A3B8',
    marginTop: 2,
  },
  assignedAgentNotes: {
    fontSize: 11,
    color: Palette.primaryDark,
    fontStyle: 'italic',
    marginTop: 3,
  },
  removeAgentBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  noAgentsBox: {
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
  },
  noAgentsText: {
    fontSize: 13,
    color: Palette.text,
    marginTop: 6,
  },
  noAgentsSubtext: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  /* Summary Card Styles */
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  manageCard: { marginBottom: 16 },
  manageTitle: { fontSize: 15, color: Palette.text },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  summaryCardHeading: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 8,
  },
  summaryGrid: {
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  summaryValue: {
    fontSize: 12,
    color: Palette.text,
    textAlign: 'right',
  },
  summaryValueMono: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: Palette.primaryDark,
  },
  latestObsCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.15)',
    marginBottom: 16,
  },
  latestObsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  latestObsTitle: {
    flex: 1,
    fontSize: 12,
    color: Palette.primaryDark,
  },
  latestObsDate: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  latestObsComment: {
    fontSize: 13,
    color: Palette.text,
    fontStyle: 'italic',
    lineHeight: 18,
    marginVertical: 4,
  },
  latestObsAgent: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  sectionHeaderRow: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  obsList: {
    gap: 8,
  },
  obsCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  obsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  obsAgentName: {
    fontSize: 13,
    color: Palette.text,
  },
  obsMeta: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  severityPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  severityHigh: {
    backgroundColor: '#FEE2E2',
  },
  severityNormal: {
    backgroundColor: '#F1F5F9',
  },
  severityText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#DC2626',
  },
  obsComment: {
    fontSize: 12,
    color: Palette.text,
    marginTop: 6,
    lineHeight: 16,
  },
  emptyCard: {
    padding: 20,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: Palette.text,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  modalSubtitle: {
    fontSize: 12,
    color: Palette.primary,
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
    padding: 0,
  },
  agentsPickerScroll: {
    maxHeight: 220,
    marginBottom: 12,
  },
  agentOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    marginBottom: 8,
    gap: 10,
  },
  agentOptionRowSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
  },
  agentOptionAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentOptionInfo: {
    flex: 1,
  },
  agentOptionName: {
    fontSize: 13,
    color: Palette.text,
  },
  agentOptionMeta: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
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
  radioCircleSelected: {
    borderColor: Palette.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Palette.primary,
  },
  modalLoadingBox: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalLoadingText: {
    marginTop: 8,
    fontSize: 12,
    color: Palette.textMuted,
  },
  modalEmptyBox: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalEmptyText: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  notesContainer: {
    marginBottom: 16,
  },
  notesLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: Palette.text,
    textAlignVertical: 'top',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },

  /* Confirmation Modal */
  confirmModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    margin: 24,
    alignItems: 'center',
    alignSelf: 'center',
    width: '90%',
  },
  confirmIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmTitle: {
    fontSize: 16,
    color: Palette.text,
    marginBottom: 8,
  },
  confirmMessage: {
    fontSize: 13,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },

  /* Observation Cards Enrichment */
  obsProgressBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  obsProgressText: {
    fontSize: 12,
    color: '#B45309',
  },
  obsTagsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  obsPhaseTag: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  obsPhaseText: {
    fontSize: 11,
    color: Palette.primary,
  },
  obsStatusTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  obsStatusText: {
    fontSize: 11,
  },
  obsDistanceText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  obsPhotosContainer: {
    marginTop: 8,
  },
  obsPhotosHeading: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 6,
  },
  obsPhotosScroll: {
    gap: 8,
  },
  obsThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },

  /* Photo Preview Overlay */
  photoPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePhotoPreviewBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    padding: 8,
  },
  photoPreviewImage: {
    width: '94%',
    height: '80%',
  },
});
