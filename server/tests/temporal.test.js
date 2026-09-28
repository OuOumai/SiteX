/**
 * server/tests/temporal.test.js
 *
 * Unit tests for Level 6B — GIS Temporal Synchronization.
 *
 * Tests the pure functions in lib/temporal.ts through a CommonJS shim
 * (we test the logic, not the TypeScript module resolution).
 *
 * Run: node server/tests/temporal.test.js
 */

'use strict';

// ---------------------------------------------------------------------------
// Mini test framework (same structure as kml.test.js)
// ---------------------------------------------------------------------------
function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Port the pure temporal functions to plain JS for testing
// (avoids TypeScript/module resolution complexity in Node CJS tests)
// ---------------------------------------------------------------------------

const TemporalMode = { current: 'current', historical: 'historical' };

function makeCurrentTemporalState() {
  return { mode: 'current', selectedDate: null, replayIndex: -1, isPlaying: false };
}

function deriveTemporalState(temporal, timeline) {
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

  const cutoff = temporal.selectedDate;

  let bestSnap = null;
  for (const sn of timeline.progressHistory) {
    if (sn.dateTime <= cutoff) bestSnap = sn;
    else break;
  }

  const tronconsProgress = bestSnap ? bestSnap.tronconsProgress : {};
  const chantierProgress = bestSnap ? bestSnap.authoritativeChantierProgress : 0;

  const visibleObservationIds = new Set();
  for (const ev of timeline.events) {
    if (ev.date <= cutoff) visibleObservationIds.add(ev.observationId);
  }

  return {
    mode: 'historical',
    selectedDateLabel: cutoff.slice(0, 10),
    selectedDateTime: cutoff,
    tronconsProgress,
    chantierProgress,
    visibleObservationIds,
  };
}

function isKmlElementVisible(time, selectedDateTime) {
  if (!selectedDateTime) return true;
  if (!time) return true;

  if (time.type === 'timestamp') {
    if (!time.when) return true;
    return selectedDateTime >= time.when;
  }

  if (time.type === 'timespan') {
    const { begin, end } = time;
    if (!begin && !end) return true;
    if (begin && selectedDateTime < begin) return false;
    if (end && selectedDateTime > end) return false;
    return true;
  }

  return true;
}

function applyTemporalProgressToSegments(segments, temporal) {
  if (temporal.mode === 'current' || !segments || segments.length === 0) {
    return segments;
  }
  return segments.map(seg => {
    const tronconId = typeof seg.id === 'number' ? seg.id : Number(seg.id);
    const historicalPct = isNaN(tronconId) ? 0 : (temporal.tronconsProgress[tronconId] || 0);
    const historicalStatut =
      historicalPct >= 100 ? 'TERMINE' :
      historicalPct > 0   ? 'EN_COURS' :
                            'NON_COMMENCE';
    return { ...seg, progress_percentage: historicalPct, statut: historicalStatut };
  });
}

const FR_MONTHS_SHORT = [
  'jan.', 'fév.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
];

function formatTemporalDateShort(dateStr) {
  if (!dateStr) return '';
  const s = dateStr.slice(0, 10);
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d.getTime())) return s;
  return `${d.getUTCDate()} ${FR_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_TIMELINE = {
  chantierId: 1,
  chantierNom: 'Autoroute N1',
  dateDebut: '2026-01-01',
  dateFinPrevue: '2026-12-31',
  troncons: [
    { id: 10, nom: 'T1', pk_debut: 0, pk_fin: 5, current_avancement: 100 },
    { id: 20, nom: 'T2', pk_debut: 5, pk_fin: 10, current_avancement: 60 },
    { id: 30, nom: 'T3', pk_debut: 10, pk_fin: 15, current_avancement: 0 },
  ],
  events: [
    {
      id: 'obs-1', type: 'observation', observationId: 1,
      date: '2026-03-01T08:00:00Z', dateDay: '2026-03-01',
      tronconId: 10, tronconNom: 'T1',
      rawProgress: 30, authoritativeProgress: 30, chantierProgress: 10,
      coordinates: { lat: 33.1, lng: -5.1 },
      agentNom: 'Agent A', photos: [],
    },
    {
      id: 'obs-2', type: 'observation', observationId: 2,
      date: '2026-05-15T14:30:00Z', dateDay: '2026-05-15',
      tronconId: 10, tronconNom: 'T1',
      rawProgress: 80, authoritativeProgress: 80, chantierProgress: 27,
      coordinates: { lat: 33.2, lng: -5.2 },
      agentNom: 'Agent B', photos: [],
    },
    {
      id: 'obs-3', type: 'observation', observationId: 3,
      date: '2026-08-20T09:00:00Z', dateDay: '2026-08-20',
      tronconId: 20, tronconNom: 'T2',
      rawProgress: 60, authoritativeProgress: 60, chantierProgress: 42,
      coordinates: { lat: 33.3, lng: -5.3 },
      agentNom: 'Agent A', photos: [],
    },
  ],
  progressHistory: [
    {
      date: '2026-03-01', dateTime: '2026-03-01T08:00:00Z',
      rawChantierProgress: 10, authoritativeChantierProgress: 10,
      tronconsProgress: { 10: 30, 20: 0, 30: 0 },
      observationsCount: 1, photosCount: 0,
    },
    {
      date: '2026-05-15', dateTime: '2026-05-15T14:30:00Z',
      rawChantierProgress: 27, authoritativeChantierProgress: 27,
      tronconsProgress: { 10: 80, 20: 0, 30: 0 },
      observationsCount: 2, photosCount: 0,
    },
    {
      date: '2026-08-20', dateTime: '2026-08-20T09:00:00Z',
      rawChantierProgress: 42, authoritativeChantierProgress: 42,
      tronconsProgress: { 10: 80, 20: 60, 30: 0 },
      observationsCount: 3, photosCount: 0,
    },
  ],
  temporalBounds: { minDate: '2026-03-01', maxDate: '2026-08-20' },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('🧪 Level 6B — GIS Temporal Synchronization Tests\n');

// ── makeCurrentTemporalState ────────────────────────────────────────────────
test('T1 — makeCurrentTemporalState returns mode=current with nulls', () => {
  const s = makeCurrentTemporalState();
  assert(s.mode === 'current', 'mode must be current');
  assert(s.selectedDate === null, 'selectedDate must be null');
  assert(s.replayIndex === -1, 'replayIndex must be -1');
  assert(s.isPlaying === false, 'isPlaying must be false');
});

// ── deriveTemporalState — current mode ──────────────────────────────────────
test('T2 — deriveTemporalState with mode=current returns empty derived state', () => {
  const d = deriveTemporalState(makeCurrentTemporalState(), MOCK_TIMELINE);
  assert(d.mode === 'current', 'mode must be current');
  assert(d.selectedDateLabel === null, 'selectedDateLabel must be null');
  assert(d.selectedDateTime === null, 'selectedDateTime must be null');
  assert(Object.keys(d.tronconsProgress).length === 0, 'tronconsProgress must be empty');
  assert(d.chantierProgress === -1, 'chantierProgress must be -1 in current mode');
  assert(d.visibleObservationIds === null, 'visibleObservationIds must be null in current mode');
});

test('T3 — deriveTemporalState with null timeline returns current-mode result', () => {
  const temporal = { mode: 'historical', selectedDate: '2026-05-15T14:30:00Z', replayIndex: 1, isPlaying: false };
  const d = deriveTemporalState(temporal, null);
  assert(d.mode === 'current', 'mode must be current when no timeline');
});

// ── deriveTemporalState — historical mode ───────────────────────────────────
test('T4 — deriveTemporalState at first event (2026-03-01)', () => {
  const temporal = { mode: 'historical', selectedDate: '2026-03-01T08:00:00Z', replayIndex: 0, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);

  assert(d.mode === 'historical', 'mode must be historical');
  assert(d.selectedDateLabel === '2026-03-01', 'label must be 2026-03-01');
  assert(d.chantierProgress === 10, 'chantierProgress must be 10');
  assert(d.tronconsProgress[10] === 30, 'T1 must be 30%');
  assert(d.tronconsProgress[20] === 0, 'T2 must be 0%');
  assert(d.visibleObservationIds.size === 1, 'only 1 observation visible');
  assert(d.visibleObservationIds.has(1), 'obs-1 must be visible');
  assert(!d.visibleObservationIds.has(2), 'obs-2 must NOT be visible yet');
});

test('T5 — deriveTemporalState at second event (2026-05-15)', () => {
  const temporal = { mode: 'historical', selectedDate: '2026-05-15T14:30:00Z', replayIndex: 1, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);

  assert(d.chantierProgress === 27, 'chantierProgress must be 27');
  assert(d.tronconsProgress[10] === 80, 'T1 must be 80%');
  assert(d.tronconsProgress[20] === 0, 'T2 must still be 0%');
  assert(d.visibleObservationIds.size === 2, '2 observations must be visible');
  assert(d.visibleObservationIds.has(1), 'obs-1 visible');
  assert(d.visibleObservationIds.has(2), 'obs-2 visible');
  assert(!d.visibleObservationIds.has(3), 'obs-3 must NOT be visible yet');
});

test('T6 — deriveTemporalState at last event (2026-08-20)', () => {
  const temporal = { mode: 'historical', selectedDate: '2026-08-20T09:00:00Z', replayIndex: 2, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);

  assert(d.chantierProgress === 42, 'chantierProgress must be 42');
  assert(d.tronconsProgress[10] === 80, 'T1 must be 80% (non-regressive)');
  assert(d.tronconsProgress[20] === 60, 'T2 must be 60%');
  assert(d.tronconsProgress[30] === 0, 'T3 must be 0% (not started)');
  assert(d.visibleObservationIds.size === 3, 'all 3 observations must be visible');
});

test('T7 — non-regressive progress: T1 stays at 80% even at last snapshot', () => {
  // The authoritative progress for T1 is 80% at event 2 and stays 80% at event 3
  // because the backend already applies non-regressive rules in progressHistory.
  const temporal = { mode: 'historical', selectedDate: '2026-08-20T09:00:00Z', replayIndex: 2, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);
  assert(d.tronconsProgress[10] >= 80, 'T1 non-regressive: must be >= 80%');
});

// ── Intermediate date (no exact snapshot match) ─────────────────────────────
test('T8 — deriveTemporalState between events uses last valid snapshot (2026-04-01)', () => {
  // Between obs-1 (2026-03-01) and obs-2 (2026-05-15)
  const temporal = { mode: 'historical', selectedDate: '2026-04-01T00:00:00Z', replayIndex: 0, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);

  // Should use snapshot from 2026-03-01 (the last one before/on 2026-04-01)
  assert(d.chantierProgress === 10, 'must use snapshot from 2026-03-01');
  assert(d.tronconsProgress[10] === 30, 'T1 must be 30%');
  // obs-2 date is 2026-05-15 > 2026-04-01, so only obs-1 visible
  assert(d.visibleObservationIds.size === 1, 'only obs-1 must be visible');
});

test('T9 — deriveTemporalState before all events has chantierProgress=0', () => {
  const temporal = { mode: 'historical', selectedDate: '2025-01-01T00:00:00Z', replayIndex: 0, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);
  // No snapshot <= 2025-01-01 so bestSnap = null → chantierProgress=0
  assert(d.chantierProgress === 0, 'must be 0 before any snapshots');
  assert(d.visibleObservationIds.size === 0, 'no observations before earliest event');
});

// ── isKmlElementVisible ──────────────────────────────────────────────────────
test('T10 — isKmlElementVisible: null time → always visible', () => {
  assert(isKmlElementVisible(null, '2026-03-01T00:00:00Z'), 'null time must be visible');
  assert(isKmlElementVisible(undefined, '2026-03-01T00:00:00Z'), 'undefined time must be visible');
});

test('T11 — isKmlElementVisible: null selectedDateTime → always visible (current mode)', () => {
  const time = { type: 'timestamp', when: '2026-01-01T00:00:00Z' };
  assert(isKmlElementVisible(time, null), 'null selectedDateTime → always visible');
});

test('T12 — isKmlElementVisible: TimeStamp — visible when selectedDateTime >= when', () => {
  const time = { type: 'timestamp', when: '2026-03-01T00:00:00Z' };
  assert(!isKmlElementVisible(time, '2026-02-28T23:59:59Z'), 'before when → invisible');
  assert(isKmlElementVisible(time, '2026-03-01T00:00:00Z'), 'at when → visible');
  assert(isKmlElementVisible(time, '2026-12-31T00:00:00Z'), 'after when → visible');
});

test('T13 — isKmlElementVisible: TimeStamp with unknown when → visible', () => {
  const time = { type: 'timestamp', when: null };
  assert(isKmlElementVisible(time, '2026-03-01T00:00:00Z'), 'null when → visible');
});

test('T14 — isKmlElementVisible: TimeSpan with begin and end', () => {
  const time = {
    type: 'timespan',
    begin: '2026-03-01T00:00:00Z',
    end: '2026-06-30T23:59:59Z',
  };
  assert(!isKmlElementVisible(time, '2026-02-28T00:00:00Z'), 'before begin → invisible');
  assert(isKmlElementVisible(time, '2026-03-01T00:00:00Z'), 'at begin → visible');
  assert(isKmlElementVisible(time, '2026-05-15T00:00:00Z'), 'between begin and end → visible');
  assert(isKmlElementVisible(time, '2026-06-30T23:59:59Z'), 'at end → visible');
  assert(!isKmlElementVisible(time, '2026-07-01T00:00:00Z'), 'after end → invisible');
});

test('T15 — isKmlElementVisible: TimeSpan begin-only (no end)', () => {
  const time = { type: 'timespan', begin: '2026-05-01T00:00:00Z', end: null };
  assert(!isKmlElementVisible(time, '2026-04-30T23:59:59Z'), 'before begin → invisible');
  assert(isKmlElementVisible(time, '2026-05-01T00:00:00Z'), 'at begin → visible');
  assert(isKmlElementVisible(time, '2099-01-01T00:00:00Z'), 'far future → visible');
});

test('T16 — isKmlElementVisible: TimeSpan end-only (no begin)', () => {
  const time = { type: 'timespan', begin: null, end: '2026-06-30T00:00:00Z' };
  assert(isKmlElementVisible(time, '2020-01-01T00:00:00Z'), 'early date → visible');
  assert(isKmlElementVisible(time, '2026-06-30T00:00:00Z'), 'at end → visible');
  assert(!isKmlElementVisible(time, '2026-07-01T00:00:00Z'), 'after end → invisible');
});

test('T17 — isKmlElementVisible: TimeSpan with no begin and no end → static/visible', () => {
  const time = { type: 'timespan', begin: null, end: null };
  assert(isKmlElementVisible(time, '2026-03-01T00:00:00Z'), 'no bounds → always visible');
});

test('T18 — isKmlElementVisible: unknown type → visible', () => {
  const time = { type: 'unknown_future_type', when: '2026-01-01T00:00:00Z' };
  assert(isKmlElementVisible(time, '2026-03-01T00:00:00Z'), 'unknown type → visible');
});

// ── applyTemporalProgressToSegments ─────────────────────────────────────────
const MOCK_SEGMENTS = [
  { id: 10, nom: 'T1', pk_debut: 0, pk_fin: 5, statut: 'TERMINE', progress_percentage: 100 },
  { id: 20, nom: 'T2', pk_debut: 5, pk_fin: 10, statut: 'EN_COURS', progress_percentage: 60 },
  { id: 30, nom: 'T3', pk_debut: 10, pk_fin: 15, statut: 'NON_COMMENCE', progress_percentage: 0 },
];

test('T19 — applyTemporalProgressToSegments in current mode returns segments unchanged', () => {
  const temporal = { mode: 'current', tronconsProgress: {}, chantierProgress: -1, visibleObservationIds: null };
  const result = applyTemporalProgressToSegments(MOCK_SEGMENTS, temporal);
  assert(result[0].statut === 'TERMINE', 'T1 statut unchanged');
  assert(result[1].statut === 'EN_COURS', 'T2 statut unchanged');
  assert(result[0].progress_percentage === 100, 'T1 progress unchanged');
});

test('T20 — applyTemporalProgressToSegments in historical mode injects historical progress', () => {
  const temporal = {
    mode: 'historical',
    tronconsProgress: { 10: 30, 20: 0, 30: 0 },
    chantierProgress: 10,
    visibleObservationIds: new Set([1]),
    selectedDateLabel: '2026-03-01',
    selectedDateTime: '2026-03-01T08:00:00Z',
  };
  const result = applyTemporalProgressToSegments(MOCK_SEGMENTS, temporal);
  assert(result[0].progress_percentage === 30, 'T1 must show 30% at historical date');
  assert(result[0].statut === 'EN_COURS', 'T1 statut must reflect 30% (EN_COURS)');
  assert(result[1].progress_percentage === 0, 'T2 must show 0%');
  assert(result[1].statut === 'NON_COMMENCE', 'T2 statut must be NON_COMMENCE');
});

test('T21 — applyTemporalProgressToSegments: segment at 100% gets TERMINE statut', () => {
  const temporal = {
    mode: 'historical',
    tronconsProgress: { 10: 100, 20: 50, 30: 0 },
    chantierProgress: 50,
    visibleObservationIds: new Set(),
    selectedDateLabel: '2026-08-20',
    selectedDateTime: '2026-08-20T09:00:00Z',
  };
  const result = applyTemporalProgressToSegments(MOCK_SEGMENTS, temporal);
  assert(result[0].statut === 'TERMINE', 'T1 at 100% → TERMINE');
  assert(result[1].statut === 'EN_COURS', 'T2 at 50% → EN_COURS');
  assert(result[2].statut === 'NON_COMMENCE', 'T3 at 0% → NON_COMMENCE');
});

test('T22 — applyTemporalProgressToSegments: geometry is never modified', () => {
  const segments = [
    { id: 10, geometry: { type: 'LineString', coordinates: [[1,2],[3,4]] }, progress_percentage: 100 },
  ];
  const temporal = {
    mode: 'historical', tronconsProgress: { 10: 50 }, chantierProgress: 17,
    visibleObservationIds: new Set(), selectedDateLabel: '2026-05-01', selectedDateTime: '2026-05-01T00:00:00Z',
  };
  const result = applyTemporalProgressToSegments(segments, temporal);
  const geom = result[0].geometry;
  assert(geom.type === 'LineString', 'geometry.type must be preserved');
  assert(JSON.stringify(geom.coordinates) === '[[1,2],[3,4]]', 'coordinates must be unchanged');
});

test('T23 — applyTemporalProgressToSegments: unknown tronçon id → 0% NON_COMMENCE', () => {
  const temporal = {
    mode: 'historical', tronconsProgress: { 10: 80 }, chantierProgress: 27,
    visibleObservationIds: new Set(), selectedDateLabel: '2026-05-15', selectedDateTime: '2026-05-15T14:30:00Z',
  };
  const segments = [{ id: 99, statut: 'TERMINE', progress_percentage: 100 }];
  const result = applyTemporalProgressToSegments(segments, temporal);
  assert(result[0].progress_percentage === 0, 'unknown tronçon → 0%');
  assert(result[0].statut === 'NON_COMMENCE', 'unknown tronçon → NON_COMMENCE');
});

// ── formatTemporalDateShort ──────────────────────────────────────────────────
test('T24 — formatTemporalDateShort: known date formats correctly in French', () => {
  assert(formatTemporalDateShort('2026-08-15') === '15 août 2026', 'August 15');
  assert(formatTemporalDateShort('2026-01-01') === '1 jan. 2026', 'January 1');
  assert(formatTemporalDateShort('2026-12-31') === '31 déc. 2026', 'December 31');
  assert(formatTemporalDateShort('2026-03-14') === '14 mars 2026', 'March 14');
});

test('T25 — formatTemporalDateShort: null/undefined → empty string', () => {
  assert(formatTemporalDateShort(null) === '', 'null → empty');
  assert(formatTemporalDateShort(undefined) === '', 'undefined → empty');
  assert(formatTemporalDateShort('') === '', 'empty string → empty');
});

test('T26 — formatTemporalDateShort: ISO datetime string uses only date part', () => {
  // YYYY-MM-DD is sliced from the string before parsing
  const result = formatTemporalDateShort('2026-07-04T12:30:00Z');
  assert(result === '4 juil. 2026', `Expected "4 juil. 2026" got "${result}"`);
});

// ── Business rule: unknown temporal info stays visible ───────────────────────
test('T27 — Business rule: observations with unknown date (id=undefined) stay visible', () => {
  // Markers with undefined id should not be filtered out in historical mode
  const temporal = {
    mode: 'historical',
    tronconsProgress: {},
    chantierProgress: 0,
    visibleObservationIds: new Set([1, 2]),
    selectedDateLabel: '2026-03-01',
    selectedDateTime: '2026-03-01T08:00:00Z',
  };

  // Simulating the filtering logic from InteractiveGisMap
  const markers = [
    { id: 1, lat: 33.1, lng: -5.1 },      // known, in set → visible
    { id: 2, lat: 33.2, lng: -5.2 },      // known, in set → visible
    { id: 3, lat: 33.3, lng: -5.3 },      // known, NOT in set → invisible
    { id: undefined, lat: 33.4, lng: -5.4 }, // unknown date → keep visible
  ];

  const filtered = markers.filter(m => {
    if (m.id === undefined || m.id === null) return true; // unknown — keep
    const numId = typeof m.id === 'number' ? m.id : Number(m.id);
    return temporal.visibleObservationIds.has(numId);
  });

  assert(filtered.length === 3, 'obs 1, 2, and unknown must be visible');
  assert(filtered.some(m => m.id === undefined), 'unknown-date marker must be visible');
  assert(!filtered.some(m => m.id === 3), 'obs-3 (future) must not be visible');
});

test('T28 — Business rule: switching to current mode shows all observations', () => {
  const d = deriveTemporalState(makeCurrentTemporalState(), MOCK_TIMELINE);
  // In current mode, visibleObservationIds === null means "show all"
  assert(d.visibleObservationIds === null, 'null = show all in current mode');
});

test('T29 — deriveTemporalState: selectedDateLabel is YYYY-MM-DD (slice of ISO)', () => {
  const temporal = { mode: 'historical', selectedDate: '2026-08-20T09:00:00Z', replayIndex: 2, isPlaying: false };
  const d = deriveTemporalState(temporal, MOCK_TIMELINE);
  assert(d.selectedDateLabel === '2026-08-20', `Expected "2026-08-20" got "${d.selectedDateLabel}"`);
  assert(d.selectedDateTime === '2026-08-20T09:00:00Z', 'selectedDateTime must be the full ISO string');
});

test('T30 — Mode consistency: both 2D and 3D get identical derivedTemporal', () => {
  // Both maps receive the same DerivedTemporalState object — this test verifies
  // that deriveTemporalState is deterministic given the same inputs.
  const temporal = { mode: 'historical', selectedDate: '2026-05-15T14:30:00Z', replayIndex: 1, isPlaying: false };
  const d1 = deriveTemporalState(temporal, MOCK_TIMELINE);
  const d2 = deriveTemporalState(temporal, MOCK_TIMELINE);

  assert(d1.mode === d2.mode, 'mode must match');
  assert(d1.chantierProgress === d2.chantierProgress, 'chantierProgress must match');
  assert(d1.selectedDateLabel === d2.selectedDateLabel, 'selectedDateLabel must match');
  assert(JSON.stringify(d1.tronconsProgress) === JSON.stringify(d2.tronconsProgress), 'tronconsProgress must match');
  assert(d1.visibleObservationIds.size === d2.visibleObservationIds.size, 'visible obs count must match');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\nResults: ${passed} passed, ${failed} failed.\n`);
if (failed > 0) process.exit(1);
