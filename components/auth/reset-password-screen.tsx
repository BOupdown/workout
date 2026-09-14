'use client';

import { LockKey } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';

/** Mounted only after AuthGate has established the recovery session. */
export function ResetPasswordScreen({ email, onComplete, onExpired }: {
  email?: string;
  onComplete: () => void;
  onExpired: () => void;
}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || saved) return;
    if (password.length < 8) {
      setMessage('Use at least 8 characters for your new password.');
      return;
    }
    if (password !== confirmation) {
      setMessage('The passwords don’t match. Please enter the same password twice.');
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await getSupabaseClient().auth.updateUser({ password });
      if (error) {
        if (error.name === 'AuthSessionMissingError' || error.status === 401
          || error.code === 'session_not_found') {
          onExpired();
          return;
        }
        setMessage(error.code === 'same_password'
          ? 'Choose a password different from your old password.'
          : error.code === 'weak_password'
            ? 'Choose a stronger password with letters, numbers and symbols.'
            : 'We couldn’t update your password. Please try again.');
        return;
      }
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch {
      setMessage('We couldn’t update your password. Check your connection and try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-surface px-5 py-8">
      <section className="w-full max-w-[25rem] rounded-panel border border-line bg-raised p-6 shadow-sm sm:p-8">
        <div className="flex h-11 w-11 items-center justify-center rounded-control bg-accent text-accent-ink">
          <LockKey size={24} weight="bold" aria-hidden />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-ink">
          {saved ? 'Password updated.' : 'Choose a new password.'}
        </h1>
        {saved ? (
          <>
            <p className="mt-2 text-sm leading-6 text-muted" role="status">
              Your new password is saved. Use it the next time you sign in.
            </p>
            <button type="button" onClick={onComplete}
              className="mt-7 flex h-14 w-full items-center justify-center rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink">
              Continue to training
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 break-words text-sm leading-6 text-muted">
              {email ? `Set a new password for ${email}.` : 'Set a new password for your account.'} Use at least 8 characters.
            </p>
            <form className="mt-7 space-y-4" onSubmit={submit}>
              <label className="block text-sm font-medium text-ink">
                New password
                <input type="password" autoComplete="new-password" minLength={8} required disabled={busy}
                  value={password} onChange={(event) => setPassword(event.target.value)}
                  className="mt-1.5 h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition focus:border-ink" />
              </label>
              <label className="block text-sm font-medium text-ink">
                Confirm new password
                <input type="password" autoComplete="new-password" minLength={8} required disabled={busy}
                  value={confirmation} onChange={(event) => setConfirmation(event.target.value)}
                  className="mt-1.5 h-12 w-full rounded-control border border-line bg-surface px-3 text-base text-ink outline-none transition focus:border-ink" />
              </label>
              {message && <p className="rounded-control bg-accent-wash px-3 py-2.5 text-sm leading-5 text-ink" role="alert">{message}</p>}
              <button type="submit" disabled={busy}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-control bg-accent text-[0.9375rem] font-semibold text-accent-ink disabled:cursor-wait disabled:opacity-60">
                <LockKey size={18} weight="bold" aria-hidden />
                {busy ? 'Saving…' : 'Save new password'}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
