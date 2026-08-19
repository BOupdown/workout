'use client';

import { Check, TrendUp } from '@phosphor-icons/react';
import type { SetDraftController } from '@/hooks/use-set-draft';
import type { FieldMessages } from '@/lib/errors';
import type { SessionExerciseWithSets, SetKind } from '@/lib/db/types';
import { stepDraftValue, stepForField, type DraftField } from '@/lib/set-draft';
import type { WeightUnit } from '@/lib/units';
import { NumericField } from './numeric-field';

interface SetEntryPanelProps {
  entry: SessionExerciseWithSets;
  controller: SetDraftController;
  messages: FieldMessages;
  saving: boolean;
  unit: WeightUnit;
  onSave: () => void;
  onShowProgression: () => void;
  kind: SetKind;
  onKindChange: (kind: SetKind) => void;
}

/** The load label comes from the validation; the other two are fixed. */
const FIELD_LABELS: Record<DraftField, string> = {
  weightKg: 'Load',
  reps: 'Reps',
  durationSec: 'Time',
};

const FIELD_MODES: Record<DraftField, 'decimal' | 'numeric'> = {
  weightKg: 'decimal',
  reps: 'numeric',
  durationSec: 'numeric',
};

const ORIGIN_LABELS: Record<string, string | null> = {
  none: null,
  block: null,
  session: 'previous set',
  history: 'last session',
};

/**
 * The entry area, anchored at the bottom within thumb reach.
 *
 * The fields rendered are **exactly** those `setFieldRequirements()` declares
 * required, and the load label is the one it supplies. The screen therefore
 * cannot make a set the database would reject: a forbidden field simply does
 * not exist.
 */
export function SetEntryPanel({
  entry,
  controller,
  messages,
  saving,
  unit,
  onSave,
  onShowProgression,
  kind,
  onKindChange,
}: SetEntryPanelProps) {
  const { draft, setField, requirements, visibleFields, referenceOrigin } = controller;

  if (!requirements) return null;

  const originLabel = ORIGIN_LABELS[referenceOrigin];
  const nextSetNumber = entry.sets.length + 1;
  const fieldUnits: Partial<Record<DraftField, string>> = { weightKg: unit, durationSec: 's' };

  return (
    <section
      aria-label={`Log a set of ${entry.exercise.name}`}
      /* A horizontal drag here means adjusting a value, not changing tab. */
      data-no-swipe
      className="shrink-0 border-t border-line bg-raised px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* The name truncates, the meta never disappears: without `shrink-0`,
            "One-arm dumbbell row" would push it out. */}
        <button
          type="button"
          onClick={onShowProgression}
          aria-label={`See progression for ${entry.exercise.name}`}
          className="-ml-1 flex min-h-11 min-w-0 items-center gap-1.5 rounded-control px-1 text-left transition-transform active:scale-[0.98]"
        >
          <span className="truncate text-[0.9375rem] font-semibold text-ink">
            {entry.exercise.name}
          </span>
          <TrendUp size={15} weight="bold" className="shrink-0 text-muted" />
        </button>

        <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
          set {nextSetNumber}
          {originLabel ? <span className="font-sans"> · {originLabel}</span> : null}
        </span>
      </div>

      {messages.general.length > 0 ? (
        <div role="alert" className="mb-3 rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
          {messages.general.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-2.5">
        {visibleFields.map((field) => (
          <NumericField
            key={field}
            label={
              field === 'weightKg'
                ? (requirements.weightLabel ?? FIELD_LABELS.weightKg)
                : FIELD_LABELS[field]
            }
            unit={fieldUnits[field]}
            mode={FIELD_MODES[field]}
            value={draft[field]}
            disabled={saving}
            error={messages.fields[field]}
            onChange={(value) => setField(field, value)}
            onStep={(direction) =>
              setField(
                field,
                stepDraftValue(
                  draft[field],
                  direction * stepForField(field, entry.exercise, unit),
                ),
              )
            }
          />
        ))}
      </div>

      <div className="mt-3 flex items-stretch gap-2">
        {/* Marking a warm-up is not cosmetic: it is what keeps ramp-up sets out
            of the progression curve. Deliberately sticky from one set to the
            next, since you chain several. */}
        <button
          type="button"
          onClick={() => onKindChange(kind === 'warmup' ? 'work' : 'warmup')}
          aria-pressed={kind === 'warmup'}
          className={`h-16 shrink-0 rounded-control px-3.5 text-xs font-semibold transition-transform active:scale-95 ${
            kind === 'warmup' ? 'bg-ink text-surface' : 'bg-surface text-muted'
          }`}
        >
          Warm-up
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex h-16 flex-1 items-center justify-center gap-2 rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Check size={22} weight="bold" />
          {saving ? 'Saving…' : 'Save set'}
        </button>
      </div>
    </section>
  );
}
