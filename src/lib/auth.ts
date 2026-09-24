// Server-only: session/role checks. Interim sign-in (the production login
// approach is not finalized): one shared account whose credentials come from
// CONSOLE_LOGIN_EMAIL / CONSOLE_LOGIN_PASSWORD, falling back to the demo
// account below. A successful sign-in sets an HMAC-signed, httpOnly cookie
// (secret: AUTH_SECRET). Keep auth changes behind requireSession/requireAdmin
// so a real identity provider can replace this without touching the routes.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export type Role = 'admin' | 'user';

export interface SessionPayload {
  email: string;
  role: Role;
}

export const DEFAULT_LOGIN = { email: 'demo@nuva.dev', password: 'nuva-demo' } as const;

const SESSION_COOKIE = 'nuva_session';
const SESSION_MAX_AGE_SEC = 60 * 60 * 8;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is not set.');
  return 'nuva-dev-only-secret';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHmac('sha256', 'cmp').update(a).digest();
  const hb = createHmac('sha256', 'cmp').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Checks the submitted credentials; returns the session they grant, or null. */
export function verifyCredentials(email: string, password: string): SessionPayload | null {
  const expectedEmail = (process.env.CONSOLE_LOGIN_EMAIL || DEFAULT_LOGIN.email).trim().toLowerCase();
  const expectedPassword = process.env.CONSOLE_LOGIN_PASSWORD || DEFAULT_LOGIN.password;
  const emailOk = safeEqual(email.trim().toLowerCase(), expectedEmail);
  const passwordOk = safeEqual(password, expectedPassword);
  return emailOk && passwordOk ? { email: expectedEmail, role: 'admin' } : null;
}

export async function startSession(session: SessionPayload): Promise<void> {
  const body = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + SESSION_MAX_AGE_SEC * 1000 })).toString('base64url');
  const store = await cookies();
  store.set(SESSION_COOKIE, `${body}.${sign(body)}`, {
    httpOnly: true,
    sameSite: 'lax',
    // Browsers drop Secure cookies on plain http (except localhost); AUTH_COOKIE_INSECURE=1 is for
    // serving over http on an internal host until TLS is in front of it.
    secure: process.env.NODE_ENV === 'production' && process.env.AUTH_COOKIE_INSECURE !== '1',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { email?: unknown; role?: unknown; exp?: unknown };
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (typeof data.email !== 'string' || (data.role !== 'admin' && data.role !== 'user')) return null;
    return { email: data.email, role: data.role };
  } catch {
    return null;
  }
}

/** Use at the top of a route handler; returns a session, or a NextResponse to return immediately. */
export async function requireSession(): Promise<SessionPayload | NextResponse> {
  const session = await readSession();
  return session ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}

/** Same as requireSession, but also rejects a logged-in 'user' (viewer) session with 403. */
export async function requireAdmin(): Promise<SessionPayload | NextResponse> {
  const result = await requireSession();
  if (result instanceof NextResponse) return result;
  if (result.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  return result;
}
