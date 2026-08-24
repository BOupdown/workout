import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db/db';
import { createSet, deleteSet, recentSetsForExercise, updateSet } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import { SetValidationError, setFieldRequirements } from '../lib/db/validation';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;
let pullUp: Exercise;

let sessionId: string;
let blocks: Record<'squat' | 'pushUps' | 'plank' | 'pullUp', string>;

const startedAt = Date.parse('2026-08-16T09:00:00Z');

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank, pullUp } = await referenceExercises());

  const { session } = await startSession({ startedAt, bodyweightKg: 78 });
  sessionId = session.id;

  const [b1, b2, b3, b4] = await Promise.all([
    addExerciseToSession(sessionId, squat.id),
    addExerciseToSession(sessionId, pushUps.id),
    addExerciseToSession(sessionId, plank.id),
    addExerciseToSession(sessionId, pullUp.id),
  ]);
  blocks = { squat: b1.id, pushUps: b2.id, plank: b3.id, pullUp: b4.id };
});

describe('setFieldRequirements', () => {
  it('requires a load for an externally loaded exercise', () => {
    expect(setFieldRequirements(squat).weightKg).toBe('required');
    expect(setFieldRequirements(squat).weightLabel).toBe('Load');
  });

  it('forbids a load for bodyweight', () => {
    expect(setFieldRequirements(pushUps).weightKg).toBe('forbidden');
    expect(setFieldRequirements(pushUps).weightLabel).toBeNull();
  });

  it('switches reps ↔ duration according to the metric', () => {
    expect(setFieldRequirements(plank).durationSec).toBe('required');
    expect(setFieldRequirements(plank).reps).toBe('forbidden');
    expect(setFieldRequirements(squat).reps).toBe('required');
    expect(setFieldRequirements(squat).durationSec).toBe('forbidden');
  });

  it('names the load according to its kind', () => {
    expect(setFieldRequirements(pullUp).weightLabel).toBe('Added');
  });
});

describe('createSet — cas valides', () => {
  it('numbers the sets in the order they are added', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, kind: 'warmup', weightKg: 40, reps: 10 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const c = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
  });

  it('takes a set to be a work set by default', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    expect(set.kind).toBe('work');
  });

  it('derives the denormalised fields from the parents', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect(set.sessionId).toBe(sessionId);
    expect(set.exerciseId).toBe(squat.id);
    expect(set.performedAt).toBe(startedAt);
  });

  it('timestamps the entry independently of the session date', async () => {
    const before = Date.now();
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    expect(set.loggedAt).toBeGreaterThanOrEqual(before);
    expect(set.performedAt).toBe(startedAt);
  });

  it('writes no load for a bodyweight exercise', async () => {
    const set = await createSet({ sessionExerciseId: blocks.pushUps, reps: 25 });

    expect(set.weightKg).toBeUndefined();
    expect('weightKg' in set).toBe(false);
  });

  it('accepts a timed set', async () => {
    const set = await createSet({ sessionExerciseId: blocks.plank, durationSec: 90 });

    expect(set.durationSec).toBe(90);
    expect(set.reps).toBeUndefined();
  });

  it('accepts an added load of zero, then its progression', async () => {
    const sansLest = await createSet({ sessionExerciseId: blocks.pullUp, weightKg: 0, reps: 8 });
    const avecLest = await createSet({ sessionExerciseId: blocks.pullUp, weightKg: 10, reps: 4 });

    expect(sansLest.weightKg).toBe(0);
    expect(avecLest.weightKg).toBe(10);
  });
});

describe('createSet — invariants that depend on the exercise', () => {
  const rejects = async (input: Parameters<typeof createSet>[0], field: string) => {
    await expect(createSet(input)).rejects.toThrow(SetValidationError);
    await createSet(input).catch((err: SetValidationError) => {
      expect(err.issues.map((i) => i.field)).toContain(field);
    });
  };

  it('refuses a load on a bodyweight exercise', async () => {
    await rejects({ sessionExerciseId: blocks.pushUps, weightKg: 20, reps: 10 }, 'weightKg');
  });

  it('refuses reps on a timed exercise', async () => {
    await rejects({ sessionExerciseId: blocks.plank, reps: 10 }, 'reps');
  });

  it('refuses a duration on an exercise counted in reps', async () => {
    await rejects({ sessionExerciseId: blocks.squat, weightKg: 60, durationSec: 30 }, 'durationSec');
  });

  it('refuses a missing load', async () => {
    await rejects({ sessionExerciseId: blocks.squat, reps: 5 }, 'weightKg');
  });

  it('refuses missing reps', async () => {
    await rejects({ sessionExerciseId: blocks.squat, weightKg: 60 }, 'reps');
  });

  it('names the exercise concerned in the message', async () => {
    await createSet({ sessionExerciseId: blocks.pushUps, weightKg: 20, reps: 10 }).catch(
      (err: SetValidationError) => {
        expect(err.message).toContain('Push-ups');
      },
    );
  });
});

describe('createSet — structural invariants', () => {
  it.each([
    ['reps that are not whole', { weightKg: 60, reps: 5.5 }, 'reps'],
    ['a negative load', { weightKg: -20, reps: 5 }, 'weightKg'],
    ['a load that makes no sense', { weightKg: 5000, reps: 5 }, 'weightKg'],
    ['an RPE out of bounds', { weightKg: 60, reps: 5, rpe: 12 }, 'rpe'],
    ['an RPE off the half-points', { weightKg: 60, reps: 5, rpe: 8.3 }, 'rpe'],
  ])('refuses %s', async (_label, payload, field) => {
    await createSet({ sessionExerciseId: blocks.squat, ...payload }).then(
      () => expect.unreachable('the set should have been refused'),
      (err: SetValidationError) => {
        expect(err).toBeInstanceOf(SetValidationError);
        expect(err.issues.map((i) => i.field)).toContain(field);
      },
    );
  });

  it('writes nothing when the validation fails', async () => {
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: -1, reps: 5 }).catch(() => {});

    expect(await db.sets.where('sessionExerciseId').equals(blocks.squat).count()).toBe(1);
  });
});

describe('Dexie hooks — going around the write layer', () => {
  const rawSet = (overrides: Partial<SetEntry>) =>
    ({
      id: 'brut',
      sessionExerciseId: blocks.squat,
      sessionId,
      exerciseId: squat.id,
      performedAt: startedAt,
      loggedAt: Date.now(),
      order: 99,
      kind: 'work',
      weightKg: 60,
      reps: 5,
      ...overrides,
    }) as SetEntry;

  /** A raw set missing a required field, to exercise the structural hook. */
  const rawSetWithout = (field: keyof SetEntry): SetEntry => {
    const entry = rawSet({}) as unknown as Record<string, unknown>;
    delete entry[field];
    return entry as unknown as SetEntry;
  };

  it('refuses a direct add() carrying an unknown kind', async () => {
    await expect(
      db.sets.add(rawSet({ kind: 'bidon' as SetEntry['kind'] })),
    ).rejects.toThrow(SetValidationError);
  });

  it.each(['sessionId', 'exerciseId', 'performedAt', 'loggedAt', 'order'] as const)(
    'refuses a direct add() with no %s',
    async (field) => {
      await expect(db.sets.add(rawSetWithout(field))).rejects.toThrow(SetValidationError);
    },
  );

  it('refuses a direct update() that breaks an invariant', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await expect(db.sets.update(set.id, { reps: -3 })).rejects.toThrow(SetValidationError);
  });
});

describe('updateSet', () => {
  it('corrects a load', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { weightKg: 102.5 });

    expect(updated.weightKg).toBe(102.5);
    expect((await db.sets.get(set.id))!.weightKg).toBe(102.5);
  });

  it('clears an optional field handed undefined', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { rpe: undefined });

    expect(updated.rpe).toBeUndefined();
    expect((await db.sets.get(set.id))!.rpe).toBeUndefined();
  });

  it('leaves untouched the keys the patch does not carry', async () => {
    const set = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5, rpe: 8 });
    const updated = await updateSet(set.id, { reps: 6 });

    expect(updated.rpe).toBe(8);
    expect(updated.weightKg).toBe(100);
  });

  it('refuses a patch that would leave the set inconsistent', async () => {
    const set = await createSet({ sessionExerciseId: blocks.pushUps, reps: 25 });
    await expect(updateSet(set.id, { weightKg: 50 })).rejects.toThrow(SetValidationError);

    const untouched = (await db.sets.get(set.id))!;
    expect(untouched.weightKg).toBeUndefined();
    expect(untouched.reps).toBe(25);
  });
});

describe('deleteSet', () => {
  it('deletes without renumbering the ones that follow', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const c = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });

    await deleteSet(b.id);

    const remaining = await db.sets.where('sessionExerciseId').equals(blocks.squat).sortBy('order');
    expect(remaining.map((s) => s.id)).toEqual([a.id, c.id]);
    expect(remaining.map((s) => s.order)).toEqual([0, 2]);
  });

  it('lets the next set be added after the last one', async () => {
    const a = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    const b = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await deleteSet(b.id);

    const next = await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    expect(next.order).toBeGreaterThan(a.order);
  });
});

describe('recentSetsForExercise', () => {
  beforeEach(async () => {
    // The previous session, a week earlier.
    const older = Date.parse('2026-08-09T09:00:00Z');
    const { session } = await startSession({ startedAt: older });
    const block = await addExerciseToSession(session.id, squat.id);
    await createSet({ sessionExerciseId: block.id, weightKg: 95, reps: 5 });
    await createSet({ sessionExerciseId: block.id, weightKg: 95, reps: 5 });

    // Today's session: a warm-up, then two work sets.
    await createSet({ sessionExerciseId: blocks.squat, kind: 'warmup', weightKg: 40, reps: 10 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blocks.squat, weightKg: 100, reps: 5 });
  });

  it('brings the most recent sets back first', async () => {
    const recent = await recentSetsForExercise(squat.id, 5);
    const timestamps = recent.map((s) => s.performedAt);

    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it('respects the exact order within a session', async () => {
    const recent = await recentSetsForExercise(squat.id, 5);
    expect(recent[0].order).toBe(2);
    expect(recent[1].order).toBe(1);
  });

  it('leaves the warm-ups out by default', async () => {
    const recent = await recentSetsForExercise(squat.id, 10);

    expect(recent.every((s) => s.kind === 'work')).toBe(true);
    expect(recent).toHaveLength(4);
  });

  it('includes the warm-ups on request', async () => {
    const recent = await recentSetsForExercise(squat.id, 10, { includeWarmups: true });

    expect(recent).toHaveLength(5);
    expect(recent.some((s) => s.kind === 'warmup')).toBe(true);
  });

  it('respects the limit it was asked for', async () => {
    expect(await recentSetsForExercise(squat.id, 2)).toHaveLength(2);
  });

  it('does not mix the exercises up', async () => {
    await createSet({ sessionExerciseId: blocks.pushUps, reps: 25 });
    expect(await recentSetsForExercise(pushUps.id, 10)).toHaveLength(1);
  });

  it('stays correct on a volume beyond the limit', async () => {
    // Checks that the query really walks the three-member compound index, and
    // not merely the handful of rows the earlier tests leave behind.
    for (let i = 0; i < 60; i++) {
      await createSet({ sessionExerciseId: blocks.squat, weightKg: 60 + i, reps: 5 });
    }

    const recent = await recentSetsForExercise(squat.id, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0].weightKg).toBe(119);
  });
});
