import { beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../lib/db/sets';
import { addExerciseToSession, startSession } from '../lib/db/sessions';
import type { Exercise } from '../lib/db/types';
import { SetValidationError } from '../lib/db/validation';
import { hasMessages, NO_MESSAGES, toFieldMessages } from '../lib/errors';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat } = await referenceExercises());
});

const VISIBLE = ['weightKg', 'reps'];

describe('toFieldMessages', () => {
  it('route une anomalie vers son champ', () => {
    const error = new SetValidationError([
      { field: 'reps', code: 'invalid_reps', message: 'Entier ≥ 1.' },
    ]);

    expect(toFieldMessages(error, VISIBLE)).toEqual({
      fields: { reps: 'Entier ≥ 1.' },
      general: [],
    });
  });

  it('ne garde que le premier message d’un même champ', () => {
    const error = new SetValidationError([
      { field: 'reps', code: 'a', message: 'Premier.' },
      { field: 'reps', code: 'b', message: 'Second.' },
    ]);

    expect(toFieldMessages(error, VISIBLE).fields.reps).toBe('Premier.');
  });

  it('remonte en général ce qui vise un champ non affiché', () => {
    // Sinon le message serait attaché à un input qui n'existe pas à l'écran,
    // et personne ne le verrait jamais.
    const error = new SetValidationError([
      { field: 'loggedAt', code: 'invalid_timestamp', message: 'Timestamp invalide.' },
    ]);

    const messages = toFieldMessages(error, VISIBLE);
    expect(messages.fields).toEqual({});
    expect(messages.general).toEqual(['Timestamp invalide.']);
  });

  it('remonte en général les anomalies de l’entité entière', () => {
    const error = new SetValidationError([
      { field: '*', code: 'not_an_object', message: 'Série invalide.' },
    ]);

    expect(toFieldMessages(error, VISIBLE).general).toEqual(['Série invalide.']);
  });

  it('rend lisible une erreur non typée', () => {
    const messages = toFieldMessages(new Error('Bloc introuvable : x'), VISIBLE);
    expect(messages.general).toEqual(['Bloc introuvable : x']);
  });

  it('ne laisse jamais rien passer de brut', () => {
    const messages = toFieldMessages('boum', VISIBLE);
    expect(messages.general).toHaveLength(1);
    expect(messages.fields).toEqual({});
  });
});

describe('toFieldMessages — sur de vraies erreurs de la base', () => {
  async function squatBlock() {
    const { session } = await startSession();
    return addExerciseToSession(session.id, squat.id);
  }

  it('affiche sous le champ une charge hors bornes', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, weightKg: 5000, reps: 5 }).then(
      () => expect.unreachable('la série aurait dû être refusée'),
      (error: unknown) => {
        const messages = toFieldMessages(error, VISIBLE);
        expect(messages.fields.weightKg).toContain('1000 kg');
        expect(messages.general).toEqual([]);
      },
    );
  });

  it('affiche sous le champ des répétitions non entières', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, weightKg: 60, reps: 5.5 }).then(
      () => expect.unreachable('la série aurait dû être refusée'),
      (error: unknown) => {
        expect(toFieldMessages(error, VISIBLE).fields.reps).toContain('entier');
      },
    );
  });

  it('remonte en bandeau une mesure manquante', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, reps: 5 }).then(
      () => expect.unreachable('la série aurait dû être refusée'),
      (error: unknown) => {
        expect(toFieldMessages(error, VISIBLE).fields.weightKg).toContain('attend une charge');
      },
    );
  });
});

describe('hasMessages', () => {
  it('est faux sans message', () => {
    expect(hasMessages(NO_MESSAGES)).toBe(false);
  });

  it('est vrai avec un message de champ ou un message général', () => {
    expect(hasMessages({ fields: { reps: 'x' }, general: [] })).toBe(true);
    expect(hasMessages({ fields: {}, general: ['x'] })).toBe(true);
  });
});
