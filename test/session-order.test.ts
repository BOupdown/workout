import { describe, expect, it } from 'vitest';
import { canMoveBlock, moveBlock } from '../lib/session-order';

const order = ['a', 'b', 'c'];

describe('moveBlock', () => {
  it('moves a block up one place', () => {
    expect(moveBlock(order, 'b', -1)).toEqual(['b', 'a', 'c']);
  });

  it('moves a block down one place', () => {
    expect(moveBlock(order, 'b', 1)).toEqual(['a', 'c', 'b']);
  });

  it('refuses to move the first one up', () => {
    expect(moveBlock(order, 'a', -1)).toBeNull();
  });

  it('refuses to move the last one down', () => {
    expect(moveBlock(order, 'c', 1)).toBeNull();
  });

  it('refuses an unknown id', () => {
    expect(moveBlock(order, 'zzz', -1)).toBeNull();
  });

  it('leaves the list it was given alone', () => {
    const source = [...order];
    moveBlock(source, 'b', 1);
    expect(source).toEqual(order);
  });

  it('always returns the same ids, each exactly once', () => {
    // This is what reorderSessionExercises requires: the same ids, each one
    // once. A shorter or duplicated result would be refused.
    const moved = moveBlock(order, 'a', 1);
    expect(moved).not.toBeNull();
    expect([...moved!].sort()).toEqual([...order].sort());
    expect(new Set(moved!).size).toBe(order.length);
  });

  it('a move there and back lands where it started', () => {
    const down = moveBlock(order, 'a', 1)!;
    expect(moveBlock(down, 'a', -1)).toEqual(order);
  });

  it('handles a list holding a single block', () => {
    expect(moveBlock(['solo'], 'solo', -1)).toBeNull();
    expect(moveBlock(['solo'], 'solo', 1)).toBeNull();
  });
});

describe('canMoveBlock', () => {
  it('answers without building the result', () => {
    expect(canMoveBlock(order, 'a', -1)).toBe(false);
    expect(canMoveBlock(order, 'a', 1)).toBe(true);
  });
});
