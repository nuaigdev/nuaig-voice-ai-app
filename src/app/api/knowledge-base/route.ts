import { NextRequest, NextResponse } from 'next/server';
import {
  addKnowledgeBaseFiles,
  deleteKnowledgeBaseSource,
  kbCategoryKeys,
  listKnowledgeBaseSources,
  type KbCategory,
} from '@/lib/retell';
import { requireSession, requireAdmin } from '@/lib/auth';
import { addDemoKb, deleteDemoKb, isDemoMode, listDemoKb } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isKbCategory(value: unknown): value is KbCategory {
  return typeof value === 'string' && kbCategoryKeys().includes(value);
}

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  if (isDemoMode()) return NextResponse.json({ sources: listDemoKb() });

  try {
    const sources = await listKnowledgeBaseSources();
    return NextResponse.json({ sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error fetching the knowledge base';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  const category = form.get('category');
  if (!isKbCategory(category)) {
    return NextResponse.json({ error: `"category" must be one of ${kbCategoryKeys().join(', ')}` }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  if (isDemoMode()) return NextResponse.json({ sources: addDemoKb(category, files) });

  try {
    const sources = await addKnowledgeBaseFiles(category, files);
    return NextResponse.json({ sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error uploading to the knowledge base';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  const sourceId = req.nextUrl.searchParams.get('source_id');
  if (!sourceId) {
    return NextResponse.json({ error: '"source_id" query param is required' }, { status: 400 });
  }
  if (isDemoMode()) {
    deleteDemoKb(sourceId);
    return NextResponse.json({ ok: true });
  }
  try {
    await deleteKnowledgeBaseSource(sourceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error deleting from the knowledge base';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
