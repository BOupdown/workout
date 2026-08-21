import { beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { setFieldRequirements } from '../lib/db/validation';
import {
  draftFromSet,
  draftToSetInput,
  draftToSetPatch,
  EMPTY_DRAFT,
  resolveDraftReference,
  stepDraftValue,
  stepForField,
  visibleDraftFields,
  detailFromSet,
  detailPatch,
  RPE_FIRST,
  RPE_MAX,
  RPE_MIN,
  stepRpe,
  type SetDetailDraft,
} from '../lib/set-draft';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;
let pullUp: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank, pullUp } = await referenceExercises());
});

describe('visibleDraftFields', () => {
  it('affiche charge et répétitions pour une charge externe', () => {
    // Reps first: the order the fields are read and typed in.
    expect(visibleDraftFields(setFieldRequirements(squat))).toEqual(['reps', 'weightKg']);
  });

  it('masque la charge au poids du corps', () => {
    expect(visibleDraftFields(setFieldRequirements(pushUps))).toEqual(['reps']);
  });

  it('remplace les répétitions par la durée', () => {
    expect(visibleDraftFields(setFieldRequirements(plank))).toEqual(['durationSec']);
  });
});

describe('draftFromSet', () => {
  it('reprend les valeurs de la série de référence', () => {
    expect(draftFromSet({ weightKg: 102.5, reps: 5 }, squat)).toEqual({
      weightKg: '102.5',
      reps: '5',
      durationSec: '',
    });
  });

  it('laisse vide un champ interdit, même si la série en porte la valeur', () => {
    // Garde-fou : une donnée héritée ne doit pas réintroduire un champ que la
    // validation refuserait.
    expect(draftFromSet({ weightKg: 20, reps: 25 }, pushUps)).toEqual({
      weightKg: '',
      reps: '25',
      durationSec: '',
    });
  });

  it('remplit la durée pour un exercice au temps', () => {
    expect(draftFromSet({ durationSec: 90 }, plank).durationSec).toBe('90');
  });

  it('rend un brouillon vide sans série de référence', () => {
    expect(draftFromSet(undefined, squat)).toEqual(EMPTY_DRAFT);
  });

  it('rend un brouillon vide sans exercice', () => {
    expect(draftFromSet({ weightKg: 100, reps: 5 }, undefined)).toEqual(EMPTY_DRAFT);
  });

  it('conserve un lest nul plutôt que de le traiter comme absent', () => {
    expect(draftFromSet({ weightKg: 0, reps: 8 }, pullUp).weightKg).toBe('0');
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
      draftToSetInput('bloc', { weightKg: '20', reps: '25', durationSec: '' }, pushUps),
    ).toEqual({ sessionExerciseId: 'bloc', reps: 25 });
  });

  it('n’émet aucune répétition pour un exercice au temps', () => {
    expect(
      draftToSetInput('bloc', { weightKg: '', reps: '10', durationSec: '90' }, plank),
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
    ['poids du corps', () => pushUps, { weightKg: '', reps: '25', durationSec: '' }],
    ['au temps', () => plank, { weightKg: '', reps: '', durationSec: '90' }],
    ['lest nul', () => pullUp, { weightKg: '0', reps: '8', durationSec: '' }],
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
    const block = await blockFor(pushUps);
    const set = await createSet(
      draftToSetInput(block.id, { weightKg: '60', reps: '25', durationSec: '' }, pushUps),
    );

    expect(set.weightKg).toBeUndefined();
    expect(set.reps).toBe(25);
  });

  it('un champ requis vide produit l’erreur typée de la base', async () => {
    const block = await blockFor(squat);

    await expect(
      createSet(draftToSetInput(block.id, { weightKg: '', reps: '5', durationSec: '' }, squat)),
    ).rejects.toThrow(/expects a load/);
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
    expect(stepForField('durationSec', plank)).toBe(5);
  });
});

describe('stepDraftValue', () => {
  it('ajoute et retranche le pas', () => {
    expect(stepDraftValue('100', 2.5)).toBe('102.5');
    expect(stepDraftValue('102.5', -2.5)).toBe('100');
  });

  it('part de zéro sur un champ vide', () => {
    expect(stepDraftValue('', 2.5)).toBe('2.5');
  });

  it('ne descend jamais sous zéro', () => {
    expect(stepDraftValue('2', -5)).toBe('0');
  });

  it('n’introduit pas d’erreur de flottant', () => {
    expect(stepDraftValue('0.1', 0.2)).toBe('0.3');
  });
});

describe('draftToSetPatch', () => {
  it('produit les mesures attendues par l’exercice', () => {
    expect(draftToSetPatch({ weightKg: '102.5', reps: '5', durationSec: '' }, squat)).toEqual({
      weightKg: 102.5,
      reps: 5,
    });
  });

  it('n’émet aucune charge pour un exercice au poids du corps', () => {
    const patch = draftToSetPatch({ weightKg: '20', reps: '25', durationSec: '' }, pushUps);
    expect(patch).toEqual({ reps: 25 });
  });

  it('transmet le type de série', () => {
    const patch = draftToSetPatch({ weightKg: '40', reps: '10', durationSec: '' }, squat, {
      kind: 'warmup',
    });
    expect(patch.kind).toBe('warmup');
  });

  it('efface un champ requis laissé vide, au lieu de le taire', async () => {
    // L'omettre reviendrait à garder l'ancienne valeur : la correction
    // paraîtrait ignorée. `undefined` laisse la validation répondre.
    const patch = draftToSetPatch({ weightKg: '', reps: '5', durationSec: '' }, squat);

    expect('weightKg' in patch).toBe(true);
    expect(patch.weightKg).toBeUndefined();

    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { updateSet } = await import('../lib/db/sets');
    await expect(updateSet(set.id, patch)).rejects.toThrow(/expects a load/);
  });

  it('un patch rempli est accepté par la base', async () => {
    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { updateSet } = await import('../lib/db/sets');
    const updated = await updateSet(
      set.id,
      draftToSetPatch({ weightKg: '102.5', reps: '4', durationSec: '' }, squat),
    );

    expect(updated.weightKg).toBe(102.5);
    expect(updated.reps).toBe(4);
  });
});

describe('stepRpe', () => {
  it('démarre à 8 quand rien n’est saisi', () => {
    // Ni 1 ni un milieu de plage : 8 est la valeur réellement notée, et les
    // autres sont à un ou deux taps.
    expect(stepRpe(null, 1)).toBe(RPE_FIRST);
    expect(stepRpe(null, -1)).toBe(RPE_FIRST);
  });

  it('avance par demi-points', () => {
    expect(stepRpe(8, 1)).toBe(8.5);
    expect(stepRpe(8, -1)).toBe(7.5);
  });

  it('ne sort pas des bornes', () => {
    expect(stepRpe(RPE_MAX, 1)).toBe(RPE_MAX);
    expect(stepRpe(RPE_MIN, -1)).toBe(RPE_MIN);
  });

  it('ne produit jamais une valeur que la validation refuserait', () => {
    // La règle est : entre 1 et 10, et rpe × 2 entier.
    let value: number | null = null;
    for (let i = 0; i < 60; i += 1) {
      value = stepRpe(value, 1);
      expect(Number.isInteger(value * 2)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(RPE_MIN);
      expect(value).toBeLessThanOrEqual(RPE_MAX);
    }
    for (let i = 0; i < 60; i += 1) {
      value = stepRpe(value, -1);
      expect(Number.isInteger(value * 2)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(RPE_MIN);
      expect(value).toBeLessThanOrEqual(RPE_MAX);
    }
  });
});

describe('detailPatch', () => {
  const base = (over: Partial<SetDetailDraft> = {}): SetDetailDraft => ({
    rpe: null,
    isFailure: false,
    notes: '',
    ...over,
  });

  it('n’écrit rien quand rien n’a bougé', () => {
    expect(detailPatch(base({ rpe: 8, notes: 'ok' }), base({ rpe: 8, notes: 'ok' }))).toEqual({});
  });

  it('émet undefined, et non une absence, pour un RPE effacé', () => {
    // La distinction est ce qui permet d'effacer : clé présente à `undefined`
    // = supprime, clé absente = n'y touche pas.
    const patch = detailPatch(base({ rpe: 8 }), base({ rpe: null }));
    expect('rpe' in patch).toBe(true);
    expect(patch.rpe).toBeUndefined();
  });

  it('ne stocke pas un échec à false', () => {
    const patch = detailPatch(base({ isFailure: true }), base({ isFailure: false }));
    expect('isFailure' in patch).toBe(true);
    expect(patch.isFailure).toBeUndefined();
  });

  it('coupe les espaces des notes', () => {
    expect(detailPatch(base(), base({ notes: '  épaule droite  ' })).notes).toBe('épaule droite');
  });

  it('traite une note devenue vide comme un effacement', () => {
    const patch = detailPatch(base({ notes: 'gêne' }), base({ notes: '   ' }));
    expect('notes' in patch).toBe(true);
    expect(patch.notes).toBeUndefined();
  });

  it('ignore un changement qui se réduit à des espaces', () => {
    expect(detailPatch(base({ notes: 'gêne' }), base({ notes: ' gêne ' }))).toEqual({});
  });
});

describe('detailFromSet', () => {
  it('distingue « non renseigné » de « zéro »', () => {
    expect(detailFromSet({})).toEqual({ rpe: null, isFailure: false, notes: '' });
  });

  it('relit ce qui est enregistré', () => {
    expect(detailFromSet({ rpe: 9.5, isFailure: true, notes: 'dernière' })).toEqual({
      rpe: 9.5,
      isFailure: true,
      notes: 'dernière',
    });
  });
});
