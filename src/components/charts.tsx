'use client';

import { useEffect, useId, useRef, useState } from 'react';

function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= n / 4)! * pow;
  return Math.ceil(n / step) * step;
}

function shortDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Daily call volume: area + line, y gridlines, x date labels, hover readout. */
export function TrendChart({ points, height = 220 }: { points: { date: string; count: number }[]; height?: number }) {
  const [wrapRef, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId();

  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 26;
  const innerW = Math.max(0, width - padL - padR);
  const innerH = height - padT - padB;
  const max = niceMax(Math.max(0, ...points.map((p) => p.count)));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : innerW / 2),
    y: padT + innerH - (p.count / max) * innerH,
  }));
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const baseY = padT + innerH;
  const area = coords.length ? `${line} L${coords[coords.length - 1].x.toFixed(1)},${baseY} L${coords[0].x.toFixed(1)},${baseY} Z` : '';
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 64))));

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padL;
    const i = stepX ? Math.round(x / stepX) : 0;
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  };

  const hc = hover != null ? coords[hover] : null;

  return (
    <div className="trend-chart" ref={wrapRef} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Daily call volume for the selected range"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => {
            const y = padT + innerH - t * innerH;
            return (
              <g key={t}>
                <line x1={padL} x2={width - padR} y1={y} y2={y} className="chart-grid" />
                <text x={padL - 8} y={y + 4} textAnchor="end" className="chart-label">
                  {Math.round(max * t)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) =>
            i % labelEvery === 0 || i === points.length - 1 ? (
              <text
                key={p.date}
                x={coords[i].x}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
                className="chart-label"
              >
                {shortDate(p.date)}
              </text>
            ) : null
          )}
          <path d={area} fill={`url(#${gradId})`} />
          <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
          {hc && (
            <g>
              <line x1={hc.x} x2={hc.x} y1={padT} y2={baseY} className="chart-guide" />
              <circle cx={hc.x} cy={hc.y} r={4.5} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2.25} />
            </g>
          )}
        </svg>
      )}
      {hover != null && hc && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(hc.x, 60), width - 60), top: Math.max(hc.y - 12, 0) }}>
          <b>{points[hover].count}</b> {points[hover].count === 1 ? 'call' : 'calls'}
          <span>{shortDate(points[hover].date)}</span>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points }: { points: number[] }) {
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : 0;
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="var(--brand)" opacity={0.1} />
      <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
    </svg>
  );
}

export interface Segment {
  label: string;
  value: number;
  color: string;
}

export function Donut({ segments, centerLabel, centerValue }: { segments: Segment[]; centerLabel: string; centerValue: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = 15.9155; // circumference = 100
  let offset = 25;
  return (
    <div className="donut">
      <svg viewBox="0 0 42 42" role="img" aria-label={`${centerLabel}: ${centerValue}`}>
        <circle cx={21} cy={21} r={r} fill="none" stroke="var(--track)" strokeWidth={5} />
        {total > 0 &&
          segments.map((s) => {
            const pct = (100 * s.value) / total;
            if (pct <= 0) return null;
            const el = (
              <circle
                key={s.label}
                cx={21}
                cy={21}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={5}
                strokeDasharray={`${Math.max(0, pct - 0.6)} ${100 - Math.max(0, pct - 0.6)}`}
                strokeDashoffset={offset}
              />
            );
            offset -= pct;
            return el;
          })}
      </svg>
      <div className="donut-center">
        <b>{centerValue}</b>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

export function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  return (
    <div className="stacked-bar" role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(', ')}>
      {total === 0 ? (
        <div style={{ width: '100%', background: 'var(--track)' }} />
      ) : (
        segments.map((s) =>
          s.value > 0 ? <div key={s.label} style={{ width: `${(100 * s.value) / total}%`, background: s.color }} title={`${s.label}: ${s.value}`} /> : null
        )
      )}
    </div>
  );
}

export function BarList({ items }: { items: { key: string; label: string; value: number; color?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((a, i) => a + i.value, 0);
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.key}>
          <div className="bar-row-top">
            <span className="bar-name">
              {item.color && <i className="dot" style={{ background: item.color }} />}
              {item.label}
            </span>
            <span className="bar-value">
              {item.value.toLocaleString()}
              <em>{total ? Math.round((100 * item.value) / total) : 0}%</em>
            </span>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(100 * item.value) / max}%`, background: item.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
