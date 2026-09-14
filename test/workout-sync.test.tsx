import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it } from 'vitest';
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
  let duringRead: (() => Promise<void>) | undefined;
  const client = {
    from(table: string) {
      const read = async () => {
        const data = structuredClone(rows.get(table) ?? []);
        if (table === 'sessions' && duringRead) {
          const action = duringRead;
          duringRead = undefined;
          await action();
        }
        return { data, error: null };
      };
      return {
        select: () => ({ is: read, then: (resolve: (value: unknown) => unknown) => read().then(resolve) }),
        async upsert(input: Row | Row[]) {
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
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, rows, onRead: (action: () => Promise<void>) => { duringRead = action; } };
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
  // Install the race after flushing, on the final remote read.
  const originalFrom = remote.client.from.bind(remote.client);
  let sessionReads = 0;
  remote.client.from = ((table: string) => {
    if (table === 'sessions' && ++sessionReads === 2) {
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
