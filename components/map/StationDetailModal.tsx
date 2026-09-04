import React, { useEffect, useState } from 'react';
import { Image, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { getMediaUrl, TerrainObservationItem } from '@/services/api';

interface Props {
  observation: TerrainObservationItem | null;
  visible: boolean;
  onClose: () => void;
  onLocate: () => void;
}

function pkLabel(observation: TerrainObservationItem) {
  const km = Number.isFinite(Number(observation.chainage))
    ? Number(observation.chainage)
    : Number(observation.distance_from_start || 0) / 1000;
  return km.toFixed(3);
}

export function StationDetailModal({ observation, visible, onClose, onLocate }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  useEffect(() => { setPhotoIndex(0); }, [observation?.id]);
  if (!observation) return null;
  const photos = observation.photos || [];
  const date = observation.date_heure ? new Date(observation.date_heure) : null;
  const validDate = date && !Number.isNaN(date.getTime());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.stationIcon}><Ionicons name="location" size={18} color="#FFFFFF" /></View>
            <View style={styles.headerText}>
              <Text style={styles.title} weight="bold">Station PK {pkLabel(observation)}</Text>
              <Text style={styles.date}>{validDate ? date!.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : observation.date_heure}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeIcon}><Ionicons name="close" size={21} color={Palette.text} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={[styles.badge, observation.validation_status === 'exceptional' && styles.badgeExceptional]}>
              <Text style={styles.badgeText} weight="semibold">
                {observation.validation_status === 'exceptional' ? 'Observation validée exceptionnellement' : 'Observation enregistrée'}
              </Text>
            </View>

            {photos.length > 0 && (
              <View style={styles.photoArea}>
                <Image source={{ uri: getMediaUrl(photos[Math.min(photoIndex, photos.length - 1)].url) }} style={styles.photo} resizeMode="cover" />
                {photos.length > 1 && (
                  <View style={styles.photoControls}>
                    <TouchableOpacity onPress={() => setPhotoIndex((i) => (i - 1 + photos.length) % photos.length)} style={styles.photoButton}><Ionicons name="chevron-back" size={20} color="#FFFFFF" /></TouchableOpacity>
                    <Text style={styles.photoCount} weight="semibold">{photoIndex + 1} / {photos.length}</Text>
                    <TouchableOpacity onPress={() => setPhotoIndex((i) => (i + 1) % photos.length)} style={styles.photoButton}><Ionicons name="chevron-forward" size={20} color="#FFFFFF" /></TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            <View style={styles.grid}>
              {observation.phase ? <Detail label="Phase de travaux" value={observation.phase} /> : null}
              {observation.phase_statut ? <Detail label="Statut des travaux" value={observation.phase_statut} /> : null}
              <Detail label="Avancement (PK)" value={`${pkLabel(observation)} km`} />
              <Detail label="Distance à l’axe (D_min)" value={`${Number(observation.distance_offset || 0).toFixed(2)} m`} />
              <Detail label="Avancement total" value={`${Number((observation.authoritative_progress_percentage ?? observation.progress_percentage) || 0)}%`} />
              {photos.length > 0 ? <Detail label="Photos" value={`${photos.length} photo${photos.length > 1 ? 's' : ''}`} /> : null}
              <Detail label="Validation" value={observation.validation_status === 'exceptional' ? 'Exceptionnelle' : 'Normale'} />
            </View>
            {observation.commentaire ? <View style={styles.remark}><Text style={styles.detailLabel}>Remarque</Text><Text style={styles.remarkText}>{observation.commentaire}</Text></View> : null}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.locateButton} onPress={onLocate}><Ionicons name="locate" size={18} color="#FFFFFF" /><Text style={styles.locateText} weight="bold">Voir sur la carte</Text></TouchableOpacity>
            <TouchableOpacity style={styles.dismissButton} onPress={onClose}><Text style={styles.dismissText} weight="semibold">Fermer</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue} weight="semibold">{value}</Text></View>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.45)' },
  card: { maxHeight: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 12, gap: 10 },
  stationIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: Palette.primary, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 }, title: { fontSize: 18, color: Palette.text }, date: { fontSize: 11, color: Palette.textMuted, marginTop: 2 },
  closeIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F1F5F9', alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingBottom: 14 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#DCFCE7', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  badgeExceptional: { backgroundColor: '#FEF3C7' }, badgeText: { color: '#166534', fontSize: 11 },
  photoArea: { height: 210, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E2E8F0', marginBottom: 14 }, photo: { width: '100%', height: '100%' },
  photoControls: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  photoButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(15,23,42,0.72)', alignItems: 'center', justifyContent: 'center' },
  photoCount: { color: '#FFFFFF', fontSize: 11, backgroundColor: 'rgba(15,23,42,0.72)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, detail: { width: '48%', minWidth: 140, padding: 11, borderRadius: 12, backgroundColor: '#F8FAFC' },
  detailLabel: { fontSize: 10, color: Palette.textMuted }, detailValue: { fontSize: 13, color: Palette.text, marginTop: 4 },
  remark: { marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC' }, remarkText: { marginTop: 5, fontSize: 12, lineHeight: 18, color: Palette.text },
  actions: { padding: 16, borderTopWidth: 1, borderTopColor: Palette.border, gap: 8 },
  locateButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: Palette.primary }, locateText: { color: '#FFFFFF', fontSize: 13 },
  dismissButton: { alignItems: 'center', paddingVertical: 11, borderRadius: 12, backgroundColor: '#F1F5F9' }, dismissText: { color: Palette.text, fontSize: 13 },
});
