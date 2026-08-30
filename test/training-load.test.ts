import { describe, expect, it } from 'vitest';
import type { Exercise, Id, SetEntry } from '../lib/db/types';
import {
  compareTrainingLoad,
  summariseTrainingLoad,
  type TrainingLoad,
} from '../lib/training-load';

let counter = 0;

/** An exercise reduced to what the aggregation reads. */
const exercise = (over: Partial<Exercise>): Exercise =>
  ({
    id: `e${(counter += 1)}`,
    name: 'X',
    nameKey: 'x',
    loadType: 'external',
    metric: 'reps',
    perSide: false,
    isCustom: false,
    createdAt: 0,
    ...over,
  }) as Exercise;

const set = (exerciseId: Id, over: Partial<SetEntry> = {}): SetEntry =>
  ({
    id: `s${(counter += 1)}`,
    sessionExerciseId: 'b',
    sessionId: 's1',
    exerciseId,
    performedAt: 1000,
    loggedAt: 1000,
    order: 0,
    kind: 'work',
    ...over,
  }) as SetEntry;

const catalogue = (...exercises: Exercise[]) => new Map(exercises.map((e) => [e.id, e]));

/** Sets for a group, as one line. */
const setsFor = (load: TrainingLoad, group: string | null) =>
  load.byGroup.find((row) => row.group === group)?.workSets ?? 0;

describe('summariseTrainingLoad', () => {
  it('counts work sets under their muscle', () => {
    const row = exercise({ muscleGroup: 'back' });
    const bench = exercise({ muscleGroup: 'chest' });

    const load = summariseTrainingLoad(
      [
        set(row.id, { weightKg: 80, reps: 8 }),
        set(row.id, { weightKg: 80, reps: 8 }),
        set(bench.id, { weightKg: 60, reps: 10 }),
      ],
      catalogue(row, bench),
    );

    expect(load.workSets).toBe(3);
    expect(setsFor(load, 'back')).toBe(2);
    expect(setsFor(load, 'chest')).toBe(1);
  });

  it('leaves the warm-ups out', () => {
    // A ramp-up is not a set of back, it is the price of the first one.
    const row = exercise({ muscleGroup: 'back' });

    const load = summariseTrainingLoad(
      [
        set(row.id, { kind: 'warmup', weightKg: 40, reps: 10 }),
        set(row.id, { weightKg: 80, reps: 8 }),
      ],
      catalogue(row),
    );

    expect(load.workSets).toBe(1);
    expect(load.volumeKg).toBe(640);
  });

  it('totals load × reps', () => {
    const squat = exercise({ muscleGroup: 'quads' });

    const load = summariseTrainingLoad(
      [set(squat.id, { weightKg: 100, reps: 5 }), set(squat.id, { weightKg: 87.5, reps: 3 })],
      catalogue(squat),
    );

    // 500 + 262.5, and not 762.5000000000001.
    expect(load.volumeKg).toBe(762.5);
  });

  describe('the load types that carry no tonnage', () => {
    it('counts a bodyweight set without adding to the volume', () => {
      const pushUps = exercise({ loadType: 'bodyweight', muscleGroup: 'chest' });

      const load = summariseTrainingLoad([set(pushUps.id, { reps: 20 })], catalogue(pushUps));

      expect(load.workSets).toBe(1);
      expect(load.volumeKg).toBe(0);
    });

    it('ignores the belt on a weighted pull-up', () => {
      // The body it was hanging from is not in the row, so 10 kg × 8 would
      // under-count the set by an entire person.
      const pullUp = exercise({ loadType: 'weighted_bodyweight', muscleGroup: 'back' });

      const load = summariseTrainingLoad(
        [set(pullUp.id, { weightKg: 10, reps: 8 })],
        catalogue(pullUp),
      );

      expect(setsFor(load, 'back')).toBe(1);
      expect(load.volumeKg).toBe(0);
    });

    it('never credits the machine on an assisted set', () => {
      // That load is weight *removed*: adding it would make more help read as
      // more work.
      const assisted = exercise({ loadType: 'assisted', muscleGroup: 'back' });

      const load = summariseTrainingLoad(
        [set(assisted.id, { weightKg: 30, reps: 10 })],
        catalogue(assisted),
      );

      expect(load.volumeKg).toBe(0);
    });

    it('ignores a held position, which has no reps to multiply', () => {
      const plank = exercise({ loadType: 'bodyweight', metric: 'time', muscleGroup: 'core' });

      const load = summariseTrainingLoad(
        [set(plank.id, { durationSec: 90 })],
        catalogue(plank),
      );

      expect(setsFor(load, 'core')).toBe(1);
      expect(load.volumeKg).toBe(0);
    });
  });

  describe('sets with no muscle to file under', () => {
    it('files an exercise with no group under Other', () => {
      const custom = exercise({});

      const load = summariseTrainingLoad([set(custom.id, { weightKg: 20, reps: 10 })], catalogue(custom));

      expect(setsFor(load, null)).toBe(1);
    });

    it('still counts a set whose exercise cannot be resolved', () => {
      // Dropping it would leave the muscle rows disagreeing with the total
      // printed above them.
      const load = summariseTrainingLoad([set('gone', { weightKg: 20, reps: 10 })], new Map());

      expect(load.workSets).toBe(1);
      expect(setsFor(load, null)).toBe(1);
      // No exercise means no load type, so no claim about tonnage either.
      expect(load.volumeKg).toBe(0);
    });

    it('keeps the groups adding up to the total', () => {
      const back = exercise({ muscleGroup: 'back' });
      const custom = exercise({});

      const load = summariseTrainingLoad(
        [set(back.id, { weightKg: 80, reps: 8 }), set(custom.id, { weightKg: 20, reps: 10 }), set('gone')],
        catalogue(back, custom),
      );

      const summed = load.byGroup.reduce((total, row) => total + row.workSets, 0);
      expect(summed).toBe(load.workSets);
    });
  });

  it('orders the muscles anatomically, not by how busy they were', () => {
    // A ranking would reshuffle the rows every week, and reading this week
    // against last week is the whole point.
    const calves = exercise({ muscleGroup: 'calves' });
    const chest = exercise({ muscleGroup: 'chest' });

    const load = summariseTrainingLoad(
      [
        set(calves.id, { weightKg: 40, reps: 15 }),
        set(calves.id, { weightKg: 40, reps: 15 }),
        set(calves.id, { weightKg: 40, reps: 15 }),
        set(chest.id, { weightKg: 60, reps: 10 }),
      ],
      catalogue(calves, chest),
    );

    expect(load.byGroup.map((row) => row.group)).toEqual(['chest', 'calves']);
  });

  it('keeps the muscle-less bucket last', () => {
    const custom = exercise({});
    const calves = exercise({ muscleGroup: 'calves' });

    const load = summariseTrainingLoad(
      [set(custom.id, { weightKg: 20, reps: 10 }), set(calves.id, { weightKg: 40, reps: 15 })],
      catalogue(custom, calves),
    );

    expect(load.byGroup.map((row) => row.group)).toEqual(['calves', null]);
  });
});

describe('compareTrainingLoad', () => {
  const week = (...groups: [string, number][]): TrainingLoad => ({
    workSets: groups.reduce((total, [, sets]) => total + sets, 0),
    volumeKg: 0,
    byGroup: groups.map(([group, workSets]) => ({
      group: group as never,
      workSets,
      volumeKg: 0,
    })),
  });

  it('carries last week alongside this one', () => {
    const rows = compareTrainingLoad(week(['back', 14]), week(['back', 8]));

    expect(rows).toEqual([{ group: 'back', workSets: 14, volumeKg: 0, previousWorkSets: 8 }]);
  });

  it('keeps a muscle that dropped to nothing', () => {
    // The row the screen exists for: legs trained last week and not this one is
    // exactly what a list built from this week alone cannot show.
    const rows = compareTrainingLoad(week(['back', 14]), week(['back', 8], ['quads', 12]));

    expect(rows.map((row) => [row.group, row.workSets, row.previousWorkSets])).toEqual([
      ['back', 14, 8],
      ['quads', 0, 12],
    ]);
  });

  it('places a dropped muscle anatomically, not at the end', () => {
    const rows = compareTrainingLoad(week(['calves', 4]), week(['chest', 10]));

    expect(rows.map((row) => row.group)).toEqual(['chest', 'calves']);
  });

  it('reports a muscle trained for the first time', () => {
    const rows = compareTrainingLoad(week(['glutes', 6]), week());

    expect(rows).toEqual([{ group: 'glutes', workSets: 6, volumeKg: 0, previousWorkSets: 0 }]);
  });

  it('has nothing to say about two empty weeks', () => {
    expect(compareTrainingLoad(week(), week())).toEqual([]);
  });
});
