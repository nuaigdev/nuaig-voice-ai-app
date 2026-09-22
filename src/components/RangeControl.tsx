'use client';

import { useState } from 'react';
import { DateRangePicker } from './DateRangePicker';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { todayInTz } from '@/lib/time';
import type { DateRange, DateSeg } from '@/types';

const SEGMENTS: { key: Exclude<DateSeg, 'custom'>; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
];

interface RangeControlProps {
  dateSeg: DateSeg;
  onDateSegChange: (seg: DateSeg) => void;
  customLabel: string | null;
  onApplyCustomRange: (range: DateRange) => void;
}

/** Today / 7 / 30 / custom segmented control. The selection is shared by Overview and Call Logs. */
export function RangeControl({ dateSeg, onDateSegChange, customLabel, onApplyCustomRange }: RangeControlProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { timezone } = useClient();

  return (
    <div className="range-control">
      <div className="seg" role="radiogroup" aria-label="Date range">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            role="radio"
            aria-checked={dateSeg === s.key}
            className={dateSeg === s.key ? 'active' : ''}
            onClick={() => onDateSegChange(s.key)}
          >
            {s.label}
          </button>
        ))}
        <button
          role="radio"
          aria-checked={dateSeg === 'custom'}
          className={dateSeg === 'custom' ? 'active' : ''}
          onClick={() => setPickerOpen((v) => !v)}
        >
          <Icon name="calendar" size={14} />
          {dateSeg === 'custom' && customLabel ? customLabel : 'Custom'}
        </button>
      </div>
      <DateRangePicker
        open={pickerOpen}
        today={todayInTz(timezone)}
        onApply={(range) => {
          onApplyCustomRange(range);
          setPickerOpen(false);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </div>
  );
}
