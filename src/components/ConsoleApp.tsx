'use client';

import { useCallback, useEffect, useState } from 'react';
import { Account } from './Account';
import { AppFooter } from './AppFooter';
import { AppHeader } from './AppHeader';
import { CallDetailDrawer } from './CallDetailDrawer';
import { CallLogs } from './CallLogs';
import { Dashboard } from './Dashboard';
import { formatRangeLabel } from './DateRangePicker';
import { KnowledgeBase } from './KnowledgeBase';
import { Login } from './Login';
import { Settings } from './Settings';
import { NuvaMark } from './brand';
import { useTheme } from '@/hooks/useTheme';
import type { SessionPayload } from '@/lib/auth';
import type { DemoCredentials } from './Login';
import type { CallRow, CallsDashboardData, DateRange, DateSeg, ViewKey } from '@/types';

function Splash() {
  return (
    <div className="splash" aria-busy="true" aria-label="Loading">
      <NuvaMark size="lg" />
    </div>
  );
}

export function ConsoleApp({ demoCredentials }: { demoCredentials: DemoCredentials | null }) {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeView, setActiveView] = useState<ViewKey>('dashboard');
  // The open call plus the list it was opened from, so the drawer can step to the previous/next call.
  const [selection, setSelection] = useState<{ list: CallRow[]; index: number } | null>(null);
  const openCall = useCallback((entry: CallRow, list: CallRow[]) => {
    const index = list.findIndex((c) => c.call_id === entry.call_id);
    setSelection(index >= 0 ? { list, index } : { list: [entry], index: 0 });
  }, []);
  const [fullScreen, setFullScreen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  // Shared date-range filter: applying a custom range on Overview or Call
  // Logs carries over to the other, since they're both views onto the same calls.
  const [dateSeg, setDateSeg] = useState<DateSeg>('7');
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  const applyCustomRange = useCallback((range: DateRange) => {
    setCustomRange(range);
    setCustomLabel(formatRangeLabel(range));
    setDateSeg('custom');
  }, []);

  const [dashboard, setDashboard] = useState<CallsDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Pulls fresh data straight from Retell every time it's called - on login,
  // on Retry after a failed fetch, and from the header's sync button.
  const loadDashboard = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch('/api/calls')
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Failed to load call data from the voice agent');
        return body as CallsDashboardData;
      })
      .then((body) => setDashboard(body))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load call data'))
      .finally(() => setLoading(false));
  }, []);

  // Restores an existing session from the auth cookie (e.g. after a page refresh).
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? (res.json() as Promise<SessionPayload>) : null))
      .then((body) => {
        if (body) {
          setSession(body);
          loadDashboard();
        }
      })
      .finally(() => setCheckingSession(false));
  }, [loadDashboard]);

  const navigate = useCallback((view: ViewKey) => {
    setActiveView(view);
    window.scrollTo({ top: 0 });
  }, []);

  if (checkingSession) return <Splash />;

  if (!session) {
    return (
      <Login
        demoCredentials={demoCredentials}
        onLogin={(s) => {
          setSession(s);
          loadDashboard();
        }}
      />
    );
  }

  const handleLogout = () => {
    fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
      setSession(null);
      setActiveView('dashboard');
      setFullScreen(false);
      setSelection(null);
      setDashboard(null);
    });
  };

  const canEdit = session.role === 'admin';
  const calls = dashboard?.calls ?? [];
  // Only show skeletons on the first load; a manual refresh keeps the current data on screen.
  const initialLoading = loading && !dashboard;

  return (
    <div className={'shell' + (fullScreen ? ' is-fullscreen' : '')}>
      {!fullScreen && (
        <AppHeader
          activeView={activeView}
          onNavigate={navigate}
          theme={theme}
          onToggleTheme={toggleTheme}
          session={session}
          onLogout={handleLogout}
          syncedAt={dashboard?.generated_at ?? null}
          refreshing={loading}
          onRefresh={loadDashboard}
        />
      )}

      <main className="shell-main">
        {activeView === 'dashboard' && (
          <Dashboard
            calls={calls}
            loading={initialLoading}
            error={loadError}
            onRetry={loadDashboard}
            onOpenCall={openCall}
            onNavigateToCallLogs={() => navigate('calllogs')}
            dateSeg={dateSeg}
            onDateSegChange={setDateSeg}
            customLabel={customLabel}
            customRange={customRange}
            onApplyCustomRange={applyCustomRange}
          />
        )}
        {activeView === 'calllogs' && (
          <CallLogs
            calls={calls}
            loading={initialLoading}
            error={loadError}
            onRetry={loadDashboard}
            fullScreen={fullScreen}
            onToggleFullScreen={() => setFullScreen((v) => !v)}
            onOpenCall={openCall}
            dateSeg={dateSeg}
            onDateSegChange={setDateSeg}
            customLabel={customLabel}
            customRange={customRange}
            onApplyCustomRange={applyCustomRange}
          />
        )}
        {activeView === 'knowledge' && <KnowledgeBase canEdit={canEdit} />}
        {activeView === 'settings' && <Settings canEdit={canEdit} />}
        {activeView === 'account' && <Account onLogout={handleLogout} session={session} />}
      </main>

      {!fullScreen && <AppFooter />}

      <CallDetailDrawer
        entry={selection ? selection.list[selection.index] : null}
        position={selection ? { index: selection.index, total: selection.list.length } : null}
        onStep={(delta) =>
          setSelection((s) => (s ? { ...s, index: Math.min(s.list.length - 1, Math.max(0, s.index + delta)) } : s))
        }
        onClose={() => setSelection(null)}
      />
    </div>
  );
}
