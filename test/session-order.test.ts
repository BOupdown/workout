import { describe, expect, it } from 'vitest';
import { canMoveBlock, moveBlock } from '../lib/session-order';

const order = ['a', 'b', 'c'];

describe('moveBlock', () => {
  it('remonte un bloc d’un cran', () => {
    expect(moveBlock(order, 'b', -1)).toEqual(['b', 'a', 'c']);
  });

  it('descend un bloc d’un cran', () => {
    expect(moveBlock(order, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('refuse de remonter le premier', () => {
    expect(moveBlock(order, 'a', -1)).toBeNull();
  });

  it('refuse de descendre le dernier', () => {
    expect(moveBlock(order, 'c', 1)).toBeNull();
  });

  it('refuse un identifiant inconnu', () => {
    expect(moveBlock(order, 'zzz', -1)).toBeNull();
  });

  it('ne modifie pas la liste reçue', () => {
    const source = [...order];
    moveBlock(source, 'b', 1);
    expect(source).toEqual(order);
  });

  it('rend toujours une couverture exacte', () => {
    // C'est ce que reorderSessionExercises exige : les mêmes identifiants,
    // chacun une fois. Un résultat plus court ou dupliqué serait rejeté.
    const moved = moveBlock(order, 'a', 1);
    expect(moved).not.toBeNull();
    expect([...moved!].sort()).toEqual([...order].sort());
    expect(new Set(moved!).size).toBe(order.length);
  });

  it('un aller-retour revient au point de départ', () => {
    const down = moveBlock(order, 'a', 1)!;
    expect(moveBlock(down, 'a', -1)).toEqual(order);
  });

  it('gère une liste d’un seul bloc', () => {
    expect(moveBlock(['solo'], 'solo', -1)).toBeNull();
    expect(moveBlock(['solo'], 'solo', 1)).toBeNull();
  });
});

describe('canMoveBlock', () => {
  it('répond sans construire le résultat', () => {
    expect(canMoveBlock(order, 'a', -1)).toBe(false);
    expect(canMoveBlock(order, 'a', 1)).toBe(true);
  });
});
