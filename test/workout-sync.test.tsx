import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import randomBackup from '../docs/import-sync-2026-09-15/random-backup.json';
import { exportDatabase, importDatabase, parseBackup } from '../lib/db/backup';
import { db } from '../lib/db/db';
import { startSession, getActiveSession, addExerciseToSession } from '../lib/db/sessions';
import { createSet } from '../lib/db/sets';
import { WorkoutSync } from '../lib/supabase/sync';
import { saveRoutine, deleteRoutine, startSessionFromRoutine } from '../lib/db/routines';
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
  let duringReadTable = 'sessions';
  const client = {
    from(table: string) {
      let after: string | undefined;
      let order = 'id';
      let maximum = 1000;
      let activeOnly = false;
      const read = async () => {
        if (table === failAfter && after) return { data: null, error: new Error('Network interrupted') };
        const data = structuredClone(rows.get(table) ?? [])
          .filter((row) => (!activeOnly || !row.deleted_at) && (!after || String(row[order]) > after))
          .sort((a, b) => String(a[order]).localeCompare(String(b[order])))
          .slice(0, Math.min(maximum, cap));
        if (table === duringReadTable && duringRead) {
          const action = duringRead;
          duringRead = undefined;
          await action();
        }
        return { data, error: null };
      };
      const query = {
        is: () => { activeOnly = true; return query; },
        eq: () => query,
        order: (key: string) => { order = key; return query; },
        gt: (_key: string, cursor: string) => { after = cursor; return query; },
        limit: (count: number) => { maximum = count; return query; },
        abortSignal: () => query,
        then: (resolve: (value: unknown) => unknown) => read().then(resolve),
      };
      return {
        select: () => query,
        update(changes: Row) {
          const filters: Array<[string, unknown]> = [];
          const mutation = {
            eq: (field: string, value: unknown) => { filters.push([field, value]); return mutation; },
            abortSignal: () => mutation,
            then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(() => {
              for (const row of rows.get(table) ?? []) {
                if (filters.every(([field, value]) => row[field] === value)) Object.assign(row, changes);
              }
              return resolve({ error: null });
            }),
          };
          return mutation;
        },
        upsert(input: Row | Row[]) {
          const write = async () => {
          const stored = structuredClone(rows.get(table) ?? []);
          for (const row of Array.isArray(input) ? input : [input]) {
            for (const [field, parent] of [
              ['session_id', 'sessions'], ['exercise_id', 'exercises'],
              ['session_exercise_id', 'session_exercises'],
            ]) {
              if (row[field] && !rows.get(parent)?.some((value) => value.id === row[field])) {
                return { error: new Error(`Missing ${parent} parent`) };
              }
            }
            // SQL reserves names even after a soft deletion. A rejected batch is atomic.
            if (table === 'exercises' && stored.some((value) => value.user_id === row.user_id && value.name_key === row.name_key && value.id !== row.id)) {
              return { error: new Error('duplicate key: exercises_user_id_name_key_key') };
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
  return { client, rows, setCap: (value: number) => { cap = value; }, failLaterPage: (table?: string) => { failAfter = table; }, onRead: (action: () => Promise<void>, table = 'sessions') => { duringRead = action; duringReadTable = table; } };
}

beforeEach(async () => {
  localStorage.clear();
  await resetDatabase();
});

it('syncs routine targets to another device and retains the session after routine deletion', async () => {
  const remote = remoteClient();
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  const { squat } = await referenceExercises();
  const target = { metric: 'reps' as const, sets: 4, repsMin: 6, repsMax: 8, restSec: 150 };
  const routine = await saveRoutine({ title: 'Strength', exercises: [{ id: 'first', exerciseId: squat.id, exerciseName: squat.name, target }] });
  const { session } = await startSessionFromRoutine(routine.id);
  await sync.sync();
  expect(remote.rows.get('routines')?.[0]).toMatchObject({ id: routine.id, exercises: routine.exercises });
  expect(remote.rows.get('session_exercises')?.[0].target).toEqual(target);
  await resetDatabase();
  const anotherDevice = new WorkoutSync(userId, remote.client);
  await anotherDevice.sync();
  expect(await db.routines.get(routine.id)).toEqual(routine);
  expect((await db.sessionExercises.toArray())[0].target).toEqual(target);
  await deleteRoutine(routine.id);
  await anotherDevice.sync();
  expect(await db.routines.count()).toBe(0);
  expect(remote.rows.get('routines')?.[0].deleted_at).toBeTruthy();
  expect((await db.sessions.get(session.id))?.id).toBe(session.id);
  expect((await db.sessionExercises.toArray())[0].target).toEqual(target);
});

it('remaps exercises in a routine made offline before the first download', async () => {
  const remote = remoteClient();
  await new WorkoutSync(userId, remote.client).sync();
  const cloudSquat = (await referenceExercises()).squat;
  await resetDatabase();
  const { squat } = await referenceExercises();
  const routine = await saveRoutine({ title: 'Offline', exercises: [{ id: 'first', exerciseId: squat.id, exerciseName: squat.name, target: { metric: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 } }] });
  const sync = new WorkoutSync(userId, remote.client);
  await sync.sync();
  expect((await db.routines.get(routine.id))?.exercises[0].exerciseId).toBe(cloudSquat.id);
  expect(remote.rows.get('routines')?.[0].exercises).toEqual((await db.routines.get(routine.id))?.exercises);
  await expect(startSessionFromRoutine(routine.id)).resolves.toHaveProperty('firstBlockId');
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


it.each(['before first sync', 'same exercise IDs', 'different exercise IDs', 'previously failed import'])(
  'syncs a random JSON backup: %s', async (scenario) => {
    const remote = remoteClient();
    const status = vi.fn();
    const sync = new WorkoutSync(userId, remote.client, status);
    const backup = parseBackup(JSON.stringify(randomBackup));
    if (scenario === 'same exercise IDs') await importDatabase(backup);
    if (scenario !== 'before first sync') {
      await sync.sync();
      expect(status).toHaveBeenLastCalledWith('synced');
    }
    const cloudIds = new Map(remote.rows.get('exercises')?.map(row => [row.name_key, row.id]));
    await importDatabase(backup);
    if (scenario === 'previously failed import') {
      // The old importer already acknowledged deletes before its upload failed.
      for (const row of remote.rows.get('exercises') ?? []) row.deleted_at = new Date().toISOString();
      await db.syncOperations.filter(row => row.table === 'exercises' && row.kind === 'delete').delete();
    }
    await sync.sync();
    expect(status).toHaveBeenLastCalledWith('synced');
    expect(await db.syncOperations.count()).toBe(0);
    expect(await db.sessions.count()).toBe(6);
    expect(await db.sets.count()).toBe(72);
    expect(remote.rows.get('sessions')?.filter(row => !row.deleted_at)).toHaveLength(6);
    expect(remote.rows.get('sets')?.filter(row => !row.deleted_at)).toHaveLength(72);
    for (const exercise of backup.exercises) {
      const canonicalId = cloudIds.get(exercise.nameKey) ?? exercise.id;
      expect(await db.exercises.where('nameKey').equals(exercise.nameKey).first()).toMatchObject({ id: canonicalId });
      for (const set of backup.sets.filter(row => row.exerciseId === exercise.id)) {
        expect(await db.sets.get(set.id)).toMatchObject({ exerciseId: canonicalId, weightKg: set.weightKg, reps: set.reps });
        expect(remote.rows.get('sets')?.find(row => row.id === set.id)).toMatchObject({ exercise_id: canonicalId, weight_kg: set.weightKg, reps: set.reps });
        expect(await db.sessionExercises.get(set.sessionExerciseId)).toMatchObject({ exerciseId: canonicalId });
      }
    }
    // A second device must download the complete restored history too.
    await resetDatabase();
    await new WorkoutSync(userId, remote.client, status).sync();
    expect(status).toHaveBeenLastCalledWith('synced');
    expect(await db.sessions.count()).toBe(6);
    expect(await db.sets.count()).toBe(72);
  },
);

it('remaps imported routines and keeps deletions from the JSON restore', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  const cloudSquat = (await referenceExercises()).squat;
  const oldSession = (await startSession()).session;
  await sync.sync();
  const backup = parseBackup(JSON.stringify(randomBackup));
  const importedSquat = backup.exercises.find(row => row.nameKey === 'squat')!;
  const target = { metric: 'reps' as const, sets: 3, repsMin: 8, repsMax: 12, restSec: 90 };
  backup.routines = [{ id: 'imported-routine', title: 'Imported', createdAt: 1, updatedAt: 1,
    exercises: [{ id: 'first', exerciseId: importedSquat.id, exerciseName: importedSquat.name, target }] }];
  await importDatabase(backup);
  await sync.sync();
  expect(status).toHaveBeenLastCalledWith('synced');
  expect(remote.rows.get('sessions')?.find(row => row.id === oldSession.id)?.deleted_at).toBeTruthy();
  expect(await db.sessions.get(oldSession.id)).toBeUndefined();
  expect((await db.routines.get('imported-routine'))?.exercises[0]).toMatchObject({ exerciseId: cloudSquat.id, target });
  const started = await startSessionFromRoutine('imported-routine');
  await sync.sync();
  expect(status).toHaveBeenLastCalledWith('synced');
  expect(await db.sessionExercises.get(started.firstBlockId!)).toMatchObject({ exerciseId: cloudSquat.id, target });
});

it('keeps the import and outbox intact if the exercise lookup is interrupted, then recovers', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  await importDatabase(parseBackup(JSON.stringify(randomBackup)));
  const before = await exportDatabase();
  const pending = await db.syncOperations.toArray();
  remote.setCap(7);
  remote.failLaterPage('exercises');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await sync.sync();
    expect(status).toHaveBeenLastCalledWith('error');
    expect((await exportDatabase()).sets).toEqual(before.sets);
    expect((await exportDatabase()).exercises).toEqual(before.exercises);
    expect(await db.syncOperations.toArray()).toEqual(pending);
    remote.failLaterPage();
    await sync.sync();
    expect(status).toHaveBeenLastCalledWith('synced');
    expect(await db.syncOperations.count()).toBe(0);
  } finally { warning.mockRestore(); }
});


it('includes edits committed while the exercise identities are downloading', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  const cloudSquat = (await referenceExercises()).squat;
  await importDatabase(parseBackup(JSON.stringify(randomBackup)));
  let routineId: string | undefined;
  remote.onRead(async () => {
    const squat = await db.exercises.where('nameKey').equals('squat').first();
    routineId = (await saveRoutine({ title: 'During sync', exercises: [{ id: 'first', exerciseId: squat!.id, exerciseName: squat!.name,
      target: { metric: 'reps', sets: 3, repsMin: 8, repsMax: 12, restSec: 90 } }] })).id;
  }, 'exercises');
  await sync.sync();
  expect(status).toHaveBeenLastCalledWith('synced');
  expect((await db.routines.get(routineId!))?.exercises[0].exerciseId).toBe(cloudSquat.id);
  expect(remote.rows.get('routines')?.find(row => row.id === routineId)?.exercises).toEqual((await db.routines.get(routineId!))?.exercises);
  expect(await db.syncOperations.count()).toBe(0);
});

it('rolls back reference changes and upload intents when cancelled during reconciliation', async () => {
  const remote = remoteClient();
  const status = vi.fn();
  const sync = new WorkoutSync(userId, remote.client, status);
  await sync.sync();
  await importDatabase(parseBackup(JSON.stringify(randomBackup)));
  const before = await exportDatabase();
  const pending = await db.syncOperations.toArray();
  const cancel = () => { sync.stop(); };
  db.sessionExercises.hook('updating', cancel);
  status.mockClear();
  try {
    await sync.sync();
    expect(status).not.toHaveBeenCalledWith('synced');
    expect((await exportDatabase()).exercises).toEqual(before.exercises);
    expect((await exportDatabase()).sessionExercises).toEqual(before.sessionExercises);
    expect((await exportDatabase()).sets).toEqual(before.sets);
    expect(await db.syncOperations.toArray()).toEqual(pending);
  } finally { db.sessionExercises.hook('updating').unsubscribe(cancel); }
  await new WorkoutSync(userId, remote.client, status).sync();
  expect(status).toHaveBeenLastCalledWith('synced');
});
