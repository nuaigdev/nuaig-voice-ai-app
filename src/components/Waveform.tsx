// The NuVA signature element: a small set of bars whose heights are
// deterministically derived from a seed string, so the same call/agent
// always renders the same "voiceprint" glyph. This is a stylized rhythm
// mark, not a rendering of real recorded audio.
function barsFromSeed(seed: string, count: number): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  }
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    bars.push(0.28 + ((h >> 8) % 1000) / 1000 * 0.72);
  }
  return bars;
}

interface WaveformProps {
  seed?: string;
  bars?: number;
  size?: 'sm' | 'md' | 'lg';
  live?: boolean;
  className?: string;
}

export function Waveform({ seed = 'nuva', bars = 7, size = 'md', live = false, className = '' }: WaveformProps) {
  const heights = barsFromSeed(seed, bars);
  return (
    <div className={`waveform waveform-${size}${live ? ' waveform-live' : ''} ${className}`.trim()} aria-hidden="true">
      {heights.map((h, i) => (
        <span
          key={i}
          style={{ '--bar': h, animationDelay: live ? `${i * 85}ms` : undefined } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
