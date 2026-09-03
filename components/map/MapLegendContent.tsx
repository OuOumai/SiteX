import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';

const STATUS_ITEMS = [
  { color: '#16A34A', label: 'Terminé' },
  { color: '#2563EB', label: 'En cours' },
  { color: '#DC2626', label: 'Problème / retard' },
  { color: '#64748B', label: 'Non commencé' },
];

const MARKER_ITEMS: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string }[] = [
  { icon: 'radio-button-on', color: '#16A34A', label: "Début de l'alignement" },
  { icon: 'radio-button-on', color: '#DC2626', label: "Fin de l'alignement" },
  { icon: 'arrow-forward-circle', color: '#0284C7', label: 'Sens du chaînage croissant' },
  { icon: 'location', color: '#0284C7', label: 'Repères PK' },
];

export function MapLegendContent() {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle} weight="bold">TRONÇONS</Text>
      <View style={styles.grid}>
        {STATUS_ITEMS.map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.statusLine, { backgroundColor: item.color }]} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle} weight="bold">REPÈRES CARTOGRAPHIQUES</Text>
      <View style={styles.grid}>
        {MARKER_ITEMS.map((item) => (
          <View key={item.label} style={styles.legendItem}>
            <Ionicons name={item.icon} size={16} color={item.color} />
            <Text style={styles.legendText}>{item.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.crsCard}>
        <View style={styles.crsHeader}>
          <Ionicons name="layers-outline" size={16} color={Palette.primary} />
          <Text style={styles.crsTitle} weight="bold">Informations cartographiques</Text>
        </View>
        <Text style={styles.crsText}>Données : EPSG:4326 — WGS 84</Text>
        <Text style={styles.crsText}>Affichage : EPSG:3857 — Web Mercator</Text>
        <Text style={styles.crsText}>Unité de chaînage : kilomètres (km)</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  sectionTitle: { fontSize: 10, color: Palette.textMuted, letterSpacing: 0.8, marginTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  legendItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 6 },
  statusLine: { width: 20, height: 5, borderRadius: 3 },
  legendText: { flex: 1, fontSize: 11, color: Palette.text },
  crsCard: { backgroundColor: '#F0F7F5', borderRadius: 12, padding: 11, gap: 3, borderWidth: 1, borderColor: '#D4E7E2' },
  crsHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 3 },
  crsTitle: { fontSize: 11, color: Palette.primary },
  crsText: { fontSize: 10.5, color: Palette.textMuted, lineHeight: 15 },
});
