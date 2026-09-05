import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { supabaseEnv } from './env';

/**
 * A client that bypasses row level security entirely. Server only, and used in
 * exactly one place: recording a payment proof.
 *
 * Why it has to exist
 * -------------------
 * A guest never signs in, so everything they write is written with a credential
 * they hold and could therefore forge. That is fine for claims -- claiming the
 * ribeye costs you money, so nobody lies about it -- but not for "I have paid".
 * If a guest could write the amount on their own proof, a matched proof would
 * mean nothing and the app would mark people as settled on their own say-so.
 *
 * So the figures on a proof are read out of the image by the server, and
 * written with an authority the guest does not have. That is the whole reason
 * this file exists.
 *
 * Rules for using it
 * ------------------
 * - Never import it into a client component, and never into a route that
 *   forwards its results without scoping them to one bill.
 * - It performs no authorisation of its own. Every query made through it must
 *   be explicitly scoped -- by bill id, by participant id -- because none of the
 *   policies that normally do that job will run.
 * - If a thing can be done with the guest client or the payer's session, do it
 *   there instead.
 */
export function createAdminClient() {
  const { url } = supabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. It is needed so that payment proofs are ' +
        'recorded by the server rather than by the guest. Copy it from Supabase ' +
        'Project Settings -> API into .env.local. It must never be exposed to a browser: ' +
        'the name deliberately has no NEXT_PUBLIC_ prefix.',
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function hasServiceRoleKey(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}
