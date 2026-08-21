import { beforeEach, describe, expect, it } from 'vitest';
import { createSet, recentSetsForExercise } from '../lib/db/sets';
import { addExerciseToSession, endSession, startSession } from '../lib/db/sessions';
import type { Exercise, SetEntry } from '../lib/db/types';
import {
  buildChartGeometry,
  buildProgression,
  isBetterPerformance,
  progressionDelta,
  progressionMetric,
  recordSet,
  type SessionPoint,
} from '../lib/progression';
import { referenceExercises, resetDatabase } from './helpers';

let squat: Exercise;
let pushUps: Exercise;
let plank: Exercise;
let pullUp: Exercise;

beforeEach(async () => {
  await resetDatabase();
  ({ squat, pushUps, plank, pullUp } = await referenceExercises());
});

/** Série minimale : seuls les champs lus par la progression sont renseignés. */
const set = (over: Partial<SetEntry>): SetEntry =>
  ({
    id: Math.random().toString(36).slice(2),
    sessionExerciseId: 'b',
    sessionId: 's1',
    exerciseId: 'e',
    performedAt: 1000,
    loggedAt: 1000,
    order: 0,
    kind: 'work',
    ...over,
  }) as SetEntry;

describe('progressionMetric', () => {
  it('suit la charge pour un exercice à charge externe', () => {
    expect(progressionMetric(squat)).toBe('weightKg');
  });

  it('suit le lest pour un exercice lesté', () => {
    expect(progressionMetric(pullUp)).toBe('weightKg');
  });

  it('suit les répétitions au poids du corps', () => {
    expect(progressionMetric(pushUps)).toBe('reps');
  });

  it('suit la durée pour un exercice au temps', () => {
    expect(progressionMetric(plank)).toBe('durationSec');
  });
});

describe('buildProgression', () => {
  it('réduit chaque séance à sa meilleure série', () => {
    const points = buildProgression(
      [
        set({ sessionId: 's1', performedAt: 100, weightKg: 90, reps: 5 }),
        set({ sessionId: 's1', performedAt: 100, weightKg: 100, reps: 5 }),
        set({ sessionId: 's1', performedAt: 100, weightKg: 95, reps: 5 }),
      ],
      squat,
    );

    expect(points).toHaveLength(1);
    expect(points[0].value).toBe(100);
    expect(points[0].setCount).toBe(3);
  });

  it('départage deux séries de même charge par les répétitions', () => {
    const points = buildProgression(
      [
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
        set({ performedAt: 100, weightKg: 100, reps: 7 }),
      ],
      squat,
    );

    expect(points[0].reps).toBe(7);
  });

  it('exclut les échauffements', () => {
    // Les inclure ferait plonger la courbe à chaque montée en charge loggée.
    const points = buildProgression(
      [
        set({ performedAt: 100, kind: 'warmup', weightKg: 40, reps: 10 }),
        set({ performedAt: 100, weightKg: 100, reps: 5 }),
      ],
      squat,
    );

    expect(points[0].value).toBe(100);
    expect(points[0].setCount).toBe(1);
  });

  it('trie les séances de la plus ancienne à la plus récente', () => {
    const points = buildProgression(
      [
        set({ sessionId: 'c', performedAt: 300, weightKg: 105, reps: 5 }),
        set({ sessionId: 'a', performedAt: 100, weightKg: 95, reps: 5 }),
        set({ sessionId: 'b', performedAt: 200, weightKg: 100, reps: 5 }),
      ],
      squat,
    );

    expect(points.map((p) => p.performedAt)).toEqual([100, 200, 300]);
    expect(points.map((p) => p.value)).toEqual([95, 100, 105]);
  });

  it('suit les répétitions au poids du corps, sans annotation de charge', () => {
    const points = buildProgression(
      [set({ performedAt: 100, reps: 25 }), set({ performedAt: 100, reps: 30 })],
      pushUps,
    );

    expect(points[0].value).toBe(30);
    expect(points[0].reps).toBeUndefined();
  });

  it('suit la durée pour un exercice au temps', () => {
    const points = buildProgression([set({ performedAt: 100, durationSec: 90 })], plank);
    expect(points[0].value).toBe(90);
  });

  it('ignore une série dépourvue de la grandeur suivie', () => {
    expect(buildProgression([set({ performedAt: 100, reps: 5 })], squat)).toEqual([]);
  });

  it('rend une liste vide sans série', () => {
    expect(buildProgression([], squat)).toEqual([]);
  });
});

describe('buildProgression — sur de vraies séries', () => {
  it('reconstruit la progression de deux séances', async () => {
    const older = Date.parse('2026-08-09T09:00:00Z');
    const first = await startSession({ startedAt: older });
    const blockA = await addExerciseToSession(first.session.id, squat.id);
    await createSet({ sessionExerciseId: blockA.id, kind: 'warmup', weightKg: 40, reps: 10 });
    await createSet({ sessionExerciseId: blockA.id, weightKg: 95, reps: 5 });
    await endSession(first.session.id, older + 3_600_000);

    const recent = Date.parse('2026-08-16T09:00:00Z');
    const second = await startSession({ startedAt: recent });
    const blockB = await addExerciseToSession(second.session.id, squat.id);
    await createSet({ sessionExerciseId: blockB.id, weightKg: 100, reps: 5 });
    await createSet({ sessionExerciseId: blockB.id, weightKg: 102.5, reps: 4 });

    const sets = await recentSetsForExercise(squat.id, 100, { includeWarmups: true });
    const points = buildProgression(sets, squat);

    expect(points.map((p) => p.value)).toEqual([95, 102.5]);
    expect(points[1].setCount).toBe(2);
    expect(progressionDelta(points)).toBe(7.5);
  });
});

describe('progressionDelta', () => {
  const point = (value: number): SessionPoint => ({
    sessionId: String(value),
    performedAt: value,
    value,
    setCount: 1,
  });

  it('compare les deux dernières séances', () => {
    expect(progressionDelta([point(95), point(100)])).toBe(5);
    expect(progressionDelta([point(100), point(95)])).toBe(-5);
  });

  it('ne compare rien avec une seule séance', () => {
    expect(progressionDelta([point(100)])).toBeNull();
    expect(progressionDelta([])).toBeNull();
  });
});

describe('buildChartGeometry', () => {
  const box = { width: 320, height: 160, padding: { top: 16, right: 16, bottom: 24, left: 16 } };
  const points = (...values: number[]): SessionPoint[] =>
    values.map((value, index) => ({
      sessionId: String(index),
      performedAt: index * 1000,
      value,
      setCount: 1,
    }));

  it('projette le premier point à gauche et le dernier à droite', () => {
    const { plotted } = buildChartGeometry(points(90, 100, 110), box);

    expect(plotted[0].x).toBe(16);
    expect(plotted[2].x).toBe(304);
  });

  it('place les valeurs hautes en haut', () => {
    const { plotted } = buildChartGeometry(points(90, 110), box);
    expect(plotted[1].y).toBeLessThan(plotted[0].y);
  });

  it('garde le tracé dans la boîte', () => {
    const { plotted } = buildChartGeometry(points(90, 100, 110, 105), box);

    for (const p of plotted) {
      expect(p.y).toBeGreaterThanOrEqual(box.padding.top);
      expect(p.y).toBeLessThanOrEqual(box.height - box.padding.bottom);
    }
  });

  it('centre un point unique plutôt que de le coller au bord', () => {
    const { plotted } = buildChartGeometry(points(100), box);
    expect(plotted[0].x).toBe(160);
  });

  it('ne divise pas par zéro quand toutes les valeurs sont identiques', () => {
    // Trois séances au même poids : amplitude nulle, piège classique.
    const { plotted } = buildChartGeometry(points(100, 100, 100), box);

    expect(plotted.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(new Set(plotted.map((p) => p.y)).size).toBe(1);
  });

  it('referme la nappe sur la base du tracé', () => {
    const { area } = buildChartGeometry(points(90, 100), box);

    expect(area.endsWith('Z')).toBe(true);
    expect(area).toContain(String(box.height - box.padding.bottom));
  });

  it('désigne le point le plus haut', () => {
    expect(buildChartGeometry(points(90, 120, 100), box).peakIndex).toBe(1);
  });

  it('produit des graduations rondes et peu nombreuses', () => {
    const { ticks } = buildChartGeometry(points(92.5, 117.5), box);

    expect(ticks.length).toBeLessThanOrEqual(4);
    expect(ticks.every((t) => Number.isFinite(t.y))).toBe(true);
    expect(ticks.every((t) => t.value % 5 === 0)).toBe(true);
  });
});

describe('isBetterPerformance', () => {
  it('departage sur la valeur', () => {
    expect(isBetterPerformance({ value: 102.5 }, { value: 100 }, 'weightKg')).toBe(true);
    expect(isBetterPerformance({ value: 97.5 }, { value: 100 }, 'weightKg')).toBe(false);
  });

  it('departage a charge egale sur les reps', () => {
    expect(
      isBetterPerformance({ value: 100, reps: 6 }, { value: 100, reps: 5 }, 'weightKg'),
    ).toBe(true);
  });

  it('ne departage pas sur les reps quand la charge n est pas la quantite suivie', () => {
    // En metrique reps, la valeur *est* les reps : un second champ n a pas de sens.
    expect(isBetterPerformance({ value: 10, reps: 99 }, { value: 10, reps: 1 }, 'reps')).toBe(
      false,
    );
  });

  it('est stricte : une performance egale ne detrone pas', () => {
    expect(isBetterPerformance({ value: 100, reps: 5 }, { value: 100, reps: 5 }, 'weightKg')).toBe(
      false,
    );
  });
});

describe('recordSet', () => {
  it('rend null sans aucune serie', () => {
    expect(recordSet([], squat)).toBeNull();
  });

  it('retient la charge la plus lourde', () => {
    const best = set({ weightKg: 110, reps: 3, performedAt: 2000 });
    const found = recordSet([set({ weightKg: 100, reps: 5 }), best], squat);
    expect(found?.id).toBe(best.id);
  });

  it('departage a charge egale sur les reps', () => {
    const best = set({ weightKg: 100, reps: 8, performedAt: 2000 });
    const found = recordSet([set({ weightKg: 100, reps: 5 }), best], squat);
    expect(found?.id).toBe(best.id);
  });

  it('laisse le record au premier qui l a atteint', () => {
    // Refaire exactement la meme performance ne bat personne.
    const first = set({ weightKg: 100, reps: 5, performedAt: 1000 });
    const later = set({ weightKg: 100, reps: 5, performedAt: 5000 });
    expect(recordSet([later, first], squat)?.id).toBe(first.id);
  });

  it('ignore l ordre d arrivee de la liste', () => {
    // `recentSetsForExercise` rend l ordre antichronologique : sans tri interne,
    // une egalite donnerait le record a la plus recente.
    const first = set({ weightKg: 100, reps: 5, performedAt: 1000, order: 0 });
    const second = set({ weightKg: 100, reps: 5, performedAt: 1000, order: 1 });
    expect(recordSet([second, first], squat)?.id).toBe(first.id);
    expect(recordSet([first, second], squat)?.id).toBe(first.id);
  });

  it('exclut les echauffements', () => {
    // Un echauffement lourd n est pas une performance.
    const work = set({ weightKg: 100, reps: 5 });
    const warmup = set({ weightKg: 200, reps: 1, kind: 'warmup', performedAt: 2000 });
    expect(recordSet([work, warmup], squat)?.id).toBe(work.id);
  });

  it('suit les reps pour un exercice au poids du corps', () => {
    const best = set({ reps: 20, performedAt: 2000 });
    expect(recordSet([set({ reps: 12 }), best], pushUps)?.id).toBe(best.id);
  });

  it('suit la duree pour un exercice chronometre', () => {
    const best = set({ durationSec: 120, performedAt: 2000 });
    expect(recordSet([set({ durationSec: 60 }), best], plank)?.id).toBe(best.id);
  });

  it('ignore une serie sans la mesure suivie', () => {
    const usable = set({ weightKg: 80, reps: 5 });
    expect(recordSet([set({ reps: 5 }), usable], squat)?.id).toBe(usable.id);
  });

  it('designe la meme serie que le sommet de la courbe', () => {
    // L invariant qui justifie la regle partagee : le record ne peut pas se
    // trouver sous le point le plus haut de sa propre courbe.
    const sets = [
      set({ weightKg: 100, reps: 5, sessionId: 's1', performedAt: 1000 }),
      set({ weightKg: 110, reps: 3, sessionId: 's2', performedAt: 2000 }),
      set({ weightKg: 105, reps: 6, sessionId: 's3', performedAt: 3000 }),
    ];

    const top = buildProgression(sets, squat).reduce((a, b) => (b.value > a.value ? b : a));
    expect(recordSet(sets, squat)?.weightKg).toBe(top.value);
  });
});
