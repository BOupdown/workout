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
  it('routes an issue to its field', () => {
    const error = new SetValidationError([
      { field: 'reps', code: 'invalid_reps', message: 'Whole number ≥ 1.' },
    ]);

    expect(toFieldMessages(error, VISIBLE)).toEqual({
      fields: { reps: 'Whole number ≥ 1.' },
      general: [],
    });
  });

  it('keeps only the first message for any one field', () => {
    const error = new SetValidationError([
      { field: 'reps', code: 'a', message: 'First.' },
      { field: 'reps', code: 'b', message: 'Second.' },
    ]);

    expect(toFieldMessages(error, VISIBLE).fields.reps).toBe('First.');
  });

  it('raises as general what aims at a field not on screen', () => {
    // Otherwise the message would be attached to an input that is not on the
    // screen, and nobody would ever see it.
    const error = new SetValidationError([
      { field: 'loggedAt', code: 'invalid_timestamp', message: 'Invalid timestamp.' },
    ]);

    const messages = toFieldMessages(error, VISIBLE);
    expect(messages.fields).toEqual({});
    expect(messages.general).toEqual(['Invalid timestamp.']);
  });

  it('raises as general the issues about the whole entity', () => {
    const error = new SetValidationError([
      { field: '*', code: 'not_an_object', message: 'Invalid set.' },
    ]);

    expect(toFieldMessages(error, VISIBLE).general).toEqual(['Invalid set.']);
  });

  it('makes an untyped error readable', () => {
    const messages = toFieldMessages(new Error('Block not found: x'), VISIBLE);
    expect(messages.general).toEqual(['Block not found: x']);
  });

  it('never lets anything through raw', () => {
    const messages = toFieldMessages('boom', VISIBLE);
    expect(messages.general).toHaveLength(1);
    expect(messages.fields).toEqual({});
  });
});

describe('toFieldMessages — on real errors from the database', () => {
  async function squatBlock() {
    const { session } = await startSession();
    return addExerciseToSession(session.id, squat.id);
  }

  it('shows a load out of bounds under its field', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, weightKg: 5000, reps: 5 }).then(
      () => expect.unreachable('the set should have been refused'),
      (error: unknown) => {
        const messages = toFieldMessages(error, VISIBLE);
        expect(messages.fields.weightKg).toContain('1000 kg');
        expect(messages.general).toEqual([]);
      },
    );
  });

  it('shows non-whole reps under their field', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, weightKg: 60, reps: 5.5 }).then(
      () => expect.unreachable('the set should have been refused'),
      (error: unknown) => {
        expect(toFieldMessages(error, VISIBLE).fields.reps).toContain('whole number');
      },
    );
  });

  it('raises a missing measure to the banner', async () => {
    const block = await squatBlock();

    await createSet({ sessionExerciseId: block.id, reps: 5 }).then(
      () => expect.unreachable('the set should have been refused'),
      (error: unknown) => {
        expect(toFieldMessages(error, VISIBLE).fields.weightKg).toContain('expects a load');
      },
    );
  });
});

describe('hasMessages', () => {
  it('is false with no message', () => {
    expect(hasMessages(NO_MESSAGES)).toBe(false);
  });

  it('is true with a field message or a general one', () => {
    expect(hasMessages({ fields: { reps: 'x' }, general: [] })).toBe(true);
    expect(hasMessages({ fields: {}, general: ['x'] })).toBe(true);
  });
});
