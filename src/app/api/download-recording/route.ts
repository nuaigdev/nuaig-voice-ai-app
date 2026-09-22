import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';

export const runtime = 'nodejs';

// Retell serves call recordings from CloudFront URLs it hands back in the call
// object. Proxying the download through our own origin (with a Content-Disposition
// header) makes the browser save the file instead of just opening/streaming it,
// which a plain cross-origin <a download> link can't guarantee.
function isAllowedRecordingUrl(url: URL): boolean {
  return url.protocol === 'https:' && url.hostname.endsWith('.cloudfront.net');
}

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const target = request.nextUrl.searchParams.get('url');
  if (!target) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: 'Invalid url parameter' }, { status: 400 });
  }

  if (!isAllowedRecordingUrl(parsed)) {
    return NextResponse.json({ error: 'URL is not an allowed recording host' }, { status: 400 });
  }

  const upstream = await fetch(parsed.toString());
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream recording fetch failed (${upstream.status})` }, { status: 502 });
  }

  const filename = parsed.pathname.split('/').pop() || 'recording.wav';
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/wav',
      'Content-Disposition': `attachment; filename="${filename}"`,
      ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length')! } : {}),
    },
  });
}
