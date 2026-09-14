import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate, AuthScreen } from '@/components/auth/auth-gate';
import { ResetPasswordScreen } from '@/components/auth/reset-password-screen';
import { getSupabaseClient } from '@/lib/supabase/client';
import { WorkoutSync } from '@/components/sync/workout-sync';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ supabaseConfig: () => ({ url: 'https://example.supabase.co', publishableKey: 'test' }) }));
vi.mock('@/components/sync/workout-sync', () => ({ WorkoutSync: vi.fn(({ children }) => children) }));

const user = { id: 'recovering-user', email: 'athlete@example.com' };
const session = { user } as Session;

function setup(sessionValue: Session | null = null) {
  let listener: ((event: AuthChangeEvent, value: Session | null) => void) | undefined;
  const auth = {
    initialize: vi.fn().mockResolvedValue({ error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: sessionValue }, error: null }),
    onAuthStateChange: vi.fn((callback) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
  };
  vi.mocked(getSupabaseClient).mockReturnValue({ auth } as never);
  return { auth, emit: (event: AuthChangeEvent, value: Session | null = session) => act(() => { listener?.(event, value); }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

function fillPasswords(password = 'a-new-password', confirmation = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
  return screen.getByRole('button', { name: 'Save new password' }).closest('form')!;
}

describe('requesting a password reset', () => {
  it('sends to the existing root callback without requiring the forgotten password', async () => {
    const { auth } = setup();
    render(<AuthScreen />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists/)).toBeTruthy();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(user.email, { redirectTo: window.location.origin });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('does not disclose account existence on an API failure', async () => {
    const { auth } = setup();
    auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
    render(<AuthScreen initialMode="forgot-password" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/We couldn’t send the reset email/)).toBeTruthy();
    expect(screen.queryByText('User not found')).toBeNull();
  });

  it('blocks duplicate requests and navigation while sending', async () => {
    const { auth } = setup();
    let resolve!: (result: { error: null }) => void;
    auth.resetPasswordForEmail.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<AuthScreen initialMode="forgot-password" />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } });
    const form = screen.getByRole('button', { name: 'Send reset link' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledOnce();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ error: null }));
  });
});

describe('the recovery callback', () => {
  it('opens password entry before ever mounting workout sync, including a fresh browser', async () => {
    setup(session);
    window.history.replaceState(null, '', '/#type=recovery&access_token=test-token');
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByRole('heading', { name: 'Choose a new password.' })).toBeTruthy();
    expect(WorkoutSync).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?reset-password=1');
  });

  it('responds to PASSWORD_RECOVERY and keeps the form through USER_UPDATED', async () => {
    const { emit } = setup();
    render(<AuthGate><p>Training log</p></AuthGate>);
    await screen.findByRole('button', { name: 'Forgot password?' });
    emit('PASSWORD_RECOVERY');
    expect(screen.getByLabelText('New password')).toBeTruthy();
    emit('USER_UPDATED');
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(WorkoutSync).not.toHaveBeenCalled();
    fireEvent.submit(fillPasswords());
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to training' }));
    expect(screen.getByText('Training log')).toBeTruthy();
    expect(window.location.search).toBe('');
    emit('SIGNED_OUT', null);
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeTruthy();
    expect(screen.queryByText(/This link is invalid/)).toBeNull();
  });

  it('keeps the password form after refreshing the callback page', async () => {
    setup(session);
    window.history.replaceState(null, '', '/?reset-password=1');
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(WorkoutSync).not.toHaveBeenCalled();
  });

  it('offers another email when an expired link is opened while already signed in', async () => {
    setup(session);
    window.history.replaceState(null, '', '/#error=access_denied&error_code=otp_expired');
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByText(/This link is invalid or has expired/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeTruthy();
    expect(WorkoutSync).not.toHaveBeenCalled();
  });

  it('does not use an old session when token validation failed', async () => {
    const { auth } = setup(session);
    auth.initialize.mockResolvedValue({ error: new Error('Invalid token') });
    window.history.replaceState(null, '', '/#type=recovery&access_token=invalid');
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByText(/This link is invalid or has expired/)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('requires a session even when the recovery marker is present', async () => {
    setup();
    window.history.replaceState(null, '', '/?reset-password=1');
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByText(/This link is invalid or has expired/)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });

  it('returns to the reset request if the recovery session expires', async () => {
    const { emit } = setup(session);
    window.history.replaceState(null, '', '/?reset-password=1');
    render(<AuthGate><p>Training log</p></AuthGate>);
    await screen.findByLabelText('New password');
    emit('SIGNED_OUT', null);
    expect(screen.getByText(/This link is invalid or has expired/)).toBeTruthy();
  });

  it('still opens the training log for a normal signed-in user', async () => {
    setup(session);
    render(<AuthGate><p>Training log</p></AuthGate>);
    expect(await screen.findByText('Training log')).toBeTruthy();
  });
});

describe('saving the new password', () => {
  it.each([['short', 'short'], ['long-enough-password', 'different-password']])('rejects invalid password confirmation', (password, confirmation) => {
    const { auth } = setup();
    render(<ResetPasswordScreen onComplete={vi.fn()} onExpired={vi.fn()} />);
    fireEvent.submit(fillPasswords(password, confirmation));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('saves once, clears the inputs and waits for the user to continue', async () => {
    const { auth } = setup();
    const onComplete = vi.fn();
    render(<ResetPasswordScreen onComplete={onComplete} onExpired={vi.fn()} />);
    const form = fillPasswords();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'a-new-password' });
    expect(await screen.findByText(/Your new password is saved/)).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to training' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('leaves the form available after network failure and allows a retry', async () => {
    const { auth } = setup();
    auth.updateUser.mockRejectedValueOnce(new Error('offline'));
    render(<ResetPasswordScreen onComplete={vi.fn()} onExpired={vi.fn()} />);
    fireEvent.submit(fillPasswords());
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.submit(screen.getByRole('button', { name: 'Save new password' }).closest('form')!);
    expect(await screen.findByText(/Your new password is saved/)).toBeTruthy();
  });

  it('routes a rejected recovery session back to the reset request', async () => {
    const { auth } = setup();
    auth.updateUser.mockResolvedValue({ error: { name: 'AuthSessionMissingError' } });
    const onExpired = vi.fn();
    render(<ResetPasswordScreen onComplete={vi.fn()} onExpired={onExpired} />);
    fireEvent.submit(fillPasswords());
    await waitFor(() => expect(onExpired).toHaveBeenCalledOnce());
  });
});
