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
  it('shows load and reps for an external load', () => {
    // Reps first: the order the fields are read and typed in.
    expect(visibleDraftFields(setFieldRequirements(squat))).toEqual(['reps', 'weightKg']);
  });

  it('hides the load for bodyweight', () => {
    expect(visibleDraftFields(setFieldRequirements(pushUps))).toEqual(['reps']);
  });

  it('replaces the reps with the duration', () => {
    expect(visibleDraftFields(setFieldRequirements(plank))).toEqual(['durationSec']);
  });
});

describe('draftFromSet', () => {
  it('carries over the values of the reference set', () => {
    expect(draftFromSet({ weightKg: 102.5, reps: 5 }, squat)).toEqual({
      weightKg: '102.5',
      reps: '5',
      durationSec: '',
    });
  });

  it('leaves a forbidden field empty, value on the set or not', () => {
    // A guard: inherited data must not bring back a field the validation would
    // refuse.
    expect(draftFromSet({ weightKg: 20, reps: 25 }, pushUps)).toEqual({
      weightKg: '',
      reps: '25',
      durationSec: '',
    });
  });

  it('fills in the duration for a timed exercise', () => {
    expect(draftFromSet({ durationSec: 90 }, plank).durationSec).toBe('90');
  });

  it('returns an empty draft with no reference set', () => {
    expect(draftFromSet(undefined, squat)).toEqual(EMPTY_DRAFT);
  });

  it('returns an empty draft with no exercise', () => {
    expect(draftFromSet({ weightKg: 100, reps: 5 }, undefined)).toEqual(EMPTY_DRAFT);
  });

  it('keeps an added load of zero rather than treating it as absent', () => {
    expect(draftFromSet({ weightKg: 0, reps: 8 }, pullUp).weightKg).toBe('0');
  });
});

describe('draftToSetInput', () => {
  it('produces the measures the exercise expects', () => {
    expect(
      draftToSetInput('block', { weightKg: '102,5', reps: '5', durationSec: '' }, squat),
    ).toEqual({ sessionExerciseId: 'block', weightKg: 102.5, reps: 5 });
  });

  it('emits no load for a bodyweight exercise', () => {
    expect(
      draftToSetInput('block', { weightKg: '20', reps: '25', durationSec: '' }, pushUps),
    ).toEqual({ sessionExerciseId: 'block', reps: 25 });
  });

  it('emits no reps for a timed exercise', () => {
    expect(
      draftToSetInput('block', { weightKg: '', reps: '10', durationSec: '90' }, plank),
    ).toEqual({ sessionExerciseId: 'block', durationSec: 90 });
  });

  it('passes the kind of set through', () => {
    const input = draftToSetInput(
      'block',
      { weightKg: '40', reps: '10', durationSec: '' },
      squat,
      { kind: 'warmup' },
    );
    expect(input.kind).toBe('warmup');
  });

  it('leaves out an unreadable field rather than guessing it', () => {
    const input = draftToSetInput('block', { weightKg: 'abc', reps: '5', durationSec: '' }, squat);
    expect('weightKg' in input).toBe(false);
  });
});

describe('draftToSetInput — agreement with the validation', () => {
  /**
   * The screen's non-negotiable point: what the form produces has to be
   * accepted by the database, every time. It is checked against the real
   * `createSet`, not against a copy of the rules.
   */
  async function blockFor(exercise: Exercise) {
    const { session } = await startSession();
    return addExerciseToSession(session.id, exercise.id);
  }

  it.each([
    ['an external load', () => squat, { weightKg: '102,5', reps: '5', durationSec: '' }],
    ['bodyweight', () => pushUps, { weightKg: '', reps: '25', durationSec: '' }],
    ['timed', () => plank, { weightKg: '', reps: '', durationSec: '90' }],
    ['an added load of zero', () => pullUp, { weightKg: '0', reps: '8', durationSec: '' }],
  ])('a filled-in draft is accepted — %s', async (_label, pick, draft) => {
    const exercise = pick();
    const block = await blockFor(exercise);

    const set = await createSet(draftToSetInput(block.id, draft, exercise));
    expect(set.id).toBeTruthy();
  });

  it('a draft polluted by a forbidden field is still accepted', async () => {
    // The user typed a load on a loaded exercise, then selected a bodyweight
    // one: the forbidden field is filtered out at conversion, not refused by
    // the database.
    const block = await blockFor(pushUps);
    const set = await createSet(
      draftToSetInput(block.id, { weightKg: '60', reps: '25', durationSec: '' }, pushUps),
    );

    expect(set.weightKg).toBeUndefined();
    expect(set.reps).toBe(25);
  });

  it('an empty required field produces the typed error from the database', async () => {
    const block = await blockFor(squat);

    await expect(
      createSet(draftToSetInput(block.id, { weightKg: '', reps: '5', durationSec: '' }, squat)),
    ).rejects.toThrow(/expects a load/);
  });
});

describe('resolveDraftReference', () => {
  const set = (id: string, weightKg: number) => ({ id, weightKg });

  it('matches the first current set to the first previous set', () => {
    const reference = resolveDraftReference({ sets: [] }, [set('a', 90), set('b', 100)]);

    expect(reference.set).toEqual(set('a', 90));
    expect(reference.origin).toBe('history');
  });

  it('matches the second current set to the second previous set', () => {
    const reference = resolveDraftReference(
      { sets: [set('current', 95)] },
      [set('first', 90), set('second', 100)],
    );

    expect(reference.set).toEqual(set('second', 100));
    expect(reference.origin).toBe('history');
  });

  it('keeps the current default when the previous session did not have the rank', () => {
    const reference = resolveDraftReference({ sets: [set('one', 90)] }, [set('first', 100)]);

    expect(reference.set).toEqual(set('one', 90));
    expect(reference.origin).toBe('block');
  });

  it('has no reference with neither block nor history', () => {
    expect(resolveDraftReference(undefined, undefined).origin).toBe('none');
    expect(resolveDraftReference({ sets: [] }, []).origin).toBe('none');
    expect(resolveDraftReference({ sets: [] }, undefined).set).toBeUndefined();
  });
});

describe('stepForField', () => {
  it('follows the increment set on the exercise for the load', () => {
    expect(stepForField('weightKg', squat)).toBe(2.5);
    expect(stepForField('weightKg', { ...squat, defaultIncrementKg: 5 })).toBe(5);
  });

  it('falls back to 2.5 kg with no increment declared', () => {
    expect(stepForField('weightKg', { ...squat, defaultIncrementKg: undefined })).toBe(2.5);
  });

  it('steps by one rep and by five seconds', () => {
    expect(stepForField('reps', squat)).toBe(1);
    expect(stepForField('durationSec', plank)).toBe(5);
  });
});

describe('stepDraftValue', () => {
  it('adds the step and takes it away', () => {
    expect(stepDraftValue('100', 2.5)).toBe('102.5');
    expect(stepDraftValue('102.5', -2.5)).toBe('100');
  });

  it('starts from zero on an empty field', () => {
    expect(stepDraftValue('', 2.5)).toBe('2.5');
  });

  it('never goes below zero', () => {
    expect(stepDraftValue('2', -5)).toBe('0');
  });

  it('introduces no floating-point error', () => {
    expect(stepDraftValue('0.1', 0.2)).toBe('0.3');
  });
});

describe('draftToSetPatch', () => {
  it('produces the measures the exercise expects', () => {
    expect(draftToSetPatch({ weightKg: '102.5', reps: '5', durationSec: '' }, squat)).toEqual({
      weightKg: 102.5,
      reps: 5,
    });
  });

  it('emits no load for a bodyweight exercise', () => {
    const patch = draftToSetPatch({ weightKg: '20', reps: '25', durationSec: '' }, pushUps);
    expect(patch).toEqual({ reps: 25 });
  });

  it('passes the kind of set through', () => {
    const patch = draftToSetPatch({ weightKg: '40', reps: '10', durationSec: '' }, squat, {
      kind: 'warmup',
    });
    expect(patch.kind).toBe('warmup');
  });

  it('clears a required field left empty, instead of staying silent', async () => {
    // Leaving it out would keep the old value: the correction would look
    // ignored. `undefined` lets the validation answer.
    const patch = draftToSetPatch({ weightKg: '', reps: '5', durationSec: '' }, squat);

    expect('weightKg' in patch).toBe(true);
    expect(patch.weightKg).toBeUndefined();

    const { session } = await startSession();
    const block = await addExerciseToSession(session.id, squat.id);
    const set = await createSet({ sessionExerciseId: block.id, weightKg: 100, reps: 5 });

    const { updateSet } = await import('../lib/db/sets');
    await expect(updateSet(set.id, patch)).rejects.toThrow(/expects a load/);
  });

  it('a filled-in patch is accepted by the database', async () => {
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
  it('starts at 8 when nothing has been typed', () => {
    // Neither 1 nor the middle of the range: 8 is the value people actually
    // record, and the others are one or two taps away.
    expect(stepRpe(null, 1)).toBe(RPE_FIRST);
    expect(stepRpe(null, -1)).toBe(RPE_FIRST);
  });

  it('avance par demi-points', () => {
    expect(stepRpe(8, 1)).toBe(8.5);
    expect(stepRpe(8, -1)).toBe(7.5);
  });

  it('does not step outside the bounds', () => {
    expect(stepRpe(RPE_MAX, 1)).toBe(RPE_MAX);
    expect(stepRpe(RPE_MIN, -1)).toBe(RPE_MIN);
  });

  it('never produces a value the validation would refuse', () => {
    // The rule: between 1 and 10, and rpe × 2 a whole number.
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

  it('writes nothing when nothing has moved', () => {
    expect(detailPatch(base({ rpe: 8, notes: 'ok' }), base({ rpe: 8, notes: 'ok' }))).toEqual({});
  });

  it('emits undefined, not an absence, for a cleared RPE', () => {
    // The distinction is what makes clearing possible: a key present and set
    // to `undefined` deletes, an absent key leaves it alone.
    const patch = detailPatch(base({ rpe: 8 }), base({ rpe: null }));
    expect('rpe' in patch).toBe(true);
    expect(patch.rpe).toBeUndefined();
  });

  it('does not store a failure as false', () => {
    const patch = detailPatch(base({ isFailure: true }), base({ isFailure: false }));
    expect('isFailure' in patch).toBe(true);
    expect(patch.isFailure).toBeUndefined();
  });

  it('trims the whitespace around notes', () => {
    expect(detailPatch(base(), base({ notes: '  right shoulder  ' })).notes).toBe('right shoulder');
  });

  it('treats a note gone empty as a clearing', () => {
    const patch = detailPatch(base({ notes: 'twinge' }), base({ notes: '   ' }));
    expect('notes' in patch).toBe(true);
    expect(patch.notes).toBeUndefined();
  });

  it('ignores a change that comes down to whitespace', () => {
    expect(detailPatch(base({ notes: 'twinge' }), base({ notes: ' twinge ' }))).toEqual({});
  });
});

describe('detailFromSet', () => {
  it('tells "not filled in" from "zero"', () => {
    expect(detailFromSet({})).toEqual({ rpe: null, isFailure: false, notes: '' });
  });

  it('reads back what is stored', () => {
    expect(detailFromSet({ rpe: 9.5, isFailure: true, notes: 'last one' })).toEqual({
      rpe: 9.5,
      isFailure: true,
      notes: 'last one',
    });
  });
});
