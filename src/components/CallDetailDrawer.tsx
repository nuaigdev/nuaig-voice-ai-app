'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { sentimentClass } from './CallLogsTable';
import { Icon, type IconName } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { toneVar } from './ui';
import { callCategoriesFor } from '@/clients/categories';
import { PRODUCT } from '@/config/product';
import { formatClock, formatMs, humanize, outcomeOf } from '@/lib/callStats';
import { formatInTz } from '@/lib/time';
import type { CallRow } from '@/types';

interface Turn {
  role: 'agent' | 'user';
  text: string;
}

/** Retell transcripts are "Agent: …\nUser: …" lines; continuation lines attach to the previous turn. */
function parseTranscript(transcript: string): Turn[] | null {
  const turns: Turn[] = [];
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(Agent|User):\s*(.*)$/i);
    if (m) turns.push({ role: m[1].toLowerCase() as Turn['role'], text: m[2] });
    else if (turns.length) turns[turns.length - 1].text += ` ${line}`;
    else return null;
  }
  return turns.length ? turns : null;
}

type Tab = 'overview' | 'transcript' | 'details';

function Stat({ icon, label, value, tone }: { icon: IconName; label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="cd-stat" style={tone ? ({ '--stat': tone } as React.CSSProperties) : undefined}>
      <span className="cd-stat-icon">
        <Icon name={icon} size={16} />
      </span>
      <div>
        <span className="cd-stat-label">{label}</span>
        <b className="cd-stat-value">{value}</b>
      </div>
    </div>
  );
}

function DetailRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="cd-row">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{children}</dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="cd-copy"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      aria-label="Copy call ID"
    >
      <Icon name={copied ? 'check' : 'file'} size={13} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function sentimentTone(s: string | null): string {
  if (s === 'Positive') return 'var(--tone-emerald)';
  if (s === 'Negative') return 'var(--tone-rose)';
  return 'var(--tone-slate)';
}

function CallDetail({ entry }: { entry: CallRow }) {
  const client = useClient();
  const categories = useMemo(() => callCategoriesFor(client), [client]);
  const turns = useMemo(() => (entry.transcript ? parseTranscript(entry.transcript) : null), [entry.transcript]);
  const [tab, setTab] = useState<Tab>('overview');

  const cat = categories[entry.primary_category];
  const tools = entry.tools_used ? entry.tools_used.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const latency = [
    { label: 'End-to-end', value: entry.latency_e2e_p50_ms },
    { label: 'Speech recognition', value: entry.latency_asr_p50_ms },
    { label: 'Language model', value: entry.latency_llm_p50_ms },
    { label: 'Text-to-speech', value: entry.latency_tts_p50_ms },
  ];
  const latencyMax = Math.max(1, ...latency.map((l) => l.value ?? 0));

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'transcript', label: 'Transcript', count: turns?.length },
    { key: 'details', label: 'Details' },
  ];

  return (
    <>
      <div className="cd-stats">
        <Stat icon="clock" label="Duration" value={<span className="mono">{formatClock(entry.duration_sec)}</span>} />
        <Stat icon="sparkle" label="Sentiment" value={entry.user_sentiment || 'Unknown'} tone={sentimentTone(entry.user_sentiment)} />
        <Stat icon="pulse" label="Latency (p50)" value={<span className="mono">{formatMs(entry.latency_e2e_p50_ms)}</span>} />
        <Stat
          icon={entry.call_successful ? 'check' : 'alert'}
          label="Successful"
          value={entry.call_successful == null ? '—' : entry.call_successful ? 'Yes' : 'No'}
          tone={entry.call_successful ? 'var(--tone-emerald)' : entry.call_successful === false ? 'var(--tone-amber)' : undefined}
        />
      </div>

      <div className="cd-tabs" role="tablist" aria-label="Call detail sections">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={'cd-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count != null && <span className="tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="cd-body">
        {tab === 'overview' && (
          <>
            <section className="cd-summary">
              <h5>
                <Icon name="sparkle" size={15} />
                AI summary
              </h5>
              <p>{entry.call_summary || 'No summary available for this call.'}</p>
            </section>

            {entry.recording_url ? (
              <section className="cd-card">
                <div className="cd-card-head">
                  <h5>
                    <Icon name="headset" size={15} />
                    Recording
                  </h5>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={`/api/download-recording?call_id=${encodeURIComponent(entry.call_id)}`}
                    download
                  >
                    <Icon name="download" size={15} />
                    Download
                  </a>
                </div>
                <audio className="audio" controls preload="none" src={entry.recording_url} />
              </section>
            ) : (
              <section className="cd-card cd-card-muted">
                <Icon name="headset" size={16} />
                No recording is available for this call.
              </section>
            )}

            <section className="cd-card">
              <h5>
                <Icon name="route" size={15} />
                What {PRODUCT.name} did
              </h5>
              {tools.length ? (
                <ul className="cd-tools">
                  {tools.map((t) => (
                    <li key={t}>
                      <Icon name={t === 'transfer_call' ? 'route' : 'check'} size={13} strokeWidth={2.2} />
                      {humanize(t)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-note">Answered in conversation; no tools were used.</p>
              )}
              {entry.had_transfer && (
                <p className="cd-transfer">
                  <Icon name="calls" size={14} />
                  Transferred to staff{entry.transfer_destination ? ` at ${entry.transfer_destination}` : ''}
                </p>
              )}
            </section>

            {turns && turns.length > 0 && (
              <button className="cd-peek" onClick={() => setTab('transcript')}>
                <span>
                  <b>{turns[0].role === 'agent' ? PRODUCT.name : 'Caller'}:</b> {turns[0].text}
                </span>
                <span className="cd-peek-cta">
                  Read transcript <Icon name="arrowRight" size={14} />
                </span>
              </button>
            )}
          </>
        )}

        {tab === 'transcript' && (
          <>
            {!entry.transcript && <p className="empty-note">No transcript available for this call.</p>}
            {entry.transcript && turns && (
              <ol className="cd-transcript">
                {turns.map((t, i) => (
                  <li key={i} className={`cd-turn cd-turn-${t.role}`}>
                    <span className="cd-turn-avatar" aria-hidden="true">
                      {t.role === 'agent' ? 'N' : <Icon name="user" size={14} />}
                    </span>
                    <div className="cd-turn-body">
                      <span className="cd-turn-who">{t.role === 'agent' ? PRODUCT.name : 'Caller'}</span>
                      <p>{t.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {entry.transcript && !turns && <p className="cd-raw">{entry.transcript}</p>}
          </>
        )}

        {tab === 'details' && (
          <>
            <section className="cd-card">
              <h5>Call</h5>
              <dl className="cd-rows">
                <DetailRow label="Call ID" mono>
                  <span className="break">{entry.call_id}</span>
                  <CopyButton value={entry.call_id} />
                </DetailRow>
                <DetailRow label="Category">{cat?.label ?? humanize(entry.primary_category)}</DetailRow>
                <DetailRow label="Direction">{entry.direction ? humanize(entry.direction) : '—'}</DetailRow>
                <DetailRow label="From" mono>
                  {entry.from_number || '—'}
                </DetailRow>
                <DetailRow label="To" mono>
                  {entry.to_number || '—'}
                </DetailRow>
                <DetailRow label="Channel">{entry.call_type ? humanize(entry.call_type) : '—'}</DetailRow>
                <DetailRow label="Status">{entry.call_status ? humanize(entry.call_status) : '—'}</DetailRow>
                <DetailRow label="Disconnect reason">{entry.disconnection_reason ? humanize(entry.disconnection_reason) : '—'}</DetailRow>
                <DetailRow label="Reached voicemail">{entry.in_voicemail == null ? '—' : entry.in_voicemail ? 'Yes' : 'No'}</DetailRow>
                {entry.agent_name && <DetailRow label="Agent">{entry.agent_name}</DetailRow>}
              </dl>
            </section>
            <section className="cd-card">
              <h5>Voice pipeline latency (p50)</h5>
              <ul className="latency-list">
                {latency.map((l, i) => (
                  <li key={l.label} className={i === 0 ? 'primary' : ''}>
                    <div className="bar-row-top">
                      <span className="bar-name">{l.label}</span>
                      <span className="bar-value">{formatMs(l.value)}</span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(100 * (l.value ?? 0)) / latencyMax}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              {entry.latency_e2e_p90_ms != null && <p className="muted-note">End-to-end p90: {formatMs(entry.latency_e2e_p90_ms)}</p>}
            </section>
          </>
        )}
      </div>
    </>
  );
}

interface CallDetailDrawerProps {
  entry: CallRow | null;
  position: { index: number; total: number } | null;
  onStep: (delta: number) => void;
  onClose: () => void;
}

export function CallDetailDrawer({ entry, position, onStep, onClose }: CallDetailDrawerProps) {
  const client = useClient();
  const categories = useMemo(() => callCategoriesFor(client), [client]);

  useEffect(() => {
    if (!entry) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, audio')) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowUp' || e.key === 'k') onStep(-1);
      else if (e.key === 'ArrowDown' || e.key === 'j') onStep(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [entry, onClose, onStep]);

  const cat = entry ? categories[entry.primary_category] : undefined;
  const outcome = entry ? outcomeOf(entry) : null;
  const outbound = entry?.direction === 'outbound';
  const counterpart = entry ? (outbound ? entry.to_number : entry.from_number) : null;

  return (
    <div className={'overlay' + (entry ? ' open' : '')} onClick={(e) => e.target === e.currentTarget && onClose()} aria-hidden={!entry}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Call details">
        {entry && outcome && (
          <>
            <header className="cd-hero">
              <div className="cd-hero-bar">
                {position && position.total > 1 ? (
                  <div className="cd-stepper">
                    <button className="icon-btn icon-btn-sm" onClick={() => onStep(-1)} disabled={position.index === 0} aria-label="Previous call" title="Previous call (↑)">
                      <Icon name="chevronUp" size={16} />
                    </button>
                    <button
                      className="icon-btn icon-btn-sm"
                      onClick={() => onStep(1)}
                      disabled={position.index >= position.total - 1}
                      aria-label="Next call"
                      title="Next call (↓)"
                    >
                      <Icon name="chevronDown" size={16} />
                    </button>
                    <span>
                      Call {position.index + 1} of {position.total.toLocaleString()}
                    </span>
                  </div>
                ) : (
                  <span />
                )}
                <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close call details" title="Close (Esc)">
                  <Icon name="x" size={17} />
                </button>
              </div>

              <div className="cd-identity">
                <span className={`cd-avatar ${outbound ? 'out' : 'in'}`}>
                  <Icon name={outbound ? 'outbound' : 'inbound'} size={20} strokeWidth={2} />
                </span>
                <div>
                  <h3 className="mono">{counterpart || 'Unknown caller'}</h3>
                  <p>
                    {outbound ? 'Outbound call' : 'Inbound call'}
                    {entry.start_time &&
                      ` · ${formatInTz(entry.start_time, client.timezone, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        timeZoneName: 'short',
                      })}`}
                  </p>
                </div>
              </div>

              <div className="cd-tags">
                <span className={`status status-${outcome.tone}`}>{outcome.label}</span>
                <span className="cat-chip" style={{ '--chip': toneVar(cat?.tone ?? 'slate') } as React.CSSProperties}>
                  {cat?.label ?? humanize(entry.primary_category)}
                </span>
                <span className={sentimentClass(entry.user_sentiment)}>{entry.user_sentiment || 'Unknown'}</span>
              </div>
            </header>

            <CallDetail key={entry.call_id} entry={entry} />
          </>
        )}
      </aside>
    </div>
  );
}
