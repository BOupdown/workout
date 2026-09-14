import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountSync } from '@/components/sync/workout-sync';
import { db } from '@/lib/db/db';
import { startWorkoutSync, type SyncStatus } from '@/lib/supabase/sync';
import { startSession } from '@/lib/db/sessions';
import { resetDatabase } from './helpers';

vi.mock('@/lib/supabase/sync', () => ({ startWorkoutSync: vi.fn() }));
let emit: (status: SyncStatus) => void;
const stop = vi.fn();
beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  vi.mocked(startWorkoutSync).mockImplementation((_user, onStatus) => {
    emit = onStatus!;
    return stop;
  });
});
const mount = () => render(<AccountSync userId="account-a" database={db}><button>Save a set</button></AccountSync>);

it('hides training until the initial cloud snapshot has been prepared', async () => {
  mount();
  expect(screen.queryByRole('button', { name: 'Save a set' })).toBeNull();
  act(() => emit('offline'));
  expect(await screen.findByText(/Connect to load this account/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  await act(async () => { await db.localMetadata.put({ key: 'initialized', value: 'true' }); });
  expect(await screen.findByRole('button', { name: 'Save a set' })).toBeTruthy();
});

it('keeps a previously initialized account available offline and distinguishes pending work', async () => {
  await db.localMetadata.put({ key: 'initialized', value: 'true' });
  mount();
  act(() => emit('offline'));
  expect(await screen.findByRole('button', { name: 'Save a set' })).toBeTruthy();
  expect(screen.getByText('Offline · saved on this device')).toBeTruthy();
  await act(async () => { await startSession(); emit('synced'); });
  await waitFor(() => expect(screen.getByText('Saved on this device · sync pending')).toBeTruthy());
  await act(async () => { await db.syncOperations.clear(); });
  await waitFor(() => expect(screen.getByText('Training synced')).toBeTruthy());
  const session = await db.sessions.toCollection().first();
  await act(async () => { await db.sessions.update(session!.id, { notes: 'Changed offline' }); });
  await waitFor(() => expect(screen.getByText('Saved on this device · sync pending')).toBeTruthy());
});

it('offers retry after failure and stops the previous coordinator', async () => {
  await db.localMetadata.put({ key: 'initialized', value: 'true' });
  const view = mount();
  act(() => emit('error'));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry sync' }));
  expect(stop).toHaveBeenCalledOnce();
  expect(startWorkoutSync).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(stop).toHaveBeenCalledTimes(2);
});
