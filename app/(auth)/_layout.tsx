import React from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { Stack } from 'expo-router';
import { Palette } from '@/constants/theme';

export default function AuthLayout() {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={Palette.background} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Palette.background },
          animation: 'slide_from_right',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
});
