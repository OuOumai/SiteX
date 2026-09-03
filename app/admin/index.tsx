import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { api, AdminStats } from '@/services/api';

export default function AdminDashboardScreen() {
  const router = useRouter();
  const { user, token, logout } = useAuth();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.getAdminStats(token);
      setStats(data);
    } catch (err: any) {
      console.warn('Failed to load admin stats:', err?.message);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchStats();
  }, [fetchStats]);

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Voulez-vous vraiment vous déconnecter ?')) {
        logout();
      }
      return;
    }

    Alert.alert(
      'Déconnexion',
      'Voulez-vous vraiment vous déconnecter du compte Administrateur ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: () => logout(),
        },
      ]
    );
  };

  const adminName = user ? `${user.prenom || ''} ${user.nom || ''}`.trim() : 'Administrateur';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Palette.primary]}
            tintColor={Palette.primary}
          />
        }
      >
        {/* ── 1. Top Admin Navigation Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.adminBadgeRow}>
                <View style={styles.adminShieldBadge}>
                  <Ionicons name="shield-checkmark" size={13} color="#FFFFFF" />
                  <Text style={styles.adminShieldText} weight="bold">
                    ADMINISTRATEUR
                  </Text>
                </View>
                <View style={styles.liveIndicator}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Supervision active</Text>
                </View>
              </View>

              <Text variant="h1" style={styles.title}>
                Administration
              </Text>
              <Text variant="subtitle" style={styles.subtitle}>
                Console de gouvernance & validation SiteX
              </Text>
            </View>

            <TouchableOpacity
              style={styles.logoutBtn}
              activeOpacity={0.7}
              onPress={handleLogout}
              accessibilityLabel="Se déconnecter"
            >
              <Ionicons name="log-out-outline" size={20} color={Palette.alert} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 2. Admin Identity Banner ── */}
        <Card variant="elevated" style={styles.identityCard}>
          <View style={styles.identityRow}>
            <View style={styles.identityAvatar}>
              <Ionicons name="person-circle" size={44} color={Palette.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text weight="bold" style={styles.identityName}>
                {adminName || 'Admin SiteX'}
              </Text>
              <Text style={styles.identityEmail} variant="muted">
                {user?.email || 'admin@sitex.local'}
              </Text>
              <Text style={styles.identityRoleNote}>
                Rôle Système : Administrateur Général (Privilèges complets)
              </Text>
            </View>
          </View>
        </Card>

        {/* ── 3. Quick Supervision Metrics ── */}
        <Text variant="h2" style={styles.sectionHeading}>
          Vue d'ensemble
        </Text>

        {isLoading && !refreshing ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="small" color={Palette.primary} />
            <Text style={styles.loadingText}>Chargement des métriques...</Text>
          </View>
        ) : (
          <View style={styles.statsGrid}>
            <TouchableOpacity
              style={[styles.statCard, styles.statCardPending]}
              activeOpacity={0.8}
              onPress={() => router.push('/admin/demandes')}
            >
              <View style={styles.statIconContainerPending}>
                <Ionicons name="hourglass-outline" size={24} color="#D97706" />
              </View>
              <Text style={styles.statNumberPending}>
                {stats?.pendingRequests ?? 0}
              </Text>
              <Text style={styles.statLabelPending} weight="bold">
                Demandes en attente
              </Text>
              <Text style={styles.statActionHint}>Toucher pour traiter →</Text>
            </TouchableOpacity>

            <View style={styles.statCard}>
              <View style={styles.statIconContainerUsers}>
                <Ionicons name="people-outline" size={24} color={Palette.primary} />
              </View>
              <Text style={styles.statNumber}>{stats?.totalUsers ?? 0}</Text>
              <Text style={styles.statLabel}>Utilisateurs actifs</Text>
            </View>
          </View>
        )}

        {/* ── 4. Main Administrative Sections ── */}
        <Text variant="h2" style={styles.sectionHeading}>
          Modules de gestion
        </Text>

        {/* Section 1: Demandes de rôles (Primary focus) */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => router.push('/admin/demandes')}
        >
          <Card variant="elevated" style={styles.moduleCard}>
            <View style={styles.moduleIconWrapperOrange}>
              <Ionicons name="id-card-outline" size={26} color="#D97706" />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <View style={styles.moduleTitleRow}>
                <Text weight="bold" style={styles.moduleTitle}>
                  1. Demandes de rôles
                </Text>
                {(stats?.pendingRequests ?? 0) > 0 && (
                  <View style={styles.badgePendingCount}>
                    <Text style={styles.badgePendingCountText} weight="bold">
                      {stats?.pendingRequests} en attente
                    </Text>
                  </View>
                )}
              </View>
              <Text style={styles.moduleDescription}>
                Examiner les demandes de profils (Responsable, Agent Terrain, Client), valider ou refuser les attributions de rôles.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Palette.textMuted} />
          </Card>
        </TouchableOpacity>

        {/* Section 2: Utilisateurs */}
        <Card variant="elevated" style={[styles.moduleCard, { marginTop: 12 }]}>
          <View style={styles.moduleIconWrapperTeal}>
            <Ionicons name="person-outline" size={26} color={Palette.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text weight="bold" style={styles.moduleTitle}>
              2. Utilisateurs
            </Text>
            <Text style={styles.moduleDescription}>
              Supervision des comptes utilisateurs enregistrés sur la plateforme PostgreSQL ({stats?.totalUsers ?? 0} comptes).
            </Text>
          </View>
          <View style={styles.badgeSupervision}>
            <Text style={styles.badgeSupervisionText}>Supervisé</Text>
          </View>
        </Card>

        {/* Section 3: Rôles & Permissions */}
        <Card variant="elevated" style={[styles.moduleCard, { marginTop: 12, marginBottom: 30 }]}>
          <View style={styles.moduleIconWrapperBlue}>
            <MaterialCommunityIcons name="shield-account-outline" size={26} color="#2563EB" />
          </View>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text weight="bold" style={styles.moduleTitle}>
              3. Rôles & permissions
            </Text>
            <Text style={styles.moduleDescription}>
              Matrice de contrôle d'accès basée sur les rôles (RBAC) : Administrateur, Responsable, Agent Terrain, Client.
            </Text>
            {stats?.roles && (
              <View style={styles.roleTagsRow}>
                {stats.roles.map((r) => (
                  <View key={r.id} style={styles.roleTag}>
                    <Text style={styles.roleTagText}>
                      {r.nom} ({r.user_count})
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
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
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  adminBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  adminShieldBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Palette.primary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  adminShieldText: {
    fontSize: 10,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(42, 157, 143, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '500',
  },
  title: {
    fontSize: 26,
    color: Palette.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 2,
  },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(217, 83, 79, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(217, 83, 79, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  identityCard: {
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(23, 107, 91, 0.18)',
    borderWidth: 1,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  identityAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityName: {
    fontSize: 16,
    color: Palette.text,
  },
  identityEmail: {
    fontSize: 13,
    marginTop: 1,
  },
  identityRoleNote: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 17,
    color: Palette.text,
    marginBottom: 12,
    marginTop: 6,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 20,
  },
  loadingText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statCardPending: {
    backgroundColor: '#FFFBEB',
    borderColor: 'rgba(217, 119, 6, 0.3)',
  },
  statIconContainerPending: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statIconContainerUsers: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statNumber: {
    fontSize: 26,
    fontWeight: '700',
    color: Palette.text,
  },
  statNumberPending: {
    fontSize: 26,
    fontWeight: '700',
    color: '#B45309',
  },
  statLabel: {
    fontSize: 13,
    color: Palette.textMuted,
    marginTop: 2,
  },
  statLabelPending: {
    fontSize: 13,
    color: '#92400E',
    marginTop: 2,
  },
  statActionHint: {
    fontSize: 11,
    color: '#D97706',
    fontWeight: '600',
    marginTop: 6,
  },
  moduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: Palette.border,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  moduleIconWrapperOrange: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleIconWrapperTeal: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleIconWrapperBlue: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  moduleTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  moduleDescription: {
    fontSize: 12,
    color: Palette.textMuted,
    lineHeight: 17,
  },
  badgePendingCount: {
    backgroundColor: '#D97706',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgePendingCountText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  badgeSupervision: {
    backgroundColor: 'rgba(42, 157, 143, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeSupervisionText: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
  },
  roleTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  roleTag: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  roleTagText: {
    fontSize: 11,
    color: Palette.text,
    fontWeight: '500',
  },
});
