'use client';

import { ArrowLeft, Check } from '@phosphor-icons/react';
import { useState } from 'react';
import { createExercise, ExerciseNameConflictError } from '@/lib/db/exercises';
import type { Exercise, MuscleGroup } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import {
  draftAllowsIncrement,
  EMPTY_EXERCISE_DRAFT,
  exerciseDraftToInput,
  LOAD_TYPE_OPTIONS,
  METRIC_OPTIONS,
  MUSCLE_GROUP_LABELS,
  type ExerciseDraft,
} from '@/lib/exercise-draft';

interface ExerciseFormSheetProps {
  /** Pre-filled name, when creation starts from a fruitless search. */
  initialName?: string;
  onCreated: (exercise: Exercise) => void;
  onUseExisting: (existing: Exercise) => void;
  onClose: () => void;
}

/**
 * Creating a custom exercise.
 *
 * The "progression step" field only appears where it means something: on
 * bodyweight there is no load to increment, and the validation refuses it. The
 * form therefore cannot build an exercise the database would reject.
 *
 * A name clash is not a dead end: the error carries the existing exercise, so we
 * offer to use it in one tap rather than sending the user back to their typing.
 */
export function ExerciseFormSheet({
  initialName = '',
  onCreated,
  onUseExisting,
  onClose,
}: ExerciseFormSheetProps) {
  const [draft, setDraft] = useState<ExerciseDraft>({
    ...EMPTY_EXERCISE_DRAFT,
    name: initialName,
  });
  const [conflict, setConflict] = useState<Exercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = (changes: Partial<ExerciseDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setConflict(null);
    setError(null);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const exercise = await createExercise(exerciseDraftToInput(draft));
      onCreated(exercise);
    } catch (thrown) {
      if (thrown instanceof ExerciseNameConflictError) {
        setConflict(thrown.existing);
      } else if (thrown instanceof ValidationError) {
        setError(thrown.issues[0]?.message ?? thrown.message);
      } else {
        setError('Could not create the exercise. Try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-no-swipe className="fixed inset-0 z-30 flex flex-col bg-surface">
      <header className="flex shrink-0 items-center gap-2 border-b border-line bg-raised px-2 pt-[calc(env(safe-area-inset-top)+0.875rem)] pb-3.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Cancel creation"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink transition-transform active:scale-95"
        >
          <ArrowLeft size={20} weight="bold" />
        </button>
        <h2 className="text-[0.9375rem] font-semibold text-ink">New exercise</h2>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <Field label="Name">
          <input
            type="text"
            autoComplete="off"
            autoFocus
            aria-label="Exercise name"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Face pull"
            className="h-14 w-full rounded-control border-2 border-line bg-raised px-3.5 text-base text-ink outline-none placeholder:text-muted focus:border-ink"
          />
        </Field>

        {conflict ? (
          <div role="alert" className="rounded-panel bg-raised px-4 py-3.5">
            <p className="text-sm text-ink">
              “{conflict.name}” already exists{conflict.archivedAt !== undefined ? ' (archived)' : ''}.
            </p>
            <button
              type="button"
              onClick={() => onUseExisting(conflict)}
              className="mt-2.5 h-12 w-full rounded-control bg-ink text-sm font-semibold text-surface transition-transform active:scale-[0.98]"
            >
              Use this exercise
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <Field label="How the load works">
          <div className="space-y-1.5">
            {LOAD_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => patch({ loadType: option.value })}
                aria-pressed={draft.loadType === option.value}
                className={`flex min-h-14 w-full flex-col justify-center rounded-control border-2 px-3.5 py-2 text-left transition-transform active:scale-[0.99] ${
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
                onClick={() => patch({ metric: option.value })}
                aria-pressed={draft.metric === option.value}
                className={`h-14 flex-1 rounded-control border-2 text-[0.9375rem] font-medium transition-transform active:scale-[0.98] ${
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
          onClick={() => patch({ perSide: !draft.perSide })}
          aria-pressed={draft.perSide}
          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-control border-2 px-3.5 text-left transition-transform active:scale-[0.99] ${
            draft.perSide ? 'border-ink bg-raised' : 'border-transparent bg-raised'
          }`}
        >
          <span>
            <span className="block text-[0.9375rem] font-medium text-ink">Counted per side</span>
            <span className="block text-xs text-muted">
              “10 reps” means 10 per arm or per leg
            </span>
          </span>
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              draft.perSide ? 'bg-accent text-accent-ink' : 'bg-surface text-transparent'
            }`}
          >
            <Check size={14} weight="bold" />
          </span>
        </button>
      </div>

      <div className="shrink-0 border-t border-line bg-raised px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || draft.name.trim() === ''}
          className="h-16 w-full rounded-control bg-accent text-[1.0625rem] font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {saving ? 'Creating…' : 'Create exercise'}
        </button>
      </div>
    </div>
  );
}

function Field({
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
