import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { DatePickerModal } from '@/components/ui/date-picker-modal';
import { ResponsableProjectItem, DashboardClientItem } from '@/services/api';

interface ReportGenerationModalProps {
  visible: boolean;
  onClose: () => void;
  projects: ResponsableProjectItem[];
  clients?: DashboardClientItem[];
  initialProjectId?: number;
}

export function ReportGenerationModal({
  visible,
  onClose,
  projects,
  clients = [],
  initialProjectId,
}: ReportGenerationModalProps) {
  const router = useRouter();

  // Selected project
  const [selectedProjectId, setSelectedProjectId] = useState<number>(
    initialProjectId || projects[0]?.id || 0
  );

  // Selected client
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);

  // Dates
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const formatDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [dateDebut, setDateDebut] = useState<string>(formatDateStr(firstDayOfMonth));
  const [dateFin, setDateFin] = useState<string>(formatDateStr(today));
  const [datePickerTarget, setDatePickerTarget] = useState<'debut' | 'fin' | null>(null);

  // Sections to include
  const [sections, setSections] = useState({
    infosProjet: true,
    avancementGlobal: true,
    avancementChantiers: true,
    tronconsLineaire: true,
    observationsTerrain: true,
    reclamationsClient: true,
  });

  const toggleSection = (key: keyof typeof sections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const currentProject = useMemo(() => {
    return projects.find((p) => p.id === selectedProjectId) || projects[0];
  }, [projects, selectedProjectId]);

  // Determine associated client
  const associatedClient = useMemo(() => {
    if (selectedClientId) {
      return clients.find((c) => c.id === selectedClientId);
    }
    // Default to first available client or fallback
    return clients[0] || null;
  }, [clients, selectedClientId]);

  const handleGenerate = () => {
    if (!currentProject) return;
    onClose();
    router.push({
      pathname: '/project/report-viewer',
      params: {
        id: String(currentProject.id),
        title: currentProject.nom,
      },
    } as any);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons name="document-text" size={22} color={Palette.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="h3" style={styles.title} weight="bold">
                Générer un rapport de suivi
              </Text>
              <Text style={styles.subtitle}>
                Rapport d'avancement pour le maître d'ouvrage ou le client
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={22} color={Palette.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Step 1: Select Project */}
            <View style={styles.stepSection}>
              <View style={styles.stepHeader}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText} weight="bold">1</Text>
                </View>
                <Text style={styles.stepTitle} weight="bold">Sélection du projet</Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectPillsRow}>
                {projects.map((p) => {
                  const isSelected = (currentProject?.id === p.id);
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.projectPill, isSelected && styles.projectPillSelected]}
                      onPress={() => setSelectedProjectId(p.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="folder-outline"
                        size={14}
                        color={isSelected ? '#FFFFFF' : Palette.text}
                        style={{ marginRight: 6 }}
                      />
                      <Text
                        style={[styles.projectPillText, isSelected && styles.projectPillTextSelected]}
                        weight={isSelected ? 'bold' : 'normal'}
                        numberOfLines={1}
                      >
                        {p.nom}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Associated Client Banner */}
              <View style={styles.clientBox}>
                <View style={styles.clientCheckIcon}>
                  <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.clientBoxLabel} weight="semibold">
                    Client associé :
                  </Text>
                  <Text style={styles.clientBoxName} weight="bold">
                    {associatedClient
                      ? `${associatedClient.prenom} ${associatedClient.nom} • ${associatedClient.entreprise || 'Société Partenaire'}`
                      : 'Société des Infrastructures (Maître d’Ouvrage)'}
                  </Text>
                  <Text style={styles.clientBoxSub}>
                    {associatedClient?.email || 'Attribution automatique sur le projet'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Step 2: Date Period */}
            <View style={styles.stepSection}>
              <View style={styles.stepHeader}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText} weight="bold">2</Text>
                </View>
                <Text style={styles.stepTitle} weight="bold">Période d'analyse</Text>
              </View>

              <View style={styles.dateRow}>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setDatePickerTarget('debut')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={16} color={Palette.primary} />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.dateLabel}>Date début</Text>
                    <Text style={styles.dateValue} weight="bold">{dateDebut}</Text>
                  </View>
                </TouchableOpacity>

                <Ionicons name="arrow-forward" size={16} color={Palette.textMuted} />

                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setDatePickerTarget('fin')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={16} color={Palette.primary} />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={styles.dateLabel}>Date fin</Text>
                    <Text style={styles.dateValue} weight="bold">{dateFin}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Step 3: Sections Selection */}
            <View style={styles.stepSection}>
              <View style={styles.stepHeader}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText} weight="bold">3</Text>
                </View>
                <Text style={styles.stepTitle} weight="bold">Contenu à intégrer</Text>
              </View>

              <View style={styles.checkboxList}>
                {[
                  { key: 'infosProjet', label: 'Fiche descriptive & localisation', icon: 'business' },
                  { key: 'avancementGlobal', label: 'Indicateurs clés & avancement global', icon: 'trending-up' },
                  { key: 'avancementChantiers', label: 'État détaillé des chantiers', icon: 'construct' },
                  { key: 'tronconsLineaire', label: 'Linéaires, PK & découpage tronçons', icon: 'git-network' },
                  { key: 'observationsTerrain', label: 'Relevés et photos des agents terrain', icon: 'camera' },
                  { key: 'reclamationsClient', label: 'Synthèse des réclamations client', icon: 'chatbubbles' },
                ].map((item) => {
                  const checked = (sections as any)[item.key];
                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={styles.checkboxItem}
                      onPress={() => toggleSection(item.key as any)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
                        {checked && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                      </View>
                      <Ionicons
                        name={item.icon as any}
                        size={16}
                        color={checked ? Palette.primary : Palette.textMuted}
                        style={{ marginHorizontal: 8 }}
                      />
                      <Text style={[styles.checkboxLabel, checked && styles.checkboxLabelChecked]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <Button
              title="Annuler"
              variant="outline"
              size="md"
              onPress={onClose}
              style={{ flex: 1 }}
            />
            <Button
              title="Générer le rapport &rarr;"
              variant="primary"
              size="md"
              onPress={handleGenerate}
              disabled={!currentProject}
              style={{ flex: 1.6 }}
            />
          </View>
        </View>
      </View>

      {/* Date Pickers */}
      <DatePickerModal
        visible={datePickerTarget === 'debut'}
        title="Date de début du rapport"
        initialValue={dateDebut}
        onClose={() => setDatePickerTarget(null)}
        onConfirm={(val) => {
          setDateDebut(val);
          setDatePickerTarget(null);
        }}
      />
      <DatePickerModal
        visible={datePickerTarget === 'fin'}
        title="Date de fin du rapport"
        initialValue={dateFin}
        onClose={() => setDatePickerTarget(null)}
        onConfirm={(val) => {
          setDateFin(val);
          setDatePickerTarget(null);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    color: '#0F172A',
  },
  subtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  stepSection: {
    marginBottom: 20,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
  },
  stepTitle: {
    fontSize: 14,
    color: '#0F172A',
  },
  projectPillsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  projectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  projectPillSelected: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  projectPillText: {
    fontSize: 13,
    color: Palette.text,
  },
  projectPillTextSelected: {
    color: '#FFFFFF',
  },
  clientBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  clientCheckIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientBoxLabel: {
    fontSize: 11,
    color: '#166534',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clientBoxName: {
    fontSize: 13,
    color: '#14532D',
  },
  clientBoxSub: {
    fontSize: 11,
    color: '#166534',
    marginTop: 1,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dateButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textTransform: 'uppercase',
  },
  dateValue: {
    fontSize: 13,
    color: '#0F172A',
    marginTop: 2,
  },
  checkboxList: {
    gap: 8,
  },
  checkboxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxBoxChecked: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  checkboxLabel: {
    fontSize: 13,
    color: Palette.text,
    flex: 1,
  },
  checkboxLabelChecked: {
    color: '#0F172A',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 12,
    backgroundColor: '#FFFFFF',
  },
});
