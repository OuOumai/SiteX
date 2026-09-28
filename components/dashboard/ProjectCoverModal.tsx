/**
 * components/dashboard/ProjectCoverModal.tsx
 *
 * Modal allowing Responsables to replace or restore a project's cover image:
 *  - Take a photo with camera
 *  - Choose an image from the library (with 16:9 crop guidance)
 *  - Restore category default image
 */

import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { ResponsableProjectItem, api } from '@/services/api';
import { useAuth } from '@/hooks/useAuth';
import { getProjectCover } from '@/constants/projectCover';

interface ProjectCoverModalProps {
  visible: boolean;
  onClose: () => void;
  project: ResponsableProjectItem | null;
  onCoverUpdated: (projectId: number, newCoverUrl: string | null) => void;
}

export function ProjectCoverModal({
  visible,
  onClose,
  project,
  onCoverUpdated,
}: ProjectCoverModalProps) {
  const { token } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  if (!project) return null;

  const cover = getProjectCover(project);

  const handlePickImage = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Permission requise',
            'Veuillez autoriser l’accès à votre galerie photo pour sélectionner une image de couverture.'
          );
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        await uploadCover(dataUri);
      }
    } catch (err: any) {
      console.error('Pick image error:', err);
      Alert.alert('Erreur', err?.message || 'Impossible de sélectionner la photo.');
    }
  };

  const handleTakePhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Permission requise',
            'Veuillez autoriser l’accès à l’appareil photo pour prendre une photo de couverture.'
          );
          return;
        }
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUri = asset.base64
          ? `data:image/jpeg;base64,${asset.base64}`
          : asset.uri;
        await uploadCover(dataUri);
      }
    } catch (err: any) {
      console.error('Take photo error:', err);
      Alert.alert('Erreur', err?.message || 'Impossible de prendre la photo.');
    }
  };

  const uploadCover = async (imageUri: string) => {
    if (!token) {
      Alert.alert('Erreur', 'Session expirée. Veuillez vous reconnecter.');
      return;
    }

    try {
      setIsProcessing(true);
      setProcessingStatus('Téléversement de l’image...');
      const res = await api.uploadProjectCover(token, project.id, imageUri);
      onCoverUpdated(project.id, res.cover_image_url);
      onClose();
    } catch (err: any) {
      console.error('Upload project cover error:', err);
      Alert.alert('Échec de la mise à jour', err?.message || 'Une erreur est survenue lors de l’envoi de l’image.');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
    }
  };

  const handleResetToDefault = async () => {
    if (!token) return;

    Alert.alert(
      'Restaurer l’image par défaut',
      'Voulez-vous réinitialiser l’image de couverture à celle par défaut de sa catégorie infrastructure ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Restaurer',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsProcessing(true);
              setProcessingStatus('Réinitialisation...');
              await api.resetProjectCover(token, project.id);
              onCoverUpdated(project.id, null);
              onClose();
            } catch (err: any) {
              console.error('Reset project cover error:', err);
              Alert.alert('Erreur', err?.message || 'Impossible de réinitialiser l’image.');
            } finally {
              setIsProcessing(false);
              setProcessingStatus('');
            }
          },
        },
      ]
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle} weight="bold">
                Image de couverture
              </Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {project.nom}
              </Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={isProcessing}>
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* Current Cover Preview */}
          <View style={styles.previewContainer}>
            <Image source={cover.source} style={styles.previewImage} resizeMode="cover" />
            <View style={styles.previewBadge}>
              <Ionicons name={cover.isCustom ? 'camera' : (cover.categoryIcon as any)} size={12} color="#FFFFFF" />
              <Text style={styles.previewBadgeText} weight="bold">
                {cover.isCustom ? 'Image personnalisée' : `Défaut : ${cover.categoryLabel}`}
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          {isProcessing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Palette.primary} />
              <Text style={styles.loadingText} weight="semibold">
                {processingStatus}
              </Text>
            </View>
          ) : (
            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={styles.actionBtnPrimary}
                onPress={handlePickImage}
                activeOpacity={0.8}
              >
                <Ionicons name="images-outline" size={18} color="#FFFFFF" />
                <Text style={styles.actionBtnPrimaryText} weight="bold">
                  Choisir dans la galerie
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={handleTakePhoto}
                activeOpacity={0.8}
              >
                <Ionicons name="camera-outline" size={18} color={Palette.primary} />
                <Text style={styles.actionBtnSecondaryText} weight="bold">
                  Prendre une photo
                </Text>
              </TouchableOpacity>

              {cover.isCustom && (
                <TouchableOpacity
                  style={styles.actionBtnReset}
                  onPress={handleResetToDefault}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh-outline" size={17} color="#DC2626" />
                  <Text style={styles.actionBtnResetText} weight="bold">
                    Restaurer l'image par défaut
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.actionBtnCancel}
                onPress={onClose}
                activeOpacity={0.7}
              >
                <Text style={styles.actionBtnCancelText} weight="semibold">
                  Annuler
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    color: '#0F172A',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  previewContainer: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
    position: 'relative',
    marginBottom: 20,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
  },
  actionsContainer: {
    gap: 10,
  },
  actionBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    minHeight: 46,
  },
  actionBtnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    minHeight: 46,
  },
  actionBtnSecondaryText: {
    color: Palette.primary,
    fontSize: 14,
  },
  actionBtnReset: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 8,
    minHeight: 44,
  },
  actionBtnResetText: {
    color: '#DC2626',
    fontSize: 13,
  },
  actionBtnCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    minHeight: 40,
  },
  actionBtnCancelText: {
    color: '#64748B',
    fontSize: 14,
  },
  loadingContainer: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#475569',
    fontSize: 14,
  },
});
