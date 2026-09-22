import type { CallRow, DateRange, DateSeg } from '@/types';
import { addDays, dateKey, dayKeyInTz, daysBetween, todayInTz } from './time';

/** Calls whose start falls on a calendar day inside `range`, judged in the client's time zone. */
export function filterByRange(rows: CallRow[], range: DateRange | null, tz: string): CallRow[] {
  if (!range) return rows;
  const startKey = dateKey(range.start);
  const endKey = dateKey(range.end);
  return rows.filter((r) => {
    if (!r.start_time) return false;
    const key = dayKeyInTz(r.start_time, tz);
    return key >= startKey && key <= endKey;
  });
}

export function filterByDirection(rows: CallRow[], direction: string | null): CallRow[] {
  if (!direction) return rows;
  return rows.filter((r) => (r.direction || '').toLowerCase() === direction.toLowerCase());
}

export function filterBySentiment(rows: CallRow[], sentiment: string | null): CallRow[] {
  if (!sentiment) return rows;
  return rows.filter((r) => (r.user_sentiment || 'Unknown') === sentiment);
}

function countBy(rows: CallRow[], pick: (r: CallRow) => string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const key = pick(r) || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export interface AvgLatencyMs {
  e2e: number | null;
  asr: number | null;
  llm: number | null;
  tts: number | null;
}

export interface CallStatsSummary {
  totalCalls: number;
  avgDurationSec: number;
  transferCount: number;
  transferRatePct: number;
  successRatePct: number;
  categoryCounts: Record<string, number>;
  sentimentCounts: Record<string, number>;
  disconnectionCounts: Record<string, number>;
  directionCounts: Record<string, number>;
  outcome: { resolved: number; transferred: number; other: number };
  voicemailCount: number;
  voicemailRatePct: number;
  avgLatencyMs: AvgLatencyMs;
  toolUsageCounts: Record<string, number>;
}

function avgOf(rows: CallRow[], pick: (r: CallRow) => number | null | undefined): number | null {
  const values = rows.map(pick).filter((v): v is number => v != null);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function toolUsageCountsOf(rows: CallRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.tools_used) continue;
    for (const tool of r.tools_used.split(',').map((t) => t.trim()).filter(Boolean)) {
      counts[tool] = (counts[tool] || 0) + 1;
    }
  }
  return counts;
}

export function summarize(rows: CallRow[]): CallStatsSummary {
  const total = rows.length;
  const durations = rows.map((r) => r.duration_sec).filter((v): v is number => v != null);
  const transferCount = rows.filter((r) => r.had_transfer).length;
  const successCount = rows.filter((r) => r.call_successful === true).length;
  const voicemailCount = rows.filter((r) => r.in_voicemail === true).length;

  let resolved = 0;
  let transferred = 0;
  for (const r of rows) {
    if (r.had_transfer) transferred += 1;
    else if (r.call_successful) resolved += 1;
  }

  return {
    totalCalls: total,
    avgDurationSec: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    transferCount,
    transferRatePct: total ? (100 * transferCount) / total : 0,
    successRatePct: total ? (100 * successCount) / total : 0,
    categoryCounts: countBy(rows, (r) => r.primary_category),
    sentimentCounts: countBy(rows, (r) => r.user_sentiment),
    disconnectionCounts: countBy(rows, (r) => r.disconnection_reason),
    directionCounts: countBy(rows, (r) => r.direction),
    outcome: { resolved, transferred, other: total - resolved - transferred },
    voicemailCount,
    voicemailRatePct: total ? (100 * voicemailCount) / total : 0,
    avgLatencyMs: {
      e2e: avgOf(rows, (r) => r.latency_e2e_p50_ms),
      asr: avgOf(rows, (r) => r.latency_asr_p50_ms),
      llm: avgOf(rows, (r) => r.latency_llm_p50_ms),
      tts: avgOf(rows, (r) => r.latency_tts_p50_ms),
    },
    toolUsageCounts: toolUsageCountsOf(rows),
  };
}

export interface DailyVolumePoint {
  date: string;
  count: number;
}

export function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function humanize(s: string): string {
  return s
    .replace(/_/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Calendar range for a quick segment, anchored on "today" in the client's time zone. */
export function segmentToRange(seg: 'today' | '7' | '30', tz: string): DateRange {
  const end = todayInTz(tz);
  if (seg === '7') return { start: addDays(end, -6), end };
  if (seg === '30') return { start: addDays(end, -29), end };
  return { start: end, end };
}

/** The same number of days immediately before `range`. */
export function previousPeriod(range: DateRange): DateRange {
  const span = daysBetween(range.start, range.end) + 1;
  return { start: addDays(range.start, -span), end: addDays(range.start, -1) };
}

export function resolveRange(seg: DateSeg, customRange: DateRange | null, tz: string): DateRange {
  if (seg === 'custom') return customRange ?? segmentToRange('30', tz);
  return segmentToRange(seg, tz);
}

/** Days before the range end that the trend chart always shows, even for "Today". */
const MIN_SERIES_DAYS = 7;
/** Longest trend the chart draws; older days in very long ranges are dropped. */
const MAX_SERIES_DAYS = 120;

function seriesStart(range: DateRange): Date {
  const minStart = addDays(range.end, -(MIN_SERIES_DAYS - 1));
  const maxStart = addDays(range.end, -(MAX_SERIES_DAYS - 1));
  if (range.start > minStart) return minStart;
  if (range.start < maxStart) return maxStart;
  return range.start;
}

/**
 * The calendar window the UI needs data for: the selected range, the
 * previous period (for deltas), and the trend chart's minimum week.
 */
export function dataWindow(range: DateRange): DateRange {
  const prev = previousPeriod(range);
  const series = seriesStart(range);
  return { start: prev.start < series ? prev.start : series, end: range.end };
}

/**
 * Calls per day (in the client's time zone) across the range, zero-filled so
 * quiet days show as gaps in the chart rather than being skipped.
 */
export function dailySeries(rows: CallRow[], range: DateRange, tz: string): DailyVolumePoint[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.start_time) continue;
    const key = dayKeyInTz(r.start_time, tz);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const points: DailyVolumePoint[] = [];
  for (let d = seriesStart(range); d <= range.end; d = addDays(d, 1)) {
    const key = dateKey(d);
    points.push({ date: key, count: counts.get(key) || 0 });
  }
  return points;
}

export function formatClock(sec: number | null): string {
  if (sec == null) return '—';
  return formatDuration(sec);
}

export function formatMs(ms: number | null): string {
  return ms == null ? '—' : `${Math.round(ms).toLocaleString()} ms`;
}

/** Short, table-friendly outcome for a call. */
export function outcomeOf(r: CallRow): { label: string; tone: 'success' | 'transfer' | 'muted' } {
  if (r.had_transfer) return { label: 'Transferred', tone: 'transfer' };
  if (r.call_successful) return { label: 'Resolved', tone: 'success' };
  if (r.in_voicemail) return { label: 'Voicemail', tone: 'muted' };
  return { label: r.call_status ? humanize(r.call_status) : 'Unknown', tone: 'muted' };
}
