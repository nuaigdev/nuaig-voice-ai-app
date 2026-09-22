// Time-zone handling. Calls are bucketed and displayed in the client
// community's time zone (ClientConfig.timezone), not the viewer's browser
// zone, so "today" and daily charts mean the same thing for every viewer.
//
// Date ranges (DateRange) are *calendar dates*: Date objects whose local
// year/month/day are the meaningful part. They're compared with calls via
// "YYYY-MM-DD" day keys computed in the client's zone, which avoids any
// offset arithmetic and is safe across DST changes.

import type { DateRange } from '@/types';

const keyFormatters = new Map<string, Intl.DateTimeFormat>();

function keyFormatter(tz: string): Intl.DateTimeFormat {
  let f = keyFormatters.get(tz);
  if (!f) {
    // en-CA formats dates as YYYY-MM-DD.
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    keyFormatters.set(tz, f);
  }
  return f;
}

/** "YYYY-MM-DD" for an instant, as seen in `tz`. */
export function dayKeyInTz(instant: string | number | Date, tz: string): string {
  return keyFormatter(tz).format(new Date(instant));
}

/** "YYYY-MM-DD" for a calendar Date (its local fields). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Today's calendar date in `tz`. */
export function todayInTz(tz: string): Date {
  return keyToDate(dayKeyInTz(Date.now(), tz));
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** Whole calendar days from a to b (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);
}

/**
 * Epoch-ms bounds to request from the server for a calendar range. Padded by
 * 14h each side so it covers the range in any time zone; the client then
 * filters precisely by day key.
 */
export function fetchBounds(range: DateRange): { from: number; to: number } {
  const pad = 14 * 3_600_000;
  const s = range.start;
  const e = range.end;
  return {
    from: Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()) - pad,
    to: Date.UTC(e.getFullYear(), e.getMonth(), e.getDate() + 1) + pad,
  };
}

export function formatInTz(instant: string | number | Date, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(instant).toLocaleString('en-US', { ...opts, timeZone: tz });
}

/** Short zone label for an instant, e.g. "EDT". */
export function tzAbbrev(tz: string, instant: number = Date.now()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date(instant))
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? tz;
}

/** Longest range a viewer can select; the fetch also covers the same span before it for comparisons. */
export const MAX_RANGE_DAYS = 366;

/** Offset of `tz` from UTC at an instant, in ms (e.g. -4h for EDT). */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Epoch ms of 00:00 on a calendar date in `tz` (two passes settle DST edges). */
function zonedMidnight(d: Date, tz: string): number {
  const guess = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/** Exact epoch-ms bounds of a calendar range in `tz`: start-of-day to end-of-day inclusive. */
export function exactBounds(range: DateRange, tz: string): { from: number; to: number } {
  return { from: zonedMidnight(range.start, tz), to: zonedMidnight(addDays(range.end, 1), tz) - 1 };
}
