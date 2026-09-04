'use client';

import { createBrowserClient } from '@supabase/ssr';

import { supabaseEnv } from './env';

/** Browser client for the payer. Carries the signed-in session via cookies. */
export function createClient() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
