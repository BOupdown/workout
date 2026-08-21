import { describe, expect, it } from 'vitest';
import {
  blockOn,
  blockProgressOn,
  currentBlock,
  daysBetween,
  orderBlocks,
  type TrainingBlock,
} from '../lib/training-block';

const block = (label: string, startsOn: string): TrainingBlock => ({
  id: label.toLowerCase(),
  label,
  startsOn,
  createdAt: 1_700_000_000_000,
});

const strength = block('Strength', '2026-08-03');
const hypertrophy = block('Hypertrophy', '2026-09-07');
const deload = block('Deload', '2026-10-05');

describe('daysBetween', () => {
  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-08-03', '2026-08-10')).toBe(7);
  });

  it('rend zéro pour le même jour', () => {
    expect(daysBetween('2026-08-03', '2026-08-03')).toBe(0);
  });

  it('compte à rebours', () => {
    expect(daysBetween('2026-08-10', '2026-08-03')).toBe(-7);
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

describe('blockOn', () => {
  const all = [hypertrophy, strength, deload];

  it('rend null avant le tout premier bloc', () => {
    // Un jour qui n'appartient à aucun bloc est un jour ordinaire, pas une erreur.
    expect(blockOn(all, '2026-08-02')).toBeNull();
  });

  it('rend le bloc dès son premier jour', () => {
    expect(blockOn(all, '2026-08-03')?.label).toBe('Strength');
  });

  it('garde le bloc jusqu’à la veille du suivant', () => {
    expect(blockOn(all, '2026-09-06')?.label).toBe('Strength');
    expect(blockOn(all, '2026-09-07')?.label).toBe('Hypertrophy');
  });

  it('ne laisse aucun trou entre deux blocs', () => {
    // C'est l'intérêt de n'avoir qu'une date de début : un trou ne peut pas
    // s'exprimer.
    for (const date of ['2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']) {
      expect(blockOn(all, date)).not.toBeNull();
    }
  });

  it('court indéfiniment après le dernier', () => {
    expect(blockOn(all, '2030-01-01')?.label).toBe('Deload');
  });

  it('ignore l’ordre d’arrivée de la liste', () => {
    expect(blockOn([deload, strength, hypertrophy], '2026-09-10')?.label).toBe('Hypertrophy');
  });

  it('rend null sans aucun bloc', () => {
    expect(blockOn([], '2026-08-03')).toBeNull();
  });
});

describe('blockProgressOn', () => {
  const all = [strength, hypertrophy];

  it('compte la première semaine à partir de un', () => {
    // Le premier jour, on est en semaine 1, pas en semaine 0.
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

  it('compte depuis le bloc en cours, pas depuis le premier', () => {
    const progress = blockProgressOn(all, '2026-09-14');
    expect(progress?.block.label).toBe('Hypertrophy');
    expect(progress?.week).toBe(2);
  });

  it('rend null hors de tout bloc', () => {
    expect(blockProgressOn(all, '2026-01-01')).toBeNull();
  });
});

describe('currentBlock', () => {
  it('rend le bloc qui couvre aujourd’hui', () => {
    expect(currentBlock([strength, hypertrophy], '2026-08-20')?.block.label).toBe('Strength');
  });

  it('ignore un bloc planifié dans le futur', () => {
    // Annoncer « semaine 1 » d'un bloc qui n'a pas commencé serait un mensonge
    // répété à chaque lecture.
    const future = block('Peaking', '2027-01-01');
    expect(currentBlock([strength, future], '2026-08-20')?.block.label).toBe('Strength');
  });

  it('rend null quand rien n’a jamais commencé', () => {
    expect(currentBlock([], '2026-08-20')).toBeNull();
  });
});

describe('orderBlocks', () => {
  it('trie par date de début', () => {
    expect(orderBlocks([deload, strength, hypertrophy]).map((b) => b.label)).toEqual([
      'Strength',
      'Hypertrophy',
      'Deload',
    ]);
  });

  it('ne modifie pas la liste reçue', () => {
    const input = [deload, strength];
    orderBlocks(input);
    expect(input.map((b) => b.label)).toEqual(['Deload', 'Strength']);
  });
});
