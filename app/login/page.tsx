'use client';

import { useState } from 'react';

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
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="mt-2 text-[15px]" style={{ color: 'var(--text-muted)' }}>
            We sent a sign-in link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Open
            it on this device.
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-4 w-full"
            onClick={() => setState({ kind: 'idle' })}
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-[15px]" style={{ color: 'var(--text-muted)' }}>
        Only the person who paid the bill needs an account. Everyone else just opens the link.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-3">
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
          <p className="text-[14px]" style={{ color: 'var(--accent-strong)' }} role="alert">
            {state.message}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary w-full" disabled={state.kind === 'sending'}>
          {state.kind === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>
    </main>
  );
}
