import { NextRequest, NextResponse } from 'next/server';
import { startSession, verifyCredentials } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const session = verifyCredentials(body.email, body.password);
  if (!session) return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });

  await startSession(session);
  return NextResponse.json(session);
}
