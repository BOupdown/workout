import { describe, expect, it } from 'vitest';
import {
  describeSet,
  formatDuration,
  formatElapsed,
  formatNumber,
  formatSetSummary,
  formatWeight,
  parseNumberInput,
} from '../lib/format';
import type { Exercise } from '../lib/db/types';

const rules = (
  loadType: Exercise['loadType'],
  metric: Exercise['metric'],
  perSide = false,
): Pick<Exercise, 'loadType' | 'metric' | 'perSide'> => ({ loadType, metric, perSide });

describe('parseNumberInput', () => {
  it('accepts a decimal comma', () => {
    expect(parseNumberInput('102,5')).toBe(102.5);
  });

  it('accepte aussi le point', () => {
    expect(parseNumberInput('102.5')).toBe(102.5);
  });

  it('ignore les espaces autour', () => {
    expect(parseNumberInput('  60  ')).toBe(60);
  });

  it('accepts a zero', () => {
    // A pull-up with no added load is 0, which is not a missing value.
    expect(parseNumberInput('0')).toBe(0);
  });

  it('accepts a decimal still being typed', () => {
    expect(parseNumberInput('102,')).toBe(102);
    expect(parseNumberInput(',5')).toBe(0.5);
  });

  it('returns null for an empty field', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
  });

  it.each(['abc', '1 2', '1,2,3', '0x10', '1e5', '+5', '∞'])(
    'returns null for "%s"',
    (input) => {
      expect(parseNumberInput(input)).toBeNull();
    },
  );
});

describe('formatNumber', () => {
  it('renders the decimal comma', () => {
    expect(formatNumber(102.5)).toBe('102.5');
  });

  it('adds no needless decimal', () => {
    expect(formatNumber(60)).toBe('60');
  });

  it('absorbs floating-point error', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('round-trips through parseNumberInput', () => {
    expect(parseNumberInput(formatNumber(102.5))).toBe(102.5);
  });
});

describe('formatWeight', () => {
  it('suffixe en kilogrammes', () => {
    expect(formatWeight(102.5)).toBe('102.5 kg');
  });
});

describe('formatDuration', () => {
  it.each([
    [90, '1:30'],
    [45, '0:45'],
    [60, '1:00'],
    [0, '0:00'],
    [3661, '1:01:01'],
  ])('renders %i seconds as "%s"', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, '0 min'],
    [59_000, '0 min'],
    [12 * 60_000, '12 min'],
    [59 * 60_000, '59 min'],
    [60 * 60_000, '1h 00m'],
    [72 * 60_000, '1h 12m'],
    [125 * 60_000, '2h 05m'],
  ])('renders %i ms as "%s"', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('does not go negative when the clock drifts', () => {
    expect(formatElapsed(-5000)).toBe('0 min');
  });
});

describe('describeSet', () => {
  /** What is read, in order. */
  const reading = (...args: Parameters<typeof describeSet>) =>
    describeSet(...args)
      .map((part) => part.text)
      .join(' ');

  /** The part carrying the emphasis, the one scanned down a column. */
  const emphasised = (...args: Parameters<typeof describeSet>) =>
    describeSet(...args)
      .filter((part) => part.strong)
      .map((part) => part.text);

  it('reads reps before load', () => {
    // The way they are typed: reps on the left, load on the right.
    expect(reading({ weightKg: 102.5, reps: 5 }, rules('external', 'reps'))).toBe('5 × 102.5');
  });

  it('keeps the load emphasised, second though it comes', () => {
    // Order and emphasis are two separate questions. Reading a history means
    // running down a column of loads — 100, 102.5, 105 — and that is the number
    // which has to catch the eye, not the rep count.
    expect(emphasised({ weightKg: 102.5, reps: 5 }, rules('external', 'reps'))).toEqual(['102.5']);
  });

  it('emphasises the reps for bodyweight', () => {
    // There they are what progresses, so they come both first and emphasised.
    expect(reading({ reps: 25 }, rules('bodyweight', 'reps'))).toBe('25 reps');
    expect(emphasised({ reps: 25 }, rules('bodyweight', 'reps'))).toEqual(['25']);
  });

  it('flags an exercise counted per side, load included', () => {
    // The model has carried `perSide` since the first schema, to settle
    // "10 reps: ten or twenty?". While it appeared nowhere on screen, the very
    // ambiguity it exists to remove stayed exactly where it was.
    expect(reading({ weightKg: 20, reps: 10 }, rules('external', 'reps', true))).toBe(
      '10 × 20/side',
    );
  });

  it('puts "/side" at the end, not in the middle', () => {
    // This assertion used to say the opposite, on the grounds that "20/side"
    // could read as 20 kg a side. In the gym the set is said "ten times twenty,
    // each side", and splitting the two figures to qualify only one of them
    // reads worse than the ambiguity it avoids.
    const parts = describeSet({ weightKg: 20, reps: 10 }, rules('external', 'reps', true));
    expect(parts.at(-1)?.text).toBe('20/side');
    expect(parts.some((part) => part.text.startsWith('10/side'))).toBe(false);
  });

  it('flags it for bodyweight too', () => {
    expect(reading({ reps: 12 }, rules('bodyweight', 'reps', true))).toBe('12 reps/side');
  });

  it('says nothing when the exercise is bilateral', () => {
    expect(reading({ weightKg: 100, reps: 5 }, rules('external', 'reps'))).toBe('5 × 100');
  });

  it('flags a hold counted per side as well', () => {
    // This assertion used to say the opposite — "a duration has no sides" —
    // and held while no shipped exercise was both timed and unilateral. The
    // side plank has two: 45 s of it is 90 s of work.
    expect(reading({ durationSec: 45 }, rules('bodyweight', 'time', true))).toBe('0:45 per side');
    expect(emphasised({ durationSec: 45 }, rules('bodyweight', 'time', true))).toEqual(['0:45']);
  });

  it('leaves a bilateral duration bare', () => {
    expect(reading({ durationSec: 90 }, rules('bodyweight', 'time'))).toBe('1:30');
  });

  it('stays readable with the duration missing, per side or not', () => {
    expect(reading({}, rules('bodyweight', 'time', true))).toBe('?');
    expect(reading({}, rules('bodyweight', 'time'))).toBe('?');
  });

  it('stays readable on an incomplete set', () => {
    expect(reading({}, rules('external', 'reps'))).toBe('?');
    expect(reading({}, rules('bodyweight', 'time'))).toBe('?');
  });

  it('never carries more than one emphasised part', () => {
    // Two big numbers side by side is neither of them.
    const cases: Parameters<typeof describeSet>[] = [
      [{ weightKg: 100, reps: 5 }, rules('external', 'reps')],
      [{ reps: 12 }, rules('bodyweight', 'reps', true)],
      [{ durationSec: 45 }, rules('bodyweight', 'time', true)],
      [{ weightKg: 20, reps: 8 }, rules('assisted', 'reps')],
      [{}, rules('external', 'reps')],
    ];

    for (const args of cases) {
      expect(emphasised(...args)).toHaveLength(1);
    }
  });
});

describe('formatSetSummary', () => {
  it('renders reps × load', () => {
    expect(formatSetSummary({ weightKg: 100, reps: 5 }, rules('external', 'reps'))).toBe(
      '5 × 100',
    );
  });

  it('shows the reps alone for bodyweight', () => {
    expect(formatSetSummary({ reps: 25 }, rules('bodyweight', 'reps'))).toBe('25 reps');
  });

  it('shows the reps alone when the added load is zero', () => {
    // "0 × 8" would teach nothing: it is a pull-up with nothing on the belt.
    expect(
      formatSetSummary({ weightKg: 0, reps: 8 }, rules('weighted_bodyweight', 'reps')),
    ).toBe('8 reps');
  });

  it('marks the assistance as taken off', () => {
    expect(formatSetSummary({ weightKg: 20, reps: 8 }, rules('assisted', 'reps'))).toBe(
      '8 × -20',
    );
  });

  it('renders a duration for a timed exercise', () => {
    expect(formatSetSummary({ durationSec: 90 }, rules('bodyweight', 'time'))).toBe('1:30');
  });
});
