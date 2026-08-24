import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import type { Exercise } from '../lib/db/types';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

describe('the starting catalogue', () => {
  it('is inserted when the database is created', async () => {
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });

  it('covers all four loadTypes and both metrics', async () => {
    const catalogue = await db.exercises.toArray();
    const loadTypes = new Set(catalogue.map((e) => e.loadType));
    const metrics = new Set(catalogue.map((e) => e.metric));

    expect(loadTypes).toEqual(
      new Set(['external', 'bodyweight', 'weighted_bodyweight', 'assisted']),
    );
    expect(metrics).toEqual(new Set(['reps', 'time']));
  });

  it('is made of shipped exercises only, with v4 UUIDs', async () => {
    const catalogue = await db.exercises.toArray();
    expect(catalogue.every((e) => e.isCustom === false)).toBe(true);
    expect(catalogue[0].id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('has nameKeys that are all distinct', async () => {
    const nameKeys = (await db.exercises.toArray()).map((e) => e.nameKey);
    expect(new Set(nameKeys).size).toBe(nameKeys.length);
  });

  it('starts afresh between two tests', async () => {
    await db.exercises.clear();
    expect(await db.exercises.count()).toBe(0);
    await resetDatabase();
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });
});

describe('uniqueness of nameKey', () => {
  it('rejects a second exercise under the same normalised name', async () => {
    const squat = await db.exercises.where('nameKey').equals('squat').first();
    expect(squat).toBeDefined();

    const duplicate: Exercise = {
      id: 'doublon',
      name: 'SQUAT !',
      nameKey: 'squat',
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      isCustom: true,
      createdAt: Date.now(),
    };

    await expect(db.exercises.add(duplicate)).rejects.toThrow();
    expect(await db.exercises.where('nameKey').equals('squat').count()).toBe(1);
  });
});

describe('bounds of the compound indexes (regression guard)', () => {
  /**
   * `Dexie.maxKey` is `[[]]` — a **single array instance**, shared.
   *
   * The IndexedDB spec's "convert a value to a key" algorithm keeps a `seen`
   * set shared between the sibling members of a compound key and rejects any
   * value it has met before. That cycle detection does not tell a real cycle
   * from a repeated instance: using `maxKey` twice in one key throws a
   * `DataError`.
   *
   * Two members pass, three break — hence a bug that only ever showed on
   * `[exerciseId+performedAt+order]`, the index the whole progression rests on.
   * The write layer therefore uses explicit numeric bounds (`±Infinity`), which
   * are exact since `performedAt` and `order` are always numbers.
   *
   * This test pins the platform's behaviour: the day it starts passing, the
   * constraint is gone and the workaround can be looked at again.
   */
  it('rejects a compound key using the Dexie.maxKey instance twice', () => {
    expect(() =>
      IDBKeyRange.bound(
        ['x', Dexie.minKey, Dexie.minKey],
        ['x', Dexie.maxKey, Dexie.maxKey],
      ),
    ).toThrow();
  });

  it('accepts the explicit numeric bounds the code uses', () => {
    expect(() =>
      IDBKeyRange.bound(['x', -Infinity, -Infinity], ['x', Infinity, Infinity]),
    ).not.toThrow();
  });
});
