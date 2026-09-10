import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { DeleteConfirmationModal } from '@/components/ui/delete-confirmation-modal';

interface GlobalAppDrawerProps {
  visible: boolean;
  onClose: () => void;
  activeTronconId?: number | null;
}

export function GlobalAppDrawer({
  visible,
  onClose,
  activeTronconId,
}: GlobalAppDrawerProps) {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Responsive drawer width: 82% of screen on mobile up to max 340px
  const drawerWidth = Math.min(Math.round(width * 0.82), 340);
  const translateX = useRef(new Animated.Value(-drawerWidth)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;

  const isPendingRole = user?.role_request?.statut === 'PENDING';
  const isAdmin = user?.role_nom === 'Administrateur' || user?.role_id === 1;
  const isResponsable =
    !isPendingRole &&
    (user?.role_nom === 'Responsable' || user?.role_id === 2 || isAdmin);
  const isAgentTerrain =
    !isPendingRole && (user?.role_nom === 'AgentTerrain' || user?.role_id === 3);
  const isClient =
    !isPendingRole && (user?.role_nom === 'Client' || user?.role_id === 4);

  useEffect(() => {
    if (visible) {
      translateX.setValue(-drawerWidth);
      overlayOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          damping: 24,
          stiffness: 240,
        }),
        Animated.timing(overlayOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, drawerWidth, translateX, overlayOpacity]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -drawerWidth,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  };

  const navigateTo = (route: string) => {
    handleClose();
    setTimeout(() => {
      router.push(route as any);
    }, 120);
  };

  const handleConfirmLogout = async () => {
    setShowLogoutConfirm(false);
    handleClose();
    setTimeout(async () => {
      await logout();
      router.replace('/(auth)/login');
    }, 150);
  };

  // Role Badge Info
  let roleBadgeText = 'ESPACE SITEX';
  let roleBadgeBg = Palette.primary;
  let roleBadgeIcon: any = 'briefcase';

  if (isPendingRole) {
    roleBadgeText = 'EN ATTENTE';
    roleBadgeBg = '#D97706';
    roleBadgeIcon = 'time-outline';
  } else if (isAdmin) {
    roleBadgeText = 'ADMINISTRATEUR';
    roleBadgeBg = '#7C3AED';
    roleBadgeIcon = 'shield-checkmark';
  } else if (isResponsable) {
    roleBadgeText = 'RESPONSABLE PROJET';
    roleBadgeBg = Palette.primary;
    roleBadgeIcon = 'briefcase';
  } else if (isAgentTerrain) {
    roleBadgeText = 'AGENT DE TERRAIN';
    roleBadgeBg = '#0D9488';
    roleBadgeIcon = 'navigate-outline';
  } else if (isClient) {
    roleBadgeText = 'ESPACE CLIENT';
    roleBadgeBg = '#2563EB';
    roleBadgeIcon = 'business-outline';
  }

  const displayName =
    user?.prenom && user?.nom
      ? `${user.prenom} ${user.nom}`
      : user?.email?.split('@')[0] || 'Utilisateur';

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={handleClose}
      >
        <View style={styles.modalRoot}>
          {/* Dimmed backdrop */}
          <Animated.View
            style={[
              styles.backdrop,
              {
                opacity: overlayOpacity,
              },
            ]}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={handleClose}
              accessibilityLabel="Fermer le menu"
            />
          </Animated.View>

          {/* Sliding Drawer Container */}
          <Animated.View
            style={[
              styles.drawerContainer,
              {
                width: drawerWidth,
                transform: [{ translateX }],
                paddingTop: Math.max(insets.top, Platform.OS === 'ios' ? 52 : 40),
                paddingBottom: Math.max(insets.bottom, 24),
              },
            ]}
          >
            {/* ── 1. Header with Brand & Close Button ── */}
            <View style={styles.header}>
              <View style={styles.brandRow}>
                <View style={styles.brandLogoBox}>
                  <Ionicons name="git-network" size={20} color="#FFFFFF" />
                </View>
                <View>
                  <Text variant="h2" style={styles.brandTitle} weight="bold">
                    SiteX
                  </Text>
                  <Text style={styles.brandSubtitle}>Plateforme SIG Linéaire</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.closeBtn}
                onPress={handleClose}
                activeOpacity={0.7}
                accessibilityLabel="Fermer"
              >
                <Ionicons name="close" size={22} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* ── 2. User Profile Card ── */}
            <TouchableOpacity
              style={styles.profileCard}
              activeOpacity={0.8}
              onPress={() => navigateTo('/(tabs)/profile')}
            >
              <View style={styles.avatarWrap}>
                {user?.photo_url ? (
                  <Image source={{ uri: user.photo_url }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText} weight="bold">
                      {user?.prenom?.[0] || 'U'}
                      {user?.nom?.[0] || ''}
                    </Text>
                  </View>
                )}
              </View>

              <View style={{ flex: 1 }}>
                <View style={[styles.roleBadge, { backgroundColor: roleBadgeBg }]}>
                  <Ionicons name={roleBadgeIcon} size={11} color="#FFFFFF" />
                  <Text style={styles.roleBadgeLabel} weight="bold">
                    {roleBadgeText}
                  </Text>
                </View>
                <Text style={styles.profileName} weight="bold" numberOfLines={1}>
                  {displayName}
                </Text>
                <Text style={styles.profileEmail} numberOfLines={1}>
                  {user?.email}
                </Text>
              </View>

              <Ionicons name="chevron-forward" size={18} color={Palette.textMuted} />
            </TouchableOpacity>

            <View style={styles.divider} />

            {/* ── 3. Navigation Links (Role-Aware) ── */}
            <View style={styles.navSection}>
              <Text style={styles.sectionHeading} weight="bold">
                NAVIGATION
              </Text>

              {/* Home / Dashboard */}
              <TouchableOpacity
                style={styles.navItem}
                onPress={() => navigateTo('/(tabs)')}
                activeOpacity={0.7}
              >
                <View style={[styles.navIconBox, { backgroundColor: '#F0FDFA' }]}>
                  <Ionicons name="grid-outline" size={19} color={Palette.primary} />
                </View>
                <Text style={styles.navLabel} weight="semibold">
                  Tableau de bord
                </Text>
              </TouchableOpacity>

              {/* GIS Map */}
              <TouchableOpacity
                style={styles.navItem}
                onPress={() => navigateTo('/(tabs)/map')}
                activeOpacity={0.7}
              >
                <View style={[styles.navIconBox, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="map-outline" size={19} color="#2563EB" />
                </View>
                <Text style={styles.navLabel} weight="semibold">
                  Carte interactive
                </Text>
              </TouchableOpacity>

              {/* Projects */}
              <TouchableOpacity
                style={styles.navItem}
                onPress={() => navigateTo('/(tabs)/projects')}
                activeOpacity={0.7}
              >
                <View style={[styles.navIconBox, { backgroundColor: '#FAF5FF' }]}>
                  <Ionicons name="folder-open-outline" size={19} color="#9333EA" />
                </View>
                <Text style={styles.navLabel} weight="semibold">
                  {isClient ? 'Mes Chantiers & Suivi' : 'Projets & Chantiers'}
                </Text>
              </TouchableOpacity>

              {/* Profile */}
              <TouchableOpacity
                style={styles.navItem}
                onPress={() => navigateTo('/(tabs)/profile')}
                activeOpacity={0.7}
              >
                <View style={[styles.navIconBox, { backgroundColor: '#F8FAFC' }]}>
                  <Ionicons name="person-outline" size={19} color="#64748B" />
                </View>
                <Text style={styles.navLabel} weight="semibold">
                  Mon Profil
                </Text>
              </TouchableOpacity>
            </View>

            {/* ── 4. Role-Specific Section ── */}
            {isResponsable && (
              <View style={styles.navSection}>
                <Text style={styles.sectionHeading} weight="bold">
                  GESTION RESPONSABLE
                </Text>

                <TouchableOpacity
                  style={styles.navItem}
                  onPress={() => navigateTo('/responsable/projet/create')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIconBox, { backgroundColor: '#ECFDF5' }]}>
                    <Ionicons name="add-circle-outline" size={19} color="#059669" />
                  </View>
                  <Text style={styles.navLabel} weight="semibold">
                    + Nouveau Projet
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navItem}
                  onPress={() => navigateTo('/responsable/equipe-terrain')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIconBox, { backgroundColor: '#CCFBF1' }]}>
                    <Ionicons name="people-outline" size={19} color="#0D9488" />
                  </View>
                  <Text style={styles.navLabel} weight="semibold">
                    Équipe terrain & A.T.
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.navItem}
                  onPress={() => navigateTo('/responsable')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIconBox, { backgroundColor: '#F0FDFA' }]}>
                    <Ionicons name="speedometer-outline" size={19} color={Palette.primary} />
                  </View>
                  <Text style={styles.navLabel} weight="semibold">
                    Hub Supervision
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {isAgentTerrain && (
              <View style={styles.navSection}>
                <Text style={styles.sectionHeading} weight="bold">
                  ESPACE TERRAIN
                </Text>

                <TouchableOpacity
                  style={styles.navItem}
                  onPress={() => navigateTo('/(tabs)')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIconBox, { backgroundColor: '#CCFBF1' }]}>
                    <Ionicons name="navigate-outline" size={19} color="#0D9488" />
                  </View>
                  <Text style={styles.navLabel} weight="semibold">
                    {"Mes Missions d'Inspection"}
                  </Text>
                </TouchableOpacity>

                {activeTronconId ? (
                  <TouchableOpacity
                    style={styles.navItem}
                    onPress={() => navigateTo(`/agent/troncon/${activeTronconId}`)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.navIconBox, { backgroundColor: '#ECFDF5' }]}>
                      <Ionicons name="compass-outline" size={19} color="#16A34A" />
                    </View>
                    <Text style={styles.navLabel} weight="semibold">
                      Tronçon en cours
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )}

            {isAdmin && (
              <View style={styles.navSection}>
                <Text style={styles.sectionHeading} weight="bold">
                  ADMINISTRATION
                </Text>

                <TouchableOpacity
                  style={styles.navItem}
                  onPress={() => navigateTo('/admin')}
                  activeOpacity={0.7}
                >
                  <View style={[styles.navIconBox, { backgroundColor: '#F3E8FF' }]}>
                    <Ionicons name="shield-outline" size={19} color="#7C3AED" />
                  </View>
                  <Text style={styles.navLabel} weight="semibold">
                    Console Administrateur
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── 5. Drawer Footer & Logout ── */}
            <View style={styles.footer}>
              <View style={styles.divider} />

              <TouchableOpacity
                style={styles.logoutBtn}
                onPress={() => setShowLogoutConfirm(true)}
                activeOpacity={0.75}
              >
                <Ionicons name="log-out-outline" size={20} color="#DC2626" />
                <Text style={styles.logoutText} weight="bold">
                  Déconnexion
                </Text>
              </TouchableOpacity>

              <Text style={styles.versionText}>
                SiteX v1.0 • Moteur SIG Linéaire PostGIS
              </Text>
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Logout Confirmation Modal */}
      <DeleteConfirmationModal
        visible={showLogoutConfirm}
        title="Se déconnecter ?"
        subtitle="Êtes-vous sûr de vouloir vous déconnecter de votre session SiteX ?"
        confirmText="Déconnexion"
        cancelText="Annuler"
        isDeleting={false}
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.52)',
  },
  drawerContainer: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 52 : 40,
    paddingBottom: 24,
    paddingHorizontal: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 20,
    borderRightWidth: 1,
    borderRightColor: '#E2E8F0',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    fontSize: 18,
    color: Palette.text,
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 4,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Palette.primary,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(23, 107, 91, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: Palette.primary,
    fontSize: 15,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 3,
  },
  roleBadgeLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    letterSpacing: 0.4,
  },
  profileName: {
    fontSize: 13,
    color: Palette.text,
  },
  profileEmail: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 12,
  },
  navSection: {
    gap: 4,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 10,
    letterSpacing: 0.8,
    color: Palette.textMuted,
    paddingHorizontal: 8,
    marginBottom: 4,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  navIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    fontSize: 13,
    color: Palette.text,
  },
  footer: {
    paddingTop: 4,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECDD3',
  },
  logoutText: {
    color: '#DC2626',
    fontSize: 13,
  },
  versionText: {
    fontSize: 10,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 10,
  },
});
