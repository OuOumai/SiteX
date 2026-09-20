import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  TextInput,
  View,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, InAppNotification } from '@/services/api';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';

function formatNotificationTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 2) return "À l'instant";
    if (diffMins < 60) return `Il y a ${diffMins} min`;
    if (diffHours < 24) return `Il y a ${diffHours} h`;
    if (diffDays === 1) return `Hier à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    if (diffDays < 7) return `Il y a ${diffDays} jours`;

    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function NotificationBell() {
  const { token, user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  // Operational Explanation / Justification interaction modal state
  const [selectedExplanation, setSelectedExplanation] = useState<InAppNotification | null>(null);
  const [explanationMotif, setExplanationMotif] = useState<'METEO' | 'ACCES_BLOQUE' | 'MATERIEL' | 'AUTRE'>('METEO');
  const [explanationResponseText, setExplanationResponseText] = useState('');
  const [isSubmittingResponse, setIsSubmittingResponse] = useState(false);
  const [responseSuccessMessage, setResponseSuccessMessage] = useState<string | null>(null);
  const [responseErrorMessage, setResponseErrorMessage] = useState<string | null>(null);

  const isResponsable =
    user?.role_nom === 'Responsable' ||
    user?.role_id === 2 ||
    user?.role_nom === 'Administrateur' ||
    user?.role_id === 1;

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await api.getNotifications(token);
      setItems(result.notifications || []);
      setUnread(result.unread_count || 0);
    } catch (err: any) {
      console.warn('Erreur chargement notifications:', err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadNotifications();
    // Auto-refresh notifications every 30 seconds if active
    const interval = setInterval(() => {
      loadNotifications();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const openItem = async (item: InAppNotification) => {
    if (token && !item.is_read) {
      try {
        await api.markNotificationRead(token, item.id);
        setItems((current) =>
          current.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
        );
        setUnread((count) => Math.max(0, count - 1));
      } catch (e: any) {
        console.warn('Erreur marquage lu:', e.message);
      }
    }

    const isExplanationType =
      item.type === 'DEMANDE_EXPLICATION' ||
      item.type === 'DEMANDE_EXPLICATION_INACTIVITE' ||
      item.type === 'EXPLICATION_FOURNIE' ||
      item.type === 'REPONSE_EXPLICATION_INACTIVITE' ||
      item.related_entity_type === 'demande_explication';

    if (isExplanationType) {
      setSelectedExplanation(item);
      setExplanationMotif('METEO');
      setExplanationResponseText('');
      setResponseSuccessMessage(null);
      setResponseErrorMessage(null);
      return;
    }

    setOpen(false);

    // Entity Navigation Router
    setTimeout(() => {
      if (item.related_entity_type === 'troncon' && item.related_entity_id) {
        if (isResponsable) {
          router.push(`/responsable/troncon/${item.related_entity_id}` as any);
        } else {
          router.push(`/agent/troncon/${item.related_entity_id}` as any);
        }
      } else if (item.related_entity_type === 'chantier' && item.related_entity_id) {
        if (isResponsable) {
          router.push(`/responsable/chantier/${item.related_entity_id}` as any);
        } else {
          router.push(`/chantier/${item.related_entity_id}` as any);
        }
      } else if (item.metadata?.chantier_id) {
        if (isResponsable) {
          router.push(`/responsable/chantier/${item.metadata.chantier_id}` as any);
        } else {
          router.push(`/chantier/${item.metadata.chantier_id}` as any);
        }
      } else if (item.metadata?.project_id) {
        router.push(`/project/${item.metadata.project_id}` as any);
      }
    }, 120);
  };

  const handleSendExplanationResponse = async () => {
    if (!token || !selectedExplanation || !explanationResponseText.trim()) return;
    const meta = (selectedExplanation.metadata || {}) as Record<string, any>;
    const rawId = selectedExplanation.related_entity_id ?? meta.demande_id;
    const demandeId: string | number | null = rawId ? (typeof rawId === 'number' || typeof rawId === 'string' ? rawId : String(rawId)) : null;

    if (!demandeId) {
      setResponseErrorMessage("Identifiant de demande d'explication manquant.");
      return;
    }

    setIsSubmittingResponse(true);
    setResponseErrorMessage(null);
    try {
      await api.respondJustification(token, demandeId, {
        motif: explanationMotif,
        reponse: explanationResponseText.trim(),
      });
      setResponseSuccessMessage("Votre justification a été transmise au responsable.");
      // update local notification metadata
      setItems((current) =>
        current.map((n) =>
          n.id === selectedExplanation.id
            ? {
                ...n,
                metadata: {
                  ...n.metadata,
                  statut: 'REPONDUE',
                  motif: explanationMotif,
                  reponse: explanationResponseText.trim(),
                },
              }
            : n
        )
      );
      setTimeout(() => {
        setSelectedExplanation(null);
        setResponseSuccessMessage(null);
        loadNotifications();
      }, 1400);
    } catch (err: any) {
      console.error('Erreur réponse justification:', err.message);
      setResponseErrorMessage(err.message || "Impossible d'enregistrer la justification.");
    } finally {
      setIsSubmittingResponse(false);
    }
  };

  const handleReadAll = async () => {
    if (!token) return;
    try {
      await api.markAllNotificationsRead(token);
      setItems((current) => current.map((item) => ({ ...item, is_read: true })));
      setUnread(0);
    } catch (err: any) {
      console.warn('Erreur mark all read:', err.message);
    }
  };

  const getNotificationVisuals = (type?: string) => {
    switch (type) {
      case 'DEMANDE_EXPLICATION':
      case 'DEMANDE_EXPLICATION_INACTIVITE':
        return {
          icon: 'chatbubble-ellipses-outline' as const,
          color: '#D97706',
          bgColor: '#FEF3C7',
          tagLabel: 'Demande',
        };
      case 'EXPLICATION_FOURNIE':
      case 'REPONSE_EXPLICATION_INACTIVITE':
        return {
          icon: 'checkmark-circle-outline' as const,
          color: '#16A34A',
          bgColor: '#DCFCE7',
          tagLabel: 'Justification',
        };
      case 'AFFECTATION_AGENT':
        return {
          icon: 'navigate-circle-outline' as const,
          color: '#0D9488',
          bgColor: '#CCFBF1',
          tagLabel: 'Affectation',
        };
      case 'NOUVEAU_RAPPORT':
        return {
          icon: 'document-text-outline' as const,
          color: '#2563EB',
          bgColor: '#EFF6FF',
          tagLabel: 'Rapport',
        };
      case 'NOUVELLE_RECLAMATION':
        return {
          icon: 'alert-circle-outline' as const,
          color: '#DC2626',
          bgColor: '#FEE2E2',
          tagLabel: 'Réclamation',
        };
      default:
        return {
          icon: 'notifications-outline' as const,
          color: Palette.primary,
          bgColor: '#F0FDFA',
          tagLabel: 'Système',
        };
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.bellBtn}
        onPress={() => {
          setOpen(true);
          loadNotifications();
        }}
        activeOpacity={0.75}
        accessibilityLabel={`${unread} notification(s) non lue(s)`}
      >
        <Ionicons name="notifications-outline" size={22} color={Palette.text} />
        {unread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText} weight="bold">
              {unread > 99 ? '99+' : unread}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setOpen(false)}
          />

          <View style={styles.sheetContainer}>
            {/* Sheet Handle */}
            <View style={styles.handleWrap}>
              <View style={styles.sheetHandle} />
            </View>

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View>
                <View style={styles.titleRow}>
                  <Text variant="h2" style={styles.sheetTitle} weight="bold">
                    Notifications
                  </Text>
                  {unread > 0 ? (
                    <View style={styles.unreadHeaderPill}>
                      <Text style={styles.unreadHeaderPillText} weight="bold">
                        {unread} nouvelle{unread > 1 ? 's' : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.sheetSubtitle}>
                  Historique de vos alertes, rapports et affectations
                </Text>
              </View>

              <View style={styles.headerActions}>
                {unread > 0 && (
                  <TouchableOpacity
                    style={styles.readAllBtn}
                    onPress={handleReadAll}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="checkmark-done" size={16} color={Palette.primary} />
                    <Text style={styles.readAllText} weight="semibold">
                      Tout lire
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => setOpen(false)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={22} color={Palette.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Notification List Content */}
            {loading && !items.length ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={Palette.primary} size="large" />
                <Text style={styles.loadingText}>Chargement des notifications...</Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              >
                {!items.length ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIconCircle}>
                      <Ionicons
                        name="notifications-off-outline"
                        size={36}
                        color={Palette.textMuted}
                      />
                    </View>
                    <Text style={styles.emptyTitle} weight="bold">
                      Aucune notification
                    </Text>
                    <Text style={styles.emptyDesc}>
                      Vous êtes à jour ! Vos prochaines affectations, alertes et rapports apparaîtront ici.
                    </Text>
                  </View>
                ) : (
                  items.map((item) => {
                    const visuals = getNotificationVisuals(item.type);
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[
                          styles.itemCard,
                          !item.is_read && styles.unreadItemCard,
                        ]}
                        onPress={() => openItem(item)}
                        activeOpacity={0.8}
                      >
                        {/* Left visual icon */}
                        <View
                          style={[
                            styles.itemIconCircle,
                            { backgroundColor: visuals.bgColor },
                          ]}
                        >
                          <Ionicons
                            name={visuals.icon}
                            size={20}
                            color={visuals.color}
                          />
                        </View>

                        {/* Middle Text Details */}
                        <View style={{ flex: 1 }}>
                          <View style={styles.itemTopRow}>
                            <View
                              style={[
                                styles.categoryTag,
                                { backgroundColor: visuals.bgColor },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.categoryTagText,
                                  { color: visuals.color },
                                ]}
                                weight="bold"
                              >
                                {visuals.tagLabel}
                              </Text>
                            </View>

                            <Text style={styles.itemDateText}>
                              {formatNotificationTime(item.created_at)}
                            </Text>
                          </View>

                          <Text
                            style={[
                              styles.itemTitle,
                              !item.is_read && styles.unreadTitle,
                            ]}
                            weight={item.is_read ? 'semibold' : 'bold'}
                          >
                            {item.titre}
                          </Text>

                          {item.message ? (
                            <Text style={styles.itemMessage} numberOfLines={2}>
                              {item.message}
                            </Text>
                          ) : null}
                        </View>

                        {/* Unread indicator dot */}
                        {!item.is_read ? (
                          <View style={styles.unreadDot} />
                        ) : (
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color="#CBD5E1"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Operational Explanation & Justification Interaction Modal ── */}
      <Modal
        visible={selectedExplanation !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setSelectedExplanation(null)}
      >
        <Pressable
          style={styles.explModalBackdrop}
          onPress={() => setSelectedExplanation(null)}
        >
          <Pressable style={styles.explModalCard} onPress={(e) => e.stopPropagation()}>
            {selectedExplanation && (() => {
              const isDemande =
                selectedExplanation.type === 'DEMANDE_EXPLICATION' ||
                selectedExplanation.type === 'DEMANDE_EXPLICATION_INACTIVITE';
              const isReponse =
                selectedExplanation.type === 'EXPLICATION_FOURNIE' ||
                selectedExplanation.type === 'REPONSE_EXPLICATION_INACTIVITE';
              const meta: Record<string, any> = (selectedExplanation.metadata as any) || {};
              const alreadyResponded = Boolean(meta.statut === 'REPONDUE' || meta.reponse);

              return (
                <>
                  {/* Modal Header */}
                  <View style={styles.explModalHeader}>
                    <View
                      style={[
                        styles.explModalIconCircle,
                        { backgroundColor: isDemande ? '#FEF3C7' : '#DCFCE7' },
                      ]}
                    >
                      <Ionicons
                        name={isDemande ? 'chatbubble-ellipses-outline' : 'checkmark-done-circle-outline'}
                        size={22}
                        color={isDemande ? '#D97706' : '#16A34A'}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="h3" style={styles.explModalTitle} weight="bold">
                        {isDemande ? "Demande d'explication" : "Justification reçue"}
                      </Text>
                      <Text style={styles.explModalSubtitle}>
                        {isDemande
                          ? "Transmise par le responsable du chantier"
                          : "Audit et justification de l'agent de terrain"}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setSelectedExplanation(null)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={22} color={Palette.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.explModalScroll} showsVerticalScrollIndicator={false}>
                    {/* Context info box */}
                    <View style={styles.explContextCard}>
                      {Boolean(meta.chantier_nom) && (
                        <View style={styles.explContextRow}>
                          <Text style={styles.explContextLabel}>Chantier :</Text>
                          <Text style={styles.explContextValue} weight="semibold">
                            {String(meta.chantier_nom)}
                          </Text>
                        </View>
                      )}
                      {Boolean(meta.troncon_nom) && (
                        <View style={styles.explContextRow}>
                          <Text style={styles.explContextLabel}>Tronçon :</Text>
                          <Text style={styles.explContextValue} weight="semibold">
                            {String(meta.troncon_nom)}
                          </Text>
                        </View>
                      )}
                      {Boolean(meta.date_concernee) && (
                        <View style={styles.explContextRow}>
                          <Text style={styles.explContextLabel}>Date concernée :</Text>
                          <Text style={styles.explContextValue} weight="semibold">
                            {String(meta.date_concernee)}
                          </Text>
                        </View>
                      )}
                      {Boolean(meta.demandeur_nom) && (
                        <View style={styles.explContextRow}>
                          <Text style={styles.explContextLabel}>Demandé par :</Text>
                          <Text style={styles.explContextValue} weight="semibold">
                            {String(meta.demandeur_nom)}
                          </Text>
                        </View>
                      )}
                      {Boolean(meta.agent_nom) && (
                        <View style={styles.explContextRow}>
                          <Text style={styles.explContextLabel}>Agent de terrain :</Text>
                          <Text style={styles.explContextValue} weight="semibold">
                            {String(meta.agent_nom)}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Message or Reason */}
                    <View style={styles.explMessageBox}>
                      <Text style={styles.explMessageLabel} weight="semibold">
                        {isDemande ? "Message du responsable :" : "Justification de l'inactivité :"}
                      </Text>
                      <Text style={styles.explMessageText}>
                        {isDemande
                          ? String(meta.message_responsable || selectedExplanation.message || '')
                          : `« ${String(meta.reponse || selectedExplanation.message || '')} »`}
                      </Text>
                    </View>

                    {/* If this is a response already provided or read by Responsable */}
                    {(isReponse || alreadyResponded) && meta.motif && (
                      <View style={styles.explAnswerBox}>
                        <View style={styles.explMotifBadge}>
                          <Ionicons name="pricetag-outline" size={13} color="#16A34A" />
                          <Text style={styles.explMotifBadgeText} weight="bold">
                            Motif : {String(meta.motif)}
                          </Text>
                        </View>
                        {meta.reponse && (
                          <Text style={styles.explAnswerText}>
                            {String(meta.reponse)}
                          </Text>
                        )}
                      </View>
                    )}

                    {/* Response form for Agent de Terrain if request is pending */}
                    {isDemande && !alreadyResponded && (
                      <View style={styles.explFormContainer}>
                        <Text style={styles.explFormSectionTitle} weight="bold">
                          Votre réponse à la demande
                        </Text>

                        {/* Motif selector chips */}
                        <Text style={styles.explInputLabel} weight="semibold">
                          Sélectionnez le motif opérationnel :
                        </Text>
                        <View style={styles.explMotifChipsRow}>
                          {[
                            { id: 'METEO', label: 'Météo' },
                            { id: 'ACCES_BLOQUE', label: 'Accès bloqué' },
                            { id: 'MATERIEL', label: 'Matériel' },
                            { id: 'AUTRE', label: 'Autre' },
                          ].map((m) => {
                            const isSelected = explanationMotif === m.id;
                            return (
                              <TouchableOpacity
                                key={m.id}
                                style={[
                                  styles.explMotifChip,
                                  isSelected && styles.explMotifChipSelected,
                                ]}
                                onPress={() => setExplanationMotif(m.id as any)}
                                activeOpacity={0.7}
                              >
                                <Text
                                  style={[
                                    styles.explMotifChipText,
                                    isSelected && styles.explMotifChipTextSelected,
                                  ]}
                                  weight={isSelected ? 'bold' : 'normal'}
                                >
                                  {m.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        {/* Explanation text input */}
                        <Text style={styles.explInputLabel} weight="semibold">
                          Votre explication détaillée :
                        </Text>
                        <TextInput
                          style={styles.explTextInput}
                          multiline
                          numberOfLines={4}
                          value={explanationResponseText}
                          onChangeText={setExplanationResponseText}
                          placeholder="Décrivez les circonstances particulières ayant empêché le relevé..."
                          placeholderTextColor="#94A3B8"
                        />

                        {responseErrorMessage && (
                          <Text style={styles.explErrorText}>{responseErrorMessage}</Text>
                        )}

                        {responseSuccessMessage && (
                          <View style={styles.explSuccessBox}>
                            <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
                            <Text style={styles.explSuccessText} weight="semibold">
                              {responseSuccessMessage}
                            </Text>
                          </View>
                        )}

                        {/* Action buttons */}
                        <View style={styles.explFormActions}>
                          <TouchableOpacity
                            style={styles.explCancelBtn}
                            onPress={() => setSelectedExplanation(null)}
                            disabled={isSubmittingResponse}
                          >
                            <Text style={styles.explCancelBtnText}>Annuler</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.explSubmitBtn,
                              (!explanationResponseText.trim() || isSubmittingResponse) && { opacity: 0.6 },
                            ]}
                            onPress={handleSendExplanationResponse}
                            disabled={!explanationResponseText.trim() || isSubmittingResponse}
                          >
                            {isSubmittingResponse ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : (
                              <>
                                <Ionicons name="send" size={14} color="#FFFFFF" />
                                <Text style={styles.explSubmitBtnText} weight="semibold">
                                  Envoyer la réponse
                                </Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* Navigation shortcut for Responsable */}
                    {isReponse && meta.chantier_id && (
                      <TouchableOpacity
                        style={styles.explViewChantierBtn}
                        onPress={() => {
                          setSelectedExplanation(null);
                          setOpen(false);
                          router.push(`/responsable/chantier/${meta.chantier_id}` as any);
                        }}
                        activeOpacity={0.8}
                      >
                        <Ionicons name="calendar-outline" size={16} color="#FFFFFF" />
                        <Text style={styles.explViewChantierBtnText} weight="semibold">
                          Voir le journal du chantier
                        </Text>
                      </TouchableOpacity>
                    )}
                  </ScrollView>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
    minWidth: 19,
    height: 19,
    paddingHorizontal: 4,
    borderRadius: 9.5,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    lineHeight: 11,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '84%',
    minHeight: 360,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 24,
  },
  handleWrap: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sheetTitle: {
    fontSize: 18,
    color: Palette.text,
  },
  unreadHeaderPill: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FEE2E2',
  },
  unreadHeaderPillText: {
    fontSize: 10,
    color: '#DC2626',
  },
  sheetSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  readAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0FDFA',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CCFBF1',
  },
  readAllText: {
    color: Palette.primary,
    fontSize: 11,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    padding: 50,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  listContent: {
    padding: 14,
    gap: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  unreadItemCard: {
    backgroundColor: '#F0FDFA',
    borderColor: '#99F6E4',
    borderLeftWidth: 4,
    borderLeftColor: Palette.primary,
  },
  itemIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  categoryTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryTagText: {
    fontSize: 9,
    letterSpacing: 0.3,
  },
  itemDateText: {
    fontSize: 10,
    color: '#94A3B8',
  },
  itemTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  unreadTitle: {
    color: '#0F172A',
  },
  itemMessage: {
    fontSize: 11,
    color: Palette.textMuted,
    lineHeight: 16,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Palette.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  emptyDesc: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // ── Explanation Interaction Modal Styles ──
  explModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  explModalCard: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 24,
  },
  explModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  explModalIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  explModalTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  explModalSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  explModalScroll: {
    padding: 16,
  },
  explContextCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 6,
    marginBottom: 12,
  },
  explContextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  explContextLabel: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  explContextValue: {
    fontSize: 12,
    color: Palette.text,
  },
  explMessageBox: {
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 12,
    marginBottom: 14,
  },
  explMessageLabel: {
    fontSize: 11,
    color: '#92400E',
    marginBottom: 4,
  },
  explMessageText: {
    fontSize: 13,
    color: '#78350F',
    lineHeight: 18,
  },
  explAnswerBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 12,
    marginBottom: 14,
    gap: 6,
  },
  explMotifBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  explMotifBadgeText: {
    fontSize: 12,
    color: '#15803D',
  },
  explAnswerText: {
    fontSize: 12,
    color: '#166534',
    fontStyle: 'italic',
    lineHeight: 17,
  },
  explFormContainer: {
    gap: 10,
    marginTop: 4,
    paddingBottom: 16,
  },
  explFormSectionTitle: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 4,
  },
  explInputLabel: {
    fontSize: 12,
    color: Palette.text,
  },
  explMotifChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  explMotifChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  explMotifChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: '#F0FDFA',
  },
  explMotifChipText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  explMotifChipTextSelected: {
    color: Palette.primary,
  },
  explTextInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: Palette.text,
    backgroundColor: '#FFFFFF',
    textAlignVertical: 'top',
    minHeight: 70,
  },
  explErrorText: {
    fontSize: 11,
    color: '#DC2626',
  },
  explSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#DCFCE7',
    padding: 10,
    borderRadius: 8,
  },
  explSuccessText: {
    fontSize: 12,
    color: '#15803D',
  },
  explFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 8,
  },
  explCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  explCancelBtnText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  explSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  explSubmitBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
  },
  explViewChantierBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 12,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 16,
  },
  explViewChantierBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
});
