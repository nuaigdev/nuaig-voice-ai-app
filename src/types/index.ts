export type ViewKey = 'dashboard' | 'calllogs' | 'knowledge' | 'settings' | 'account';

export type Theme = 'dark' | 'light';

export type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Unknown';

export type { DepartmentSeed as Department, Tone } from '@/clients/types';

export interface DateRange {
  start: Date;
  end: Date;
}

export type DateSeg = 'today' | '7' | '30' | 'custom';

// Live Retell call data shapes, shared between the API route (src/lib/retell.ts)
// and the UI. Re-exported as types only, so no server-only code is bundled
// into client components that just need the shapes.
export type { DashboardSummary, DailyTrendPoint } from '@/lib/retell';
import type { CallsDashboardData as ServerDashboardData, FlatCallRow } from '@/lib/retell';

// cost_usd is server/Excel-only (Summary aggregates); the API route strips it
// from each call before responding, so the client-side type reflects that.
export type CallRow = Omit<FlatCallRow, 'cost_usd'>;
export type CallsDashboardData = Omit<ServerDashboardData, 'calls'> & { calls: CallRow[] };
