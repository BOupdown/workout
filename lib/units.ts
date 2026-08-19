/**
 * Weight units.
 *
 * Loads are always **stored in kilograms** — that decision was made with the
 * schema and never changes. The unit is a display and input concern only, so
 * switching it never rewrites a single row.
 */

export type WeightUnit = 'kg' | 'lb';

export const WEIGHT_UNITS: WeightUnit[] = ['kg', 'lb'];

/** Exact, by international definition. */
const KG_PER_LB = 0.45359237;

/** Rounded to a tenth: gym plates never justify more precision. */
export function toDisplayWeight(kilograms: number, unit: WeightUnit): number {
  if (unit === 'kg') return kilograms;
  return Math.round((kilograms / KG_PER_LB) * 10) / 10;
}

/** Back to the canonical kilogram, with no rounding of its own. */
export function fromDisplayWeight(value: number, unit: WeightUnit): number {
  if (unit === 'kg') return value;
  return Math.round(value * KG_PER_LB * 1000) / 1000;
}

/**
 * Step for the +/- buttons, **native to the unit** rather than converted.
 *
 * Nobody adds 5.51 lb to a bar. A 2.5 kg step becomes 5 lb, not its literal
 * conversion, so the numbers stay the ones printed on the plates.
 */
export function weightIncrement(unit: WeightUnit, kilogramStep = 2.5): number {
  if (unit === 'kg') return kilogramStep;

  const converted = kilogramStep / KG_PER_LB;
  return Math.max(2.5, Math.round(converted / 2.5) * 2.5);
}
