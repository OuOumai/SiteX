import React, { useState, useEffect, useMemo } from 'react';
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
import { Palette } from '@/constants/theme';

export interface Country {
  code: string; // ISO 2-letter
  name: string; // Display name in French
  dialCode: string; // +212, +33, etc.
  flag: string; // Emoji flag
}

export const COUNTRIES: Country[] = [
  { code: 'MA', name: 'Maroc', dialCode: '+212', flag: '🇲🇦' },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷' },
  { code: 'ES', name: 'Espagne', dialCode: '+34', flag: '🇪🇸' },
  { code: 'DZ', name: 'Algérie', dialCode: '+213', flag: '🇩🇿' },
  { code: 'TN', name: 'Tunisie', dialCode: '+216', flag: '🇹🇳' },
  { code: 'SN', name: 'Sénégal', dialCode: '+221', flag: '🇸🇳' },
  { code: 'CI', name: 'Côte d’Ivoire', dialCode: '+225', flag: '🇨🇮' },
  { code: 'MR', name: 'Mauritanie', dialCode: '+222', flag: '🇲🇷' },
  { code: 'US', name: 'États-Unis', dialCode: '+1', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦' },
  { code: 'GB', name: 'Royaume-Uni', dialCode: '+44', flag: '🇬🇧' },
  { code: 'DE', name: 'Allemagne', dialCode: '+49', flag: '🇩🇪' },
  { code: 'BE', name: 'Belgique', dialCode: '+32', flag: '🇧🇪' },
  { code: 'CH', name: 'Suisse', dialCode: '+41', flag: '🇨🇭' },
  { code: 'IT', name: 'Italie', dialCode: '+39', flag: '🇮🇹' },
  { code: 'AE', name: 'Émirats arabes unis', dialCode: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Arabie saoudite', dialCode: '+966', flag: '🇸🇦' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦' },
  { code: 'EG', name: 'Égypte', dialCode: '+20', flag: '🇪🇬' },
  { code: 'TR', name: 'Turquie', dialCode: '+90', flag: '🇹🇷' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬' },
  { code: 'CM', name: 'Cameroun', dialCode: '+237', flag: '🇨🇲' },
  { code: 'MG', name: 'Madagascar', dialCode: '+261', flag: '🇲🇬' },
  { code: 'GA', name: 'Gabon', dialCode: '+241', flag: '🇬🇦' },
  { code: 'CG', name: 'Congo', dialCode: '+242', flag: '🇨🇬' },
  { code: 'CD', name: 'RDC', dialCode: '+243', flag: '🇨🇩' },
  { code: 'BR', name: 'Brésil', dialCode: '+55', flag: '🇧🇷' },
  { code: 'CN', name: 'Chine', dialCode: '+86', flag: '🇨🇳' },
  { code: 'JP', name: 'Japon', dialCode: '+81', flag: '🇯🇵' },
  { code: 'IN', name: 'Inde', dialCode: '+91', flag: '🇮🇳' },
];

export interface PhoneInputProps {
  label?: string;
  value?: string; // Stored full phone number e.g. "+212 600000000"
  onChangePhone: (fullNumber: string) => void;
  error?: string;
}

export function PhoneInput({
  label = 'Téléphone',
  value = '',
  onChangePhone,
  error,
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0]); // Default Morocco
  const [localNumber, setLocalNumber] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isFocused, setIsFocused] = useState<boolean>(false);

  // Parse initial value to extract matching country dial code & local number
  useEffect(() => {
    if (value && value.trim().length > 0) {
      const cleanVal = value.trim();
      // Try finding a matching dial code in COUNTRIES
      const matched = COUNTRIES.find((c) => cleanVal.startsWith(c.dialCode));
      if (matched) {
        setSelectedCountry(matched);
        const rest = cleanVal.slice(matched.dialCode.length).trim();
        setLocalNumber(rest);
      } else {
        setLocalNumber(cleanVal);
      }
    } else {
      setLocalNumber('');
    }
  }, [value]);

  const handleSelectCountry = (country: Country) => {
    setSelectedCountry(country);
    setIsModalOpen(false);
    setSearchQuery('');
    
    // Combine new country code with existing local number
    const full = localNumber.trim().length > 0 ? `${country.dialCode} ${localNumber.trim()}` : `${country.dialCode} `;
    onChangePhone(full);
  };

  const handleLocalNumberChange = (text: string) => {
    // Only allow digits and spaces
    const cleanDigits = text.replace(/[^\d\s]/g, '');
    setLocalNumber(cleanDigits);

    const full = cleanDigits.trim().length > 0
      ? `${selectedCountry.dialCode} ${cleanDigits.trim()}`
      : `${selectedCountry.dialCode} `;
    onChangePhone(full);
  };

  // Filter countries by search query
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return COUNTRIES;
    const q = searchQuery.toLowerCase().trim();
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dialCode.includes(q) ||
        c.code.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <View style={styles.container}>
      {label && (
        <Text style={styles.label} weight="medium">
          {label}
        </Text>
      )}

      {/* Input Box: Country Selector + Divider + Local Number Input */}
      <View
        style={[
          styles.inputWrapper,
          isFocused && styles.focusedWrapper,
          !!error && styles.errorWrapper,
        ]}
      >
        {/* Country Selector Button */}
        <TouchableOpacity
          style={styles.countryBtn}
          activeOpacity={0.7}
          onPress={() => setIsModalOpen(true)}
        >
          <Text style={styles.flagText}>{selectedCountry.flag}</Text>
          <Text style={styles.dialCodeText} weight="semibold">
            {selectedCountry.dialCode}
          </Text>
          <Ionicons name="chevron-down-outline" size={14} color={Palette.textMuted} />
        </TouchableOpacity>

        {/* Vertical Divider */}
        <View style={styles.divider} />

        {/* Phone Number Input */}
        <TextInput
          style={styles.textInput}
          value={localNumber}
          onChangeText={handleLocalNumberChange}
          placeholder="6 00 00 00 00"
          placeholderTextColor={Palette.textLight}
          keyboardType="phone-pad"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
      </View>

      {error ? <Text variant="error">{error}</Text> : null}

      {/* Country Selection Modal */}
      <Modal visible={isModalOpen} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text variant="h2" style={styles.modalTitle}>
                Sélectionner un pays
              </Text>
              <TouchableOpacity onPress={() => setIsModalOpen(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchWrapper}>
              <Ionicons name="search-outline" size={18} color={Palette.textMuted} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher par pays ou indicatif (+212, France...)"
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

            {/* Country List */}
            <ScrollView style={styles.countryList} showsVerticalScrollIndicator={false}>
              {filteredCountries.map((item) => {
                const isSelected = item.code === selectedCountry.code;
                return (
                  <TouchableOpacity
                    key={item.code}
                    style={[styles.countryItem, isSelected && styles.countryItemSelected]}
                    onPress={() => handleSelectCountry(item)}
                  >
                    <Text style={styles.itemFlag}>{item.flag}</Text>
                    <Text style={styles.itemName} weight={isSelected ? 'bold' : 'medium'}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemDialCode} weight="semibold">
                      {item.dialCode}
                    </Text>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={18} color={Palette.primary} style={{ marginLeft: 8 }} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {filteredCountries.length === 0 && (
                <View style={styles.emptyState}>
                  <Ionicons name="earth-outline" size={32} color={Palette.textMuted} />
                  <Text style={{ color: Palette.textMuted, marginTop: 8 }}>
                    Aucun pays trouvé pour « {searchQuery} »
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
    marginBottom: 16,
  },
  label: {
    marginBottom: 6,
    fontSize: 14,
    color: Palette.text,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Palette.inputBg,
    borderWidth: 1.5,
    borderColor: Palette.inputBorder,
    borderRadius: 14,
    height: 50,
    paddingHorizontal: 12,
  },
  focusedWrapper: {
    borderColor: Palette.primary,
    backgroundColor: '#FFFFFF',
  },
  errorWrapper: {
    borderColor: Palette.alert,
  },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingRight: 8,
  },
  flagText: {
    fontSize: 20,
  },
  dialCodeText: {
    fontSize: 14,
    color: Palette.text,
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: Palette.border,
    marginHorizontal: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: Palette.text,
    paddingVertical: 8,
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
  countryList: {
    maxHeight: 320,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderBottomWidth: 1,
    borderBottomColor: Palette.border,
  },
  countryItemSelected: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
  },
  itemFlag: {
    fontSize: 22,
    marginRight: 12,
  },
  itemName: {
    flex: 1,
    fontSize: 15,
    color: Palette.text,
  },
  itemDialCode: {
    fontSize: 14,
    color: Palette.primary,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
  },
});
