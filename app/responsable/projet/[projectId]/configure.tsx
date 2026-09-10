import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, ProjectDetails } from '@/services/api';

const INFRA_ICONS: Record<string, string> = {
  Ferroviaire: 'train-outline',
  Routier: 'car-outline',
  Hydraulique: 'water-outline',
  Autre: 'business-outline',
};

export default function ProjectConfigureScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { token, user } = useAuth();

  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [chantierCount, setChantierCount] = useState<number>(3);

  useEffect(() => {
    async function load() {
      if (!token || !projectId) return;
      try {
        const res = await api.getProjectDetails(token, projectId);
        setProject(res.project);
      } catch (err) {
        console.error('Erreur chargement projet configure:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [token, projectId]);

  const handleDecrement = () => {
    setChantierCount((prev) => Math.max(1, prev - 1));
  };

  const handleIncrement = () => {
    setChantierCount((prev) => Math.min(50, prev + 1));
  };

  const handleStartWorkflow = () => {
    if (!projectId) return;
    router.replace(
      `/responsable/projet/${projectId}/chantier/create?current=1&total=${chantierCount}` as any
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Palette.primary} />
        <Text style={styles.loadingText}>Initialisation du projet...</Text>
      </SafeAreaView>
    );
  }

  const infraIcon = (project?.type_projet && INFRA_ICONS[project.type_projet]) || 'business-outline';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.replace(`/responsable/projet/${projectId}` as any)}
        >
          <Ionicons name="arrow-back" size={22} color={Palette.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text variant="h1" style={styles.headerTitle}>
            Structuration des Chantiers
          </Text>
          <Text variant="subtitle" style={styles.headerSubtitle}>
            Étape 2/2 : Organisation spatiale du projet
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Project Information Banner */}
        <View style={styles.projectBanner}>
          <View style={styles.projectIconWrap}>
            <Ionicons name={infraIcon as any} size={24} color={Palette.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.projectTagRow}>
              <View style={styles.projectTypeTag}>
                <Text style={styles.projectTypeTagText}>
                  {project?.type_projet || 'Infrastructure'}
                </Text>
              </View>
              <Text style={styles.projectStatutText}>
                Statut : {project?.statut || 'En cours'}
              </Text>
            </View>
            <Text style={styles.projectName} weight="bold">
              {project?.nom || 'Projet'}
            </Text>
            {project?.description ? (
              <Text style={styles.projectDesc} numberOfLines={2}>
                {project.description}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Hierarchy & Concept Card */}
        <Card variant="elevated" style={styles.conceptCard}>
          <View style={styles.conceptHeader}>
            <Ionicons name="git-network-outline" size={22} color={Palette.primary} />
            <Text style={styles.conceptTitle} weight="bold">
              Hiérarchie du Projet
            </Text>
          </View>
          <Text style={styles.conceptBody}>
            Un projet d'infrastructure se compose de plusieurs chantiers indépendants. Chaque chantier disposera de sa propre emprise spatiale (AOI), de son axe de référence et de son découpage en tronçons.
          </Text>

          {/* Diagram Preview */}
          <View style={styles.hierarchyDiagram}>
            <View style={styles.diagramNodeProject}>
              <Ionicons name="folder-open" size={16} color="#1E40AF" />
              <Text style={styles.diagramNodeProjectText} weight="bold">
                {project?.nom || 'Projet'}
              </Text>
            </View>
            <View style={styles.diagramConnector} />
            <View style={styles.diagramBranches}>
              {Array.from({ length: Math.min(3, chantierCount) }).map((_, i) => (
                <View key={i} style={styles.diagramChantierBadge}>
                  <Text style={styles.diagramChantierText}>
                    Chantier {i + 1}
                  </Text>
                  <Text style={styles.diagramTronconSubtext}>
                    └ Tronçons
                  </Text>
                </View>
              ))}
              {chantierCount > 3 ? (
                <View style={styles.diagramChantierBadgeMore}>
                  <Text style={styles.diagramChantierTextMore}>
                    +{chantierCount - 3} autres
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </Card>

        {/* Stepper Selection Card */}
        <Card variant="elevated" style={styles.selectorCard}>
          <Text style={styles.questionTitle} weight="bold">
            Combien de chantiers souhaitez-vous créer pour ce projet ?
          </Text>
          <Text style={styles.questionSubtitle}>
            Choisissez le nombre initial de chantiers ou lots à configurer :
          </Text>

          {/* Large Stepper Control */}
          <View style={styles.stepperRow}>
            <TouchableOpacity
              style={[styles.stepBtn, chantierCount <= 1 && styles.stepBtnDisabled]}
              onPress={handleDecrement}
              disabled={chantierCount <= 1}
              activeOpacity={0.7}
            >
              <Ionicons
                name="remove"
                size={28}
                color={chantierCount <= 1 ? Palette.textLight : Palette.primary}
              />
            </TouchableOpacity>

            <View style={styles.counterDisplay}>
              <Text style={styles.counterValue} weight="bold">
                {chantierCount}
              </Text>
              <Text style={styles.counterUnit}>
                {chantierCount === 1 ? 'chantier' : 'chantiers'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.stepBtn}
              onPress={handleIncrement}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={28} color={Palette.primary} />
            </TouchableOpacity>
          </View>

          {/* Quick Presets */}
          <View style={styles.presetsRow}>
            {[1, 2, 3, 4, 5].map((num) => (
              <TouchableOpacity
                key={num}
                style={[
                  styles.presetChip,
                  chantierCount === num && styles.presetChipActive,
                ]}
                onPress={() => setChantierCount(num)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.presetChipText,
                    chantierCount === num && styles.presetChipTextActive,
                  ]}
                  weight={chantierCount === num ? 'bold' : 'normal'}
                >
                  {num} {num === 1 ? 'chantier' : 'chantiers'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Workflow Sequence Preview */}
          <View style={styles.flowPreviewBox}>
            <Text style={styles.flowPreviewHeader} weight="bold">
              Déroulement de la configuration :
            </Text>
            {Array.from({ length: chantierCount }).map((_, idx) => (
              <View key={idx} style={styles.flowPreviewItem}>
                <View style={[styles.flowPreviewNumber, idx === 0 && styles.flowPreviewNumberActive]}>
                  <Text
                    style={[styles.flowPreviewNumberText, idx === 0 && styles.flowPreviewNumberTextActive]}
                    weight="bold"
                  >
                    {idx + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.flowPreviewItemTitle} weight="medium">
                    Chantier {idx + 1} sur {chantierCount}
                  </Text>
                  <Text style={styles.flowPreviewItemSub}>
                    Emprise spatiale (AOI) • Tracé de référence • Découpage en tronçons
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Action Button */}
          <Button
            title={`Continuer la configuration (Chantier 1/${chantierCount}) →`}
            variant="primary"
            size="lg"
            onPress={handleStartWorkflow}
            style={{ marginTop: 24 }}
          />
        </Card>
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
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Palette.textMuted,
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
    padding: 18,
    paddingBottom: 40,
    gap: 16,
  },
  projectBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  projectIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  projectTypeTag: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  projectTypeTagText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#1E40AF',
  },
  projectStatutText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  projectName: {
    fontSize: 16,
    color: Palette.text,
  },
  projectDesc: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  conceptCard: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  conceptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  conceptTitle: {
    fontSize: 14,
    color: Palette.primaryDark,
  },
  conceptBody: {
    fontSize: 12.5,
    color: Palette.textMuted,
    lineHeight: 18,
    marginBottom: 14,
  },
  hierarchyDiagram: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  diagramNodeProject: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  diagramNodeProjectText: {
    fontSize: 13,
    color: '#1E40AF',
  },
  diagramConnector: {
    width: 2,
    height: 14,
    backgroundColor: '#CBD5E1',
    marginVertical: 4,
  },
  diagramBranches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  diagramChantierBadge: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  diagramChantierText: {
    fontSize: 12,
    fontWeight: '600',
    color: Palette.text,
  },
  diagramTronconSubtext: {
    fontSize: 10,
    color: Palette.textMuted,
    marginTop: 2,
  },
  diagramChantierBadgeMore: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diagramChantierTextMore: {
    fontSize: 11,
    fontWeight: '600',
    color: Palette.textMuted,
  },
  selectorCard: {
    padding: 20,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
  },
  questionTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  questionSubtitle: {
    fontSize: 12.5,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 20,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    marginBottom: 18,
  },
  stepBtn: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(23, 107, 91, 0.25)',
  },
  stepBtnDisabled: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  counterDisplay: {
    alignItems: 'center',
    minWidth: 120,
  },
  counterValue: {
    fontSize: 42,
    color: Palette.primary,
    lineHeight: 48,
  },
  counterUnit: {
    fontSize: 13,
    color: Palette.textMuted,
    fontWeight: '500',
    marginTop: -2,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipActive: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  presetChipText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  presetChipTextActive: {
    color: '#FFFFFF',
  },
  flowPreviewBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  flowPreviewHeader: {
    fontSize: 12.5,
    color: Palette.text,
    marginBottom: 2,
  },
  flowPreviewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flowPreviewNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowPreviewNumberActive: {
    backgroundColor: Palette.primary,
  },
  flowPreviewNumberText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  flowPreviewNumberTextActive: {
    color: '#FFFFFF',
  },
  flowPreviewItemTitle: {
    fontSize: 12.5,
    color: Palette.text,
  },
  flowPreviewItemSub: {
    fontSize: 10.5,
    color: Palette.textMuted,
  },
});

