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
  Image,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeleteConfirmationModal } from '@/components/ui/delete-confirmation-modal';
import { Palette } from '@/constants/theme';
import { api, ResponsableDashboardData } from '@/services/api';
import { InteractiveGisMap } from '@/components/gis/InteractiveGisMap';

export default function ResponsableDashboardScreen() {
  const router = useRouter();
  const { token, user, logout } = useAuth();

  const [data, setData] = useState<ResponsableDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'projets' | 'chantiers' | 'observations' | 'reclamations'>('projets');

  // ── Bulk-delete state ──
  const [projDeleteMode, setProjDeleteMode]     = useState(false);
  const [projDeleteSearch, setProjDeleteSearch] = useState('');
  const [projSelectedIds, setProjSelectedIds]   = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting]             = useState(false);
  const [showProjConfirmModal, setShowProjConfirmModal] = useState(false);

  const fetchDashboardData = useCallback(async (isRefresh = false) => {
    if (!token) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const res = await api.getResponsableDashboard(token);
      setData(res);
    } catch (err: any) {
      console.error('Erreur chargement dashboard responsable:', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token]);

  // ── Filtered project list for delete-mode search ──
  const projDeleteFiltered = useMemo(() => {
    const q = projDeleteSearch.toLowerCase().trim();
    const list = data?.projects || [];
    if (!q) return list;
    return list.filter(
      (p: any) => p.nom.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q))
    );
  }, [data?.projects, projDeleteSearch]);

  const selectedProjList = useMemo(() => {
    const list = data?.projects || [];
    return list.filter((p: any) => projSelectedIds.has(p.id));
  }, [data?.projects, projSelectedIds]);

  const enterProjDeleteMode = () => { setProjDeleteMode(true); setProjDeleteSearch(''); setProjSelectedIds(new Set()); };
  const exitProjDeleteMode  = () => { setProjDeleteMode(false); setProjDeleteSearch(''); setProjSelectedIds(new Set()); setShowProjConfirmModal(false); };

  const toggleProjSelect = (id: number) => {
    setProjSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleProjSelectAll = () => {
    if (projSelectedIds.size === projDeleteFiltered.length) {
      setProjSelectedIds(new Set());
    } else {
      setProjSelectedIds(new Set(projDeleteFiltered.map((p: any) => p.id)));
    }
  };

  const handleOpenProjConfirmModal = () => {
    if (projSelectedIds.size === 0) return;
    setShowProjConfirmModal(true);
  };

  const handleExecuteProjDeletion = async () => {
    if (projSelectedIds.size === 0 || !token) return;
    const count = projSelectedIds.size;
    const idsSnapshot = Array.from(projSelectedIds) as number[];
    const idsSet = new Set(idsSnapshot);

    setIsDeleting(true);
    try {
      console.log('[BulkDelete Responsable] Sending ids:', idsSnapshot);
      await api.bulkDeleteProjects(token, idsSnapshot);
      setData((prev) =>
        prev
          ? {
              ...prev,
              projects: prev.projects.filter((p: any) => !idsSet.has(p.id)),
              stats: { ...prev.stats, totalProjects: Math.max(0, prev.stats.totalProjects - count) },
            }
          : prev
      );
      setShowProjConfirmModal(false);
      exitProjDeleteMode();
    } catch (err: any) {
      console.error('[BulkDelete Responsable] Error:', err.message);
      Alert.alert('Erreur', err.message || 'La suppression a échoué.');
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (isLoading && !isRefreshing && !data) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement de votre espace Responsable...</Text>
      </SafeAreaView>
    );
  }

  const stats = data?.stats || {
    totalProjects: 0,
    totalChantiers: 0,
    chantiersPrets: 0,
    avancementMoyen: 0,
    totalObservations: 0,
    totalReclamations: 0,
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Custom Styled Delete Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showProjConfirmModal}
        title={
          selectedProjList.length > 1
            ? `Supprimer ${selectedProjList.length} projets ?`
            : `Supprimer « ${selectedProjList[0]?.nom || 'ce projet'} » ?`
        }
        subtitle="Cette action est irréversible. Les chantiers, tronçons, observations et rapports associés seront définitivement supprimés."
        items={selectedProjList.map((p: any) => p.nom)}
        isDeleting={isDeleting}
        confirmText={
          selectedProjList.length > 1
            ? `Supprimer (${selectedProjList.length})`
            : "Supprimer définitivement"
        }
        cancelText="Annuler"
        onConfirm={handleExecuteProjDeletion}
        onCancel={() => setShowProjConfirmModal(false)}
      />
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.roleBadge}>
            <Ionicons name="briefcase" size={12} color="#FFFFFF" />
            <Text style={styles.roleBadgeText}>RESPONSABLE DE PROJET</Text>
          </View>
          <Text variant="h1" style={styles.headerTitle}>
            Espace Responsable
          </Text>
          <Text variant="subtitle" style={styles.headerSubtitle}>
            Bonjour, {user?.prenom} {user?.nom} • Gestion de projets & GIS
          </Text>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={Palette.textMuted} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDashboardData(true)}
            colors={[Palette.primary]}
          />
        }
      >
        {/* Quick Action Banner */}
        <Card variant="elevated" style={styles.quickActionCard}>
          <View style={styles.quickActionContent}>
            <View style={styles.quickActionIconWrapper}>
              <Ionicons name="add-circle" size={32} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickActionTitle} weight="bold">
                Créer un nouveau projet
              </Text>
              <Text style={styles.quickActionSubtitle}>
                Définissez un nouvel axe d'infrastructure et configurez vos chantiers.
              </Text>
            </View>
            <Button
              title="+ Projet"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/responsable/projet/create' as any)}
              style={styles.quickActionBtn}
            />
          </View>
        </Card>

        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          <Card variant="flat" style={styles.statCard}>
            <View style={[styles.statIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="folder" size={20} color="#2563EB" />
            </View>
            <Text style={styles.statValue} weight="bold">
              {stats.totalProjects}
            </Text>
            <Text style={styles.statLabel}>Mes Projets</Text>
          </Card>

          <Card variant="flat" style={styles.statCard}>
            <View style={[styles.statIconBadge, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="construct" size={20} color="#16A34A" />
            </View>
            <Text style={styles.statValue} weight="bold">
              {stats.totalChantiers}
            </Text>
            <Text style={styles.statLabel}>Mes Chantiers</Text>
          </Card>

          <Card variant="flat" style={styles.statCard}>
            <View style={[styles.statIconBadge, { backgroundColor: '#FAF5FF' }]}>
              <Ionicons name="trending-up" size={20} color="#9333EA" />
            </View>
            <Text style={styles.statValue} weight="bold">
              {stats.avancementMoyen}%
            </Text>
            <Text style={styles.statLabel}>Avancement</Text>
          </Card>

          <Card variant="flat" style={styles.statCard}>
            <View style={[styles.statIconBadge, { backgroundColor: '#FEF2F2' }]}>
              <Ionicons name="alert-circle" size={20} color="#DC2626" />
            </View>
            <Text style={styles.statValue} weight="bold">
              {stats.totalReclamations}
            </Text>
            <Text style={styles.statLabel}>Réclamations</Text>
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

        {/* Interactive GIS Overview */}
        <Card variant="elevated" style={styles.mapCard}>
          <View style={styles.mapCardHeader}>
            <View style={styles.mapCardHeaderLeft}>
              <Ionicons name="map" size={20} color={Palette.primary} />
              <Text variant="h2" style={styles.mapCardTitle}>
                Vue Cartographique & GIS
              </Text>
            </View>
            <View style={styles.gisReadyBadge}>
              <Ionicons name="checkmark-circle" size={14} color="#16A34A" />
              <Text style={styles.gisReadyBadgeText}>
                {stats.chantiersPrets} chantiers prêts
              </Text>
            </View>
          </View>

          <InteractiveGisMap height={220} />

          <Text style={styles.mapHint}>
            💡 Sélectionnez un chantier ci-dessous pour configurer son tracé SIG ou ajuster ses tronçons.
          </Text>
        </Card>

        {/* Tab Navigation */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'projets' && styles.tabItemActive]}
            onPress={() => setActiveTab('projets')}
          >
            <Ionicons
              name="folder-outline"
              size={18}
              color={activeTab === 'projets' ? Palette.primary : Palette.textMuted}
            />
            <Text
              style={[styles.tabText, activeTab === 'projets' && styles.tabTextActive]}
              weight={activeTab === 'projets' ? 'bold' : 'normal'}
            >
              Projets ({data?.projects?.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'chantiers' && styles.tabItemActive]}
            onPress={() => setActiveTab('chantiers')}
          >
            <Ionicons
              name="construct-outline"
              size={18}
              color={activeTab === 'chantiers' ? Palette.primary : Palette.textMuted}
            />
            <Text
              style={[styles.tabText, activeTab === 'chantiers' && styles.tabTextActive]}
              weight={activeTab === 'chantiers' ? 'bold' : 'normal'}
            >
              Chantiers ({data?.chantiers?.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'observations' && styles.tabItemActive]}
            onPress={() => setActiveTab('observations')}
          >
            <Ionicons
              name="eye-outline"
              size={18}
              color={activeTab === 'observations' ? Palette.primary : Palette.textMuted}
            />
            <Text
              style={[styles.tabText, activeTab === 'observations' && styles.tabTextActive]}
              weight={activeTab === 'observations' ? 'bold' : 'normal'}
            >
              Terrain ({data?.observations?.length || 0})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabItem, activeTab === 'reclamations' && styles.tabItemActive]}
            onPress={() => setActiveTab('reclamations')}
          >
            <Ionicons
              name="alert-circle-outline"
              size={18}
              color={activeTab === 'reclamations' ? Palette.primary : Palette.textMuted}
            />
            <Text
              style={[styles.tabText, activeTab === 'reclamations' && styles.tabTextActive]}
              weight={activeTab === 'reclamations' ? 'bold' : 'normal'}
            >
              Alertes ({data?.reclamations?.length || 0})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content: Projets */}
        {activeTab === 'projets' && (
          <View style={styles.tabContent}>

            {/* ── Header bar: Nouveau + Supprimer / delete-mode banner ── */}
            {!projDeleteMode ? (
              <View style={styles.projTabHeader}>
                <Button
                  title="+ Nouveau"
                  variant="primary"
                  size="sm"
                  onPress={() => router.push('/responsable/projet/create' as any)}
                />
                {(data?.projects?.length ?? 0) > 0 && (
                  <TouchableOpacity style={styles.projDeleteModeBtn} onPress={enterProjDeleteMode}>
                    <Ionicons name="trash-outline" size={14} color="#DC2626" />
                    <Text style={styles.projDeleteModeBtnText} weight="bold">Supprimer</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <View style={styles.projDeleteBanner}>
                {/* Search */}
                <View style={styles.projDeleteBannerTop}>
                  <View style={styles.projDeleteSearchBox}>
                    <Ionicons name="search-outline" size={16} color={Palette.textMuted} style={{ marginRight: 6 }} />
                    <TextInput
                      style={styles.projDeleteSearchInput}
                      placeholder="Rechercher un projet..."
                      placeholderTextColor={Palette.textMuted}
                      value={projDeleteSearch}
                      onChangeText={setProjDeleteSearch}
                      autoFocus
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    {projDeleteSearch.length > 0 && (
                      <TouchableOpacity onPress={() => setProjDeleteSearch('')}>
                        <Ionicons name="close-circle" size={16} color={Palette.textMuted} />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity style={styles.projCancelBtn} onPress={exitProjDeleteMode}>
                    <Text style={styles.projCancelBtnText} weight="semibold">Annuler</Text>
                  </TouchableOpacity>
                </View>

                {/* Select-all + count */}
                <View style={styles.projSelectionRow}>
                  <TouchableOpacity style={styles.projSelectAllBtn} onPress={toggleProjSelectAll}>
                    <View style={[
                      styles.projCheckbox,
                      projSelectedIds.size === projDeleteFiltered.length && projDeleteFiltered.length > 0 && styles.projCheckboxChecked,
                    ]}>
                      {projSelectedIds.size === projDeleteFiltered.length && projDeleteFiltered.length > 0 && (
                        <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                      )}
                    </View>
                    <Text style={styles.projSelectAllText} weight="medium">Tout sélectionner</Text>
                  </TouchableOpacity>
                  {projSelectedIds.size > 0 ? (
                    <View style={styles.projCountBadge}>
                      <Text style={styles.projCountText} weight="bold">
                        {projSelectedIds.size} sélectionné{projSelectedIds.size > 1 ? 's' : ''}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.projSelectHint}>Sélectionnez des projets</Text>
                  )}
                </View>

                {/* Bulk-delete CTA */}
                {projSelectedIds.size > 0 && (
                  <TouchableOpacity
                    style={[styles.projBulkDeleteBtn, isDeleting && { opacity: 0.7 }]}
                    onPress={handleOpenProjConfirmModal}
                    disabled={isDeleting}
                  >
                    {isDeleting
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Ionicons name="trash" size={16} color="#FFFFFF" />
                    }
                    <Text style={styles.projBulkDeleteBtnText} weight="bold">
                      {isDeleting ? 'Suppression...' : `Supprimer la sélection (${projSelectedIds.size})`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── Project list ── */}
            {data?.projects && data.projects.length > 0 ? (
              (projDeleteMode ? projDeleteFiltered : data.projects).map((proj: any) => {
                const isSelected = projSelectedIds.has(proj.id);
                return (
                  <TouchableOpacity
                    key={proj.id}
                    activeOpacity={projDeleteMode ? 0.8 : 1}
                    onPress={projDeleteMode ? () => toggleProjSelect(proj.id) : undefined}
                  >
                    <Card
                      variant="elevated"
                      style={[
                        styles.itemCard,
                        projDeleteMode && isSelected && styles.itemCardSelected,
                      ]}
                    >
                      <View style={styles.itemHeader}>
                        {projDeleteMode && (
                          <View style={[styles.projCheckbox, isSelected && styles.projCheckboxChecked]}>
                            {isSelected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text variant="h2" style={[styles.itemTitle, projDeleteMode && isSelected && { color: '#991B1B' }]}>
                            {proj.nom}
                          </Text>
                          {proj.description ? (
                            <Text style={styles.itemDescription} numberOfLines={2}>{proj.description}</Text>
                          ) : null}
                        </View>
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusBadgeText}>{proj.statut || 'En cours'}</Text>
                        </View>
                      </View>

                      <View style={styles.itemMetaRow}>
                        <View style={styles.metaBadge}>
                          <Ionicons name="business-outline" size={14} color={Palette.textMuted} />
                          <Text style={styles.metaBadgeText}>{proj.nombre_chantiers || 0} chantiers</Text>
                        </View>
                        <View style={styles.metaBadge}>
                          <Ionicons name="trending-up-outline" size={14} color={Palette.primary} />
                          <Text style={styles.metaBadgeText}>{proj.avancement_moyen || 0}% avancement</Text>
                        </View>
                        {proj.date_debut && (
                          <View style={styles.metaBadge}>
                            <Ionicons name="calendar-outline" size={14} color={Palette.textMuted} />
                            <Text style={styles.metaBadgeText}>{proj.date_debut}</Text>
                          </View>
                        )}
                      </View>

                      {!projDeleteMode && (
                        <View style={styles.itemActions}>
                          <View style={styles.itemActionsLeft}>
                            <Button
                              title="+ Chantier"
                              variant="primary"
                              size="sm"
                              onPress={() => router.push(`/responsable/projet/${proj.id}/chantier/create` as any)}
                            />
                            <Button
                              title="Consulter"
                              variant="secondary"
                              size="sm"
                              onPress={() => router.push(`/responsable/projet/${proj.id}` as any)}
                            />
                          </View>
                        </View>
                      )}

                      {projDeleteMode && isSelected && (
                        <View style={styles.projSelectedIndicator}>
                          <Ionicons name="checkmark-circle" size={13} color="#DC2626" />
                          <Text style={styles.projSelectedIndicatorText} weight="semibold">Sélectionné pour suppression</Text>
                        </View>
                      )}
                    </Card>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="folder-open-outline" size={48} color={Palette.textMuted} />
                <Text style={styles.emptyTitle}>Aucun projet pour le moment</Text>
                <Text style={styles.emptySubtitle}>
                  Commencez par créer votre premier projet de construction ou d'infrastructure.
                </Text>
                <Button
                  title="Créer un Projet"
                  variant="primary"
                  size="md"
                  onPress={() => router.push('/responsable/projet/create' as any)}
                  style={{ marginTop: 12 }}
                />
              </Card>
            )}
          </View>
        )}

        {/* Tab Content: Chantiers */}
        {activeTab === 'chantiers' && (
          <View style={styles.tabContent}>
            {data?.chantiers && data.chantiers.length > 0 ? (
              data.chantiers.map((ch) => {
                const isGisReady = ch.gis_status === 'PRET_POUR_SUIVI';
                const hasAlignment = ch.gis_status === 'ALIGNEMENT_IMPORTE';

                return (
                  <Card key={ch.id} variant="elevated" style={styles.itemCard}>
                    <View style={styles.itemHeader}>
                      <View style={{ flex: 1 }}>
                        <Text variant="h2" style={styles.itemTitle}>
                          {ch.nom}
                        </Text>
                        <Text style={styles.itemProjectSubtitle}>Projet : {ch.projet_nom || '—'}</Text>
                      </View>

                      {/* GIS Setup Status Badge */}
                      <View
                        style={[
                          styles.gisStatusBadge,
                          isGisReady
                            ? styles.gisStatusReady
                            : hasAlignment
                            ? styles.gisStatusImported
                            : styles.gisStatusUnset,
                        ]}
                      >
                        <Ionicons
                          name={isGisReady ? 'checkmark-circle' : hasAlignment ? 'git-branch' : 'alert-circle'}
                          size={12}
                          color={isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706'}
                        />
                        <Text
                          style={[
                            styles.gisStatusBadgeText,
                            {
                              color: isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706',
                            },
                          ]}
                          weight="semibold"
                        >
                          {isGisReady
                            ? 'GIS Prêt'
                            : hasAlignment
                            ? 'Alignement prêt'
                            : 'GIS non configuré'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.itemMetaRow}>
                      <View style={styles.metaBadge}>
                        <Ionicons name="speedometer-outline" size={14} color={Palette.primary} />
                        <Text style={styles.metaBadgeText}>{ch.avancement || 0}% avancement</Text>
                      </View>

                      {ch.length_km ? (
                        <View style={styles.metaBadge}>
                          <Ionicons name="git-network-outline" size={14} color="#0284C7" />
                          <Text style={styles.metaBadgeText}>
                            {ch.length_km} km ({ch.nombre_troncons} tronçons)
                          </Text>
                        </View>
                      ) : null}

                      {ch.surface ? (
                        <View style={styles.metaBadge}>
                          <Ionicons name="cube-outline" size={14} color={Palette.textMuted} />
                          <Text style={styles.metaBadgeText}>{ch.surface} m²</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.itemActions}>
                      <Button
                        title={isGisReady ? 'Modifier GIS / Tronçons' : '⚙️ Configurer GIS'}
                        variant={isGisReady ? 'secondary' : 'primary'}
                        size="sm"
                        onPress={() => router.push(`/responsable/chantier/${ch.id}/gis` as any)}
                      />
                      <Button
                        title="Détails Chantier"
                        variant="secondary"
                        size="sm"
                        onPress={() => router.push(`/responsable/chantier/${ch.id}` as any)}
                      />
                    </View>
                  </Card>
                );
              })
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="construct-outline" size={48} color={Palette.textMuted} />
                <Text style={styles.emptyTitle}>Aucun chantier configuré</Text>
                <Text style={styles.emptySubtitle}>
                  Ajoutez un chantier à l'un de vos projets pour démarrer la configuration spatiale.
                </Text>
              </Card>
            )}
          </View>
        )}

        {/* Tab Content: Observations Terrain */}
        {activeTab === 'observations' && (
          <View style={styles.tabContent}>
            {data?.observations && data.observations.length > 0 ? (
              data.observations.map((obs) => (
                <Card key={obs.id} variant="flat" style={styles.obsCard}>
                  <View style={styles.obsHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.obsChantier} weight="bold">
                        {obs.chantier_nom} • {obs.troncon_nom || 'Tracé'}
                      </Text>
                      <Text style={styles.obsAgent}>Par {obs.agent_nom || 'Agent Terrain'}</Text>
                    </View>
                    <Text style={styles.obsDate}>{obs.date_heure}</Text>
                  </View>

                  <Text style={styles.obsComment}>{obs.commentaire || 'Aucun commentaire.'}</Text>

                  <View style={styles.obsFooter}>
                    <View style={styles.pkBadge}>
                      <Text style={styles.pkBadgeText}>
                        Chainage : {obs.chainage ? `PK ${obs.chainage}` : 'Non spécifié'}
                      </Text>
                    </View>
                    <View style={styles.statutPill}>
                      <Text style={styles.statutPillText}>{obs.statut || 'Enregistré'}</Text>
                    </View>
                  </View>
                </Card>
              ))
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="eye-off-outline" size={48} color={Palette.textMuted} />
                <Text style={styles.emptyTitle}>Aucune observation terrain</Text>
                <Text style={styles.emptySubtitle}>
                  Les relevés et observations créés par les Agents Terrain s'afficheront ici.
                </Text>
              </Card>
            )}
          </View>
        )}

        {/* Tab Content: Réclamations */}
        {activeTab === 'reclamations' && (
          <View style={styles.tabContent}>
            {data?.reclamations && data.reclamations.length > 0 ? (
              data.reclamations.map((rec) => (
                <Card key={rec.id} variant="flat" style={styles.recCard}>
                  <View style={styles.recHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.recTitle} weight="bold">
                        {rec.titre}
                      </Text>
                      <Text style={styles.recChantier}>
                        Chantier : {rec.chantier_nom} • Client : {rec.client_nom || 'Client'}
                      </Text>
                    </View>
                    <View style={styles.recStatutBadge}>
                      <Text style={styles.recStatutText}>{rec.statut || 'Ouverte'}</Text>
                    </View>
                  </View>

                  <Text style={styles.recDesc}>{rec.description}</Text>
                  <Text style={styles.recDate}>Signalée le {rec.date_creation}</Text>
                </Card>
              ))
            ) : (
              <Card variant="flat" style={styles.emptyCard}>
                <Ionicons name="checkmark-done-circle-outline" size={48} color="#16A34A" />
                <Text style={styles.emptyTitle}>Aucune réclamation active</Text>
                <Text style={styles.emptySubtitle}>
                  Toutes les réclamations clients sur vos chantiers sont résolues.
                </Text>
              </Card>
            )}
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
  loadingContainer: {
    flex: 1,
    backgroundColor: Palette.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: Palette.textMuted,
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flex: 1,
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
  headerTitle: {
    color: Palette.text,
    fontSize: 22,
  },
  headerSubtitle: {
    marginTop: 2,
    color: Palette.textMuted,
    fontSize: 13,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  quickActionCard: {
    backgroundColor: Palette.primary,
    padding: 16,
    marginBottom: 20,
    borderRadius: 16,
  },
  quickActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickActionIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  quickActionSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    marginTop: 2,
  },
  quickActionBtn: {
    backgroundColor: '#FFFFFF',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    padding: 14,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  statIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 20,
    color: Palette.text,
  },
  statLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  mapCard: {
    padding: 16,
    marginBottom: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  mapCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  mapCardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapCardTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  gisReadyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gisReadyBadgeText: {
    color: '#16A34A',
    fontSize: 11,
    fontWeight: 'bold',
  },
  mapHint: {
    marginTop: 10,
    fontSize: 12,
    color: Palette.textMuted,
    fontStyle: 'italic',
  },
  tabContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    marginBottom: 16,
  },
  tabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabItemActive: {
    borderBottomColor: Palette.primary,
  },
  tabText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: Palette.primary,
  },
  tabContent: {
    gap: 14,
  },
  itemCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  itemDescription: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 4,
  },
  itemProjectSubtitle: {
    fontSize: 12,
    color: Palette.primary,
    marginTop: 2,
    fontWeight: '500',
  },
  statusBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '600',
  },
  gisStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  gisStatusReady: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
  },
  gisStatusImported: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  gisStatusUnset: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FDE68A',
  },
  gisStatusBadgeText: {
    fontSize: 11,
  },
  itemMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
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
  },
  metaBadgeText: {
    fontSize: 12,
    color: Palette.text,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  itemActionsLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'nowrap',
  },
  emptyCard: {
    alignItems: 'center',
    padding: 32,
    borderRadius: 16,
  },
  itemCardSelected: {
    backgroundColor: '#FFF5F5',
    borderLeftColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  // ── Projets tab header ──
  projTabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  projDeleteModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  projDeleteModeBtnText: { color: '#DC2626', fontSize: 13 },
  // ── Delete banner ──
  projDeleteBanner: {
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FED7D7',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  projDeleteBannerTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projDeleteSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  projDeleteSearchInput: { flex: 1, fontSize: 13, color: Palette.text, padding: 0 },
  projCancelBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Palette.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  projCancelBtnText: { color: Palette.text, fontSize: 13 },
  projSelectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projSelectAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  projSelectAllText: { fontSize: 13, color: Palette.text },
  projSelectHint: { fontSize: 12, color: Palette.textMuted, fontStyle: 'italic' },
  projCountBadge: { backgroundColor: '#DC2626', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  projCountText: { color: '#FFFFFF', fontSize: 12 },
  projBulkDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    elevation: 4,
  },
  projBulkDeleteBtnText: { color: '#FFFFFF', fontSize: 14 },
  projCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  projCheckboxChecked: { backgroundColor: '#DC2626', borderColor: '#DC2626' },
  projSelectedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#FECACA',
  },
  projSelectedIndicatorText: { fontSize: 12, color: '#DC2626' },
  emptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: Palette.text,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  obsCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  obsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  obsChantier: {
    fontSize: 13,
    color: Palette.text,
  },
  obsAgent: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  obsDate: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  obsComment: {
    fontSize: 13,
    color: '#334155',
    marginVertical: 6,
  },
  obsFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  pkBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  pkBadgeText: {
    color: '#0369A1',
    fontSize: 11,
    fontWeight: 'bold',
  },
  statutPill: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statutPillText: {
    color: Palette.textMuted,
    fontSize: 11,
  },
  recCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  recHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  recTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  recChantier: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  recStatutBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  recStatutText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: 'bold',
  },
  recDesc: {
    fontSize: 13,
    color: '#475569',
    marginVertical: 4,
  },
  recDate: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 4,
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
