'use client';

import { useState } from 'react';
import { setBodyWeight } from '@/lib/db/bodyweight';
import type { LocalDate } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import { formatNumber, parseNumberInput } from '@/lib/format';
import { fromDisplayWeight, toDisplayWeight, type WeightUnit } from '@/lib/units';
import { NumericField } from './numeric-field';

interface BodyweightSheetProps {
  /** The day being weighed — the session's, here. */
  date: LocalDate;
  /** Current value, in kilograms — the stored unit. */
  bodyweightKg: number | undefined;
  unit: WeightUnit;
  onClose: () => void;
}

/**
 * Recording the bodyweight of the day.
 *
 * It belongs to the **day**, not to the session: ten pull-ups four kilos
 * lighter is not the same performance, and what makes that readable is the
 * weight being dated alongside the sets — not being owned by them. Written to
 * the same timeline the calendar reads, so a session and a calendar entry for
 * one day can never hold different numbers.
 *
 * Entered in the display unit, stored in kilograms, like every other load.
 */
export function BodyweightSheet({ date, bodyweightKg, unit, onClose }: BodyweightSheetProps) {
  const [value, setValue] = useState(() =>
    bodyweightKg === undefined ? '' : formatNumber(toDisplayWeight(bodyweightKg, unit)),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Not `weightIncrement`: that one steps in plates. A scale reads in half
  // kilos, or in pounds.
  const step = unit === 'kg' ? 0.5 : 1;

  const write = async (next: number | undefined) => {
    setBusy(true);
    try {
      await setBodyWeight(date, next);
      onClose();
    } catch (thrown) {
      setError(
        thrown instanceof ValidationError
          ? (thrown.issues[0]?.message ?? thrown.message)
          : 'Could not save the bodyweight. Try again.',
      );
      setBusy(false);
    }
  };

  const handleSave = () => {
    const parsed = parseNumberInput(value);
    // An empty field is not an error: it is how you take the value back off.
    void write(parsed === null ? undefined : fromDisplayWeight(parsed, unit));
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close without saving"
        onClick={onClose}
        className="flex-1 bg-ink/40"
      />

      <section
        aria-label="Bodyweight for this session"
        style={{ touchAction: 'pan-y' }}
        className="shrink-0 rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
      >
        <h2 className="mb-1 text-[0.9375rem] font-semibold text-ink">Bodyweight</h2>
        <p className="mb-3 text-xs text-muted">
          Recorded with this session, so pull-ups and dips can be compared over time.
        </p>

        <NumericField
          label="Bodyweight"
          unit={unit}
          mode="decimal"
          value={value}
          disabled={busy}
          error={error ?? undefined}
          onChange={(next) => {
            setValue(next);
            setError(null);
          }}
          onStep={(direction) => {
            const base = parseNumberInput(value) ?? 0;
            setValue(formatNumber(Math.max(0, Math.round((base + direction * step) * 100) / 100)));
            setError(null);
          }}
        />

        <div className="mt-3 flex items-stretch gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-14 shrink-0 rounded-control px-4 text-sm font-medium text-muted transition-transform active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={busy}
            className="h-14 flex-1 rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
