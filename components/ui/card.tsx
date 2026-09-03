import React from 'react';
import { View, StyleSheet, ViewProps } from 'react-native';
import { Palette } from '@/constants/theme';

export interface CardProps extends ViewProps {
  variant?: 'default' | 'flat' | 'elevated';
}

export function Card({ style, variant = 'default', children, ...props }: CardProps) {
  return (
    <View style={[styles.card, styles[variant], style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Palette.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  default: {
    elevation: 2,
    shadowColor: Palette.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  flat: {
    elevation: 0,
    shadowOpacity: 0,
  },
  elevated: {
    elevation: 4,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
});
