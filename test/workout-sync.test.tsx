import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '../lib/db/db';
import { startSession, getActiveSession, addExerciseToSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import { WorkoutSync } from '../lib/supabase/sync';
import { referenceExercises, resetDatabase } from './helpers';

type Row = Record<string, unknown>;
const userId = 'sync-test-user';

// In-memory remote, with a controllable response delay. Local IndexedDB and
// all production write/sync code stay real so missing outbox writes are caught.
function remoteClient() {
  const rows = new Map<string, Row[]>();
  let cap = 1000;
  let failAfter: string | undefined;
  let duringRead: (() => Promise<void>) | undefined;
  const client = {
    from(table: string) {
      let after: string | undefined;
      let order = 'id';
      let maximum = 1000;
      const read = async () => {
        if (table === failAfter && after) return { data: null, error: new Error('Network interrupted') };
        const data = structuredClone(rows.get(table) ?? [])
          .filter((row) => !row.deleted_at && (!after || String(row[order]) > after))
          .sort((a, b) => String(a[order]).localeCompare(String(b[order])))
          .slice(0, Math.min(maximum, cap));
        if (table === 'sessions' && duringRead) {
          const action = duringRead;
          duringRead = undefined;
          await action();
        }
        return { data, error: null };
      };
      const query = {
        is: () => query,
        eq: () => query,
        order: (key: string) => { order = key; return query; },
        gt: (_key: string, cursor: string) => { after = cursor; return query; },
        limit: (count: number) => { maximum = count; return query; },
        abortSignal: () => query,
        then: (resolve: (value: unknown) => unknown) => read().then(resolve),
      };
      return {
        select: () => query,
        upsert(input: Row | Row[]) {
          const write = async () => {
          const stored = rows.get(table) ?? [];
          for (const row of Array.isArray(input) ? input : [input]) {
            for (const [field, parent] of [
              ['session_id', 'sessions'], ['exercise_id', 'exercises'],
              ['session_exercise_id', 'session_exercises'],
            ]) {
              if (row[field] && !rows.get(parent)?.some((value) => value.id === row[field])) {
                return { error: new Error(`Missing ${parent} parent`) };
              }
            }
            const key = (value: Row) => value.id ?? value.date ?? value.name_key ?? value.user_id;
            const index = stored.findIndex((value) => key(value) === key(row));
            if (index < 0) stored.push(structuredClone(row));
            else stored[index] = structuredClone(row);
          }
          rows.set(table, stored);
          return { error: null };
          };
          return { then: (resolve: (value: unknown) => unknown) => write().then(resolve), abortSignal: () => write() };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows, setCap: (value: number) => { cap = value; }, failLaterPage: (table?: string) => { failAfter = table; }, onRead: (action: () => Promise<void>) => { duringRead = action; } };
}

beforeEach(async () => {
  localStorage.clear();
  await resetDatabase();
});

it('keeps the active session and its sets through repeated periodic syncs', async () => {
  const remote = remoteClient();
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  const { squat } = await referenceExercises();
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  const set = await createSet({ sessionExerciseId: block.id, kind: 'work', reps: 8, weightKg: 60 });
  // Several edits to one row must all be acknowledged when its latest value
  // reaches the cloud; old intents must not block future downloads forever.
  await db.sessions.update(session.id, { notes: 'First note' });
  await db.sessions.update(session.id, { notes: 'Final note' });

  for (let cycle = 0; cycle < 5; cycle++) {
    await sync.sync();
    expect((await getActiveSession())?.id).toBe(session.id);
    expect(await db.sets.get(set.id)).toMatchObject(set);
    expect(await db.syncOperations.count()).toBe(0);
  }
  expect(remote.rows.get('sessions')).toEqual([expect.objectContaining({ id: session.id, ended_at: null })]);
  expect(remote.rows.get('sets')).toEqual([expect.objectContaining({ id: set.id })]);
  expect(await db.syncOperations.count()).toBe(0);
});

it('keeps a session started while the cloud snapshot is downloading', async () => {
  const remote = remoteClient();
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  let sessionId: string | undefined;
  // Install the race on a cloud read.
  const originalFrom = remote.client.from.bind(remote.client);
  let sessionReads = 0;
  remote.client.from = ((table: string) => {
    if (table === 'sessions' && ++sessionReads === 1) {
      remote.onRead(async () => { sessionId = (await startSession()).session.id; });
    }
    return originalFrom(table);
  }) as typeof remote.client.from;

  await sync.sync();
  expect(sessionId).toBeDefined();
  expect((await getActiveSession())?.id).toBe(sessionId);
  expect(await db.syncOperations.count()).toBeGreaterThan(0);
  await sync.sync();
  expect((await getActiveSession())?.id).toBe(sessionId);
  expect(remote.rows.get('sessions')).toEqual([expect.objectContaining({ id: sessionId })]);
});


it('preserves work started during the first download and uploads it with its parents', async () => {
  const remote = remoteClient();
  await new WorkoutSync(userId, remote.client).sync();
  // Simulate another device with a fresh catalogue and no sync marker.
  localStorage.clear();
  await resetDatabase();
  let sessionId: string | undefined;
  remote.onRead(async () => {
    const { squat } = await referenceExercises();
    sessionId = (await startSession()).session.id;
    const block = await addExerciseToSession(sessionId, squat.id);
    await createSet({ sessionExerciseId: block.id, kind: 'work', reps: 8, weightKg: 60 });
  });
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  await sync.sync();
  expect((await getActiveSession())?.id).toBe(sessionId);
  expect(remote.rows.get('sessions')).toEqual([expect.objectContaining({ id: sessionId })]);
  expect(remote.rows.get('sets')).toHaveLength(1);
  expect(await db.syncOperations.count()).toBe(0);
});

it('loads every row beyond the server limit before replacing local history', async () => {
  const remote = remoteClient();
  const { squat } = await referenceExercises();
  const { session } = await startSession();
  const block = await addExerciseToSession(session.id, squat.id);
  await createSet({ sessionExerciseId: block.id, kind: 'work', reps: 8, weightKg: 60 });
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  const original = remote.rows.get('sets')![0];
  remote.rows.set('sets', Array.from({ length: 1201 }, (_, i) => ({ ...original, id: `large-${String(i).padStart(4, '0')}`, position: i })));
  await sync.sync();
  expect(await db.sets.count()).toBe(1201);
});


it('continues even when the server caps pages below the requested size', async () => {
  const remote = remoteClient();
  await new WorkoutSync(userId, remote.client).sync();
  remote.setCap(7);
  const expected = remote.rows.get('exercises')!.length;
  await new WorkoutSync(userId, remote.client).sync();
  expect(await db.exercises.count()).toBe(expected);
});

it('keeps the entire local history when a later page fails, then recovers on retry', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  const { session } = await startSession();
  await sync.sync();
  remote.setCap(7);
  remote.failLaterPage('exercises');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await sync.sync();
  expect(await db.sessions.get(session.id)).toMatchObject(session);
  expect(status).toHaveBeenLastCalledWith('error');
  remote.failLaterPage();
  await sync.sync();
  expect(status).toHaveBeenLastCalledWith('synced');
  warning.mockRestore();
});

it('does not replace local data or report success after cancellation during a read', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  const { session } = await startSession();
  await sync.sync();
  remote.rows.set('sessions', []);
  remote.onRead(async () => { sync.stop(); });
  status.mockClear();
  await sync.sync();
  expect(await db.sessions.get(session.id)).toMatchObject(session);
  expect(status).not.toHaveBeenCalledWith('synced');
  expect(status).not.toHaveBeenCalledWith('error');
});

it('keeps the upload intent if stopped after the server receives a write', async () => {
  const remote = remoteClient();
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  await startSession();
  const original = remote.client.from.bind(remote.client);
  remote.client.from = ((table: string) => {
    const result = original(table);
    if (table !== 'sessions') return result;
    return { ...result, upsert: (...args: unknown[]) => ({ abortSignal: async () => {
      const response = await result.upsert(args[0] as Row | Row[]);
      sync.stop();
      return response;
    } }) };
  }) as typeof remote.client.from;
  await sync.sync();
  expect(await db.syncOperations.count()).toBeGreaterThan(0);
  expect(remote.rows.get('sessions')).toHaveLength(1);
});

it('refuses to sync a database belonging to another account', async () => {
  const remote = remoteClient();
  await db.localMetadata.put({ key: 'owner', value: 'other-user' });
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const status = vi.fn();
  await new WorkoutSync(userId, remote.client, status).sync();
  expect(remote.rows.size).toBe(0);
  expect(status).toHaveBeenLastCalledWith('error');
  warning.mockRestore();
});
