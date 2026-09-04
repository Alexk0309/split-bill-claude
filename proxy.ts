import { type NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refreshes the payer's auth cookies on navigation. Server Components cannot
 * write cookies, so without this a session would silently expire mid-session.
 *
 * Next 16 renamed this convention from `middleware` to `proxy`.
 *
 * Guest routes carry no session at all, so they are skipped entirely.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the guest claim pages under /b/,
     * which are deliberately anonymous.
     */
    '/((?!_next/static|_next/image|favicon.ico|b/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
