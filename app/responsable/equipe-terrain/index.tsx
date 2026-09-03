import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import {
  api,
  getMediaUrl,
  EquipeTerrainResponse,
  EquipeAgentItem,
  EquipeAgentAffectation,
  HierarchyTreeResponse,
  HierarchyProjectItem,
  HierarchyChantierItem,
  HierarchyTronconItem,
} from '@/services/api';

function formatPK(val?: number | null): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}`;
}

export default function EquipeTerrainScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [data, setData] = useState<EquipeTerrainResponse | null>(null);
  const [hierarchy, setHierarchy] = useState<HierarchyTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Assignment Modal State ──
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [targetAgent, setTargetAgent] = useState<EquipeAgentItem | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedChantierId, setSelectedChantierId] = useState<number | null>(null);
  const [selectedTronconId, setSelectedTronconId] = useState<number | null>(null);
  const [assignNotes, setAssignNotes] = useState('');
  const [isSubmittingAssign, setIsSubmittingAssign] = useState(false);

  // ── Unassign Confirmation Modal ──
  const [affToDelete, setAffToDelete] = useState<{
    affectationId: number;
    agentName: string;
    tronconNom: string;
  } | null>(null);
  const [isDeletingAff, setIsDeletingAff] = useState(false);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [equipeRes, hierRes] = await Promise.all([
        api.getEquipeTerrain(token),
        api.getHierarchyTree(token),
      ]);
      setData(equipeRes);
      setHierarchy(hierRes);
    } catch (err: any) {
      console.error('Erreur chargement équipe terrain:', err.message);
      Alert.alert('Erreur', err.message || 'Impossible de charger l\'équipe terrain.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Filtered Agents List ──
  const filteredAgents = useMemo(() => {
    const list = data?.agents || [];
    const q = searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (a) =>
        a.nom.toLowerCase().includes(q) ||
        a.prenom.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (a.entreprise && a.entreprise.toLowerCase().includes(q)) ||
        (a.profession && a.profession.toLowerCase().includes(q))
    );
  }, [data?.agents, searchQuery]);

  // ── Cascading Selection Options ──
  const projectsList: HierarchyProjectItem[] = hierarchy?.projects || [];

  const selectedProject = useMemo(() => {
    return projectsList.find((p) => p.id === selectedProjectId) || null;
  }, [projectsList, selectedProjectId]);

  const chantiersList: HierarchyChantierItem[] = useMemo(() => {
    return selectedProject ? selectedProject.chantiers : [];
  }, [selectedProject]);

  const selectedChantier = useMemo(() => {
    return chantiersList.find((c) => c.id === selectedChantierId) || null;
  }, [chantiersList, selectedChantierId]);

  const tronconsList: HierarchyTronconItem[] = useMemo(() => {
    return selectedChantier ? selectedChantier.troncons : [];
  }, [selectedChantier]);

  // ── Open Assign Modal ──
  const handleOpenAssignModal = (agent: EquipeAgentItem) => {
    setTargetAgent(agent);
    setSelectedProjectId(null);
    setSelectedChantierId(null);
    setSelectedTronconId(null);
    setAssignNotes('');
    setIsAssignModalOpen(true);
  };

  // ── Cascading Handlers ──
  const handleSelectProject = (projId: number) => {
    setSelectedProjectId(projId);
    setSelectedChantierId(null);
    setSelectedTronconId(null);
  };

  const handleSelectChantier = (chanId: number) => {
    setSelectedChantierId(chanId);
    setSelectedTronconId(null);
  };

  // ── Submit Assignment ──
  const handleConfirmAssignment = async () => {
    if (!token || !targetAgent) return;

    if (!selectedProjectId) {
      Alert.alert('Champs requis', 'Veuillez sélectionner un projet.');
      return;
    }
    if (!selectedChantierId) {
      Alert.alert('Champs requis', 'Veuillez sélectionner un chantier.');
      return;
    }
    if (!selectedTronconId) {
      Alert.alert('Champs requis', 'Veuillez sélectionner un tronçon.');
      return;
    }

    setIsSubmittingAssign(true);
    try {
      const res = await api.createAffectation(token, {
        agent_id: targetAgent.id,
        projet_id: selectedProjectId,
        chantier_id: selectedChantierId,
        troncon_id: selectedTronconId,
        notes: assignNotes.trim() || undefined,
      });

      Alert.alert('Succès ! 🎉', res.message);
      setIsAssignModalOpen(false);
      fetchData();
    } catch (err: any) {
      console.error('Erreur affectation agent:', err.message);
      const errMsg = err.message || '';
      if (
        err.conflict === 'AGENT_ALREADY_ASSIGNED' ||
        err.conflict === 'TRONCON_ALREADY_ASSIGNED' ||
        errMsg.includes('déjà affecté') ||
        errMsg.includes('réaffectation') ||
        errMsg.includes('remplacement')
      ) {
        Alert.alert(
          'Confirmation de Réaffectation',
          `${errMsg}\n\nSouhaitez-vous confirmer le transfert vers ce nouveau tronçon ?`,
          [
            { text: 'Annuler', style: 'cancel' },
            {
              text: 'Confirmer la réaffectation',
              style: 'default',
              onPress: async () => {
                try {
                  setIsSubmittingAssign(true);
                  const res = await api.createAffectation(token, {
                    agent_id: targetAgent.id,
                    projet_id: selectedProjectId,
                    chantier_id: selectedChantierId,
                    troncon_id: selectedTronconId,
                    notes: assignNotes.trim() || undefined,
                    reassign: true,
                    replace_current: true,
                  });
                  Alert.alert('Succès ! 🎉', res.message);
                  setIsAssignModalOpen(false);
                  fetchData();
                } catch (reassignErr: any) {
                  Alert.alert('Erreur', reassignErr.message || 'Impossible de réaffecter cet agent.');
                } finally {
                  setIsSubmittingAssign(false);
                }
              },
            },
          ]
        );
      } else {
        Alert.alert('Erreur', errMsg || 'Impossible d\'affecter cet agent.');
      }
    } finally {
      setIsSubmittingAssign(false);
    }
  };

  // ── Remove Assignment ──
  const handleConfirmRemoveAssignment = async () => {
    if (!token || !affToDelete) return;

    setIsDeletingAff(true);
    try {
      const res = await api.removeAffectation(token, affToDelete.affectationId);
      Alert.alert('Succès', res.message);
      setAffToDelete(null);
      fetchData();
    } catch (err: any) {
      console.error('Erreur retrait affectation:', err.message);
      Alert.alert('Erreur', err.message || 'Impossible de retirer l\'affectation.');
    } finally {
      setIsDeletingAff(false);
    }
  };

  if (isLoading && !data) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement de l'équipe terrain...</Text>
      </SafeAreaView>
    );
  }

  const stats = data?.stats || {
    totalAvailable: 0,
    totalAssigned: 0,
    totalAssignments: 0,
    totalUnassigned: 0,
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── Screen Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>RESPONSABLE DE PROJET</Text>
          <Text variant="h1" style={styles.headerTitle}>
            Équipe terrain
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchData(true)}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── 1. Summary Statistics Banner ── */}
        <Card variant="elevated" style={styles.statsCard}>
          <View style={styles.statsHeaderRow}>
            <Ionicons name="people" size={18} color={Palette.primary} />
            <Text style={styles.statsCardTitle} weight="bold">
              Effectifs & Affectations Terrain
            </Text>
          </View>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statValue} weight="bold">
                {stats.totalAvailable}
              </Text>
              <Text style={styles.statLabel}>A.T. disponibles</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#0D9488' }]} weight="bold">
                {stats.totalAssigned}
              </Text>
              <Text style={styles.statLabel}>Actuellement affectés</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: Palette.primary }]} weight="bold">
                {stats.totalAssignments}
              </Text>
              <Text style={styles.statLabel}>Total affectations</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: '#64748B' }]} weight="bold">
                {stats.totalUnassigned}
              </Text>
              <Text style={styles.statLabel}>Non affectés</Text>
            </View>
          </View>
        </Card>

        {/* ── 2. Search & Filter Bar ── */}
        <View style={styles.searchBarContainer}>
          <Ionicons name="search-outline" size={18} color={Palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher un agent par nom, prénom, email..."
            placeholderTextColor={Palette.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Palette.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── 3. Agents List ── */}
        <View style={styles.listHeaderRow}>
          <Text style={styles.listTitle} weight="bold">
            Agents de Terrain ({filteredAgents.length})
          </Text>
          <Text style={styles.listSub}>
            Affectez vos agents aux tronçons de vos chantiers
          </Text>
        </View>

        {filteredAgents.length > 0 ? (
          <View style={styles.agentsList}>
            {filteredAgents.map((agent) => {
              const isAssigned = agent.assignments_count > 0;

              return (
                <Card key={agent.id} variant="elevated" style={styles.agentCard}>
                  {/* Agent Info Header */}
                  <View style={styles.agentHeader}>
                    {agent.photo_url ? (
                      <Image
                        source={{ uri: getMediaUrl(agent.photo_url) }}
                        style={styles.agentAvatar}
                      />
                    ) : (
                      <View style={styles.agentAvatarPlaceholder}>
                        <Text style={styles.avatarInitials} weight="bold">
                          {agent.prenom?.charAt(0)}
                          {agent.nom?.charAt(0)}
                        </Text>
                      </View>
                    )}

                    <View style={{ flex: 1 }}>
                      <View style={styles.agentNameRow}>
                        <Text style={styles.agentName} weight="bold">
                          {agent.prenom} {agent.nom}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            { backgroundColor: agent.actif ? '#DCFCE7' : '#F1F5F9' },
                          ]}
                        >
                          <View
                            style={[
                              styles.statusDot,
                              { backgroundColor: agent.actif ? '#16A34A' : '#94A3B8' },
                            ]}
                          />
                          <Text
                            style={[
                              styles.statusBadgeText,
                              { color: agent.actif ? '#16A34A' : '#94A3B8' },
                            ]}
                            weight="bold"
                          >
                            {agent.actif ? 'ACTIF' : 'INACTIF'}
                          </Text>
                        </View>
                      </View>

                      <Text style={styles.agentEmail}>{agent.email}</Text>
                      {agent.telephone ? (
                        <Text style={styles.agentPhone}>{agent.telephone}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* Badges & Meta */}
                  <View style={styles.agentMetaRow}>
                    <View style={styles.assignedCountBadge}>
                      <Ionicons
                        name={isAssigned ? 'checkmark-done-circle' : 'time-outline'}
                        size={14}
                        color={isAssigned ? '#0D9488' : '#94A3B8'}
                      />
                      <Text
                        style={[
                          styles.assignedCountText,
                          { color: isAssigned ? '#0D9488' : '#64748B' },
                        ]}
                        weight="semibold"
                      >
                        {agent.assignments_count}{' '}
                        {agent.assignments_count > 1 ? 'affectations' : 'affectation'}
                      </Text>
                    </View>

                    {agent.profession ? (
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>{agent.profession}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Active Assignments Breakdown */}
                  {agent.affectations && agent.affectations.length > 0 ? (
                    <View style={styles.affectationsListContainer}>
                      <Text style={styles.affectationsHeading} weight="bold">
                        Affectations sur vos chantiers :
                      </Text>

                      {agent.affectations.map((aff: EquipeAgentAffectation) => (
                        <View key={aff.affectation_id} style={styles.affItemRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.affHierarchy} numberOfLines={1}>
                              {aff.projet_nom} &rarr; {aff.chantier_nom}
                            </Text>
                            <Text style={styles.affTronconNom} weight="semibold">
                              {aff.troncon_nom}{' '}
                              <Text style={styles.affPkRange}>
                                ({formatPK(aff.pk_debut)} &rarr; {formatPK(aff.pk_fin)})
                              </Text>
                            </Text>
                            {aff.notes ? (
                              <Text style={styles.affNotes} numberOfLines={1}>
                                "{aff.notes}"
                              </Text>
                            ) : null}
                          </View>

                          <TouchableOpacity
                            style={styles.unassignMiniBtn}
                            onPress={() =>
                              setAffToDelete({
                                affectationId: aff.affectation_id,
                                agentName: `${agent.prenom} ${agent.nom}`,
                                tronconNom: aff.troncon_nom,
                              })
                            }
                            activeOpacity={0.7}
                          >
                            <Ionicons name="trash-outline" size={15} color="#DC2626" />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {/* Primary Action Button */}
                  <Button
                    title="📍 Affecter à un tronçon"
                    variant="primary"
                    size="sm"
                    onPress={() => handleOpenAssignModal(agent)}
                    style={styles.assignBtn}
                  />
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyCard}>
            <Ionicons name="people-outline" size={40} color={Palette.textMuted} />
            <Text style={styles.emptyTitle}>Aucun agent de terrain trouvé</Text>
            <Text style={styles.emptySubtitle}>
              {searchQuery
                ? 'Aucun agent ne correspond à votre recherche.'
                : 'Aucun agent de terrain actif n\'est disponible pour le moment.'}
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* ── CASCADING ASSIGNMENT MODAL (PROJET -> CHANTIER -> TRONÇON) ── */}
      <Modal
        visible={isAssignModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAssignModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle} weight="bold">
                  Affecter un agent
                </Text>
                <Text style={styles.modalAgentTarget}>
                  Agent : {targetAgent?.prenom} {targetAgent?.nom} ({targetAgent?.email})
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setIsAssignModalOpen(false)}
              >
                <Ionicons name="close" size={20} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {/* STEP 1: SELECT PROJET */}
              <View style={styles.pickerSection}>
                <View style={styles.pickerSectionHeader}>
                  <View style={styles.stepNumberBadge}>
                    <Text style={styles.stepNumberText} weight="bold">
                      1
                    </Text>
                  </View>
                  <Text style={styles.pickerSectionTitle} weight="bold">
                    Sélectionner un Projet
                  </Text>
                </View>

                {projectsList.length > 0 ? (
                  <View style={styles.optionsList}>
                    {projectsList.map((proj) => {
                      const isSelected = selectedProjectId === proj.id;
                      return (
                        <TouchableOpacity
                          key={proj.id}
                          style={[
                            styles.optionCard,
                            isSelected && styles.optionCardSelected,
                          ]}
                          onPress={() => handleSelectProject(proj.id)}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                            color={isSelected ? Palette.primary : Palette.textMuted}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.optionTitle,
                                isSelected && { color: Palette.primary, fontWeight: 'bold' },
                              ]}
                            >
                              {proj.nom}
                            </Text>
                            <Text style={styles.optionSub}>
                              {proj.type_projet || 'Projet Linéaire'} &bull;{' '}
                              {proj.chantiers.length}{' '}
                              {proj.chantiers.length > 1 ? 'chantiers' : 'chantier'}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyPickerText}>
                    Aucun projet disponible sous votre responsabilité.
                  </Text>
                )}
              </View>

              {/* STEP 2: SELECT CHANTIER */}
              <View
                style={[
                  styles.pickerSection,
                  !selectedProjectId && styles.pickerSectionDisabled,
                ]}
              >
                <View style={styles.pickerSectionHeader}>
                  <View
                    style={[
                      styles.stepNumberBadge,
                      !selectedProjectId && styles.stepNumberBadgeDisabled,
                    ]}
                  >
                    <Text style={styles.stepNumberText} weight="bold">
                      2
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.pickerSectionTitle,
                      !selectedProjectId && { color: Palette.textMuted },
                    ]}
                    weight="bold"
                  >
                    Sélectionner un Chantier
                  </Text>
                </View>

                {selectedProjectId ? (
                  chantiersList.length > 0 ? (
                    <View style={styles.optionsList}>
                      {chantiersList.map((chan) => {
                        const isSelected = selectedChantierId === chan.id;
                        return (
                          <TouchableOpacity
                            key={chan.id}
                            style={[
                              styles.optionCard,
                              isSelected && styles.optionCardSelected,
                            ]}
                            onPress={() => handleSelectChantier(chan.id)}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={isSelected ? Palette.primary : Palette.textMuted}
                            />
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.optionTitle,
                                  isSelected && { color: Palette.primary, fontWeight: 'bold' },
                                ]}
                              >
                                {chan.nom}
                              </Text>
                              <Text style={styles.optionSub}>
                                {chan.troncons.length}{' '}
                                {chan.troncons.length > 1 ? 'tronçons découpés' : 'tronçon'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.emptyPickerText}>
                      Ce projet n'a aucun chantier configuré.
                    </Text>
                  )
                ) : (
                  <Text style={styles.emptyPickerHint}>
                    Veuillez d'abord sélectionner un projet ci-dessus.
                  </Text>
                )}
              </View>

              {/* STEP 3: SELECT TRONÇON */}
              <View
                style={[
                  styles.pickerSection,
                  !selectedChantierId && styles.pickerSectionDisabled,
                ]}
              >
                <View style={styles.pickerSectionHeader}>
                  <View
                    style={[
                      styles.stepNumberBadge,
                      !selectedChantierId && styles.stepNumberBadgeDisabled,
                    ]}
                  >
                    <Text style={styles.stepNumberText} weight="bold">
                      3
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.pickerSectionTitle,
                      !selectedChantierId && { color: Palette.textMuted },
                    ]}
                    weight="bold"
                  >
                    Sélectionner un Tronçon
                  </Text>
                </View>

                {selectedChantierId ? (
                  tronconsList.length > 0 ? (
                    <View style={styles.optionsList}>
                      {tronconsList.map((tronc) => {
                        const isSelected = selectedTronconId === tronc.id;
                        return (
                          <TouchableOpacity
                            key={tronc.id}
                            style={[
                              styles.optionCard,
                              isSelected && styles.optionCardSelected,
                            ]}
                            onPress={() => setSelectedTronconId(tronc.id)}
                            activeOpacity={0.7}
                          >
                            <Ionicons
                              name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={isSelected ? Palette.primary : Palette.textMuted}
                            />
                            <View style={{ flex: 1 }}>
                              <Text
                                style={[
                                  styles.optionTitle,
                                  isSelected && { color: Palette.primary, fontWeight: 'bold' },
                                ]}
                              >
                                {tronc.nom}
                              </Text>
                              <Text style={styles.optionSub}>
                                {formatPK(tronc.pk_debut)} &rarr; {formatPK(tronc.pk_fin)}{' '}
                                ({tronc.length_km} km)
                              </Text>
                            </View>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.emptyPickerText}>
                      Ce chantier n'a aucun tronçon découpé pour le moment.
                    </Text>
                  )
                ) : (
                  <Text style={styles.emptyPickerHint}>
                    Veuillez d'abord sélectionner un chantier ci-dessus.
                  </Text>
                )}
              </View>

              {/* STEP 4: NOTES / CONSIGNES (OPTIONAL) */}
              <View style={styles.pickerSection}>
                <Text style={styles.notesLabel} weight="bold">
                  Consignes / Remarques pour l'agent (optionnel) :
                </Text>
                <TextInput
                  style={styles.notesInput}
                  placeholder="Ex : Relevé quotidien de la phase terrassement, contrôle du décapage..."
                  placeholderTextColor={Palette.textMuted}
                  multiline
                  numberOfLines={2}
                  value={assignNotes}
                  onChangeText={setAssignNotes}
                />
              </View>

              {/* ACTION BUTTONS */}
              <View style={styles.modalActionsRow}>
                <Button
                  title="Annuler"
                  variant="outline"
                  size="md"
                  onPress={() => setIsAssignModalOpen(false)}
                  style={{ flex: 1 }}
                />
                <Button
                  title={isSubmittingAssign ? 'Affectation...' : "Confirmer l'affectation"}
                  variant="primary"
                  size="md"
                  disabled={!selectedTronconId || isSubmittingAssign}
                  onPress={handleConfirmAssignment}
                  style={{ flex: 1.5 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── UNASSIGN CONFIRMATION MODAL ── */}
      <Modal
        visible={!!affToDelete}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setAffToDelete(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmModalContainer}>
            <View style={styles.confirmIconBox}>
              <Ionicons name="trash-outline" size={26} color="#DC2626" />
            </View>
            <Text style={styles.confirmTitle} weight="bold">
              Retirer l'affectation ?
            </Text>
            <Text style={styles.confirmMessage}>
              Voulez-vous retirer l'affectation de l'agent{' '}
              <Text weight="bold">{affToDelete?.agentName}</Text> sur le tronçon{' '}
              <Text weight="bold">« {affToDelete?.tronconNom} »</Text> ?
              {'\n\n'}
              <Text style={{ fontSize: 11, color: Palette.textMuted }}>
                Note : L'historique des observations déjà enregistrées par cet agent sur ce tronçon sera intégralement conservé.
              </Text>
            </Text>
            <View style={styles.confirmActionsRow}>
              <Button
                title="Annuler"
                variant="outline"
                size="md"
                onPress={() => setAffToDelete(null)}
                style={{ flex: 1 }}
              />
              <Button
                title={isDeletingAff ? 'Retrait...' : 'Confirmer le retrait'}
                variant="destructive"
                size="md"
                disabled={isDeletingAff}
                onPress={handleConfirmRemoveAssignment}
                style={{ flex: 1 }}
              />
            </View>
          </View>
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
    alignItems: 'center',
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
  },
  headerSubtitle: {
    fontSize: 10,
    color: Palette.primary,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  headerTitle: {
    fontSize: 20,
    color: Palette.text,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 50,
  },

  /* Summary Statistics Card */
  statsCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  statsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  statsCardTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    color: Palette.text,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E2E8F0',
  },

  /* Search Bar */
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: Palette.text,
    padding: 0,
  },

  /* List Header */
  listHeaderRow: {
    marginBottom: 12,
  },
  listTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  listSub: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },

  /* Agent Card */
  agentsList: {
    gap: 14,
  },
  agentCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  agentHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  agentAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#E2E8F0',
  },
  agentAvatarPlaceholder: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 15,
    color: Palette.primary,
  },
  agentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  agentName: {
    fontSize: 15,
    color: Palette.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 9,
  },
  agentEmail: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  agentPhone: {
    fontSize: 11,
    color: Palette.primary,
    marginTop: 1,
  },

  agentMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  assignedCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  assignedCountText: {
    fontSize: 11,
  },
  metaPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metaPillText: {
    fontSize: 11,
    color: Palette.textMuted,
  },

  /* Affectations Breakdown inside Agent Card */
  affectationsListContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
    gap: 8,
  },
  affectationsHeading: {
    fontSize: 11,
    color: Palette.text,
    marginBottom: 2,
  },
  affItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  affHierarchy: {
    fontSize: 10,
    color: Palette.primary,
    fontWeight: '600',
  },
  affTronconNom: {
    fontSize: 12,
    color: Palette.text,
    marginTop: 1,
  },
  affPkRange: {
    fontSize: 10,
    color: Palette.textMuted,
    fontWeight: 'normal',
  },
  affNotes: {
    fontSize: 10,
    color: Palette.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
  unassignMiniBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
  },

  assignBtn: {
    width: '100%',
  },

  emptyCard: {
    padding: 30,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    fontSize: 14,
    color: Palette.text,
    fontWeight: 'bold',
    marginTop: 10,
  },
  emptySubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
  },

  /* Assignment Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  modalAgentTarget: {
    fontSize: 12,
    color: Palette.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  modalCloseBtn: {
    padding: 6,
    borderRadius: 15,
    backgroundColor: '#F1F5F9',
  },
  modalScroll: {
    maxHeight: 520,
  },

  /* Picker Sections */
  pickerSection: {
    marginBottom: 16,
  },
  pickerSectionDisabled: {
    opacity: 0.5,
  },
  pickerSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  stepNumberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberBadgeDisabled: {
    backgroundColor: '#94A3B8',
  },
  stepNumberText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  pickerSectionTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  optionsList: {
    gap: 6,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
  },
  optionCardSelected: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderColor: Palette.primary,
  },
  optionTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  optionSub: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  emptyPickerText: {
    fontSize: 11,
    color: Palette.textMuted,
    fontStyle: 'italic',
    paddingLeft: 30,
  },
  emptyPickerHint: {
    fontSize: 11,
    color: Palette.textMuted,
    fontStyle: 'italic',
    paddingLeft: 30,
  },
  notesLabel: {
    fontSize: 12,
    color: Palette.text,
    marginBottom: 6,
  },
  notesInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    fontSize: 12,
    color: Palette.text,
    minHeight: 50,
    textAlignVertical: 'top',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 16,
  },

  /* Unassign Confirmation Modal */
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  confirmModalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  confirmIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    color: Palette.text,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 18,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
});
