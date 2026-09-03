import React from 'react';
import { Text, TextProps } from './text';
import { StyleSheet } from 'react-native';
import { Palette } from '@/constants/theme';

export function Label({ children, style, ...props }: TextProps) {
  return (
    <Text style={[styles.label, style]} weight="semibold" {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    color: Palette.text,
    marginBottom: 6,
  },
});
