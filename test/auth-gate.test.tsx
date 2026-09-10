import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthScreen } from '@/components/auth/auth-gate';
import { getSupabaseClient } from '@/lib/supabase/client';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));

const confirmationResponse = () => ({ data: { session: null, user: { id: 'user-id' } }, error: null });

function setupClient({
  signUp = vi.fn().mockResolvedValue(confirmationResponse()),
  resend = vi.fn().mockResolvedValue({ error: null }),
}: {
  signUp?: ReturnType<typeof vi.fn>;
  resend?: ReturnType<typeof vi.fn>;
} = {}) {
  vi.mocked(getSupabaseClient).mockReturnValue({
    auth: { signUp, resend, signInWithPassword: vi.fn() },
  } as never);

  return { signUp, resend };
}

async function submitSignUp(email = 'athlete@example.com') {
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'strong-password' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!);
}

describe('AuthScreen signup confirmations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the same safe confirmation path for a normal signup', async () => {
    const { signUp } = setupClient();
    render(<AuthScreen />);

    await submitSignUp();

    expect(signUp).toHaveBeenCalledWith({
      email: 'athlete@example.com',
      password: 'strong-password',
      options: { emailRedirectTo: window.location.origin },
    });
    expect(await screen.findByText(/If this address needs confirmation/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend confirmation email' })).toBeTruthy();
  });

  it('does not reveal an existing account when Supabase returns its opaque signup response', async () => {
    const { signUp } = setupClient({ signUp: vi.fn().mockResolvedValue(confirmationResponse()) });
    render(<AuthScreen />);

    await submitSignUp('existing@example.com');

    expect(signUp).toHaveBeenCalledOnce();
    expect(await screen.findByText(/If this address needs confirmation/)).toBeTruthy();
    expect(screen.queryByText(/already registered/i)).toBeNull();
  });

  it('offers the same resend action for an unconfirmed account', async () => {
    const { resend } = setupClient({
      signUp: vi.fn().mockResolvedValue({
        data: { session: null, user: { id: 'unconfirmed-user', email_confirmed_at: null } },
        error: null,
      }),
    });
    render(<AuthScreen />);

    await submitSignUp('unconfirmed@example.com');
    fireEvent.click(await screen.findByRole('button', { name: 'Resend confirmation email' }));

    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'unconfirmed@example.com',
      options: { emailRedirectTo: window.location.origin },
    });
    expect(await screen.findByText(/If confirmation is available/)).toBeTruthy();
  });

  it('keeps resend failures generic', async () => {
    setupClient({ resend: vi.fn().mockResolvedValue({ error: new Error('User not found') }) });
    render(<AuthScreen />);

    await submitSignUp();
    fireEvent.click(await screen.findByRole('button', { name: 'Resend confirmation email' }));

    expect(await screen.findByText(/We couldn’t resend the confirmation email/)).toBeTruthy();
    expect(screen.queryByText('User not found')).toBeNull();
  });

  it('prevents two submissions while the first request is still running', async () => {
    let resolveSignUp: ((value: ReturnType<typeof confirmationResponse>) => void) | undefined;
    const signUp = vi.fn().mockImplementation(
      () => new Promise<ReturnType<typeof confirmationResponse>>((resolve) => (resolveSignUp = resolve)),
    );
    setupClient({ signUp });
    render(<AuthScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'athlete@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'strong-password' } });
    const form = screen.getByRole('button', { name: 'Create account' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(signUp).toHaveBeenCalledOnce();
    resolveSignUp?.(confirmationResponse());
    expect(await screen.findByText(/If this address needs confirmation/)).toBeTruthy();
  });
});
