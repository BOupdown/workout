import { beforeEach, describe, expect, it } from 'vitest';
import { createExercise, ExerciseNameConflictError } from '../lib/db/exercises';
import { setFieldRequirements } from '../lib/db/validation';
import {
  draftAllowsIncrement,
  EMPTY_EXERCISE_DRAFT,
  exerciseDraftToInput,
  LOAD_TYPE_OPTIONS,
  METRIC_OPTIONS,
  MUSCLE_GROUP_LABELS,
  type ExerciseDraft,
} from '../lib/exercise-draft';
import { resetDatabase } from './helpers';

beforeEach(resetDatabase);

const draft = (over: Partial<ExerciseDraft> = {}): ExerciseDraft => ({
  ...EMPTY_EXERCISE_DRAFT,
  name: 'Face pull',
  ...over,
});

describe('options du formulaire', () => {
  it('couvre les quatre natures de charge', () => {
    expect(LOAD_TYPE_OPTIONS.map((o) => o.value).sort()).toEqual(
      ['assisted', 'bodyweight', 'external', 'weighted_bodyweight'].sort(),
    );
  });

  it('couvre les deux façons de mesurer l’effort', () => {
    expect(METRIC_OPTIONS.map((o) => o.value)).toEqual(['reps', 'time']);
  });

  it('nomme chaque groupe musculaire en français', () => {
    expect(Object.keys(MUSCLE_GROUP_LABELS)).toHaveLength(13);
    expect(Object.values(MUSCLE_GROUP_LABELS).every((label) => label.length > 0)).toBe(true);
  });

  it('n’expose aucun libellé technique du modèle', () => {
    const labels = LOAD_TYPE_OPTIONS.map((o) => o.label).join(' ');
    expect(labels).not.toContain('bodyweight');
    expect(labels).not.toContain('_');
  });
});

describe('draftAllowsIncrement', () => {
  it('refuse le pas de progression au poids du corps', () => {
    expect(draftAllowsIncrement({ loadType: 'bodyweight' })).toBe(false);
  });

  it('l’autorise partout où il y a une charge', () => {
    for (const loadType of ['external', 'weighted_bodyweight', 'assisted'] as const) {
      expect(draftAllowsIncrement({ loadType })).toBe(true);
    }
  });

  it('s’accorde avec la validation', () => {
    // Le formulaire et la base doivent dire la même chose, sans règle dupliquée.
    for (const { value } of LOAD_TYPE_OPTIONS) {
      const requirements = setFieldRequirements({ loadType: value, metric: 'reps' });
      expect(draftAllowsIncrement({ loadType: value })).toBe(requirements.weightKg === 'required');
    }
  });
});

describe('exerciseDraftToInput', () => {
  it('nettoie le nom saisi', () => {
    expect(exerciseDraftToInput(draft({ name: '  Face pull  ' })).name).toBe('Face pull');
  });

  it('omet un groupe musculaire non renseigné', () => {
    expect('muscleGroup' in exerciseDraftToInput(draft())).toBe(false);
  });

  it('transmet le groupe musculaire choisi', () => {
    expect(exerciseDraftToInput(draft({ muscleGroup: 'shoulders' })).muscleGroup).toBe('shoulders');
  });

  it('lit le pas de progression avec la virgule française', () => {
    expect(exerciseDraftToInput(draft({ defaultIncrementKg: '2,5' })).defaultIncrementKg).toBe(2.5);
  });

  it('n’émet jamais de pas de progression au poids du corps', () => {
    // Même si le champ traîne une valeur d'un choix précédent.
    const input = exerciseDraftToInput(
      draft({ loadType: 'bodyweight', defaultIncrementKg: '2,5' }),
    );
    expect('defaultIncrementKg' in input).toBe(false);
  });

  it('omet un pas illisible plutôt que de le deviner', () => {
    expect('defaultIncrementKg' in exerciseDraftToInput(draft({ defaultIncrementKg: 'abc' }))).toBe(
      false,
    );
  });
});

describe('exerciseDraftToInput — accord avec la base', () => {
  it.each(LOAD_TYPE_OPTIONS.map((o) => o.value))(
    'un brouillon rempli est accepté — %s',
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

  it('accepte un exercice au temps', async () => {
    const exercise = await createExercise(
      exerciseDraftToInput(draft({ name: 'Chaise au mur', loadType: 'bodyweight', metric: 'time' })),
    );
    expect(exercise.metric).toBe('time');
  });

  it('remonte le conflit de nom avec l’exercice existant', async () => {
    await createExercise(exerciseDraftToInput(draft()));

    await createExercise(exerciseDraftToInput(draft({ name: 'FACE-PULL' }))).then(
      () => expect.unreachable('la création aurait dû être refusée'),
      (error: ExerciseNameConflictError) => {
        expect(error).toBeInstanceOf(ExerciseNameConflictError);
        expect(error.existing.name).toBe('Face pull');
      },
    );
  });

  it('refuse un nom vide via la validation de la base', async () => {
    await expect(createExercise(exerciseDraftToInput(draft({ name: '   ' })))).rejects.toThrow();
  });
});
