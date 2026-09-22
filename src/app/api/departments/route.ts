import { NextRequest, NextResponse } from 'next/server';
import { getCurrentTransferTool, syncDepartmentTransfers, type DepartmentTransferInput } from '@/lib/retell';
import { requireSession, requireAdmin } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  if (isDemoMode()) return NextResponse.json({ tool: null });

  try {
    const tool = await getCurrentTransferTool();
    return NextResponse.json({ tool });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error fetching the transfer_call tool';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let body: { departments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.departments)) {
    return NextResponse.json({ error: '"departments" must be an array' }, { status: 400 });
  }

  const departments: DepartmentTransferInput[] = [];
  for (const d of body.departments) {
    if (
      !d ||
      typeof d !== 'object' ||
      typeof (d as Record<string, unknown>).name !== 'string' ||
      typeof (d as Record<string, unknown>).phone !== 'string'
    ) {
      return NextResponse.json({ error: 'Each department needs a "name" and "phone" string' }, { status: 400 });
    }
    const raw = d as Record<string, unknown>;
    departments.push({
      name: raw.name as string,
      phone: raw.phone as string,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      keywords: Array.isArray(raw.keywords) ? raw.keywords.filter((k): k is string => typeof k === 'string') : [],
    });
  }

  // Demo mode validates the payload like the real path but doesn't touch any agent.
  if (isDemoMode()) return NextResponse.json({ tool: null, departments });

  try {
    const tool = await syncDepartmentTransfers(departments);
    return NextResponse.json({ tool });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error syncing the transfer_call tool';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
