import React from 'react';
import {
  Modal,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './text';
import { Palette } from '@/constants/theme';

export interface DeleteConfirmationModalProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  items?: string[];
  isDeleting?: boolean;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmationModal({
  visible,
  title,
  subtitle = 'Cette action est irréversible. Tous les chantiers, tronçons, observations et données associés seront définitivement supprimés.',
  items = [],
  isDeleting = false,
  confirmText,
  cancelText = 'Annuler',
  onConfirm,
  onCancel,
}: DeleteConfirmationModalProps) {
  if (!visible) return null;

  const count = items.length;
  const defaultConfirmText = count > 1 ? `Supprimer (${count})` : 'Supprimer';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={isDeleting ? undefined : onCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={isDeleting ? undefined : onCancel}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalCard}>
              {/* Top Accent Bar */}
              <View style={styles.topAccentBar} />

              {/* Close Button */}
              {!isDeleting && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onCancel}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Ionicons name="close" size={20} color={Palette.textMuted} />
                </TouchableOpacity>
              )}

              {/* Glowing Danger Icon */}
              <View style={styles.iconWrapperOuter}>
                <View style={styles.iconWrapperInner}>
                  <Ionicons name="trash" size={26} color="#DC2626" />
                </View>
              </View>

              {/* Title & Description */}
              <Text variant="h2" style={styles.title} weight="bold">
                {title}
              </Text>
              
              <Text style={styles.subtitle}>
                {subtitle}
              </Text>

              {/* Target items list if provided */}
              {items.length > 0 && (
                <View style={styles.itemsContainer}>
                  <View style={styles.itemsHeader}>
                    <Ionicons name="layers-outline" size={14} color={Palette.textMuted} />
                    <Text style={styles.itemsHeaderText} weight="semibold">
                      {count} projet{count > 1 ? 's concernés' : ' concerné'} :
                    </Text>
                  </View>

                  <ScrollView
                    style={styles.itemsScroll}
                    contentContainerStyle={styles.itemsScrollContent}
                    showsVerticalScrollIndicator={items.length > 4}
                    nestedScrollEnabled
                  >
                    {items.map((name, index) => (
                      <View key={index} style={styles.itemRow}>
                        <View style={styles.itemBullet}>
                          <Ionicons name="folder" size={13} color="#DC2626" />
                        </View>
                        <Text style={styles.itemName} weight="medium" numberOfLines={1}>
                          {name}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Warning Alert Note */}
              <View style={styles.warningBox}>
                <Ionicons name="warning-outline" size={16} color="#B91C1C" style={{ marginTop: 1 }} />
                <Text style={styles.warningText}>
                  La suppression en cascade effacera immédiatement les données de la base de données.
                </Text>
              </View>

              {/* Actions Footer */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.btnCancel, isDeleting && styles.btnDisabled]}
                  onPress={onCancel}
                  disabled={isDeleting}
                  activeOpacity={0.7}
                >
                  <Text style={styles.btnCancelText} weight="semibold">
                    {cancelText}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnConfirm, isDeleting && styles.btnConfirmDisabled]}
                  onPress={onConfirm}
                  disabled={isDeleting}
                  activeOpacity={0.8}
                >
                  {isDeleting ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.btnConfirmText} weight="bold">
                        Suppression...
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.loadingRow}>
                      <Ionicons name="trash-outline" size={17} color="#FFFFFF" />
                      <Text style={styles.btnConfirmText} weight="bold">
                        {confirmText || defaultConfirmText}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0,0,0,0.08)',
      } as any,
    }),
  },
  topAccentBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#DC2626',
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  iconWrapperOuter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 4,
    borderWidth: 4,
    borderColor: '#FEF2F2',
  },
  iconWrapperInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FECACA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13.5,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  itemsContainer: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginBottom: 14,
  },
  itemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#EDF2F7',
  },
  itemsHeaderText: {
    fontSize: 12,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  itemsScroll: {
    maxHeight: 130,
  },
  itemsScrollContent: {
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  itemBullet: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    color: '#1E293B',
  },
  warningBox: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    marginBottom: 20,
  },
  warningText: {
    flex: 1,
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 16.5,
  },
  actionsRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    fontSize: 14.5,
    color: '#475569',
  },
  btnConfirm: {
    flex: 1.35,
    backgroundColor: '#DC2626',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#DC2626',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 4px 12px rgba(220, 38, 38, 0.35)',
      } as any,
    }),
  },
  btnConfirmDisabled: {
    backgroundColor: '#EF4444',
    opacity: 0.75,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnConfirmText: {
    fontSize: 14.5,
    color: '#FFFFFF',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
});
