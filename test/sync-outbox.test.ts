import { beforeEach, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { startSession, endSession, deleteSession } from '../lib/db/sessions';
import { resetDatabase } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  await db.syncOperations.clear();
});

it('queues a newly started session before it can be replaced by a cloud pull', async () => {
  const { session } = await startSession();
  expect(await db.syncOperations.toArray()).toEqual([
    expect.objectContaining({ table: 'sessions', key: session.id, kind: 'upsert' }),
  ]);
});

it('queues finishing and deleting a session', async () => {
  const { session } = await startSession();
  await db.syncOperations.clear();
  await endSession(session.id);
  await deleteSession(session.id);
  expect(await db.syncOperations.toArray()).toEqual([
    expect.objectContaining({ table: 'sessions', key: session.id, kind: 'upsert' }),
    expect.objectContaining({ table: 'sessions', key: session.id, kind: 'delete' }),
  ]);
});

it('does not enqueue writes from a transaction that later aborts', async () => {
  await expect(db.transaction('rw', db.sessions, db.sets, async () => {
    await startSession();
    throw new Error('abort');
  })).rejects.toThrow('abort');
  expect(await db.sessions.count()).toBe(0);
  expect(await db.syncOperations.count()).toBe(0);
});
