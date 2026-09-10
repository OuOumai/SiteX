import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { ResponsableChantierItem, ResponsableProjectItem, TerrainObservationItem, TronconItem } from '@/services/api';
import { MapLegendContent } from './MapLegendContent';
import { TronconMonitoringContent } from './TronconMonitoringContent';
import { ChantierMonitoringContent } from './ChantierMonitoringContent';

interface MapMonitoringSheetProps {
  project: ResponsableProjectItem | null;
  chantier: ResponsableChantierItem | null;
  chantiers: ResponsableChantierItem[];
  expanded: boolean;
  onToggle: () => void;
  onSelectChantier: (chantier: ResponsableChantierItem) => void;
  onOpenGis?: (chantier: ResponsableChantierItem) => void;
  selectedTroncon?: TronconItem | null;
  observations?: TerrainObservationItem[];
  isAgent?: boolean;
  onSelectObservation?: (observation: TerrainObservationItem) => void;
  onDeclareObservation?: () => void;
  troncons?: TronconItem[];
  onSelectTroncon?: (troncon: TronconItem) => void;
  onBackToProject?: () => void;
  onBackToChantier?: () => void;
}

function gisLabel(status?: string) {
  if (status === 'PRET_POUR_SUIVI') return 'GIS prêt';
  if (status === 'ALIGNEMENT_IMPORTE') return 'Alignement importé';
  return 'GIS non configuré';
}

function gisColor(status?: string) {
  if (status === 'PRET_POUR_SUIVI') return '#16A34A';
  if (status === 'ALIGNEMENT_IMPORTE') return '#2563EB';
  return '#D97706';
}

export function MapMonitoringSheet({
  project,
  chantier,
  chantiers,
  expanded,
  onToggle,
  onSelectChantier,
  onOpenGis,
  selectedTroncon,
  observations = [],
  isAgent,
  onSelectObservation,
  onDeclareObservation,
  troncons = [],
  onSelectTroncon,
  onBackToProject,
  onBackToChantier,
}: MapMonitoringSheetProps) {
  return (
    <View style={[styles.sheet, expanded ? styles.sheetExpanded : styles.sheetCollapsed]}>
      <TouchableOpacity
        style={styles.summary}
        onPress={onToggle}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Réduire les informations' : 'Afficher les informations du chantier'}
      >
        <View style={styles.handle} />
        <View style={styles.summaryRow}>
          <View style={styles.summaryText}>
            <Text style={styles.projectName} weight="bold" numberOfLines={1}>
              {project?.nom || 'Sélectionnez un projet'}
            </Text>
            <Text style={styles.chantierName} numberOfLines={1}>
              {selectedTroncon?.nom || chantier?.nom || (project ? 'Aucun chantier disponible' : 'Recherchez un projet pour commencer')}
            </Text>
          </View>

          <Ionicons name={expanded ? 'chevron-down' : 'chevron-up'} size={20} color={Palette.textMuted} />
        </View>

        {chantier && (
          <View style={styles.metricsRow}>
            <View style={styles.metricPill}>
              <Ionicons name="git-branch-outline" size={13} color={Palette.primary} />
              <Text style={styles.metricText}>{selectedTroncon ? `${observations.length} observations` : `${chantier.nombre_troncons || 0} tronçons`}</Text>
            </View>
            <View style={styles.metricPill}>
              <Ionicons name="resize-outline" size={13} color={Palette.primary} />
              <Text style={styles.metricText}>{selectedTroncon?.length_km ? `${selectedTroncon.length_km} km` : chantier.length_km ? `${chantier.length_km} km` : '— km'}</Text>
            </View>
            <View style={styles.metricPill}>
              <Ionicons name="speedometer-outline" size={13} color={Palette.primary} />
              <Text style={styles.metricText}>{selectedTroncon?.avancement ?? chantier.avancement ?? 0}%</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>

      {expanded && (
        <ScrollView
          style={styles.expandedContent}
          contentContainerStyle={styles.expandedContentInner}
          showsVerticalScrollIndicator={false}
        >
          {selectedTroncon && onSelectObservation ? (
            <TronconMonitoringContent
              troncon={selectedTroncon}
              chantierName={chantier?.nom}
              observations={observations}
              isAgent={isAgent}
              onSelectObservation={onSelectObservation}
              onDeclareObservation={onDeclareObservation}
              onBackToChantier={onBackToChantier}
            />
          ) : chantier && onSelectTroncon && onBackToProject ? (
            <ChantierMonitoringContent chantier={chantier} troncons={troncons} onSelectTroncon={onSelectTroncon} onBack={onBackToProject} onOpenGis={onOpenGis ? () => onOpenGis(chantier) : undefined} />
          ) : <>
          {project?.description ? (
            <Text style={styles.projectDescription}>{project.description}</Text>
          ) : null}

          <View style={styles.projectBadges}>
            {project?.type_projet ? <Text style={styles.projectBadge}>{project.type_projet}</Text> : null}
            {project?.statut ? <Text style={styles.projectBadge}>{project.statut}</Text> : null}
          </View>

          <View style={styles.divider} />
          <Text style={styles.sectionTitle} weight="bold">CHANTIERS DU PROJET ({chantiers.length})</Text>

          {chantiers.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chantierList}>
              {chantiers.map((item) => {
                const selected = item.id === chantier?.id;
                const color = gisColor(item.gis_status);
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.chantierCard, selected && styles.chantierCardSelected]}
                    onPress={() => onSelectChantier(item)}
                    accessibilityRole="button"
                  >
                    <View style={styles.chantierCardHeader}>
                      <View style={[styles.statusDot, { backgroundColor: color }]} />
                      <Text style={[styles.chantierCardName, selected && styles.chantierCardNameSelected]} weight="semibold" numberOfLines={1}>
                        {item.nom}
                      </Text>
                    </View>
                    <Text style={styles.chantierCardMeta}>{gisLabel(item.gis_status)}</Text>
                    <Text style={styles.chantierCardMeta}>{item.nombre_troncons || 0} tronçons • {item.avancement || 0}%</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Ionicons name="construct-outline" size={20} color={Palette.textMuted} />
              <Text style={styles.emptyText}>Ce projet ne contient encore aucun chantier.</Text>
            </View>
          )}

          {chantier && (
            <View style={styles.detailCard}>
              <View style={styles.detailHeader}>
                <Text style={styles.detailName} weight="bold">{chantier.nom}</Text>
                <View style={[styles.gisBadge, { backgroundColor: `${gisColor(chantier.gis_status)}16` }]}>
                  <Text style={[styles.gisBadgeText, { color: gisColor(chantier.gis_status) }]} weight="semibold">
                    {gisLabel(chantier.gis_status)}
                  </Text>
                </View>
              </View>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Avancement du chantier</Text>
                <Text style={styles.progressValue} weight="bold">{chantier.avancement || 0}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, Math.max(0, chantier.avancement || 0))}%` }]} />
              </View>
              <Text style={styles.detailMeta}>
                Alignement : {chantier.length_km ? `${chantier.length_km} km` : 'non disponible'} • {chantier.nombre_troncons || 0} tronçons
              </Text>

              {onOpenGis && (
                <TouchableOpacity
                  style={styles.detailGisFullBtn}
                  onPress={() => onOpenGis(chantier)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Configurer le GIS de ${chantier.nom}`}
                >
                  <Ionicons name="settings-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.detailGisFullBtnText} weight="bold">Configuration & Tracé GIS</Text>
                  <Ionicons name="chevron-forward" size={16} color="#FFFFFF" style={{ marginLeft: 'auto' }} />
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={styles.divider} />
          <MapLegendContent />
          </>}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 10, right: 10, bottom: 8, zIndex: 20,
    backgroundColor: '#FFFFFF', borderRadius: 22, overflow: 'hidden',
    shadowColor: '#0F172A', shadowOpacity: 0.22, shadowRadius: 18,
    shadowOffset: { width: 0, height: -4 }, elevation: 14,
  },
  sheetCollapsed: { maxHeight: 132 },
  sheetExpanded: { height: '62%', maxHeight: 540 },
  summary: { paddingHorizontal: 16, paddingBottom: 13 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', alignSelf: 'center', marginTop: 8, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryText: { flex: 1, minWidth: 0 },
  projectName: { fontSize: 15, color: Palette.text },
  chantierName: { fontSize: 12, color: Palette.textMuted, marginTop: 2 },
  metricsRow: { flexDirection: 'row', gap: 6, marginTop: 9 },
  metricPill: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 5, backgroundColor: '#F0F7F5', borderRadius: 9 },
  metricText: { fontSize: 10.5, color: Palette.text },
  expandedContent: { flex: 1, borderTopWidth: 1, borderTopColor: Palette.border },
  expandedContentInner: { padding: 16, paddingBottom: 28 },
  projectDescription: { fontSize: 12, lineHeight: 18, color: Palette.textMuted },
  projectBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  projectBadge: { fontSize: 10, color: Palette.primary, backgroundColor: '#EAF4F1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  divider: { height: 1, backgroundColor: Palette.border, marginVertical: 14 },
  sectionTitle: { fontSize: 10, color: Palette.textMuted, letterSpacing: 0.8, marginBottom: 9 },
  chantierList: { gap: 8, paddingRight: 8 },
  chantierCard: { width: 160, padding: 11, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Palette.border },
  chantierCardSelected: { backgroundColor: '#F0F7F5', borderColor: Palette.primary },
  chantierCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  chantierCardName: { flex: 1, color: Palette.text, fontSize: 12 },
  chantierCardNameSelected: { color: Palette.primary },
  chantierCardMeta: { color: Palette.textMuted, fontSize: 9.5, marginTop: 4 },
  emptyState: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12 },
  emptyText: { flex: 1, fontSize: 11, color: Palette.textMuted },
  detailCard: { marginTop: 12, padding: 12, borderRadius: 13, borderWidth: 1, borderColor: Palette.border, backgroundColor: '#FFFFFF' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailName: { flex: 1, fontSize: 13, color: Palette.text },
  gisBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  gisBadgeText: { fontSize: 9 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 11 },
  progressLabel: { fontSize: 10.5, color: Palette.textMuted },
  progressValue: { fontSize: 11, color: Palette.primary },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#E2E8F0', overflow: 'hidden', marginTop: 5 },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: Palette.primary },
  detailMeta: { fontSize: 10, color: Palette.textMuted, marginTop: 8 },
  detailGisFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 11,
    marginTop: 12,
    shadowColor: '#0F172A',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  detailGisFullBtnText: {
    fontSize: 12.5,
    color: '#FFFFFF',
  },
});
