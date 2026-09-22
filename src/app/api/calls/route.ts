import { NextResponse } from 'next/server';
import { buildCallsDashboard, getCallsDashboard } from '@/lib/retell';
import { getDemoCalls, isDemoMode } from '@/lib/demo';
import { writeExcelExport } from '@/lib/excel';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  try {
    const { data, raw } = isDemoMode() ? buildCallsDashboard(getDemoCalls(), 'agent_demo') : await getCallsDashboard();
    if (!isDemoMode()) await writeExcelExport(data, raw);
    // cost_usd is kept on each row only for Summary aggregation; per-call cost
    // is an eliminated column, so strip it before it reaches the client.
    const calls = data.calls.map((call) => {
      const rest = { ...call } as Partial<typeof call>;
      delete rest.cost_usd;
      return rest;
    });
    return NextResponse.json({ ...data, calls });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error fetching Retell data';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
