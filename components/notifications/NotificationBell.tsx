import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
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
});
