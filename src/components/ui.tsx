'use client';

import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import type { Tone } from '@/types';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-heading">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  action,
  className = '',
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`card ${className}`.trim()}>
      {(title || action) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StateCard({
  icon = 'alert',
  title,
  children,
  action,
  tone = 'neutral',
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className={`state-card state-${tone}`}>
      <span className="state-icon">
        <Icon name={icon} size={22} />
      </span>
      <h4>{title}</h4>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry, what = 'the voice agent' }: { message: string; onRetry: () => void; what?: string }) {
  return (
    <StateCard
      tone="danger"
      title={`Couldn't reach ${what}`}
      action={
        <button className="btn btn-secondary" onClick={onRetry}>
          <Icon name="refresh" size={15} />
          Try again
        </button>
      }
    >
      {message}
    </StateCard>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="empty-note">{children}</p>;
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="inline-error" role="alert">
      <Icon name="alert" size={14} />
      <span>{children}</span>
    </p>
  );
}

/** CSS color for a config tone key (palette defined in globals.css). */
export function toneVar(tone: Tone): string {
  return `var(--tone-${tone})`;
}
