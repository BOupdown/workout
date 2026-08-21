/**
 * Supersets: exercises done back to back, with the rest taken after the round
 * rather than between them.
 *
 * A superset is expressed as blocks sharing `supersetGroup`, and only ever
 * counts as one while those blocks are **contiguous** in session order.
 *
 * The single gesture offered — join a block to the one immediately after it —
 * cannot open a hole in a group. Reordering the session can: slide a third
 * exercise between two members and they are no longer done back to back,
 * whatever the stored number still says. So contiguity is read rather than
 * trusted, and a group broken that way quietly stops being a superset instead
 * of leaving the screen and the entry panel telling different stories.
 */

import type { Id, SessionExercise } from './db/types';

/** What a block needs for grouping. */
export type GroupedBlock = Pick<SessionExercise, 'id' | 'order' | 'supersetGroup'>;

/** A block whose group changed, and what it changed to. */
export interface GroupChange {
  id: Id;
  /** `undefined` clears the block's group. */
  supersetGroup: number | undefined;
}

const byOrder = <T extends GroupedBlock>(blocks: readonly T[]): T[] =>
  [...blocks].sort((a, b) => a.order - b.order);

/**
 * The **contiguous** run of blocks sharing a group around `index`.
 *
 * Contiguity is checked on read, not only enforced on write. Reordering a
 * session can slide a third exercise between two members of a superset, and
 * from that moment they are no longer done back to back — whatever the stored
 * number still says. Reading runs rather than group equality means the layout
 * on screen and the behaviour of the entry panel can never disagree with each
 * other, and a broken group simply stops being a superset.
 */
function runAround(ordered: readonly GroupedBlock[], index: number): GroupedBlock[] {
  const group = ordered[index]?.supersetGroup;
  if (group === undefined) return [];

  let first = index;
  while (first > 0 && ordered[first - 1].supersetGroup === group) first -= 1;

  let last = index;
  while (last < ordered.length - 1 && ordered[last + 1].supersetGroup === group) last += 1;

  return ordered.slice(first, last + 1);
}

function nextFreeGroup(blocks: readonly GroupedBlock[]): number {
  const used = blocks
    .map((block) => block.supersetGroup)
    .filter((group): group is number => group !== undefined);

  return used.length === 0 ? 0 : Math.max(...used) + 1;
}

/**
 * Whether a block is currently joined to the one after it.
 *
 * Both must carry a group *and* the same one: two neighbours each in their own
 * superset are not in a superset together.
 */
export function isJoinedWithNext(blocks: readonly GroupedBlock[], blockId: Id): boolean {
  const ordered = byOrder(blocks);
  const index = ordered.findIndex((block) => block.id === blockId);
  if (index < 0 || index === ordered.length - 1) return false;

  const current = ordered[index];
  const next = ordered[index + 1];
  return current.supersetGroup !== undefined && current.supersetGroup === next.supersetGroup;
}

/**
 * Joins a block to the one after it, or splits them apart.
 *
 * Returns only the blocks whose group changed, or `null` when there is nothing
 * to do — an unknown block, or the last one, which has no neighbour to join.
 *
 * Joining merges *whole* groups, never halves: linking the tail of one superset
 * to the head of another produces a single superset of all of them, which is
 * the only reading of the gesture that leaves groups contiguous.
 *
 * Splitting hands the tail a new group, then dissolves any group left with a
 * single member — a superset of one is a plain exercise, and leaving the number
 * behind would make it look otherwise.
 */
export function toggleJoinWithNext(
  blocks: readonly GroupedBlock[],
  blockId: Id,
): GroupChange[] | null {
  const ordered = byOrder(blocks);
  const index = ordered.findIndex((block) => block.id === blockId);
  if (index < 0 || index === ordered.length - 1) return null;

  const current = ordered[index];
  const next = ordered[index + 1];

  const assignment = new Map<Id, number | undefined>(
    ordered.map((block) => [block.id, block.supersetGroup]),
  );

  if (isJoinedWithNext(ordered, blockId)) {
    // Split: everything from `next` onward that shares the group moves out.
    const run = runAround(ordered, index);
    const cut = run.findIndex((block) => block.id === next.id);
    const tail = cut < 0 ? [] : run.slice(cut);
    const fresh = nextFreeGroup(ordered);

    for (const block of tail) assignment.set(block.id, fresh);
  } else {
    const target = current.supersetGroup ?? next.supersetGroup ?? nextFreeGroup(ordered);

    for (const position of [index, index + 1]) {
      const run = runAround(ordered, position);
      const whole = run.length === 0 ? [ordered[position]] : run;
      for (const member of whole) assignment.set(member.id, target);
    }
  }

  // A group of one is not a superset. Done after the fact rather than inside
  // each branch, so the rule holds however the assignment was reached.
  const counts = new Map<number, number>();
  for (const group of assignment.values()) {
    if (group !== undefined) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  for (const [id, group] of assignment) {
    if (group !== undefined && counts.get(group) === 1) assignment.set(id, undefined);
  }

  const changes: GroupChange[] = [];
  for (const block of ordered) {
    const wanted = assignment.get(block.id);
    if (wanted !== block.supersetGroup) changes.push({ id: block.id, supersetGroup: wanted });
  }

  return changes;
}

/**
 * The last block of `blockId`'s superset, or `blockId` itself when it is in
 * none.
 *
 * This is what decides when the rest starts: inside a superset you move
 * straight to the next exercise, and the rest belongs after the round.
 */
export function lastOfGroup(blocks: readonly GroupedBlock[], blockId: Id): Id {
  const ordered = byOrder(blocks);
  const index = ordered.findIndex((block) => block.id === blockId);
  if (index < 0) return blockId;

  const run = runAround(ordered, index);
  // A run of one is not a superset, so the block is its own last member.
  return run.length < 2 ? blockId : run[run.length - 1].id;
}

/**
 * The block to move to after logging a set on `blockId`: the next member of its
 * superset, wrapping to the first once the round is done.
 *
 * `null` when the block is in no superset, which leaves the entry panel exactly
 * where it was — the one-tap repeat has to keep working outside a superset.
 */
export function nextInGroup(blocks: readonly GroupedBlock[], blockId: Id): Id | null {
  const ordered = byOrder(blocks);
  const index = ordered.findIndex((block) => block.id === blockId);
  if (index < 0) return null;

  const run = runAround(ordered, index);
  if (run.length < 2) return null;

  const position = run.findIndex((block) => block.id === blockId);
  return run[(position + 1) % run.length].id;
}
