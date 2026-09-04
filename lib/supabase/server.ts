import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

import { supabaseEnv } from './env';

/**
 * Server client for the payer, reading and writing the auth cookies.
 *
 * Server Components cannot set cookies, so the setAll path is allowed to fail
 * silently there; middleware refreshes the session instead.
 */
export async function createClient() {
  const { url, anonKey } = supabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; middleware handles the refresh.
        }
      },
    },
  });
}
