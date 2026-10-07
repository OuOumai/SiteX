/**
 * components/gis/ChantierTimeline.tsx
 *
 * Level 6 — Spatio-Temporal Monitoring & Chantier Replay
 *
 * Features:
 *  1. Stats header: observations, photos, active days, current progress
 *  2. Interactive replay scrubber (HTML range on web, step buttons on native)
 *  3. Auto-replay mode (700ms per event)
 *  4. Three tabs: Chart (SVG sparkline), Events (feed), Tronçons (status at replay point)
 *  5. Non-regressive progress chart
 *  6. Chronological event feed with GPS, phase tags, photos
 *
 * No changes to 2D Leaflet map, reference alignment, or business logic.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, ScrollView, TouchableOpacity, ActivityIndicator,
  StyleSheet, Platform, Dimensions, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui/text';
import {
  api, ChantierTimelineResponse, TimelineEvent,
  TimelineTroncon, TimelineProgressSnapshot, getMediaUrl,
} from '@/services/api';
import type { TemporalViewState } from '@/lib/temporal';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const C = {
  bg: '#0A1628', card: '#111827', border: 'rgba(255,255,255,0.07)',
  accent: '#10B981', accentDim: 'rgba(16,185,129,0.15)',
  amber: '#F59E0B', blue: '#3B82F6', purple: '#8B5CF6',
  text: '#F8FAFC', muted: '#64748B', sub: '#94A3B8',
  chartLine: '#10B981', chartArea: 'rgba(16,185,129,0.08)',
};

const DOT_COLORS = [C.accent, C.blue, C.purple, C.amber, '#EC4899', '#06B6D4'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(s?: string | null): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  const M = ['jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
  return `${d.getDate()} ${M[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtTime(s: string): string {
  const m = s.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

function fmtPK(v?: number | null): string {
  if (v === undefined || v === null) return '?';
  const km = Math.floor(v);
  return `PK ${km}+${String(Math.round((v - km) * 1000)).padStart(3, '0')}`;
}

function pctColor(p: number): string {
  if (p >= 90) return '#10B981';
  if (p >= 60) return '#F59E0B';
  if (p >= 30) return '#3B82F6';
  return '#94A3B8';
}

// ---------------------------------------------------------------------------
// SVG Sparkline (web) / bar fallback (native)
// ---------------------------------------------------------------------------

function SparklineChart({ data, width, height, curIdx }: {
  data: TimelineProgressSnapshot[]; width: number; height: number; curIdx: number;
}) {
  if (!data || data.length < 2) return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: C.muted, fontSize: 12 }}>Pas assez de données</Text>
    </View>
  );

  const pad = { t: 8, r: 16, b: 20, l: 32 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const pts = data.map((s, i) => ({
    x: pad.l + (i / (data.length - 1)) * w,
    y: pad.t + h - (s.authoritativeChantierProgress / 100) * h,
    pct: s.authoritativeChantierProgress,
  }));
  const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaD = `M${pts[0].x.toFixed(1)},${(pad.t + h).toFixed(1)} `
    + pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    + ` L${pts[pts.length - 1].x.toFixed(1)},${(pad.t + h).toFixed(1)} Z`;
  const cur = curIdx >= 0 && curIdx < pts.length ? pts[curIdx] : null;

  if (Platform.OS === 'web') {
    // Use string tags to avoid TSX compilation issues with SVG
    return React.createElement('svg', { width, height, style: { display: 'block', overflow: 'visible' } },
      [0, 25, 50, 75, 100].map(yv => {
        const cy = pad.t + h - (yv / 100) * h;
        return React.createElement('g', { key: yv },
          React.createElement('line', { x1: pad.l, y1: cy, x2: pad.l + w, y2: cy, stroke: 'rgba(255,255,255,0.05)', strokeWidth: 1 }),
          React.createElement('text', { x: pad.l - 4, y: cy + 4, textAnchor: 'end', fill: '#64748B', fontSize: 9 }, `${yv}%`)
        );
      }),
      React.createElement('path', { d: areaD, fill: C.chartArea }),
      React.createElement('path', { d: lineD, fill: 'none', stroke: C.chartLine, strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
      ...pts.map((p, i) => React.createElement('circle', {
        key: i, cx: p.x, cy: p.y,
        r: i === curIdx ? 5 : 2.5,
        fill: i === curIdx ? '#fff' : C.chartLine,
        stroke: i === curIdx ? C.chartLine : 'none', strokeWidth: 2,
      })),
      cur ? React.createElement('g', { key: 'cursor' },
        React.createElement('line', { x1: cur.x, y1: pad.t, x2: cur.x, y2: pad.t + h, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, strokeDasharray: '3,3' }),
        React.createElement('rect', { x: cur.x - 22, y: cur.y - 22, width: 44, height: 16, rx: 4, fill: 'rgba(16,185,129,0.9)' }),
        React.createElement('text', { x: cur.x, y: cur.y - 11, textAnchor: 'middle', fill: '#fff', fontSize: 10, fontWeight: 'bold' }, `${Math.round(cur.pct)}%`)
      ) : null
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ width, height }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: h + 8, paddingHorizontal: 8 }}>
        {data.map((s, i) => (
          <View key={i} style={{ width: 6, height: Math.max(2, (s.authoritativeChantierProgress / 100) * h), backgroundColor: i === curIdx ? '#fff' : C.chartLine, borderRadius: 2, opacity: i === curIdx ? 1 : 0.6 }} />
        ))}
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Scrubber
// ---------------------------------------------------------------------------

function Scrubber({ total, cur, onScrub }: { total: number; cur: number; onScrub: (i: number) => void }) {
  if (total <= 0) return null;
  const pct = total > 1 ? (cur / (total - 1)) * 100 : 100;

  if (Platform.OS === 'web') {
    return (
      <View style={st.scrubWrap}>
        <Text style={st.scrubLbl}>Événement {cur + 1} / {total}</Text>
        {React.createElement('input', {
          type: 'range', min: 0, max: total - 1, value: cur,
          onChange: (e: any) => onScrub(Number(e.target.value)),
          style: { width: '100%', accentColor: C.accent, cursor: 'pointer', margin: '4px 0' },
        })}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={st.scrubEnd}>Début</Text>
          <Text style={st.scrubEnd}>Fin</Text>
        </View>
      </View>
    );
  }

  const tw = Math.max(60, Dimensions.get('window').width - 120);
  return (
    <View style={st.scrubWrap}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <TouchableOpacity onPress={() => onScrub(Math.max(0, cur - 1))} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={18} color={cur === 0 ? C.muted : C.accent} />
        </TouchableOpacity>
        <View style={[st.scrubTrack, { width: tw }]}>
          <View style={[st.scrubFill, { width: `${pct}%` as any }]} />
        </View>
        <TouchableOpacity onPress={() => onScrub(Math.min(total - 1, cur + 1))} style={{ padding: 4 }}>
          <Ionicons name="chevron-forward" size={18} color={cur === total - 1 ? C.muted : C.accent} />
        </TouchableOpacity>
      </View>
      <Text style={st.scrubLbl}>Événement {cur + 1} / {total}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

function EventCard({ event, idx, selected, onPress }: {
  event: TimelineEvent; idx: number; selected: boolean; onPress: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const dot = DOT_COLORS[idx % DOT_COLORS.length];

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress}
      style={[st.evCard, selected && st.evCardSel]}>
      <View style={st.evDotCol}>
        <View style={[st.evDot, { backgroundColor: dot }]} />
        <View style={st.evLine} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={st.evHdr}>
          <View style={{ flex: 1 }}>
            <Text style={st.evTroncon} numberOfLines={1}>{event.tronconNom || 'Observation'}</Text>
            <Text style={st.evDate}>{fmtDate(event.dateDay)}{event.date ? `  ${fmtTime(event.date)}` : ''}</Text>
          </View>
          <View style={st.evBadge}>
            <Text style={[st.evBadgeTxt, { color: pctColor(event.chantierProgress) }]}>
              {Math.round(event.chantierProgress)}%
            </Text>
          </View>
        </View>

        {event.agentNom && (
          <View style={st.evRow}>
            <Ionicons name="person-circle-outline" size={13} color={C.sub} />
            <Text style={st.evMeta}>{event.agentNom}</Text>
          </View>
        )}

        {event.coordinates && (
          <View style={st.evRow}>
            <Ionicons name="location-outline" size={12} color={dot} />
            <Text style={st.evCoords}>
              {event.coordinates.lat.toFixed(5)}, {event.coordinates.lng.toFixed(5)}
            </Text>
          </View>
        )}

        {event.phase && (
          <View style={st.phaseTag}>
            <Text style={st.phaseTagTxt}>{event.phase}</Text>
            {event.phaseStatut ? <Text style={st.phaseStatut}> · {event.phaseStatut}</Text> : null}
          </View>
        )}

        {event.remarques ? (
          <Text style={st.remarques} numberOfLines={expanded ? undefined : 2}>{event.remarques}</Text>
        ) : null}

        {event.photos.length > 0 && (
          <TouchableOpacity style={st.photoToggle} onPress={() => setExpanded(e => !e)}>
            <Ionicons name={expanded ? 'chevron-up' : 'images-outline'} size={14} color={C.blue} />
            <Text style={st.photoToggleTxt}>
              {expanded ? 'Masquer' : `${event.photos.length} photo${event.photos.length > 1 ? 's' : ''}`}
            </Text>
          </TouchableOpacity>
        )}

        {expanded && event.photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
            {event.photos.map(ph => (
              <View key={ph.id} style={{ width: 100, marginRight: 8 }}>
                <Image source={{ uri: getMediaUrl(ph.url) }} style={st.photoImg} resizeMode="cover" />
                {ph.description ? <Text style={st.photoCaption} numberOfLines={1}>{ph.description}</Text> : null}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Tronçon row
// ---------------------------------------------------------------------------

function TronconRow({ t, pct, active }: { t: TimelineTroncon; pct: number; active?: boolean }) {
  const clr = pctColor(pct);
  return (
    <View style={[st.tRow, active && st.tRowActive]}>
      <View style={{ flex: 1, marginRight: 8 }}>
        <Text style={st.tName} numberOfLines={1}>{t.nom}</Text>
        <Text style={st.tPk}>{fmtPK(t.pk_debut)} → {fmtPK(t.pk_fin)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={[st.tPct, { color: clr }]}>{Math.round(pct)}%</Text>
        <View style={st.tBarBg}>
          <View style={[st.tBarFill, { width: `${pct}%` as any, backgroundColor: clr }]} />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main ChantierTimeline
// ---------------------------------------------------------------------------

export interface ChantierTimelineProps {
  chantierId: string | number;
  token: string;
  /**
   * Called whenever the temporal selection changes.
   * The parent uses this to drive both the 2D and 3D GIS renderers.
   * Timeline does NOT directly manipulate Leaflet or Three.js.
   */
  onTemporalChange?: (state: TemporalViewState) => void;
  /**
   * Called once when timeline data loads successfully.
   * The parent caches this to run deriveTemporalState locally.
   */
  onTimelineLoad?: (data: ChantierTimelineResponse) => void;
}

export function ChantierTimeline({ chantierId, token, onTemporalChange, onTimelineLoad }: ChantierTimelineProps) {
  const [data, setData] = useState<ChantierTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [tab, setTab] = useState<'chart' | 'events' | 'troncons'>('chart');
  const [replaying, setReplaying] = useState(false);
  const timerRef = useRef<any>(null);
  const chartW = Math.min(Dimensions.get('window').width - 64, 560);

  const load = useCallback(async () => {
    if (!token || !chantierId || chantierId === 'undefined' || isNaN(Number(chantierId))) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getChantierTimeline(token, chantierId);
      setData(res);
      const lastIdx = res.events.length > 0 ? res.events.length - 1 : 0;
      setIdx(lastIdx);
      // Share raw data with parent for temporal derivation
      onTimelineLoad?.(res);
      // Emit current state after data load
      if (onTemporalChange && res.events.length > 0) {
        const lastEvent = res.events[lastIdx];
        onTemporalChange({
          mode: 'historical',
          selectedDate: lastEvent?.date ?? null,
          replayIndex: lastIdx,
          isPlaying: false,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Impossible de charger la chronologie.');
    } finally {
      setLoading(false);
    }
  }, [token, chantierId, onTemporalChange, onTimelineLoad]);

  useEffect(() => { load(); }, [load]);

  const startReplay = useCallback(() => {
    if (!data || data.events.length === 0) return;
    setIdx(0);
    setReplaying(true);
  }, [data]);

  // Emit temporal state whenever idx changes
  useEffect(() => {
    if (!data || data.events.length === 0 || !onTemporalChange) return;
    const ev = data.events[idx];
    if (!ev) return;
    onTemporalChange({
      mode: 'historical',
      selectedDate: ev.date,
      replayIndex: idx,
      isPlaying: replaying,
    });
  }, [idx, replaying, data, onTemporalChange]);

  useEffect(() => {
    if (!replaying || !data) return;
    timerRef.current = setInterval(() => {
      setIdx(prev => {
        if (prev >= data.events.length - 1) { setReplaying(false); clearInterval(timerRef.current); return prev; }
        return prev + 1;
      });
    }, 700);
    return () => clearInterval(timerRef.current);
  }, [replaying, data]);

  const curEvent = data?.events[idx] ?? null;

  const curSnap = useMemo<TimelineProgressSnapshot | null>(() => {
    if (!data) return null;
    if (!curEvent) return data.progressHistory[data.progressHistory.length - 1] ?? null;
    let best: TimelineProgressSnapshot | null = null;
    for (const sn of data.progressHistory) { if (sn.dateTime <= curEvent.date) best = sn; else break; }
    return best ?? (data.progressHistory[0] ?? null);
  }, [data, idx]);

  const chartIdx = useMemo(() => {
    if (!data || !curEvent) return (data?.progressHistory.length ?? 1) - 1;
    let best = data.progressHistory.length - 1;
    for (let i = 0; i < data.progressHistory.length; i++) {
      if (data.progressHistory[i].dateTime <= curEvent.date) best = i;
    }
    return best;
  }, [data, curEvent]);

  if (loading) return (
    <View style={st.stateBox}>
      <ActivityIndicator size="large" color={C.accent} />
      <Text style={st.stateTxt}>Chargement de la chronologie…</Text>
    </View>
  );

  if (error) return (
    <View style={st.stateBox}>
      <Ionicons name="cloud-offline-outline" size={40} color="#EF4444" />
      <Text style={st.stateTxt}>{error}</Text>
      <TouchableOpacity style={st.retryBtn} onPress={load}>
        <Text style={st.retryTxt}>Réessayer</Text>
      </TouchableOpacity>
    </View>
  );

  if (!data || data.events.length === 0) return (
    <View style={st.stateBox}>
      <Ionicons name="time-outline" size={40} color={C.muted} />
      <Text style={st.stateTxt}>Aucune donnée historique disponible pour ce chantier.</Text>
      <Text style={st.stateSubTxt}>Les observations de terrain créées par les agents apparaîtront ici.</Text>
    </View>
  );

  const totalPhotos = data.events.reduce((s, e) => s + e.photos.length, 0);
  const uniqueDays = new Set(data.events.map(e => e.dateDay)).size;

  return (
    <View style={st.root}>

      {/* Stats */}
      <View style={st.statsRow}>
        {[
          { v: data.events.length, l: 'Observations', c: undefined as string | undefined },
          { v: totalPhotos, l: 'Photos', c: undefined },
          { v: uniqueDays, l: 'Jours actifs', c: undefined },
          { v: `${Math.round(curEvent?.chantierProgress ?? 0)}%`, l: 'Avancement', c: pctColor(curEvent?.chantierProgress ?? 0) },
        ].map((stat, i, arr) => (
          <React.Fragment key={i}>
            <View style={st.statCell}>
              <Text style={[st.statV, stat.c ? { color: stat.c } : {}]}>{stat.v}</Text>
              <Text style={st.statL}>{stat.l}</Text>
            </View>
            {i < arr.length - 1 && <View style={st.statDiv} />}
          </React.Fragment>
        ))}
      </View>

      {/* Replay card */}
      <View style={st.replayCard}>
        <View style={st.replayHdr}>
          <View style={{ flex: 1 }}>
            <Text style={st.replayTitle} weight="bold">Replay Spatio-Temporel</Text>
            {curEvent && (
              <Text style={st.replayMeta}>
                📅 {fmtDate(curEvent.dateDay)}{curEvent.agentNom ? `  · ${curEvent.agentNom}` : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={[st.replayBtn, replaying && { backgroundColor: C.amber }]}
            onPress={() => {
              if (replaying) { setReplaying(false); clearInterval(timerRef.current); }
              else startReplay();
            }}>
            <Ionicons name={replaying ? 'pause' : 'play'} size={15} color="#fff" />
            <Text style={st.replayBtnTxt}>{replaying ? 'Pause' : 'Rejouer'}</Text>
          </TouchableOpacity>
        </View>
        <Scrubber total={data.events.length} cur={idx} onScrub={setIdx} />
      </View>

      {/* Tabs */}
      <View style={st.tabBar}>
        {(['chart', 'events', 'troncons'] as const).map(t => {
          const icons: any = { chart: 'stats-chart', events: 'list', troncons: 'git-branch' };
          const labels = { chart: 'Graphique', events: 'Événements', troncons: 'Tronçons' };
          const active = tab === t;
          return (
            <TouchableOpacity key={t} style={[st.tabItem, active && st.tabActive]} onPress={() => setTab(t)}>
              <Ionicons name={icons[t]} size={15} color={active ? C.accent : C.muted} />
              <Text style={[st.tabLbl, active && st.tabLblA]}>{labels[t]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Chart */}
      {tab === 'chart' && (
        <View style={st.chartCard}>
          <Text style={st.chartTitle} weight="semibold">Avancement Cumulé (non-régressif)</Text>
          <SparklineChart data={data.progressHistory} width={chartW} height={120} curIdx={chartIdx} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={st.chartDate}>{fmtDate(data.temporalBounds.minDate)}</Text>
            <Text style={st.chartDate}>{fmtDate(data.temporalBounds.maxDate)}</Text>
          </View>
          {data.progressHistory.some(sn => sn.isBaseline) && (
            <Text style={st.baseNote}>▸ Le point de départ (0%) correspond à la date de début du chantier.</Text>
          )}
        </View>
      )}

      {/* Events */}
      {tab === 'events' && (
        <ScrollView style={st.listScroll} showsVerticalScrollIndicator={false}>
          {data.events.map((ev, i) => (
            <EventCard key={ev.id} event={ev} idx={i} selected={i === idx} onPress={() => setIdx(i)} />
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      {/* Tronçons */}
      {tab === 'troncons' && (
        <ScrollView style={st.listScroll} showsVerticalScrollIndicator={false}>
          <Text style={st.trHeading}>
            {curEvent ? `État des tronçons au ${fmtDate(curEvent.dateDay)}` : 'État actuel des tronçons'}
          </Text>
          {data.troncons.map(t => (
            <TronconRow key={t.id} t={t}
              pct={curSnap?.tronconsProgress[t.id] ?? 0}
              active={curEvent?.tronconId === t.id} />
          ))}
          <View style={{ height: 32 }} />
        </ScrollView>
      )}

    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const st = StyleSheet.create({
  root: { backgroundColor: C.bg, borderRadius: 16, overflow: 'hidden' },

  // States
  stateBox: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12, backgroundColor: C.bg, borderRadius: 16 },
  stateTxt: { color: C.sub, fontSize: 14, textAlign: 'center', marginTop: 8 },
  stateSubTxt: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 4 },
  retryBtn: { marginTop: 12, backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 9, borderWidth: 1, borderColor: C.accent },
  retryTxt: { color: C.accent, fontSize: 13, fontWeight: '600' },

  // Stats
  statsRow: { flexDirection: 'row', backgroundColor: C.card, paddingVertical: 14, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  statCell: { flex: 1, alignItems: 'center', gap: 2 },
  statV: { color: C.text, fontSize: 18, fontWeight: '700' },
  statL: { color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  statDiv: { width: 1, backgroundColor: C.border, marginVertical: 4 },

  // Replay
  replayCard: { backgroundColor: C.card, margin: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  replayHdr: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  replayTitle: { color: C.text, fontSize: 14 },
  replayMeta: { color: C.sub, fontSize: 12, marginTop: 2 },
  replayBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  replayBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Scrubber
  scrubWrap: { gap: 4 },
  scrubLbl: { color: C.muted, fontSize: 11, textAlign: 'center' },
  scrubEnd: { color: C.muted, fontSize: 10 },
  scrubTrack: { height: 6, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  scrubFill: { height: '100%', backgroundColor: 'rgba(16,185,129,0.5)', borderRadius: 3 },

  // Tabs
  tabBar: { flexDirection: 'row', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginHorizontal: 12, borderRadius: 10, overflow: 'hidden', marginBottom: 8 },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, borderRightWidth: 1, borderRightColor: C.border },
  tabActive: { backgroundColor: C.accentDim },
  tabLbl: { color: C.muted, fontSize: 12, fontWeight: '500' },
  tabLblA: { color: C.accent, fontWeight: '700' },

  // Chart
  chartCard: { backgroundColor: C.card, marginHorizontal: 12, marginBottom: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  chartTitle: { color: C.sub, fontSize: 12, marginBottom: 10 },
  chartDate: { color: C.muted, fontSize: 10 },
  baseNote: { color: C.muted, fontSize: 10, marginTop: 8, fontStyle: 'italic' },

  // List
  listScroll: { maxHeight: 480, paddingHorizontal: 12 },

  // Events
  evCard: { flexDirection: 'row', gap: 10, paddingVertical: 12, paddingRight: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  evCardSel: { backgroundColor: 'rgba(16,185,129,0.06)', borderRadius: 8, paddingHorizontal: 6 },
  evDotCol: { alignItems: 'center', width: 16, paddingTop: 4 },
  evDot: { width: 10, height: 10, borderRadius: 5 },
  evLine: { flex: 1, width: 1.5, backgroundColor: C.border, marginTop: 4 },
  evHdr: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  evTroncon: { color: C.text, fontSize: 13, fontWeight: '700' },
  evDate: { color: C.sub, fontSize: 11, marginTop: 2 },
  evBadge: { borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: 7, paddingVertical: 3, marginLeft: 8, marginTop: 1 },
  evBadgeTxt: { fontSize: 12, fontWeight: '700' },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  evMeta: { color: C.sub, fontSize: 11 },
  evCoords: { color: C.muted, fontSize: 10, fontFamily: Platform.select({ web: 'monospace', default: undefined }) },
  phaseTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(139,92,246,0.12)', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 4 },
  phaseTagTxt: { color: '#8B5CF6', fontSize: 10, fontWeight: '600' },
  phaseStatut: { color: C.sub, fontSize: 10 },
  remarques: { color: C.sub, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  photoToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  photoToggleTxt: { color: C.blue, fontSize: 12, fontWeight: '600' },
  photoImg: { width: 100, height: 70, borderRadius: 6, backgroundColor: C.border },
  photoCaption: { color: C.muted, fontSize: 9, marginTop: 3 },

  // Tronçons
  trHeading: { color: C.sub, fontSize: 12, marginBottom: 10, marginTop: 4, fontStyle: 'italic' },
  tRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 6 },
  tRowActive: { backgroundColor: C.accentDim, borderRadius: 8, paddingHorizontal: 6 },
  tName: { color: C.text, fontSize: 13, fontWeight: '600' },
  tPk: { color: C.muted, fontSize: 10, marginTop: 2 },
  tPct: { fontSize: 14, fontWeight: '700' },
  tBarBg: { width: 72, height: 5, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' },
  tBarFill: { height: '100%', borderRadius: 3 },
});

