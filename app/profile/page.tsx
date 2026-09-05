import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

import { ProfileForm } from './profile-form';

/**
 * Never prerendered. Every one of these pages is a function of who is signed in,
 * so a build-time render is both meaningless and, without env vars present at
 * build time, fatal -- which is how this surfaced: the first Vercel build died
 * trying to prerender the landing page.
 */
export const dynamic = 'force-dynamic';


export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, duitnow_mobile, duitnow_qr_path')
    .eq('id', user.id)
    .maybeSingle();

  // Signed rather than public: the bucket is private, and this URL is only for
  // the payer looking at their own settings.
  let qrUrl: string | null = null;
  const qrPath = profile?.duitnow_qr_path as string | null | undefined;
  if (qrPath) {
    const { data } = await supabase.storage.from('duitnow-qr').createSignedUrl(qrPath, 3600);
    qrUrl = data?.signedUrl ?? null;
  }

  return (
    <main className="mx-auto max-w-md px-5 pt-4 pb-16">
      <Link
        href="/bills"
        className="tap inline-flex items-center text-[14px]"
        style={{ color: 'var(--text-muted)' }}
      >
        ← All bills
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight">How you get paid</h1>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--text-muted)' }}>
        Guests see these on the settlement screen and transfer straight to your bank. This app
        never holds the money.
      </p>

      <div className="mt-6">
        <ProfileForm
          userId={user.id}
          displayName={(profile?.display_name as string | null) ?? ''}
          duitnowMobile={(profile?.duitnow_mobile as string | null) ?? ''}
          qrUrl={qrUrl}
        />
      </div>
    </main>
  );
}
