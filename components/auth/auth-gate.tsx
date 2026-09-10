'use client';

import { Barbell, LockKey, WarningCircle } from '@phosphor-icons/react';
import type { User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabaseConfig } from '@/lib/supabase/config';
import { getSupabaseClient } from '@/lib/supabase/client';
import { WorkoutSync } from '@/components/sync/workout-sync';

type Mode = 'sign-in' | 'sign-up';

/**
 * A signed-in account is the boundary around a Workout database. Local Dexie
 * remains the fast offline working copy; Supabase Auth gives that copy an owner
 * and lets the sync layer carry it safely to another device.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const configured = supabaseConfig() !== null;
  const [user, setUser] = useState<User | null | undefined>(() => (configured ? undefined : null));

  useEffect(() => {
    if (!configured) return;

    const client = getSupabaseClient();
    let alive = true;

    client.auth.getSession().then(({ data }) => {
      if (alive) setUser(data.session?.user ?? null);
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) setUser(session?.user ?? null);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  if (!configured) return <CloudSetupMissing />;
  if (user === undefined) return <AuthLoading />;
  if (user === null) return <AuthScreen />;

  return <WorkoutSync userId={user.id}>{children}</WorkoutSync>;
}

function AuthLoading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-6">
      <div className="flex items-center gap-3 text-sm text-muted" role="status">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
        Opening your training log…
      </div>
    </main>
  );
}

function CloudSetupMissing() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-6 text-center">
      <WarningCircle size={32} weight="duotone" className="text-muted" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold text-ink">Cloud sync needs setting up</h1>
      <p className="mt-2 max-w-[34ch] text-sm leading-6 text-muted">
        Add this app&apos;s Supabase URL and publishable key before signing in.
      </p>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    const client = getSupabaseClient();
    const result =
      mode === 'sign-in'
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin },
          });

    setBusy(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }

    if (mode === 'sign-up' && !result.data.session) {
      setMessage('Check your email to confirm this account, then sign in here.');
    }
  };

  const switchMode = () => {
    setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'));
    setMessage(null);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-5 py-8">
      <section className="w-full max-w-[25rem] rounded-panel border border-line bg-raised p-6 shadow-sm sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-ink">
          <Barbell size={24} weight="bold" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">
          {mode === 'sign-in' ? 'Your training, on every device.' : 'Start your training log.'}
        </h1>
        <p className="mt-2 max-w-[32ch] text-sm leading-6 text-muted">
          {mode === 'sign-in'
            ? 'Sign in to keep your sessions backed up and in sync.'
            : 'One account keeps your training history safe across devices.'}
        </p>

        <form className="mt-7 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-medium text-ink">
            Email
            <input
              className="mt-1.5 h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition focus:border-ink"
              autoComplete="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-ink">
            Password
            <input
              className="mt-1.5 h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition focus:border-ink"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              type="password"
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {message && (
            <p className="rounded-control bg-accent-wash px-3 py-2.5 text-sm leading-5 text-ink" role="status">
              {message}
            </p>
          )}

          <button
            className="flex h-14 w-full items-center justify-center gap-2 rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
            type="submit"
            disabled={busy}
          >
            <LockKey size={18} weight="bold" aria-hidden />
            {busy ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'sign-in' ? 'New here?' : 'Already have an account?'}{' '}
          <button className="font-medium text-ink underline decoration-line underline-offset-4" type="button" onClick={switchMode}>
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}
