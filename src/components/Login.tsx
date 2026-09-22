'use client';

import { useState, type FormEvent } from 'react';
import { ClientLogo, NuaigLogo, NuvaMark } from './brand';
import { Icon, type IconName } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import { InlineError } from './ui';
import { Waveform } from './Waveform';
import { PRODUCT } from '@/config/product';
import type { SessionPayload } from '@/lib/auth';

const PILLS: { icon: IconName; label: string }[] = [
  { icon: 'sparkle', label: 'Call insights' },
  { icon: 'route', label: 'Smart routing' },
  { icon: 'book', label: 'Live knowledge' },
];

export interface DemoCredentials {
  email: string;
  password: string;
}

interface LoginProps {
  onLogin: (session: SessionPayload) => void;
  /** Set only in local demo mode (NUVA_DEMO=1 under next dev). */
  demoCredentials: DemoCredentials | null;
}

export function Login({ onLogin, demoCredentials }: LoginProps) {
  const client = useClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Sign in failed');
      onLogin(data as SessionPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="login">
      <aside className="login-brand">
        <div className="lb-decor" aria-hidden="true">
          <span className="lb-orb lb-orb-1" />
          <span className="lb-orb lb-orb-2" />
          <span className="lb-rings" />
        </div>

        <NuvaMark size="lg" onDark />

        <div className="lb-center">
          <h2>
            Every resident call,
            <br />
            <span>answered with care.</span>
          </h2>
          <p className="lb-lede">
            {PRODUCT.name} answers {client.name} {client.audience} by voice and hands off to staff when it matters.
          </p>

          <div className="lb-convo" aria-hidden="true">
            <div className="lb-convo-head">
              <span className="lb-live" />
              Sample call · Dining
              <Waveform seed={`${client.id}-convo`} bars={9} size="sm" live />
            </div>
            <p className="lb-bubble lb-bubble-user">What&rsquo;s for dinner tonight?</p>
            <p className="lb-bubble lb-bubble-agent">Herb-roasted salmon or a vegetable lasagna. Shall I note your choice?</p>
          </div>

          <ul className="lb-pills">
            {PILLS.map((p) => (
              <li key={p.label}>
                <Icon name={p.icon} size={14} />
                {p.label}
              </li>
            ))}
          </ul>
        </div>

        <a className="lb-foot" href={PRODUCT.vendor.url} target="_blank" rel="noreferrer" aria-label={`Built by ${PRODUCT.vendor.name}`}>
          <span className="lb-foot-label">Built by</span>
          <NuaigLogo height={26} tone="dark" />
          <span className="lb-foot-tag">{PRODUCT.vendor.tagline}</span>
        </a>
      </aside>

      <main className="login-main">
        <form className="login-form" onSubmit={handleSubmit}>
          <ClientLogo height={60} className="login-logo" />
          <div className="login-heading">
            <h1>Sign in</h1>
            <p>
              Welcome to {PRODUCT.name} for {client.name}. Use the account your administrator set up for you.
            </p>
          </div>

          <div className="field">
            <label htmlFor="login-email">Email</label>
            <div className="input-icon">
              <Icon name="mail" size={16} />
              <input
                id="login-email"
                type="email"
                placeholder={client.loginEmailHint}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <div className="input-icon">
              <Icon name="lock" size={16} />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="input-action" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {error && <InlineError>{error}</InlineError>}

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" /> Signing in…
              </>
            ) : (
              <>
                Sign in
                <Icon name="arrowRight" size={17} />
              </>
            )}
          </button>

          {demoCredentials ? (
            <div className="login-demo">
              <b>Demo mode</b> · sample data, no live agent.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEmail(demoCredentials.email);
                  setPassword(demoCredentials.password);
                }}
              >
                Fill in
              </button>
              <br />
              <code>{demoCredentials.email}</code> / <code>{demoCredentials.password}</code>
            </div>
          ) : (
            <p className="login-help">Need access or forgot your password? Contact your community administrator.</p>
          )}
        </form>

        <p className="login-legal">
          © {new Date().getFullYear()} {PRODUCT.vendor.name} · {PRODUCT.name} {PRODUCT.descriptor}
        </p>
      </main>
    </div>
  );
}
