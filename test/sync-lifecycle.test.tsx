import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '@/lib/supabase/client';
import { startWorkoutSync, WorkoutSync } from '@/lib/supabase/sync';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
beforeEach(() => { vi.restoreAllMocks(); });

it('cancels immediately on an account change and removes all scheduled retries', () => {
  vi.useFakeTimers();
  let auth: (event: AuthChangeEvent, session: Session | null) => void;
  const unsubscribe = vi.fn();
  vi.mocked(getSupabaseClient).mockReturnValue({ auth: {
    onAuthStateChange: (callback: typeof auth) => {
      auth = callback;
      return { data: { subscription: { unsubscribe } } };
    },
  } } as never);
  const run = vi.spyOn(WorkoutSync.prototype, 'sync').mockResolvedValue();
  const stop = vi.spyOn(WorkoutSync.prototype, 'stop');
  try {
    const cleanup = startWorkoutSync('account-a');
    expect(run).toHaveBeenCalledOnce();
    auth!('SIGNED_IN', { user: { id: 'account-b' } } as Session);
    expect(stop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(24_000);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(run).toHaveBeenCalledOnce();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
