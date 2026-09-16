import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * Never prerendered. Every one of these pages is a function of who is signed in,
 * so a build-time render is both meaningless and, without env vars present at
 * build time, fatal -- which is how this surfaced: the first Vercel build died
 * trying to prerender the landing page.
 */
export const dynamic = 'force-dynamic';

/** What the app does, in the order somebody would actually meet it. */
const STEPS = [
  {
    title: 'Put the bill in',
    body: 'Photograph the receipt or type the lines. Service charge and SST come off it too.',
  },
  {
    title: 'Send one link',
    body: 'Everyone taps what they ate. No sign-up, no app, nothing to install.',
  },
  {
    title: 'Get paid back',
    body: 'Each share works itself out to the sen, and the money goes bank to bank by DuitNow.',
  },
];

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/bills');

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-16 pb-6">
      <h1 className="type-display text-balance">Split the bill without the group chat maths</h1>
      <p className="type-body mt-3.5" style={{ color: 'var(--text-muted)' }}>
        One link to the table, and everyone&rsquo;s share works itself out.
      </p>

      {/*
        Three steps rather than a list of features. The question somebody has on
        this screen is what using it is like, and a feature list answers a
        different one.
      */}
      <ol className="mt-10 space-y-6">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <span
              aria-hidden="true"
              className="tabular mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full type-footnote font-semibold"
              style={{ background: 'var(--accent-wash-strong)', color: 'var(--accent-strong)' }}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="type-headline block">{step.title}</span>
              <span className="type-subhead mt-0.5 block" style={{ color: 'var(--text-muted)' }}>
                {step.body}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {/*
        The reassurance sits with the button rather than in the body copy,
        because it answers the hesitation somebody has at the moment of tapping
        it, not while they are still reading.
      */}
      <div className="mt-auto pt-12">
        <Link href="/login" data-press="button" className="btn btn-primary w-full">
          Get started
        </Link>
        <p className="type-footnote mt-3 text-center" style={{ color: 'var(--text-muted)' }}>
          Only you need an account. The app never holds the money.
        </p>
      </div>
    </main>
  );
}
