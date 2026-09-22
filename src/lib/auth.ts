// Server-only: session/role checks backed by Supabase Auth (self-hosted via
// `supabase start` - see supabase/config.toml). Supabase handles
// identity and sessions; role is our own claim, stored in each account's
// app_metadata (set via the Admin API - see scripts/create-account.mjs) and
// surfaced here from supabase.auth.getUser().

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from './supabase/server';
import { getDemoSession, isDemoMode } from './demo';

export type Role = 'admin' | 'user';

export interface SessionPayload {
  email: string;
  role: Role;
}

function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'user';
}

/** Use at the top of a route handler; returns a session, or a NextResponse to return immediately. */
export async function requireSession(): Promise<SessionPayload | NextResponse> {
  if (isDemoMode()) {
    return (await getDemoSession()) ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  // getUser() re-validates against the Auth server (and silently refreshes an
  // expired access token via the refresh-token cookie) rather than just
  // trusting whatever the JWT in the cookie claims - the safer of the two
  // methods the client exposes for this.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const role = user.app_metadata?.role;
  if (!isRole(role)) {
    return NextResponse.json({ error: 'Account has no role assigned' }, { status: 403 });
  }

  return { email: user.email, role };
}

/** Same as requireSession, but also rejects a logged-in 'user' (viewer) session with 403. */
export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  const result = await requireSession();
  if (result instanceof NextResponse) return result;
  if (result.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  return result;
}
