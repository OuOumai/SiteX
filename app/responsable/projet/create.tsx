import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePickerModal } from '@/components/ui/date-picker-modal';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/services/api';

const PROJECT_TYPES = [
  { key: 'Ferroviaire', label: 'Ferroviaire', icon: 'train-outline' },
  { key: 'Routier', label: 'Routier / Autoroute', icon: 'car-outline' },
  { key: 'Hydraulique', label: 'Hydraulique / Eau', icon: 'water-outline' },
  { key: 'Autre', label: 'Autre Infrastructure', icon: 'business-outline' },
];

export default function CreateProjectScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [nom, setNom] = useState('');
  const [typeProjet, setTypeProjet] = useState('Ferroviaire');
  const [showTypeModal, setShowTypeModal] = useState(false);
  const [description, setDescription] = useState('');
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().split('T')[0]);
  const [dateFin, setDateFin] = useState('');
  const [showPickerDebut, setShowPickerDebut] = useState(false);
  const [showPickerFin, setShowPickerFin] = useState(false);
  const [statut, setStatut] = useState('En cours');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ nom?: string; general?: string }>({});

  const validate = () => {
    const newErrors: { nom?: string } = {};
    if (!nom.trim()) {
      newErrors.nom = 'Le nom du projet est obligatoire.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate() || !token) return;

    setIsLoading(true);
    setErrors({});

    try {
      const res = await api.createProject(token, {
        nom: nom.trim(),
        type_projet: typeProjet,
        description: description.trim() || undefined,
        date_debut: dateDebut || undefined,
        date_fin: dateFin || undefined,
        statut,
      });

      const createdId = res.project.id;

      // Navigate directly to the spatial GeoJSON & Tronçons configuration workflow
      router.replace(`/responsable/projet/${createdId}/configure` as any);
    } catch (err: any) {
      setErrors({ general: err.message || 'Échec de la création du projet.' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color={Palette.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text variant="h1" style={styles.headerTitle}>
              Nouveau Projet
            </Text>
            <Text variant="subtitle" style={styles.headerSubtitle}>
              Étape 1/2 : Paramètres généraux avant configuration spatiale
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Card variant="elevated" style={styles.card}>
            {errors.general ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle-outline" size={18} color={Palette.alert} />
                <Text variant="error" style={styles.errorBannerText}>
                  {errors.general}
                </Text>
              </View>
            ) : null}

            <Input
              label="Nom du Projet *"
              placeholder="ex: LGV Axe Nord, Ligne RER..."
              value={nom}
              onChangeText={setNom}
              error={errors.nom}
              leftIcon={<Ionicons name="folder-outline" size={20} color={Palette.textMuted} />}
            />

            {/* Type de Projet Dropdown Trigger */}
            <View style={styles.typeSection}>
              <Text style={styles.inputLabel}>Type d'Infrastructure</Text>
              <TouchableOpacity
                style={styles.typeDropdownTrigger}
                onPress={() => setShowTypeModal(true)}
                activeOpacity={0.75}
              >
                <View style={styles.typeDropdownLeft}>
                  <View style={styles.typeDropdownIconWrap}>
                    <Ionicons
                      name={(PROJECT_TYPES.find((t) => t.key === typeProjet) || PROJECT_TYPES[0]).icon as any}
                      size={18}
                      color={Palette.primary}
                    />
                  </View>
                  <Text style={styles.typeDropdownValue} weight="semibold">
                    {(PROJECT_TYPES.find((t) => t.key === typeProjet) || PROJECT_TYPES[0]).label}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={18} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Infrastructure Type Selector Modal */}
            <Modal
              visible={showTypeModal}
              transparent
              animationType="fade"
              onRequestClose={() => setShowTypeModal(false)}
            >
              <TouchableOpacity
                style={styles.modalBackdrop}
                activeOpacity={1}
                onPress={() => setShowTypeModal(false)}
              >
                <View style={styles.modalCard}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle} weight="bold">
                      Type d'Infrastructure
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowTypeModal(false)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="close" size={20} color={Palette.textMuted} />
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.modalSubtitle}>
                    Sélectionnez la typologie de votre projet :
                  </Text>
                  <View style={styles.typeOptionsList}>
                    {PROJECT_TYPES.map((t) => {
                      const isSelected = typeProjet === t.key;
                      return (
                        <TouchableOpacity
                          key={t.key}
                          style={[
                            styles.typeOptionItem,
                            isSelected && styles.typeOptionItemActive,
                          ]}
                          onPress={() => {
                            setTypeProjet(t.key);
                            setShowTypeModal(false);
                          }}
                          activeOpacity={0.75}
                        >
                          <View
                            style={[
                              styles.typeOptionIconWrap,
                              isSelected && styles.typeOptionIconWrapActive,
                            ]}
                          >
                            <Ionicons
                              name={t.icon as any}
                              size={20}
                              color={isSelected ? '#FFFFFF' : Palette.primary}
                            />
                          </View>
                          <Text
                            style={[
                              styles.typeOptionLabel,
                              isSelected && styles.typeOptionLabelActive,
                            ]}
                            weight={isSelected ? 'bold' : 'medium'}
                          >
                            {t.label}
                          </Text>
                          {isSelected && (
                            <Ionicons
                              name="checkmark-circle"
                              size={20}
                              color={Palette.primary}
                            />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableOpacity>
            </Modal>

            <Input
              label="Description / Objectifs"
              placeholder="Objectifs et périmètre du projet..."
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              leftIcon={<Ionicons name="document-text-outline" size={20} color={Palette.textMuted} />}
            />

            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Date de Début</Text>
                <TouchableOpacity
                  style={styles.datePickerTrigger}
                  onPress={() => setShowPickerDebut(true)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="calendar-outline" size={18} color={Palette.primary} />
                  <Text style={[styles.datePickerValue, !dateDebut && styles.datePickerPlaceholder]}>
                    {dateDebut || 'AAAA-MM-JJ'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Date de Fin Prévue</Text>
                <TouchableOpacity
                  style={styles.datePickerTrigger}
                  onPress={() => setShowPickerFin(true)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="calendar-outline" size={18} color={dateFin ? Palette.primary : Palette.textMuted} />
                  <Text style={[styles.datePickerValue, !dateFin && styles.datePickerPlaceholder]}>
                    {dateFin || 'AAAA-MM-JJ'}
                  </Text>
                  {Boolean(dateFin) && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setDateFin('');
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={styles.dateClearBtn}
                    >
                      <Ionicons name="close-circle" size={16} color={Palette.textMuted} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Date Picker Modals */}
            <DatePickerModal
              visible={showPickerDebut}
              title="Date de Début du Projet"
              initialValue={dateDebut}
              onClose={() => setShowPickerDebut(false)}
              onConfirm={(selected) => setDateDebut(selected)}
            />

            <DatePickerModal
              visible={showPickerFin}
              title="Date de Fin Prévue du Projet"
              initialValue={dateFin || dateDebut}
              onClose={() => setShowPickerFin(false)}
              onConfirm={(selected) => setDateFin(selected)}
            />

            {/* Statut Selector */}
            <View style={styles.statutSection}>
              <Text style={styles.inputLabel}>Statut Initial</Text>
              <View style={styles.statutOptions}>
                {['En cours', 'En attente', 'Planifié'].map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statutChip, statut === s && styles.statutChipActive]}
                    onPress={() => setStatut(s)}
                  >
                    <Text
                      style={[styles.statutChipText, statut === s && styles.statutChipTextActive]}
                      weight={statut === s ? 'bold' : 'normal'}
                    >
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.flowNoticeBox}>
              <Ionicons name="git-network-outline" size={22} color={Palette.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.flowNoticeTitle} weight="bold">
                  Étape suivante : Structuration des chantiers
                </Text>
                <Text style={styles.flowNoticeText}>
                  Définissez le nombre de chantiers pour ce projet avant de procéder au cadrage spatial et au découpage en tronçons.
                </Text>
              </View>
            </View>

            <Button
              title="Continuer vers la Structuration du Projet →"
              variant="primary"
              size="lg"
              loading={isLoading}
              onPress={handleCreate}
              style={{ marginTop: 20 }}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
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
  headerTitle: {
    fontSize: 20,
    color: Palette.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    padding: 18,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.alertBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 14,
  },
  errorBannerText: {
    marginTop: 0,
    flex: 1,
  },
  typeSection: {
    marginBottom: 16,
  },
  typeDropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Palette.inputBg || '#F8FAFC',
    borderWidth: 1.5,
    borderColor: Palette.inputBorder || '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  typeDropdownLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  typeDropdownIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeDropdownValue: {
    fontSize: 14.5,
    color: Palette.text,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 17,
    color: Palette.text,
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: Palette.textMuted,
    marginBottom: 16,
  },
  typeOptionsList: {
    gap: 10,
  },
  typeOptionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    gap: 12,
  },
  typeOptionItemActive: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
  },
  typeOptionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#EEF2F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeOptionIconWrapActive: {
    backgroundColor: Palette.primary,
  },
  typeOptionLabel: {
    flex: 1,
    fontSize: 14,
    color: Palette.text,
  },
  typeOptionLabelActive: {
    color: Palette.primaryDark,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  datePickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputBg || '#F8FAFC',
    borderWidth: 1.5,
    borderColor: Palette.inputBorder || '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
    minHeight: 48,
  },
  datePickerValue: {
    flex: 1,
    fontSize: 14,
    color: Palette.text,
    fontWeight: '500',
  },
  datePickerPlaceholder: {
    color: Palette.textLight || '#94A3B8',
    fontWeight: 'normal',
  },
  dateClearBtn: {
    padding: 2,
  },
  statutSection: {
    marginTop: 8,
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Palette.text,
    marginBottom: 8,
  },
  statutOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  statutChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statutChipActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  statutChipText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  statutChipTextActive: {
    color: '#FFFFFF',
  },
  flowNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
    padding: 12,
    borderRadius: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.15)',
  },
  flowNoticeTitle: {
    fontSize: 13,
    color: Palette.primaryDark,
  },
  flowNoticeText: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
    lineHeight: 16,
  },
});
