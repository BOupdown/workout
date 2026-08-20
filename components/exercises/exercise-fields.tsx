'use client';

import { Check, Lock } from '@phosphor-icons/react';
import type { MuscleGroup } from '@/lib/db/types';
import {
  draftAllowsIncrement,
  LOAD_TYPE_OPTIONS,
  METRIC_OPTIONS,
  MUSCLE_GROUP_LABELS,
  type ExerciseDraft,
} from '@/lib/exercise-draft';

interface ExerciseFieldsProps {
  draft: ExerciseDraft;
  patch: (changes: Partial<ExerciseDraft>) => void;
  autoFocusName?: boolean;
  /**
   * Number of sets already recorded. Above zero the fields that define the
   * exercise's *nature* are frozen, because changing them would rewrite what
   * those sets meant — which is exactly what `updateExercise` refuses.
   */
  lockedSetCount?: number;
}

/**
 * The body of the exercise form, shared by creation and editing.
 *
 * Shared on purpose rather than duplicated: the rule that a bodyweight exercise
 * has no progression step has to hold in both, and a rule written twice is a
 * rule that will diverge.
 *
 * The locked fields stay **visible**, greyed out rather than removed: seeing
 * that an exercise counts reps per side, and that this can no longer change, is
 * information. Hiding it would just look like the form lost a field.
 */
export function ExerciseFields({
  draft,
  patch,
  autoFocusName = false,
  lockedSetCount = 0,
}: ExerciseFieldsProps) {
  const locked = lockedSetCount > 0;

  return (
    <>
      <Field label="Name">
        <input
          type="text"
          autoComplete="off"
          autoFocus={autoFocusName}
          aria-label="Exercise name"
          value={draft.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder="Face pull"
          className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
        />
      </Field>

      {locked ? (
        <p className="flex items-start gap-2 rounded-control bg-raised px-3.5 py-3 text-sm text-muted">
          <Lock size={16} weight="bold" className="mt-0.5 shrink-0 text-ink" />
          <span>
            {lockedSetCount} set{lockedSetCount > 1 ? 's' : ''} already recorded, so what this
            exercise measures is fixed. The name and the rest stay editable — to change the
            measure, archive this one and create another.
          </span>
        </p>
      ) : null}

      <Field label="How the load works">
        <div className="space-y-1.5">
          {LOAD_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={locked}
              onClick={() => patch({ loadType: option.value })}
              aria-pressed={draft.loadType === option.value}
              className={`flex min-h-14 w-full flex-col justify-center rounded-control border-2 px-3.5 py-2 text-left transition-transform active:scale-[0.99] disabled:opacity-45 ${
                draft.loadType === option.value
                  ? 'border-ink bg-raised'
                  : 'border-transparent bg-raised'
              }`}
            >
              <span className="text-[0.9375rem] font-medium text-ink">{option.label}</span>
              <span className="text-xs text-muted">{option.hint}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="What you count">
        <div className="flex gap-1.5">
          {METRIC_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={locked}
              onClick={() => patch({ metric: option.value })}
              aria-pressed={draft.metric === option.value}
              className={`h-14 flex-1 rounded-control border-2 text-[0.9375rem] font-medium transition-transform active:scale-[0.98] disabled:opacity-45 ${
                draft.metric === option.value
                  ? 'border-ink bg-raised text-ink'
                  : 'border-transparent bg-raised text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Field>

      {draftAllowsIncrement(draft) ? (
        <Field label="Progression step" hint="what the + and − buttons add">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Progression step in kilograms"
            value={draft.defaultIncrementKg}
            onChange={(event) => patch({ defaultIncrementKg: event.target.value })}
            placeholder="2.5"
            className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 font-mono text-base text-ink tabular-nums outline-none placeholder:text-muted focus:border-ink"
          />
        </Field>
      ) : null}

      <Field label="Muscle group" hint="optional">
        <select
          aria-label="Muscle group"
          value={draft.muscleGroup}
          onChange={(event) => patch({ muscleGroup: event.target.value as MuscleGroup | '' })}
          className="h-14 w-full rounded-control border-2 border-line bg-raised px-3 text-base text-ink outline-none focus:border-ink"
        >
          <option value="">Not specified</option>
          {Object.entries(MUSCLE_GROUP_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        disabled={locked}
        onClick={() => patch({ perSide: !draft.perSide })}
        aria-pressed={draft.perSide}
        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-control border-2 px-3.5 text-left transition-transform active:scale-[0.99] disabled:opacity-45 ${
          draft.perSide ? 'border-ink bg-raised' : 'border-transparent bg-raised'
        }`}
      >
        <span>
          <span className="block text-[0.9375rem] font-medium text-ink">Counted per side</span>
          <span className="block text-xs text-muted">“10 reps” means 10 per arm or per leg</span>
        </span>
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            draft.perSide ? 'bg-accent text-accent-ink' : 'bg-surface text-transparent'
          }`}
        >
          <Check size={14} weight="bold" />
        </span>
      </button>
    </>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/* Label above the field, never a placeholder standing in for one. */}
      <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
        {hint ? <span className="normal-case"> · {hint}</span> : null}
      </p>
      {children}
    </div>
  );
}
