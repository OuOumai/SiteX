import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

const SiteXIcon = require('@/assets/images/sitex-icon-master.png');

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/context/AuthContext';
import { useAuth } from '@/hooks/useAuth';
import { Palette } from '@/constants/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootNavigationGuard() {
  const { token, user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !(segments as string[])?.length) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inAdminGroup = segments[0] === 'admin';
    const inResponsableGroup = segments[0] === 'responsable';
    const isAdmin = user?.role_nom === 'Administrateur' || user?.role_id === 1;
    const isResponsable = user?.role_nom === 'Responsable' || user?.role_id === 2;

    if (__DEV__) {
      console.log(`[RootNav] Ready | user: ${user?.email || 'anon'} | role: ${user?.role_nom || 'none'} | seg: ${segments.join('/')}`);
    }

    if (!token && !inAuthGroup) {
      // Redirect unauthenticated user to login screen
      router.replace('/(auth)/login');
    } else if (token) {
      if (isAdmin) {
        // Admin user: navigate to admin interface if on auth or standard tabs
        if (inAuthGroup || segments[0] === '(tabs)') {
          router.replace('/admin');
        }
      } else {
        // Non-admin user (Responsable, AgentTerrain, Client): navigate to tabs
        if (inAdminGroup) {
          router.replace('/(tabs)');
        } else if (inAuthGroup) {
          router.replace('/(tabs)');
        }
      }
    }
  }, [token, user, isLoading, segments]);


  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Image source={SiteXIcon} style={styles.logoImage} resizeMode="contain" />
        <ActivityIndicator size="large" color={Palette.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, title: 'SiteX' }}>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/index" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/projet/create" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/projet/[projectId]/configure" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/projet/[projectId]/index" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/projet/[projectId]/chantier/create" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/chantier/[chantierId]/index" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/chantier/[chantierId]/gis" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/troncon/[tronconId]/index" options={{ headerShown: false }} />
      <Stack.Screen name="responsable/equipe-terrain/index" options={{ headerShown: false }} />
      <Stack.Screen name="project/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="project/report-viewer" options={{ headerShown: false }} />
      <Stack.Screen name="chantier/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="chantier/avancement/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="chantier/images/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="chantier/map/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}


import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <RootNavigationGuard />
          <StatusBar style="auto" />
        </ThemeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Palette.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 120,
    height: 120,
    borderRadius: 24,
  },
});
