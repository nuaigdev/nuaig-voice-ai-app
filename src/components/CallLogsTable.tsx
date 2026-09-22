'use client';

import { useMemo } from 'react';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { EmptyNote, toneVar } from './ui';
import { callCategoriesFor } from '@/clients/categories';
import { formatClock, humanize, outcomeOf } from '@/lib/callStats';
import { formatInTz } from '@/lib/time';
import type { CallRow } from '@/types';

export function sentimentClass(s: string | null): string {
  if (s === 'Positive') return 'badge badge-pos';
  if (s === 'Negative') return 'badge badge-neg';
  if (s === 'Neutral') return 'badge badge-neu';
  return 'badge badge-muted';
}

function dateParts(iso: string | null, tz: string): { day: string; time: string } {
  if (!iso) return { day: '—', time: '' };
  return {
    day: formatInTz(iso, tz, { month: 'short', day: 'numeric' }),
    time: formatInTz(iso, tz, { hour: 'numeric', minute: '2-digit' }),
  };
}

interface CallLogsTableProps {
  logs: CallRow[];
  compact?: boolean;
  onRowClick: (entry: CallRow) => void;
}

/**
 * Seven columns sized to fit a laptop-width page without horizontal scroll;
 * technical fields (channel, status, disconnect reason, latency, IDs) live in
 * the call detail drawer instead.
 */
export function CallLogsTable({ logs, compact = false, onRowClick }: CallLogsTableProps) {
  const client = useClient();
  const categories = useMemo(() => callCategoriesFor(client), [client]);

  if (logs.length === 0) {
    return <EmptyNote>No calls match this view yet. Try widening the dates or clearing filters.</EmptyNote>;
  }

  return (
    <div className="table-wrap">
      <table className={compact ? 'data-table compact' : 'data-table'}>
        <colgroup>
          <col style={{ width: 118 }} />
          <col style={{ width: 172 }} />
          <col style={{ width: 150 }} />
          <col />
          <col style={{ width: 84 }} />
          <col style={{ width: 108 }} />
          <col style={{ width: 128 }} />
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            <th>When</th>
            <th>Caller</th>
            <th>Category</th>
            <th>Summary</th>
            <th className="num">Duration</th>
            <th>Sentiment</th>
            <th>Outcome</th>
            <th aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {logs.map((entry) => {
            const cat = categories[entry.primary_category];
            const outcome = outcomeOf(entry);
            const when = dateParts(entry.start_time, client.timezone);
            const outbound = entry.direction === 'outbound';
            return (
              <tr
                key={entry.call_id}
                tabIndex={0}
                onClick={() => onRowClick(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onRowClick(entry);
                  }
                }}
              >
                <td>
                  <div className="cell-stack">
                    <b>{when.day}</b>
                    <span>{when.time}</span>
                  </div>
                </td>
                <td>
                  <div className="cell-caller">
                    <span className={`dir-badge ${outbound ? 'out' : 'in'}`} title={outbound ? 'Outbound' : 'Inbound'}>
                      <Icon name={outbound ? 'outbound' : 'inbound'} size={13} strokeWidth={2.2} />
                    </span>
                    <span className="mono truncate">{(outbound ? entry.to_number : entry.from_number) || 'Unknown'}</span>
                  </div>
                </td>
                <td>
                  <span className="cat-chip truncate" style={{ '--chip': toneVar(cat?.tone ?? 'slate') } as React.CSSProperties}>
                    {cat?.label ?? humanize(entry.primary_category)}
                  </span>
                </td>
                <td>
                  <p className="summary-clamp">{entry.call_summary || <span className="muted-note">No summary</span>}</p>
                </td>
                <td className="num mono">{formatClock(entry.duration_sec)}</td>
                <td>
                  <span className={sentimentClass(entry.user_sentiment)}>{entry.user_sentiment || 'Unknown'}</span>
                </td>
                <td>
                  <span className={`status status-${outcome.tone}`}>{outcome.label}</span>
                </td>
                <td className="row-go" aria-hidden="true">
                  <Icon name="chevronRight" size={16} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
