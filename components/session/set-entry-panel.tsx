'use client';

import { Barbell, Check, TrendUp } from '@phosphor-icons/react';
import type { SetDraftController } from '@/hooks/use-set-draft';
import type { FieldMessages } from '@/lib/errors';
import type { Exercise, SessionExerciseWithSets, SetKind } from '@/lib/db/types';
import type { SetFieldRequirements } from '@/lib/db/validation';
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
  onShowPlates: () => void;
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
  history: 'previous session',
};

/**
 * The label a field wears for this exercise.
 *
 * Reps say "per side" on a unilateral movement, because that is the moment it
 * matters: it decides what number you are about to type, and getting it wrong
 * halves or doubles a year of history.
 */
function fieldLabel(
  field: DraftField,
  requirements: SetFieldRequirements,
  exercise: Pick<Exercise, 'perSide'>,
): string {
  if (field === 'weightKg') return requirements.weightLabel ?? FIELD_LABELS.weightKg;
  if (field === 'reps' && exercise.perSide) return 'Reps / side';
  return FIELD_LABELS[field];
}

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
  onShowPlates,
  kind,
  onKindChange,
}: SetEntryPanelProps) {
  const { draft, setField, requirements, visibleFields, referenceOrigin } = controller;

  if (!requirements) return null;

  const originLabel = ORIGIN_LABELS[referenceOrigin];
  const nextSetNumber = entry.sets.length + 1;
  const fieldUnits: Partial<Record<DraftField, string>> = { weightKg: unit, durationSec: 's' };

  /*
   * `external` only, and it is the load type that decides — not the presence of
   * a load field.
   *
   * The other two that carry a number mean something a bar cannot hold: on a
   * weighted pull-up the load hangs off a belt, on an assisted machine it is
   * weight *removed* by a stack. Halving either across two sleeves would be
   * arithmetic about an object that is not there.
   *
   * A leg press is `external` and has no bar either — the model does not say
   * whether an exercise is loaded by hand or by a pin, and inventing a field to
   * find out would be a migration to settle a question the user answers by not
   * tapping the button.
   */
  const loadsABar = entry.exercise.loadType === 'external';

  return (
    <section
      aria-label={`Log a set of ${entry.exercise.name}`}
      /* `touch-action: pan-y` tells the browser a horizontal drag here is not
         a scroll: adjusting a value must never slide the tab track. */
      style={{ touchAction: 'pan-y' }}
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

      {entry.target ? <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted">
        <p>Target: {entry.target.sets} × {entry.target.metric === 'reps'
          ? `${entry.target.repsMin}–${entry.target.repsMax} reps${entry.exercise.perSide ? ' / side' : ''}`
          : `${entry.target.durationSec}s`} · Rest {entry.target.restSec}s</p>
        <p className="font-mono tabular-nums">{entry.sets.filter((set) => set.kind === 'work').length}/{entry.target.sets} work sets</p>
      </div> : null}

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
            label={fieldLabel(field, requirements, entry.exercise)}
            unit={fieldUnits[field]}
            mode={FIELD_MODES[field]}
            value={draft[field]}
            disabled={saving}
            error={messages.fields[field]}
            action={
              field === 'weightKg' && loadsABar ? (
                <button
                  type="button"
                  onClick={onShowPlates}
                  aria-label="Plates for this load"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-surface text-ink transition-transform active:scale-95"
                >
                  <Barbell size={20} weight="bold" />
                </button>
              ) : undefined
            }
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
