import { describe, expect, it } from 'vitest';
import type { Exercise, MuscleGroup } from '../lib/db/types';
import { MUSCLE_GROUP_LABELS } from '../lib/exercise-draft';
import { groupByMuscle, MUSCLE_GROUP_ORDER, UNGROUPED_LABEL } from '../lib/exercise-groups';

/** Only what grouping reads. */
const exercise = (name: string, muscleGroup?: MuscleGroup): Exercise =>
  ({
    id: name,
    name,
    nameKey: name.toLowerCase(),
    loadType: 'external',
    metric: 'reps',
    perSide: false,
    isCustom: false,
    createdAt: 0,
    ...(muscleGroup ? { muscleGroup } : {}),
  }) as Exercise;

describe('MUSCLE_GROUP_ORDER', () => {
  it('places every group, exactly once', () => {
    // The `Record` of labels guarantees a group is *named*, not that it is
    // *placed*: without this test, adding a group would compile and drop it
    // from the picker, with no error anywhere.
    const named = Object.keys(MUSCLE_GROUP_LABELS).sort();
    expect([...MUSCLE_GROUP_ORDER].sort()).toEqual(named);
    expect(new Set(MUSCLE_GROUP_ORDER).size).toBe(MUSCLE_GROUP_ORDER.length);
  });
});

describe('groupByMuscle', () => {
  it('follows the anatomical order, not the one the data comes in', () => {
    const sections = groupByMuscle([
      exercise('Calf raise', 'calves'),
      exercise('Bench press', 'chest'),
      exercise('Curl', 'biceps'),
    ]);

    expect(sections.map((section) => section.group)).toEqual(['chest', 'biceps', 'calves']);
  });

  it('gathers them under a single heading', () => {
    const sections = groupByMuscle([
      exercise('Bench press', 'chest'),
      exercise('Squat', 'quads'),
      exercise('Cable fly', 'chest'),
    ]);

    expect(sections).toHaveLength(2);
    expect(sections[0].exercises.map((item) => item.name)).toEqual(['Bench press', 'Cable fly']);
  });

  it('invents no empty section', () => {
    // Otherwise removing a group's last exercise would leave a heading alone.
    const sections = groupByMuscle([exercise('Bench press', 'chest')]);

    expect(sections).toHaveLength(1);
    expect(sections[0].label).toBe('Chest');
  });

  it('keeps the incoming order within a section', () => {
    // Callers already read the catalogue sorted by name: re-sorting here would
    // overwrite that choice silently.
    const sections = groupByMuscle([
      exercise('Zottman curl', 'biceps'),
      exercise('Barbell curl', 'biceps'),
    ]);

    expect(sections[0].exercises.map((item) => item.name)).toEqual([
      'Zottman curl',
      'Barbell curl',
    ]);
  });

  it('puts the exercises with no group last, without losing them', () => {
    // `muscleGroup` is optional: dropping them would hide a custom exercise
    // from the very screen that exists to find it again.
    const sections = groupByMuscle([
      exercise('Sandbag carry'),
      exercise('Bench press', 'chest'),
    ]);

    expect(sections.at(-1)?.group).toBeNull();
    expect(sections.at(-1)?.label).toBe(UNGROUPED_LABEL);
    expect(sections.at(-1)?.exercises.map((item) => item.name)).toEqual(['Sandbag carry']);
  });

  it('renders no section for an empty catalogue', () => {
    expect(groupByMuscle([])).toEqual([]);
  });

  it('ne perd ni ne duplique aucun exercice', () => {
    // The property that matters: whatever happens to the grouping, everything
    // that goes in comes out exactly once.
    const input = [
      exercise('Bench press', 'chest'),
      exercise('Squat', 'quads'),
      exercise('Sandbag carry'),
      exercise('Cable fly', 'chest'),
      exercise('Running', 'cardio'),
    ];

    const out = groupByMuscle(input).flatMap((section) => section.exercises);

    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((item) => item.id)).size).toBe(input.length);
  });
});
