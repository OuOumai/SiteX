import React from 'react';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { getMediaUrl, TerrainObservationItem, TronconItem } from '@/services/api';

interface Props {
  troncon: TronconItem;
  chantierName?: string;
  observations: TerrainObservationItem[];
  isAgent?: boolean;
  onSelectObservation: (observation: TerrainObservationItem) => void;
  onDeclareObservation?: () => void;
}

function observationPk(observation: TerrainObservationItem) {
  const km = Number.isFinite(Number(observation.chainage)) ? Number(observation.chainage) : Number(observation.distance_from_start || 0) / 1000;
  return km.toFixed(3);
}

export function TronconMonitoringContent({ troncon, chantierName, observations, isAgent, onSelectObservation, onDeclareObservation }: Props) {
  const totalMeters = Number(troncon.length_meters || (troncon.length_km || 0) * 1000);
  const realizedMeters = Math.min(totalMeters || Number.MAX_SAFE_INTEGER, Math.max(0, ...observations.map((o) => Number(o.authoritative_progress_meters ?? o.distance_from_start) || 0)));
  const observationPercentage = Math.max(0, ...observations.map((o) => Number(o.authoritative_progress_percentage ?? o.progress_percentage) || 0));
  const percentage = observations.length > 0 ? observationPercentage : Number(troncon.avancement || 0);
  const remainingMeters = Math.max(0, totalMeters - realizedMeters);

  return (
    <View>
      <Text style={styles.eyebrow} weight="bold">{chantierName ? `${chantierName} • ` : ''}{troncon.nom}</Text>
      <Text style={styles.pkRange}>PK {Number(troncon.pk_debut || 0).toFixed(3)} → PK {Number(troncon.pk_fin || 0).toFixed(3)}</Text>
      <View style={styles.metrics}>
        <Metric value={`${observations.length}`} label="observations" />
        <Metric value={`${(realizedMeters / 1000).toFixed(3)} km`} label="réalisés" />
        <Metric value={`${(remainingMeters / 1000).toFixed(3)} km`} label="restants" />
        <Metric value={`${percentage}%`} label="total" />
      </View>
      <View style={styles.progress}><View style={[styles.progressFill, { width: `${percentage}%` }]} /></View>
      <Text style={styles.section} weight="bold">OBSERVATIONS</Text>
      {observations.length === 0 ? <Text style={styles.empty}>Aucune observation enregistrée sur ce tronçon.</Text> : observations.map((observation) => {
        const photo = observation.photos?.[0]?.url;
        const date = new Date(observation.date_heure);
        return (
          <TouchableOpacity key={observation.id} style={styles.observation} onPress={() => onSelectObservation(observation)}>
            <View style={styles.dot} />
            <View style={styles.observationText}>
              <Text style={styles.observationPk} weight="semibold">PK {observationPk(observation)}</Text>
              <Text style={styles.observationMeta}>{Number.isNaN(date.getTime()) ? observation.date_heure : date.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
              {observation.phase ? <Text style={styles.observationMeta}>{observation.phase}</Text> : null}
            </View>
            {photo ? <Image source={{ uri: getMediaUrl(photo) }} style={styles.thumbnail} /> : <Ionicons name="chevron-forward" size={16} color={Palette.textMuted} />}
          </TouchableOpacity>
        );
      })}
      {isAgent && onDeclareObservation ? <TouchableOpacity style={styles.declare} onPress={onDeclareObservation}><Ionicons name="add-circle-outline" size={18} color="#FFFFFF" /><Text style={styles.declareText} weight="bold">Déclarer une observation</Text></TouchableOpacity> : null}
    </View>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue} weight="bold">{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 14, color: Palette.text }, pkRange: { fontSize: 11, color: Palette.textMuted, marginTop: 3 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 }, metric: { flexGrow: 1, minWidth: '46%', backgroundColor: '#F0F7F5', borderRadius: 10, padding: 9 },
  metricValue: { color: Palette.primary, fontSize: 13 }, metricLabel: { color: Palette.textMuted, fontSize: 9, marginTop: 2 },
  progress: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: '#E2E8F0', marginTop: 10 }, progressFill: { height: '100%', backgroundColor: '#16A34A' },
  section: { fontSize: 10, color: Palette.textMuted, letterSpacing: 0.8, marginTop: 16, marginBottom: 8 }, empty: { color: Palette.textMuted, fontSize: 11, paddingVertical: 10 },
  observation: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }, dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#10B981' }, observationText: { flex: 1 }, observationPk: { fontSize: 12, color: Palette.text }, observationMeta: { fontSize: 9.5, color: Palette.textMuted, marginTop: 2 }, thumbnail: { width: 44, height: 38, borderRadius: 8, backgroundColor: '#E2E8F0' },
  declare: { marginTop: 14, paddingVertical: 11, borderRadius: 11, backgroundColor: Palette.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, declareText: { color: '#FFFFFF', fontSize: 12 },
});
