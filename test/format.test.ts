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
): Pick<Exercise, 'loadType' | 'metric'> => ({ loadType, metric });

describe('parseNumberInput', () => {
  it('accepte la virgule décimale française', () => {
    expect(parseNumberInput('102,5')).toBe(102.5);
  });

  it('accepte aussi le point', () => {
    expect(parseNumberInput('102.5')).toBe(102.5);
  });

  it('ignore les espaces autour', () => {
    expect(parseNumberInput('  60  ')).toBe(60);
  });

  it('accepte un zéro', () => {
    // Une pullUp sans lest vaut 0, ce n'est pas une absence de valeur.
    expect(parseNumberInput('0')).toBe(0);
  });

  it('accepte une décimale en cours de frappe', () => {
    expect(parseNumberInput('102,')).toBe(102);
    expect(parseNumberInput(',5')).toBe(0.5);
  });

  it('retourne null sur un champ vide', () => {
    expect(parseNumberInput('')).toBeNull();
    expect(parseNumberInput('   ')).toBeNull();
  });

  it.each(['abc', '1 2', '1,2,3', '0x10', '1e5', '+5', '∞'])(
    'retourne null sur « %s »',
    (input) => {
      expect(parseNumberInput(input)).toBeNull();
    },
  );
});

describe('formatNumber', () => {
  it('rend la virgule décimale', () => {
    expect(formatNumber(102.5)).toBe('102.5');
  });

  it('n’ajoute pas de décimale inutile', () => {
    expect(formatNumber(60)).toBe('60');
  });

  it('absorbe les erreurs de flottant', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('fait l’aller-retour avec parseNumberInput', () => {
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
  ])('rend %i secondes en « %s »', (seconds, expected) => {
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
  ])('rend %i ms en « %s »', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('ne part pas en négatif si l’horloge dérive', () => {
    expect(formatElapsed(-5000)).toBe('0 min');
  });
});

describe('describeSet', () => {
  it('met la charge en avant et les répétitions en retrait', () => {
    expect(describeSet({ weightKg: 102.5, reps: 5 }, rules('external', 'reps'))).toEqual({
      primary: '102.5',
      secondary: '× 5',
    });
  });

  it('met les répétitions en avant au poids du corps', () => {
    expect(describeSet({ reps: 25 }, rules('bodyweight', 'reps'))).toEqual({
      primary: '25',
      secondary: 'reps',
    });
  });

  it('n’a pas de qualificatif pour une durée', () => {
    expect(describeSet({ durationSec: 90 }, rules('bodyweight', 'time'))).toEqual({
      primary: '1:30',
    });
  });

  it('reste lisible sur une série incomplète', () => {
    expect(describeSet({}, rules('external', 'reps')).primary).toBe('?');
    expect(describeSet({}, rules('bodyweight', 'time')).primary).toBe('?');
  });
});

describe('formatSetSummary', () => {
  it('rend charge × répétitions', () => {
    expect(formatSetSummary({ weightKg: 100, reps: 5 }, rules('external', 'reps'))).toBe(
      '100 × 5',
    );
  });

  it('n’affiche que les répétitions au poids du corps', () => {
    expect(formatSetSummary({ reps: 25 }, rules('bodyweight', 'reps'))).toBe('25 reps');
  });

  it('n’affiche que les répétitions quand le lest est nul', () => {
    // « 0 × 8 » n'apprendrait rien : c'est une pullUp à vide.
    expect(
      formatSetSummary({ weightKg: 0, reps: 8 }, rules('weighted_bodyweight', 'reps')),
    ).toBe('8 reps');
  });

  it('marque l’assistance comme retirée', () => {
    expect(formatSetSummary({ weightKg: 20, reps: 8 }, rules('assisted', 'reps'))).toBe(
      '-20 × 8',
    );
  });

  it('rend une durée pour un exercice au temps', () => {
    expect(formatSetSummary({ durationSec: 90 }, rules('bodyweight', 'time'))).toBe('1:30');
  });
});
