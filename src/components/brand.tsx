'use client';

// Brand marks. Light/dark logo variants are both rendered and swapped in CSS
// ([data-theme] on <html>), so the right one paints without a hydration flash.

import Image from 'next/image';
import { PRODUCT } from '@/config/product';
import { useClient } from './providers/ClientConfigProvider';

export function ClientLogo({ height = 40, className = '' }: { height?: number; className?: string }) {
  const { name, logo } = useClient();
  const width = Math.round((logo.width / logo.height) * height);
  const alt = `${name} logo`;
  return (
    <span className={`client-logo ${logo.dark ? '' : 'needs-plate'} ${className}`.trim()}>
      <Image className="logo-on-light" src={logo.light} alt={alt} width={width} height={height} priority />
      {logo.dark && <Image className="logo-on-dark" src={logo.dark} alt={alt} width={width} height={height} priority />}
    </span>
  );
}

/**
 * The NuVA wordmark: the product name set in its own display face with the
 * signature gradient. `onDark` switches to the bright gradient for fixed dark
 * surfaces (the sign-in brand panel) regardless of theme.
 */
export function NuvaMark({ size = 'md', subtitle, onDark = false }: { size?: 'sm' | 'md' | 'lg' | 'xl'; subtitle?: string; onDark?: boolean }) {
  return (
    <span className={`nuva-mark nuva-mark-${size}${onDark ? ' on-dark' : ''}`}>
      <span className="nuva-word" aria-label={PRODUCT.name}>
        {PRODUCT.name}
      </span>
      {subtitle && <span className="nuva-sub">{subtitle}</span>}
    </span>
  );
}
