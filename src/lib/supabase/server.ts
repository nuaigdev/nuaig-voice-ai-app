// Server-only: builds a Supabase client bound to the current Route Handler's
// cookies, per the official @supabase/ssr Next.js App Router pattern. Session
// cookies (set by sign-in/sign-out, or silently refreshed by getUser()) are
// written straight through Next's cookie store - no manual Set-Cookie wiring.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
