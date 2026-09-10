import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { api, ChantierDetails, ChantierImage } from '@/services/api';

/** Helper to format ISO dates into friendly French representation */
function formatFrenchDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type ImageCategory = 'satellite' | 'drone' | 'terrain';

export default function ChantierImagesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<ImageCategory>('satellite');
  const [chantier, setChantier] = useState<ChantierDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDetails = useCallback(async (isRefresh = false) => {
    if (!token || !id) {
      if (!isAuthLoading) {
        setIsLoading(false);
      }
      return;
    }

    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await api.getChantierDetails(token, id);
      setChantier(data.chantier);
    } catch (err: any) {
      console.error('[ImagesScreen] Error:', err.message);
      setError(err.message || 'Impossible de charger les images du chantier.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchDetails();
    }
  }, [fetchDetails, isAuthLoading]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Palette.primary} />
          <Text variant="muted" style={styles.loadingText}>
            Chargement de la médiathèque...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !chantier) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Card variant="elevated" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={32} color={Palette.alert} />
            <Text variant="error" style={styles.errorText}>
              {error || 'Données introuvables.'}
            </Text>
            <TouchableOpacity onPress={() => fetchDetails()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const satelliteImages: ChantierImage[] = chantier.images || [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── 1. Top Navigation Bar ── */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.primary} />
          <Text style={styles.backButtonText} weight="semibold">
            Chantier
          </Text>
        </TouchableOpacity>
        <Text variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          Images & Télédétection
        </Text>
        <View style={{ width: 70 }} />
      </View>

      {/* ── 2. Category Tabs ── */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'satellite' && styles.tabButtonActive]}
          onPress={() => setActiveTab('satellite')}
        >
          <Text
            style={[styles.tabText, activeTab === 'satellite' && styles.tabTextActive]}
            weight={activeTab === 'satellite' ? 'bold' : 'normal'}
          >
            Satellite ({satelliteImages.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'drone' && styles.tabButtonActive]}
          onPress={() => setActiveTab('drone')}
        >
          <Text
            style={[styles.tabText, activeTab === 'drone' && styles.tabTextActive]}
            weight={activeTab === 'drone' ? 'bold' : 'normal'}
          >
            Drone (0)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'terrain' && styles.tabButtonActive]}
          onPress={() => setActiveTab('terrain')}
        >
          <Text
            style={[styles.tabText, activeTab === 'terrain' && styles.tabTextActive]}
            weight={activeTab === 'terrain' ? 'bold' : 'normal'}
          >
            Photos terrain (0)
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchDetails(true)}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ── Satellite Tab ── */}
        {activeTab === 'satellite' && (
          <View style={styles.tabSection}>
            {satelliteImages.length === 0 ? (
              <Card variant="elevated" style={styles.emptyCard}>
                <Ionicons name="planet-outline" size={48} color={Palette.textLight} />
                <Text variant="h3" style={styles.emptyTitle}>
                  Aucune image satellite
                </Text>
                <Text variant="muted" style={styles.emptyText}>
                  Les acquisitions Sentinel-2 et PlanetScope liées à ce chantier apparaîtront ici.
                </Text>
              </Card>
            ) : (
              satelliteImages.map((img) => (
                <Card key={img.id} variant="elevated" style={styles.imageCard}>
                  {/* Image Header */}
                  <View style={styles.imageCardHeader}>
                    <View style={styles.satelliteBadge}>
                      <Ionicons name="planet" size={14} color="#2563EB" />
                      <Text style={styles.satelliteBadgeText} weight="bold">
                        {img.source || 'Satellite'}
                      </Text>
                    </View>
                    <Text style={styles.imageDateText}>
                      {formatFrenchDate(img.date_acquisition)}
                    </Text>
                  </View>

                  {/* Satellite Thumbnail Mock Canvas */}
                  <View style={styles.satellitePreviewBanner}>
                    <Ionicons name="earth-outline" size={36} color={Palette.primary} />
                    <Text style={styles.satellitePreviewLabel}>
                      {img.type_image || 'Optique Multispectrale'}
                    </Text>
                    <Text style={styles.satelliteIndexBadge}>
                      Indice : {img.indice_spectral || 'NDVI'} • Résolution : {img.resolution || 10}m
                    </Text>
                  </View>

                  {/* Metadata Grid */}
                  <View style={styles.metaGrid}>
                    <View style={styles.metaCol}>
                      <Text style={styles.metaColLabel}>Couverture nuageuse</Text>
                      <Text style={styles.metaColValue} weight="medium">
                        {img.cloud_coverage !== null && img.cloud_coverage !== undefined
                          ? `${img.cloud_coverage}%`
                          : '0%'}
                      </Text>
                    </View>

                    <View style={styles.metaCol}>
                      <Text style={styles.metaColLabel}>Fichier source</Text>
                      <Text style={styles.metaColValue} numberOfLines={1} weight="medium">
                        {img.url_fichier?.split('/').pop() || 'raster.tif'}
                      </Text>
                    </View>
                  </View>
                </Card>
              ))
            )}
          </View>
        )}

        {/* ── Drone Tab ── */}
        {activeTab === 'drone' && (
          <Card variant="elevated" style={styles.emptyCard}>
            <Ionicons name="airplane-outline" size={48} color={Palette.textLight} />
            <Text variant="h3" style={styles.emptyTitle}>
              Aucune mission drone
            </Text>
            <Text variant="muted" style={styles.emptyText}>
              Les orthophotos et modèles numériques d'élévation (MNE) par drone seront accessibles après validation opérationnelle.
            </Text>
          </Card>
        )}

        {/* ── Photos Terrain Tab ── */}
        {activeTab === 'terrain' && (
          <Card variant="elevated" style={styles.emptyCard}>
            <Ionicons name="camera-outline" size={48} color={Palette.textLight} />
            <Text variant="h3" style={styles.emptyTitle}>
              Aucune photo de terrain
            </Text>
            <Text variant="muted" style={styles.emptyText}>
              Les photographies géolocalisées prises sur le terrain par les agents apparaîtront dans cette section.
            </Text>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Palette.background,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  backButtonText: {
    fontSize: 16,
    color: Palette.primary,
  },
  headerTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
    backgroundColor: '#E5EBE8',
    borderRadius: 10,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: Palette.primary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  tabSection: {
    gap: 12,
  },
  imageCard: {
    padding: 16,
  },
  imageCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  satelliteBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(37, 99, 235, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  satelliteBadgeText: {
    fontSize: 12,
    color: '#2563EB',
  },
  imageDateText: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  satellitePreviewBanner: {
    height: 120,
    backgroundColor: 'rgba(23, 107, 91, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 12,
  },
  satellitePreviewLabel: {
    fontSize: 13,
    color: Palette.text,
    fontWeight: '600',
  },
  satelliteIndexBadge: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  metaGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  metaCol: {
    flex: 1,
  },
  metaColLabel: {
    fontSize: 10,
    color: Palette.textLight,
    marginBottom: 2,
  },
  metaColValue: {
    fontSize: 12,
    color: Palette.text,
  },
  emptyCard: {
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorCard: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  retryBtn: {
    backgroundColor: Palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
