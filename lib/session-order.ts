/**
 * Moving an exercise within a session.
 *
 * Kept apart from the screen because `reorderSessionExercises` demands an
 * **exact cover** of the session's blocks — the same identifiers, each once. An
 * off-by-one here would not misplace a row, it would be rejected outright, so
 * the arithmetic is worth testing on its own.
 */

import type { Id } from './db/types';

/** Up the list, or down it. */
export type MoveDirection = -1 | 1;

/**
 * Returns the order with `id` moved one place, or `null` when the move is
 * impossible — unknown id, or already at the end it is heading for.
 *
 * `null` rather than the unchanged list: the caller has to be able to tell
 * "nothing to do" from "done", if only to leave the button disabled.
 */
export function moveBlock(order: readonly Id[], id: Id, direction: MoveDirection): Id[] | null {
  const from = order.indexOf(id);
  if (from < 0) return null;

  const to = from + direction;
  if (to < 0 || to >= order.length) return null;

  const next = [...order];
  next[from] = order[to];
  next[to] = order[from];
  return next;
}

/** Whether the move exists, without building the result. */
export function canMoveBlock(
  order: readonly Id[],
  id: Id,
  direction: MoveDirection,
): boolean {
  return moveBlock(order, id, direction) !== null;
}
