import { beforeEach, describe, expect, it } from 'vitest';
import { createSet, recentSetsForExercise } from '../lib/db/sets';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import {
  boxesOverlap,
  buildChartGeometry,
  buildProgression,
  isBetterPerformance,
  monoTextBox,
  progressionDelta,
  progressionMetric,
  recordSet,
  type SessionPoint,
} from '../lib/progression';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;
let pullUp: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank, pullUp } = await referenceExercises());
});

/** A minimal set: only the fields progression reads are filled in. */
const set = (over: Partial<SetEntry>): SetEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    sessionExerciseId: 'b',
    sessionId: 's1',
    exerciseId: 'e',
    performedAt: 1000,
    loggedAt: 1000,
    order: 0,
    kind: 'work',
    ...over,
  }) as SetEntry;

describe('progressionMetric', () => {
  it('follows the load for an externally loaded exercise', () => {
    expect(progressionMetric(squat)).toBe('weightKg');
  });

  it('follows the added load for a weighted bodyweight exercise', () => {
    expect(progressionMetric(pullUp)).toBe('weightKg');
  });

  it('follows the reps for bodyweight', () => {
    expect(progressionMetric(pushUps)).toBe('reps');
  });

  it('follows the duration for a timed exercise', () => {
    expect(progressionMetric(plank)).toBe('durationSec');
  });
});

describe('buildProgression', () => {
  it('reduces every session to its best set', () => {
    const points = buildProgression(
      [
        set({ sessionId: 's1', performedAt: 100, weightKg: 90, reps: 5 }),
        set({ sessionId: 's1', performedAt: 100, weightKg: 100, reps: 5 }),
        set({ sessionId: 's1', performedAt: 100, weightKg: 95, reps: 5 }),
      ],
      squat,
    );

    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(100);
    expect(points[0].setCount).toBe(3);
  });

  it('separates two sets of equal load on the reps', () => {
    const points = buildProgression(
      [
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
        set({ performedAt: 100, weightKg: 100, reps: 7 }),
      ],
      squat,
    );

    expect(points[0].reps).toBe(7);
  });

  it('leaves the warm-ups out', () => {
    // Including them would sink the curve every time a ramp-up is logged.
    const points = buildProgression(
      [
        set({ performedAt: 100, kind: 'warmup', weightKg: 40, reps: 10 }),
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
      ],
      squat,
    );

    expect(points[0].value).toBe(100);
    expect(points[0].setCount).toBe(1);
  });

  it('sorts the sessions from the oldest to the most recent', () => {
    const points = buildProgression(
      [
        set({ sessionId: 'c', performedAt: 300, weightKg: 105, reps: 5 }),
        set({ sessionId: 'a', performedAt: 100, weightKg: 95, reps: 5 }),
        set({ sessionId: 'b', performedAt: 200, weightKg: 100, reps: 5 }),
      ],
      squat,
    );

    expect(points.map((p) => p.performedAt)).toEqual([100, 200, 300]);
    expect(points.map((p) => p.value)).toEqual([95, 100, 105]);
  });

  it('follows the reps for bodyweight, with no load annotation', () => {
    const points = buildProgression(
      [set({ performedAt: 100, reps: 25 }), set({ performedAt: 100, reps: 30 })],
      pushUps,
    );

    expect(points[0].value).toBe(30);
    expect(points[0].reps).toBeUndefined();
  });

  it('follows the duration for a timed exercise', () => {
    const points = buildProgression([set({ performedAt: 100, durationSec: 90 })], plank);
    expect(points[0].value).toBe(90);
  });

  it('ignores a set missing the quantity being followed', () => {
    expect(buildProgression([set({ performedAt: 100, reps: 5 })], squat)).toEqual([]);
  });

  it('returns an empty list when there is no set', () => {
    expect(buildProgression([], squat)).toEqual([]);
  });
});

describe('buildProgression — the estimated view', () => {
  it('picks the best estimate, which is not the heaviest set', () => {
    // The reason the view exists: five at 100 estimates 112.5 and beats a
    // single at 105, which the measured curve ranks the other way round.
    const sets = [
      set({ performedAt: 100, weightKg: 105, reps: 1 }),
      set({ performedAt: 100, weightKg: 100, reps: 5 }),
    ];

    expect(buildProgression(sets, squat)[0].value).toBe(105);
    expect(buildProgression(sets, squat, 'oneRepMax')[0].value).toBe(112.5);
  });

  it('falls where the measured curve rises', () => {
    // Ten at 60 then five at 65: the bar got heavier and the showing got
    // weaker. This is the exact reading the load axis cannot give.
    const sets = [
      set({ sessionId: 'a', performedAt: 100, weightKg: 60, reps: 10 }),
      set({ sessionId: 'b', performedAt: 200, weightKg: 65, reps: 5 }),
    ];

    expect(buildProgression(sets, squat).map((p) => p.value)).toEqual([60, 65]);
    expect(buildProgression(sets, squat, 'oneRepMax').map((p) => p.value)).toEqual([80, 73.1]);
  });

  it('names the set behind the estimate', () => {
    const [point] = buildProgression(
      [set({ performedAt: 100, weightKg: 100, reps: 5 })],
      squat,
      'oneRepMax',
    );

    expect(point.value).toBe(112.5);
    expect(point.reps).toBe(5);
    expect(point.fromWeightKg).toBe(100);
  });

  it('skips a set out of range instead of counting it as nothing', () => {
    const [point] = buildProgression(
      [
        set({ performedAt: 100, weightKg: 40, reps: 20 }),
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
      ],
      squat,
      'oneRepMax',
    );

    expect(point.value).toBe(112.5);
    expect(point.setCount).toBe(1);
  });

  it('leaves a session out entirely when nothing in it can be read', () => {
    // A gap in the curve, not a dip that never happened.
    const points = buildProgression(
      [
        set({ sessionId: 'a', performedAt: 100, weightKg: 100, reps: 5 }),
        set({ sessionId: 'b', performedAt: 200, weightKg: 40, reps: 20 }),
      ],
      squat,
      'oneRepMax',
    );

    expect(points).toHaveLength(1);
    expect(points[0].sessionId).toBe('a');
  });

  it('leaves the warm-ups out, as the measured curve does', () => {
    const points = buildProgression(
      [
        set({ performedAt: 100, kind: 'warmup', weightKg: 40, reps: 10 }),
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
      ],
      squat,
      'oneRepMax',
    );

    expect(points[0].value).toBe(112.5);
    expect(points[0].setCount).toBe(1);
  });

  it('has nothing to plot for an exercise it cannot read', () => {
    // Push-ups carry no load; a pull-up carries only the belt.
    expect(buildProgression([set({ performedAt: 100, reps: 20 })], pushUps, 'oneRepMax')).toEqual(
      [],
    );
    expect(
      buildProgression([set({ performedAt: 100, weightKg: 10, reps: 5 })], pullUp, 'oneRepMax'),
    ).toEqual([]);
  });

  it('keeps the earlier set on a tie, as everywhere else', () => {
    // 5 × 100 and 10 × 75 both estimate 112.5. Neither is the better set, so
    // the one that got there first keeps the point.
    const [point] = buildProgression(
      [
        set({ performedAt: 100, order: 0, weightKg: 100, reps: 5 }),
        set({ performedAt: 100, order: 1, weightKg: 84.375, reps: 10 }),
      ],
      squat,
      'oneRepMax',
    );

    expect(point.value).toBe(112.5);
    expect(point.reps).toBe(5);
  });
});

describe('buildProgression — on real sets', () => {
  it('rebuilds the progression across two sessions', async () => {
    const older = Date.parse('2026-08-09T09:00:00Z');
    const first = await startSession({ startedAt: older });
    const blockA = await addExerciseToSession(first.session.id, squat.id);
    await createSet({ sessionExerciseId: blockA.id, kind: 'warmup', weightKg: 40, reps: 10 });
    await createSet({ sessionExerciseId: blockA.id, weightKg: 95, reps: 5 });
    await endSession(first.session.id, older + 3_600_000);

    const recent = Date.parse('2026-08-16T09:00:00Z');
    const second = await startSession({ startedAt: recent });
    const blockB = await addExerciseToSession(second.session.id, squat.id);
    await createSet({ sessionExerciseId: blockB.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blockB.id, weightKg: 102.5, reps: 4 });

    const sets = await recentSetsForExercise(squat.id, 100, { includeWarmups: true });
    const points = buildProgression(sets, squat);

    expect(points.map((p) => p.value)).toEqual([95, 102.5]);
    expect(points[1].setCount).toBe(2);
    expect(progressionDelta(points)).toBe(7.5);
  });
});

describe('progressionDelta', () => {
  const point = (value: number): SessionPoint => ({
    sessionId: String(value),
    performedAt: value,
    value,
    setCount: 1,
  });

  it('compares the last two sessions', () => {
    expect(progressionDelta([point(95), point(100)])).toBe(5);
    expect(progressionDelta([point(100), point(95)])).toBe(-5);
  });

  it('compares nothing when there is one session', () => {
    expect(progressionDelta([point(100)])).toBeNull();
    expect(progressionDelta([])).toBeNull();
  });
});

describe('buildChartGeometry', () => {
  const box = { width: 320, height: 160, padding: { top: 16, right: 16, bottom: 24, left: 16 } };
  const points = (...values: number[]): SessionPoint[] =>
    values.map((value, index) => ({
      sessionId: String(index),
      performedAt: index * 1000,
      value,
      setCount: 1,
    }));

  it('puts the first point on the left and the last on the right', () => {
    const { plotted } = buildChartGeometry(points(90, 100, 110), box);

    expect(plotted[0].x).toBe(16);
    expect(plotted[2].x).toBe(304);
  });

  it('places the high values at the top', () => {
    const { plotted } = buildChartGeometry(points(90, 110), box);
    expect(plotted[1].y).toBeLessThan(plotted[0].y);
  });

  it('keeps the path inside the box', () => {
    const { plotted } = buildChartGeometry(points(90, 100, 110, 105), box);

    for (const p of plotted) {
      expect(p.y).toBeGreaterThanOrEqual(box.padding.top);
      expect(p.y).toBeLessThanOrEqual(box.height - box.padding.bottom);
    }
  });

  it('centres a lone point rather than pinning it to the edge', () => {
    const { plotted } = buildChartGeometry(points(100), box);
    expect(plotted[0].x).toBe(160);
  });

  it('does not divide by zero when every value is the same', () => {
    // Three sessions at the same weight: a range of zero, the classic trap.
    const { plotted } = buildChartGeometry(points(100, 100, 100), box);

    expect(plotted.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(new Set(plotted.map((p) => p.y)).size).toBe(1);
  });

  it('closes the area back onto the base of the path', () => {
    const { area } = buildChartGeometry(points(90, 100), box);

    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain(String(box.height - box.padding.bottom));
  });

  it('names the highest point', () => {
    expect(buildChartGeometry(points(90, 120, 100), box).peakIndex).toBe(1);
  });

  it('produces round ticks, and few of them', () => {
    const { ticks } = buildChartGeometry(points(92.5, 117.5), box);

    expect(ticks.length).toBeLessThanOrEqual(4);
    expect(ticks.every((t) => Number.isFinite(t.y))).toBe(true);
    expect(ticks.every((t) => t.value % 5 === 0)).toBe(true);
  });
});

describe('isBetterPerformance', () => {
  it('separates them on the value', () => {
    expect(isBetterPerformance({ value: 102.5 }, { value: 100 }, 'weightKg')).toBe(true);
    expect(isBetterPerformance({ value: 97.5 }, { value: 100 }, 'weightKg')).toBe(false);
  });

  it('separates equal loads on the reps', () => {
    expect(
      isBetterPerformance({ value: 100, reps: 6 }, { value: 100, reps: 5 }, 'weightKg'),
    ).toBe(true);
  });

  it('does not separate on the reps when the load is not what is followed', () => {
    // Under the reps metric, the value *is* the reps: a second field would
    // mean nothing.
    expect(isBetterPerformance({ value: 10, reps: 99 }, { value: 10, reps: 1 }, 'reps')).toBe(
      false,
    );
  });

  it('is strict: an equal performance dethrones nobody', () => {
    expect(isBetterPerformance({ value: 100, reps: 5 }, { value: 100, reps: 5 }, 'weightKg')).toBe(
      false,
    );
  });
});

describe('recordSet', () => {
  it('returns null when there is no set at all', () => {
    expect(recordSet([], squat)).toBeNull();
  });

  it('keeps the heaviest load', () => {
    const best = set({ weightKg: 110, reps: 3, performedAt: 2000 });
    const found = recordSet([set({ weightKg: 100, reps: 5 }), best], squat);
    expect(found?.id).toBe(best.id);
  });

  it('separates equal loads on the reps', () => {
    const best = set({ weightKg: 100, reps: 8, performedAt: 2000 });
    const found = recordSet([set({ weightKg: 100, reps: 5 }), best], squat);
    expect(found?.id).toBe(best.id);
  });

  it('leaves the record with the first to reach it', () => {
    // Matching a performance exactly beats nobody.
    const first = set({ weightKg: 100, reps: 5, performedAt: 1000 });
    const later = set({ weightKg: 100, reps: 5, performedAt: 5000 });
    expect(recordSet([later, first], squat)?.id).toBe(first.id);
  });

  it('ignores the order the list arrives in', () => {
    // `recentSetsForExercise` rend l ordre antichronologique : sans tri interne,
    // a tie would hand the record to the most recent.
    const first = set({ weightKg: 100, reps: 5, performedAt: 1000, order: 0 });
    const second = set({ weightKg: 100, reps: 5, performedAt: 1000, order: 1 });
    expect(recordSet([second, first], squat)?.id).toBe(first.id);
    expect(recordSet([first, second], squat)?.id).toBe(first.id);
  });

  it('exclut les echauffements', () => {
    // A heavy warm-up is not a performance.
    const work = set({ weightKg: 100, reps: 5 });
    const warmup = set({ weightKg: 200, reps: 1, kind: 'warmup', performedAt: 2000 });
    expect(recordSet([work, warmup], squat)?.id).toBe(work.id);
  });

  it('follows the reps for a bodyweight exercise', () => {
    const best = set({ reps: 20, performedAt: 2000 });
    expect(recordSet([set({ reps: 12 }), best], pushUps)?.id).toBe(best.id);
  });

  it('follows the duration for a stopwatch exercise', () => {
    const best = set({ durationSec: 120, performedAt: 2000 });
    expect(recordSet([set({ durationSec: 60 }), best], plank)?.id).toBe(best.id);
  });

  it('ignores a set without the measure being followed', () => {
    const usable = set({ weightKg: 80, reps: 5 });
    expect(recordSet([set({ reps: 5 }), usable], squat)?.id).toBe(usable.id);
  });

  it('names the same set as the peak of the curve', () => {
    // The invariant behind sharing the rule: the record cannot sit below the
    // highest point of its own curve.
    const sets = [
      set({ weightKg: 100, reps: 5, sessionId: 's1', performedAt: 1000 }),
      set({ weightKg: 110, reps: 3, sessionId: 's2', performedAt: 2000 }),
      set({ weightKg: 105, reps: 6, sessionId: 's3', performedAt: 3000 }),
    ];

    const top = buildProgression(sets, squat).reduce((a, b) => (b.value > a.value ? b : a));
    expect(recordSet(sets, squat)?.weightKg).toBe(top.value);
  });
});

describe('monoTextBox', () => {
  it('measures a left-anchored label from where it starts', () => {
    // Four characters at 10 px, 0.6 em of advance each.
    expect(monoTextBox('92.5', 14, 30, 10)).toEqual({ x: 14, y: 20, width: 24, height: 10 });
  });

  it('spreads a centred label either side of its point', () => {
    expect(monoTextBox('80', 100, 30, 10, 'middle').x).toBe(94);
  });

  it('hangs a right-anchored label back from its point', () => {
    expect(monoTextBox('80', 100, 30, 10, 'end').x).toBe(88);
  });

  it('takes the baseline as the bottom, not the middle', () => {
    // Nothing drawn on these charts has a descender, so a full line box would
    // report a collision for labels that clear each other comfortably.
    const box = monoTextBox('80', 0, 30, 10);
    expect(box.y + box.height).toBe(30);
  });
});

describe('boxesOverlap', () => {
  const box = (x: number, y: number, width = 20, height = 10) => ({ x, y, width, height });

  it('sees two labels printed on the same spot', () => {
    expect(boxesOverlap(box(14, 8), box(14, 8))).toBe(true);
  });

  it('leaves labels on the same line but far apart alone', () => {
    expect(boxesOverlap(box(14, 8), box(200, 8))).toBe(false);
  });

  it('leaves labels in the same column but far apart alone', () => {
    expect(boxesOverlap(box(14, 8), box(14, 100))).toBe(false);
  });

  it('does not call touching edges an overlap', () => {
    // Flush against each other is legible; only genuine coverage is not.
    expect(boxesOverlap(box(14, 8), box(34, 8))).toBe(false);
    expect(boxesOverlap(box(14, 8), box(14, 18))).toBe(false);
  });

  it('catches a partial cover', () => {
    expect(boxesOverlap(box(14, 8), box(30, 12))).toBe(true);
  });
});
