import { beforeEach, describe, expect, it } from 'vitest';
import { createExercise, ExerciseNameConflictError } from '../lib/db/exercises';
import { setFieldRequirements } from '../lib/db/validation';
import {
  draftAllowsIncrement,
  EMPTY_EXERCISE_DRAFT,
  exerciseDraftToInput,
  exerciseDraftToUpdate,
  exerciseToDraft,
  LOAD_TYPE_OPTIONS,
  METRIC_OPTIONS,
  MUSCLE_GROUP_LABELS,
  type ExerciseDraft,
} from '../lib/exercise-draft';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

const draft = (over: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...EMPTY_EXERCISE_DRAFT,
  name: 'Sandbag carry',
  ...over,
});

describe('the form options', () => {
  it('covers all four kinds of load', () => {
    expect(LOAD_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual(
      ['assisted', 'bodyweight', 'external', 'weighted_bodyweight'].sort(),
    );
  });

  it('covers both ways of measuring effort', () => {
    expect(METRIC_OPTIONS.map((o) => o.value)).toEqual(['reps', 'time']);
  });

  it('gives every muscle group a label', () => {
    expect(Object.keys(MUSCLE_GROUP_LABELS)).toHaveLength(13);
    expect(Object.values(MUSCLE_GROUP_LABELS).every((label) => label.length > 0)).toBe(true);
  });

  it('exposes no technical wording from the model', () => {
    const labels = LOAD_TYPE_OPTIONS.map((o) => o.label).join(' ');
    expect(labels).not.toContain('bodyweight');
    expect(labels).not.toContain('_');
  });
});

describe('draftAllowsIncrement', () => {
  it('refuses an increment for bodyweight', () => {
    expect(draftAllowsIncrement({ loadType: 'bodyweight' })).toBe(false);
  });

  it('allows one wherever there is a load', () => {
    for (const loadType of ['external', 'weighted_bodyweight', 'assisted'] as const) {
      expect(draftAllowsIncrement({ loadType })).toBe(true);
    }
  });

  it('agrees with the validation', () => {
    // The form and the database have to say the same thing, with no rule
    // written twice.
    for (const { value } of LOAD_TYPE_OPTIONS) {
      const requirements = setFieldRequirements({ loadType: value, metric: 'reps' });
      expect(draftAllowsIncrement({ loadType: value })).toBe(requirements.weightKg === 'required');
    }
  });
});

describe('exerciseDraftToInput', () => {
  it('nettoie le nom saisi', () => {
    expect(exerciseDraftToInput(draft({ name: '  Sandbag carry  ' })).name).toBe('Sandbag carry');
  });

  it('leaves out a muscle group that was not filled in', () => {
    expect('muscleGroup' in exerciseDraftToInput(draft())).toBe(false);
  });

  it('transmet le groupe musculaire choisi', () => {
    expect(exerciseDraftToInput(draft({ muscleGroup: 'shoulders' })).muscleGroup).toBe('shoulders');
  });

  it('reads an increment written with a decimal comma', () => {
    expect(exerciseDraftToInput(draft({ defaultIncrementKg: '2,5' })).defaultIncrementKg).toBe(2.5);
  });

  it('never emits an increment for bodyweight', () => {
    // Even when the field still carries a value from an earlier choice.
    const input = exerciseDraftToInput(
      draft({ loadType: 'bodyweight', defaultIncrementKg: '2,5' }),
    );
    expect('defaultIncrementKg' in input).toBe(false);
  });

  it('leaves out an unreadable increment rather than guessing it', () => {
    expect('defaultIncrementKg' in exerciseDraftToInput(draft({ defaultIncrementKg: 'abc' }))).toBe(
      false,
    );
  });
});

describe('exerciseDraftToInput — agreement with the database', () => {
  it.each(LOAD_TYPE_OPTIONS.map((o) => o.value))(
    'a filled-in draft is accepted — %s',
    async (loadType) => {
      const exercise = await createExercise(
        exerciseDraftToInput(
          draft({ name: `Test ${loadType}`, loadType, defaultIncrementKg: '2,5' }),
        ),
      );

      expect(exercise.id).toBeTruthy();
      expect(exercise.isCustom).toBe(true);
      expect(exercise.loadType).toBe(loadType);
    },
  );

  it('accepts an exercise counted in time', async () => {
    const exercise = await createExercise(
      exerciseDraftToInput(draft({ name: 'Chaise au mur', loadType: 'bodyweight', metric: 'time' })),
    );
    expect(exercise.metric).toBe('time');
  });

  it('reports the name clash, naming the existing exercise', async () => {
    await createExercise(exerciseDraftToInput(draft()));

    await createExercise(exerciseDraftToInput(draft({ name: 'SANDBAG-CARRY' }))).then(
      () => expect.unreachable('the creation should have been refused'),
      (error: ExerciseNameConflictError) => {
        expect(error).toBeInstanceOf(ExerciseNameConflictError);
        expect(error.existing.name).toBe('Sandbag carry');
      },
    );
  });

  it('refuses an empty name through the database validation', async () => {
    await expect(createExercise(exerciseDraftToInput(draft({ name: '   ' })))).rejects.toThrow();
  });
});

describe('exerciseToDraft', () => {
  it('reloads an existing exercise without losing anything', async () => {
    const exercise = await createExercise({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
      perSide: true,
      muscleGroup: 'shoulders',
      defaultIncrementKg: 2.5,
    });

    expect(exerciseToDraft(exercise)).toEqual({
      name: 'Sandbag carry',
      loadType: 'external',
      metric: 'reps',
      perSide: true,
      muscleGroup: 'shoulders',
      defaultIncrementKg: '2.5',
    });
  });

  it('returns empty fields for what was never filled in', async () => {
    const exercise = await createExercise({
      name: 'Ring dip',
      loadType: 'bodyweight',
      metric: 'reps',
    });

    const draft = exerciseToDraft(exercise);
    expect(draft.muscleGroup).toBe('');
    expect(draft.defaultIncrementKg).toBe('');
  });

  it('round-trips without drifting', async () => {
    // Opening the form and saving without touching anything must change
    // nothing: that is what makes correcting a name safe.
    const exercise = await createExercise({
      name: 'Pendlay row',
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      muscleGroup: 'back',
      defaultIncrementKg: 2.5,
    });

    const update = exerciseDraftToUpdate(exerciseToDraft(exercise));
    expect(update).toMatchObject({
      name: 'Pendlay row',
      loadType: 'external',
      metric: 'reps',
      perSide: false,
      muscleGroup: 'back',
      defaultIncrementKg: 2.5,
    });
  });
});

describe('exerciseDraftToUpdate', () => {
  it('trims the whitespace around the name', () => {
    expect(exerciseDraftToUpdate(draft({ name: '  Sandbag carry  ' })).name).toBe('Sandbag carry');
  });

  it('returns undefined, not an absence, for a cleared muscle group', () => {
    // The difference matters: `Table.update` reads a key present and set to
    // `undefined` as "delete it", and an absent key as "leave it alone".
    // Without that, clearing a muscle group would be impossible.
    const update = exerciseDraftToUpdate(draft({ muscleGroup: '' }));
    expect('muscleGroup' in update).toBe(true);
    expect(update.muscleGroup).toBeUndefined();
  });

  it('clears the increment when the load goes away', () => {
    // A bodyweight exercise has no load to step up.
    const update = exerciseDraftToUpdate(
      draft({ loadType: 'bodyweight', defaultIncrementKg: '2.5' }),
    );
    expect('defaultIncrementKg' in update).toBe(true);
    expect(update.defaultIncrementKg).toBeUndefined();
  });

  it('always sends the nature fields back, unchanged or not', () => {
    // updateExercise counts only *actual* changes: sending them back as they
    // were has to stay a no-op, not a refusal.
    const update = exerciseDraftToUpdate(draft());
    expect(update.loadType).toBe('external');
    expect(update.metric).toBe('reps');
    expect(update.perSide).toBe(false);
  });
});
