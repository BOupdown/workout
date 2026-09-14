import type { SupabaseClient } from '@supabase/supabase-js';
import { db, type WorkoutDB } from '@/lib/db/db';
import { withoutSyncOutbox } from '@/lib/db/sync-mute';
import type {
  BodyWeight,
  Exercise,
  RetiredExercise,
  Routine,
  ExerciseTarget,
  Session,
  SessionExercise,
  SetEntry,
  SyncOperation,
  SyncTable,
} from '@/lib/db/types';
import type { TrainingBlock } from '@/lib/training-block';
import { getSupabaseClient } from './client';
import { assertRoutineShape } from '@/lib/db/validation';
import { TRAINING_TABLES } from '@/lib/db/account';

const REMOTE_TABLE: Record<SyncTable, string> = {
  exercises: 'exercises',
  sessions: 'sessions',
  sessionExercises: 'session_exercises',
  sets: 'sets',
  bodyweights: 'bodyweights',
  trainingBlocks: 'training_blocks',
  retiredExercises: 'retired_exercises',
  routines: 'routines',
};

type RemoteRow = Record<string, unknown>;

export type SyncStatus = 'syncing' | 'synced' | 'pending' | 'offline' | 'error';

export class WorkoutSync {
  private running = false;
  private readonly abort = new AbortController();

  constructor(
    private readonly userId: string,
    private readonly client: SupabaseClient = getSupabaseClient(),
    private readonly onStatus?: (status: SyncStatus) => void,
    private readonly database: WorkoutDB = db,
  ) {}

  stop(): void { this.abort.abort(); }

  private check = () => {
    if (this.abort.signal.aborted) throw new Error('Sync cancelled.');
  };

  async sync(): Promise<void> {
    if (this.running || this.abort.signal.aborted) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.onStatus?.('offline');
      return;
    }
    this.running = true;
    this.onStatus?.('syncing');
    try {
      const work = async () => {
        this.check();
        const owner = await this.database.localMetadata.get('owner');
        if (owner && owner.value !== this.userId) throw new Error('Local account mismatch.');
        const { error } = await this.client.from('profiles')
          .upsert({ user_id: this.userId }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (error) throw error;
        this.check();
        if (!await this.database.localMetadata.get('initialized')) {
          const remote = await readRemote(this.client, this.userId, this.abort.signal);
          this.check();
          await initializeLocal(this.database, remote, this.check);
        }
        await flushOutbox(this.client, this.userId, this.database, this.check, this.abort.signal);
        this.check();
        const remote = await readRemote(this.client, this.userId, this.abort.signal);
        this.check();
        const applied = await replaceLocal(this.database, remote, this.check);
        this.check();
        this.onStatus?.(applied ? 'synced' : 'pending');
      };
      // Serialize coordinators across tabs of this same account when available.
      if (typeof navigator !== 'undefined' && navigator.locks) {
        await navigator.locks.request(`workout-sync:${this.database.name}`, { signal: this.abort.signal }, work);
      } else await work();
    } catch (error) {
      if (!this.abort.signal.aborted) {
        console.warn('Workout cloud sync will retry.', error);
        this.onStatus?.('error');
      }
    } finally {
      this.running = false;
    }
  }
}

export function startWorkoutSync(userId: string, onStatus?: (status: SyncStatus) => void, database = db): () => void {
  const client = getSupabaseClient();
  const sync = new WorkoutSync(userId, client, onStatus, database);
  const run = () => void sync.sync();
  const timer = window.setInterval(run, 12_000);
  const onVisible = () => { if (document.visibilityState === 'visible') run(); };
  const onOffline = () => onStatus?.('offline');
  window.addEventListener('online', run);
  window.addEventListener('offline', onOffline);
  document.addEventListener('visibilitychange', onVisible);
  const stop = () => {
    sync.stop();
    window.clearInterval(timer);
    window.removeEventListener('online', run);
    window.removeEventListener('offline', onOffline);
    document.removeEventListener('visibilitychange', onVisible);
  };
  // Cancel immediately on the auth event, before React's effect cleanup runs.
  const { data } = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== userId) stop();
  });
  run();
  return () => { stop(); data.subscription.unsubscribe(); };
}

function iso(timestamp: number | undefined): string | null {
  return timestamp === undefined ? null : new Date(timestamp).toISOString();
}

function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) throw new Error('Cloud sync received an invalid timestamp.');
  return parsed;
}

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error('Cloud sync received an invalid number.');
  return parsed;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Cloud sync received an invalid value.');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return value === null ? undefined : string(value);
}

function optionalNumber(value: unknown): number | undefined {
  return value === null ? undefined : number(value);
}

function remoteExercise(row: RemoteRow): Exercise {
  return {
    id: string(row.id), name: string(row.name), nameKey: string(row.name_key),
    loadType: string(row.load_type) as Exercise['loadType'], metric: string(row.metric) as Exercise['metric'],
    perSide: row.per_side === true, isCustom: row.is_custom === true, createdAt: timestamp(row.created_at),
    muscleGroup: optionalString(row.muscle_group) as Exercise['muscleGroup'],
    defaultIncrementKg: optionalNumber(row.default_increment_kg), archivedAt: row.archived_at === null ? undefined : timestamp(row.archived_at),
    notes: optionalString(row.notes),
  };
}

function remoteSession(row: RemoteRow): Session {
  return { id: string(row.id), startedAt: timestamp(row.started_at), endedAt: row.ended_at === null ? undefined : timestamp(row.ended_at), date: string(row.date), title: optionalString(row.title), notes: optionalString(row.notes), createdAt: timestamp(row.created_at) };
}
function remoteSessionExercise(row: RemoteRow): SessionExercise {
  return { id: string(row.id), sessionId: string(row.session_id), exerciseId: string(row.exercise_id), order: number(row.position), notes: optionalString(row.notes), ...(row.target == null ? {} : { target: row.target as ExerciseTarget }) };
}
function remoteSet(row: RemoteRow): SetEntry {
  return { id: string(row.id), sessionId: string(row.session_id), sessionExerciseId: string(row.session_exercise_id), exerciseId: string(row.exercise_id), performedAt: timestamp(row.performed_at), loggedAt: timestamp(row.logged_at), order: number(row.position), kind: string(row.kind) as SetEntry['kind'], weightKg: optionalNumber(row.weight_kg), reps: optionalNumber(row.reps), durationSec: optionalNumber(row.duration_sec), rpe: optionalNumber(row.rpe), isFailure: row.is_failure === true, notes: optionalString(row.notes) };
}
function remoteBodyweight(row: RemoteRow): BodyWeight { return { date: string(row.date), weightKg: number(row.weight_kg), recordedAt: timestamp(row.recorded_at) }; }
function remoteBlock(row: RemoteRow): TrainingBlock { return { id: string(row.id), label: string(row.label), startsOn: string(row.starts_on), endsOn: string(row.ends_on), createdAt: timestamp(row.created_at) }; }
function remoteRetired(row: RemoteRow): RetiredExercise { return { nameKey: string(row.name_key), retiredAt: timestamp(row.retired_at) }; }

function remoteRoutine(row: RemoteRow): Routine {
  const routine = { id: string(row.id), title: string(row.title), exercises: row.exercises, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) };
  assertRoutineShape(routine);
  return routine as Routine;
}

/** Keyset pagination keeps deletions from shifting later pages. Continue to an
 * empty page: a server can cap replies below the requested page size. */
async function readTable(client: SupabaseClient, table: string, userId: string, signal: AbortSignal, deleted = true): Promise<RemoteRow[]> {
  const key = table === 'bodyweights' ? 'date' : table === 'retired_exercises' ? 'name_key' : 'id';
  const rows: RemoteRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    let query = client.from(table).select('*').eq('user_id', userId).order(key).limit(500).abortSignal(signal);
    if (deleted) query = query.is('deleted_at', null);
    if (cursor !== undefined) query = query.gt(key, cursor);
    const { data, error } = await query;
    if (error) throw error;
    if (signal.aborted) throw new Error('Sync cancelled.');
    if (!data) throw new Error('Cloud sync returned no snapshot.');
    if (data.length === 0) return rows;
    const next = string(data[data.length - 1][key]);
    if (cursor !== undefined && next === cursor) throw new Error('Cloud pagination did not advance.');
    rows.push(...data);
    cursor = next;
  }
}

async function readRemote(client: SupabaseClient, userId: string, signal: AbortSignal) {
  const [exercises, sessions, sessionExercises, sets, bodyweights, trainingBlocks, retiredExercises, routines] = await Promise.all([
    readTable(client, 'exercises', userId, signal), readTable(client, 'sessions', userId, signal), readTable(client, 'session_exercises', userId, signal),
    readTable(client, 'sets', userId, signal), readTable(client, 'bodyweights', userId, signal), readTable(client, 'training_blocks', userId, signal), readTable(client, 'retired_exercises', userId, signal, false), readTable(client, 'routines', userId, signal),
  ]);
  const result = { exercises: exercises.map(remoteExercise), sessions: sessions.map(remoteSession), sessionExercises: sessionExercises.map(remoteSessionExercise), sets: sets.map(remoteSet), bodyweights: bodyweights.map(remoteBodyweight), trainingBlocks: trainingBlocks.map(remoteBlock), retiredExercises: retiredExercises.map(remoteRetired), routines: routines.map(remoteRoutine) };
  validateSnapshot(result);
  return result;
}

type Snapshot = Awaited<ReturnType<typeof readRemote>>;
const localKey = (table: SyncTable, row: object): string => {
  const value = row as Record<string, unknown>;
  return String(value.id ?? (table === 'bodyweights' ? value.date : value.nameKey));
};

function validateSnapshot(rows: Snapshot) {
  const exercises = new Set(rows.exercises.map((row) => row.id));
  const sessions = new Set(rows.sessions.map((row) => row.id));
  const blocks = new Map(rows.sessionExercises.map((row) => [row.id, row]));
  if (rows.sessionExercises.some((row) => !sessions.has(row.sessionId) || !exercises.has(row.exerciseId))
    || rows.sets.some((row) => {
      const block = blocks.get(row.sessionExerciseId);
      return !block || block.sessionId !== row.sessionId || block.exerciseId !== row.exerciseId;
    })) throw new Error('Cloud snapshot is incomplete; local data was kept.');
}

/** Called under the same transaction as the pending-write check. */
async function writeSnapshot(database: WorkoutDB, rows: Snapshot) {
  await withoutSyncOutbox(async () => {
    for (const name of TRAINING_TABLES) {
      await database.table(name).clear();
      await database.table(name).bulkPut(rows[name]);
    }
  });
}

async function replaceLocal(database: WorkoutDB, rows: Snapshot, check: () => void) {
  return database.transaction('rw', [...TRAINING_TABLES, 'syncOperations'], async () => {
    check();
    if (await database.syncOperations.count() > 0) return false;
    await writeSnapshot(database, rows);
    check(); // Cancellation also rolls back an import already in progress.
    return true;
  });
}

/** First download merges unsynced training instead of erasing it. A new
 * device's seed IDs differ from the cloud catalogue: remap by unique nameKey
 * before preserving the exercise -> block -> set references. */
async function initializeLocal(database: WorkoutDB, remote: Snapshot, check: () => void) {
  await database.transaction('rw', [...TRAINING_TABLES, 'syncOperations', 'localMetadata'], async () => {
    check();
    if (await database.localMetadata.get('initialized')) return;
    const local = await snapshot(database);
    const pending = await database.syncOperations.orderBy('id').toArray();
    const cloudExists = TRAINING_TABLES.some((name) => remote[name].length > 0);
    const used = new Set([...local.sessionExercises.map((row) => row.exerciseId), ...local.routines.flatMap((routine) => routine.exercises.map((entry) => entry.exerciseId))]);
    const edited = new Set(pending.filter((row) => row.table === 'exercises' && row.kind === 'upsert').map((row) => row.key));
    local.exercises = local.exercises.filter((row) => !cloudExists || row.isCustom || used.has(row.id) || edited.has(row.id));
    const names = new Map(remote.exercises.map((row) => [row.nameKey, row.id]));
    const remap = new Map(local.exercises.map((row) => [row.id, names.get(row.nameKey) ?? row.id]));
    local.exercises = local.exercises.map((row) => ({ ...row, id: remap.get(row.id)! }));
    local.sessionExercises = local.sessionExercises.map((row) => ({ ...row, exerciseId: remap.get(row.exerciseId) ?? row.exerciseId }));
    local.routines = local.routines.map((routine) => ({ ...routine, exercises: routine.exercises.map((entry) => ({ ...entry, exerciseId: remap.get(entry.exerciseId) ?? entry.exerciseId })) }));
    local.sets = local.sets.map((row) => ({ ...row, exerciseId: remap.get(row.exerciseId) ?? row.exerciseId }));
    const deletes = new Map<string, SyncOperation>();
    for (const operation of pending) {
      const id = `${operation.table}:${operation.key}`;
      if (operation.kind === 'delete') deletes.set(id, operation);
      else deletes.delete(id);
    }
    const merged = {} as Snapshot;
    for (const name of TRAINING_TABLES) {
      const values = new Map<string, object>();
      for (const row of remote[name]) values.set(localKey(name, row), row);
      for (const row of local[name]) values.set(localKey(name, row), row);
      for (const operation of deletes.values()) if (operation.table === name) values.delete(operation.key);
      Object.assign(merged, { [name]: [...values.values()] });
    }
    validateSnapshot(merged);
    await writeSnapshot(database, merged);
    await database.syncOperations.clear();
    // Rebuild only this captured initial batch, with parents before children.
    // New writes cannot interleave while this transaction owns the write lock.
    for (const name of TRAINING_TABLES) {
      await database.syncOperations.bulkAdd(local[name].map((row) => ({ table: name, key: localKey(name, row), kind: 'upsert' as const, createdAt: Date.now() })));
    }
    await database.syncOperations.bulkAdd([...deletes.values()].map((row) => ({ table: row.table, key: row.key, kind: row.kind, createdAt: row.createdAt })));
    await database.localMetadata.put({ key: 'initialized', value: 'true' });
    check();
  });
}

function rowPayload(table: SyncTable, row: Record<string, unknown>, userId: string): RemoteRow {
  const common = table === 'retiredExercises' ? { user_id: userId } : { user_id: userId, deleted_at: null };
  switch (table) {
    case 'exercises': return { ...common, id: row.id, name: row.name, name_key: row.nameKey, load_type: row.loadType, metric: row.metric, per_side: row.perSide, muscle_group: row.muscleGroup ?? null, default_increment_kg: row.defaultIncrementKg ?? null, is_custom: row.isCustom, archived_at: iso(row.archivedAt as number | undefined), notes: row.notes ?? null, created_at: iso(row.createdAt as number) };
    case 'sessions': return { ...common, id: row.id, started_at: iso(row.startedAt as number), ended_at: iso(row.endedAt as number | undefined), date: row.date, title: row.title ?? null, notes: row.notes ?? null, created_at: iso(row.createdAt as number) };
    case 'sessionExercises': return { ...common, id: row.id, session_id: row.sessionId, exercise_id: row.exerciseId, position: row.order, notes: row.notes ?? null, target: row.target ?? null };
    case 'sets': return { ...common, id: row.id, session_id: row.sessionId, session_exercise_id: row.sessionExerciseId, exercise_id: row.exerciseId, performed_at: iso(row.performedAt as number), logged_at: iso(row.loggedAt as number), position: row.order, kind: row.kind, weight_kg: row.weightKg ?? null, reps: row.reps ?? null, duration_sec: row.durationSec ?? null, rpe: row.rpe ?? null, is_failure: row.isFailure ?? false, notes: row.notes ?? null };
    case 'bodyweights': return { ...common, date: row.date, weight_kg: row.weightKg, recorded_at: iso(row.recordedAt as number) };
    case 'trainingBlocks': return { ...common, id: row.id, label: row.label, starts_on: row.startsOn, ends_on: row.endsOn, created_at: iso(row.createdAt as number) };
    case 'routines': return { ...common, id: row.id, title: row.title, exercises: row.exercises, created_at: iso(row.createdAt as number), updated_at: iso(row.updatedAt as number) };
    case 'retiredExercises': return { ...common, name_key: row.nameKey, retired_at: iso(row.retiredAt as number) };
  }
}

async function snapshot(database: WorkoutDB) {
  return database.transaction('r', [database.exercises, database.sessions, database.sessionExercises, database.sets, database.bodyweights, database.trainingBlocks, database.retiredExercises, database.routines], async () => ({
    exercises: await database.exercises.toArray(), sessions: await database.sessions.toArray(), sessionExercises: await database.sessionExercises.toArray(), sets: await database.sets.toArray(), bodyweights: await database.bodyweights.toArray(), trainingBlocks: await database.trainingBlocks.toArray(), retiredExercises: await database.retiredExercises.toArray(), routines: await database.routines.toArray(),
  }));
}

async function upsertRows(client: SupabaseClient, table: SyncTable, rows: object[], userId: string, signal: AbortSignal) {
  if (!rows.length) return;
  const conflict = table === 'bodyweights' ? 'user_id,date' : table === 'retiredExercises' ? 'user_id,name_key' : 'id';
  const { error } = await client.from(REMOTE_TABLE[table]).upsert(rows.map((row) => rowPayload(table, row as Record<string, unknown>, userId)), { onConflict: conflict }).abortSignal(signal);
  if (error) throw error;
}

async function flushOutbox(client: SupabaseClient, userId: string, database: WorkoutDB, check: () => void, signal: AbortSignal) {
  const pending = await database.syncOperations.orderBy('id').toArray();
  const latest = new Map<string, SyncOperation>();
  for (const operation of pending) latest.set(`${operation.table}:${operation.key}`, operation);
  // Map keeps the first insertion's position when its value is replaced. Keep
  // that dependency order: editing a newly created session after logging a set
  // must not move its upload behind the set that references it.
  const operations = [...latest.values()];
  for (let index = 0; index < operations.length;) {
    check();
    const operation = operations[index++];
    const batch = [operation];
    // Batch adjacent upserts only, preserving parent/child and deletion order.
    if (operation.kind === 'upsert') {
      while (index < operations.length && batch.length < 100
        && operations[index].kind === 'upsert' && operations[index].table === operation.table) {
        batch.push(operations[index++]);
      }
      const rows = await database.table(operation.table).bulkGet(batch.map((item) => item.key));
      check();
      await upsertRows(client, operation.table, rows.filter((row) => row !== undefined), userId, signal);
    } else await flushOperation(client, userId, operation, signal);
    check();
    const keys = new Set(batch.map((item) => item.key));
    const acknowledged = pending
      .filter((item) => item.table === operation.table && keys.has(item.key))
      .flatMap((item) => item.id === undefined ? [] : [item.id]);
    await database.syncOperations.bulkDelete(acknowledged);
  }
}

async function flushOperation(client: SupabaseClient, userId: string, operation: SyncOperation, signal: AbortSignal) {
  const table = operation.table;
  if (table === 'retiredExercises') return; // Tombstones are intentionally permanent.
  let query = client.from(REMOTE_TABLE[table]).update({ deleted_at: new Date().toISOString() }).eq('user_id', userId).abortSignal(signal);
  query = table === 'bodyweights' ? query.eq('date', operation.key) : query.eq('id', operation.key);
  const { error } = await query;
  if (error) throw error;
}
