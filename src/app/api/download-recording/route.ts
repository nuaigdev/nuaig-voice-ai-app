import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { isDemoMode } from '@/lib/demo';
import { getCallRecordingUrl } from '@/lib/retell';

export const runtime = 'nodejs';

// Streams a call's recording through our origin with Content-Disposition, so
// the browser saves the file (a cross-origin <a download> can't guarantee
// that). The browser only names the call; the audio URL is whatever Retell
// reports for that call on this client's agent, so the route can't be used to
// fetch arbitrary URLs.
export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const callId = request.nextUrl.searchParams.get('call_id');
  if (!callId || !/^[\w-]{1,128}$/.test(callId)) {
    return NextResponse.json({ error: 'Missing or invalid call_id' }, { status: 400 });
  }
  if (isDemoMode()) {
    return NextResponse.json({ error: 'Demo calls have no recordings' }, { status: 404 });
  }

  let recordingUrl: string | null;
  try {
    recordingUrl = await getCallRecordingUrl(callId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not look up the call';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!recordingUrl || !recordingUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'No recording is available for this call' }, { status: 404 });
  }

  const upstream = await fetch(recordingUrl, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Recording fetch failed (${upstream.status})` }, { status: 502 });
  }

  const ext = new URL(recordingUrl).pathname.split('.').pop()?.toLowerCase();
  const filename = `${callId}.${ext && /^[a-z0-9]{2,4}$/.test(ext) ? ext : 'wav'}`;
  const length = upstream.headers.get('content-length');
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'audio/wav',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      ...(length ? { 'Content-Length': length } : {}),
    },
  });
}
