import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/bills');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-3xl font-bold tracking-tight text-balance">
        Split the bill without the group chat maths
      </h1>
      <p className="mt-3 text-[16px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Enter the bill, send one WhatsApp link, and everyone taps what they ate. Service charge and
        SST are split properly, to the sen.
      </p>
      <p className="mt-3 text-[15px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Your friends never sign up, and the money goes straight to your bank by DuitNow. We never
        touch it.
      </p>

      <Link href="/login" className="btn btn-primary mt-8 w-full">
        Get started
      </Link>
    </main>
  );
}
