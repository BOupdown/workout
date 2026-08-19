'use client';

import { Minus, Plus } from '@phosphor-icons/react';
import type { FocusEvent } from 'react';

interface NumericFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onStep: (direction: 1 | -1) => void;
  /** `decimal` allows a comma, `numeric` does not. */
  mode: 'decimal' | 'numeric';
  unit?: string;
  error?: string;
  disabled?: boolean;
}

const STEP_BUTTON =
  'flex h-16 w-14 shrink-0 items-center justify-center rounded-control bg-surface text-ink ' +
  'transition-transform active:scale-95 disabled:opacity-40';

/**
 * A numeric field and its step buttons.
 *
 * `type="text"` plus `inputMode`, never `type="number"`: the latter lets the
 * scroll wheel change the value, handles the decimal separator badly depending
 * on locale, and silently swallows entries it deems invalid. `inputMode` is
 * enough to bring up the numeric keypad on mobile.
 */
export function NumericField({
  label,
  value,
  onChange,
  onStep,
  mode,
  unit,
  error,
  disabled,
}: NumericFieldProps) {
  const errorId = error ? `error-${label}` : undefined;

  // The field is pre-filled: without selecting on focus you would have to clear
  // it before typing. This is what keeps entry down to two taps.
  const selectAll = (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select();

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
        {/* `normal-case`, otherwise the unit inherits `uppercase`: "TIME (S)". */}
        {unit ? <span className="normal-case"> ({unit})</span> : null}
      </span>

      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onStep(-1)}
          disabled={disabled}
          className={STEP_BUTTON}
        >
          <Minus size={20} weight="bold" />
        </button>

        <input
          type="text"
          inputMode={mode}
          enterKeyHint="done"
          autoComplete="off"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          value={value}
          disabled={disabled}
          onFocus={selectAll}
          onChange={(event) => onChange(event.target.value)}
          className={`h-16 w-full min-w-0 rounded-control border-2 bg-raised text-center font-mono text-3xl font-semibold text-ink tabular-nums outline-none disabled:opacity-40 ${
            error ? 'border-danger' : 'border-line focus:border-ink'
          }`}
        />

        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onStep(1)}
          disabled={disabled}
          className={STEP_BUTTON}
        >
          <Plus size={20} weight="bold" />
        </button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-xs leading-snug text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
