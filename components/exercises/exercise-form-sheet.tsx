'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import { useState } from 'react';
import { createExercise, ExerciseNameConflictError } from '@/lib/db/exercises';
import type { Exercise } from '@/lib/db/types';
import { ValidationError } from '@/lib/db/validation';
import {
  EMPTY_EXERCISE_DRAFT,
  exerciseDraftToInput,
  type ExerciseDraft,
} from '@/lib/exercise-draft';
import { ExerciseFields } from './exercise-fields';

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
    <div className="fixed inset-0 z-30 flex flex-col bg-surface">
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
        <ExerciseFields draft={draft} patch={patch} autoFocusName />

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
