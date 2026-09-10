import type { SupabaseClient } from '@supabase/supabase-js';
import { db } from '@/lib/db/db';
import { withoutSyncOutbox } from '@/lib/db/sync-mute';
import type {
  BodyWeight,
  Exercise,
  RetiredExercise,
  Session,
  SessionExercise,
  SetEntry,
  SyncOperation,
  SyncTable,
} from '@/lib/db/types';
import type { TrainingBlock } from '@/lib/training-block';
import { getSupabaseClient } from './client';

const REMOTE_TABLE: Record<SyncTable, string> = {
  exercises: 'exercises',
  sessions: 'sessions',
  sessionExercises: 'session_exercises',
  sets: 'sets',
  bodyweights: 'bodyweights',
  trainingBlocks: 'training_blocks',
  retiredExercises: 'retired_exercises',
};

type RemoteRow = Record<string, unknown>;

export type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';

/**
 * The device keeps Dexie as its fast offline copy. This coordinator sends only
 * rows that changed locally, then pulls the account's current snapshot. The
 * server's `updated_at` is the tie breaker: after two offline edits of one
 * field, the write that reaches Supabase last becomes the shared value.
 */
export class WorkoutSync {
  private running = false;

  constructor(
    private readonly userId: string,
    private readonly client: SupabaseClient = getSupabaseClient(),
    private readonly onStatus?: (status: SyncStatus) => void,
  ) {}

  async sync(): Promise<void> {
    if (this.running) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.onStatus?.('offline');
      return;
    }

    this.running = true;
    this.onStatus?.('syncing');
    try {
      await this.ensureProfile();
      const remote = await readRemote(this.client);

      if (await isFirstSync(this.userId)) {
        // A browser can be shared. Once it has belonged to an account, never
        // offer those local rows to the next person who signs in on it.
        if (previousAccount() !== null && previousAccount() !== this.userId) {
          await replaceLocal(remote);
        } else if (hasRemoteData(remote)) await replaceLocal(remote);
        else await uploadSnapshot(this.client, this.userId);
        await db.syncOperations.clear();
      } else {
        await flushOutbox(this.client, this.userId);
        await replaceLocal(await readRemote(this.client));
      }

      markSynced(this.userId);
      this.onStatus?.('synced');
    } catch (error) {
      // The outbox stays untouched on failure. A connectivity hiccup must not
      // make a logged set look saved when it has not reached the account yet.
      console.warn('Workout cloud sync will retry.', error);
      this.onStatus?.('error');
    } finally {
      this.running = false;
    }
  }

  private async ensureProfile() {
    const { error } = await this.client
      .from('profiles')
      .upsert({ user_id: this.userId }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (error) throw error;
  }
}

export function startWorkoutSync(userId: string, onStatus?: (status: SyncStatus) => void): () => void {
  const sync = new WorkoutSync(userId, getSupabaseClient(), onStatus);
  const run = () => void sync.sync();
  run();
  const timer = window.setInterval(run, 12_000);
  window.addEventListener('online', run);
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function stateKey(userId: string) {
  return `workout.sync.initialized.${userId}`;
}

function previousAccount(): string | null {
  return localStorage.getItem('workout.sync.account');
}

async function isFirstSync(userId: string): Promise<boolean> {
  return localStorage.getItem(stateKey(userId)) !== 'true';
}

function markSynced(userId: string) {
  localStorage.setItem(stateKey(userId), 'true');
  localStorage.setItem('workout.sync.account', userId);
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
  return { id: string(row.id), sessionId: string(row.session_id), exerciseId: string(row.exercise_id), order: number(row.position), notes: optionalString(row.notes) };
}
function remoteSet(row: RemoteRow): SetEntry {
  return { id: string(row.id), sessionId: string(row.session_id), sessionExerciseId: string(row.session_exercise_id), exerciseId: string(row.exercise_id), performedAt: timestamp(row.performed_at), loggedAt: timestamp(row.logged_at), order: number(row.position), kind: string(row.kind) as SetEntry['kind'], weightKg: optionalNumber(row.weight_kg), reps: optionalNumber(row.reps), durationSec: optionalNumber(row.duration_sec), rpe: optionalNumber(row.rpe), isFailure: row.is_failure === true, notes: optionalString(row.notes) };
}
function remoteBodyweight(row: RemoteRow): BodyWeight { return { date: string(row.date), weightKg: number(row.weight_kg), recordedAt: timestamp(row.recorded_at) }; }
function remoteBlock(row: RemoteRow): TrainingBlock { return { id: string(row.id), label: string(row.label), startsOn: string(row.starts_on), endsOn: string(row.ends_on), createdAt: timestamp(row.created_at) }; }
function remoteRetired(row: RemoteRow): RetiredExercise { return { nameKey: string(row.name_key), retiredAt: timestamp(row.retired_at) }; }

async function readTable(client: SupabaseClient, table: string, deleted = true): Promise<RemoteRow[]> {
  let query = client.from(table).select('*');
  if (deleted) query = query.is('deleted_at', null);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as RemoteRow[];
}

async function readRemote(client: SupabaseClient) {
  const [exercises, sessions, sessionExercises, sets, bodyweights, trainingBlocks, retiredExercises] = await Promise.all([
    readTable(client, 'exercises'), readTable(client, 'sessions'), readTable(client, 'session_exercises'),
    readTable(client, 'sets'), readTable(client, 'bodyweights'), readTable(client, 'training_blocks'), readTable(client, 'retired_exercises', false),
  ]);
  return { exercises: exercises.map(remoteExercise), sessions: sessions.map(remoteSession), sessionExercises: sessionExercises.map(remoteSessionExercise), sets: sets.map(remoteSet), bodyweights: bodyweights.map(remoteBodyweight), trainingBlocks: trainingBlocks.map(remoteBlock), retiredExercises: retiredExercises.map(remoteRetired) };
}

function hasRemoteData(snapshot: Awaited<ReturnType<typeof readRemote>>) {
  return Object.values(snapshot).some((rows) => rows.length > 0);
}

async function replaceLocal(snapshot: Awaited<ReturnType<typeof readRemote>>) {
  await withoutSyncOutbox(() => db.transaction('rw', [db.exercises, db.sessions, db.sessionExercises, db.sets, db.bodyweights, db.trainingBlocks, db.retiredExercises], async () => {
    await Promise.all([db.exercises.clear(), db.sessions.clear(), db.sessionExercises.clear(), db.sets.clear(), db.bodyweights.clear(), db.trainingBlocks.clear(), db.retiredExercises.clear()]);
    await db.exercises.bulkPut(snapshot.exercises);
    await db.sessions.bulkPut(snapshot.sessions);
    await db.sessionExercises.bulkPut(snapshot.sessionExercises);
    await db.sets.bulkPut(snapshot.sets);
    await db.bodyweights.bulkPut(snapshot.bodyweights);
    await db.trainingBlocks.bulkPut(snapshot.trainingBlocks);
    await db.retiredExercises.bulkPut(snapshot.retiredExercises);
  }));
}

function rowPayload(table: SyncTable, row: Record<string, unknown>, userId: string): RemoteRow {
  const common = { user_id: userId };
  switch (table) {
    case 'exercises': return { ...common, id: row.id, name: row.name, name_key: row.nameKey, load_type: row.loadType, metric: row.metric, per_side: row.perSide, muscle_group: row.muscleGroup ?? null, default_increment_kg: row.defaultIncrementKg ?? null, is_custom: row.isCustom, archived_at: iso(row.archivedAt as number | undefined), notes: row.notes ?? null, created_at: iso(row.createdAt as number) };
    case 'sessions': return { ...common, id: row.id, started_at: iso(row.startedAt as number), ended_at: iso(row.endedAt as number | undefined), date: row.date, title: row.title ?? null, notes: row.notes ?? null, created_at: iso(row.createdAt as number) };
    case 'sessionExercises': return { ...common, id: row.id, session_id: row.sessionId, exercise_id: row.exerciseId, position: row.order, notes: row.notes ?? null };
    case 'sets': return { ...common, id: row.id, session_id: row.sessionId, session_exercise_id: row.sessionExerciseId, exercise_id: row.exerciseId, performed_at: iso(row.performedAt as number), logged_at: iso(row.loggedAt as number), position: row.order, kind: row.kind, weight_kg: row.weightKg ?? null, reps: row.reps ?? null, duration_sec: row.durationSec ?? null, rpe: row.rpe ?? null, is_failure: row.isFailure ?? false, notes: row.notes ?? null };
    case 'bodyweights': return { ...common, date: row.date, weight_kg: row.weightKg, recorded_at: iso(row.recordedAt as number) };
    case 'trainingBlocks': return { ...common, id: row.id, label: row.label, starts_on: row.startsOn, ends_on: row.endsOn, created_at: iso(row.createdAt as number) };
    case 'retiredExercises': return { ...common, name_key: row.nameKey, retired_at: iso(row.retiredAt as number) };
  }
}

async function snapshot() {
  return db.transaction('r', [db.exercises, db.sessions, db.sessionExercises, db.sets, db.bodyweights, db.trainingBlocks, db.retiredExercises], async () => ({
    exercises: await db.exercises.toArray(), sessions: await db.sessions.toArray(), sessionExercises: await db.sessionExercises.toArray(), sets: await db.sets.toArray(), bodyweights: await db.bodyweights.toArray(), trainingBlocks: await db.trainingBlocks.toArray(), retiredExercises: await db.retiredExercises.toArray(),
  }));
}

async function upsertRows(client: SupabaseClient, table: SyncTable, rows: object[], userId: string) {
  if (!rows.length) return;
  const conflict = table === 'bodyweights' ? 'user_id,date' : table === 'retiredExercises' ? 'user_id,name_key' : 'id';
  const { error } = await client.from(REMOTE_TABLE[table]).upsert(rows.map((row) => rowPayload(table, row as Record<string, unknown>, userId)), { onConflict: conflict });
  if (error) throw error;
}

async function uploadSnapshot(client: SupabaseClient, userId: string) {
  const rows = await snapshot();
  await upsertRows(client, 'exercises', rows.exercises, userId);
  await upsertRows(client, 'sessions', rows.sessions, userId);
  await upsertRows(client, 'sessionExercises', rows.sessionExercises, userId);
  await upsertRows(client, 'sets', rows.sets, userId);
  await upsertRows(client, 'bodyweights', rows.bodyweights, userId);
  await upsertRows(client, 'trainingBlocks', rows.trainingBlocks, userId);
  await upsertRows(client, 'retiredExercises', rows.retiredExercises, userId);
}

async function flushOutbox(client: SupabaseClient, userId: string) {
  const pending = await db.syncOperations.orderBy('id').toArray();
  const latest = new Map<string, SyncOperation>();
  for (const operation of pending) latest.set(`${operation.table}:${operation.key}`, operation);
  for (const operation of [...latest.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    await flushOperation(client, userId, operation);
    if (operation.id !== undefined) await db.syncOperations.delete(operation.id);
  }
}

async function flushOperation(client: SupabaseClient, userId: string, operation: SyncOperation) {
  const table = operation.table;
  const source = db.table(table) as typeof db.exercises;
  if (operation.kind === 'upsert') {
    const row = await source.get(operation.key);
    if (row) await upsertRows(client, table, [row], userId);
    return;
  }
  if (table === 'retiredExercises') return; // Tombstones are intentionally permanent.
  let query = client.from(REMOTE_TABLE[table]).update({ deleted_at: new Date().toISOString() });
  query = table === 'bodyweights' ? query.eq('date', operation.key) : query.eq('id', operation.key);
  const { error } = await query;
  if (error) throw error;
}
