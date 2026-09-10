import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { api, ProjectDetails } from '@/services/api';
import {
  generateProjectPdfFile,
  downloadAndSavePdf,
  sharePdfFile,
  GeneratedPdfResult,
} from '@/services/report.service';

export default function ReportViewerScreen() {
  const router = useRouter();
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const { token, isLoading: isAuthLoading } = useAuth();

  const [project, setProject] = useState<ProjectDetails | null>(null);
  const [pdfData, setPdfData] = useState<GeneratedPdfResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!token || !id) {
      if (!isAuthLoading) {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (__DEV__) console.log(`[ReportViewer] Loading project #${id} for report...`);
      const data = await api.getProjectDetails(token, id);
      setProject(data.project);

      // Generate the PDF document locally
      const pdfRes = await generateProjectPdfFile(data.project);
      if (!pdfRes.success || !pdfRes.data) {
        throw new Error(pdfRes.error || 'Erreur lors de la génération du document.');
      }

      setPdfData(pdfRes.data);
    } catch (err: any) {
      console.error('[ReportViewer] Load error:', err);
      setError(err?.message || 'Impossible de charger le rapport de suivi.');
    } finally {
      setIsLoading(false);
    }
  }, [token, id, isAuthLoading]);

  useEffect(() => {
    if (!isAuthLoading) {
      loadReport();
    }
  }, [loadReport, isAuthLoading]);

  const handleDownload = async () => {
    if (!pdfData) return;
    setIsDownloading(true);

    try {
      const res = await downloadAndSavePdf(pdfData.uri, pdfData.filename, pdfData.html);
      if (res.success) {
        Alert.alert('Succès', res.message, [{ text: 'OK' }]);
      } else {
        Alert.alert('Erreur', res.message, [{ text: 'Fermer' }]);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err?.message || 'Erreur lors du téléchargement.', [{ text: 'Fermer' }]);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!pdfData) return;
    setIsSharing(true);

    try {
      const res = await sharePdfFile(pdfData.uri, pdfData.filename);
      if (!res.success && res.error) {
        Alert.alert('Partage', res.error, [{ text: 'Fermer' }]);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err?.message || 'Erreur lors du partage.', [{ text: 'Fermer' }]);
    } finally {
      setIsSharing(false);
    }
  };

  const displayTitle = project?.nom || title || 'Rapport de suivi';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── Top Action Bar ── */}
      <View style={styles.topBar}>
        {/* Back Button */}
        <TouchableOpacity
          style={styles.actionButton}
          activeOpacity={0.7}
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={24} color={Palette.primary} />
        </TouchableOpacity>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            Rapport de suivi
          </Text>
          <Text style={styles.headerTitle} weight="bold" numberOfLines={1}>
            {displayTitle}
          </Text>
        </View>

        {/* Action Buttons: Download & Share */}
        <View style={styles.actionsGroup}>
          {/* Download Button */}
          <TouchableOpacity
            style={[styles.actionButton, styles.iconActionButton]}
            activeOpacity={0.7}
            onPress={handleDownload}
            disabled={isLoading || isDownloading || !pdfData}
          >
            {isDownloading ? (
              <ActivityIndicator size="small" color={Palette.primary} />
            ) : (
              <Ionicons
                name="download-outline"
                size={22}
                color={!pdfData || isLoading ? Palette.textMuted : Palette.primary}
              />
            )}
          </TouchableOpacity>

          {/* Share Button */}
          <TouchableOpacity
            style={[styles.actionButton, styles.iconActionButton]}
            activeOpacity={0.7}
            onPress={handleShare}
            disabled={isLoading || isSharing || !pdfData}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color={Palette.primary} />
            ) : (
              <Ionicons
                name="share-social-outline"
                size={22}
                color={!pdfData || isLoading ? Palette.textMuted : Palette.primary}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main Content / PDF Viewer ── */}
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Palette.primary} />
          <Text style={styles.loadingText} weight="semibold">
            Génération du rapport en cours...
          </Text>
          <Text variant="muted" style={styles.loadingSubtext}>
            Extraction des données du projet
          </Text>
        </View>
      ) : error || !pdfData ? (
        <View style={styles.centerContainer}>
          <Card variant="elevated" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={36} color={Palette.alert} />
            <Text variant="error" style={styles.errorText}>
              {error || 'Impossible d’afficher le document.'}
            </Text>
            <TouchableOpacity style={styles.retryButton} onPress={loadReport}>
              <Text style={styles.retryButtonText} weight="bold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      ) : (
        <View style={styles.viewerContainer}>
          {Platform.OS === 'web' ? (
            <iframe
              srcDoc={pdfData.html}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                backgroundColor: '#F8FAFC',
              }}
              title="SiteX Report Preview"
            />
          ) : (
            <WebView
              originWhitelist={['*']}
              source={{ html: pdfData.html }}
              style={styles.webView}
              scalesPageToFit={Platform.OS === 'android'}
              showsVerticalScrollIndicator={true}
              showsHorizontalScrollIndicator={false}
              nestedScrollEnabled={true}
              bounces={true}
            />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    zIndex: 10,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconActionButton: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  titleContainer: {
    flex: 1,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  headerSubtitle: {
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: Palette.textMuted,
  },
  headerTitle: {
    fontSize: 14.5,
    color: Palette.text,
  },
  actionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#F1F5F9',
  },
  webView: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    color: Palette.text,
  },
  loadingSubtext: {
    marginTop: 4,
    fontSize: 12.5,
  },
  errorCard: {
    padding: 24,
    alignItems: 'center',
    maxWidth: 340,
    width: '100%',
  },
  errorText: {
    marginTop: 12,
    textAlign: 'center',
    fontSize: 14,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: Palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
