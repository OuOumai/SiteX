import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { useWindowDimensions, View, Image, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/hooks/useAuth';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const showLeftSidebar = width >= 768;

  const bottomInset = Math.max(insets.bottom, 0);
  const mobileHeight = 60 + bottomInset;
  const mobilePaddingBottom = bottomInset > 0 ? bottomInset : 8;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#10B981',
        tabBarInactiveTintColor: '#8E9E98',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          backgroundColor: '#071A14',
          borderTopColor: '#0E2820',
          borderTopWidth: showLeftSidebar ? 0 : 1,
          borderRightColor: '#0E2820',
          borderRightWidth: showLeftSidebar ? 1 : 0,
          elevation: 10,
          shadowOpacity: 0.15,
          shadowRadius: 10,
          height: showLeftSidebar ? '100%' : mobileHeight,
          width: showLeftSidebar ? 240 : undefined,
          paddingHorizontal: showLeftSidebar ? 12 : 0,
          paddingBottom: showLeftSidebar ? Math.max(bottomInset, 20) : mobilePaddingBottom,
          paddingTop: showLeftSidebar ? Math.max(insets.top, 24) : 6,
        },
        tabBarLabel: ({ focused, children }) => (
          <View style={{ alignItems: 'center' }}>
            <Text
              style={{
                color: focused ? '#10B981' : '#8E9E98',
                fontSize: showLeftSidebar ? 13 : 11,
                fontWeight: '600',
              }}
            >
              {children}
            </Text>
            {focused && !showLeftSidebar && (
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: '#10B981',
                  marginTop: 2,
                }}
              />
            )}
          </View>
        ),
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
          title: 'Accueil',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Carte',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: 'Projets',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'folder' : 'folder-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size, focused }) => {
            return (
              <View style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    borderWidth: 1.5,
                    borderColor: focused ? '#10B981' : '#64748B',
                    overflow: 'hidden',
                  }}
                >
                  {user?.photo_url ? (
                    <Image
                      source={{ uri: user.photo_url }}
                      style={{ width: '100%', height: '100%' }}
                    />
                  ) : (
                    <Ionicons name="person" size={16} color={color} style={{ alignSelf: 'center', marginTop: 3 }} />
                  )}
                </View>
                {/* Active status indicator green dot matching mockup */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 7,
                    height: 7,
                    borderRadius: 3.5,
                    backgroundColor: '#10B981',
                    borderWidth: 1.5,
                    borderColor: '#071A14',
                  }}
                />
              </View>
            );
          },
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{ href: null }}
      />
    </Tabs>
  );
}
