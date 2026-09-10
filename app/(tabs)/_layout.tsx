import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const showLeftSidebar = width >= 768;

  const bottomInset = Math.max(insets.bottom, 0);
  const mobileHeight = 60 + bottomInset;
  const mobilePaddingBottom = bottomInset > 0 ? bottomInset : 8;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? '#0F1715' : '#FFFFFF',
          borderTopColor: showLeftSidebar
            ? 'transparent'
            : colorScheme === 'dark'
              ? '#1E2E2A'
              : '#DCE4E1',
          borderTopWidth: showLeftSidebar ? 0 : 1,
          borderRightColor: showLeftSidebar
            ? colorScheme === 'dark'
              ? '#1E2E2A'
              : '#DCE4E1'
            : 'transparent',
          borderRightWidth: showLeftSidebar ? 1 : 0,
          elevation: 8,
          shadowOpacity: 0.06,
          shadowRadius: 8,
          height: showLeftSidebar ? '100%' : mobileHeight,
          width: showLeftSidebar ? 240 : undefined,
          paddingHorizontal: showLeftSidebar ? 12 : 0,
          paddingBottom: showLeftSidebar ? Math.max(bottomInset, 20) : mobilePaddingBottom,
          paddingTop: showLeftSidebar ? Math.max(insets.top, 24) : 6,
        },
        tabBarLabelStyle: {
          fontSize: showLeftSidebar ? 14 : 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        tabBarItemStyle: showLeftSidebar
          ? {
            maxHeight: 54,
            marginVertical: 3,
            borderRadius: 12,
          }
          : undefined,
        tabBarPosition: showLeftSidebar ? 'left' : 'bottom',
        tabBarLabelPosition: showLeftSidebar ? 'beside-icon' : 'below-icon',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Carte',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="map-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projets',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="folder-open-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{ href: null }}
      />
    </Tabs>
  );
}
