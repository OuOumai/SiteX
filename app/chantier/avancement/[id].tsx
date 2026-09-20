import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  Modal,
  Dimensions,
  TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Path,
  Circle,
  Line,
  Text as SvgText,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import { useAuth } from '@/hooks/useAuth';
import { Text } from '@/components/ui/text';
import { Card } from '@/components/ui/card';
import { Palette } from '@/constants/theme';
import {
  api,
  getMediaUrl,
  ChantierAvancementResponse,
  ChantierAvancementTroncon,
  ChantierDailyHistoryPoint,
  ChantierObservationHistoryItem,
  ChantierJournalResponse,
  ChantierJournalDay,
  ChantierJournalTronconDay,
} from '@/services/api';


/** Deterministic palette for N tronçons in the segmented diagram and breakdown */
const TRONCON_COLORS = [
  '#0D9488', // Teal
  '#2563EB', // Blue
  '#8B5CF6', // Purple
  '#F59E0B', // Amber
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#10B981', // Emerald
  '#6366F1', // Indigo
  '#D97706', // Orange
  '#4F46E5', // Violet
];

/** Convert polar coordinates to Cartesian */
function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

/** Generate an SVG donut slice path between startAngle and endAngle */
function describeDonutArc(
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const delta = Math.min(Math.max(endAngle - startAngle, 0.01), 359.99);
  const actualEndAngle = startAngle + delta;

  const startOuter = polarToCartesian(x, y, outerRadius, actualEndAngle);
  const endOuter = polarToCartesian(x, y, outerRadius, startAngle);
  const startInner = polarToCartesian(x, y, innerRadius, startAngle);
  const endInner = polarToCartesian(x, y, innerRadius, actualEndAngle);

  const arcSweep = delta <= 180 ? '0' : '1';

  return [
    'M', startOuter.x, startOuter.y,
    'A', outerRadius, outerRadius, 0, arcSweep, 0, endOuter.x, endOuter.y,
    'L', startInner.x, startInner.y,
    'A', innerRadius, innerRadius, 0, arcSweep, 1, endInner.x, endInner.y,
    'Z',
  ].join(' ');
}

/** Status color helper */
function getStatusBadge(statut?: string) {
  switch (statut) {
    case 'TERMINE':
      return { label: 'Terminé', bg: '#DCFCE7', text: '#15803D' };
    case 'EN_COURS':
      return { label: 'En cours', bg: '#DBEAFE', text: '#1D4ED8' };
    case 'PROBLEME':
      return { label: 'Problème', bg: '#FEE2E2', text: '#B91C1C' };
    case 'NON_COMMENCE':
    default:
      return { label: 'Non commencé', bg: '#F1F5F9', text: '#64748B' };
  }
}

/** Operational Journal Day Status Helper */
function getDayStatusMeta(status?: string) {
  switch (status) {
    case 'ACTIVITE':
      return { label: 'Activité complète', color: '#16A34A', bg: '#DCFCE7', icon: 'checkmark-circle' as const };
    case 'ACTIVITE_PARTIELLE':
      return { label: 'Activité partielle', color: '#0D9488', bg: '#CCFBF1', icon: 'pie-chart' as const };
    case 'NON_TRAVAILLE':
      return { label: 'Non travaillé', color: '#64748B', bg: '#F1F5F9', icon: 'pause-circle' as const };
    case 'ABSENCE':
      return { label: 'Absence A.T.', color: '#2563EB', bg: '#DBEAFE', icon: 'person-remove' as const };
    case 'CHANTIER_ARRETE':
      return { label: 'Chantier arrêté', color: '#8B5CF6', bg: '#EDE9FE', icon: 'warning' as const };
    case 'INACTIVITE_A_VERIFIER':
      return { label: 'Inactivité à vérifier', color: '#DC2626', bg: '#FEE2E2', icon: 'alert-circle' as const };
    case 'A_VENIR':
    default:
      return { label: 'À venir', color: '#94A3B8', bg: '#F8FAFC', icon: 'time-outline' as const };
  }
}

/** Operational Journal Tronçon Status Helper */
function getTronconStatusMeta(status?: string) {
  switch (status) {
    case 'RELEVE':
      return { label: 'Relevé enregistré', color: '#16A34A', bg: '#DCFCE7' };
    case 'NON_TRAVAILLE':
      return { label: 'Non travaillé', color: '#64748B', bg: '#F1F5F9' };
    case 'ABSENCE_AGENT':
      return { label: 'Absence déclarée', color: '#2563EB', bg: '#DBEAFE' };
    case 'CHANTIER_ARRETE':
      return { label: 'Chantier arrêté', color: '#8B5CF6', bg: '#EDE9FE' };
    case 'SANS_RELEVE':
      return { label: 'Sans relevé', color: '#DC2626', bg: '#FEE2E2' };
    case 'A_VENIR':
    default:
      return { label: 'À venir', color: '#94A3B8', bg: '#F8FAFC' };
  }
}

function formatMonthTitle(monthStr: string) {
  if (!monthStr || !monthStr.includes('-')) return monthStr;
  const [y, m] = monthStr.split('-').map(Number);
  const monthNames = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];
  return `${monthNames[m - 1] || ''} ${y}`;
}

function formatFullDateFrench(dateStr: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const dObj = new Date(y, m - 1, d);
  const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
  const months = [
    'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
  ];
  return `${days[dObj.getDay()]} ${d} ${months[m - 1]} ${y}`;
}

function formatDateBarFrench(dateStr: string) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  const months = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  ];
  return `${d} ${months[m - 1]} ${y}`;
}

function isDayMatchingFilter(
  day: ChantierJournalDay,
  filter: 'ACTIVITE' | 'SANS_RELEVE' | 'NON_TRAVAILLE' | 'ABSENCE' | null
): boolean {
  if (!filter) return true;
  switch (filter) {
    case 'ACTIVITE':
      return day.statut_jour === 'ACTIVITE' || day.statut_jour === 'ACTIVITE_PARTIELLE' || day.observations_count > 0;
    case 'SANS_RELEVE':
      return day.statut_jour === 'INACTIVITE_A_VERIFIER' || (!day.is_future && !day.is_non_travaille && day.observations_count === 0 && day.statut_jour !== 'ABSENCE');
    case 'NON_TRAVAILLE':
      return day.statut_jour === 'NON_TRAVAILLE' || day.is_non_travaille || day.is_ferie;
    case 'ABSENCE':
      return day.statut_jour === 'ABSENCE' || day.troncons.some((t) => t.statut === 'ABSENCE_AGENT');
    default:
      return true;
  }
}

type TabType = 'resume' | 'historique';

export default function ChantierAvancementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { token, isLoading: isAuthLoading } = useAuth();

  const [activeTab, setActiveTab] = useState<TabType>('resume');
  const [data, setData] = useState<ChantierAvancementResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; description?: string | null } | null>(null);
  const [sortMode, setSortMode] = useState<'pk' | 'avancement_desc' | 'avancement_asc'>('pk');
  const [isSortModalVisible, setIsSortModalVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // Operational Journal State
  const [journalData, setJournalData] = useState<ChantierJournalResponse | null>(null);
  const [isJournalLoading, setIsJournalLoading] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const [activeStatFilter, setActiveStatFilter] = useState<'ACTIVITE' | 'SANS_RELEVE' | 'NON_TRAVAILLE' | 'ABSENCE' | null>(null);

  // Modal for Justification request
  const [justificationModal, setJustificationModal] = useState<{
    visible: boolean;
    troncon: ChantierJournalTronconDay | null;
    date: string;
  }>({ visible: false, troncon: null, date: todayStr });
  const [justificationMessage, setJustificationMessage] = useState('');
  const [isSendingJustification, setIsSendingJustification] = useState(false);
  const [justificationError, setJustificationError] = useState<string | null>(null);
  const [justificationSuccess, setJustificationSuccess] = useState(false);

  // Contextual Multi-Tronçon Contact Bottom Sheet (Requirements 4, 8, 9)
  const [isContextualContactModalVisible, setIsContextualContactModalVisible] = useState(false);
  const [selectedTronconIdsForContact, setSelectedTronconIdsForContact] = useState<number[]>([]);
  const [contextualContactMessage, setContextualContactMessage] = useState('');
  const [isSendingContextualContact, setIsSendingContextualContact] = useState(false);
  const [contextualContactFeedback, setContextualContactFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Pending Explanations Overview Modal (Requirement 3)
  const [isPendingExplanationsModalVisible, setIsPendingExplanationsModalVisible] = useState(false);

  const fetchAvancement = useCallback(async (isRefresh = false) => {
    if (!token || !id) {
      if (!isAuthLoading) setIsLoading(false);
      return;
    }
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const res = await api.getChantierAvancement(token, id);
      setData(res);
    } catch (err: any) {
      console.error('[AvancementScreen] Error:', err.message);
      setError(err.message || "Impossible de charger les données d'avancement.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [token, id, isAuthLoading]);

  const fetchJournal = useCallback(async (monthToFetch?: string) => {
    if (!token || !id) return;
    const m = monthToFetch || selectedMonth;
    setIsJournalLoading(true);
    setJournalError(null);
    try {
      const res = await api.getChantierJournal(token, id, m);
      setJournalData(res);
      setJournalError(null);
      if (res.days.length > 0) {
        const hasSelected = res.days.some((d) => d.date === selectedDate);
        if (!hasSelected) {
          const todayInMonth = res.days.find((d) => d.is_today);
          setSelectedDate(todayInMonth ? todayInMonth.date : res.days[res.days.length - 1].date);
        }
      }
    } catch (err: any) {
      console.warn('[AvancementScreen] FetchJournal Error:', err.message);
      setJournalError(err.message || 'Impossible de contacter le serveur.');
    } finally {
      setIsJournalLoading(false);
    }
  }, [token, id, selectedMonth, selectedDate]);

  useEffect(() => {
    if (!isAuthLoading) {
      fetchAvancement();
    }
  }, [fetchAvancement, isAuthLoading]);

  useEffect(() => {
    if (activeTab === 'historique' && token && id) {
      fetchJournal(selectedMonth);
    }
  }, [activeTab, selectedMonth, fetchJournal, token, id]);

  const handlePrevMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevMonthStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(prevMonthStr);
    fetchJournal(prevMonthStr);
  };

  const handleNextMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const nextDate = new Date(y, m, 1);
    const nextMonthStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
    setSelectedMonth(nextMonthStr);
    fetchJournal(nextMonthStr);
  };

  const handleCurrentMonth = () => {
    setSelectedMonth(currentMonthStr);
    setSelectedDate(todayStr);
    fetchJournal(currentMonthStr);
  };

  const openJustificationModal = (troncon: ChantierJournalTronconDay, date: string) => {
    setJustificationModal({
      visible: true,
      troncon,
      date,
    });
    setJustificationMessage(
      `Aucun relevé terrain n'a été enregistré le ${date} pour le tronçon ${troncon.nom}. Merci de préciser le motif d'inactivité.`
    );
    setJustificationError(null);
    setJustificationSuccess(false);
  };

  const handleSubmitJustification = async () => {
    if (!token || !id || !justificationModal.troncon || !justificationMessage.trim()) return;
    setIsSendingJustification(true);
    setJustificationError(null);
    try {
      await api.requestJustification(token, id, {
        troncon_id: justificationModal.troncon.troncon_id,
        date_concernee: justificationModal.date,
        message: justificationMessage.trim(),
      });
      setJustificationSuccess(true);
      setTimeout(async () => {
        setJustificationModal({ visible: false, troncon: null, date: todayStr });
        setJustificationSuccess(false);
        await fetchJournal(selectedMonth);
      }, 1200);
    } catch (err: any) {
      console.error('Submit justification error:', err.message);
      setJustificationError(err.message || "Impossible d'envoyer la demande d'explication.");
    } finally {
      setIsSendingJustification(false);
    }
  };

  const activeDay = journalData?.days?.find((d) => d.date === selectedDate) || null;

  const openContextualContactModal = useCallback(() => {
    setContextualContactFeedback(null);
    setContextualContactMessage(
      "Aucun relevé terrain n'a été enregistré pour cette journée. Merci de nous indiquer la situation."
    );

    if (activeDay) {
      const missingWithAgent = activeDay.troncons.filter(
        (t) => t.statut === 'SANS_RELEVE' && !activeDay.is_future && !activeDay.is_non_travaille && Boolean(t.agent_id)
      );
      // Pre-select only those without pending request
      const eligible = missingWithAgent.filter(
        (t) => !t.demande_explication || t.demande_explication.statut === 'REFUSEE'
      );
      setSelectedTronconIdsForContact(eligible.map((t) => t.troncon_id));
    } else {
      setSelectedTronconIdsForContact([]);
    }
    setIsContextualContactModalVisible(true);
  }, [activeDay]);

  const handleToggleTronconContactSelection = useCallback((tronconId: number) => {
    setSelectedTronconIdsForContact((prev) =>
      prev.includes(tronconId) ? prev.filter((i) => i !== tronconId) : [...prev, tronconId]
    );
  }, []);

  const handleSubmitContextualContact = useCallback(async () => {
    if (!token || !id || !activeDay || selectedTronconIdsForContact.length === 0) return;
    setIsSendingContextualContact(true);
    setContextualContactFeedback(null);

    try {
      let sentCount = 0;
      for (const tId of selectedTronconIdsForContact) {
        try {
          await api.requestJustification(token, id, {
            troncon_id: tId,
            date_concernee: activeDay.date,
            message:
              contextualContactMessage.trim() ||
              "Aucun relevé terrain n'a été enregistré pour cette journée. Merci de nous indiquer la situation.",
          });
          sentCount++;
        } catch (itemErr: any) {
          console.warn(`Could not send request for troncon ${tId}:`, itemErr.message);
        }
      }

      setContextualContactFeedback({
        type: 'success',
        message: `${sentCount} demande${sentCount > 1 ? 's' : ''} d'explication transmise${
          sentCount > 1 ? 's' : ''
        } avec succès.`,
      });

      setTimeout(async () => {
        setIsContextualContactModalVisible(false);
        setContextualContactFeedback(null);
        await fetchJournal(selectedMonth);
      }, 1200);
    } catch (err: any) {
      console.error('Submit contextual contact error:', err.message);
      setContextualContactFeedback({
        type: 'error',
        message: err.message || "Erreur lors de l'envoi des demandes d'explication.",
      });
    } finally {
      setIsSendingContextualContact(false);
    }
  }, [token, id, activeDay, selectedTronconIdsForContact, contextualContactMessage, selectedMonth, fetchJournal]);

  const onRefresh = async () => {
    await fetchAvancement(true);
    if (activeTab === 'historique') {
      await fetchJournal(selectedMonth);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Palette.primary} />
          <Text variant="muted" style={styles.loadingText}>
            Chargement de l'avancement consolidé...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !data) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.topNav}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={Palette.primary} />
            <Text style={styles.backButtonText} weight="semibold">
              Chantier
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centerContainer}>
          <Card variant="elevated" style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={36} color={Palette.alert} />
            <Text variant="error" style={styles.errorText}>
              {error || 'Données introuvables.'}
            </Text>
            <TouchableOpacity onPress={() => fetchAvancement()} style={styles.retryBtn}>
              <Text style={styles.retryBtnText} weight="semibold">
                Réessayer
              </Text>
            </TouchableOpacity>
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const { chantier, troncons, stats, historique } = data;
  const avancementPct = chantier.avancement ?? 0;
  const N = troncons.length;

  // Status distribution counts (using existing SiteX status vocabulary)
  const countTermines = troncons.filter((t) => t.statut === 'TERMINE' || t.avancement >= 100).length;
  const countEnCours = troncons.filter(
    (t) => (t.statut === 'EN_COURS' || (t.avancement > 0 && t.avancement < 100)) && t.statut !== 'PROBLEME'
  ).length;
  const countNonCommence = troncons.filter(
    (t) => (t.statut === 'NON_COMMENCE' || !t.statut) && t.avancement === 0
  ).length;
  const countProbleme = troncons.filter((t) => t.statut === 'PROBLEME').length;
  const tronconsSuivisCount = troncons.filter((t) => t.observations_count > 0).length;

  // Indexed tronçons with deterministic palette colors
  const indexedTroncons = troncons.map((t, idx) => ({
    ...t,
    originalIndex: idx,
    color: TRONCON_COLORS[idx % TRONCON_COLORS.length],
  }));

  // Filtered and sorted tronçons for "Comparaison des tronçons" (presentation-only)
  let displayedTroncons = [...indexedTroncons];

  if (statusFilter) {
    if (statusFilter === 'TERMINE') {
      displayedTroncons = displayedTroncons.filter((t) => t.statut === 'TERMINE' || t.avancement >= 100);
    } else if (statusFilter === 'EN_COURS') {
      displayedTroncons = displayedTroncons.filter(
        (t) => (t.statut === 'EN_COURS' || (t.avancement > 0 && t.avancement < 100)) && t.statut !== 'PROBLEME'
      );
    } else if (statusFilter === 'NON_COMMENCE') {
      displayedTroncons = displayedTroncons.filter(
        (t) => (t.statut === 'NON_COMMENCE' || !t.statut) && t.avancement === 0
      );
    } else if (statusFilter === 'PROBLEME') {
      displayedTroncons = displayedTroncons.filter((t) => t.statut === 'PROBLEME');
    }
  }

  if (sortMode === 'avancement_desc') {
    displayedTroncons.sort((a, b) => b.avancement - a.avancement);
  } else if (sortMode === 'avancement_asc') {
    displayedTroncons.sort((a, b) => a.avancement - b.avancement);
  }

  // Factual items for "À surveiller" (objective reasons only)
  const watchList = indexedTroncons
    .map((t) => {
      const issues: string[] = [];
      if (t.statut === 'PROBLEME') {
        issues.push('Signalé avec problème / alerte');
      }
      if (
        t.observations_count === 0 &&
        (stats.nombre_total_observations > 0 || chantier.statut === 'EN_COURS' || chantier.statut === 'En cours')
      ) {
        issues.push('Aucun relevé enregistré');
      }
      if (!t.agent_id && !t.agent_nom_complet) {
        issues.push('Aucun agent de terrain affecté');
      }
      return {
        troncon: t,
        issues,
      };
    })
    .filter((item) => item.issues.length > 0);

  // Compact segmented diagram parameters
  const donutSize = 170;
  const cx = donutSize / 2;
  const cy = donutSize / 2;
  const outerR = 68;
  const innerR = 46;
  const sectorAngle = N > 0 ? 360 / N : 360;
  const sectorGap = N > 1 ? Math.min(2.5, sectorAngle * 0.08) : 0;

  const getSortLabel = (mode: 'pk' | 'avancement_desc' | 'avancement_asc') => {
    switch (mode) {
      case 'avancement_desc':
        return 'Avancement ↓';
      case 'avancement_asc':
        return 'Avancement ↑';
      case 'pk':
      default:
        return 'Ordre PK';
    }
  };

  // Operational Journal Calendar & Day selection
  const calendarWeeks: (ChantierJournalDay | null)[][] = [];
  if (journalData && Array.isArray(journalData.days) && journalData.days.length > 0) {
    let currentWeek: (ChantierJournalDay | null)[] = [];
    const firstDay = journalData.days[0];
    for (let i = 1; i < firstDay.day_of_week; i++) {
      currentWeek.push(null);
    }
    for (const day of journalData.days) {
      currentWeek.push(day);
      if (currentWeek.length === 7) {
        calendarWeeks.push(currentWeek);
        currentWeek = [];
      }
    }
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      calendarWeeks.push(currentWeek);
    }
  }

  // S-Curve chart parameters (Historique)
  const timeline = historique.timeline || [];
  const svgChartWidth = 320;
  const svgChartHeight = 180;
  const paddingLeft = 38;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 32;
  const plotWidth = svgChartWidth - paddingLeft - paddingRight;
  const plotHeight = svgChartHeight - paddingTop - paddingBottom;
  const yLevels = [100, 80, 60, 40, 20, 0];

  const activePoints = (journalData?.days && journalData.days.length > 0)
    ? journalData.days
        .filter((d) => !d.is_future)
        .map((d) => ({
          date: d.date,
          dayOfMonth: String(d.day_of_month).padStart(2, '0'),
          monthLabel: (d.day_of_month === 1 || d.day_of_month === 15 || d.day_of_month === 30 || d.is_today)
            ? `${d.day_of_month}`
            : '',
          avancement: d.consolidated_progress,
          is_synthetic_baseline: false,
        }))
    : timeline;

  const chartCoords = activePoints.map((p, index) => {
    const x =
      activePoints.length <= 1
        ? paddingLeft + plotWidth / 2
        : paddingLeft + (index / (activePoints.length - 1)) * plotWidth;
    const y = paddingTop + (1 - Math.min(100, Math.max(0, p.avancement)) / 100) * plotHeight;
    return { ...p, x, y };
  });

  const linePathD =
    chartCoords.length > 0
      ? chartCoords.reduce((acc, pt, idx) => {
          return idx === 0 ? `M ${pt.x},${pt.y}` : `${acc} L ${pt.x},${pt.y}`;
        }, '')
      : '';

  const areaPathD =
    chartCoords.length > 0
      ? `${linePathD} L ${chartCoords[chartCoords.length - 1].x},${paddingTop + plotHeight} L ${chartCoords[0].x},${paddingTop + plotHeight} Z`
      : '';


  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ── 1. Header Navigation ── */}
      <View style={styles.topNav}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={() => router.back()}
        >
          <Ionicons name="chevron-back" size={22} color={Palette.primary} />
          <Text style={styles.backButtonText} weight="semibold">
            Chantier
          </Text>
        </TouchableOpacity>
        <Text variant="subtitle" style={styles.headerTitle} numberOfLines={1}>
          Suivi de l'avancement
        </Text>
        <View style={{ width: 70 }} />
      </View>

      {/* ── 2. Tab Switcher (Résumé & Historique) ── */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'resume' && styles.tabButtonActive]}
          onPress={() => setActiveTab('resume')}
        >
          <Text
            style={[styles.tabText, activeTab === 'resume' && styles.tabTextActive]}
            weight={activeTab === 'resume' ? 'bold' : 'normal'}
          >
            Résumé
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'historique' && styles.tabButtonActive]}
          onPress={() => setActiveTab('historique')}
        >
          <Text
            style={[styles.tabText, activeTab === 'historique' && styles.tabTextActive]}
            weight={activeTab === 'historique' ? 'bold' : 'normal'}
          >
            Historique
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={Palette.primary}
            colors={[Palette.primary]}
          />
        }
      >
        {/* ══════════════ TAB 1: RÉSUMÉ ══════════════ */}
        {activeTab === 'resume' && (
          <View style={styles.tabSection}>
            {/* ── 1. Carte Principale "État du chantier" ── */}
            <Card variant="elevated" style={styles.mainChantierCard}>
              <View style={styles.mainCardTopRow}>
                <Text variant="subtitle" style={styles.mainChantierName} numberOfLines={1}>
                  {chantier.nom}
                </Text>
                <View style={styles.chantierStatutBadge}>
                  <Text style={styles.chantierStatutText} weight="semibold">
                    {chantier.statut || 'En cours'}
                  </Text>
                </View>
              </View>

              <View style={styles.mainProgressBlock}>
                <Text style={styles.mainProgressNumber} weight="bold">
                  {avancementPct}%
                </Text>
                <View style={styles.mainProgressMeta}>
                  <Text style={styles.mainProgressLabel} weight="bold">
                    Avancement consolidé
                  </Text>
                  <Text variant="muted" style={styles.mainProgressExpl}>
                    Moyenne des {N} tronçon{N > 1 ? 's' : ''}
                  </Text>
                </View>
              </View>

              {/* Barre de progression globale */}
              <View style={styles.mainProgressBarTrack}>
                <View
                  style={[
                    styles.mainProgressBarFill,
                    {
                      width: `${Math.min(100, Math.max(0, avancementPct))}%`,
                      backgroundColor:
                        avancementPct >= 80
                          ? Palette.primary
                          : avancementPct >= 40
                          ? '#2563EB'
                          : '#F59E0B',
                    },
                  ]}
                />
              </View>

              {/* Deux statistiques compactes côte à côte */}
              <View style={styles.mainCardStatsRow}>
                <View style={styles.mainCardStatCol}>
                  <Text style={styles.mainCardStatValue} weight="bold">
                    {countTermines} / {N}
                  </Text>
                  <Text style={styles.mainCardStatLabel}>
                    tronçons terminés
                  </Text>
                </View>
                <View style={styles.mainCardStatDivider} />
                <View style={styles.mainCardStatCol}>
                  <Text style={styles.mainCardStatValue} weight="bold">
                    {stats.total_completed_meters.toLocaleString('fr-FR')} m / {stats.total_planned_meters.toLocaleString('fr-FR')} m
                  </Text>
                  <Text style={styles.mainCardStatLabel}>
                    réalisés
                  </Text>
                </View>
              </View>
            </Card>

            {/* ── 2. Avancement des tronçons (Lignes compactes + Tri mobile épuré) ── */}
            <View style={styles.tronconsSection}>
              <View style={styles.tronconsSectionHeader}>
                <View style={styles.tronconsTitleCol}>
                  <Text style={styles.tronconsSectionTitle} weight="bold">
                    Avancement des tronçons
                  </Text>
                  <Text style={styles.tronconsCountSubtitle}>
                    {N} tronçon{N > 1 ? 's' : ''}
                  </Text>
                </View>

                {/* Contrôle de tri compact "Ordre PK ▾" */}
                <TouchableOpacity
                  style={styles.compactSortBtn}
                  activeOpacity={0.7}
                  onPress={() => setIsSortModalVisible(true)}
                >
                  <Text style={styles.compactSortBtnText} weight="semibold">
                    {getSortLabel(sortMode)}
                  </Text>
                  <Ionicons name="chevron-down" size={13} color={Palette.primary} />
                </TouchableOpacity>
              </View>

              <Card variant="elevated" style={styles.compactTronconsCard}>
                {displayedTroncons.length === 0 ? (
                  <View style={styles.emptyTronconsBox}>
                    <Text style={styles.emptyDiagramText}>Aucun tronçon configuré</Text>
                  </View>
                ) : (
                  displayedTroncons.map((t, idx) => {
                    const stBadge = getStatusBadge(t.statut);
                    const isLast = idx === displayedTroncons.length - 1;

                    return (
                      <TouchableOpacity
                        key={t.id}
                        activeOpacity={0.7}
                        style={[styles.compactRow, !isLast && styles.compactRowDivider]}
                        onPress={() => router.push(`/responsable/troncon/${t.id}`)}
                      >
                        <View style={styles.compactRowHeader}>
                          {/* Identité : [T1] + Nom + Agent & Métrage secondaire */}
                          <View style={styles.compactIdentityCol}>
                            <View style={[styles.compactCodeBadge, { backgroundColor: t.color }]}>
                              <Text style={styles.compactCodeText} weight="bold">
                                {t.code}
                              </Text>
                            </View>
                            <View style={styles.compactTextGroup}>
                              <Text style={styles.compactTronconName} weight="semibold" numberOfLines={1}>
                                {t.nom}
                              </Text>
                              <View style={styles.compactSubMetaRow}>
                                <Text style={styles.compactAgentText} numberOfLines={1}>
                                  {t.agent_nom_complet || 'Non affecté'}
                                </Text>
                                <Text style={styles.compactMetaDot}>·</Text>
                                <Text style={styles.compactMetersText}>
                                  {t.completed_meters.toLocaleString('fr-FR')} / {t.planned_meters.toLocaleString('fr-FR')} m
                                </Text>
                              </View>
                            </View>
                          </View>

                          {/* Droite : Pourcentage + Statut discret + Chevron */}
                          <View style={styles.compactRightCol}>
                            <View style={styles.compactPctAndStatus}>
                              <Text style={[styles.compactPctText, { color: t.color }]} weight="bold">
                                {t.avancement}%
                              </Text>
                              <View style={[styles.compactStatusPill, { backgroundColor: stBadge.bg }]}>
                                <Text style={[styles.compactStatusText, { color: stBadge.text }]} weight="semibold">
                                  {stBadge.label}
                                </Text>
                              </View>
                            </View>
                            <Ionicons name="chevron-forward" size={15} color={Palette.textLight} />
                          </View>
                        </View>

                        {/* Barre de progression fine du tronçon */}
                        <View style={styles.compactProgressBarTrack}>
                          <View
                            style={[
                              styles.compactProgressBarFill,
                              {
                                width: `${Math.min(100, Math.max(0, t.avancement))}%`,
                                backgroundColor: t.color,
                              },
                            ]}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </Card>
            </View>

            {/* ── 3. Répartition de l'avancement (Donut compact à secteurs égaux) ── */}
            <Card variant="elevated" style={styles.compactDonutCard}>
              <View style={styles.compactDonutHeader}>
                <Text style={styles.compactDonutTitle} weight="semibold">
                  Répartition de l'avancement
                </Text>
                <Text style={styles.compactDonutSubtitle}>
                  Chaque secteur représente un tronçon
                </Text>
              </View>

              {N === 0 ? (
                <View style={styles.emptyDiagramBox}>
                  <Ionicons name="pie-chart-outline" size={32} color={Palette.textLight} />
                  <Text style={styles.emptyDiagramText}>Aucun tronçon configuré</Text>
                </View>
              ) : (
                <View style={styles.compactDonutWrapper}>
                  <Svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`}>
                    {indexedTroncons.map((t, idx) => {
                      const startAngle = idx * sectorAngle + sectorGap / 2;
                      const spanAngle = sectorAngle - sectorGap;
                      const endAngle = startAngle + spanAngle;
                      const progressSpan = spanAngle * (Math.min(100, Math.max(0, t.avancement)) / 100);
                      const fillEndAngle = startAngle + progressSpan;

                      return (
                        <React.Fragment key={`donut-${t.id}`}>
                          {/* Sector Background Track */}
                          <Path
                            d={describeDonutArc(cx, cy, innerR, outerR, startAngle, endAngle)}
                            fill="#F1F5F9"
                            stroke="#E2E8F0"
                            strokeWidth={0.5}
                          />
                          {/* Sector Progress Fill */}
                          {t.avancement > 0 && (
                            <Path
                              d={describeDonutArc(cx, cy, innerR, outerR, startAngle, fillEndAngle)}
                              fill={t.color}
                            />
                          )}
                        </React.Fragment>
                      );
                    })}

                    {/* Centre du Donut : Pourcentage officiel consolidé */}
                    <SvgText
                      x={cx}
                      y={cy - 2}
                      textAnchor="middle"
                      fontSize="22"
                      fontWeight="bold"
                      fill={Palette.text}
                    >
                      {avancementPct}%
                    </SvgText>
                    <SvgText
                      x={cx}
                      y={cy + 13}
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="600"
                      fill={Palette.textMuted}
                    >
                      Consolidé
                    </SvgText>
                  </Svg>

                  {/* Légende compacte en ligne : T1 100% · T2 0% · T3 0% · T4 0% */}
                  <View style={styles.donutLegendInline}>
                    {indexedTroncons.map((t, idx) => (
                      <View key={`legend-${t.id}`} style={styles.donutLegendInlineItem}>
                        <View style={[styles.donutLegendDot, { backgroundColor: t.color }]} />
                        <Text style={styles.donutLegendText}>
                          {t.code} <Text weight="bold">{t.avancement}%</Text>
                        </Text>
                        {idx < indexedTroncons.length - 1 && (
                          <Text style={styles.donutLegendSep}>·</Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </Card>

            {/* ── 4. État des tronçons (Synthèse horizontale compacte) ── */}
            <Card variant="elevated" style={styles.statusSummaryCompactCard}>
              <Text style={styles.statusSummaryCompactTitle} weight="semibold">
                État des tronçons
              </Text>
              <View style={styles.statusSummaryStrip}>
                <View style={styles.statusSummaryChip}>
                  <View style={[styles.statusDot, { backgroundColor: '#16A34A' }]} />
                  <Text style={styles.statusSummaryText}>
                    <Text weight="bold" style={{ color: '#15803D' }}>{countTermines}</Text> Terminé{countTermines > 1 ? 's' : ''}
                  </Text>
                </View>

                <Text style={styles.statusStripDot}>·</Text>

                <View style={styles.statusSummaryChip}>
                  <View style={[styles.statusDot, { backgroundColor: '#2563EB' }]} />
                  <Text style={styles.statusSummaryText}>
                    <Text weight="bold" style={{ color: '#1D4ED8' }}>{countEnCours}</Text> En cours
                  </Text>
                </View>

                <Text style={styles.statusStripDot}>·</Text>

                <View style={styles.statusSummaryChip}>
                  <View style={[styles.statusDot, { backgroundColor: '#94A3B8' }]} />
                  <Text style={styles.statusSummaryText}>
                    <Text weight="bold" style={{ color: '#64748B' }}>{countNonCommence}</Text> Non commencé{countNonCommence > 1 ? 's' : ''}
                  </Text>
                </View>

                {countProbleme > 0 && (
                  <>
                    <Text style={styles.statusStripDot}>·</Text>
                    <View style={styles.statusSummaryChip}>
                      <View style={[styles.statusDot, { backgroundColor: '#DC2626' }]} />
                      <Text style={styles.statusSummaryText}>
                        <Text weight="bold" style={{ color: '#B91C1C' }}>{countProbleme}</Text> Problème{countProbleme > 1 ? 's' : ''}
                      </Text>
                    </View>
                  </>
                )}
              </View>
            </Card>

            {/* ── 5. Activité terrain (Une seule carte compacte) ── */}
            <Card variant="elevated" style={styles.activityCompactCard}>
              <View style={styles.activityCompactHeader}>
                <Ionicons name="analytics-outline" size={15} color={Palette.primary} />
                <Text style={styles.activityCompactTitle} weight="semibold">
                  Activité terrain
                </Text>
              </View>

              <View style={styles.activityCompactRow}>
                {/* Jours avec relevés */}
                <View style={styles.activityCol}>
                  <Text style={styles.activityColValue} weight="bold">
                    {stats.jours_avec_releves}
                  </Text>
                  <Text style={styles.activityColLabel}>
                    jour{stats.jours_avec_releves > 1 ? 's' : ''} avec relevé{stats.jours_avec_releves > 1 ? 's' : ''}
                  </Text>
                </View>

                <View style={styles.activityDivider} />

                {/* Dernier relevé */}
                <View style={styles.activityCol}>
                  <Text style={styles.activityColValue} weight="bold" numberOfLines={1}>
                    {stats.dernier_releve_label || 'Aucun relevé'}
                  </Text>
                  <Text style={styles.activityColLabel}>
                    Dernier relevé
                  </Text>
                </View>

                <View style={styles.activityDivider} />

                {/* Tronçons suivis */}
                <View style={styles.activityCol}>
                  <Text style={styles.activityColValue} weight="bold">
                    {tronconsSuivisCount} / {N}
                  </Text>
                  <Text style={styles.activityColLabel}>
                    tronçons suivis
                  </Text>
                </View>
              </View>
            </Card>

            {/* ── 6. À surveiller (Conteneur unique avec rangées compactes) ── */}
            <Card variant="elevated" style={styles.watchCompactCard}>
              <View style={styles.watchHeaderRow}>
                <Ionicons name="warning-outline" size={15} color="#D97706" />
                <Text style={styles.watchHeaderTitle} weight="semibold">
                  À surveiller {watchList.length > 0 ? `(${watchList.length})` : ''}
                </Text>
              </View>

              {watchList.length === 0 ? (
                <View style={styles.watchEmptyRow}>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#15803D" />
                  <Text style={styles.watchEmptyText}>
                    Tous les tronçons sont suivis normalement
                  </Text>
                </View>
              ) : (
                <View style={styles.watchRowsContainer}>
                  {watchList.map((item, idx) => {
                    const isLast = idx === watchList.length - 1;
                    return (
                      <TouchableOpacity
                        key={`watch-${item.troncon.id}`}
                        activeOpacity={0.7}
                        style={[styles.watchRowItem, !isLast && styles.watchRowBorder]}
                        onPress={() => router.push(`/responsable/troncon/${item.troncon.id}`)}
                      >
                        <View style={styles.watchRowLeft}>
                          <Ionicons name="alert-circle-outline" size={15} color="#D97706" style={{ marginTop: 1 }} />
                          <View style={styles.watchRowTextCol}>
                            <Text style={styles.watchTronconCode} weight="semibold">
                              {item.troncon.nom || item.troncon.code}
                            </Text>
                            {item.issues.map((issue, issueIdx) => (
                              <Text key={`issue-${issueIdx}`} style={styles.watchIssueDesc}>
                                {issue}
                              </Text>
                            ))}
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={Palette.textLight} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </Card>

            {/* ── 7. Map CTA Button ── */}
            <Pressable
              style={({ pressed }) => [
                styles.mapCtaButton,
                pressed && styles.mapCtaButtonPressed,
              ]}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/map',
                  params: {
                    chantierId: String(id),
                  },
                } as any)
              }
            >
              <Ionicons name="map-outline" size={19} color="#FFFFFF" />
              <Text style={styles.mapCtaButtonText} weight="bold">
                Voir les tronçons sur la carte
              </Text>
            </Pressable>
          </View>
        )}


        {/* ══════════════ TAB 2: HISTORIQUE / JOURNAL OPÉRATIONNEL ══════════════ */}
        {activeTab === 'historique' && (
          <View style={styles.tabSection}>
            {/* 1. Compact Date Selection Bar with Floating Circular Calendar Button */}
            <Card variant="elevated" style={styles.dateSelectorCard}>
              <TouchableOpacity
                style={styles.dateSelectorMain}
                activeOpacity={0.7}
                onPress={() => setIsCalendarModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir le calendrier mensuel"
              >
                <View style={styles.dateSelectorIconBox}>
                  <Ionicons name="calendar-outline" size={20} color={Palette.primary} />
                </View>
                <View style={styles.dateSelectorTextWrap}>
                  <Text style={styles.dateSelectorSublabel}>DATE SÉLECTIONNÉE</Text>
                  <Text style={styles.dateSelectorDateText} weight="bold">
                    {formatDateBarFrench(selectedDate) || selectedDate}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.floatingCalendarBtn}
                activeOpacity={0.7}
                onPress={() => setIsCalendarModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir le calendrier mensuel"
              >
                <Ionicons name="calendar" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </Card>

            {/* Loading Indicator for Journal */}
            {isJournalLoading && !journalData && (
              <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={Palette.primary} />
                <Text variant="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Chargement des données du journal...
                </Text>
              </View>
            )}

            {/* Error & Retry for Journal */}
            {journalError && !journalData && !isJournalLoading && (
              <Card variant="elevated" style={[styles.errorCard, { marginVertical: 12 }]}>
                <Ionicons name="cloud-offline-outline" size={32} color={Palette.alert} />
                <Text variant="error" style={styles.errorText}>
                  {journalError}
                </Text>
                <TouchableOpacity onPress={() => fetchJournal(selectedMonth)} style={styles.retryBtn}>
                  <Text style={styles.retryBtnText} weight="semibold">
                    Réessayer
                  </Text>
                </TouchableOpacity>
              </Card>
            )}

            {/* 2. Monthly Statistics Preview (Single compact horizontal row of 4 equal blocks - Requirements 1, 2, 3, 4) */}
            {journalData && (
              <View style={styles.statsPreviewContainer}>
                {/* ONE compact horizontal row: [ Avec relevés | Sans relevé | Non travaillés | Absences A.T. ] */}
                <View style={styles.statsFourRow}>
                  {/* Block 1: Avec relevés (Green) */}
                  <TouchableOpacity
                    style={[
                      styles.statColCard,
                      { backgroundColor: '#F0FDF4', borderColor: '#DCFCE7' },
                      activeStatFilter === 'ACTIVITE' && styles.statColCardActive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      const next = activeStatFilter === 'ACTIVITE' ? null : 'ACTIVITE';
                      setActiveStatFilter(next);
                      if (next) setIsCalendarModalVisible(true);
                    }}
                  >
                    <Ionicons name="checkmark-circle-outline" size={13} color="#16A34A" />
                    <Text style={[styles.statNumberCompact, { color: '#16A34A' }]} weight="bold">
                      {journalData.summary.jours_avec_activite} j
                    </Text>
                    <Text style={styles.statLabelCompact} numberOfLines={2}>
                      Avec relevés
                    </Text>
                  </TouchableOpacity>

                  {/* Block 2: Sans relevé (Red/Orange) */}
                  <TouchableOpacity
                    style={[
                      styles.statColCard,
                      { backgroundColor: '#FEF2F2', borderColor: '#FEE2E2' },
                      activeStatFilter === 'SANS_RELEVE' && styles.statColCardActive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      const next = activeStatFilter === 'SANS_RELEVE' ? null : 'SANS_RELEVE';
                      setActiveStatFilter(next);
                      if (next) setIsCalendarModalVisible(true);
                    }}
                  >
                    <Ionicons name="alert-circle-outline" size={13} color="#DC2626" />
                    <Text style={[styles.statNumberCompact, { color: '#DC2626' }]} weight="bold">
                      {journalData.summary.jours_sans_releve} j
                    </Text>
                    <Text style={styles.statLabelCompact} numberOfLines={2}>
                      Sans relevé
                    </Text>
                  </TouchableOpacity>

                  {/* Block 3: Non travaillés (Neutral Grey) */}
                  <TouchableOpacity
                    style={[
                      styles.statColCard,
                      { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' },
                      activeStatFilter === 'NON_TRAVAILLE' && styles.statColCardActive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      const next = activeStatFilter === 'NON_TRAVAILLE' ? null : 'NON_TRAVAILLE';
                      setActiveStatFilter(next);
                      if (next) setIsCalendarModalVisible(true);
                    }}
                  >
                    <Ionicons name="pause-circle-outline" size={13} color="#64748B" />
                    <Text style={[styles.statNumberCompact, { color: '#64748B' }]} weight="bold">
                      {journalData.summary.jours_feries_chomes} j
                    </Text>
                    <Text style={styles.statLabelCompact} numberOfLines={2}>
                      Non travaillés
                    </Text>
                  </TouchableOpacity>

                  {/* Block 4: Absences A.T. déclarées (Blue - Requirement 2) */}
                  <TouchableOpacity
                    style={[
                      styles.statColCard,
                      { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE' },
                      activeStatFilter === 'ABSENCE' && styles.statColCardActive,
                    ]}
                    activeOpacity={0.7}
                    onPress={() => {
                      const next = activeStatFilter === 'ABSENCE' ? null : 'ABSENCE';
                      setActiveStatFilter(next);
                      if (next) setIsCalendarModalVisible(true);
                    }}
                  >
                    <Ionicons name="person-remove-outline" size={13} color="#2563EB" />
                    <Text style={[styles.statNumberCompact, { color: '#2563EB' }]} weight="bold">
                      {journalData.summary.jours_absence_agent} j
                    </Text>
                    <Text style={styles.statLabelCompact} numberOfLines={2}>
                      Absences A.T.
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Requirement 3: Pending Explanations Block directly below the 4 statistics */}
                <Pressable
                  style={[
                    styles.pendingExplanationsActionRow,
                    journalData.summary.demandes_en_attente > 0
                      ? styles.pendingExplanationsWarning
                      : styles.pendingExplanationsNeutral,
                  ]}
                  onPress={() => setIsPendingExplanationsModalVisible(true)}
                  accessibilityRole="button"
                >
                  <View style={styles.pendingActionRowLeft}>
                    <Ionicons
                      name="time-outline"
                      size={16}
                      color={journalData.summary.demandes_en_attente > 0 ? '#D97706' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.pendingExplanationsActionText,
                        { color: journalData.summary.demandes_en_attente > 0 ? '#B45309' : '#64748B' },
                      ]}
                      weight="semibold"
                    >
                      {journalData.summary.demandes_en_attente > 0
                        ? `${journalData.summary.demandes_en_attente} explication${
                            journalData.summary.demandes_en_attente > 1 ? 's' : ''
                          } en attente`
                        : 'Aucune explication en attente'}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={journalData.summary.demandes_en_attente > 0 ? '#D97706' : '#94A3B8'}
                  />
                </Pressable>

                {/* Requirement 4: Restore the A.T. contact action directly below pending explanations */}
                <TouchableOpacity
                  style={styles.fullWidthContactAtBtn}
                  activeOpacity={0.8}
                  onPress={openContextualContactModal}
                  accessibilityRole="button"
                  accessibilityLabel="Contacter les agents de terrain"
                >
                  <Ionicons name="chatbubbles-outline" size={18} color="#FFFFFF" />
                  <Text style={styles.fullWidthContactAtBtnText} weight="semibold">
                    Contacter les A.T.
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            )}

            {/* 3. Selected Day Inspector Card */}
            {activeDay && (
              <Card variant="elevated" style={styles.dayInspectorCard}>
                {/* Header with full French date & consolidated status pill */}
                <View style={styles.dayInspectorHeader}>
                  <View style={{ flex: 1 }}>
                    <Text variant="h3" style={styles.dayInspectorTitle} weight="bold">
                      {formatFullDateFrench(activeDay.date)}
                    </Text>
                    <Text style={styles.dayInspectorDateMeta}>
                      {activeDay.is_today
                        ? "Aujourd'hui"
                        : activeDay.is_future
                        ? 'Date future'
                        : activeDay.ferie_nom
                        ? `Jour férié — ${activeDay.ferie_nom}`
                        : "Jour d'opération"}
                    </Text>
                  </View>

                  {(() => {
                    const statusMeta = getDayStatusMeta(activeDay.statut_jour);
                    const labelText = activeDay.ferie_nom ? activeDay.ferie_nom : statusMeta.label;
                    return (
                      <View style={[styles.dayInspectorStatusPill, { backgroundColor: statusMeta.bg }]}>
                        <Ionicons name={statusMeta.icon} size={14} color={statusMeta.color} />
                        <Text style={[styles.dayInspectorStatusPillText, { color: statusMeta.color }]} weight="semibold" numberOfLines={1}>
                          {labelText}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Day Consolidated Progress & Relevés Count */}
                <View style={styles.dayMetricsBox}>
                  <View style={styles.dayMetricsTopRow}>
                    <View>
                      <Text style={styles.dayProgressBigText} weight="bold">
                        {activeDay.consolidated_progress}%
                      </Text>
                      <Text style={styles.dayProgressSubtitle}>
                        Progression consolidée faisant foi
                      </Text>
                    </View>

                    <View style={styles.dayObsCountBadge}>
                      <Text style={styles.dayObsCountText} weight="semibold">
                        {activeDay.observations_count} relevé{activeDay.observations_count > 1 ? 's' : ''}
                      </Text>
                    </View>
                  </View>

                  {/* Progress Bar */}
                  <View style={styles.dayProgressBarTrack}>
                    <View
                      style={[
                        styles.dayProgressBarFill,
                        { width: `${Math.min(100, Math.max(0, activeDay.consolidated_progress))}%` },
                      ]}
                    />
                  </View>

                  {/* Contextual Link to Photos du Jour (if observations exist on this date) */}
                  {activeDay.observations_count > 0 && (
                    <TouchableOpacity
                      style={styles.dayViewPhotosBtn}
                      activeOpacity={0.8}
                      onPress={() => router.push(`/chantier/images/${id}?tab=terrain&date=${activeDay.date}` as any)}
                    >
                      <Ionicons name="images-outline" size={15} color={Palette.primary} />
                      <Text style={styles.dayViewPhotosBtnText} weight="semibold">
                        Voir les photos du jour ({activeDay.observations_count}) →
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Intelligent Contextual A.T. Contact Card for Missing Reports */}
                {(() => {
                  const missingTroncons = activeDay.troncons.filter(
                    (t) => t.statut === 'SANS_RELEVE' && !activeDay.is_future && !activeDay.is_non_travaille
                  );
                  if (missingTroncons.length === 0) return null;

                  const missingWithAgent = missingTroncons.filter((t) => Boolean(t.agent_id));
                  const missingWithoutAgent = missingTroncons.filter((t) => !t.agent_id);
                  const eligibleToContact = missingWithAgent.filter(
                    (t) => !t.demande_explication || t.demande_explication.statut === 'REFUSEE'
                  );
                  const pendingCount = missingWithAgent.filter(
                    (t) => t.demande_explication && t.demande_explication.statut === 'EN_ATTENTE'
                  ).length;

                  return (
                    <View style={styles.missingReportContextCard}>
                      <View style={styles.missingReportContextTop}>
                        <Ionicons name="alert-circle" size={17} color="#DC2626" />
                        <Text style={styles.missingReportContextTitle} weight="bold">
                          {missingTroncons.length} tronçon{missingTroncons.length > 1 ? 's' : ''} sans relevé
                        </Text>
                      </View>

                      {eligibleToContact.length > 0 && (
                        <TouchableOpacity
                          style={styles.contactAtButton}
                          activeOpacity={0.7}
                          onPress={openContextualContactModal}
                        >
                          <Ionicons name="chatbubbles" size={15} color="#FFFFFF" />
                          <Text style={styles.contactAtButtonText} weight="semibold">
                            {eligibleToContact.length === 1
                              ? `Contacter l'A.T. (${eligibleToContact[0].agent_nom || 'assigné'})`
                              : `Contacter les A.T.`}
                          </Text>
                        </TouchableOpacity>
                      )}

                      {pendingCount > 0 && eligibleToContact.length === 0 && (
                        <TouchableOpacity
                          style={styles.pendingExplanationsNotice}
                          onPress={() => setIsPendingExplanationsModalVisible(true)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="time" size={13} color="#D97706" />
                          <Text style={styles.pendingExplanationsNoticeText}>
                            Demande d'explication déjà transmise à l'agent ›
                          </Text>
                        </TouchableOpacity>
                      )}

                      {missingWithoutAgent.length > 0 && eligibleToContact.length === 0 && pendingCount === 0 && (
                        <Text style={styles.unassignedNoticeText}>
                          Aucun agent de terrain n'est affecté à ces tronçons.
                        </Text>
                      )}
                    </View>
                  );
                })()}

                {/* Tronçons Breakdown (Detailed for observed, compact rows for missing) */}
                <View style={styles.dayTronconsSection}>
                  <Text style={styles.dayTronconsSectionTitle} weight="bold">
                    Relevés et activité par tronçon
                  </Text>

                  {activeDay.troncons.map((t, tIdx) => {
                    const tStatusMeta = getTronconStatusMeta(t.statut);
                    const tronconColor = TRONCON_COLORS[tIdx % TRONCON_COLORS.length];
                    const hasObservations = t.observations && t.observations.length > 0;

                    // Rich card when observations exist
                    if (hasObservations) {
                      return (
                        <View key={t.troncon_id} style={styles.dayTronconCard}>
                          <View style={styles.dayTronconTopRow}>
                            <View style={styles.dayTronconLeftMeta}>
                              <View style={[styles.dayTronconCodeBadge, { backgroundColor: tronconColor }]}>
                                <Text style={styles.dayTronconCodeText} weight="bold">
                                  {t.code}
                                </Text>
                              </View>
                              <Text style={styles.dayTronconNom} weight="semibold" numberOfLines={1}>
                                {t.nom}
                              </Text>
                            </View>

                            <View style={[styles.dayTronconStatusBadge, { backgroundColor: tStatusMeta.bg }]}>
                              <Text style={[styles.dayTronconStatusBadgeText, { color: tStatusMeta.color }]} weight="semibold">
                                {tStatusMeta.label}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.dayTronconDetailsRow}>
                            <View style={styles.dayTronconAgentInfo}>
                              <Ionicons name="person-outline" size={13} color={Palette.textLight} />
                              <Text style={styles.dayTronconAgentText}>
                                {t.agent_nom || 'Non affecté'}
                              </Text>
                            </View>

                            <Text style={styles.dayTronconProgText} weight="semibold">
                              Faisant foi : {t.avancement}% ({t.planned_meters} m)
                            </Text>
                          </View>

                          {/* Observations detail snippets */}
                          <View style={{ marginTop: 4, gap: 4 }}>
                            {(t.observations || []).map((obs) => (
                              <View key={obs.id} style={styles.tronconObsSnippetBox}>
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                                  <Text style={{ fontSize: 11, color: Palette.textMuted }}>
                                    À {obs.heure_str} • Par {obs.agent_nom || t.agent_nom}
                                  </Text>
                                  <Text style={{ fontSize: 11, color: Palette.primary }} weight="bold">
                                    {obs.progress_percentage}%
                                  </Text>
                                </View>
                                {Boolean(obs.commentaire) && (
                                  <Text style={{ fontSize: 11, color: Palette.text, fontStyle: 'italic' }}>
                                    « {obs.commentaire} »
                                  </Text>
                                )}
                                {obs.photo_count > 0 && (
                                  <Text style={{ fontSize: 10, color: Palette.textLight }}>
                                    📸 {obs.photo_count} photo{obs.photo_count > 1 ? 's' : ''} associée{obs.photo_count > 1 ? 's' : ''}
                                  </Text>
                                )}
                              </View>
                            ))}
                          </View>
                        </View>
                      );
                    }

                    // Compact row when no observation
                    return (
                      <View key={t.troncon_id} style={styles.compactTronconRow}>
                        <View style={styles.compactTronconLeft}>
                          <View style={[styles.dayTronconCodeBadge, { backgroundColor: tronconColor }]}>
                            <Text style={styles.dayTronconCodeText} weight="bold">
                              {t.code}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.compactTronconNom} weight="semibold" numberOfLines={1}>
                              {t.nom}
                            </Text>
                            <Text style={styles.compactTronconAgent} numberOfLines={1}>
                              {t.agent_id ? t.agent_nom : 'Aucun A.T. affecté'}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.compactTronconRight}>
                          {t.statut === 'SANS_RELEVE' ? (
                            t.demande_explication ? (
                              t.demande_explication.statut === 'EN_ATTENTE' ? (
                                <View style={[styles.journalStatusPill, { backgroundColor: '#FFFBEB' }]}>
                                  <Ionicons name="time" size={11} color="#D97706" />
                                  <Text style={[styles.journalStatusPillText, { color: '#B45309' }]} weight="semibold">
                                    En attente
                                  </Text>
                                </View>
                              ) : (
                                <View style={[styles.journalStatusPill, { backgroundColor: '#F0FDF4' }]}>
                                  <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                                  <Text style={[styles.journalStatusPillText, { color: '#15803D' }]} weight="semibold">
                                    Explication reçue
                                  </Text>
                                </View>
                              )
                            ) : t.agent_id ? (
                              <TouchableOpacity
                                style={styles.compactRequestBtn}
                                activeOpacity={0.7}
                                onPress={() => openJustificationModal(t, activeDay.date)}
                              >
                                <Ionicons name="mail" size={12} color={Palette.primary} />
                                <Text style={styles.compactRequestBtnText} weight="semibold">
                                  Demander
                                </Text>
                              </TouchableOpacity>
                            ) : (
                              <View style={[styles.journalStatusPill, { backgroundColor: '#F1F5F9' }]}>
                                <Text style={[styles.journalStatusPillText, { color: '#64748B' }]}>
                                  Sans relevé
                                </Text>
                              </View>
                            )
                          ) : t.statut === 'ABSENCE_AGENT' ? (
                            <View style={[styles.journalStatusPill, { backgroundColor: '#EFF6FF' }]}>
                              <Ionicons name="person-remove" size={11} color="#2563EB" />
                              <Text style={[styles.journalStatusPillText, { color: '#1D4ED8' }]} weight="semibold">
                                Absence
                              </Text>
                            </View>
                          ) : (
                            <View style={[styles.journalStatusPill, { backgroundColor: tStatusMeta.bg }]}>
                              <Text style={[styles.journalStatusPillText, { color: tStatusMeta.color }]} weight="semibold">
                                {tStatusMeta.label}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* 5. Daily Consolidated S-Curve Card */}
            <Card variant="elevated" style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <View>
                  <Text variant="h3" style={styles.chartTitle}>
                    Courbe d'avancement continu
                  </Text>
                  <Text style={styles.chartSubtitle}>
                    Maintien des paliers d'avancement officiel sans régression
                  </Text>
                </View>
              </View>

              {activePoints.length === 0 ? (
                <View style={styles.emptyChartBox}>
                  <Ionicons name="calendar-outline" size={36} color={Palette.textLight} />
                  <Text style={styles.emptyChartTitle} weight="semibold">
                    Aucun historique d'avancement
                  </Text>
                  <Text style={styles.emptyChartSubtitle}>
                    Les relevés de terrain enregistrés par les agents permettront de tracer la courbe d'avancement quotidien.
                  </Text>
                </View>
              ) : (
                <>
                  <View style={styles.svgContainer}>
                    <Svg width="100%" height={svgChartHeight} viewBox={`0 0 ${svgChartWidth} ${svgChartHeight}`}>
                      <Defs>
                        <LinearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <Stop offset="0%" stopColor="#176B5B" stopOpacity="0.18" />
                          <Stop offset="100%" stopColor="#176B5B" stopOpacity="0.01" />
                        </LinearGradient>
                      </Defs>

                      {/* Cleaner, subtler Gridlines & Y-Axis Percentage Labels */}
                      {yLevels.map((lvl) => {
                        const y = paddingTop + (1 - lvl / 100) * plotHeight;
                        return (
                          <React.Fragment key={`grid-${lvl}`}>
                            <Line
                              x1={paddingLeft}
                              y1={y}
                              x2={svgChartWidth - paddingRight}
                              y2={y}
                              stroke="#F1F5F9"
                              strokeWidth="1"
                              strokeDasharray={lvl === 0 ? undefined : '3,3'}
                            />
                            <SvgText
                              x={paddingLeft - 6}
                              y={y + 3.5}
                              fill="#9CA3AF"
                              fontSize="9"
                              textAnchor="end"
                              fontWeight="500"
                            >
                              {lvl}%
                            </SvgText>
                          </React.Fragment>
                        );
                      })}

                      {/* Area Fill */}
                      {chartCoords.length > 1 && (
                        <Path d={areaPathD} fill="url(#chartAreaGrad)" />
                      )}

                      {/* Connecting Line - thicker & refined */}
                      {chartCoords.length > 1 && (
                        <Path
                          d={linePathD}
                          fill="none"
                          stroke={Palette.primary}
                          strokeWidth="3.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}

                      {/* Data Points */}
                      {chartCoords.map((pt, idx) => {
                        if (pt.is_synthetic_baseline) {
                          return (
                            <React.Fragment key={`pt-${idx}`}>
                              <Circle
                                cx={pt.x}
                                cy={pt.y}
                                r={5}
                                fill="#FFFFFF"
                                stroke="#64748B"
                                strokeWidth="1.5"
                                strokeDasharray="3,2"
                              />
                              <Circle cx={pt.x} cy={pt.y} r={2} fill="#64748B" />
                            </React.Fragment>
                          );
                        }

                        const isPtSelected = pt.date === selectedDate;

                        return (
                          <React.Fragment key={`pt-${idx}`}>
                            <Circle
                              cx={pt.x}
                              cy={pt.y}
                              r={isPtSelected ? 7 : 4.5}
                              fill="#FFFFFF"
                              stroke={isPtSelected ? '#D97706' : Palette.primary}
                              strokeWidth={isPtSelected ? 3 : 2}
                              onPress={() => setSelectedDate(pt.date)}
                            />
                            <Circle
                              cx={pt.x}
                              cy={pt.y}
                              r={isPtSelected ? 3.5 : 2}
                              fill={isPtSelected ? '#D97706' : Palette.primary}
                            />
                          </React.Fragment>
                        );
                      })}

                      {/* X-Axis Date Labels */}
                      {chartCoords.map((pt, idx) => {
                        if (!pt.monthLabel) return null;
                        return (
                          <SvgText
                            key={`label-${idx}`}
                            x={pt.x}
                            y={svgChartHeight - 12}
                            fill={pt.is_synthetic_baseline ? '#64748B' : Palette.text}
                            fontSize="9"
                            textAnchor="middle"
                            fontWeight={pt.is_synthetic_baseline ? '400' : '600'}
                          >
                            {pt.dayOfMonth}
                          </SvgText>
                        );
                      })}
                    </Svg>
                  </View>

                  {/* Chart Legend */}
                  <View style={styles.chartLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: Palette.primary }]} />
                      <Text style={styles.legendText}>Avancement officiel continu</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: '#D97706' }]} />
                      <Text style={styles.legendText}>Jour sélectionné</Text>
                    </View>
                  </View>
                </>
              )}
            </Card>

          </View>
        )}
      </ScrollView>

      {/* ── Compact Sort Selection Modal ── */}
      <Modal
        visible={isSortModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSortModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsSortModalVisible(false)}
        >
          <View style={styles.sortModalContent}>
            <Text style={styles.sortModalTitle} weight="bold">
              Classer les tronçons
            </Text>

            <TouchableOpacity
              style={[styles.sortModalOption, sortMode === 'pk' && styles.sortModalOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                setSortMode('pk');
                setIsSortModalVisible(false);
              }}
            >
              <Text
                style={[styles.sortModalOptionText, sortMode === 'pk' && styles.sortModalOptionTextActive]}
                weight={sortMode === 'pk' ? 'bold' : 'normal'}
              >
                Ordre PK (naturel)
              </Text>
              {sortMode === 'pk' && <Ionicons name="checkmark" size={18} color={Palette.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sortModalOption, sortMode === 'avancement_desc' && styles.sortModalOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                setSortMode('avancement_desc');
                setIsSortModalVisible(false);
              }}
            >
              <Text
                style={[styles.sortModalOptionText, sortMode === 'avancement_desc' && styles.sortModalOptionTextActive]}
                weight={sortMode === 'avancement_desc' ? 'bold' : 'normal'}
              >
                Avancement ↓ (décroissant)
              </Text>
              {sortMode === 'avancement_desc' && <Ionicons name="checkmark" size={18} color={Palette.primary} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sortModalOption, sortMode === 'avancement_asc' && styles.sortModalOptionActive]}
              activeOpacity={0.7}
              onPress={() => {
                setSortMode('avancement_asc');
                setIsSortModalVisible(false);
              }}
            >
              <Text
                style={[styles.sortModalOptionText, sortMode === 'avancement_asc' && styles.sortModalOptionTextActive]}
                weight={sortMode === 'avancement_asc' ? 'bold' : 'normal'}
              >
                Avancement ↑ (croissant)
              </Text>
              {sortMode === 'avancement_asc' && <Ionicons name="checkmark" size={18} color={Palette.primary} />}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Justification Request Modal ── */}
      <Modal
        visible={justificationModal.visible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setJustificationModal((prev) => ({ ...prev, visible: false }))}
      >
        <Pressable
          style={styles.justifModalBackdrop}
          onPress={() => setJustificationModal((prev) => ({ ...prev, visible: false }))}
        >
          <Pressable style={styles.justifModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.justifModalHeader}>
              <View style={styles.justifModalHeaderIcon}>
                <Ionicons name="chatbox-ellipses-outline" size={22} color={Palette.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" style={styles.justifModalTitle} weight="bold">
                  Demander une explication
                </Text>
                <Text style={styles.justifModalSubtitle}>
                  Notification transmise à l'agent de terrain
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setJustificationModal((prev) => ({ ...prev, visible: false }))}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            {justificationModal.troncon && (
              <View style={styles.justifContextCard}>
                <View style={styles.justifContextRow}>
                  <Text style={styles.justifContextLabel}>Date :</Text>
                  <Text style={styles.justifContextValue} weight="semibold">
                    {formatFullDateFrench(justificationModal.date) || justificationModal.date}
                  </Text>
                </View>
                <View style={styles.justifContextRow}>
                  <Text style={styles.justifContextLabel}>Tronçon :</Text>
                  <Text style={styles.justifContextValue} weight="semibold">
                    {justificationModal.troncon.code} — {justificationModal.troncon.nom}
                  </Text>
                </View>
                <View style={styles.justifContextRow}>
                  <Text style={styles.justifContextLabel}>A.T. :</Text>
                  <Text style={styles.justifContextValue} weight="semibold">
                    {justificationModal.troncon.agent_nom || 'Non renseigné'}
                  </Text>
                </View>
                <View style={styles.justifContextRow}>
                  <Text style={styles.justifContextLabel}>Raison :</Text>
                  <Text style={[styles.justifContextValue, { color: '#DC2626' }]} weight="semibold">
                    Aucun relevé terrain n'a été enregistré pour cette journée.
                  </Text>
                </View>
              </View>
            )}

            <Text style={styles.justifInputLabel} weight="semibold">
              Message optionnel pour l'agent :
            </Text>
            <TextInput
              style={styles.justifTextInput}
              multiline
              numberOfLines={3}
              value={justificationMessage}
              onChangeText={setJustificationMessage}
              placeholder="Précisez un message particulier ou laissez le message par défaut..."
              placeholderTextColor="#94A3B8"
            />

            {justificationError && (
              <Text style={styles.justifErrorText}>{justificationError}</Text>
            )}

            {justificationSuccess && (
              <View style={styles.justifSuccessBox}>
                <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                <Text style={styles.justifSuccessText} weight="semibold">
                  Demande envoyée
                </Text>
              </View>
            )}

            <View style={styles.justifModalActions}>
              <TouchableOpacity
                style={styles.justifCancelBtn}
                onPress={() => setJustificationModal((prev) => ({ ...prev, visible: false }))}
                disabled={isSendingJustification}
              >
                <Text style={styles.justifCancelBtnText}>Annuler</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.justifSubmitBtn, isSendingJustification && { opacity: 0.7 }]}
                onPress={handleSubmitJustification}
                disabled={isSendingJustification || justificationSuccess}
              >
                {isSendingJustification ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="send" size={15} color="#FFFFFF" />
                    <Text style={styles.justifSubmitBtnText} weight="semibold">
                      Envoyer la demande
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Full Month Calendar Overlay Modal (Requirement 3) ── */}
      <Modal
        visible={isCalendarModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsCalendarModalVisible(false)}
      >
        <Pressable
          style={styles.calendarModalBackdrop}
          onPress={() => setIsCalendarModalVisible(false)}
        >
          <Pressable style={styles.calendarModalCard} onPress={(e) => e.stopPropagation()}>
            {/* Calendar Modal Header */}
            <View style={styles.calendarModalHeader}>
              <TouchableOpacity
                style={styles.calendarModalArrowBtn}
                onPress={handlePrevMonth}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Mois précédent"
              >
                <Ionicons name="chevron-back" size={20} color={Palette.primary} />
              </TouchableOpacity>

              <View style={styles.calendarModalTitleBlock}>
                <Text variant="h3" style={styles.calendarModalTitleText} weight="bold">
                  {formatMonthTitle(selectedMonth)}
                </Text>
                {(selectedMonth !== currentMonthStr || selectedDate !== todayStr) && (
                  <TouchableOpacity
                    onPress={() => {
                      handleCurrentMonth();
                      setIsCalendarModalVisible(false);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.calendarModalTodayLink}>Aujourd'hui</Text>
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity
                style={styles.calendarModalArrowBtn}
                onPress={handleNextMonth}
                activeOpacity={0.7}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Mois suivant"
              >
                <Ionicons name="chevron-forward" size={20} color={Palette.primary} />
              </TouchableOpacity>
            </View>

            {/* Active filter pill if filtering from statistics preview */}
            {activeStatFilter && (
              <View style={styles.activeFilterPillRow}>
                <Text style={styles.activeFilterPillText}>
                  Filtre actif : {activeStatFilter === 'ACTIVITE' ? 'Avec relevés' : activeStatFilter === 'SANS_RELEVE' ? 'Sans relevé' : activeStatFilter === 'NON_TRAVAILLE' ? 'Non travaillés' : 'Absences A.T.'}
                </Text>
                <TouchableOpacity
                  onPress={() => setActiveStatFilter(null)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close-circle" size={16} color="#64748B" />
                </TouchableOpacity>
              </View>
            )}

            {/* Weekday Column Headers (Lun - Dim) */}
            <View style={styles.calendarModalWeekDaysRow}>
              {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((dName) => (
                <Text key={dName} style={styles.calendarModalWeekDayLabel} weight="semibold">
                  {dName}
                </Text>
              ))}
            </View>

            {/* Weeks Grid */}
            {calendarWeeks.map((week, wIdx) => (
              <View key={`modal-w-${wIdx}`} style={styles.calendarModalWeekRow}>
                {week.map((day, dIdx) => {
                  if (!day) {
                    return <View key={`m-empty-${wIdx}-${dIdx}`} style={styles.calendarModalDayCell} />;
                  }

                  const isSelected = day.date === selectedDate;
                  const dayMeta = getDayStatusMeta(day.statut_jour);
                  const matchesFilter = !activeStatFilter || isDayMatchingFilter(day, activeStatFilter);

                  return (
                    <TouchableOpacity
                      key={day.date}
                      style={[
                        styles.calendarModalDayCell,
                        isSelected && styles.calendarModalDayCellSelected,
                        day.is_today && !isSelected && styles.calendarModalDayCellToday,
                        !matchesFilter && { opacity: 0.25 },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => {
                        setSelectedDate(day.date);
                        setIsCalendarModalVisible(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.calendarModalDayNumText,
                          isSelected && styles.calendarModalDayNumTextSelected,
                          day.is_today && !isSelected && styles.calendarModalDayNumTextToday,
                          day.is_future && styles.calendarModalDayNumTextFuture,
                        ]}
                        weight={isSelected || day.is_today ? 'bold' : 'normal'}
                      >
                        {day.day_of_month}
                      </Text>

                      {/* Small Subtle Dot underneath (Requirement 3: NOT large colored circles) */}
                      {!day.is_future && (
                        <View
                          style={[
                            styles.calendarModalDotSm,
                            { backgroundColor: isSelected ? '#FFFFFF' : dayMeta.color },
                          ]}
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}

            {/* Compact Legend (Requirement 14: dots, no emojis) */}
            <View style={styles.calendarModalLegend}>
              <View style={styles.legendItemTiny}>
                <View style={[styles.legendDotTiny, { backgroundColor: '#16A34A' }]} />
                <Text style={styles.legendLabelTiny}>Relevé</Text>
              </View>
              <View style={styles.legendItemTiny}>
                <View style={[styles.legendDotTiny, { backgroundColor: '#DC2626' }]} />
                <Text style={styles.legendLabelTiny}>Sans relevé</Text>
              </View>
              <View style={styles.legendItemTiny}>
                <View style={[styles.legendDotTiny, { backgroundColor: '#2563EB' }]} />
                <Text style={styles.legendLabelTiny}>Absence A.T.</Text>
              </View>
              <View style={styles.legendItemTiny}>
                <View style={[styles.legendDotTiny, { backgroundColor: '#64748B' }]} />
                <Text style={styles.legendLabelTiny}>Non travaillé</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Contextual Multi-Tronçon A.T. Contact Modal (Requirements 4, 8, 9) ── */}
      <Modal
        visible={isContextualContactModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsContextualContactModalVisible(false)}
      >
        <Pressable
          style={styles.justifModalBackdrop}
          onPress={() => setIsContextualContactModalVisible(false)}
        >
          <Pressable style={styles.justifModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.justifModalHeader}>
              <View style={styles.justifModalHeaderIcon}>
                <Ionicons name="chatbubbles" size={22} color={Palette.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" style={styles.justifModalTitle} weight="bold">
                  Contacter les A.T.
                </Text>
                <Text style={styles.justifModalSubtitle}>
                  {activeDay ? formatFullDateFrench(activeDay.date) : selectedDate}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsContextualContactModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {/* List of affected tronçons for this date */}
              <Text style={styles.contextualSectionTitle} weight="semibold">
                Tronçons concernés par l'absence de relevé :
              </Text>

              {(() => {
                const missingTroncons = activeDay
                  ? activeDay.troncons.filter(
                      (t) => t.statut === 'SANS_RELEVE' && !activeDay.is_future && !activeDay.is_non_travaille
                    )
                  : [];

                if (missingTroncons.length === 0) {
                  return (
                    <View style={styles.contextualEmptyBox}>
                      <Ionicons name="checkmark-circle-outline" size={28} color="#16A34A" />
                      <Text style={styles.contextualEmptyText} weight="semibold">
                        Tous les relevés terrain sont à jour pour cette journée.
                      </Text>
                    </View>
                  );
                }

                return (
                  <View style={{ gap: 8, marginTop: 6, marginBottom: 12 }}>
                    {missingTroncons.map((t, idx) => {
                      const tColor = TRONCON_COLORS[idx % TRONCON_COLORS.length];
                      const hasAgent = Boolean(t.agent_id);
                      const isPending = Boolean(t.demande_explication && t.demande_explication.statut === 'EN_ATTENTE');
                      const isResponded = Boolean(t.demande_explication && t.demande_explication.statut === 'REPONDUE');
                      const isEligible = hasAgent && !isPending && !isResponded;
                      const isSelected = selectedTronconIdsForContact.includes(t.troncon_id);

                      return (
                        <Pressable
                          key={t.troncon_id}
                          style={[
                            styles.contextualTronconRow,
                            isEligible && isSelected && styles.contextualTronconRowSelected,
                            !hasAgent && styles.contextualTronconRowDisabled,
                          ]}
                          onPress={() => {
                            if (isEligible) {
                              handleToggleTronconContactSelection(t.troncon_id);
                            }
                          }}
                        >
                          {/* Checkbox or disabled status icon */}
                          {isEligible ? (
                            <View
                              style={[
                                styles.checkboxCircle,
                                isSelected && styles.checkboxCircleChecked,
                              ]}
                            >
                              {isSelected && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                            </View>
                          ) : (
                            <View style={styles.checkboxCircleDisabled}>
                              <Ionicons
                                name={hasAgent ? 'lock-closed-outline' : 'person-remove-outline'}
                                size={12}
                                color="#94A3B8"
                              />
                            </View>
                          )}

                          <View style={[styles.dayTronconCodeBadge, { backgroundColor: tColor }]}>
                            <Text style={styles.dayTronconCodeText} weight="bold">
                              {t.code}
                            </Text>
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={styles.contextualTronconNom} weight="semibold" numberOfLines={1}>
                              {t.nom}
                            </Text>
                            <Text style={styles.contextualTronconSub} numberOfLines={1}>
                              {hasAgent ? t.agent_nom : 'Aucun A.T. affecté'}
                            </Text>
                          </View>

                          {/* Status Badge */}
                          {isPending ? (
                            <View style={styles.contextualStatusPendingBadge}>
                              <Ionicons name="time" size={11} color="#D97706" />
                              <Text style={styles.contextualStatusPendingText} weight="semibold">
                                Demande déjà envoyée
                              </Text>
                            </View>
                          ) : isResponded ? (
                            <View style={styles.contextualStatusRespondedBadge}>
                              <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                              <Text style={styles.contextualStatusRespondedText} weight="semibold">
                                Réponse reçue
                              </Text>
                            </View>
                          ) : !hasAgent ? (
                            <View style={styles.contextualStatusDisabledBadge}>
                              <Text style={styles.contextualStatusDisabledText}>
                                Non assigné
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })()}

              {/* Message field if eligible cases exist */}
              {selectedTronconIdsForContact.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={styles.justifInputLabel} weight="semibold">
                    Message transmis aux agents sélectionnés :
                  </Text>
                  <TextInput
                    style={styles.justifTextInput}
                    multiline
                    numberOfLines={3}
                    value={contextualContactMessage}
                    onChangeText={setContextualContactMessage}
                    placeholder="Précisez votre demande d'explication..."
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              )}

              {contextualContactFeedback && (
                <View
                  style={[
                    styles.contextualFeedbackBox,
                    contextualContactFeedback.type === 'success'
                      ? styles.contextualFeedbackSuccess
                      : styles.contextualFeedbackError,
                  ]}
                >
                  <Ionicons
                    name={
                      contextualContactFeedback.type === 'success'
                        ? 'checkmark-circle'
                        : 'alert-circle'
                    }
                    size={16}
                    color={
                      contextualContactFeedback.type === 'success' ? '#16A34A' : '#DC2626'
                    }
                  />
                  <Text
                    style={[
                      styles.contextualFeedbackText,
                      {
                        color:
                          contextualContactFeedback.type === 'success' ? '#16A34A' : '#DC2626',
                      },
                    ]}
                    weight="semibold"
                  >
                    {contextualContactFeedback.message}
                  </Text>
                </View>
              )}
            </ScrollView>

            <View style={styles.justifModalActions}>
              <TouchableOpacity
                style={styles.justifCancelBtn}
                onPress={() => setIsContextualContactModalVisible(false)}
                disabled={isSendingContextualContact}
              >
                <Text style={styles.justifCancelBtnText}>Fermer</Text>
              </TouchableOpacity>

              {selectedTronconIdsForContact.length > 0 && (
                <TouchableOpacity
                  style={[
                    styles.justifSubmitBtn,
                    isSendingContextualContact && { opacity: 0.7 },
                  ]}
                  onPress={handleSubmitContextualContact}
                  disabled={isSendingContextualContact}
                >
                  {isSendingContextualContact ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="send" size={15} color="#FFFFFF" />
                      <Text style={styles.justifSubmitBtnText} weight="semibold">
                        Envoyer les demandes ({selectedTronconIdsForContact.length})
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Pending Explanations Overview Modal (Requirement 3) ── */}
      <Modal
        visible={isPendingExplanationsModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsPendingExplanationsModalVisible(false)}
      >
        <Pressable
          style={styles.justifModalBackdrop}
          onPress={() => setIsPendingExplanationsModalVisible(false)}
        >
          <Pressable style={styles.justifModalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.justifModalHeader}>
              <View style={[styles.justifModalHeaderIcon, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="time-outline" size={22} color="#D97706" />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" style={styles.justifModalTitle} weight="bold">
                  Explications et justifications
                </Text>
                <Text style={styles.justifModalSubtitle}>
                  Demandes d'inactivité pour {formatMonthTitle(selectedMonth)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setIsPendingExplanationsModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={22} color={Palette.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(() => {
                const requestsList: { dayDate: string; troncon: ChantierJournalTronconDay; demande: any }[] = [];
                if (journalData && Array.isArray(journalData.days)) {
                  for (const d of journalData.days) {
                    for (const t of d.troncons) {
                      if (t.demande_explication) {
                        requestsList.push({
                          dayDate: d.date,
                          troncon: t,
                          demande: t.demande_explication,
                        });
                      }
                    }
                  }
                }

                if (requestsList.length === 0) {
                  return (
                    <View style={styles.contextualEmptyBox}>
                      <Ionicons name="checkmark-done-circle-outline" size={32} color="#16A34A" />
                      <Text style={styles.contextualEmptyText} weight="semibold">
                        Aucune demande d'explication enregistrée pour ce mois.
                      </Text>
                    </View>
                  );
                }

                return (
                  <View style={{ gap: 10, marginTop: 8, marginBottom: 12 }}>
                    {requestsList.map((item, idx) => {
                      const isRepondu = item.demande.statut === 'REPONDUE';
                      return (
                        <TouchableOpacity
                          key={`req-${idx}`}
                          style={styles.pendingRequestCard}
                          activeOpacity={0.8}
                          onPress={() => {
                            setSelectedDate(item.dayDate);
                            setIsPendingExplanationsModalVisible(false);
                          }}
                        >
                          <View style={styles.pendingRequestTopRow}>
                            <View style={styles.pendingRequestMetaLeft}>
                              <Text style={styles.pendingRequestDate} weight="bold">
                                {formatFullDateFrench(item.dayDate)}
                              </Text>
                              <Text style={styles.pendingRequestTroncon}>
                                {item.troncon.code} — {item.troncon.nom} ({item.troncon.agent_nom || 'A.T.'})
                              </Text>
                            </View>

                            <View
                              style={[
                                styles.pendingRequestPill,
                                { backgroundColor: isRepondu ? '#DCFCE7' : '#FEF3C7' },
                              ]}
                            >
                              <Ionicons
                                name={isRepondu ? 'checkmark-circle' : 'time'}
                                size={12}
                                color={isRepondu ? '#15803D' : '#B45309'}
                              />
                              <Text
                                style={[
                                  styles.pendingRequestPillText,
                                  { color: isRepondu ? '#15803D' : '#B45309' },
                                ]}
                                weight="semibold"
                              >
                                {isRepondu ? 'Répondue' : 'En attente'}
                              </Text>
                            </View>
                          </View>

                          {isRepondu && item.demande.motif_agent && (
                            <View style={styles.pendingResponseBox}>
                              <Text style={styles.pendingResponseMotif} weight="bold">
                                Motif : {item.demande.motif_agent}
                              </Text>
                              {Boolean(item.demande.reponse_agent) && (
                                <Text style={styles.pendingResponseDetail}>
                                  « {item.demande.reponse_agent} »
                                </Text>
                              )}
                            </View>
                          )}

                          <View style={styles.pendingRequestFooter}>
                            <Text style={styles.pendingRequestJumpText}>
                              Voir cette journée dans le journal ›
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })()}
            </ScrollView>

            <View style={styles.justifModalActions}>
              <TouchableOpacity
                style={styles.justifCancelBtn}
                onPress={() => setIsPendingExplanationsModalVisible(false)}
              >
                <Text style={styles.justifCancelBtnText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  topNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Palette.background,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 70,
  },
  backButtonText: {
    fontSize: 16,
    color: Palette.primary,
  },
  headerTitle: {
    fontSize: 16,
    color: Palette.text,
    textAlign: 'center',
    fontWeight: '600',
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
    backgroundColor: '#E5EBE8',
    borderRadius: 10,
    padding: 3,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  tabTextActive: {
    color: Palette.primary,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 36,
  },
  tabSection: {
    gap: 14,
  },

  // ── Tab 1: Résumé Styles (Clean, Mobile-Native Dashboard)
  // Section 1: Main "État du chantier" Card
  mainChantierCard: {
    padding: 16,
    borderRadius: 14,
  },
  mainCardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  mainChantierName: {
    fontSize: 16,
    color: Palette.text,
    flex: 1,
    marginRight: 8,
  },
  chantierStatutBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chantierStatutText: {
    fontSize: 11,
    color: '#15803D',
  },
  mainProgressBlock: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 10,
  },
  mainProgressNumber: {
    fontSize: 38,
    color: Palette.primary,
    lineHeight: 44,
  },
  mainProgressMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  mainProgressLabel: {
    fontSize: 13,
    color: Palette.text,
  },
  mainProgressExpl: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  mainProgressBarTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
  },
  mainProgressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  mainCardStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  mainCardStatCol: {
    flex: 1,
    alignItems: 'center',
  },
  mainCardStatValue: {
    fontSize: 14,
    color: Palette.text,
  },
  mainCardStatLabel: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  mainCardStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },

  sectionTitle: {
    fontSize: 16,
    color: Palette.text,
  },

  // Section 2: "Avancement des tronçons" (Compact Rows + Sort Button)
  tronconsSection: {
    gap: 8,
  },
  tronconsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  tronconsTitleCol: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  tronconsSectionTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  tronconsCountSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
  },
  compactSortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  compactSortBtnText: {
    fontSize: 11,
    color: Palette.primary,
  },
  compactTronconsCard: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 0,
  },
  emptyTronconsBox: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  compactRow: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 8,
  },
  compactRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  compactRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  compactIdentityCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  compactCodeBadge: {
    width: 26,
    height: 26,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactCodeText: {
    fontSize: 11,
    color: '#FFFFFF',
  },
  compactTextGroup: {
    flex: 1,
    marginRight: 8,
  },
  compactTronconName: {
    fontSize: 13,
    color: Palette.text,
  },
  compactSubMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  compactAgentText: {
    fontSize: 11,
    color: Palette.textMuted,
    maxWidth: 120,
  },
  compactMetaDot: {
    fontSize: 11,
    color: Palette.textLight,
  },
  compactMetersText: {
    fontSize: 10,
    color: Palette.textMuted,
  },
  compactRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactPctAndStatus: {
    alignItems: 'flex-end',
    gap: 2,
  },
  compactPctText: {
    fontSize: 13,
  },
  compactStatusPill: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  compactStatusText: {
    fontSize: 9,
  },
  compactProgressBarTrack: {
    height: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 2,
    overflow: 'hidden',
  },
  compactProgressBarFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Section 3: "Répartition de l'avancement" (Donut compact à secteurs égaux)
  compactDonutCard: {
    padding: 14,
    alignItems: 'center',
    borderRadius: 14,
  },
  compactDonutHeader: {
    alignItems: 'center',
    marginBottom: 6,
  },
  compactDonutTitle: {
    fontSize: 14,
    color: Palette.text,
    textAlign: 'center',
  },
  compactDonutSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 1,
  },
  compactDonutWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  donutLegendInline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 8,
  },
  donutLegendInlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  donutLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  donutLegendText: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  donutLegendSep: {
    fontSize: 11,
    color: Palette.textLight,
    marginLeft: 2,
  },
  emptyDiagramBox: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 6,
  },
  emptyDiagramText: {
    fontSize: 12,
    color: Palette.textMuted,
  },

  // Section 4: "État des tronçons" (Synthèse horizontale compacte)
  statusSummaryCompactCard: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 6,
    borderRadius: 14,
  },
  statusSummaryCompactTitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusSummaryStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  statusSummaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusSummaryText: {
    fontSize: 12,
    color: Palette.text,
  },
  statusStripDot: {
    fontSize: 12,
    color: Palette.textLight,
  },

  // Section 5: "Activité terrain" (Une seule carte compacte)
  activityCompactCard: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
  },
  activityCompactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityCompactTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  activityCompactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  activityCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  activityColValue: {
    fontSize: 13,
    color: Palette.primary,
    textAlign: 'center',
  },
  activityColLabel: {
    fontSize: 10,
    color: Palette.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  activityDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },

  // Section 6: "À surveiller" (Conteneur unique avec rangées compactes)
  watchCompactCard: {
    padding: 12,
    gap: 8,
    borderRadius: 14,
  },
  watchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  watchHeaderTitle: {
    fontSize: 13,
    color: '#B45309',
  },
  watchEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  watchEmptyText: {
    fontSize: 12,
    color: '#15803D',
  },
  watchRowsContainer: {
    gap: 6,
  },
  watchRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  watchRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  watchRowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  watchRowTextCol: {
    flex: 1,
  },
  watchTronconCode: {
    fontSize: 12,
    color: Palette.text,
  },
  watchIssueDesc: {
    fontSize: 11,
    color: '#B45309',
    marginTop: 1,
  },

  // Section 7: Map CTA Button
  mapCtaButton: {
    backgroundColor: Palette.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  mapCtaButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  mapCtaButtonText: {
    fontSize: 14,
    color: '#FFFFFF',
  },

  // Modal Styles for Sort
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sortModalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 18,
    width: '100%',
    maxWidth: 320,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  sortModalTitle: {
    fontSize: 15,
    color: Palette.text,
    marginBottom: 4,
  },
  sortModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
  },
  sortModalOptionActive: {
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  sortModalOptionText: {
    fontSize: 13,
    color: Palette.text,
  },
  sortModalOptionTextActive: {
    color: Palette.primary,
    fontWeight: 'bold',
  },

  // ── Tab 2: Compact Date Selector Bar (Requirements 2 & 15)
  dateSelectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    borderRadius: 12,
  },
  dateSelectorMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minHeight: 48,
  },
  dateSelectorIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateSelectorTextWrap: {
    gap: 2,
    flex: 1,
  },
  dateSelectorSublabel: {
    fontSize: 9,
    letterSpacing: 0.6,
    color: Palette.textMuted,
    fontWeight: '700',
  },
  dateSelectorDateText: {
    fontSize: 15,
    color: Palette.text,
  },
  floatingCalendarBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#176B5B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    marginLeft: 10,
  },

  // ── Monthly Summary Preview (Single Row of 4 Stats - Requirements 1, 2, 3, 4)
  statsPreviewContainer: {
    gap: 8,
    marginBottom: 10,
  },
  statsFourRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'stretch',
  },
  statColCard: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 62,
    position: 'relative',
  },
  statColCardActive: {
    borderColor: Palette.primary,
    borderWidth: 1.5,
  },
  statNumberCompact: {
    fontSize: 15,
    marginTop: 3,
  },
  statLabelCompact: {
    fontSize: 9.5,
    color: Palette.textMuted,
    marginTop: 2,
    textAlign: 'center',
    lineHeight: 12,
  },
  pendingExplanationsActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  pendingExplanationsWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  pendingExplanationsNeutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  pendingActionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  pendingExplanationsActionText: {
    fontSize: 12,
  },
  fullWidthContactAtBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.primary,
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 16,
    gap: 8,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  fullWidthContactAtBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  // ── Contextual Multi-Tronçon Modal Styles (Requirement 8 & 9)
  contextualSectionTitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginBottom: 8,
  },
  contextualTronconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  contextualTronconRowSelected: {
    borderColor: Palette.primary,
    backgroundColor: '#F0FDFA',
  },
  contextualTronconRowDisabled: {
    backgroundColor: '#F8FAFC',
    opacity: 0.75,
  },
  checkboxCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#94A3B8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxCircleChecked: {
    backgroundColor: Palette.primary,
    borderColor: Palette.primary,
  },
  checkboxCircleDisabled: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextualTronconNom: {
    fontSize: 13,
    color: Palette.text,
  },
  contextualTronconSub: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 1,
  },
  contextualStatusPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  contextualStatusPendingText: {
    fontSize: 10,
    color: '#B45309',
  },
  contextualStatusRespondedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  contextualStatusRespondedText: {
    fontSize: 10,
    color: '#15803D',
  },
  contextualStatusDisabledBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  contextualStatusDisabledText: {
    fontSize: 10,
    color: '#64748B',
  },
  contextualEmptyBox: {
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  contextualEmptyText: {
    fontSize: 13,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  contextualFeedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
  },
  contextualFeedbackSuccess: {
    backgroundColor: '#DCFCE7',
  },
  contextualFeedbackError: {
    backgroundColor: '#FEE2E2',
  },
  contextualFeedbackText: {
    fontSize: 12,
  },

  // ── Pending Explanations Overview Modal Styles (Requirement 3)
  pendingRequestCard: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  pendingRequestTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  pendingRequestMetaLeft: {
    flex: 1,
  },
  pendingRequestDate: {
    fontSize: 13,
    color: Palette.text,
  },
  pendingRequestTroncon: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  pendingRequestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pendingRequestPillText: {
    fontSize: 10,
  },
  pendingResponseBox: {
    backgroundColor: '#F0FDF4',
    padding: 8,
    borderRadius: 6,
    gap: 4,
  },
  pendingResponseMotif: {
    fontSize: 11,
    color: '#15803D',
  },
  pendingResponseDetail: {
    fontSize: 11,
    color: '#166534',
    fontStyle: 'italic',
  },
  pendingRequestFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 6,
    alignItems: 'flex-end',
  },
  pendingRequestJumpText: {
    fontSize: 11,
    color: Palette.primary,
  },

  // ── Contextual Contact Banner (Selected Day - Requirements 10 & 11)
  missingReportContextCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  missingReportContextTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  missingReportContextTitle: {
    fontSize: 13,
    color: '#B91C1C',
  },
  contactAtButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Palette.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    minHeight: 44,
  },
  contactAtButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
  },
  pendingExplanationsNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFBEB',
    padding: 8,
    borderRadius: 6,
  },
  pendingExplanationsNoticeText: {
    fontSize: 11,
    color: '#B45309',
  },
  unassignedNoticeText: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
  },

  // ── Compact Tronçon Row (Requirement 9)
  compactTronconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    gap: 8,
  },
  compactTronconLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  compactTronconNom: {
    fontSize: 13,
    color: Palette.text,
  },
  compactTronconAgent: {
    fontSize: 10,
    color: Palette.textLight,
    marginTop: 1,
  },
  compactTronconRight: {
    alignItems: 'flex-end',
  },
  journalStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  journalStatusPillText: {
    fontSize: 11,
  },
  compactRequestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(23, 107, 91, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(23, 107, 91, 0.2)',
    minHeight: 34,
  },
  compactRequestBtnText: {
    fontSize: 11,
    color: Palette.primary,
  },
  tronconObsSnippetBox: {
    backgroundColor: '#F8FAFC',
    padding: 8,
    borderRadius: 6,
    gap: 2,
  },

  // ── Calendar Overlay Modal Styles (Requirements 3 & 14)
  calendarModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  calendarModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    gap: 10,
  },
  calendarModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 4,
  },
  calendarModalArrowBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarModalTitleBlock: {
    alignItems: 'center',
    gap: 2,
  },
  calendarModalTitleText: {
    fontSize: 16,
    color: Palette.text,
  },
  calendarModalTodayLink: {
    fontSize: 11,
    color: Palette.primary,
    fontWeight: '600',
  },
  activeFilterPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  activeFilterPillText: {
    fontSize: 11,
    color: Palette.textMuted,
    fontWeight: '600',
  },
  calendarModalWeekDaysRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingBottom: 6,
  },
  calendarModalWeekDayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: Palette.textLight,
  },
  calendarModalWeekRow: {
    flexDirection: 'row',
    marginVertical: 2,
  },
  calendarModalDayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginHorizontal: 1,
    minHeight: 40,
  },
  calendarModalDayCellSelected: {
    backgroundColor: Palette.primary,
    borderRadius: 20,
  },
  calendarModalDayCellToday: {
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  calendarModalDayNumText: {
    fontSize: 12,
    color: Palette.text,
  },
  calendarModalDayNumTextSelected: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  calendarModalDayNumTextToday: {
    color: Palette.primary,
    fontWeight: 'bold',
  },
  calendarModalDayNumTextFuture: {
    color: '#CBD5E1',
  },
  calendarModalDotSm: {
    width: 4.5,
    height: 4.5,
    borderRadius: 2.25,
    marginTop: 2,
  },
  calendarModalLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendItemTiny: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDotTiny: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendLabelTiny: {
    fontSize: 10,
    color: Palette.textMuted,
  },

  // ── Selected Day Inspector Card
  dayInspectorCard: {
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  dayInspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  dayInspectorTitle: {
    fontSize: 15,
    color: Palette.text,
  },
  dayInspectorDateMeta: {
    fontSize: 11,
    color: Palette.textMuted,
    marginTop: 2,
  },
  dayInspectorStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dayInspectorStatusPillText: {
    fontSize: 11,
  },
  dayMetricsBox: {
    backgroundColor: '#F8FAFC',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  dayMetricsTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  dayProgressBigText: {
    fontSize: 22,
    color: Palette.primary,
  },
  dayProgressSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  dayObsCountBadge: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dayObsCountText: {
    fontSize: 11,
    color: Palette.text,
  },
  dayProgressBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  dayProgressBarFill: {
    height: '100%',
    backgroundColor: Palette.primary,
    borderRadius: 3,
  },
  dayViewPhotosBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#E6F4F1',
    borderWidth: 1,
    borderColor: '#B2DFDB',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  dayViewPhotosBtnText: {
    fontSize: 13,
    color: Palette.primary,
  },

  // ── Day Inspector Tronçon Breakdown
  dayTronconsSection: {
    gap: 10,
    marginTop: 4,
  },
  dayTronconsSectionTitle: {
    fontSize: 13,
    color: Palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayTronconCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  dayTronconTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dayTronconLeftMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dayTronconCodeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dayTronconCodeText: {
    color: '#FFFFFF',
    fontSize: 11,
  },
  dayTronconNom: {
    fontSize: 13,
    color: Palette.text,
    flex: 1,
  },
  dayTronconStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  dayTronconStatusBadgeText: {
    fontSize: 11,
  },
  dayTronconDetailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  dayTronconAgentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dayTronconAgentText: {
    fontSize: 11,
    color: Palette.textLight,
  },
  dayTronconProgText: {
    fontSize: 11,
    color: Palette.primary,
  },

  // ── Explanation Cards & Buttons
  explanationAlertCard: {
    padding: 10,
    borderRadius: 8,
    gap: 4,
  },
  explanationAlertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  explanationAlertTitle: {
    fontSize: 12,
  },
  explanationAlertMessage: {
    fontSize: 11,
    color: Palette.text,
    fontStyle: 'italic',
    lineHeight: 16,
  },
  explanationAlertFooter: {
    fontSize: 10,
    color: Palette.textLight,
    marginTop: 2,
  },
  requestJustifBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginTop: 4,
  },
  requestJustifBtnText: {
    fontSize: 12,
    color: Palette.primary,
  },

  // ── Justification Modal Styles
  justifModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  justifModalContent: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  justifModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  justifModalHeaderIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  justifModalTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  justifModalSubtitle: {
    fontSize: 11,
    color: Palette.textMuted,
  },
  justifContextCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  justifContextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  justifContextLabel: {
    fontSize: 11,
    color: Palette.textLight,
  },
  justifContextValue: {
    fontSize: 11,
    color: Palette.text,
  },
  justifInputLabel: {
    fontSize: 12,
    color: Palette.text,
  },
  justifTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: Palette.text,
    textAlignVertical: 'top',
    minHeight: 80,
  },
  justifErrorText: {
    fontSize: 12,
    color: '#DC2626',
  },
  justifSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    padding: 10,
    borderRadius: 8,
  },
  justifSuccessText: {
    fontSize: 12,
    color: '#16A34A',
  },
  justifModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 6,
  },
  justifCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  justifCancelBtnText: {
    fontSize: 13,
    color: Palette.textMuted,
  },
  justifSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Palette.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  justifSubmitBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
  },

  // ── Tab 2: Historique & S-Curve Styles
  chartCard: {

    padding: 16,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  chartTitle: {
    fontSize: 16,
    color: Palette.text,
  },
  chartSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    marginTop: 2,
  },
  chartCurrentBadge: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chartCurrentBadgeText: {
    fontSize: 15,
    color: Palette.primary,
  },
  emptyChartBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyChartTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 6,
  },
  emptyChartSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  svgContainer: {
    alignItems: 'center',
    marginVertical: 4,
  },
  chartLegendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: Palette.textMuted,
  },

  // ── Observations Feed Section
  observationsFeedSection: {
    gap: 10,
  },
  emptyObservationsCard: {
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyObservationsTitle: {
    fontSize: 14,
    color: Palette.text,
    marginTop: 4,
  },
  emptyObservationsSubtitle: {
    fontSize: 12,
    color: Palette.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  observationsList: {
    gap: 10,
  },
  obsCard: {
    padding: 14,
    gap: 8,
  },
  obsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  obsDateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  obsDateText: {
    fontSize: 12,
    color: Palette.text,
  },
  obsHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  obsTronconBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  obsTronconText: {
    fontSize: 11,
    color: Palette.text,
  },
  obsProgressBadge: {
    backgroundColor: 'rgba(23, 107, 91, 0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  obsProgressText: {
    fontSize: 11,
    color: Palette.primary,
  },
  obsTronconTitle: {
    fontSize: 13,
    color: Palette.text,
  },
  obsMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  obsMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  obsMetaItemText: {
    fontSize: 11,
    color: Palette.textLight,
  },
  obsCommentBox: {
    backgroundColor: '#F8FAFC',
    borderLeftWidth: 3,
    borderLeftColor: Palette.primary,
    padding: 10,
    borderRadius: 6,
  },
  obsCommentText: {
    fontSize: 12,
    color: Palette.text,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  photosRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  photoThumbContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  photoThumb: {
    width: '100%',
    height: '100%',
  },
  photoZoomOverlay: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 4,
    padding: 2,
  },

  // ── Photo Modal Preview
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.88)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
  },
  modalContent: {
    width: Dimensions.get('window').width - 32,
    height: Dimensions.get('window').height * 0.7,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '85%',
  },
  modalCaption: {
    color: '#FFFFFF',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'center',
  },

  // ── States & Common
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
  },
  errorCard: {
    width: '100%',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
    fontSize: 14,
  },
  retryBtn: {
    backgroundColor: Palette.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
