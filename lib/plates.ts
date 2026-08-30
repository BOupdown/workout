/**
 * What to hang on the bar to reach a load.
 *
 * The one arithmetic nobody does well between two sets: 92.5 kg on a 20 kg bar
 * is 36.25 a side, and 36.25 is 25 + 10 + 1.25. Getting it wrong costs a walk
 * back to the rack, and getting it wrong *the same way twice* quietly corrupts
 * a progression, because the number logged is the one that was meant, not the
 * one that was lifted.
 *
 * Everything here is computed **in the display unit**, never in the canonical
 * kilogram. A plate is a physical object with a number stamped on it: a 45 lb
 * disc is 20.41 kg, which is not a plate anybody owns. Converting the
 * inventory would produce arithmetic that is exactly right and completely
 * useless. So the bar, the plates and the target are read in whatever unit is
 * on screen, and the result is exact in that unit — the same reasoning that
 * makes `weightIncrement()` step in 5 lb rather than in 5.51.
 */

import { formatNumber } from './format';
import type { WeightUnit } from './units';

/**
 * The plates a gym stocks, per unit — the full list the settings offer to turn
 * on and off.
 *
 * Deliberately closed rather than free-form. An arbitrary denomination would
 * have to be typed on a phone, in a gym, to describe something the user can see
 * on the rack, and the two or three sizes it would add over this list (0.5 kg
 * fractionals, a 55 lb bumper) are rare enough not to pay for a numeric field
 * that can hold "0.4".
 */
export const PLATE_DENOMINATIONS: Record<WeightUnit, readonly number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5, 1.25],
};

/**
 * What is on by default.
 *
 * Everything, minus the sizes that are the exception rather than the rule: a
 * 1.25 lb plate is a microloading accessory, not gym furniture, whereas its
 * kilogram counterpart is on every rack in Europe. A plate wrongly assumed
 * present is the worse error of the two — it produces a loading that cannot be
 * built — so the doubtful one starts off.
 */
export const DEFAULT_PLATES: Record<WeightUnit, readonly number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Offered as one tap. Olympic, women's, technique, EZ — in that order. */
export const BAR_PRESETS: Record<WeightUnit, readonly number[]> = {
  kg: [20, 15, 10, 7.5],
  lb: [45, 35, 25, 15],
};

export const DEFAULT_BAR: Record<WeightUnit, number> = { kg: 20, lb: 45 };

/**
 * Ceiling for the bar, in either unit.
 *
 * No bar weighs 100 of anything — the heaviest specialty bars sit around 35 kg
 * and 110 lb — so one number serves both, and the field cannot be used to
 * smuggle a load in through the wrong box.
 */
export const MAX_BAR = 100;

/**
 * Everything is solved in **hundredths of a unit**.
 *
 * 1.25 and 2.5 are exact integers there, which is the whole point: the search
 * below walks an array indexed by weight, and a float is not an index. It also
 * removes the class of bug where 42.5 arrives as 42.499999999999996 and the
 * exact loading is reported as unreachable.
 */
const SCALE = 100;

/**
 * Guard against a typo, not against a lifter.
 *
 * `SET_LIMITS.maxWeightKg` already refuses 10000 at the database. This one
 * protects the array allocated below, whose length is proportional to the load:
 * it is the difference between a wasted millisecond and a tab that stops
 * responding.
 */
const MAX_PER_SIDE = 500;

export interface PlateLoading {
  /** Plates for **one** side, heaviest first. Empty means the bar on its own. */
  perSide: number[];
  /** What the bar actually weighs once both sides are loaded. */
  total: number;
  /**
   * How far below the target that lands, in the display unit. `0` when the
   * target is reachable — which is the only case worth calling exact.
   */
  shortfall: number;
}

export type PlateResult =
  | ({ status: 'loaded' } & PlateLoading)
  /** The target is lighter than the bar: there is nothing to load. */
  | { status: 'below-bar' }
  /** Nothing readable in the load field yet. */
  | { status: 'no-target' }
  /** Past `MAX_PER_SIDE` a side — a typo, in practice. */
  | { status: 'out-of-range' };

/**
 * The plates to put on one side, in the fewest discs that reach the target.
 *
 * **Not greedy.** Taking the heaviest plate that fits and repeating is the
 * obvious algorithm and it is wrong: with 25s, 20s and 15s but no 10 and no 5,
 * a 30-a-side loading is 15 + 15, and greedy takes the 25 then declares the
 * remaining 5 impossible. Which plates a gym has is exactly what this feature
 * lets you state, so the case is not hypothetical — it is the reason the
 * setting exists. An exhaustive search over the denominations costs an array
 * the length of the load and always finds a loading when one exists.
 *
 * When the target cannot be built exactly, the closest reachable loading
 * **below** it comes back with the difference. Below rather than above on
 * purpose: an under-loaded bar is a set you can still log honestly, an
 * over-loaded one is a rep you may not get.
 */
export function solvePlates(
  target: number | null,
  bar: number,
  plates: readonly number[],
): PlateResult {
  if (target === null || !Number.isFinite(target) || !Number.isFinite(bar)) {
    return { status: 'no-target' };
  }
  if (target < bar) return { status: 'below-bar' };

  const targetUnits = Math.round(target * SCALE);
  const barUnits = Math.round(bar * SCALE);

  // Floored, because an odd number of hundredths cannot be split across two
  // sleeves. The remainder is not lost: it reappears in `shortfall`, which is
  // measured against the target rather than against this halved figure.
  const halfUnits = Math.floor((targetUnits - barUnits) / 2);
  if (halfUnits > MAX_PER_SIDE * SCALE) return { status: 'out-of-range' };

  const denominations = [...new Set(plates.filter((plate) => Number.isFinite(plate) && plate > 0))]
    .map((plate) => Math.round(plate * SCALE))
    .sort((a, b) => b - a);

  const fewest = fewestPlates(halfUnits, denominations);

  // Down to the heaviest loading that can actually be built. Index 0 is always
  // reachable — it is the bare bar — so this terminates.
  let side = halfUnits;
  while (side > 0 && fewest[side] < 0) side -= 1;

  return {
    status: 'loaded',
    perSide: rebuild(side, denominations, fewest).map((units) => units / SCALE),
    total: (barUnits + 2 * side) / SCALE,
    shortfall: (targetUnits - barUnits - 2 * side) / SCALE,
  };
}

/**
 * For every weight up to `limit`, the fewest plates that reach it exactly, or
 * `-1` when nothing does.
 *
 * `Int32Array` rather than a plain array: this is indexed by hundredths of a
 * unit, so a heavy squat allocates tens of thousands of cells, and a typed
 * array keeps that one contiguous block of memory.
 */
function fewestPlates(limit: number, denominations: readonly number[]): Int32Array {
  const fewest = new Int32Array(limit + 1).fill(-1);
  fewest[0] = 0;

  for (let weight = 1; weight <= limit; weight += 1) {
    let best = -1;

    for (const plate of denominations) {
      if (plate > weight) continue;

      const rest = fewest[weight - plate];
      if (rest < 0) continue;
      if (best < 0 || rest + 1 < best) best = rest + 1;
    }

    fewest[weight] = best;
  }

  return fewest;
}

/**
 * Walks the table back into a list of plates, heaviest first.
 *
 * `denominations` is sorted descending and the first plate that keeps the count
 * minimal is taken, so a tie is settled towards the bigger disc: 25 + 5 rather
 * than 20 + 10, which is both fewer things to pick up and how it is loaded.
 */
function rebuild(side: number, denominations: readonly number[], fewest: Int32Array): number[] {
  const perSide: number[] = [];
  let remaining = side;

  while (remaining > 0) {
    const plate = denominations.find(
      (candidate) =>
        candidate <= remaining && fewest[remaining - candidate] === fewest[remaining] - 1,
    );
    // Unreachable: `remaining` only ever holds weights the table marked
    // reachable, and every one of those was reached through some plate.
    if (plate === undefined) break;

    perSide.push(plate);
    remaining -= plate;
  }

  return perSide;
}

/** Identical plates, counted. `perSide` is ordered, so neighbours suffice. */
export interface PlateGroup {
  weight: number;
  count: number;
}

export function groupPlates(perSide: readonly number[]): PlateGroup[] {
  const groups: PlateGroup[] = [];

  for (const weight of perSide) {
    const last = groups.at(-1);
    if (last && last.weight === weight) last.count += 1;
    else groups.push({ weight, count: 1 });
  }

  return groups;
}

/** One side, read out: `2 × 25 + 10 + 1.25`. */
export function describePerSide(perSide: readonly number[]): string {
  if (perSide.length === 0) return 'Bar only';

  return groupPlates(perSide)
    .map((group) =>
      group.count > 1 ? `${group.count} × ${formatNumber(group.weight)}` : formatNumber(group.weight),
    )
    .join(' + ');
}

/** Keeps a bar weight inside the range the field offers. */
export function clampBarWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(MAX_BAR, Math.max(0, Math.round(weight * SCALE) / SCALE));
}

/**
 * A stored inventory, brought back to something this module can solve with:
 * known denominations only, deduplicated, heaviest first.
 *
 * Anything unrecognised is dropped rather than kept. The list comes back from
 * `localStorage`, where an older version of the app — or a hand-edited value —
 * can leave a size that no longer exists.
 */
export function normalisePlates(plates: readonly number[], unit: WeightUnit): number[] {
  const known = new Set(PLATE_DENOMINATIONS[unit]);

  return [...new Set(plates)].filter((plate) => known.has(plate)).sort((a, b) => b - a);
}
