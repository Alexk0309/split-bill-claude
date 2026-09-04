'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { createClient } from '@/lib/supabase/client';

/** Coalesces the burst of events a table of seven produces while claiming. */
const REFRESH_DEBOUNCE_MS = 300;

/**
 * Keeps the payer's view current while the table claims.
 *
 * The broadcast carries no data; it only says something moved. `router.refresh`
 * then re-runs the server component, so the refreshed data still comes back
 * through the payer's own authenticated session and row level security.
 */
export function LiveRefresh({ shareToken }: { shareToken: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`bill:${shareToken}`, { config: { private: false } })
      .on('broadcast', { event: 'bill_change' }, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
      })
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [shareToken, router]);

  return null;
}
