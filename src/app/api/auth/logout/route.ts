import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { demoSignOut, isDemoMode } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (isDemoMode()) {
    await demoSignOut();
    return NextResponse.json({ ok: true });
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
