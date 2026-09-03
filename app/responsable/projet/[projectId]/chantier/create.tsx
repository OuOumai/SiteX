import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePickerModal } from '@/components/ui/date-picker-modal';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, ProjectDetails } from '@/services/api';

export default function CreateChantierScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { token, user } = useAuth();

  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [isFetchingProject, setIsFetchingProject] = useState(true);

  const [nom, setNom] = useState('');
  const [surface, setSurface] = useState('');
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().split('T')[0]);
  const [dateFinPrevue, setDateFinPrevue] = useState('');
  const [showPickerDebut, setShowPickerDebut] = useState(false);
  const [showPickerFin, setShowPickerFin] = useState(false);
  const [statut, setStatut] = useState('En attente');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ nom?: string; surface?: string; general?: string }>({});

  useEffect(() => {
    async function loadProject() {
      if (!token || !projectId) return;
      try {
        const res = await api.getProjectDetails(token, projectId);
        setProject(res.project);
      } catch (err: any) {
        console.error('Erreur chargement projet:', err.message);
      } finally {
        setIsFetchingProject(false);
      }
    }
    loadProject();
  }, [token, projectId]);

  const validate = () => {
    const newErrors: { nom?: string; surface?: string } = {};
    if (!nom.trim()) {
      newErrors.nom = 'Le nom du chantier est obligatoire.';
    }
    if (surface && (isNaN(Number(surface)) || Number(surface) <= 0)) {
      newErrors.surface = 'La surface doit être un nombre positif.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreate = async () => {
    if (!validate() || !token || !projectId) return;

    setIsLoading(true);
    setErrors({});

    try {
      const res = await api.createChantier(token, projectId, {
        nom: nom.trim(),
        surface_reference: surface ? Number(surface) : undefined,
        date_debut: dateDebut || undefined,
        date_fin_prevue: dateFinPrevue || undefined,
        statut,
      });

      const newChantierId = res.chantier.id;

      Alert.alert(
        'Chantier créé !',
        `Le chantier "${res.chantier.nom}" a été créé avec succès. Passons maintenant à la configuration spatiale (GIS) de son tracé.`,
        [
          {
            text: 'Configurer le GIS maintenant',
            onPress: () => router.replace(`/responsable/chantier/${newChantierId}/gis` as any),
          },
        ]
      );
    } catch (err: any) {
      setErrors({ general: err.message || 'Échec de la création du chantier.' });
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
              Ajouter un Chantier
            </Text>
            <Text variant="subtitle" style={styles.headerSubtitle}>
              {project ? `Projet : ${project.nom}` : 'Chargement du projet...'}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {isFetchingProject ? (
            <ActivityIndicator size="small" color={Palette.primary} style={{ marginVertical: 20 }} />
          ) : null}

          {/* Project Summary Banner */}
          {project && (
            <View style={styles.projectBanner}>
              <Ionicons name="folder-open" size={20} color={Palette.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.projectBannerTitle} weight="bold">
                  {project.nom}
                </Text>
                <Text style={styles.projectBannerSubtitle}>
                  {project.indicateurs?.nombreChantiers || 0} chantiers existants • Responsable : {user?.prenom} {user?.nom}
                </Text>
              </View>
            </View>
          )}

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
              label="Nom du Chantier / Lot *"
              placeholder="ex: Lot 01 - Terrassement PK 0 à 25"
              value={nom}
              onChangeText={setNom}
              error={errors.nom}
              leftIcon={<Ionicons name="construct-outline" size={20} color={Palette.textMuted} />}
            />

            <Input
              label="Surface de Référence / Étude Préalable (m²) — Optionnel"
              placeholder="ex: 25000"
              value={surface}
              onChangeText={setSurface}
              keyboardType="numeric"
              error={errors.surface}
              leftIcon={<Ionicons name="cube-outline" size={20} color={Palette.textMuted} />}
            />
            <Text style={{ fontSize: 11, color: Palette.textMuted, marginTop: -6, marginBottom: 8, lineHeight: 16 }}>
              ℹ️ Note : La surface réelle d'un tracé linéaire n'est pas extrapolée arbitrairement. Cette valeur optionnelle correspond à la surface d'étude déclarée.
            </Text>

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
                <Text style={styles.inputLabel}>Date Fin Prévue</Text>
                <TouchableOpacity
                  style={styles.datePickerTrigger}
                  onPress={() => setShowPickerFin(true)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="calendar-outline" size={18} color={dateFinPrevue ? Palette.primary : Palette.textMuted} />
                  <Text style={[styles.datePickerValue, !dateFinPrevue && styles.datePickerPlaceholder]}>
                    {dateFinPrevue || 'AAAA-MM-JJ'}
                  </Text>
                  {Boolean(dateFinPrevue) && (
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation?.();
                        setDateFinPrevue('');
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
              title="Date de Début du Chantier"
              initialValue={dateDebut}
              onClose={() => setShowPickerDebut(false)}
              onConfirm={(selected) => setDateDebut(selected)}
            />

            <DatePickerModal
              visible={showPickerFin}
              title="Date de Fin Prévue du Chantier"
              initialValue={dateFinPrevue || dateDebut}
              onClose={() => setShowPickerFin(false)}
              onConfirm={(selected) => setDateFinPrevue(selected)}
            />

            {/* Statut Selector */}
            <View style={styles.statutSection}>
              <Text style={styles.inputLabel}>Statut du Chantier</Text>
              <View style={styles.statutOptions}>
                {['En attente', 'En cours', 'En pause'].map((s) => (
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

            <View style={styles.gisNoticeBox}>
              <Ionicons name="map-outline" size={20} color={Palette.primary} />
              <Text style={styles.gisNoticeText}>
                Importez votre tracé pour délimiter la zone d'étude et générer les tronçons.
              </Text>
            </View>

            <Button
              title="Créer et Configurer le SIG →"
              variant="primary"
              size="lg"
              loading={isLoading}
              onPress={handleCreate}
              style={{ marginTop: 24 }}
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
    padding: 20,
    paddingBottom: 40,
  },
  projectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EFF6FF',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  projectBannerTitle: {
    fontSize: 14,
    color: '#1E40AF',
  },
  projectBannerSubtitle: {
    fontSize: 11,
    color: '#60A5FA',
    marginTop: 2,
  },
  card: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.alertBg,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    marginTop: 0,
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
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
    marginTop: 12,
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
    paddingHorizontal: 14,
    paddingVertical: 8,
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
  gisNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
    padding: 12,
    borderRadius: 10,
    marginTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.15)',
  },
  gisNoticeText: {
    fontSize: 12,
    color: Palette.primaryDark,
    flex: 1,
    lineHeight: 17,
  },
});
