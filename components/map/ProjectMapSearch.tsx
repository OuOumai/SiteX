import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';
import { ResponsableProjectItem } from '@/services/api';

interface ProjectMapSearchProps {
  projects: ResponsableProjectItem[];
  selectedProjectId: number | null;
  onSelectProject: (project: ResponsableProjectItem) => void;
  compact?: boolean;
}

export function ProjectMapSearch({
  projects,
  selectedProjectId,
  onSelectProject,
  compact = false,
}: ProjectMapSearchProps) {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('fr');
    if (!normalized) return projects.slice(0, 8);
    return projects
      .filter((project) => project.nom.toLocaleLowerCase('fr').includes(normalized))
      .slice(0, 8);
  }, [projects, query]);

  const showResults = isFocused || query.length > 0;

  const selectProject = (project: ResponsableProjectItem) => {
    setQuery('');
    setIsFocused(false);
    onSelectProject(project);
  };

  return (
    <View style={styles.wrapper}>
      <View style={[styles.searchBar, compact && styles.searchBarCompact]}>
        <Ionicons name="search" size={20} color={Palette.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setIsFocused(true)}
          placeholder="Rechercher un projet..."
          placeholderTextColor={Palette.textMuted}
          style={styles.input}
          returnKeyType="search"
          accessibilityLabel="Rechercher un projet par nom"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Effacer la recherche"
          >
            <Ionicons name="close-circle" size={19} color={Palette.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {showResults && (
        <View style={styles.results}>
          {filteredProjects.length > 0 ? (
            filteredProjects.map((project) => {
              const isSelected = project.id === selectedProjectId;
              return (
                <TouchableOpacity
                  key={project.id}
                  style={[styles.resultRow, isSelected && styles.resultRowSelected]}
                  onPress={() => selectProject(project)}
                  accessibilityRole="button"
                >
                  <View style={[styles.projectIcon, isSelected && styles.projectIconSelected]}>
                    <Ionicons
                      name="business-outline"
                      size={16}
                      color={isSelected ? '#FFFFFF' : Palette.primary}
                    />
                  </View>
                  <View style={styles.resultText}>
                    <Text style={styles.projectName} weight="semibold" numberOfLines={1}>
                      {project.nom}
                    </Text>
                    <Text style={styles.projectMeta} numberOfLines={1}>
                      {project.nombre_chantiers} chantier{project.nombre_chantiers === 1 ? '' : 's'}
                      {project.statut ? ` • ${project.statut}` : ''}
                    </Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={Palette.primary} />}
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.emptyResult}>
              <Text style={styles.emptyText}>Aucun projet trouvé</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%', zIndex: 30 },
  searchBar: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    shadowColor: '#0F172A',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  searchBarCompact: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, elevation: 0, shadowOpacity: 0 },
  input: { flex: 1, minWidth: 0, color: Palette.text, fontSize: 15, paddingVertical: 10 },
  results: {
    marginTop: 8,
    maxHeight: 360,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 9,
    overflow: 'hidden',
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  resultRowSelected: { backgroundColor: '#F0F7F5' },
  projectIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF4F1' },
  projectIconSelected: { backgroundColor: Palette.primary },
  resultText: { flex: 1, minWidth: 0 },
  projectName: { fontSize: 13, color: Palette.text },
  projectMeta: { fontSize: 11, color: Palette.textMuted, marginTop: 2 },
  emptyResult: { padding: 18, alignItems: 'center' },
  emptyText: { color: Palette.textMuted, fontSize: 12 },
});
