import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './text';
import { Button } from './button';
import { Palette } from '@/constants/theme';

const MOIS_NOMS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

interface DatePickerModalProps {
  visible: boolean;
  title?: string;
  initialValue?: string; // Expects "YYYY-MM-DD" or similar
  minYear?: number;
  maxYear?: number;
  onClose: () => void;
  onConfirm: (dateString: string) => void;
}

export function DatePickerModal({
  visible,
  title = 'Sélectionner une date',
  initialValue,
  minYear = 1940,
  maxYear,
  onClose,
  onConfirm,
}: DatePickerModalProps) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const effectiveMaxYear = maxYear ?? currentYear + 15;
  const effectiveMinYear = minYear;
  
  const [selectedDay, setSelectedDay] = useState<number>(today.getDate());
  const [selectedMonth, setSelectedMonth] = useState<number>(today.getMonth() + 1); // 1 - 12
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);

  useEffect(() => {
    if (visible) {
      if (initialValue && initialValue.includes('-')) {
        const parts = initialValue.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
            setSelectedYear(y);
            setSelectedMonth(Math.min(Math.max(m, 1), 12));
            setSelectedDay(Math.min(Math.max(d, 1), 31));
            return;
          }
        }
      }
      // Default to today if no valid initial value
      const now = new Date();
      setSelectedDay(now.getDate());
      setSelectedMonth(now.getMonth() + 1);
      setSelectedYear(now.getFullYear());
    }
  }, [visible, initialValue]);

  // Generate days array based on month & year (handling leap years)
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Generate years array from effectiveMinYear to effectiveMaxYear (descending)
  const years = Array.from(
    { length: Math.max(1, effectiveMaxYear - effectiveMinYear + 1) },
    (_, i) => effectiveMaxYear - i
  );

  const handleConfirm = () => {
    // Keep day within bounds of selected month
    const validDay = Math.min(selectedDay, daysInMonth);
    const mm = String(selectedMonth).padStart(2, '0');
    const dd = String(validDay).padStart(2, '0');
    const formatted = `${selectedYear}-${mm}-${dd}`;
    onConfirm(formatted);
    onClose();
  };

  const monthName = MOIS_NOMS[selectedMonth - 1] ?? '';
  const displayPreview = `${selectedDay} ${monthName} ${selectedYear}`;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.backdrop}>
        <View style={styles.dialogContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="calendar-outline" size={20} color={Palette.primary} />
              <Text variant="h2" style={styles.title}>
                {title}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={Palette.textMuted} />
            </TouchableOpacity>
          </View>

          {/* Date Preview Banner */}
          <View style={styles.previewBanner}>
            <Text style={styles.previewLabel}>Date sélectionnée :</Text>
            <Text style={styles.previewDate} weight="bold">
              {displayPreview}
            </Text>
          </View>

          {/* HTML5 Native Date Picker for Web, Column Pickers for All */}
          {Platform.OS === 'web' && (
            <View style={styles.webNativePickerWrapper}>
              <Text style={{ fontSize: 12, color: Palette.textMuted, marginBottom: 4 }}>
                Sélecteur rapide ou ajustement manuel :
              </Text>
              <input
                type="date"
                value={`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`}
                max={`${effectiveMaxYear}-12-31`}
                min={`${effectiveMinYear}-01-01`}
                onChange={(e) => {
                  if (e.target.value) {
                    const parts = e.target.value.split('-');
                    if (parts.length === 3) {
                      setSelectedYear(parseInt(parts[0], 10));
                      setSelectedMonth(parseInt(parts[1], 10));
                      setSelectedDay(parseInt(parts[2], 10));
                    }
                  }
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: `1.5px solid ${Palette.inputBorder}`,
                  fontSize: '15px',
                  fontFamily: 'inherit',
                  color: Palette.text,
                  backgroundColor: Palette.inputBg,
                  outline: 'none',
                  cursor: 'pointer',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </View>
          )}

          {/* 3 Column Wheels / Pickers (Jour / Mois / Année) */}
          <View style={styles.columnsContainer}>
            {/* Column 1: Jour */}
            <View style={styles.columnWrapper}>
              <Text style={styles.columnLabel} weight="semibold">
                JOUR
              </Text>
              <ScrollView
                style={styles.columnScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.columnContent}
              >
                {days.map((d) => {
                  const isSelected = d === selectedDay;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                      onPress={() => setSelectedDay(d)}
                    >
                      <Text
                        style={[styles.itemText, isSelected && styles.itemTextSelected]}
                        weight={isSelected ? 'bold' : 'medium'}
                      >
                        {String(d).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Column 2: Mois */}
            <View style={[styles.columnWrapper, { flex: 1.4 }]}>
              <Text style={styles.columnLabel} weight="semibold">
                MOIS
              </Text>
              <ScrollView
                style={styles.columnScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.columnContent}
              >
                {MOIS_NOMS.map((mName, index) => {
                  const mNum = index + 1;
                  const isSelected = mNum === selectedMonth;
                  return (
                    <TouchableOpacity
                      key={mNum}
                      style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                      onPress={() => setSelectedMonth(mNum)}
                    >
                      <Text
                        style={[styles.itemText, isSelected && styles.itemTextSelected]}
                        weight={isSelected ? 'bold' : 'medium'}
                        numberOfLines={1}
                      >
                        {mName}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Column 3: Année */}
            <View style={styles.columnWrapper}>
              <Text style={styles.columnLabel} weight="semibold">
                ANNÉE
              </Text>
              <ScrollView
                style={styles.columnScroll}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.columnContent}
              >
                {years.map((y) => {
                  const isSelected = y === selectedYear;
                  return (
                    <TouchableOpacity
                      key={y}
                      style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                      onPress={() => setSelectedYear(y)}
                    >
                      <Text
                        style={[styles.itemText, isSelected && styles.itemTextSelected]}
                        weight={isSelected ? 'bold' : 'medium'}
                      >
                        {y}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <Button
              title="Annuler"
              variant="outline"
              size="md"
              onPress={onClose}
              style={{ flex: 1, marginRight: 8 }}
            />
            <Button
              title="Confirmer"
              variant="primary"
              size="md"
              onPress={handleConfirm}
              style={{ flex: 1, marginLeft: 8 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  dialogContainer: {
    backgroundColor: Palette.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: Palette.text,
    fontSize: 18,
  },
  closeBtn: {
    padding: 4,
  },
  previewBanner: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderColor: 'rgba(23, 107, 91, 0.2)',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  previewLabel: {
    fontSize: 11,
    color: Palette.textMuted,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  previewDate: {
    fontSize: 18,
    color: Palette.primary,
  },
  webNativePickerWrapper: {
    marginBottom: 14,
  },
  columnsContainer: {
    flexDirection: 'row',
    gap: 8,
    height: 200,
    marginBottom: 20,
  },
  columnWrapper: {
    flex: 1,
    backgroundColor: Palette.background,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  columnLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    color: Palette.textMuted,
    textAlign: 'center',
    marginBottom: 6,
  },
  columnScroll: {
    flex: 1,
  },
  columnContent: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  itemCard: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 2,
  },
  itemCardSelected: {
    backgroundColor: Palette.primary,
  },
  itemText: {
    fontSize: 14,
    color: Palette.text,
  },
  itemTextSelected: {
    color: '#FFFFFF',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
