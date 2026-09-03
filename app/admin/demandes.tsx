import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, Feather } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, AdminRoleRequest } from '@/services/api';

export default function AdminDemandesScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [demandes, setDemandes] = useState<AdminRoleRequest[]>([]);
  const [activeFilter, setActiveFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedDemande, setSelectedDemande] = useState<AdminRoleRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchDemandes = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.getAdminRoleRequests(token);
      setDemandes(data.demandes || []);
    } catch (err: any) {
      console.warn('Failed to load role requests:', err?.message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchDemandes();
  }, [fetchDemandes]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchDemandes();
  }, [fetchDemandes]);

  const filteredDemandes = demandes.filter((d) => {
    if (activeFilter === 'PENDING') {
      return d.statut === 'PENDING';
    }
    return true;
  });

  const pendingCount = demandes.filter((d) => d.statut === 'PENDING').length;

  const handleAccept = async (demande: AdminRoleRequest) => {
    const confirmAction = async () => {
      setIsProcessing(true);
      setActionMessage(null);
      try {
        if (!token) return;
        const res = await api.acceptAdminRoleRequest(token, demande.id);
        setActionMessage({
          type: 'success',
          text: `Demande acceptée ! Le rôle "${demande.requested_role_nom}" a été attribué à ${demande.applicant_prenom} ${demande.applicant_nom}.`,
        });
        setSelectedDemande(null);
        await fetchDemandes();
      } catch (err: any) {
        setActionMessage({
          type: 'error',
          text: err?.message || "Erreur lors de l'acceptation de la demande.",
        });
      } finally {
        setIsProcessing(false);
      }
    };

    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          `Confirmez-vous l'attribution du rôle "${demande.requested_role_nom}" à ${demande.applicant_prenom} ${demande.applicant_nom} ?`
        )
      ) {
        await confirmAction();
      }
      return;
    }

    Alert.alert(
      'Validation de la demande',
      `Attribuer le rôle "${demande.requested_role_nom}" à ${demande.applicant_prenom} ${demande.applicant_nom} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Valider & Attribuer',
          style: 'default',
          onPress: confirmAction,
        },
      ]
    );
  };

  const handleReject = async (demande: AdminRoleRequest) => {
    const confirmAction = async () => {
      setIsProcessing(true);
      setActionMessage(null);
      try {
        if (!token) return;
        await api.rejectAdminRoleRequest(token, demande.id);
        setActionMessage({
          type: 'success',
          text: `Demande de ${demande.applicant_prenom} ${demande.applicant_nom} refusée.`,
        });
        setSelectedDemande(null);
        await fetchDemandes();
      } catch (err: any) {
        setActionMessage({
          type: 'error',
          text: err?.message || 'Erreur lors du rejet de la demande.',
        });
      } finally {
        setIsProcessing(false);
      }
    };

    if (Platform.OS === 'web') {
      if (
        typeof window !== 'undefined' &&
        window.confirm(
          `Voulez-vous vraiment refuser la demande de rôle de ${demande.applicant_prenom} ${demande.applicant_nom} ?`
        )
      ) {
        await confirmAction();
      }
      return;
    }

    Alert.alert(
      'Refus de la demande',
      `Refuser la demande de rôle de ${demande.applicant_prenom} ${demande.applicant_nom} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: confirmAction,
        },
      ]
    );
  };

  const formatFrenchDate = (dateStr?: string | null) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getRoleBadgeStyle = (roleNom: string) => {
    switch (roleNom) {
      case 'Responsable':
        return { bg: 'rgba(23, 107, 91, 0.12)', border: 'rgba(23, 107, 91, 0.3)', text: '#176B5B' };
      case 'AgentTerrain':
      case 'Agent Terrain':
        return { bg: 'rgba(244, 162, 97, 0.15)', border: 'rgba(244, 162, 97, 0.4)', text: '#D97706' };
      case 'Client':
        return { bg: 'rgba(37, 99, 235, 0.12)', border: 'rgba(37, 99, 235, 0.3)', text: '#2563EB' };
      default:
        return { bg: '#F3F4F6', border: '#E5E7EB', text: '#4B5563' };
    }
  };

  const getStatusBadge = (statut: string) => {
    switch (statut) {
      case 'PENDING':
        return { label: 'En attente', bg: '#FEF3C7', text: '#B45309', icon: 'hourglass-outline' as const };
      case 'APPROVED':
        return { label: 'Acceptée', bg: '#D1FAE5', text: '#065F46', icon: 'checkmark-circle-outline' as const };
      case 'REJECTED':
        return { label: 'Refusée', bg: '#FEE2E2', text: '#991B1B', icon: 'close-circle-outline' as const };
      default:
        return { label: statut, bg: '#F3F4F6', text: '#4B5563', icon: 'help-circle-outline' as const };
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* ── 1. Top Header ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          activeOpacity={0.7}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text variant="h1" style={styles.headerTitle}>
            Demandes de rôles
          </Text>
          <Text style={styles.headerSubtitle}>
            Validation des attributions de profils opérationnels
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          activeOpacity={0.7}
          onPress={onRefresh}
        >
          <Ionicons name="refresh" size={18} color={Palette.primary} />
        </TouchableOpacity>
      </View>

      {/* Action Notification Banner */}
      {actionMessage && (
        <View
          style={[
            styles.actionBanner,
            actionMessage.type === 'success' ? styles.actionBannerSuccess : styles.actionBannerError,
          ]}
        >
          <Ionicons
            name={actionMessage.type === 'success' ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color={actionMessage.type === 'success' ? '#065F46' : '#991B1B'}
          />
          <Text
            style={[
              styles.actionBannerText,
              actionMessage.type === 'success' ? styles.actionBannerTextSuccess : styles.actionBannerTextError,
            ]}
          >
            {actionMessage.text}
          </Text>
          <TouchableOpacity onPress={() => setActionMessage(null)}>
            <Ionicons name="close" size={16} color={actionMessage.type === 'success' ? '#065F46' : '#991B1B'} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── 2. Filter Tabs ── */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, activeFilter === 'PENDING' && styles.tabBtnActive]}
          activeOpacity={0.8}
          onPress={() => setActiveFilter('PENDING')}
        >
          <Text
            weight="medium"
            style={[styles.tabText, activeFilter === 'PENDING' && styles.tabTextActive]}
          >
            En attente ({pendingCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeFilter === 'ALL' && styles.tabBtnActive]}
          activeOpacity={0.8}
          onPress={() => setActiveFilter('ALL')}
        >
          <Text
            weight="medium"
            style={[styles.tabText, activeFilter === 'ALL' && styles.tabTextActive]}
          >
            Toutes / Historique ({demandes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── 3. Requests List ── */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Palette.primary]}
            tintColor={Palette.primary}
          />
        }
      >
        {isLoading && !refreshing ? (
          <View style={styles.centerLoading}>
            <ActivityIndicator size="large" color={Palette.primary} />
            <Text style={styles.centerLoadingText}>Chargement des demandes...</Text>
          </View>
        ) : filteredDemandes.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle-outline" size={54} color={Palette.primary} />
            <Text weight="bold" style={styles.emptyTitle}>
              {activeFilter === 'PENDING'
                ? 'Aucune demande de rôle en attente.'
                : 'Aucune demande enregistrée.'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === 'PENDING'
                ? 'Toutes les demandes de profils utilisateurs ont été traitées.'
                : 'Les nouvelles demandes soumises apparaîtront ici.'}
            </Text>
          </View>
        ) : (
          filteredDemandes.map((demande) => {
            const roleStyle = getRoleBadgeStyle(demande.requested_role_nom);
            const statusStyle = getStatusBadge(demande.statut);
            const isPending = demande.statut === 'PENDING';

            return (
              <TouchableOpacity
                key={demande.id}
                activeOpacity={0.88}
                onPress={() => setSelectedDemande(demande)}
              >
                <Card
                  variant="elevated"
                  style={[
                    styles.requestCard,
                    isPending && styles.requestCardPending,
                  ]}
                >
                  {/* Top row: Applicant identity + Status */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.applicantAvatar}>
                      <Text style={styles.avatarInitials} weight="bold">
                        {(demande.applicant_prenom?.[0] || 'U') + (demande.applicant_nom?.[0] || 'S')}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text weight="bold" style={styles.applicantName}>
                        {demande.applicant_prenom} {demande.applicant_nom}
                      </Text>
                      <Text style={styles.applicantEmail}>{demande.applicant_email}</Text>
                    </View>

                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusStyle.bg },
                      ]}
                    >
                      <Ionicons name={statusStyle.icon} size={12} color={statusStyle.text} />
                      <Text style={[styles.statusBadgeText, { color: statusStyle.text }]} weight="medium">
                        {statusStyle.label}
                      </Text>
                    </View>
                  </View>

                  {/* Metadata Row: Requested Role + Date */}
                  <View style={styles.cardMetaRow}>
                    <View style={styles.roleBox}>
                      <Text style={styles.metaLabel}>RÔLE DEMANDÉ</Text>
                      <View
                        style={[
                          styles.roleBadge,
                          {
                            backgroundColor: roleStyle.bg,
                            borderColor: roleStyle.border,
                          },
                        ]}
                      >
                        <Text style={[styles.roleBadgeText, { color: roleStyle.text }]} weight="bold">
                          {demande.requested_role_nom}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.dateBox}>
                      <Text style={styles.metaLabel}>DATE DEMANDE</Text>
                      <Text style={styles.metaValue}>
                        {formatFrenchDate(demande.date_demande)}
                      </Text>
                    </View>
                  </View>

                  {/* Professional Context info if present */}
                  {(demande.applicant_entreprise || demande.applicant_poste) && (
                    <View style={styles.proInfoRow}>
                      <Feather name="briefcase" size={13} color={Palette.textMuted} />
                      <Text style={styles.proInfoText}>
                        {[demande.applicant_poste, demande.applicant_entreprise, demande.applicant_ville]
                          .filter(Boolean)
                          .join(' • ')}
                      </Text>
                    </View>
                  )}

                  {/* Action Bar for Pending Requests */}
                  {isPending && (
                    <View style={styles.cardActionsRow}>
                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnReject]}
                        activeOpacity={0.8}
                        onPress={() => handleReject(demande)}
                      >
                        <Ionicons name="close-circle-outline" size={16} color={Palette.alert} />
                        <Text style={styles.btnRejectText} weight="medium">
                          Refuser
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btnAction, styles.btnAccept]}
                        activeOpacity={0.8}
                        onPress={() => handleAccept(demande)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={16} color="#FFFFFF" />
                        <Text style={styles.btnAcceptText} weight="bold">
                          Accepter
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* ── 4. Details / Decision Modal ── */}
      <Modal
        visible={!!selectedDemande}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedDemande(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selectedDemande && (
              <>
                <View style={styles.modalHeader}>
                  <Text variant="h2" style={styles.modalTitle}>
                    Détail de la demande
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedDemande(null)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={22} color={Palette.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalScroll}>
                  {/* Applicant identity */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Demandeur</Text>
                    <View style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>Nom complet :</Text>
                      <Text style={styles.modalDetailValue} weight="bold">
                        {selectedDemande.applicant_prenom} {selectedDemande.applicant_nom}
                      </Text>
                    </View>
                    <View style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>Email :</Text>
                      <Text style={styles.modalDetailValue}>{selectedDemande.applicant_email}</Text>
                    </View>
                    {selectedDemande.applicant_telephone && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Téléphone :</Text>
                        <Text style={styles.modalDetailValue}>{selectedDemande.applicant_telephone}</Text>
                      </View>
                    )}
                    {selectedDemande.applicant_entreprise && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Entreprise :</Text>
                        <Text style={styles.modalDetailValue}>{selectedDemande.applicant_entreprise}</Text>
                      </View>
                    )}
                    {selectedDemande.applicant_poste && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Poste :</Text>
                        <Text style={styles.modalDetailValue}>{selectedDemande.applicant_poste}</Text>
                      </View>
                    )}
                    {selectedDemande.applicant_ville && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Ville :</Text>
                        <Text style={styles.modalDetailValue}>{selectedDemande.applicant_ville}</Text>
                      </View>
                    )}
                  </View>

                  {/* Role and Request Status */}
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Attribution demandée</Text>
                    <View style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>Rôle demandé :</Text>
                      <Text style={[styles.modalDetailValue, { color: Palette.primary }]} weight="bold">
                        {selectedDemande.requested_role_nom}
                      </Text>
                    </View>
                    {selectedDemande.requested_role_description && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Description :</Text>
                        <Text style={styles.modalDetailValue}>
                          {selectedDemande.requested_role_description}
                        </Text>
                      </View>
                    )}
                    <View style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>Date demande :</Text>
                      <Text style={styles.modalDetailValue}>
                        {formatFrenchDate(selectedDemande.date_demande)}
                      </Text>
                    </View>
                    <View style={styles.modalDetailRow}>
                      <Text style={styles.modalDetailLabel}>Statut :</Text>
                      <Text style={styles.modalDetailValue} weight="bold">
                        {getStatusBadge(selectedDemande.statut).label}
                      </Text>
                    </View>
                    {selectedDemande.date_traitement && (
                      <View style={styles.modalDetailRow}>
                        <Text style={styles.modalDetailLabel}>Date traitement :</Text>
                        <Text style={styles.modalDetailValue}>
                          {formatFrenchDate(selectedDemande.date_traitement)}
                        </Text>
                      </View>
                    )}
                  </View>
                </ScrollView>

                {/* Actions inside Modal if Pending */}
                {selectedDemande.statut === 'PENDING' && (
                  <View style={styles.modalActionsRow}>
                    <Button
                      title="Refuser"
                      variant="outline"
                      size="md"
                      loading={isProcessing}
                      onPress={() => handleReject(selectedDemande)}
                      style={{ flex: 1, borderColor: Palette.alert }}
                      textStyle={{ color: Palette.alert }}
                    />
                    <Button
                      title="Accepter"
                      variant="primary"
                      size="md"
                      loading={isProcessing}
                      onPress={() => handleAccept(selectedDemande)}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </>
            )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    color: Palette.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 1,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    gap: 8,
  },
  actionBannerSuccess: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  actionBannerError: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  actionBannerText: {
    flex: 1,
    fontSize: 13,
  },
  actionBannerTextSuccess: {
    color: '#065F46',
  },
  actionBannerTextError: {
    color: '#991B1B',
  },
  tabsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Palette.border,
  },
  tabBtnActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  tabText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  centerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  centerLoadingText: {
    marginTop: 10,
    fontSize: 13,
    color: Palette.textMuted,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    color: Palette.text,
    marginTop: 14,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  requestCard: {
    backgroundColor: '#FFFFFF',
    borderColor: Palette.border,
    padding: 16,
    marginBottom: 14,
  },
  requestCardPending: {
    borderLeftWidth: 4,
    borderLeftColor: '#D97706',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  applicantAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(23, 107, 91, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 14,
    color: Palette.primary,
  },
  applicantName: {
    fontSize: 15,
    color: Palette.text,
  },
  applicantEmail: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
  },
  cardMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  roleBox: {
    flex: 1,
  },
  dateBox: {
    alignItems: 'flex-end',
  },
  metaLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 12,
    color: Palette.text,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 12,
  },
  proInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  proInfoText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  btnAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  btnReject: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(217, 83, 79, 0.4)',
  },
  btnRejectText: {
    fontSize: 13,
    color: Palette.alert,
  },
  btnAccept: {
    backgroundColor: Palette.primary,
  },
  btnAcceptText: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    color: Palette.text,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalScroll: {
    marginBottom: 16,
  },
  modalSection: {
    marginBottom: 16,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  modalSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Palette.primary,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  modalDetailLabel: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  modalDetailValue: {
    fontSize: 13,
    color: Palette.text,
    maxWidth: '60%',
    textAlign: 'right',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
});
