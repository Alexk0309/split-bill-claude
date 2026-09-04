import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { supabaseEnv } from './env';

/**
 * Anonymous client for a guest holding a share link.
 *
 * The tokens ride in headers rather than the query string, so they stay out of
 * server logs and `Referer`. Row level security reads them back via
 * `request_share_token()` / `request_claim_token()` and scopes every query to
 * the one bill, and every write to the guest's own claims.
 *
 * There is no session and no cookie: a guest never signs in.
 */
export function createGuestClient(shareToken: string, claimToken?: string | null) {
  const { url, anonKey } = supabaseEnv();
  const headers: Record<string, string> = { 'x-share-token': shareToken };
  if (claimToken) headers['x-claim-token'] = claimToken;

  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers },
  });
}
