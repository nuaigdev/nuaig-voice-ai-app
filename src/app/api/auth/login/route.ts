import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { demoSignIn, isDemoMode } from '@/lib/demo';

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

  if (isDemoMode()) {
    const session = await demoSignIn(body.email, body.password);
    return session ? NextResponse.json(session) : NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: body.email, password: body.password });
  if (error || !data.user?.email) {
    return NextResponse.json({ error: error?.message || 'Invalid email or password' }, { status: 401 });
  }

  const role = data.user.app_metadata?.role;
  if (role !== 'admin' && role !== 'user') {
    return NextResponse.json({ error: 'Account has no role assigned' }, { status: 403 });
  }

  return NextResponse.json({ email: data.user.email, role });
}
