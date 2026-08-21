import { describe, expect, it } from 'vitest';
import {
  blockOn,
  blockProgressOn,
  covers,
  currentBlock,
  daysBetween,
  orderBlocks,
  overlaps,
  type TrainingBlock,
} from '../lib/training-block';

const block = (label: string, startsOn: string, endsOn: string): TrainingBlock => ({
  id: label.toLowerCase(),
  label,
  startsOn,
  endsOn,
  createdAt: 1_700_000_000_000,
});

// Four weeks, then four weeks, with a fortnight of nothing in between.
const strength = block('Strength', '2026-08-03', '2026-08-30');
const hypertrophy = block('Hypertrophy', '2026-09-14', '2026-10-11');

describe('daysBetween', () => {
  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-08-03', '2026-08-10')).toBe(7);
  });

  it('rend zéro pour le même jour', () => {
    expect(daysBetween('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('traverse un mois et une année', () => {
    expect(daysBetween('2026-12-25', '2027-01-01')).toBe(7);
  });

  it('reste juste au passage à l’heure d’été', () => {
    // Le dimanche 29 mars 2026, une journée fait 23 heures en Europe. Une
    // division sans arrondi rendrait 6 jours pour une semaine pleine.
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
  });

  it('reste juste au passage à l’heure d’hiver', () => {
    expect(daysBetween('2026-10-21', '2026-10-28')).toBe(7);
  });
});

describe('covers', () => {
  it('inclut les deux bornes', () => {
    expect(covers(strength, '2026-08-03')).toBe(true);
    expect(covers(strength, '2026-08-30')).toBe(true);
  });

  it('exclut la veille et le lendemain', () => {
    expect(covers(strength, '2026-08-02')).toBe(false);
    expect(covers(strength, '2026-08-31')).toBe(false);
  });
});

describe('blockOn', () => {
  const all = [hypertrophy, strength];

  it('rend le bloc dès son premier jour', () => {
    expect(blockOn(all, '2026-08-03')?.label).toBe('Strength');
  });

  it('rend le bloc jusqu’à son dernier jour inclus', () => {
    expect(blockOn(all, '2026-08-30')?.label).toBe('Strength');
  });

  it('rend null dans un trou entre deux blocs', () => {
    // C'est le prix de la date de fin : les jours sans bloc existent. Ce sont
    // des jours ordinaires, pas une erreur.
    expect(blockOn(all, '2026-09-01')).toBeNull();
  });

  it('rend null avant le premier et après le dernier', () => {
    expect(blockOn(all, '2026-07-01')).toBeNull();
    expect(blockOn(all, '2026-12-01')).toBeNull();
  });

  it('ignore l’ordre d’arrivée de la liste', () => {
    expect(blockOn([hypertrophy, strength], '2026-09-20')?.label).toBe('Hypertrophy');
  });

  it('rend null sans aucun bloc', () => {
    expect(blockOn([], '2026-08-03')).toBeNull();
  });
});

describe('overlaps', () => {
  const all = [strength, hypertrophy];

  it('laisse passer un bloc placé dans un trou', () => {
    expect(overlaps(all, { startsOn: '2026-08-31', endsOn: '2026-09-13' })).toBeNull();
  });

  it('refuse un bloc englobant', () => {
    expect(overlaps(all, { startsOn: '2026-07-01', endsOn: '2026-12-01' })?.label).toBe(
      'Strength',
    );
  });

  it('refuse un chevauchement par la fin', () => {
    expect(overlaps(all, { startsOn: '2026-07-20', endsOn: '2026-08-05' })?.label).toBe(
      'Strength',
    );
  });

  it('refuse un chevauchement par le début', () => {
    expect(overlaps(all, { startsOn: '2026-08-25', endsOn: '2026-09-05' })?.label).toBe(
      'Strength',
    );
  });

  it('refuse un bloc contenu dans un autre', () => {
    expect(overlaps(all, { startsOn: '2026-08-10', endsOn: '2026-08-12' })?.label).toBe(
      'Strength',
    );
  });

  it('refuse un bloc partageant une seule journée', () => {
    // Le cas limite : commencer le jour même où le précédent finit.
    expect(overlaps(all, { startsOn: '2026-08-30', endsOn: '2026-09-10' })?.label).toBe(
      'Strength',
    );
  });

  it('accepte de commencer le lendemain de la fin', () => {
    expect(overlaps(all, { startsOn: '2026-08-31', endsOn: '2026-09-10' })).toBeNull();
  });

  it('peut s’ignorer lui-même, pour une modification', () => {
    expect(overlaps(all, strength, strength.id)).toBeNull();
  });
});

describe('blockProgressOn', () => {
  const all = [strength, hypertrophy];

  it('compte la première semaine à partir de un', () => {
    const progress = blockProgressOn(all, '2026-08-03');
    expect(progress?.daysIn).toBe(0);
    expect(progress?.week).toBe(1);
  });

  it('reste en semaine 1 jusqu’au septième jour', () => {
    expect(blockProgressOn(all, '2026-08-09')?.week).toBe(1);
  });

  it('passe en semaine 2 le huitième jour', () => {
    expect(blockProgressOn(all, '2026-08-10')?.week).toBe(2);
  });

  it('annonce la durée totale', () => {
    // Vingt-huit jours font quatre semaines, et c'est ce qui permet de dire
    // « semaine 2 sur 4 » au lieu de « semaine 2 ».
    expect(blockProgressOn(all, '2026-08-10')?.totalWeeks).toBe(4);
  });

  it('arrondit une durée incomplète vers le haut', () => {
    const short = block('Peaking', '2026-11-02', '2026-11-11'); // dix jours
    expect(blockProgressOn([short], '2026-11-02')?.totalWeeks).toBe(2);
  });

  it('compte les jours restants, le dernier valant zéro', () => {
    expect(blockProgressOn(all, '2026-08-30')?.daysLeft).toBe(0);
    expect(blockProgressOn(all, '2026-08-29')?.daysLeft).toBe(1);
  });

  it('ne dépasse jamais la durée annoncée', () => {
    const progress = blockProgressOn(all, '2026-08-30');
    expect(progress!.week).toBeLessThanOrEqual(progress!.totalWeeks);
  });

  it('rend null dans un trou', () => {
    expect(blockProgressOn(all, '2026-09-01')).toBeNull();
  });
});

describe('currentBlock', () => {
  it('rend le bloc qui couvre aujourd’hui', () => {
    expect(currentBlock([strength, hypertrophy], '2026-08-20')?.block.label).toBe('Strength');
  });

  it('ignore un bloc planifié dans le futur', () => {
    expect(currentBlock([hypertrophy], '2026-08-20')).toBeNull();
  });

  it('ignore un bloc déjà terminé', () => {
    expect(currentBlock([strength], '2026-09-20')).toBeNull();
  });
});

describe('orderBlocks', () => {
  it('trie par date de début', () => {
    expect(orderBlocks([hypertrophy, strength]).map((b) => b.label)).toEqual([
      'Strength',
      'Hypertrophy',
    ]);
  });

  it('ne modifie pas la liste reçue', () => {
    const input = [hypertrophy, strength];
    orderBlocks(input);
    expect(input.map((b) => b.label)).toEqual(['Hypertrophy', 'Strength']);
  });
});
