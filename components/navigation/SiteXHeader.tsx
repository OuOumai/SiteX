import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image, StyleProp, ViewStyle, Text as RNText } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { NotificationBell } from '@/components/notifications/NotificationBell';

// Official SiteX master logo asset reused across the application
const SiteXIcon = require('@/assets/images/sitex-icon-master.png');

export interface SiteXHeaderProps {
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
  subtitle?: string;
  showNotification?: boolean;
  rightContent?: React.ReactNode;
  onBrandPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * SiteXHeader
 *
 * Canonical SiteX application header component.
 * Provides consistent global branding:
 * - MAIN SCREEN: [SiteX Logo] SiteX          🔔
 * - DETAIL SCREEN: ← SiteX | Contextual Title
 */
export function SiteXHeader({
  showBack = false,
  onBack,
  title,
  subtitle,
  showNotification = false,
  rightContent,
  onBrandPress,
  style,
}: SiteXHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <View style={[styles.headerContainer, style]}>
      {/* Left: Branding & Optional Back Navigation */}
      <View style={styles.leftContainer}>
        {showBack && (
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Retour"
          >
            <Ionicons name="chevron-back" size={24} color={Palette.text} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.brandRow}
          onPress={onBrandPress}
          activeOpacity={onBrandPress ? 0.75 : 1}
          disabled={!onBrandPress}
          accessibilityLabel="SiteX"
        >
          <Image source={SiteXIcon} style={styles.logoImage} resizeMode="contain" />
          <Text style={styles.brandTitle} weight="bold">
            Site<RNText style={styles.brandAccent}>X</RNText>
          </Text>
          {onBrandPress && (
            <Ionicons name="chevron-down" size={16} color="#0F172A" style={{ marginLeft: 2 }} />
          )}
        </TouchableOpacity>

        {title ? (
          <View style={styles.contextualTitleWrapper}>
            <View style={styles.divider} />
            <Text style={styles.contextualTitle} numberOfLines={1} weight="semibold">
              {title}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Right: Notification Bell or custom controls */}
      <View style={styles.rightContainer}>
        {rightContent !== undefined ? (
          rightContent
        ) : showNotification ? (
          <NotificationBell />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    minHeight: 52,
  },
  leftContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  logoImage: {
    width: 30,
    height: 30,
    borderRadius: 7,
  },
  brandTitle: {
    fontSize: 20,
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  brandAccent: {
    color: Palette.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  contextualTitleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    marginLeft: 2,
  },
  divider: {
    width: 1,
    height: 18,
    backgroundColor: '#CBD5E1',
  },
  contextualTitle: {
    fontSize: 14,
    color: '#475569',
    flex: 1,
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
