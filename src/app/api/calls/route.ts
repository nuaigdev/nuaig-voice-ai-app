import { NextRequest, NextResponse } from 'next/server';
import { buildCallsDashboard, getCallsDashboard } from '@/lib/retell';
import { getDemoCalls, isDemoMode } from '@/lib/demo';
import { parseCallWindow } from '@/lib/callWindow';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Calls whose start falls in ?from=&to= (epoch ms; defaults to the last 30 days). */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const window = parseCallWindow(req.nextUrl.searchParams);
  if ('error' in window) return NextResponse.json({ error: window.error }, { status: 400 });

  try {
    const { data } = isDemoMode() ? buildCallsDashboard(getDemoCalls(window), 'agent_demo') : await getCallsDashboard(window);
    // cost_usd is kept on each row only for Summary aggregation; per-call cost
    // is an eliminated column, so strip it before it reaches the client.
    const calls = data.calls.map((call) => {
      const rest = { ...call } as Partial<typeof call>;
      delete rest.cost_usd;
      return rest;
    });
    return NextResponse.json({ ...data, calls, window });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error fetching Retell data';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
