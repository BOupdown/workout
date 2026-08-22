import { describe, expect, it } from 'vitest';
import { gridBounds, monthBounds, monthGrid, monthOf, shiftMonth } from '../lib/calendar';

const flat = (year: number, month: number) => monthGrid({ year, month }).flat();
const dates = (year: number, month: number) => flat(year, month).map((day) => day.date);

describe('monthGrid', () => {
  it('rend des semaines complètes de sept jours', () => {
    for (const [year, month] of [
      [2026, 1],
      [2026, 2],
      [2026, 8],
      [2024, 2],
    ] as const) {
      for (const week of monthGrid({ year, month })) {
        expect(week).toHaveLength(7);
      }
    }
  });

  it('commence chaque semaine un lundi', () => {
    // `getDay()` rend 1 pour lundi.
    for (const week of monthGrid({ year: 2026, month: 8 })) {
      const [y, m, d] = week[0].date.split('-').map(Number);
      expect(new Date(y, m - 1, d).getDay()).toBe(1);
    }
  });

  it('couvre tous les jours du mois, une seule fois', () => {
    const august = flat(2026, 8).filter((day) => day.inMonth);
    expect(august).toHaveLength(31);
    expect(new Set(august.map((day) => day.date)).size).toBe(31);
    expect(august[0].dayOfMonth).toBe(1);
    expect(august[30].dayOfMonth).toBe(31);
  });

  it('complète avec les jours voisins plutôt qu’avec du vide', () => {
    // Chaque case est une vraie date : une case vide n'a rien à afficher et
    // rien à toucher, et oblige tout le reste à se demander si elle est réelle.
    const grid = monthGrid({ year: 2026, month: 8 });
    const first = grid[0][0];

    expect(first.inMonth).toBe(false);
    expect(first.date).toBe('2026-07-27');
  });

  it('ne produit jamais de trou dans la suite des jours', () => {
    const all = dates(2026, 3);
    for (let i = 1; i < all.length; i += 1) {
      const [py, pm, pd] = all[i - 1].split('-').map(Number);
      const previous = new Date(py, pm - 1, pd);
      previous.setDate(previous.getDate() + 1);

      const [y, m, d] = all[i].split('-').map(Number);
      expect(new Date(y, m - 1, d).getTime()).toBe(previous.getTime());
    }
  });

  it('gère un février bissextile', () => {
    const february = flat(2024, 2).filter((day) => day.inMonth);
    expect(february).toHaveLength(29);
  });

  it('gère un février non bissextile', () => {
    expect(flat(2026, 2).filter((day) => day.inMonth)).toHaveLength(28);
  });

  it('ne rajoute pas une semaine entière du mois suivant', () => {
    // Février 2027 fait 28 jours et commence un lundi : exactement quatre
    // lignes, pas cinq dont une entièrement en mars.
    const grid = monthGrid({ year: 2027, month: 2 });
    expect(grid).toHaveLength(4);
    expect(grid.flat().every((day) => day.inMonth)).toBe(true);
  });

  it('passe l’année sur décembre', () => {
    const december = flat(2026, 12);
    expect(december.some((day) => day.date.startsWith('2027-01'))).toBe(true);
    expect(december.filter((day) => day.inMonth)).toHaveLength(31);
  });

  it('passe l’année sur janvier', () => {
    const january = flat(2026, 1);
    expect(january.some((day) => day.date.startsWith('2025-12'))).toBe(true);
    expect(january.filter((day) => day.inMonth)).toHaveLength(31);
  });
});

describe('shiftMonth', () => {
  it('avance et recule', () => {
    expect(shiftMonth({ year: 2026, month: 8 }, 1)).toEqual({ year: 2026, month: 9 });
    expect(shiftMonth({ year: 2026, month: 8 }, -1)).toEqual({ year: 2026, month: 7 });
  });

  it('roule l’année dans les deux sens', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it('encaisse un grand saut', () => {
    expect(shiftMonth({ year: 2026, month: 8 }, -20)).toEqual({ year: 2024, month: 12 });
  });
});

describe('monthOf', () => {
  it('lit le mois d’une date', () => {
    expect(monthOf('2026-08-21')).toEqual({ year: 2026, month: 8 });
  });
});

describe('gridBounds', () => {
  it('rend le premier et le dernier jour affichés', () => {
    // C'est ce qui permet d'interroger la base une seule fois pour toute la
    // grille, jours voisins compris.
    const grid = monthGrid({ year: 2026, month: 8 });
    const { from, to } = gridBounds(grid);

    expect(from).toBe(grid[0][0].date);
    expect(to).toBe(grid[grid.length - 1][6].date);
    expect(from < to).toBe(true);
  });
});

describe('monthBounds', () => {
  it('borne le mois, sans les jours voisins', () => {
    expect(monthBounds({ year: 2026, month: 8 })).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('connaît les mois courts', () => {
    expect(monthBounds({ year: 2026, month: 4 }).to).toBe('2026-04-30');
  });

  it('connaît les années bissextiles', () => {
    // 2024 est bissextile, 2026 ne l'est pas.
    expect(monthBounds({ year: 2024, month: 2 }).to).toBe('2024-02-29');
    expect(monthBounds({ year: 2026, month: 2 }).to).toBe('2026-02-28');
  });

  it('reste dans le mois là où la grille en sort', () => {
    // La différence entre les deux : la grille d'août 2026 commence un 27
    // juillet, et une légende disant « August » ne doit pas tracer ce jour-là.
    const grid = monthGrid({ year: 2026, month: 8 });

    expect(gridBounds(grid).from < monthBounds({ year: 2026, month: 8 }).from).toBe(true);
  });
});
