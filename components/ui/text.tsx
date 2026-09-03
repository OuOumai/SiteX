import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';

export interface TextProps extends RNTextProps {
  variant?: 'default' | 'h1' | 'h2' | 'h3' | 'subtitle' | 'muted' | 'error';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  align?: 'auto' | 'left' | 'center' | 'right' | 'justify';
}

export function Text({
  style,
  variant = 'default',
  weight = 'normal',
  align = 'left',
  children,
  ...props
}: TextProps) {
  return (
    <RNText
      style={[
        styles.base,
        styles[variant],
        styles[`weight_${weight}` as keyof typeof styles],
        { textAlign: align },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  base: {
    color: Palette.text,
    fontSize: 15,
    lineHeight: 22,
  },
  default: {
    fontSize: 15,
    color: Palette.text,
  },
  h1: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: Palette.text,
  },
  h2: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '600',
    color: Palette.text,
  },
  h3: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: Palette.text,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: Palette.textMuted,
  },
  muted: {
    fontSize: 13,
    lineHeight: 18,
    color: Palette.textMuted,
  },
  error: {
    fontSize: 13,
    lineHeight: 18,
    color: Palette.alert,
    marginTop: 4,
  },
  weight_normal: { fontWeight: '400' },
  weight_medium: { fontWeight: '500' },
  weight_semibold: { fontWeight: '600' },
  weight_bold: { fontWeight: '700' },
});
