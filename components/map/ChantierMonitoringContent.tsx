import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { ResponsableChantierItem, TronconItem } from '@/services/api';

interface Props {
  chantier: ResponsableChantierItem;
  troncons: TronconItem[];
  onSelectTroncon: (troncon: TronconItem) => void;
  onBack: () => void;
  onOpenGis?: () => void;
}

export function ChantierMonitoringContent({ chantier, troncons, onSelectTroncon, onBack, onOpenGis }: Props) {
  return (
    <View>
      <TouchableOpacity style={styles.back} onPress={onBack}><Ionicons name="arrow-back" size={16} color={Palette.primary} /><Text style={styles.backText} weight="semibold">Vue du projet</Text></TouchableOpacity>
      <Text style={styles.title} weight="bold">{chantier.nom}</Text>
      <Text style={styles.hierarchy}>Infrastructure → portion du chantier → tronçons</Text>
      <View style={styles.metrics}>
        <Metric value={chantier.length_km ? `${chantier.length_km} km` : '—'} label="Longueur calculée" />
        <Metric value={`${troncons.length || chantier.nombre_troncons || 0}`} label="Tronçons" />
        <Metric value={`${chantier.avancement || 0}%`} label="Avancement" />
      </View>
      <Text style={styles.derived}><Ionicons name="analytics-outline" size={13} color="#0F766E" /> La longueur provient de l’alignement de référence réel.</Text>
      <Text style={styles.section} weight="bold">TRONÇONS DU CHANTIER</Text>
      {troncons.map((troncon) => (
        <TouchableOpacity key={troncon.id} style={styles.row} onPress={() => onSelectTroncon(troncon)}>
          <View style={styles.line} />
          <View style={styles.rowText}>
            <Text style={styles.name} weight="semibold">{troncon.nom}</Text>
            <Text style={styles.meta}>PK {Number(troncon.pk_debut || 0).toFixed(3)} → {Number(troncon.pk_fin || 0).toFixed(3)} • {troncon.avancement || 0}%</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={Palette.textMuted} />
        </TouchableOpacity>
      ))}
      {troncons.length === 0 ? <Text style={styles.empty}>Aucun tronçon configuré.</Text> : null}
      {onOpenGis ? <TouchableOpacity style={styles.gis} onPress={onOpenGis}><Ionicons name="settings-outline" size={17} color="#FFFFFF" /><Text style={styles.gisText} weight="bold">Configuration & Tracé GIS</Text></TouchableOpacity> : null}
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue} weight="bold">{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }, backText: { color: Palette.primary, fontSize: 11 },
  title: { fontSize: 17, color: Palette.text }, hierarchy: { fontSize: 10, color: Palette.textMuted, marginTop: 3 },
  metrics: { flexDirection: 'row', gap: 7, marginTop: 12 }, metric: { flex: 1, minWidth: 0, borderRadius: 10, backgroundColor: '#F0F7F5', padding: 9 },
  metricValue: { color: Palette.primary, fontSize: 12 }, metricLabel: { color: Palette.textMuted, fontSize: 8.5, marginTop: 3 },
  derived: { color: '#0F766E', fontSize: 9.5, marginTop: 9 }, section: { fontSize: 10, letterSpacing: 0.7, color: Palette.textMuted, marginTop: 16, marginBottom: 5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Palette.border },
  line: { width: 22, height: 5, borderRadius: 3, backgroundColor: '#2563EB' }, rowText: { flex: 1 }, name: { fontSize: 12, color: Palette.text }, meta: { fontSize: 9.5, color: Palette.textMuted, marginTop: 3 },
  empty: { fontSize: 11, color: Palette.textMuted, paddingVertical: 12 }, gis: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: Palette.primary, borderRadius: 11, paddingVertical: 11, marginTop: 14 }, gisText: { color: '#FFFFFF', fontSize: 12 },
});
