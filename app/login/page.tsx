'use client';

import { useState } from 'react';

import { BackLink } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent' } | { kind: 'error'; message: string };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: 'sending' });
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setState({ kind: 'sent' });
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not send the link.',
      });
    }
  }

  if (state.kind === 'sent') {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
        <div className="card px-5 py-7 text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-wash-strong)' }}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              fill="none"
              stroke="var(--accent-strong)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="5" width="19" height="14" rx="3" />
              <path d="m3.5 7 8.5 6 8.5-6" />
            </svg>
          </span>
          <h1 className="type-title-2">Check your email</h1>
          <p className="type-subhead mt-2" style={{ color: 'var(--text-muted)' }}>
            We sent a sign-in link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Open
            it on this device.
          </p>
          <button
            type="button"
            data-press="button"
            className="btn btn-ghost mt-5 w-full"
            onClick={() => setState({ kind: 'idle' })}
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-4 pb-10">
      <BackLink href="/">Back</BackLink>

      <div className="flex flex-1 flex-col justify-center pb-16">
        <h1 className="type-title">Sign in</h1>
        <p className="type-subhead mt-2" style={{ color: 'var(--text-muted)' }}>
          Only the person who paid the bill needs an account. Everyone else just opens the link.
        </p>

        <form onSubmit={onSubmit} className="mt-7 space-y-3">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {state.kind === 'error' ? (
            <p className="type-subhead" style={{ color: 'var(--accent-strong)' }} role="alert">
              {state.message}
            </p>
          ) : null}

          <button
            type="submit"
            data-press="button"
            className="btn btn-primary w-full"
            disabled={state.kind === 'sending'}
            aria-busy={state.kind === 'sending'}
          >
            {state.kind === 'sending' ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Sending…
              </>
            ) : (
              'Email me a link'
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
