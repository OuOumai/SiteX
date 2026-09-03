import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, ProjectDetails } from '@/services/api';

export default function ProjectConfigureRedirectScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function init() {
      if (!token || !projectId) return;
      try {
        const res = await api.getProjectDetails(token, projectId);
        const chantiers = res.project?.chantiers || [];
        if (chantiers.length > 0) {
          // Redirect to first chantier's GIS wizard
          router.replace(`/responsable/chantier/${chantiers[0].id}/gis` as any);
        } else {
          // No chantier yet, redirect to create a new lot/chantier
          router.replace(`/responsable/projet/${projectId}/chantier/create` as any);
        }
      } catch (err) {
        console.error('Erreur chargement projet configure:', err);
        setIsLoading(false);
      }
    }
    init();
  }, [token, projectId, router]);

  return (
    <SafeAreaView style={styles.container}>
      <ActivityIndicator size="large" color={Palette.primary} />
      <Text style={styles.text}>Redirection vers l'assistant GIS du chantier...</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  text: {
    marginTop: 12,
    fontSize: 14,
    color: Palette.textMuted,
  },
});
