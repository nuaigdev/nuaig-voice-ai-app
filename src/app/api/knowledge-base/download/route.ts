import { NextRequest, NextResponse } from 'next/server';
import { getKnowledgeBaseSource, kbCategoryKeys } from '@/lib/retell';
import { requireSession } from '@/lib/auth';
import { isDemoMode, listDemoKb } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams a knowledge base file back as an attachment, under its display name. */
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const sourceId = req.nextUrl.searchParams.get('source_id');
  const category = req.nextUrl.searchParams.get('category');
  if (!sourceId || !category || !kbCategoryKeys().includes(category)) {
    return NextResponse.json({ error: '"category" and "source_id" query params are required' }, { status: 400 });
  }

  try {
    const source = isDemoMode()
      ? (listDemoKb().find((s) => s.category === category && s.sourceId === sourceId) ?? null)
      : await getKnowledgeBaseSource(category, sourceId);
    if (!source) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (!source.fileUrl || !source.fileUrl.startsWith('https://')) {
      return NextResponse.json({ error: 'This document has no downloadable file' }, { status: 404 });
    }

    const upstream = await fetch(source.fileUrl, { cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Couldn't fetch the file (HTTP ${upstream.status})` }, { status: 502 });
    }

    const asciiName = source.displayName.replace(/[^\x20-\x7E]|["\\]/g, '_');
    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(source.displayName)}`,
      'Cache-Control': 'private, no-store',
    });
    const length = upstream.headers.get('content-length');
    if (length) headers.set('Content-Length', length);
    return new NextResponse(upstream.body, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error downloading the file';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
