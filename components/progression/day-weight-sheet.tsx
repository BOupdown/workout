'use client';

import { useState } from 'react';
import { setBodyWeight } from '@/lib/db/bodyweight';
import type { LocalDate } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import { localMidnight } from '@/lib/db/keys';
import { formatNumber, parseNumberInput } from '@/lib/format';
import { fromDisplayWeight, toDisplayWeight, type WeightUnit } from '@/lib/units';
import { NumericField } from '@/components/session/numeric-field';

interface DayWeightSheetProps {
  date: LocalDate;
  weightKg: number | undefined;
  unit: WeightUnit;
  onClose: () => void;
}

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * Recording what you weighed on one day.
 *
 * The same write the session sheet uses, on the same timeline — the session
 * simply passes its own date. Two entry points, one number, so they cannot
 * disagree.
 *
 * Entered in the display unit, stored in kilograms, like every other load.
 */
export function DayWeightSheet({ date, weightKg, unit, onClose }: DayWeightSheetProps) {
  const [value, setValue] = useState(() =>
    weightKg === undefined ? '' : formatNumber(toDisplayWeight(weightKg, unit)),
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
        aria-label={`Bodyweight for ${date}`}
        style={{ touchAction: 'pan-y' }}
        className="shrink-0 rounded-t-panel border-t border-line bg-raised px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
      >
        <h2 className="mb-3 text-[0.9375rem] font-semibold text-ink">
          {DAY_LABEL.format(localMidnight(date))}
        </h2>

        {error ? (
          <p role="alert" className="mb-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <NumericField
          label="Bodyweight"
          unit={unit}
          mode="decimal"
          value={value}
          disabled={busy}
          onChange={setValue}
          onStep={(direction) => {
            const current = parseNumberInput(value) ?? 0;
            setValue(formatNumber(Math.max(0, Math.round((current + direction * step) * 100) / 100)));
          }}
        />

        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="mt-3 h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>

        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="mt-2 h-12 w-full rounded-control text-sm font-medium text-muted transition-transform active:scale-95 disabled:opacity-50"
        >
          Cancel
        </button>
      </section>
    </div>
  );
}
