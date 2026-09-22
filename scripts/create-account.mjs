#!/usr/bin/env node
// Creates (or updates) a console account with a role, via the Admin API of the
// Supabase project in .env.local (interim sign-in; the login approach is not
// finalized). There's no signup flow or user-management UI - this is how
// accounts get provisioned/rotated.
//
// Usage: npm run create-account -- "you@x.com" "a-password" admin

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

function readEnvLocal(key) {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  const content = readFileSync(envPath, 'utf8');
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : undefined;
}

const [email, password, role] = process.argv.slice(2);
if (!email || !password || (role !== 'admin' && role !== 'user')) {
  console.error('Usage: npm run create-account -- "<email>" "<password>" <admin|user>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || readEnvLocal('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || readEnvLocal('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !serviceKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in .env.local.');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const { data: existing, error: listError } = await admin.auth.admin.listUsers();
if (listError) {
  console.error(listError.message);
  process.exit(1);
}
const match = existing.users.find((u) => u.email === email);

const result = match
  ? await admin.auth.admin.updateUserById(match.id, { password, app_metadata: { role } })
  : await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role } });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
console.log(`${match ? 'Updated' : 'Created'} ${email} as ${role}`);
