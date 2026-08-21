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
  /** Ce qui se lit, dans l'ordre. */
  const reading = (...args: Parameters<typeof describeSet>) =>
    describeSet(...args)
      .map((part) => part.text)
      .join(' ');

  /** La partie mise en avant, celle qu'on scanne dans une colonne. */
  const emphasised = (...args: Parameters<typeof describeSet>) =>
    describeSet(...args)
      .filter((part) => part.strong)
      .map((part) => part.text);

  it('lit les répétitions avant la charge', () => {
    // Comme on les saisit : reps à gauche, charge à droite.
    expect(reading({ weightKg: 102.5, reps: 5 }, rules('external', 'reps'))).toBe('5 × 102.5');
  });

  it('garde la charge en avant, même en seconde position', () => {
    // L'ordre et l'emphase sont deux questions séparées. Sur un historique
    // on parcourt une colonne de charges — 100, 102.5, 105 — et c'est ce
    // nombre-là qui doit accrocher l'œil, pas le nombre de répétitions.
    expect(emphasised({ weightKg: 102.5, reps: 5 }, rules('external', 'reps'))).toEqual(['102.5']);
  });

  it('met les répétitions en avant au poids du corps', () => {
    // Là ce sont elles qui progressent, donc elles sont à la fois premières
    // et mises en avant.
    expect(reading({ reps: 25 }, rules('bodyweight', 'reps'))).toBe('25 reps');
    expect(emphasised({ reps: 25 }, rules('bodyweight', 'reps'))).toEqual(['25']);
  });

  it('signale un exercice compté par côté, avec charge', () => {
    // Le modèle porte `perSide` depuis le premier schéma pour trancher
    // « 10 reps : 10 ou 20 ? ». Tant qu'il n'était affiché nulle part,
    // l'ambiguïté qu'il existe pour lever restait entière.
    expect(reading({ weightKg: 20, reps: 10 }, rules('external', 'reps', true))).toBe(
      '10/side × 20',
    );
  });

  it('colle « /side » aux répétitions, jamais à la charge', () => {
    // « 10 × 20/side » se lirait 20 kg par côté, ce qui est une autre
    // séance : sur un squat bulgare à la barre, la charge n'est pas par côté.
    const parts = describeSet({ weightKg: 20, reps: 10 }, rules('external', 'reps', true));
    expect(parts.find((part) => part.text.includes('/side'))?.text).toBe('10/side ×');
  });

  it('le signale aussi au poids du corps', () => {
    expect(reading({ reps: 12 }, rules('bodyweight', 'reps', true))).toBe('12 reps/side');
  });

  it('ne dit rien quand l’exercice est bilatéral', () => {
    expect(reading({ weightKg: 100, reps: 5 }, rules('external', 'reps'))).toBe('5 × 100');
  });

  it('signale aussi une position tenue par côté', () => {
    // Cette assertion disait l'inverse — « une durée n'a pas de côtés » — et
    // tenait tant qu'aucun exercice livré n'était à la fois au temps et
    // unilatéral. Le gainage latéral en a deux : 45 s en font 90 de travail.
    expect(reading({ durationSec: 45 }, rules('bodyweight', 'time', true))).toBe('0:45 per side');
    expect(emphasised({ durationSec: 45 }, rules('bodyweight', 'time', true))).toEqual(['0:45']);
  });

  it('laisse une durée bilatérale nue', () => {
    expect(reading({ durationSec: 90 }, rules('bodyweight', 'time'))).toBe('1:30');
  });

  it('reste lisible sur une durée manquante, par côté ou non', () => {
    expect(reading({}, rules('bodyweight', 'time', true))).toBe('?');
    expect(reading({}, rules('bodyweight', 'time'))).toBe('?');
  });

  it('reste lisible sur une série incomplète', () => {
    expect(reading({}, rules('external', 'reps'))).toBe('?');
    expect(reading({}, rules('bodyweight', 'time'))).toBe('?');
  });

  it('n’a jamais plus d’une partie mise en avant', () => {
    // Deux gros nombres côte à côte, c'est aucun des deux.
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
  it('rend répétitions × charge', () => {
    expect(formatSetSummary({ weightKg: 100, reps: 5 }, rules('external', 'reps'))).toBe(
      '5 × 100',
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
      '8 × -20',
    );
  });

  it('rend une durée pour un exercice au temps', () => {
    expect(formatSetSummary({ durationSec: 90 }, rules('bodyweight', 'time'))).toBe('1:30');
  });
});
