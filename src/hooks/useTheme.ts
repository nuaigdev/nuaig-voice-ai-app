import { useCallback, useSyncExternalStore } from 'react';
import type { Theme } from '@/types';
import { THEME_STORAGE_KEY } from '@/lib/theme';

// The source of truth is <html data-theme>, which layout.tsx's inline script
// sets from localStorage before first paint. Reading it through
// useSyncExternalStore keeps SSR ("light") and the client in agreement.

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getServerSnapshot(): Theme {
  return 'light';
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleTheme = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, blocked site data) - the theme just won't persist.
    }
    listeners.forEach((l) => l());
  }, []);

  return { theme, toggleTheme };
}
