import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { ResponsableChantierItem, ResponsableProjectItem, TerrainObservationItem, TronconItem } from '@/services/api';
import { MapLegendContent } from './MapLegendContent';
import { ProjectMapSearch } from './ProjectMapSearch';
import { TronconMonitoringContent } from './TronconMonitoringContent';
import { ChantierMonitoringContent } from './ChantierMonitoringContent';

interface MapDesktopPanelProps {
  projects: ResponsableProjectItem[];
  project: ResponsableProjectItem | null;
  chantier: ResponsableChantierItem | null;
  chantiers: ResponsableChantierItem[];
  onSelectProject: (project: ResponsableProjectItem) => void;
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

export function MapDesktopPanel({
  projects,
  project,
  chantier,
  chantiers,
  onSelectProject,
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
}: MapDesktopPanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.brandRow}>
        <View style={styles.brandIcon}><Ionicons name="map" size={19} color="#FFFFFF" /></View>
        <View>
          <Text style={styles.brandTitle} weight="bold">Carte SiteX</Text>
          <Text style={styles.brandSubtitle}>Suivi cartographique</Text>
        </View>
      </View>

      <ProjectMapSearch
        projects={projects}
        selectedProjectId={project?.id || null}
        onSelectProject={onSelectProject}
        compact
      />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
        ) : project ? (
          <>
            <View style={styles.projectHeader}>
              <Text style={styles.projectName} weight="bold">{project.nom}</Text>
              {project.statut ? <Text style={styles.projectStatus}>{project.statut}</Text> : null}
            </View>
            {project.description ? <Text style={styles.description}>{project.description}</Text> : null}

            <View style={styles.separator} />
            <Text style={styles.sectionTitle} weight="bold">CHANTIERS ({chantiers.length})</Text>
            <View style={styles.chantierList}>
              {chantiers.map((item) => {
                const selected = item.id === chantier?.id;
                const ready = item.gis_status === 'PRET_POUR_SUIVI';
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.chantierRow, selected && styles.chantierRowSelected]}
                    onPress={() => onSelectChantier(item)}
                  >
                    <View style={[styles.gisDot, { backgroundColor: ready ? '#16A34A' : '#D97706' }]} />
                    <View style={styles.chantierText}>
                      <Text style={[styles.chantierName, selected && styles.chantierNameSelected]} weight="semibold" numberOfLines={1}>{item.nom}</Text>
                      <Text style={styles.chantierMeta}>{item.nombre_troncons || 0} tronçons • {item.avancement || 0}%</Text>
                    </View>
                    {selected && <Ionicons name="checkmark-circle" size={18} color={Palette.primary} />}
                  </TouchableOpacity>
                );
              })}
              {chantiers.length === 0 && <Text style={styles.emptyText}>Aucun chantier dans ce projet.</Text>}
            </View>

            {chantier && (
              <View style={styles.metricsCard}>
                <Text style={styles.selectedLabel}>CHANTIER SÉLECTIONNÉ</Text>
                <Text style={styles.selectedName} weight="bold">{chantier.nom}</Text>

                <View style={styles.metricsGrid}>
                  <View style={styles.metric}><Text style={styles.metricValue} weight="bold">{chantier.nombre_troncons || 0}</Text><Text style={styles.metricLabel}>Tronçons</Text></View>
                  <View style={styles.metric}><Text style={styles.metricValue} weight="bold">{chantier.length_km || '—'}</Text><Text style={styles.metricLabel}>Kilomètres</Text></View>
                  <View style={styles.metric}><Text style={styles.metricValue} weight="bold">{chantier.avancement || 0}%</Text><Text style={styles.metricLabel}>Avancement</Text></View>
                </View>

                {onOpenGis && (
                  <TouchableOpacity
                    style={styles.desktopGisFullBtn}
                    onPress={() => onOpenGis(chantier)}
                    accessibilityRole="button"
                    accessibilityLabel={`Configurer le GIS de ${chantier.nom}`}
                  >
                    <Ionicons name="settings-outline" size={15} color="#FFFFFF" />
                    <Text style={styles.desktopGisFullBtnText} weight="bold">Configurer le tracé GIS</Text>
                    <Ionicons name="chevron-forward" size={15} color="#FFFFFF" style={{ marginLeft: 'auto' }} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.separator} />
            <MapLegendContent />
          </>
        ) : (
          <View style={styles.emptyProject}>
            <Ionicons name="search-outline" size={28} color={Palette.textMuted} />
            <Text style={styles.emptyText}>Recherchez et sélectionnez un projet.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { width: 340, backgroundColor: '#FFFFFF', borderRightWidth: 1, borderRightColor: Palette.border, padding: 16, zIndex: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  brandIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: Palette.primary, alignItems: 'center', justifyContent: 'center' },
  brandTitle: { color: Palette.text, fontSize: 16 },
  brandSubtitle: { color: Palette.textMuted, fontSize: 10.5, marginTop: 1 },
  scroll: { flex: 1, marginTop: 12 },
  content: { paddingBottom: 24 },
  projectHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { flex: 1, fontSize: 16, color: Palette.text },
  projectStatus: { fontSize: 9.5, color: Palette.primary, backgroundColor: '#EAF4F1', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 },
  description: { fontSize: 11, lineHeight: 17, color: Palette.textMuted, marginTop: 6 },
  separator: { height: 1, backgroundColor: Palette.border, marginVertical: 15 },
  sectionTitle: { fontSize: 10, color: Palette.textMuted, letterSpacing: 0.8, marginBottom: 8 },
  chantierList: { gap: 7 },
  chantierRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderColor: Palette.border, borderRadius: 11, padding: 10 },
  chantierRowSelected: { borderColor: Palette.primary, backgroundColor: '#F0F7F5' },
  gisDot: { width: 7, height: 7, borderRadius: 4 },
  chantierText: { flex: 1, minWidth: 0 },
  chantierName: { fontSize: 11.5, color: Palette.text },
  chantierNameSelected: { color: Palette.primary },
  chantierMeta: { fontSize: 9.5, color: Palette.textMuted, marginTop: 2 },
  metricsCard: { marginTop: 12, padding: 12, borderRadius: 13, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: Palette.border },
  selectedLabel: { fontSize: 9, color: Palette.textMuted, letterSpacing: 0.7 },
  selectedName: { fontSize: 13, color: Palette.text, marginTop: 3 },
  metricsGrid: { flexDirection: 'row', marginTop: 10 },
  metric: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 15, color: Palette.primary },
  metricLabel: { fontSize: 9.5, color: Palette.textMuted, marginTop: 2 },
  desktopGisFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  desktopGisFullBtnText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  emptyProject: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { fontSize: 12, color: Palette.textMuted, textAlign: 'center' },
});
