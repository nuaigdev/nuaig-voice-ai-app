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

/** NuAIg logo. `tone="auto"` follows the theme; "light"/"dark" force a variant for fixed backgrounds. */
export function NuaigLogo({ height = 20, tone = 'auto' }: { height?: number; tone?: 'auto' | 'light' | 'dark' }) {
  const { logo, name } = PRODUCT.vendor;
  const width = Math.round((logo.width / logo.height) * height);
  if (tone !== 'auto') {
    const src = tone === 'dark' ? logo.dark : logo.light;
    return <Image className="nuaig-logo" src={src} alt={name} width={width} height={height} />;
  }
  return (
    <span className="nuaig-logo">
      <Image className="logo-on-light" src={logo.light} alt={name} width={width} height={height} />
      <Image className="logo-on-dark" src={logo.dark} alt={name} width={width} height={height} />
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
