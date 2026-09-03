/**
 * services/location.ts
 *
 * Unified GPS location service supporting iOS, Android and Web with fallback.
 */

import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface DeviceLocationResult {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude?: number | null;
}

export async function getCurrentDeviceLocation(): Promise<DeviceLocationResult> {
  // 1. Web Platform Support with HTML5 Geolocation API
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.geolocation) {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || null,
            altitude: pos.coords.altitude || null,
          });
        },
        async (webErr) => {
          // Fallback to expo-location if available
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
              throw new Error('Permission GPS refusée. Veuillez autoriser l\'accès à la position dans votre navigateur.');
            }
            const loc = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Highest,
            });
            resolve({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy,
              altitude: loc.coords.altitude,
            });
          } catch (e: any) {
            reject(new Error(webErr.message || 'Impossible de récupérer la position GPS.'));
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  // 2. Native Mobile Platform (iOS / Android)
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Autorisation de géolocalisation GPS refusée. Veuillez activer le GPS dans les paramètres de votre appareil.');
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Highest,
  });

  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    altitude: location.coords.altitude,
  };
}
