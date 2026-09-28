/**
 * lib/temporal.ts
 *
 * Level 6B — GIS Temporal Synchronization
 *
 * Shared temporal state types and pure derivation functions.
 * No React hooks, no side-effects — just data transformation.
 *
 * This module is the single source of truth for:
 *  - TemporalViewState  (what the timeline emits)
 *  - DerivedTemporalState  (what the maps consume)
 *  - All date-filtering predicates
 *
 * Business rules respected:
 *  - Unknown dates are NEVER fabricated
 *  - Current mode bypasses all temporal filtering
 *  - Non-regressive progress from TimelineProgressSnapshot
 *  - KML TimeStamp / TimeSpan rules per OGC KML specification
 */

import type {
  TimelineProgressSnapshot,
  ChantierTimelineResponse,
  KmlMetadata,
  KmlGroundOverlay,
  KmlPhotoOverlay,
} from '@/services/api';

// ─── Temporal View State ──────────────────────────────────────────────────────

export type TemporalMode = 'current' | 'historical';

/**
 * Represents the current temporal selection emitted by ChantierTimeline.
 * Single source of truth for which moment the GIS renders.
 */
export interface TemporalViewState {
  mode: TemporalMode;
  /** ISO 8601 datetime string of the selected event, or null when in current mode */
  selectedDate: string | null;
  /** Index of the selected event in the timeline events array */
  replayIndex: number;
  /** True while the auto-replay timer is running */
  isPlaying: boolean;
}

export function makeCurrentTemporalState(): TemporalViewState {
  return { mode: 'current', selectedDate: null, replayIndex: -1, isPlaying: false };
}

// ─── Derived Temporal State ───────────────────────────────────────────────────

/**
 * The fully derived state consumed by both InteractiveGisMap and
 * InteractiveGis3DMap. Both renderers MUST receive the same instance.
 */
export interface DerivedTemporalState {
  mode: TemporalMode;

  /**
   * YYYY-MM-DD date string of the selected moment, or null in current mode.
   * Used for display and visibility predicates.
   */
  selectedDateLabel: string | null;

  /** Full ISO datetime string for precise comparisons */
  selectedDateTime: string | null;

  /**
   * Progress per tronçon at the selected date.
   * key = tronçon id (number), value = authoritative non-regressive progress (0-100).
   * Empty in current mode.
   */
  tronconsProgress: Record<number, number>;

  /**
   * Aggregated chantier progress (0-100) at the selected date.
   * -1 in current mode (show live value from chantier object).
   */
  chantierProgress: number;

  /**
   * IDs of observations that are visible at the selected date.
   * null in current mode (show all).
   */
  visibleObservationIds: Set<number> | null;
}

// ─── Derivation ───────────────────────────────────────────────────────────────

/**
 * Derive the full DerivedTemporalState from timeline data and the current
 * TemporalViewState.
 *
 * Pure function — memoize with useMemo in the consuming component.
 */
export function deriveTemporalState(
  temporal: TemporalViewState,
  timeline: ChantierTimelineResponse | null
): DerivedTemporalState {
  // ── Current mode ──────────────────────────────────────────────────────────
  if (temporal.mode === 'current' || !temporal.selectedDate || !timeline) {
    return {
      mode: 'current',
      selectedDateLabel: null,
      selectedDateTime: null,
      tronconsProgress: {},
      chantierProgress: -1,
      visibleObservationIds: null,
    };
  }

  // ── Historical mode ───────────────────────────────────────────────────────
  const cutoff = temporal.selectedDate; // ISO datetime of the selected event

  // 1. Find the best progress snapshot on or before the cutoff
  let bestSnap: TimelineProgressSnapshot | null = null;
  for (const sn of timeline.progressHistory) {
    if (sn.dateTime <= cutoff) bestSnap = sn;
    else break;
  }

  const tronconsProgress: Record<number, number> = bestSnap?.tronconsProgress ?? {};
  const chantierProgress = bestSnap?.authoritativeChantierProgress ?? 0;

  // 2. Collect visible observation IDs (date <= cutoff)
  const visibleObservationIds = new Set<number>();
  for (const ev of timeline.events) {
    if (ev.date <= cutoff) {
      visibleObservationIds.add(ev.observationId);
    }
  }

  return {
    mode: 'historical',
    selectedDateLabel: cutoff.slice(0, 10), // YYYY-MM-DD
    selectedDateTime: cutoff,
    tronconsProgress,
    chantierProgress,
    visibleObservationIds,
  };
}

// ─── KML Temporal Predicates ──────────────────────────────────────────────────

/**
 * Determines whether a KML element with the given temporal metadata
 * is visible at the selected date.
 *
 * Rules (OGC KML spec):
 *  - No temporal metadata → always visible (static element)
 *  - TimeStamp: visible when selectedDateTime >= when
 *  - TimeSpan: visible when begin <= selectedDateTime AND (no end OR selectedDateTime <= end)
 *  - Unknown `when`/`begin`/`end` → keep visible (never invent temporal position)
 */
export function isKmlElementVisible(
  time: KmlMetadata['time'],
  selectedDateTime: string | null
): boolean {
  if (!selectedDateTime) return true; // current mode
  if (!time) return true;             // static element

  if (time.type === 'timestamp') {
    if (!time.when) return true; // unknown — keep visible
    return selectedDateTime >= time.when;
  }

  if (time.type === 'timespan') {
    const { begin, end } = time;
    if (!begin && !end) return true; // no bounds — static
    if (begin && selectedDateTime < begin) return false;
    if (end && selectedDateTime > end) return false;
    return true;
  }

  return true; // unknown type — keep visible
}

/**
 * Filter KML GroundOverlays by selected date.
 * Overlays without a `time` field remain static (always visible).
 */
export function filterKmlGroundOverlays(
  overlays: KmlGroundOverlay[] | null | undefined,
  temporal: DerivedTemporalState
): KmlGroundOverlay[] {
  if (!overlays || overlays.length === 0) return [];
  if (temporal.mode === 'current') return overlays;
  // KmlGroundOverlay has no `time` field in current API type → static
  return overlays;
}

/**
 * Filter KML PhotoOverlays by selected date.
 * Overlays without a `time` field remain static (always visible).
 */
export function filterKmlPhotoOverlays(
  overlays: KmlPhotoOverlay[] | null | undefined,
  temporal: DerivedTemporalState
): KmlPhotoOverlay[] {
  if (!overlays || overlays.length === 0) return [];
  if (temporal.mode === 'current') return overlays;
  // KmlPhotoOverlay has no `time` field in current API type → static
  return overlays;
}

/**
 * Inject historical progress/statut into GIS tronçon segments.
 * Geometry is NEVER modified.
 *
 * In current mode, segments are returned unchanged.
 */
export function applyTemporalProgressToSegments<
  T extends { id?: number | string; statut?: string; progress_percentage?: number }
>(segments: T[], temporal: DerivedTemporalState): T[] {
  if (temporal.mode === 'current' || !segments || segments.length === 0) {
    return segments;
  }

  return segments.map((seg) => {
    const tronconId = typeof seg.id === 'number' ? seg.id : Number(seg.id);
    const historicalPct: number = isNaN(tronconId)
      ? 0
      : (temporal.tronconsProgress[tronconId] ?? 0);
    const historicalStatut =
      historicalPct >= 100 ? 'TERMINE' : historicalPct > 0 ? 'EN_COURS' : 'NON_COMMENCE';

    return { ...seg, progress_percentage: historicalPct, statut: historicalStatut };
  });
}

// ─── Date Formatting ──────────────────────────────────────────────────────────

const FR_MONTHS_SHORT = [
  'jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

const FR_MONTHS_LONG = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

/** Format YYYY-MM-DD → "15 août 2026" */
export function formatTemporalDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const s = dateStr.slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return s;
  return `${d.getUTCDate()} ${FR_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Format YYYY-MM-DD → "15 août 2026" (long month) */
export function formatTemporalDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const s = dateStr.slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return s;
  return `${d.getUTCDate()} ${FR_MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
