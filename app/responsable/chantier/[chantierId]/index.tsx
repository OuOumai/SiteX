import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
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
import { api, ChantierDetails, ChantierTroncon } from '@/services/api';
import { InteractiveGisMap, GisTronconSegment } from '@/components/gis/InteractiveGisMap';

function formatPK(val?: number | null): string {
  if (val === undefined || val === null) return 'PK 0+000';
  const num = Number(val);
  const km = Math.floor(num);
  const m = Math.round((num - km) * 1000);
  const mStr = m < 10 ? '00' + m : m < 100 ? '0' + m : '' + m;
  return `PK ${km}+${mStr}`;
}

export default function ChantierDetailResponsableScreen() {
  const { chantierId } = useLocalSearchParams<{ chantierId: string }>();
  const router = useRouter();
  const { token } = useAuth();

  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dMaxPosition, setDMaxPosition] = useState('50');
  const [isSavingDMax, setIsSavingDMax] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [isManaging, setIsManaging] = useState(false);
  const showChantierList = () => {
    if (chantier?.projet_id) router.replace(`/responsable/projet/${chantier.projet_id}` as any);
    else router.replace('/(tabs)/projects' as any);
  };

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !chantierId) return;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setLoadError(null);

    try {
      const res = await api.getChantierDetails(token, chantierId);
      setChantier(res.chantier);
      setDMaxPosition(String(res.chantier.d_max_position_meters ?? 50));
      setNewName(res.chantier.nom || '');
    } catch (err: any) {
      setLoadError(err.message || 'Impossible de charger le chantier.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, chantierId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const saveDMax = async () => {
    if (!token || !chantierId) return;
    const value = Number(dMaxPosition);
    if (!Number.isFinite(value) || value <= 0) {
      Alert.alert('Valeur invalide', 'Saisissez une distance strictement positive en mètres.');
      return;
    }
    setIsSavingDMax(true);
    try {
      await api.updateChantierConfiguration(token, chantierId, { d_max_position_meters: value });
      setChantier((current) => current ? { ...current, d_max_position_meters: value } : current);
      Alert.alert('Configuration enregistrée', 'La distance maximale recommandée a été mise à jour.');
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de mettre à jour la configuration.');
    } finally {
      setIsSavingDMax(false);
    }
  };

  const renameChantier = async () => {
    if (!token || !chantierId || !newName.trim()) return;
    setIsManaging(true);
    try {
      const result = await api.renameResponsableChantier(token, chantierId, newName.trim());
      setChantier((current) => current ? { ...current, nom: result.chantier.nom } : current);
      setIsRenaming(false);
      if (Platform.OS === 'web') {
        window.alert(result.message);
        showChantierList();
      } else {
        Alert.alert('Chantier renommé', result.message, [{ text: 'OK', onPress: showChantierList }]);
      }
    } catch (err: any) { Alert.alert('Erreur', err.message || 'Impossible de renommer le chantier.'); }
    finally { setIsManaging(false); }
  };

  const deleteChantier = async () => {
      if (!token || !chantierId) return;
      setIsManaging(true);
      try {
        const result = await api.deleteResponsableChantier(token, chantierId);
        if (Platform.OS === 'web') {
          window.alert(result.message);
          showChantierList();
        } else {
          Alert.alert('Chantier supprimé', result.message, [{ text: 'OK', onPress: showChantierList }]);
        }
      } catch (err: any) { setIsManaging(false); Alert.alert('Erreur', err.message || 'Impossible de supprimer le chantier.'); }
  };

  const confirmDeleteChantier = () => {
    const message = `Cette action supprimera définitivement « ${chantier?.nom || ''} », tous ses tronçons, observations et données associées.`;
    if (Platform.OS === 'web') {
      if (window.confirm(`Supprimer le chantier ?\n\n${message}`)) void deleteChantier();
      return;
    }
    Alert.alert('Supprimer le chantier ?', message, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: deleteChantier },
    ]);
  };

  if (isLoading && !chantier) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Chargement du chantier...</Text>
      </SafeAreaView>
    );
  }

  if (!chantier && loadError) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <Ionicons name="cloud-offline-outline" size={44} color="#DC2626" />
        <Text style={styles.loadingText}>{loadError}</Text>
        <Button title="Réessayer" onPress={() => fetchDetails()} style={{ marginTop: 16 }} />
        <Button title="Retour" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
      </SafeAreaView>
    );
  }

  const troncons = chantier?.troncons || [];
  const isGisReady = chantier?.gis_status === 'PRET_POUR_SUIVI';
  const hasAlignment = chantier?.gis_status === 'ALIGNEMENT_IMPORTE';

  const mapSegments: GisTronconSegment[] = troncons.map((t: any, idx: number) => ({
    id: t.id || idx + 1,
    nom: t.nom,
    pk_debut: t.pk_debut,
    pk_fin: t.pk_fin,
    statut: t.statut || 'NON_COMMENCE',
    length_km: t.length_km,
    geometry: t.geometry,
  }));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.parentProjectText}>
            Projet : {chantier?.projet_nom || 'Projet'}
          </Text>
          <Text variant="h1" style={styles.headerTitle}>
            {chantier?.nom}
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
        {/* Status & GIS Badge */}
        <Card variant="elevated" style={styles.summaryCard}>
          <View style={styles.summaryHeader}>
            <View style={{ flex: 1 }}>
              <Text variant="h2" style={styles.chantierNameTitle}>
                {chantier?.nom}
              </Text>
              <Text style={styles.statutLabel}>
                ● {chantier?.statut || 'En attente'}
              </Text>
            </View>

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
                name={isGisReady ? 'checkmark-circle' : hasAlignment ? 'git-branch' : 'alert-circle'}
                size={12}
                color={isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706'}
              />
              <Text
                style={[
                  styles.gisBadgeText,
                  { color: isGisReady ? '#16A34A' : hasAlignment ? '#2563EB' : '#D97706' },
                ]}
                weight="semibold"
              >
                {isGisReady ? 'GIS Prêt' : hasAlignment ? 'Alignement prêt' : 'GIS non configuré'}
              </Text>
            </View>
          </View>
          {isRenaming && (
            <View style={styles.renameBox}>
              <Input label="Nouveau nom du chantier" value={newName} onChangeText={setNewName} />
              <View style={styles.manageActions}>
                <Button title="Annuler" variant="ghost" size="sm" onPress={() => setIsRenaming(false)} />
                <Button title="Enregistrer" size="sm" loading={isManaging} onPress={renameChantier} />
              </View>
            </View>
          )}
          {!isRenaming && (
            <View style={styles.manageActions}>
              <Button title="Renommer" variant="outline" size="sm" onPress={() => setIsRenaming(true)} />
              <Button title="Supprimer le chantier" variant="destructive" size="sm" loading={isManaging} onPress={confirmDeleteChantier} />
            </View>
          )}
        </Card>

        <Card variant="elevated" style={styles.infoCard}>
          <Text style={styles.sectionLabel} weight="bold">Configuration de la position terrain</Text>
          <Input
            label="Distance maximale recommandée (m)"
            value={dMaxPosition}
            onChangeText={setDMaxPosition}
            keyboardType="numeric"
            leftIcon={<Ionicons name="resize-outline" size={18} color={Palette.textMuted} />}
          />
          <Text style={styles.dMaxHelp}>
            {"Distance maximale entre la position GPS de l'agent et l'infrastructure."}
          </Text>
          <Button title="Enregistrer le seuil" size="sm" variant="secondary" loading={isSavingDMax} onPress={saveDMax} />
        </Card>

        {/* General Information */}
        <Card variant="elevated" style={styles.infoCard}>
          <Text style={styles.sectionLabel} weight="bold">
            Informations Générales
          </Text>
          <View style={styles.infoGrid}>
            <View style={styles.infoRow}>
              <Ionicons name="folder-outline" size={14} color={Palette.textMuted} />
              <Text style={styles.infoRowLabel}>Projet</Text>
              <Text style={styles.infoRowValue} weight="semibold">
                {chantier?.projet_nom || '—'}
              </Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="person-outline" size={14} color={Palette.textMuted} />
              <Text style={styles.infoRowLabel}>Responsable</Text>
              <Text style={styles.infoRowValue} weight="semibold">
                {chantier?.responsable_nom || 'Non assigné'}
              </Text>
            </View>
            {chantier?.date_debut && (
              <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={14} color={Palette.textMuted} />
                <Text style={styles.infoRowLabel}>Début</Text>
                <Text style={styles.infoRowValue} weight="semibold">
                  {chantier.date_debut}
                </Text>
              </View>
            )}
            {chantier?.date_fin_prevue && (
              <View style={styles.infoRow}>
                <Ionicons name="flag-outline" size={14} color={Palette.textMuted} />
                <Text style={styles.infoRowLabel}>Fin prévue</Text>
                <Text style={styles.infoRowValue} weight="semibold">
                  {chantier.date_fin_prevue}
                </Text>
              </View>
            )}
            {chantier?.surface_reference ? (
              <View style={styles.infoRow}>
                <Ionicons name="cube-outline" size={14} color={Palette.textMuted} />
                <Text style={styles.infoRowLabel}>Surface réf.</Text>
                <Text style={styles.infoRowValue} weight="semibold">
                  {chantier.surface_reference} m²
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        {/* Avancement Global */}
        <Card variant="elevated" style={styles.avancementCard}>
          <View style={styles.avancementHeader}>
            <Text style={styles.sectionLabel} weight="bold">Avancement Global</Text>
            <Text style={styles.avancementPercent} weight="bold">
              {chantier?.avancement || 0}%
            </Text>
          </View>
          {chantier?.avancement_date && (
            <Text style={styles.avancementDate}>
              Dernière mise à jour : {chantier.avancement_date}
            </Text>
          )}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.min(chantier?.avancement || 0, 100)}%` },
              ]}
            />
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={styles.metricSub}>Longueur Chantier</Text>
              <Text style={styles.metricValue} weight="bold">
                {chantier?.reference_alignment?.length_km || 0} km
              </Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricSub}>Tronçons</Text>
              <Text style={styles.metricValue} weight="bold">
                {troncons.length}
              </Text>
            </View>
          </View>
        </Card>

        {/* Accès Rapides */}
        <Text style={styles.quickAccessTitle} weight="bold">Accès rapides</Text>
        <View style={styles.quickAccessRow}>
          <TouchableOpacity
            style={styles.quickAccessCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/chantier/avancement/${chantierId}` as any)}
          >
            <View style={[styles.quickAccessIcon, { backgroundColor: '#F0FDF4' }]}>
              <Ionicons name="trending-up" size={22} color="#16A34A" />
            </View>
            <Text style={styles.quickAccessLabel} weight="bold">Avancement</Text>
            <Text style={styles.quickAccessSub}>{"Voir les statistiques et l'historique détaillé"}</Text>
            <Text style={styles.quickAccessLink} weight="semibold">Consulter →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAccessCard}
            activeOpacity={0.7}
            onPress={() => router.push(`/chantier/images/${chantierId}` as any)}
          >
            <View style={[styles.quickAccessIcon, { backgroundColor: '#EFF6FF' }]}>
              <Ionicons name="images-outline" size={22} color="#2563EB" />
            </View>
            <Text style={styles.quickAccessLabel} weight="bold">Images</Text>
            <Text style={styles.quickAccessSub}>Voir toutes les images du chantier</Text>
            <Text style={styles.quickAccessLink} weight="semibold">Consulter →</Text>
          </TouchableOpacity>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionButtonsRow}>
          <Button
            title={isGisReady ? '⚙️ Reconfigurer GIS / Découpage' : '⚙️ Configurer Tracé & Tronçons'}
            variant={isGisReady ? 'secondary' : 'primary'}
            size="md"
            onPress={() => router.push(`/responsable/chantier/${chantierId}/gis` as any)}
            style={{ marginBottom: 8 }}
          />
          <TouchableOpacity
            style={styles.mapButton}
            activeOpacity={0.85}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/map',
                params: {
                  chantierId: String(chantierId),
                  projectId: chantier?.projet_id ? String(chantier.projet_id) : undefined,
                },
              } as any)
            }
          >
            <Ionicons name="map-outline" size={20} color="#FFFFFF" />
            <Text style={styles.mapButtonText} weight="bold">
              Voir sur la carte
            </Text>
          </TouchableOpacity>
        </View>

        {/* Map Preview with Multi-layers & Legend */}
        {mapSegments.length > 0 && (
          <Card variant="elevated" style={styles.mapCard}>
            <View style={styles.mapCardHeader}>
              <Ionicons name="map" size={18} color={Palette.primary} />
              <Text style={styles.mapCardTitle} weight="bold">
                Vue Cartographique des Tronçons
              </Text>
            </View>
            <InteractiveGisMap
              height={230}
              aoiGeometry={chantier?.localisation}
              referenceGeometry={chantier?.reference_alignment?.geometry}
              troncons={mapSegments}
            />

            {/* Map Legend */}
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
                  <Text style={styles.legendText}>Retard / Alerte</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: '#94A3B8' }]} />
                  <Text style={styles.legendText}>Non commencé</Text>
                </View>
                <View style={styles.legendItem}>
                  <Text style={{ fontSize: 11, color: '#0284C7', fontWeight: 'bold' }}>➜</Text>
                  <Text style={styles.legendText}>Sens du tracé</Text>
                </View>
              </View>
            </View>
          </Card>
        )}

        {/* Tronçons List */}
        <View style={styles.sectionHeaderRow}>
          <Text variant="h2" style={styles.sectionTitle}>
            Tronçons du Chantier ({troncons.length})
          </Text>
        </View>

        {troncons.length > 0 ? (
          <View style={styles.tronconsList}>
            {troncons.map((t: ChantierTroncon) => {
              const statut = t.statut || 'NON_COMMENCE';
              const dotColor =
                statut === 'TERMINE'
                  ? '#16A34A'
                  : statut === 'EN_COURS'
                  ? '#F4A261'
                  : statut === 'PROBLEME'
                  ? '#DC2626'
                  : '#94A3B8';

              const segLenKm = t.length_km || (t.pk_debut !== null && t.pk_fin !== null ? Number((Number(t.pk_fin) - Number(t.pk_debut)).toFixed(3)) : null);

              return (
                <Card key={t.id} variant="elevated" style={styles.tronconCard}>
                  <View style={styles.tronconHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.tronconTitleRow}>
                        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
                        <Text variant="h3" style={styles.tronconTitle}>
                          {t.nom}
                        </Text>
                      </View>
                      <Text style={styles.tronconPk}>
                        Bornes : {formatPK(t.pk_debut)} &rarr; {formatPK(t.pk_fin)}
                      </Text>
                      {segLenKm !== null ? (
                        <Text style={styles.tronconLen}>
                          Longueur : {segLenKm} km
                        </Text>
                      ) : null}
                    </View>

                    <Button
                      title="Superviser →"
                      variant="primary"
                      size="sm"
                      onPress={() => router.push(`/responsable/troncon/${t.id}` as any)}
                    />
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <Card variant="flat" style={styles.emptyCard}>
            <Ionicons name="git-network-outline" size={40} color={Palette.textMuted} />
            <Text style={styles.emptyTitle}>Aucun tronçon découpé</Text>
            <Text style={styles.emptySubtitle}>
              {"Calibrez l'axe de référence et générez le découpage kilométrique des tronçons."}
            </Text>
            <Button
              title="Configurer GIS maintenant"
              variant="primary"
              size="sm"
              onPress={() => router.push(`/responsable/chantier/${chantierId}/gis` as any)}
              style={{ marginTop: 10 }}
            />
          </Card>
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
  parentProjectText: {
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
  summaryCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  renameBox: { marginTop: 14, gap: 10 },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  statutLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  chantierNameTitle: {
    fontSize: 17,
    color: Palette.text,
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
  // Info Card
  infoCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 13,
    color: Palette.text,
    marginBottom: 10,
  },
  infoGrid: {
    gap: 8,
  },
  dMaxHelp: {
    fontSize: 11,
    lineHeight: 16,
    color: Palette.textMuted,
    marginTop: -6,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoRowLabel: {
    fontSize: 12,
    color: Palette.textMuted,
    width: 85,
  },
  infoRowValue: {
    fontSize: 12,
    color: Palette.text,
    flex: 1,
  },
  // Avancement Card
  avancementCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 12,
  },
  avancementHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  avancementPercent: {
    fontSize: 18,
    color: Palette.primary,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Palette.primary,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  metricCell: {
    flex: 1,
  },
  metricSub: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  metricValue: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 2,
  },
  avancementDate: {
    fontSize: 11,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  // Quick Access
  quickAccessTitle: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 10,
  },
  quickAccessRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
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
  // Action Buttons
  actionButtonsRow: {
    marginBottom: 16,
    gap: 8,
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#16A34A',
  },
  mapButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
  },
  mapCard: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  mapCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  mapCardTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  tronconsList: {
    gap: 10,
  },
  tronconCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  tronconHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tronconTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tronconTitle: {
    fontSize: 14,
    color: Palette.text,
  },
  tronconPk: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 4,
    marginLeft: 16,
  },
  tronconLen: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginTop: 2,
    marginLeft: 16,
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
});
