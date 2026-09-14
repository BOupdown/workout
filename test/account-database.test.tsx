import { afterEach, beforeEach, expect, it } from 'vitest';
import { db, WorkoutDB } from '@/lib/db/db';
import { accountDatabaseName, prepareAccountDatabase } from '@/lib/db/account';
import { startSession } from '@/lib/db/sessions';
import { resetDatabase } from './helpers';

const opened: WorkoutDB[] = [];
beforeEach(async () => { localStorage.clear(); await resetDatabase(); });
afterEach(async () => {
  for (const database of opened) database.close();
  opened.length = 0;
  for (const id of ['account-a', 'account-b']) {
    const database = new WorkoutDB(accountDatabaseName(id));
    await database.delete();
  }
});
async function open(id: string) {
  const database = await prepareAccountDatabase(id);
  opened.push(database);
  return database;
}

it('migrates the owner’s history and pending queue without deleting the legacy copy', async () => {
  localStorage.setItem('workout.sync.account', 'account-a');
  localStorage.setItem('workout.sync.initialized.account-a', 'true');
  const { session } = await startSession();
  const pending = await db.syncOperations.toArray();
  const account = await open('account-a');
  expect(await account.sessions.get(session.id)).toMatchObject(session);
  expect(await account.syncOperations.toArray()).toEqual(pending);
  expect(await account.localMetadata.get('initialized')).toBeDefined();
  expect(await db.sessions.get(session.id)).toMatchObject(session);
});

it('keeps account A’s unsent work isolated through A → B → A, including offline use', async () => {
  localStorage.setItem('workout.sync.account', 'account-a');
  const { session } = await startSession();
  const first = await open('account-a');
  await first.sessions.update(session.id, { notes: 'Not uploaded yet' });
  const second = await open('account-b');
  expect(await second.sessions.count()).toBe(0);
  expect(await second.syncOperations.count()).toBe(0);
  expect(await second.localMetadata.get('initialized')).toBeUndefined();
  const restored = await open('account-a');
  expect((await restored.sessions.get(session.id))?.notes).toBe('Not uploaded yet');
  expect(await restored.syncOperations.count()).toBeGreaterThan(0);
});

it('does not give the previous account’s history to the first different account opened after upgrade', async () => {
  localStorage.setItem('workout.sync.account', 'account-a');
  const { session } = await startSession();
  expect(await (await open('account-b')).sessions.count()).toBe(0);
  expect(await (await open('account-a')).sessions.get(session.id)).toMatchObject(session);
});

it('claims previously local-only history for just one account across concurrent tabs', async () => {
  await startSession();
  const accounts = await Promise.all([open('account-a'), open('account-b')]);
  const counts = await Promise.all(accounts.map((account) => account.sessions.count()));
  expect(counts.sort()).toEqual([0, 1]);
});
