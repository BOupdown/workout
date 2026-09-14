'use client';

import { Barbell, LockKey, WarningCircle } from '@phosphor-icons/react';
import type { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { supabaseConfig } from '@/lib/supabase/config';
import { getSupabaseClient } from '@/lib/supabase/client';
import { WorkoutSync } from '@/components/sync/workout-sync';
import { ResetPasswordScreen } from './reset-password-screen';

type Mode = 'sign-in' | 'sign-up' | 'forgot-password';

function markPasswordRecovery(active: boolean) {
  const url = new URL(window.location.href);
  if (active) url.searchParams.set('reset-password', '1');
  else url.searchParams.delete('reset-password');
  for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key);
  url.hash = '';
  window.history.replaceState(window.history.state, '', url);
}

/**
 * A signed-in account is the boundary around a Workout database. Local Dexie
 * remains the fast offline working copy; Supabase Auth gives that copy an owner
 * and lets the sync layer carry it safely to another device.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const configured = supabaseConfig() !== null;
  const [user, setUser] = useState<User | null | undefined>(() => (configured ? undefined : null));
  const [recovering, setRecovering] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const recoveryIntent = useRef(false);

  useEffect(() => {
    if (!configured) return;

    // Read the intent before Supabase consumes and removes the token fragment.
    const url = new URL(window.location.href);
    const fragment = new URLSearchParams(url.hash.slice(1));
    let recoveryRequested = url.searchParams.get('reset-password') === '1'
      || fragment.get('type') === 'recovery';
    const invalidLink = fragment.has('error') || url.searchParams.has('error');
    recoveryIntent.current = recoveryRequested;
    const client = getSupabaseClient();
    let alive = true;
    let initializedSession = false;

    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        recoveryRequested = true;
        recoveryIntent.current = true;
        markPasswordRecovery(true);
        setRecovering(true);
        setLinkError(false);
      }
      if (event === 'SIGNED_OUT' && recoveryIntent.current) {
        setRecovering(false);
        setLinkError(true);
      }
      // Initialization below also checks URL errors before exposing the app.
      if (initializedSession && event !== 'INITIAL_SESSION') setUser(session?.user ?? null);
    });

    const initialize = async () => {
      try {
        const initialized = await client.auth.initialize();
        const { data, error } = await client.auth.getSession();
        if (!alive) return;
        if (invalidLink || (recoveryRequested && (initialized.error || error || !data.session))) {
          setLinkError(true);
          markPasswordRecovery(false);
        } else if (recoveryRequested && data.session) {
          markPasswordRecovery(true);
          setRecovering(true);
        }
        initializedSession = true;
        setUser(data.session?.user ?? null);
      } catch {
        if (!alive) return;
        setLinkError(recoveryRequested || invalidLink);
        initializedSession = true;
        setUser(null);
      }
    };
    void initialize();

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  if (!configured) return <CloudSetupMissing />;
  if (user === undefined) return <AuthLoading />;
  if (linkError) return (
    <AuthScreen
      initialMode="forgot-password"
      initialMessage="This link is invalid or has expired. Request a new password reset email."
      onNavigate={() => {
        markPasswordRecovery(false);
        recoveryIntent.current = false;
        setLinkError(false);
        setRecovering(false);
      }}
    />
  );
  if (recovering && user) return (
    <ResetPasswordScreen
      email={user.email}
      onExpired={() => setLinkError(true)}
      onComplete={() => {
        markPasswordRecovery(false);
        recoveryIntent.current = false;
        setRecovering(false);
      }}
    />
  );
  if (user === null) return <AuthScreen />;

  return <WorkoutSync key={user.id} userId={user.id}>{children}</WorkoutSync>;
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

export function AuthScreen({ initialMode = 'sign-in', initialMessage = null, onNavigate }: {
  initialMode?: Mode;
  initialMessage?: string | null;
  onNavigate?: () => void;
} = {}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialMessage);
  const [confirmationPending, setConfirmationPending] = useState(false);
  const requestInFlight = useRef(false);

  const startRequest = () => {
    // State updates do not take effect until React renders. The ref closes the
    // small gap in which two taps could otherwise start two Auth requests.
    if (requestInFlight.current) return false;
    requestInFlight.current = true;
    setBusy(true);
    return true;
  };

  const finishRequest = () => {
    requestInFlight.current = false;
    setBusy(false);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!startRequest()) return;
    setMessage(null);
    setConfirmationPending(false);

    const client = getSupabaseClient();
    try {
      if (mode === 'forgot-password') {
        const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
          // Reuse the existing allowed root callback. PASSWORD_RECOVERY opens
          // the password form; no extra redirect URL configuration is needed.
          redirectTo: window.location.origin,
        });
        setMessage(error
          ? 'We couldn’t send the reset email. Please wait a minute and try again.'
          : 'If an account exists for this address, we’ve sent a password reset link. Check your inbox or spam.');
        return;
      }
      const result =
        mode === 'sign-in'
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.origin },
            });

      if (result.error) {
        setMessage(result.error.message);
        return;
      }

      if (mode === 'sign-up' && !result.data.session) {
        // `signUp` deliberately obscures whether an address already belongs to
        // an account. Keep that protection in the UI: this copy applies both
        // to a new unconfirmed account and an existing one.
        setMessage('If this address needs confirmation, we’ve sent an email. Check your inbox or spam, then sign in.');
        setConfirmationPending(true);
      }
    } catch {
      setMessage('Something went wrong. Please try again.');
    } finally {
      finishRequest();
    }
  };

  const resendConfirmation = async () => {
    if (!startRequest()) return;
    setMessage(null);

    try {
      const { error } = await getSupabaseClient().auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin },
      });

      if (error) {
        setMessage('We couldn’t resend the confirmation email. Please wait a minute and try again.');
        return;
      }

      setMessage('If confirmation is available for this address, we’ve sent another email. Check your inbox or spam.');
    } catch {
      setMessage('We couldn’t resend the confirmation email. Please wait a minute and try again.');
    } finally {
      finishRequest();
    }
  };

  const switchMode = (next: Mode) => {
    if (requestInFlight.current) return;
    onNavigate?.();
    setMode(next);
    setPassword('');
    setMessage(null);
    setConfirmationPending(false);
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-5 py-8">
      <section className="w-full max-w-[25rem] rounded-panel border border-line bg-raised p-6 shadow-sm sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-ink">
          <Barbell size={24} weight="bold" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">
          {mode === 'forgot-password' ? 'Forgot your password?' : mode === 'sign-in' ? 'Your training, on every device.' : 'Start your training log.'}
        </h1>
        <p className="mt-2 max-w-[32ch] text-sm leading-6 text-muted">
          {mode === 'forgot-password'
            ? 'Enter your account email and we’ll send you a link to choose a new password.'
            : mode === 'sign-in'
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
              disabled={busy}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                // A confirmation prompt belongs to the address that produced
                // it. Editing the address starts a fresh, independent flow.
                setConfirmationPending(false);
                setMessage(null);
              }}
              required
            />
          </label>
          {mode !== 'forgot-password' && <label className="block text-sm font-medium text-ink">
            Password
            <input
              className="mt-1.5 h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition focus:border-ink"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              type="password"
              disabled={busy}
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>}

          {mode === 'sign-in' && (
            <button type="button" disabled={busy} onClick={() => switchMode('forgot-password')}
              className="min-h-11 text-sm font-medium text-ink underline decoration-line underline-offset-4 disabled:opacity-60">
              Forgot password?
            </button>
          )}

          {message && (
            <p className="rounded-control bg-accent-wash px-3 py-2.5 text-sm leading-5 text-ink" role="status">
              {message}
            </p>
          )}

          <button
            className="flex h-14 w-full items-center justify-center gap-2 rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
            type="submit"
            disabled={busy || (mode === 'sign-up' && confirmationPending)}
          >
            <LockKey size={18} weight="bold" aria-hidden />
            {busy ? 'Working…' : mode === 'forgot-password' ? 'Send reset link' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>

          {mode === 'sign-up' && confirmationPending && (
            <button
              className="h-11 w-full rounded-control border border-line text-sm font-medium text-ink transition-colors hover:bg-surface disabled:cursor-wait disabled:opacity-60"
              type="button"
              disabled={busy}
              onClick={resendConfirmation}
            >
              {busy ? 'Working…' : 'Resend confirmation email'}
            </button>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {mode === 'forgot-password' ? 'Remember your password?' : mode === 'sign-in' ? 'New here?' : 'Already have an account?'}{' '}
          <button className="min-h-11 font-medium text-ink underline decoration-line underline-offset-4 disabled:opacity-60" type="button" disabled={busy} onClick={() => switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}
