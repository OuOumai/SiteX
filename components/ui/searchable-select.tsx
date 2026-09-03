import React, { useState, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './text';
import { Input } from './input';
import { Palette } from '@/constants/theme';

export interface SearchableSelectProps {
  label: string;
  value: string;
  onChangeValue: (val: string) => void;
  options: string[];
  placeholder?: string;
  leftIcon?: React.ReactNode;
  customPlaceholder?: string;
  error?: string;
}

export function SearchableSelect({
  label,
  value,
  onChangeValue,
  options,
  placeholder = 'Sélectionnez une option',
  leftIcon,
  customPlaceholder = 'Précisez votre choix...',
  error,
}: SearchableSelectProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Check if current value matches one of the options (excluding 'Autre')
  const isPresetOption = useMemo(() => {
    if (!value) return false;
    return options.filter((o) => o !== 'Autre').includes(value);
  }, [value, options]);

  const isOtherSelected = useMemo(() => {
    if (!value) return false;
    if (value === 'Autre') return true;
    return !isPresetOption;
  }, [value, isPresetOption]);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const q = searchQuery.toLowerCase().trim();
    return options.filter((opt) => opt.toLowerCase().includes(q));
  }, [options, searchQuery]);

  const handleSelectOption = (opt: string) => {
    if (opt === 'Autre') {
      onChangeValue('Autre');
    } else {
      onChangeValue(opt);
    }
    setIsModalOpen(false);
    setSearchQuery('');
  };

  const displayTitle = isOtherSelected
    ? value && value !== 'Autre'
      ? `Autre : ${value}`
      : 'Autre (à préciser ci-dessous)'
    : value || placeholder;

  return (
    <View style={styles.container}>
      {/* Trigger Select Box */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setIsModalOpen(true)}
      >
        <Input
          label={label}
          value={displayTitle}
          placeholder={placeholder}
          editable={false}
          style={{ pointerEvents: 'none' }}
          error={error}
          leftIcon={leftIcon}
          rightIcon={<Ionicons name="chevron-down-outline" size={18} color={Palette.textMuted} />}
        />
      </TouchableOpacity>

      {/* If "Autre" is selected, render additional text input right below */}
      {isOtherSelected && (
        <View style={styles.customInputContainer}>
          <Input
            label={`Précisez : ${label}`}
            value={value === 'Autre' ? '' : value}
            onChangeText={(text) => onChangeValue(text.length > 0 ? text : 'Autre')}
            placeholder={customPlaceholder}
            leftIcon={<Ionicons name="pencil-outline" size={16} color={Palette.primary} />}
          />
        </View>
      )}

      {/* Modal Searchable Selector */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text variant="h2" style={styles.modalTitle}>
                {label}
              </Text>
              <TouchableOpacity onPress={() => setIsModalOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Search Input */}
            <View style={styles.searchWrapper}>
              <Ionicons name="search-outline" size={18} color={Palette.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher..."
                placeholderTextColor={Palette.textLight}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect={false}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={Palette.textMuted} />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Scrollable Options List */}
            <ScrollView style={styles.optionsList} showsVerticalScrollIndicator={false}>
              {filteredOptions.map((opt) => {
                const isSelected =
                  opt === 'Autre'
                    ? isOtherSelected
                    : value === opt;

                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.optionItem, isSelected && styles.optionItemSelected]}
                    onPress={() => handleSelectOption(opt)}
                  >
                    <Text
                      style={[styles.optionText, isSelected && styles.optionTextSelected]}
                      weight={isSelected ? 'bold' : 'medium'}
                    >
                      {opt}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color={Palette.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {filteredOptions.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="search-outline" size={28} color={Palette.textMuted} />
                  <Text style={{ color: Palette.textMuted, marginTop: 6 }}>
                    Aucun résultat pour « {searchQuery} »
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 0,
  },
  customInputContainer: {
    marginTop: -6,
    marginBottom: 4,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: Palette.primary,
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    color: Palette.text,
    fontSize: 18,
  },
  closeBtn: {
    padding: 4,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputBg,
    borderWidth: 1.5,
    borderColor: Palette.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Palette.text,
  },
  optionsList: {
    maxHeight: 320,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  optionItemSelected: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  optionText: {
    fontSize: 15,
    color: Palette.text,
  },
  optionTextSelected: {
    color: Palette.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
});
