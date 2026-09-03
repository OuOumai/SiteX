import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Input } from './input';
import { Text } from './text';
import { Palette } from '@/constants/theme';

export interface GeoapifySuggestion {
  id: string;
  formatted: string;
  addressLine1: string;
  city: string;
  region: string;
  postcode: string;
  country: string;
  lat: number | null;
  lon: number | null;
}

export interface AddressAutocompleteInputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelectAddress: (details: {
    adresse: string;
    ville: string;
    region?: string;
    code_postal?: string;
    pays?: string;
    latitude?: number | null;
    longitude?: number | null;
  }) => void;
  typeFilter?: 'all' | 'city';
  placeholder?: string;
  error?: string;
}

const MOROCCO_POPULAR_LOCATIONS: GeoapifySuggestion[] = [
  { id: 'loc_tanger', formatted: 'Tanger, Tanger-Tétouan-Al Hoceïma, Maroc', addressLine1: 'Tanger', city: 'Tanger', region: 'Tanger-Tétouan-Al Hoceïma', postcode: '90000', country: 'Maroc', lat: 35.7595, lon: -5.8340 },
  { id: 'loc_tanger_med', formatted: 'Tanger Med Port, Tanger, Maroc', addressLine1: 'Tanger Med', city: 'Tanger', region: 'Tanger-Tétouan-Al Hoceïma', postcode: '94000', country: 'Maroc', lat: 35.8900, lon: -5.5000 },
  { id: 'loc_tetouan', formatted: 'Tétouan, Tanger-Tétouan-Al Hoceïma, Maroc', addressLine1: 'Tétouan', city: 'Tétouan', region: 'Tanger-Tétouan-Al Hoceïma', postcode: '93000', country: 'Maroc', lat: 35.5889, lon: -5.3626 },
  { id: 'loc_kenitra', formatted: 'Kénitra, Rabat-Salé-Kénitra, Maroc', addressLine1: 'Kénitra', city: 'Kénitra', region: 'Rabat-Salé-Kénitra', postcode: '14000', country: 'Maroc', lat: 34.2610, lon: -6.5802 },
  { id: 'loc_rabat', formatted: 'Rabat, Rabat-Salé-Kénitra, Maroc', addressLine1: 'Rabat', city: 'Rabat', region: 'Rabat-Salé-Kénitra', postcode: '10000', country: 'Maroc', lat: 34.0209, lon: -6.8416 },
  { id: 'loc_sale', formatted: 'Salé, Rabat-Salé-Kénitra, Maroc', addressLine1: 'Salé', city: 'Salé', region: 'Rabat-Salé-Kénitra', postcode: '11000', country: 'Maroc', lat: 34.0531, lon: -6.7985 },
  { id: 'loc_casablanca', formatted: 'Casablanca, Casablanca-Settat, Maroc', addressLine1: 'Casablanca', city: 'Casablanca', region: 'Casablanca-Settat', postcode: '20000', country: 'Maroc', lat: 33.5731, lon: -7.5898 },
  { id: 'loc_marrakech', formatted: 'Marrakech, Marrakech-Safi, Maroc', addressLine1: 'Marrakech', city: 'Marrakech', region: 'Marrakech-Safi', postcode: '40000', country: 'Maroc', lat: 31.6295, lon: -7.9811 },
  { id: 'loc_fes', formatted: 'Fès, Fès-Meknès, Maroc', addressLine1: 'Fès', city: 'Fès', region: 'Fès-Meknès', postcode: '30000', country: 'Maroc', lat: 34.0181, lon: -5.0078 },
  { id: 'loc_meknes', formatted: 'Meknès, Fès-Meknès, Maroc', addressLine1: 'Meknès', city: 'Meknès', region: 'Fès-Meknès', postcode: '50000', country: 'Maroc', lat: 33.8938, lon: -5.5547 },
  { id: 'loc_agadir', formatted: 'Agadir, Souss-Massa, Maroc', addressLine1: 'Agadir', city: 'Agadir', region: 'Souss-Massa', postcode: '80000', country: 'Maroc', lat: 30.4278, lon: -9.5981 },
  { id: 'loc_oujda', formatted: 'Oujda, L\'Oriental, Maroc', addressLine1: 'Oujda', city: 'Oujda', region: 'L\'Oriental', postcode: '60000', country: 'Maroc', lat: 34.6867, lon: -1.9114 },
  { id: 'loc_nador', formatted: 'Nador, L\'Oriental, Maroc', addressLine1: 'Nador', city: 'Nador', region: 'L\'Oriental', postcode: '62000', country: 'Maroc', lat: 35.1681, lon: -2.9335 },
  { id: 'loc_el_jadida', formatted: 'El Jadida, Casablanca-Settat, Maroc', addressLine1: 'El Jadida', city: 'El Jadida', region: 'Casablanca-Settat', postcode: '24000', country: 'Maroc', lat: 33.2316, lon: -8.5007 },
  { id: 'loc_safi', formatted: 'Safi, Marrakech-Safi, Maroc', addressLine1: 'Safi', city: 'Safi', region: 'Marrakech-Safi', postcode: '46000', country: 'Maroc', lat: 32.2994, lon: -9.2372 },
  { id: 'loc_mohammedia', formatted: 'Mohammédia, Casablanca-Settat, Maroc', addressLine1: 'Mohammédia', city: 'Mohammédia', region: 'Casablanca-Settat', postcode: '28810', country: 'Maroc', lat: 33.6866, lon: -7.3829 },
  { id: 'loc_laayoune', formatted: 'Laâyoune, Laâyoune-Sakia El Hamra, Maroc', addressLine1: 'Laâyoune', city: 'Laâyoune', region: 'Laâyoune-Sakia El Hamra', postcode: '70000', country: 'Maroc', lat: 27.1536, lon: -13.2033 },
  { id: 'loc_dakhla', formatted: 'Dakhla, Dakhla-Oued Ed-Dahab, Maroc', addressLine1: 'Dakhla', city: 'Dakhla', region: 'Dakhla-Oued Ed-Dahab', postcode: '73000', country: 'Maroc', lat: 23.7144, lon: -15.9328 },
  { id: 'loc_berrechid', formatted: 'Berrechid, Casablanca-Settat, Maroc', addressLine1: 'Berrechid', city: 'Berrechid', region: 'Casablanca-Settat', postcode: '26100', country: 'Maroc', lat: 33.2655, lon: -7.5875 },
  { id: 'loc_settat', formatted: 'Settat, Casablanca-Settat, Maroc', addressLine1: 'Settat', city: 'Settat', region: 'Casablanca-Settat', postcode: '26000', country: 'Maroc', lat: 33.0010, lon: -7.6166 },
];

export function AddressAutocompleteInput({
  label,
  value,
  onChangeText,
  onSelectAddress,
  typeFilter = 'all',
  placeholder = 'Rechercher une ville ou une adresse...',
  error,
}: AddressAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<GeoapifySuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const justSelectedRef = useRef(false);
  const debounceTimerRef = useRef<any>(null);
  const apiKey = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY || '11e519aa690d4898b5c1d01a12177ce0';

  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      setShowDropdown(false);
      setSuggestions([]);
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    const query = (value || '').trim().toLowerCase();
    if (query.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      setIsLoading(false);
      return;
    }

    // 1. Instant match against standard Moroccan cities list
    const instantLocal = MOROCCO_POPULAR_LOCATIONS.filter(
      (loc) =>
        loc.addressLine1.toLowerCase().includes(query) ||
        loc.formatted.toLowerCase().includes(query) ||
        loc.region.toLowerCase().includes(query)
    );

    if (instantLocal.length > 0) {
      setSuggestions(instantLocal);
      setShowDropdown(true);
    }

    // 2. Query Geoapify in background for granular address search
    debounceTimerRef.current = setTimeout(async () => {
      setIsLoading(true);
      try {
        const filterQuery = typeFilter === 'city' ? '&type=city' : '';
        const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(
          query
        )}&lang=fr&limit=5${filterQuery}&apiKey=${apiKey}`;

        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data.features) && data.features.length > 0) {
            const apiSuggestions: GeoapifySuggestion[] = data.features.map((feature: any, idx: number) => {
              const props = feature.properties || {};
              const city = props.city || props.town || props.village || props.county || props.state || '';
              const region = props.state || props.region || props.county || props.province || '';
              const addressLine1 = props.address_line1 || props.street || props.name || props.formatted || '';
              const postcode = props.postcode || '';
              const country = props.country || '';
              const lat = typeof props.lat === 'number' ? props.lat : null;
              const lon = typeof props.lon === 'number' ? props.lon : null;

              return {
                id: props.place_id || `geo_${idx}_${Date.now()}`,
                formatted: props.formatted || `${addressLine1}${city ? `, ${city}` : ''}`,
                addressLine1,
                city,
                region,
                postcode,
                country,
                lat,
                lon,
              };
            });

            // Merge local and API suggestions (avoiding duplicates)
            const combined = [...instantLocal];
            apiSuggestions.forEach((apiItem) => {
              const alreadyExists = combined.some(
                (c) => c.addressLine1.toLowerCase() === apiItem.addressLine1.toLowerCase()
              );
              if (!alreadyExists) {
                combined.push(apiItem);
              }
            });

            setSuggestions(combined.slice(0, 6));
            setShowDropdown(true);
          }
        }
      } catch (err: any) {
        console.warn('Error fetching address suggestions from Geoapify:', err.message);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, apiKey, typeFilter]);

  const handleSelect = (item: GeoapifySuggestion) => {
    const textToSet = item.formatted || item.addressLine1 || item.city || '';
    justSelectedRef.current = true;
    setShowDropdown(false);
    setSuggestions([]);
    Keyboard.dismiss();

    onChangeText(textToSet);

    onSelectAddress({
      adresse: textToSet,
      ville: item.city || textToSet,
      region: item.region,
      code_postal: item.postcode,
      pays: item.country,
      latitude: item.lat,
      longitude: item.lon,
    });
  };

  return (
    <View style={styles.container}>
      <Input
        label={label}
        value={value}
        onChangeText={(text) => {
          justSelectedRef.current = false;
          onChangeText(text);
          if (text.trim().length < 2) {
            setShowDropdown(false);
          }
        }}
        placeholder={placeholder}
        error={error}
        leftIcon={<Ionicons name="location-outline" size={18} color={Palette.primary} />}
        rightIcon={
          isLoading ? (
            <ActivityIndicator size="small" color={Palette.primary} />
          ) : value ? (
            <TouchableOpacity
              onPress={() => {
                justSelectedRef.current = true;
                onChangeText('');
                setShowDropdown(false);
                setSuggestions([]);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close-circle" size={18} color={Palette.textMuted} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="search-outline" size={16} color={Palette.textMuted} />
          )
        }
      />

      {/* Floating Suggestions Dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <View style={[styles.dropdownOverlay, { top: label ? 74 : 52 }]}>
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            style={styles.dropdownScroll}
          >
            {suggestions.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.suggestionItem}
                activeOpacity={0.7}
                onPress={() => handleSelect(item)}
              >
                <View style={styles.iconBg}>
                  <Ionicons name="location" size={16} color={Palette.primary} />
                </View>
                <View style={styles.textWrapper}>
                  <Text style={styles.mainText} weight="semibold" numberOfLines={1}>
                    {item.formatted || item.addressLine1}
                  </Text>
                  <Text style={styles.subText} numberOfLines={1}>
                    {[item.city, item.region, item.country].filter(Boolean).join(', ') || item.formatted}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 9999,
  },
  dropdownOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Palette.primary,
    maxHeight: 220,
    zIndex: 99999,
    elevation: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  dropdownScroll: {
    paddingVertical: 4,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  iconBg: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  textWrapper: {
    flex: 1,
  },
  mainText: {
    fontSize: 13.5,
    color: Palette.text,
  },
  subText: {
    fontSize: 11.5,
    color: Palette.textMuted,
    marginTop: 2,
  },
});
