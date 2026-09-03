import React, { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import { Palette } from '@/constants/theme';

interface ObservationCalendarProps {
  month: string; // "YYYY-MM"
  selectedDate: string; // "YYYY-MM-DD"
  observationDates: Set<string>;
  onMonthChange: (month: string) => void;
  onSelectDate: (date: string) => void;
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ObservationCalendar({
  month,
  selectedDate,
  observationDates,
  onMonthChange,
  onSelectDate,
}: ObservationCalendarProps) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { cells, monthTitle } = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    // 0 = Sun, 1 = Mon ... In France, Monday is first day of week:
    const firstMondayOffset = (new Date(year, monthNumber - 1, 1).getDay() + 6) % 7;

    const values: (number | null)[] = [
      ...Array(firstMondayOffset).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
    ];
    while (values.length % 7 !== 0) {
      values.push(null);
    }

    const title = new Date(year, monthNumber - 1, 1).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
    });

    return { cells: values, monthTitle: title };
  }, [month]);

  const markedCountInMonth = useMemo(() => {
    let count = 0;
    observationDates.forEach((d) => {
      if (d.startsWith(month)) count++;
    });
    return count;
  }, [observationDates, month]);

  return (
    <View style={styles.card}>
      {/* ── 1. Month Header & Navigation ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => onMonthChange(shiftMonth(month, -1))}
          activeOpacity={0.7}
          accessibilityLabel="Mois précédent"
        >
          <Ionicons name="chevron-back" size={20} color={Palette.primary} />
        </TouchableOpacity>

        <View style={styles.titleContainer}>
          <Text weight="bold" style={styles.monthTitle}>
            {monthTitle}
          </Text>
          {markedCountInMonth > 0 ? (
            <View style={styles.countBadge}>
              <View style={styles.countBadgeDot} />
              <Text style={styles.countBadgeText} weight="semibold">
                {markedCountInMonth} jour{markedCountInMonth > 1 ? 's' : ''} avec relevés
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => onMonthChange(shiftMonth(month, 1))}
          activeOpacity={0.7}
          accessibilityLabel="Mois suivant"
        >
          <Ionicons name="chevron-forward" size={20} color={Palette.primary} />
        </TouchableOpacity>
      </View>

      {/* ── 2. Days of the Week Row ── */}
      <View style={styles.weekDaysRow}>
        {DAY_LABELS.map((d, i) => (
          <Text key={`${d}-${i}`} style={styles.weekDayText} weight="semibold">
            {d}
          </Text>
        ))}
      </View>

      {/* ── 3. Calendar Grid ── */}
      <View style={styles.grid}>
        {cells.map((dayNum, idx) => {
          if (dayNum === null) {
            return <View key={`empty-${idx}`} style={styles.cell} />;
          }

          const dateStr = `${month}-${String(dayNum).padStart(2, '0')}`;
          const isSelected = selectedDate === dateStr;
          const isMarked = observationDates.has(dateStr);
          const isToday = todayStr === dateStr;

          return (
            <TouchableOpacity
              key={dateStr}
              style={[
                styles.cell,
                isToday && !isSelected && styles.todayCell,
                isSelected && styles.selectedCell,
              ]}
              onPress={() => onSelectDate(dateStr)}
              activeOpacity={0.75}
              accessibilityLabel={`Date ${dateStr}${isMarked ? ', contient des observations' : ''}`}
            >
              <Text
                style={[
                  styles.dayNumber,
                  isToday && !isSelected && styles.todayText,
                  isSelected && styles.selectedText,
                ]}
                weight={isSelected || isToday ? 'bold' : 'normal'}
              >
                {dayNum}
              </Text>

              {isMarked ? (
                <View
                  style={[
                    styles.indicatorDot,
                    isSelected && styles.indicatorDotSelected,
                  ]}
                />
              ) : (
                <View style={styles.dotPlaceholder} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  navBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    alignItems: 'center',
  },
  monthTitle: {
    textTransform: 'capitalize',
    color: Palette.text,
    fontSize: 15,
    letterSpacing: -0.2,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#CCFBF1',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 3,
  },
  countBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#0D9488',
  },
  countBadgeText: {
    fontSize: 10,
    color: '#0D9488',
  },
  weekDaysRow: {
    flexDirection: 'row',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: 6,
  },
  weekDayText: {
    width: '14.285%',
    textAlign: 'center',
    color: Palette.textMuted,
    fontSize: 11,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: '14.285%',
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    marginVertical: 1,
  },
  todayCell: {
    borderWidth: 1.5,
    borderColor: Palette.primary,
    backgroundColor: 'rgba(23, 107, 91, 0.05)',
  },
  todayText: {
    color: Palette.primary,
  },
  selectedCell: {
    backgroundColor: Palette.primary,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  dayNumber: {
    color: Palette.text,
    fontSize: 13,
  },
  selectedText: {
    color: '#FFFFFF',
  },
  indicatorDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#0D9488',
    marginTop: 2,
  },
  indicatorDotSelected: {
    backgroundColor: '#FFFFFF',
  },
  dotPlaceholder: {
    height: 5,
    marginTop: 2,
  },
});
