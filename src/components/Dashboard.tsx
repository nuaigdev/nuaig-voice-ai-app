'use client';

import { useMemo, type ReactNode } from 'react';
import { CallLogsTable } from './CallLogsTable';
import { RangeControl } from './RangeControl';
import { BarList, Donut, Sparkline, StackedBar, TrendChart, type Segment } from './charts';
import { Icon, type IconName } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { Card, EmptyNote, ErrorState, PageHeader, toneVar } from './ui';
import { callCategoriesFor } from '@/clients/categories';
import { PRODUCT } from '@/config/product';
import { dailySeries, filterByRange, formatDuration, humanize, previousPeriod, resolveRange, summarize } from '@/lib/callStats';
import { tzAbbrev } from '@/lib/time';
import type { CallRow, DateRange, DateSeg } from '@/types';

const EMPTY_RANGE_NOTE = 'No calls in this window yet. Try widening the date range.';

function Delta({ curr, prev, lowerIsBetter = false, format }: { curr: number; prev: number; lowerIsBetter?: boolean; format: (n: number) => string }) {
  if (prev === 0 && curr === 0) return <span className="delta flat">No change</span>;
  if (prev === 0) return <span className="delta up">New this period</span>;
  const diff = curr - prev;
  if (Math.abs(diff) < 1e-9) return <span className="delta flat">No change</span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`delta ${good ? 'up' : 'down'}`} title="Compared with the previous period of the same length">
      <Icon name={diff > 0 ? 'arrowUpRight' : 'arrowDownRight'} size={13} strokeWidth={2.2} />
      {format(Math.abs(diff))}
    </span>
  );
}

function Kpi({ icon, label, value, children, foot }: { icon: IconName; label: string; value: string; children?: ReactNode; foot: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon name={icon} size={16} />
        </span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {children}
      <div className="kpi-foot">{foot}</div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading call analytics">
      <div className="kpi-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skel" style={{ height: 148 }} />
        ))}
      </div>
      <div className="grid grid-3-1">
        <div className="skel" style={{ height: 300 }} />
        <div className="skel" style={{ height: 300 }} />
      </div>
      <div className="grid grid-3">
        <div className="skel" style={{ height: 260 }} />
        <div className="skel" style={{ height: 260 }} />
        <div className="skel" style={{ height: 260 }} />
      </div>
    </div>
  );
}

interface DashboardProps {
  calls: CallRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenCall: (entry: CallRow, list: CallRow[]) => void;
  onNavigateToCallLogs: () => void;
  dateSeg: DateSeg;
  onDateSegChange: (seg: DateSeg) => void;
  customLabel: string | null;
  customRange: DateRange | null;
  onApplyCustomRange: (range: DateRange) => void;
}

export function Dashboard({
  calls,
  loading,
  error,
  onRetry,
  onOpenCall,
  onNavigateToCallLogs,
  dateSeg,
  onDateSegChange,
  customLabel,
  customRange,
  onApplyCustomRange,
}: DashboardProps) {
  const client = useClient();
  const categories = useMemo(() => callCategoriesFor(client), [client]);

  const tz = client.timezone;
  const range = useMemo(() => resolveRange(dateSeg, customRange, tz), [dateSeg, customRange, tz]);
  const filtered = useMemo(() => filterByRange(calls, range, tz), [calls, range, tz]);
  const stats = useMemo(() => summarize(filtered), [filtered]);
  const prevStats = useMemo(() => summarize(filterByRange(calls, previousPeriod(range), tz)), [calls, range, tz]);
  const series = useMemo(() => dailySeries(calls, range, tz), [calls, range, tz]);

  const recentCalls = useMemo(
    () => [...filtered].sort((a, b) => (b.start_time || '').localeCompare(a.start_time || '')).slice(0, 6),
    [filtered]
  );

  const categoryItems = Object.entries(stats.categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({
      key,
      label: categories[key]?.label ?? humanize(key),
      value,
      color: toneVar(categories[key]?.tone ?? 'slate'),
    }));

  const toolItems = Object.entries(stats.toolUsageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: humanize(key), value }));

  const disconnectionItems = Object.entries(stats.disconnectionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: humanize(key), value, color: 'var(--tone-slate)' }));

  const outcomeSegments: Segment[] = [
    { label: `Resolved by ${PRODUCT.name}`, value: stats.outcome.resolved, color: 'var(--tone-emerald)' },
    { label: 'Transferred to staff', value: stats.outcome.transferred, color: 'var(--tone-amber)' },
    { label: 'Other / no answer', value: stats.outcome.other, color: 'var(--tone-slate)' },
  ];

  const sentimentSegments: Segment[] = [
    { label: 'Positive', value: stats.sentimentCounts.Positive || 0, color: 'var(--tone-emerald)' },
    { label: 'Neutral', value: stats.sentimentCounts.Neutral || 0, color: 'var(--tone-slate)' },
    { label: 'Negative', value: stats.sentimentCounts.Negative || 0, color: 'var(--tone-rose)' },
    { label: 'Unknown', value: stats.sentimentCounts.Unknown || 0, color: 'var(--border-strong)' },
  ];
  const sentimentTotal = sentimentSegments.reduce((a, s) => a + s.value, 0);

  const latency = [
    { label: 'End-to-end', value: stats.avgLatencyMs.e2e, primary: true },
    { label: 'Speech recognition', value: stats.avgLatencyMs.asr },
    { label: 'Language model', value: stats.avgLatencyMs.llm },
    { label: 'Text-to-speech', value: stats.avgLatencyMs.tts },
  ];
  const latencyMax = Math.max(1, ...latency.map((l) => l.value ?? 0));

  const directionItems = Object.entries(stats.directionCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, label: humanize(key), value, color: key === 'inbound' ? 'var(--brand)' : 'var(--tone-indigo)' }));

  const resolvedPct = stats.totalCalls ? Math.round((100 * stats.outcome.resolved) / stats.totalCalls) : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow={`${client.name} · Voice agent performance`}
        title="Overview"
        description={`How the assistant is serving ${client.audience}, live from the voice agent. Times in ${tzAbbrev(tz)}.`}
        actions={
          <RangeControl dateSeg={dateSeg} onDateSegChange={onDateSegChange} customLabel={customLabel} onApplyCustomRange={onApplyCustomRange} />
        }
      />

      {loading && <DashboardSkeleton />}
      {!loading && error && <ErrorState message={error} onRetry={onRetry} />}

      {!loading && !error && (
        <>
          <div className="kpi-grid">
            <Kpi
              icon="calls"
              label="Total calls"
              value={stats.totalCalls.toLocaleString()}
              foot={
                <>
                  <Delta curr={stats.totalCalls} prev={prevStats.totalCalls} format={(n) => Math.round(n).toLocaleString()} />
                  <span>vs previous period</span>
                </>
              }
            >
              <Sparkline points={series.slice(-14).map((p) => p.count)} />
            </Kpi>
            <Kpi
              icon="check"
              label="Success rate"
              value={`${stats.successRatePct.toFixed(1)}%`}
              foot={
                <>
                  <Delta curr={stats.successRatePct} prev={prevStats.successRatePct} format={(n) => `${n.toFixed(1)} pts`} />
                  <span>vs previous period</span>
                </>
              }
            >
              <div className="kpi-meter">
                <div style={{ width: `${Math.min(100, stats.successRatePct)}%` }} />
              </div>
            </Kpi>
            <Kpi
              icon="route"
              label="Transfers to staff"
              value={stats.transferCount.toLocaleString()}
              foot={
                <>
                  <Delta curr={stats.transferCount} prev={prevStats.transferCount} lowerIsBetter format={(n) => Math.round(n).toLocaleString()} />
                  <span>{stats.transferRatePct.toFixed(1)}% of calls</span>
                </>
              }
            />
            <Kpi
              icon="clock"
              label="Avg. call duration"
              value={formatDuration(stats.avgDurationSec)}
              foot={
                <>
                  <Delta curr={stats.avgDurationSec} prev={prevStats.avgDurationSec} format={(n) => `${Math.round(n)}s`} />
                  <span>vs previous period</span>
                </>
              }
            />
          </div>

          <div className="grid grid-3-1">
            <Card title="Call volume" subtitle="Calls per day" action={<span className="pill">{stats.totalCalls.toLocaleString()} in range</span>}>
              <TrendChart points={series} />
            </Card>
            <Card title="Outcomes" subtitle="How calls were handled">
              <div className="outcome-body">
                <Donut segments={outcomeSegments} centerValue={`${resolvedPct}%`} centerLabel="resolved" />
                <ul className="legend">
                  {outcomeSegments.map((s) => (
                    <li key={s.label}>
                      <span>
                        <i className="dot" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <b>{s.value.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>

          <div className="grid grid-3">
            <Card title="Calls by category" subtitle="What residents called about">
              {categoryItems.length ? <BarList items={categoryItems} /> : <EmptyNote>{EMPTY_RANGE_NOTE}</EmptyNote>}
            </Card>
            <Card title="Resident sentiment" subtitle="Detected from each conversation">
              <div className="sentiment-body">
                <div className="sentiment-headline">
                  <b>{sentimentTotal ? Math.round((100 * sentimentSegments[0].value) / sentimentTotal) : 0}%</b>
                  <span>of calls ended positive</span>
                </div>
                <StackedBar segments={sentimentSegments} />
                <ul className="legend legend-grid">
                  {sentimentSegments.map((s) => (
                    <li key={s.label}>
                      <span>
                        <i className="dot" style={{ background: s.color }} />
                        {s.label}
                      </span>
                      <b>{s.value.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
            <Card title="Tools invoked" subtitle="Agent actions during calls">
              {toolItems.length ? <BarList items={toolItems} /> : <EmptyNote>No tools were used in this window.</EmptyNote>}
            </Card>
          </div>

          <div className="grid grid-3">
            <Card title="Voice pipeline" subtitle="Average p50 latency">
              <ul className="latency-list">
                {latency.map((l) => (
                  <li key={l.label} className={l.primary ? 'primary' : ''}>
                    <div className="bar-row-top">
                      <span className="bar-name">{l.label}</span>
                      <span className="bar-value">{l.value != null ? `${Math.round(l.value).toLocaleString()} ms` : '—'}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(100 * (l.value ?? 0)) / latencyMax}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Direction & voicemail" subtitle="Inbound vs. outbound">
              {directionItems.length ? (
                <>
                  <BarList items={directionItems} />
                  <div className="stat-inline">
                    <span>Voicemail rate</span>
                    <b>
                      {stats.voicemailRatePct.toFixed(1)}% <em>({stats.voicemailCount})</em>
                    </b>
                  </div>
                </>
              ) : (
                <EmptyNote>{EMPTY_RANGE_NOTE}</EmptyNote>
              )}
            </Card>
            <Card title="Disconnection reasons" subtitle="Why calls ended">
              {disconnectionItems.length ? <BarList items={disconnectionItems} /> : <EmptyNote>{EMPTY_RANGE_NOTE}</EmptyNote>}
            </Card>
          </div>

          <Card
            className="card-flush"
            title="Recent calls"
            subtitle="Latest conversations in the selected range"
            action={
              <button className="btn btn-ghost btn-sm" onClick={onNavigateToCallLogs}>
                View all calls
                <Icon name="arrowRight" size={15} />
              </button>
            }
          >
            <CallLogsTable logs={recentCalls} compact onRowClick={(entry) => onOpenCall(entry, recentCalls)} />
          </Card>
        </>
      )}
    </div>
  );
}
