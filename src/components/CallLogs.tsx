'use client';

import { useMemo, useState } from 'react';
import { CallLogsTable } from './CallLogsTable';
import { RangeControl } from './RangeControl';
import { Icon } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { ErrorState, PageHeader } from './ui';
import { callCategoriesFor } from '@/clients/categories';
import { PRODUCT } from '@/config/product';
import { filterByDirection, filterByRange, filterBySentiment, resolveRange } from '@/lib/callStats';
import type { CallRow, DateRange, DateSeg } from '@/types';

const PAGE_SIZE = 25;

interface CallLogsProps {
  calls: CallRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  fullScreen: boolean;
  onToggleFullScreen: () => void;
  onOpenCall: (entry: CallRow, list: CallRow[]) => void;
  dateSeg: DateSeg;
  onDateSegChange: (seg: DateSeg) => void;
  customLabel: string | null;
  customRange: DateRange | null;
  onApplyCustomRange: (range: DateRange) => void;
}

function toCsv(rows: CallRow[]): string {
  const headers = [
    'call_id',
    'start_time',
    'duration_sec',
    'call_type',
    'primary_category',
    'disconnection_reason',
    'call_status',
    'user_sentiment',
    'from_number',
    'to_number',
    'direction',
    'had_transfer',
    'call_summary',
  ];
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => escape(r[h as keyof CallRow])).join(','));
  }
  return lines.join('\n');
}

function downloadCsv(rows: CallRow[], clientId: string) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${clientId}_call_logs_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function matchesQuery(r: CallRow, q: string): boolean {
  return [r.from_number, r.to_number, r.call_id, r.call_summary, r.transcript].some((v) => v?.toLowerCase().includes(q));
}

export function CallLogs({
  calls,
  loading,
  error,
  onRetry,
  fullScreen,
  onToggleFullScreen,
  onOpenCall,
  dateSeg,
  onDateSegChange,
  customLabel,
  customRange,
  onApplyCustomRange,
}: CallLogsProps) {
  const client = useClient();
  const categories = useMemo(() => callCategoriesFor(client), [client]);
  const [direction, setDirection] = useState<string | null>(null);
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const range = useMemo(() => resolveRange(dateSeg, customRange), [dateSeg, customRange]);

  const filtered = useMemo(() => {
    let rows = filterByRange(calls, range);
    rows = filterByDirection(rows, direction);
    rows = filterBySentiment(rows, sentiment);
    if (category) rows = rows.filter((r) => r.primary_category === category);
    const q = query.trim().toLowerCase();
    if (q) rows = rows.filter((r) => matchesQuery(r, q));
    return [...rows].sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
  }, [calls, range, direction, sentiment, category, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasFilters = Boolean(direction || sentiment || category || query);

  // Any filter change sends the viewer back to the first page.
  const withReset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(0);
    };

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${client.name} · Conversations`}
        title="Call Logs"
        description={`Every conversation ${PRODUCT.name} has had with ${client.audience}. Select a call for the summary, transcript, and recording.`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => downloadCsv(filtered, client.id)} disabled={!filtered.length}>
              <Icon name="download" size={16} />
              Export CSV
            </button>
            <button className="btn btn-secondary" onClick={onToggleFullScreen}>
              <Icon name={fullScreen ? 'collapse' : 'expand'} size={16} />
              {fullScreen ? 'Exit full screen' : 'Full screen'}
            </button>
          </>
        }
      />

      <div className="card card-flush">
        <div className="toolbar">
          <RangeControl
            dateSeg={dateSeg}
            onDateSegChange={withReset(onDateSegChange)}
            customLabel={customLabel}
            onApplyCustomRange={withReset(onApplyCustomRange)}
          />
          <label className="search">
            <Icon name="search" size={16} />
            <input
              type="search"
              placeholder="Search number, call ID, summary…"
              value={query}
              onChange={(e) => withReset(setQuery)(e.target.value)}
              aria-label="Search calls"
            />
          </label>
          <div className="toolbar-filters">
            <select className="select" aria-label="Filter by category" value={category ?? ''} onChange={(e) => withReset(setCategory)(e.target.value || null)}>
              <option value="">All categories</option>
              {Object.entries(categories).map(([key, c]) => (
                <option key={key} value={key}>
                  {c.label}
                </option>
              ))}
            </select>
            <select className="select" aria-label="Filter by direction" value={direction ?? ''} onChange={(e) => withReset(setDirection)(e.target.value || null)}>
              <option value="">All directions</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <select className="select" aria-label="Filter by sentiment" value={sentiment ?? ''} onChange={(e) => withReset(setSentiment)(e.target.value || null)}>
              <option value="">All sentiment</option>
              <option value="Positive">Positive</option>
              <option value="Neutral">Neutral</option>
              <option value="Negative">Negative</option>
              <option value="Unknown">Unknown</option>
            </select>
            {hasFilters && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setDirection(null);
                  setSentiment(null);
                  setCategory(null);
                  setQuery('');
                  setPage(0);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {loading && (
          <div className="table-skeleton" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skel" style={{ height: 40 }} />
            ))}
          </div>
        )}
        {!loading && error && <ErrorState message={error} onRetry={onRetry} />}
        {!loading && !error && (
          <>
            <CallLogsTable logs={pageRows} onRowClick={(entry) => onOpenCall(entry, filtered)} />
            <div className="pager">
              <span>
                {filtered.length === 0
                  ? 'No calls'
                  : `Showing ${(currentPage * PAGE_SIZE + 1).toLocaleString()}–${Math.min(filtered.length, (currentPage + 1) * PAGE_SIZE).toLocaleString()} of ${filtered.length.toLocaleString()} calls`}
              </span>
              <div className="pager-btns">
                <button className="icon-btn" aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                  <Icon name="chevronLeft" size={16} />
                </button>
                <span className="pager-page">
                  {currentPage + 1} / {pageCount}
                </span>
                <button className="icon-btn" aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
