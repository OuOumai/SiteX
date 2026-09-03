import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './text';
import { Palette } from '@/constants/theme';

export interface ButtonProps extends TouchableOpacityProps {
  variant?: 'primary' | 'secondary' | 'accent' | 'outline' | 'ghost' | 'google' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  title: string;
  icon?: React.ReactNode;
  textStyle?: any;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  title,
  icon,
  style,
  textStyle,
  disabled,
  ...props
}: ButtonProps) {
  const isOutline = variant === 'outline' || variant === 'google';
  const isGhost = variant === 'ghost';

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled || loading}
      style={[
        styles.base,
        styles[variant],
        styles[`size_${size}`],
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator
          color={isOutline || isGhost ? Palette.primary : '#FFFFFF'}
          size="small"
        />
      ) : (
        <View style={styles.contentRow}>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text
            style={[
              textStyles.textBase,
              textStyles[`text_${variant}`],
              textStyles[`textSize_${size}`],
              textStyle,
            ]}
            weight="semibold"
          >
            {title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}


const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginRight: 8,
  },
  // Sizes
  size_sm: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    minHeight: 38,
  },
  size_md: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 48,
  },
  size_lg: {
    paddingVertical: 15,
    paddingHorizontal: 24,
    minHeight: 54,
  },
  // Variants
  primary: {
    backgroundColor: Palette.primary,
    elevation: 2,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  secondary: {
    backgroundColor: Palette.secondary,
  },
  accent: {
    backgroundColor: Palette.accent,
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Palette.inputBorder,
  },
  google: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Palette.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  destructive: {
    backgroundColor: '#DC2626',
    elevation: 2,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 5,
  },
  disabled: {
    opacity: 0.55,
  },
});

const textStyles = StyleSheet.create({
  textBase: {
    textAlign: 'center',
  },
  text_primary: {
    color: '#FFFFFF',
  },
  text_secondary: {
    color: '#FFFFFF',
  },
  text_accent: {
    color: '#17221F',
  },
  text_outline: {
    color: Palette.primary,
  },
  text_google: {
    color: Palette.text,
  },
  text_ghost: {
    color: Palette.primary,
  },
  text_destructive: {
    color: '#FFFFFF',
  },
  textSize_sm: {
    fontSize: 14,
  },
  textSize_md: {
    fontSize: 16,
  },
  textSize_lg: {
    fontSize: 17,
  },
});
