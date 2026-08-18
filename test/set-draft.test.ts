import { beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { setFieldRequirements } from '../lib/db/validation';
import {
  draftFromSet,
  draftToSetInput,
  EMPTY_DRAFT,
  resolveDraftReference,
  stepDraftValue,
  stepForField,
  visibleDraftFields,
} from '../lib/set-draft';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pompes: Exercise;
let gainage: Exercise;
let traction: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pompes, gainage, traction } = await referenceExercises());
});

describe('visibleDraftFields', () => {
  it('affiche charge et répétitions pour une charge externe', () => {
    expect(visibleDraftFields(setFieldRequirements(squat))).toEqual(['weightKg', 'reps']);
  });

  it('masque la charge au poids du corps', () => {
    expect(visibleDraftFields(setFieldRequirements(pompes))).toEqual(['reps']);
  });

  it('remplace les répétitions par la durée', () => {
    expect(visibleDraftFields(setFieldRequirements(gainage))).toEqual(['durationSec']);
  });
});

describe('draftFromSet', () => {
  it('reprend les valeurs de la série de référence', () => {
    expect(draftFromSet({ weightKg: 102.5, reps: 5 }, squat)).toEqual({
      weightKg: '102,5',
      reps: '5',
      durationSec: '',
    });
  });

  it('laisse vide un champ interdit, même si la série en porte la valeur', () => {
    // Garde-fou : une donnée héritée ne doit pas réintroduire un champ que la
    // validation refuserait.
    expect(draftFromSet({ weightKg: 20, reps: 25 }, pompes)).toEqual({
      weightKg: '',
      reps: '25',
      durationSec: '',
    });
  });

  it('remplit la durée pour un exercice au temps', () => {
    expect(draftFromSet({ durationSec: 90 }, gainage).durationSec).toBe('90');
  });

  it('rend un brouillon vide sans série de référence', () => {
    expect(draftFromSet(undefined, squat)).toEqual(EMPTY_DRAFT);
  });

  it('rend un brouillon vide sans exercice', () => {
    expect(draftFromSet({ weightKg: 100, reps: 5 }, undefined)).toEqual(EMPTY_DRAFT);
  });

  it('conserve un lest nul plutôt que de le traiter comme absent', () => {
    expect(draftFromSet({ weightKg: 0, reps: 8 }, traction).weightKg).toBe('0');
  });
});

describe('draftToSetInput', () => {
  it('produit les mesures attendues par l’exercice', () => {
    expect(
      draftToSetInput('bloc', { weightKg: '102,5', reps: '5', durationSec: '' }, squat),
    ).toEqual({ sessionExerciseId: 'bloc', weightKg: 102.5, reps: 5 });
  });

  it('n’émet aucune charge pour un exercice au poids du corps', () => {
    expect(
      draftToSetInput('bloc', { weightKg: '20', reps: '25', durationSec: '' }, pompes),
    ).toEqual({ sessionExerciseId: 'bloc', reps: 25 });
  });

  it('n’émet aucune répétition pour un exercice au temps', () => {
    expect(
      draftToSetInput('bloc', { weightKg: '', reps: '10', durationSec: '90' }, gainage),
    ).toEqual({ sessionExerciseId: 'bloc', durationSec: 90 });
  });

  it('transmet le type de série', () => {
    const input = draftToSetInput(
      'bloc',
      { weightKg: '40', reps: '10', durationSec: '' },
      squat,
      { kind: 'warmup' },
    );
    expect(input.kind).toBe('warmup');
  });

  it('omet un champ illisible plutôt que de le deviner', () => {
    const input = draftToSetInput('bloc', { weightKg: 'abc', reps: '5', durationSec: '' }, squat);
    expect('weightKg' in input).toBe(false);
  });
});

describe('draftToSetInput — accord avec la validation', () => {
  /**
   * Le point non négociable de l'écran : ce que le formulaire produit doit
   * toujours être accepté par la base. On le vérifie contre la vraie
   * `createSet`, pas contre une reproduction des règles.
   */
  async function blockFor(exercise: Exercise) {
    const { session } = await startSession();
    return addExerciseToSession(session.id, exercise.id);
  }

  it.each([
    ['charge externe', () => squat, { weightKg: '102,5', reps: '5', durationSec: '' }],
    ['poids du corps', () => pompes, { weightKg: '', reps: '25', durationSec: '' }],
    ['au temps', () => gainage, { weightKg: '', reps: '', durationSec: '90' }],
    ['lest nul', () => traction, { weightKg: '0', reps: '8', durationSec: '' }],
  ])('un brouillon rempli est accepté — %s', async (_label, pick, draft) => {
    const exercise = pick();
    const block = await blockFor(exercise);

    const set = await createSet(draftToSetInput(block.id, draft, exercise));
    expect(set.id).toBeTruthy();
  });

  it('un brouillon pollué par un champ interdit reste accepté', async () => {
    // L'utilisateur a saisi une charge sur un exercice à charge, puis a
    // sélectionné un exercice au poids du corps : le champ interdit est filtré
    // à la conversion, pas refusé par la base.
    const block = await blockFor(pompes);
    const set = await createSet(
      draftToSetInput(block.id, { weightKg: '60', reps: '25', durationSec: '' }, pompes),
    );

    expect(set.weightKg).toBeUndefined();
    expect(set.reps).toBe(25);
  });

  it('un champ requis vide produit l’erreur typée de la base', async () => {
    const block = await blockFor(squat);

    await expect(
      createSet(draftToSetInput(block.id, { weightKg: '', reps: '5', durationSec: '' }, squat)),
    ).rejects.toThrow(/attend une charge/);
  });
});

describe('resolveDraftReference', () => {
  const set = (id: string, sessionId: string, weightKg: number) => ({ id, sessionId, weightKg });

  it('préfère toujours la dernière série du bloc', () => {
    const block = { sessionId: 's1', sets: [set('a', 's1', 90), set('b', 's1', 100)] };
    const reference = resolveDraftReference(block, [set('vieux', 's0', 60)]);

    expect(reference.set).toEqual(set('b', 's1', 100));
    expect(reference.origin).toBe('block');
  });

  it('remonte à l’historique quand le bloc est vide', () => {
    const reference = resolveDraftReference({ sessionId: 's1', sets: [] }, [set('a', 's0', 95)]);

    expect(reference.set).toEqual(set('a', 's0', 95));
    expect(reference.origin).toBe('history');
  });

  it('distingue une série de la séance en cours', () => {
    // Un second bloc du même exercice dans la même séance : annoncer
    // « dernière séance » serait faux, la série date de dix minutes.
    const reference = resolveDraftReference({ sessionId: 's1', sets: [] }, [set('a', 's1', 100)]);

    expect(reference.origin).toBe('session');
  });

  it('n’a aucune référence sans bloc ni historique', () => {
    expect(resolveDraftReference(undefined, undefined).origin).toBe('none');
    expect(resolveDraftReference({ sessionId: 's1', sets: [] }, []).origin).toBe('none');
    expect(resolveDraftReference({ sessionId: 's1', sets: [] }, undefined).set).toBeUndefined();
  });
});

describe('stepForField', () => {
  it('suit le pas de progression de l’exercice pour la charge', () => {
    expect(stepForField('weightKg', squat)).toBe(2.5);
    expect(stepForField('weightKg', { ...squat, defaultIncrementKg: 5 })).toBe(5);
  });

  it('retombe sur 2,5 kg sans pas déclaré', () => {
    expect(stepForField('weightKg', { ...squat, defaultIncrementKg: undefined })).toBe(2.5);
  });

  it('avance d’une répétition et de cinq secondes', () => {
    expect(stepForField('reps', squat)).toBe(1);
    expect(stepForField('durationSec', gainage)).toBe(5);
  });
});

describe('stepDraftValue', () => {
  it('ajoute et retranche le pas', () => {
    expect(stepDraftValue('100', 2.5)).toBe('102,5');
    expect(stepDraftValue('102,5', -2.5)).toBe('100');
  });

  it('part de zéro sur un champ vide', () => {
    expect(stepDraftValue('', 2.5)).toBe('2,5');
  });

  it('ne descend jamais sous zéro', () => {
    expect(stepDraftValue('2', -5)).toBe('0');
  });

  it('n’introduit pas d’erreur de flottant', () => {
    expect(stepDraftValue('0,1', 0.2)).toBe('0,3');
  });
});
