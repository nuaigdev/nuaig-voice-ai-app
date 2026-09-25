'use client';

import { useEffect, useRef, useState } from 'react';
import { ClientLogo } from './brand';
import { Icon, type IconName } from './icons';
import { useClient } from './providers/ClientConfigProvider';
import type { SessionPayload } from '@/lib/auth';
import { formatInTz } from '@/lib/time';
import type { Theme, ViewKey } from '@/types';

const NAV_ITEMS: { key: ViewKey; label: string; icon: IconName }[] = [
  { key: 'dashboard', label: 'Overview', icon: 'overview' },
  { key: 'calllogs', label: 'Call Logs', icon: 'calls' },
  { key: 'knowledge', label: 'Knowledge Base', icon: 'book' },
  { key: 'settings', label: 'Call Routing', icon: 'route' },
];

function initialsOf(email: string): string {
  const local = email.split('@')[0] || '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return letters.toUpperCase();
}

function formatSyncedAt(iso: string | null, tz: string): string {
  if (!iso) return 'Not synced yet';
  return `Synced ${formatInTz(iso, tz, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
}

interface AppHeaderProps {
  activeView: ViewKey;
  onNavigate: (view: ViewKey) => void;
  theme: Theme;
  onToggleTheme: () => void;
  session: SessionPayload;
  onLogout: () => void;
  syncedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}

export function AppHeader({
  activeView,
  onNavigate,
  theme,
  onToggleTheme,
  session,
  onLogout,
  syncedAt,
  refreshing,
  onRefresh,
}: AppHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const { timezone } = useClient();
  const roleLabel = session.role === 'admin' ? 'Administrator' : 'Viewer';

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="header-brand">
          <ClientLogo height={42} />
        </div>

        <nav className="header-nav" aria-label="Console sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={'nav-link' + (activeView === item.key ? ' active' : '')}
              aria-current={activeView === item.key ? 'page' : undefined}
              onClick={() => onNavigate(item.key)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button
            className={'sync-chip' + (refreshing ? ' is-syncing' : '')}
            onClick={onRefresh}
            disabled={refreshing}
            title="Pull the latest calls from the voice agent"
          >
            <span className="sync-dot" aria-hidden="true" />
            <span className="sync-label">{refreshing ? 'Syncing…' : formatSyncedAt(syncedAt, timezone)}</span>
            <Icon name="refresh" size={15} className="sync-icon" />
          </button>

          <button
            className="icon-btn"
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
          </button>

          <div className="user-menu" ref={menuRef}>
            <button
              className={'user-trigger' + (menuOpen ? ' open' : '')}
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="avatar">{initialsOf(session.email)}</span>
              <Icon name="chevronDown" size={15} />
            </button>
            {menuOpen && (
              <div className="menu-pop" role="menu">
                <div className="menu-id">
                  <span className="avatar avatar-lg">{initialsOf(session.email)}</span>
                  <div>
                    <b>{session.email}</b>
                    <span>{roleLabel}</span>
                  </div>
                </div>
                <button
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate('account');
                  }}
                >
                  <Icon name="user" size={16} />
                  Account
                </button>
                <button role="menuitem" className="menu-item danger" onClick={onLogout}>
                  <Icon name="logout" size={16} />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
