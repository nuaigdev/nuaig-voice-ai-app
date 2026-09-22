import { NextRequest, NextResponse } from 'next/server';
import { getActiveClient } from '@/clients';
import { buildCallsDashboard, getCallsDashboard } from '@/lib/retell';
import { buildExcelExport } from '@/lib/excel';
import { getDemoCalls, isDemoMode } from '@/lib/demo';
import { parseCallWindow } from '@/lib/callWindow';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Raw-data Excel workbook for ?from=&to=, generated on demand. Admin-only:
 * its Summary sheet includes cost aggregates that the console UI never shows.
 */
export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const window = parseCallWindow(req.nextUrl.searchParams);
  if ('error' in window) return NextResponse.json({ error: window.error }, { status: 400 });

  try {
    const { data, raw } = isDemoMode() ? buildCallsDashboard(getDemoCalls(window), 'agent_demo') : await getCallsDashboard(window);
    const file = await buildExcelExport(data, raw);
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const filename = `${getActiveClient().id}_calls_${day(window.from)}_to_${day(window.to)}.xlsx`;
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error building the export';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
