'use client';

import { useEffect, useState } from 'react';
import { Icon } from './icons';
import type { DateRange } from '@/types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const TODAY_REF = new Date(); // real "today" - dates are driven by live Retell data
const TODAY_MS = new Date(TODAY_REF).setHours(0, 0, 0, 0);

type PresetKey = 'today' | '7' | '28' | '90' | 'wtd' | 'mtd' | 'ytd' | 'all';

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7', label: 'Last 7 days' },
  { key: '28', label: 'Last 4 weeks' },
  { key: '90', label: 'Last 3 months' },
  { key: 'wtd', label: 'Week to date' },
  { key: 'mtd', label: 'Month to date' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All time' }
];

function fmt(d: Date): string {
  return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

function presetToRange(key: PresetKey): DateRange {
  const today = new Date(TODAY_REF);
  const start = new Date(today);
  switch (key) {
    case 'today':
      return { start: new Date(today), end: new Date(today) };
    case '7':
      start.setDate(today.getDate() - 6);
      return { start, end: new Date(today) };
    case '28':
      start.setDate(today.getDate() - 27);
      return { start, end: new Date(today) };
    case '90':
      start.setDate(today.getDate() - 89);
      return { start, end: new Date(today) };
    case 'wtd':
      start.setDate(today.getDate() - today.getDay());
      return { start, end: new Date(today) };
    case 'mtd':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: new Date(today) };
    case 'ytd':
      return { start: new Date(today.getFullYear(), 0, 1), end: new Date(today) };
    case 'all':
      return { start: new Date(2020, 0, 1), end: new Date(today) };
  }
}

interface DayCell {
  day: number;
  muted: boolean;
  date: Date;
}

function buildMonthCells(base: Date): DayCell[] {
  const firstDay = new Date(base.getFullYear(), base.getMonth(), 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const daysInPrevMonth = new Date(base.getFullYear(), base.getMonth(), 0).getDate();

  const cells: DayCell[] = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({
      day: daysInPrevMonth - i,
      muted: true,
      date: new Date(base.getFullYear(), base.getMonth() - 1, daysInPrevMonth - i)
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, muted: false, date: new Date(base.getFullYear(), base.getMonth(), d) });
  }
  let nextDay = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: nextDay, muted: true, date: new Date(base.getFullYear(), base.getMonth() + 1, nextDay) });
    nextDay++;
  }
  return cells;
}

interface MiniCalendarProps {
  base: Date;
  range: DateRange;
  picking: 'start' | 'end';
  onPick: (d: Date) => void;
}

function MiniCalendar({ base, range, onPick }: MiniCalendarProps) {
  const cells = buildMonthCells(base);
  const s = new Date(range.start).setHours(0, 0, 0, 0);
  const en = new Date(range.end).setHours(0, 0, 0, 0);

  return (
    <div className="drp-grid">
      {DOW.map((d) => (
        <div className="dow" key={d}>
          {d}
        </div>
      ))}
      {cells.map((c, idx) => {
        const t = new Date(c.date).setHours(0, 0, 0, 0);
        let cls = 'drp-day' + (c.muted ? ' muted' : '');
        if (t === s || t === en) cls += ' range-end';
        if (t === TODAY_MS) cls += ' today';
        else if (t > s && t < en) cls += ' in-range';
        return (
          <button type="button" key={idx} className={cls} onClick={() => onPick(c.date)}>
            {c.day}
          </button>
        );
      })}
    </div>
  );
}

interface DateRangePickerProps {
  open: boolean;
  onApply: (range: DateRange) => void;
  onCancel: () => void;
}

export function DateRangePicker({ open, onApply, onCancel }: DateRangePickerProps) {
  const [viewDate, setViewDate] = useState<Date>(new Date(TODAY_REF.getFullYear(), TODAY_REF.getMonth() - 1, 1));
  const [range, setRange] = useState<DateRange>(presetToRange('28'));
  const [picking, setPicking] = useState<'start' | 'end'>('start');
  const [activePreset, setActivePreset] = useState<PresetKey | null>('28');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const rightMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);

  const handlePick = (d: Date) => {
    if (picking === 'start') {
      setRange({ start: d, end: d });
      setPicking('end');
    } else {
      if (d < range.start) {
        setRange({ start: d, end: range.start });
      } else {
        setRange({ start: range.start, end: d });
      }
      setPicking('start');
    }
    setActivePreset(null); // clear preset highlight on manual pick
  };

  const handlePreset = (key: PresetKey) => {
    const r = presetToRange(key);
    setRange(r);
    setActivePreset(key);
    setViewDate(new Date(r.end.getFullYear(), r.end.getMonth() - 1, 1));
  };

  return (
    <div className="drp" role="dialog" aria-label="Choose a date range">
      <div className="drp-body">
        <div className="drp-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              className={'drp-preset' + (activePreset === p.key ? ' active' : '')}
              onClick={() => handlePreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="drp-cals">
          <div className="drp-cal">
            <div className="drp-cal-head">
              <button
                className="drp-nav"
                aria-label="Previous month"
                onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              >
                <Icon name="chevronLeft" size={16} />
              </button>
              <span>
                {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
              </span>
              <span className="drp-nav-spacer" />
            </div>
            <MiniCalendar base={viewDate} range={range} picking={picking} onPick={handlePick} />
          </div>
          <div className="drp-cal">
            <div className="drp-cal-head">
              <span className="drp-nav-spacer" />
              <span>
                {MONTH_NAMES[rightMonth.getMonth()]} {rightMonth.getFullYear()}
              </span>
              <button
                className="drp-nav"
                aria-label="Next month"
                onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              >
                <Icon name="chevronRight" size={16} />
              </button>
            </div>
            <MiniCalendar base={rightMonth} range={range} picking={picking} onPick={handlePick} />
          </div>
        </div>
      </div>
      <div className="drp-foot">
        <span className="drp-summary">
          <Icon name="calendar" size={14} />
          {fmt(range.start)} – {fmt(range.end)}
        </span>
        <div className="drp-foot-btns">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onApply(range)}>
            Apply range
          </button>
        </div>
      </div>
    </div>
  );
}

export function formatRangeLabel(range: DateRange): string {
  return `${fmt(range.start)} – ${fmt(range.end)}`;
}
