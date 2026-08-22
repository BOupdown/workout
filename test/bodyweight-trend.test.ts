import { describe, expect, it } from 'vitest';
import { buildWeightTrend } from '../lib/bodyweight-trend';
import type { BodyWeight } from '../lib/db/types';

const entry = (date: string, weightKg: number): BodyWeight =>
  ({ date, weightKg }) as BodyWeight;

describe('buildWeightTrend', () => {
  it('trie les pesées, quel que soit l’ordre reçu', () => {
    const trend = buildWeightTrend(
      [entry('2026-08-20', 80), entry('2026-08-01', 82)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.points.map((point) => point.date)).toEqual(['2026-08-01', '2026-08-20']);
  });

  it('place les points selon la date, pas selon leur rang', () => {
    // Le cœur du sujet : peser les 1er, 2 et 3 puis le 31 n'est pas quatre
    // faits également espacés. Un axe indexé dessinerait une pente régulière
    // là où il y a un trou de quatre semaines.
    const trend = buildWeightTrend(
      [
        entry('2026-08-01', 80),
        entry('2026-08-02', 80.2),
        entry('2026-08-03', 80.1),
        entry('2026-08-31', 78),
      ],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.fractions[0]).toBeCloseTo(0);
    expect(trend.fractions[1]).toBeCloseTo(1 / 30);
    expect(trend.fractions[2]).toBeCloseTo(2 / 30);
    expect(trend.fractions[3]).toBeCloseTo(1);
  });

  it('mesure l’écart sur la fenêtre, pas sur les pesées', () => {
    // Deux pesées à une semaine d'intervalle dans un mois restent à une
    // semaine d'intervalle, près de leur place sur le calendrier au-dessus,
    // au lieu d'être étirées d'un bord à l'autre.
    const trend = buildWeightTrend(
      [entry('2026-08-10', 80), entry('2026-08-17', 79)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.fractions[0]).toBeCloseTo(9 / 30);
    expect(trend.fractions[1]).toBeCloseTo(16 / 30);
  });

  it('rend l’écart entre la première et la dernière pesée', () => {
    const trend = buildWeightTrend(
      [entry('2026-08-01', 82), entry('2026-08-31', 79.5)],
      '2026-08-01',
      '2026-08-31',
    );

    expect(trend.delta).toBeCloseTo(-2.5);
  });

  it('ne donne pas d’écart sur une seule pesée', () => {
    // Une mesure n'est pas une tendance.
    const trend = buildWeightTrend([entry('2026-08-10', 80)], '2026-08-01', '2026-08-31');

    expect(trend.points).toHaveLength(1);
    expect(trend.delta).toBeNull();
  });

  it('ne rend rien sur une fenêtre sans pesée', () => {
    const trend = buildWeightTrend([], '2026-08-01', '2026-08-31');

    expect(trend.points).toEqual([]);
    expect(trend.fractions).toEqual([]);
    expect(trend.delta).toBeNull();
  });

  it('ne produit pas de NaN sur une fenêtre d’un seul jour', () => {
    // `to === from` donne une portée nulle : une division non gardée sortirait
    // des positions NaN, et le tracé SVG disparaîtrait sans erreur.
    const trend = buildWeightTrend([entry('2026-08-10', 80)], '2026-08-10', '2026-08-10');

    expect(Number.isFinite(trend.fractions[0])).toBe(true);
  });

  it('garde les positions dans la fenêtre', () => {
    // Une pesée hors bornes ne doit pas tracer hors du cadre.
    const trend = buildWeightTrend(
      [entry('2026-07-20', 81), entry('2026-09-05', 79)],
      '2026-08-01',
      '2026-08-31',
    );

    for (const fraction of trend.fractions) {
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
    }
  });
});
